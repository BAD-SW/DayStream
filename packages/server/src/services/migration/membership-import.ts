import { adminPool } from '../../db/pool';
import { calculatePeriodEnd } from '../membership.service';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason, matchByName, parseDateCell,
  fileDateOrder, customerMatchInput, DateOrder,
} from './import-core';

/**
 * Membership import (spec 50, Wave 2). Brings across a customer's CURRENT membership so
 * recurring billing continues without re-enrolling everyone.
 *
 * Per row: customer (unified matching) + plan (matched by name to a configured plan) +
 * next billing date + status (default active). Written DIRECTLY to `mbr_enrollments`
 * (source 'import') rather than through `enrollCustomer`, because that path derives the
 * billing dates from a start date and the legacy file already tells us when the next
 * charge is due.
 *
 * Payment: the customer's default stored method (imported earlier) is linked. With no
 * method the membership is still imported active — nothing is charged by the import — and
 * the renewal engine's existing "no payment method on file" handling applies when it
 * comes due (the same behavior any membership without a card gets). Such rows are returned
 * as warnings so the owner knows which customers need a card.
 *
 * No emails: this path calls no notification code; the first renewal/dunning notice can
 * only happen when a renewal actually comes due, never at import time.
 */

interface MappedRow { [field: string]: string }
type EnrollmentStatus = 'active' | 'paused' | 'cancelled';

/** Map a legacy status word to one of ours. Empty = active. Unknown = null (row fails). */
export function mapMembershipStatus(raw: string | null | undefined): EnrollmentStatus | null {
  const s = (raw || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!s) return 'active';
  if (['active', 'current', 'live', 'ongoing', 'good standing'].includes(s)) return 'active';
  if (['paused', 'on hold', 'hold', 'frozen', 'freeze', 'suspended'].includes(s)) return 'paused';
  if (['cancelled', 'canceled', 'terminated', 'ended', 'expired', 'inactive', 'closed'].includes(s)) return 'cancelled';
  return null;
}

function addMonthsClamped(d: Date, months: number): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

/** One billing period before a date (used to derive the current period's start). */
export function stepBackOnePeriod(dateStr: string, frequency: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  switch (frequency) {
    case 'weekly': d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10);
    case 'biweekly': d.setUTCDate(d.getUTCDate() - 14); return d.toISOString().slice(0, 10);
    case 'quarterly': return addMonthsClamped(d, -3);
    case 'annually': return addMonthsClamped(d, -12);
    default: return addMonthsClamped(d, -1); // monthly
  }
}

function dayBefore(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface PlanRow { id: string; name: string; status: string; billing_frequency: string; price: number }

export async function runMembershipImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
  dateOrder?: DateOrder | null;
}): Promise<ImportResult> {
  const { businessId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;
  const warnings: RowFailure[] = [];
  result.warnings = warnings;

  const { rows: plans } = await adminPool.query<PlanRow>(
    `SELECT id, name, status, billing_frequency, price FROM mbr_plans WHERE business_id = $1`,
    [businessId],
  );
  const todayStr = new Date().toISOString().slice(0, 10);
  // Day-first or month-first, read from the file's own dates (else the business's country).
  const dateOrder = await fileDateOrder(businessId, rows, ['next_billing_date', 'start_date'], args.dateOrder);
  // (customer|plan) pairs already handled in THIS file, so a duplicate row is "matched" in
  // the trial exactly as it will be in the commit (where the first row has been written).
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message });
    };

    // --- status ---
    const status = mapMembershipStatus(r.status);
    if (!status) {
      fail('status', `"${r.status}" is not a recognised status (use active, paused, or cancelled — or leave blank for active)`);
      continue;
    }

    // --- plan ---
    const planMatch = matchByName(plans, r.plan, 'membership plan');
    if (!planMatch.match) { fail('plan', planMatch.reason!); continue; }
    const plan = planMatch.match;
    if (plan.status !== 'active') {
      fail('plan', `The plan "${plan.name}" is ${plan.status} and cannot be assigned — reactivate it in setup first`);
      continue;
    }

    // --- customer ---
    const matchInput = customerMatchInput(r);
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', match.conflict ?? noCustomerReason(matchInput)); continue; }
    const customerId = match.customerId;

    // --- dates ---
    let nextBilling: string | null = null;
    if (status === 'active') {
      nextBilling = parseDateCell(r.next_billing_date, dateOrder);
      if (!nextBilling) {
        fail('next_billing_date', (r.next_billing_date || '').trim()
          ? `"${r.next_billing_date}" is not a valid date`
          : 'An active membership needs a next billing date');
        continue;
      }
    }
    const startOverride = parseDateCell(r.start_date, dateOrder);
    if ((r.start_date || '').trim() && !startOverride) { fail('start_date', `"${r.start_date}" is not a valid date`); continue; }

    // --- idempotency: one live enrolment per customer + plan (same rule as enrollCustomer) ---
    const key = `${customerId}|${plan.id}`;
    if (seen.has(key)) { result.matched += 1; continue; }
    const { rows: existing } = await adminPool.query(
      status === 'cancelled'
        // A cancelled row is history: any prior enrolment in this plan means it's already here.
        ? `SELECT 1 FROM mbr_enrollments WHERE customer_id = $1 AND business_id = $2 AND plan_id = $3 LIMIT 1`
        : `SELECT 1 FROM mbr_enrollments WHERE customer_id = $1 AND business_id = $2 AND plan_id = $3
             AND status IN ('active', 'paused') AND cancelled_at IS NULL LIMIT 1`,
      [customerId, businessId, plan.id],
    );
    seen.add(key);
    if (existing.length > 0) { result.matched += 1; continue; }

    // --- payment method: link the customer's default (imported earlier) ---
    const { rows: pm } = await adminPool.query(
      `SELECT id FROM pay_payment_methods
       WHERE owner_level = 'customer' AND business_id = $1 AND customer_id = $2 AND status = 'active'
       ORDER BY is_default DESC, created_at DESC LIMIT 1`,
      [businessId, customerId],
    );
    const paymentMethodId: string | null = pm[0]?.id ?? null;

    if (status === 'active' && plan.price > 0) {
      if (!paymentMethodId) {
        warnings.push({
          row: rowNum, field: 'payment_method',
          message: `Imported active, but this customer has no payment method on file — it can't be charged, so its first renewal will fail and enter the normal dunning flow until a card is added`,
        });
      }
      if (nextBilling && nextBilling < todayStr) {
        warnings.push({
          row: rowNum, field: 'next_billing_date',
          message: `Next billing date ${nextBilling} is in the past — the next renewal run will treat it as due and bill it`,
        });
      }
    }

    // --- derive period dates from the next billing date ---
    const freq = plan.billing_frequency;
    let periodStart: string;
    let periodEnd: string;
    if (nextBilling) {
      periodEnd = dayBefore(nextBilling);
      periodStart = stepBackOnePeriod(nextBilling, freq);
    } else {
      // paused/cancelled with no billing date: anchor the period on today
      periodStart = todayStr;
      periodEnd = calculatePeriodEnd(todayStr, freq);
    }
    const startDate = startOverride ?? periodStart;

    if (!commit) { result.imported += 1; continue; }

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const { rows: enr } = await client.query(
        `INSERT INTO mbr_enrollments
           (plan_id, business_id, customer_id, status, start_date, current_period_start, current_period_end,
            next_billing_date, cancelled_at, paused_at, payment_method_id, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 CASE WHEN $10::boolean THEN NOW() ELSE NULL END,
                 CASE WHEN $11::boolean THEN NOW() ELSE NULL END,
                 $9,'import')
         RETURNING id`,
        [plan.id, businessId, customerId, status, startDate, periodStart, periodEnd,
          status === 'active' ? nextBilling : null, paymentMethodId,
          status === 'cancelled', status === 'paused'],
      );
      if (status !== 'cancelled') {
        // Seed the current period's included-item allowances (utilization isn't in the file,
        // so the member starts the period with their full allowance).
        const { rows: items } = await client.query(
          `SELECT id, quantity_per_period FROM mbr_plan_items WHERE plan_id = $1`, [plan.id],
        );
        for (const item of items) {
          await client.query(
            `INSERT INTO mbr_usage (enrollment_id, plan_item_id, period_start, period_end, quantity_used, quantity_allowed)
             VALUES ($1,$2,$3,$4,0,$5)
             ON CONFLICT (enrollment_id, plan_item_id, period_start) DO NOTHING`,
            [enr[0].id, item.id, periodStart, periodEnd, item.quantity_per_period],
          );
        }
      }
      await client.query('COMMIT');
      result.imported += 1;
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      fail('general', e?.message || 'Failed to import membership');
    } finally {
      client.release();
    }
  }

  return result;
}
