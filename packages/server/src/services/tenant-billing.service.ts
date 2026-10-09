import { adminPool } from '../db/pool';
import { getConfiguredAdapter } from './payments';
import { resolveConnectedAccount, getProviderToken, getCustomerRef } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { logAudit } from './audit.service';

/** Build an array of {field, from, to} for fields that changed between two objects. */
function diffFields(
  before: Record<string, any> | null,
  after: Record<string, any>,
  fields: string[],
): { field: string; from: any; to: any }[] {
  const changes: { field: string; from: any; to: any }[] = [];
  for (const f of fields) {
    const from = before ? before[f] : undefined;
    const to = after[f];
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field: f, from: from ?? null, to });
  }
  return changes;
}

/**
 * Tenant Billing service (spec phase 10, Section B — Tenant → Business).
 *
 * The direct mirror of platform-billing.service.ts one level down: computes and
 * settles what a TENANT charges each of its BUSINESSES each month, from the
 * business's negotiated plan (flat + percentage of net collections, optional cap,
 * intro period), billed in arrears and charged automatically against the
 * business's stored payment method. The "charging party owns the vault" model
 * routes the charge through the TENANT's processor connection (a business's card
 * is charged by its tenant — see chargingConfigOwnerFor in payment-methods.service).
 *
 * "Bill what it's told": this layer decides the amount and timing; the provider
 * only executes the single charge.
 *
 * Net collections (the % basis) come from pay_business_net_collections, populated
 * by Section C (customer payments). Until Section C lands those rows are absent and
 * the basis is zero, so percentage-only plans compute to zero and flat plans are
 * unaffected.
 */

export interface BillingCycle {
  year: number;
  month: number; // 1-12
}

/** Audit context for a charge attempt: which run (if any) and how it was triggered. */
export interface RunContext {
  executionId: string | null;      // sys_job_executions id, null for manual
  trigger: 'scheduled' | 'manual';
}

const MANUAL_RUN: RunContext = { executionId: null, trigger: 'manual' };

interface BusinessBillingPlan {
  id: string;
  business_id: string;
  tenant_id: string;
  flat_amount_cents: number;
  percentage_rate: string;        // NUMERIC comes back as string from pg
  cap_amount_cents: number | null;
  cap_applies_to: 'percentage' | 'combined';
  intro_period_months: number;
  intro_flat_amount_cents: number;
  intro_percentage_rate: string;
  billing_day: number;
  plan_start_date: string;        // YYYY-MM-DD
}

export interface ComputedCharge {
  businessId: string;
  tenantId: string;
  planId: string | null;
  cycle: BillingCycle;
  flatComponentCents: number;
  netCollectionsCents: number;
  percentageRate: number;
  percentageComponentCents: number;
  capAppliedCents: number | null;
  creditAppliedCents: number;
  amountChargedCents: number;
  creditCarriedForwardCents: number;
  currency: string;
  isZero: boolean;
}

/**
 * The billing cycle to bill on a given run date: the just-closed month (arrears).
 * On 2026-07-xx the cycle billed is 2026-06.
 */
export function arrearsCycleFor(runDate = new Date()): BillingCycle {
  const d = new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Does today match a business's billing_day, clamping to month-end for short months? */
function isDueToday(billingDay: number, runDate: Date): boolean {
  const y = runDate.getUTCFullYear();
  const m = runDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const effectiveDay = Math.min(billingDay, lastDay); // billing_day 31 in a 30-day month → 30
  return runDate.getUTCDate() === effectiveDay;
}

export interface BillingRunSummary {
  runDate: string;
  cycle: BillingCycle;
  newCharges: number;
  retries: number;
  settled: number;
  pending: number;
  failed: number;
  skippedSuspended: number;
}

/**
 * The daily tenant billing run (Section B, Requirement B3/B6), scoped to a single
 * tenant. Processes, for the given run date, within that tenant:
 *   - every active business whose billing_day falls today → a NEW charge for the
 *     just-closed cycle (billed in arrears), and
 *   - every business with an OUTSTANDING failed/retrying charge → a retry of THAT
 *     charge (each cycle retried independently, never merged).
 * Suspended businesses are skipped (no new charges, no retries). Idempotent per
 * (business, cycle) via billBusinessForCycle, so a second run the same day is safe.
 */
export async function runTenantBilling(
  tenantId: string, runDate = new Date(), executionId: string | null = null,
): Promise<BillingRunSummary> {
  const runContext: RunContext = { executionId, trigger: 'scheduled' };
  const cycle = arrearsCycleFor(runDate);
  const summary: BillingRunSummary = {
    runDate: runDate.toISOString(), cycle,
    newCharges: 0, retries: 0, settled: 0, pending: 0, failed: 0, skippedSuspended: 0,
  };

  const tally = (status: string) => {
    if (status === 'settled' || status === 'zero') summary.settled++;
    else if (status === 'pending') summary.pending++;
    else if (status === 'failed') summary.failed++;
  };

  // 1. New charges: active, non-suspended businesses in this tenant with a current
  //    plan due today.
  const { rows: businesses } = await adminPool.query(
    `SELECT b.id, b.currency, b.status, p.billing_day
     FROM sys_businesses b
     JOIN pay_business_billing_plans p ON p.business_id = b.id AND p.ended_at IS NULL
     WHERE b.tenant_id = $1::uuid`,
    [tenantId],
  );
  for (const b of businesses) {
    if (b.status === 'suspended') { summary.skippedSuspended++; continue; }
    if (!isDueToday(b.billing_day, runDate)) continue;
    summary.newCharges++;
    try {
      const r = await billBusinessForCycle(b.id, tenantId, cycle, b.currency || 'USD', runContext);
      tally(r.status);
    } catch { summary.failed++; }
  }

  // 2. Retries: any open (failed/retrying/pending) charge for a non-suspended
  //    business in this tenant, including charges from PRIOR cycles — each retried
  //    on its own row.
  const { rows: open } = await adminPool.query(
    `SELECT c.* FROM pay_business_billing_charges c
     JOIN sys_businesses b ON b.id = c.business_id
     WHERE c.tenant_id = $1::uuid AND c.status IN ('failed', 'retrying') AND b.status <> 'suspended'`,
    [tenantId],
  );
  for (const chargeRow of open) {
    // Skip the row we may have just created above (same business+cycle).
    if (chargeRow.cycle_year === cycle.year && chargeRow.cycle_month === cycle.month
        && businesses.some((b) => b.id === chargeRow.business_id && isDueToday(b.billing_day, runDate))) {
      continue;
    }
    summary.retries++;
    try {
      const r = await settleCharge(chargeRow, runContext);
      tally(r.status);
    } catch { summary.failed++; }
  }

  return summary;
}

/**
 * Count whole months between a plan start and the first day of a billing cycle.
 * `planStart` may arrive as a JS Date (pg maps DATE → Date) or a 'YYYY-MM-DD'
 * string, so normalize both.
 */
function monthsSincePlanStart(planStart: string | Date, cycle: BillingCycle): number {
  const start = planStart instanceof Date ? planStart : new Date(planStart + 'T00:00:00Z');
  const cycleStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  return (cycleStart.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (cycleStart.getUTCMonth() - start.getUTCMonth());
}

/** The current (un-ended) plan version for a business, or null if none configured. */
async function getCurrentPlan(businessId: string): Promise<BusinessBillingPlan | null> {
  const { rows } = await adminPool.query(
    `SELECT id, business_id, tenant_id, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date
     FROM pay_business_billing_plans
     WHERE business_id = $1 AND ended_at IS NULL
     ORDER BY version DESC LIMIT 1`,
    [businessId],
  );
  return rows[0] ?? null;
}

/** The net collections for a single business in a cycle (zero if none). */
async function getNetCollectionsCents(businessId: string, cycle: BillingCycle): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(net_amount_cents), 0)::int AS total
     FROM pay_business_net_collections
     WHERE business_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int`,
    [businessId, cycle.year, cycle.month],
  );
  return rows[0]?.total ?? 0;
}

/**
 * Compute (without charging) the amount owed by a business for a cycle. Pure
 * arithmetic over the current plan + net collections + outstanding credits;
 * does not draw down credits or write anything.
 */
export async function computeChargeForCycle(
  businessId: string, cycle: BillingCycle, currency = 'USD',
): Promise<ComputedCharge | null> {
  const plan = await getCurrentPlan(businessId);
  if (!plan) return null;

  // Intro applies ONLY to the first N months starting AT the plan start.
  const monthsIn = monthsSincePlanStart(plan.plan_start_date, cycle);
  const inIntro = monthsIn >= 0 && monthsIn < plan.intro_period_months;
  const flatCents = inIntro ? plan.intro_flat_amount_cents : plan.flat_amount_cents;
  const rate = parseFloat(inIntro ? plan.intro_percentage_rate : plan.percentage_rate) || 0;

  const netCollectionsCents = await getNetCollectionsCents(businessId, cycle);
  const rawPctCents = Math.round(netCollectionsCents * (rate / 100));

  // Apply the per-cycle cap: either to the percentage component alone or to the
  // combined (flat + percentage) charge (B1.6).
  let percentageComponentCents = rawPctCents;
  let subtotalCents: number;
  let capAppliedCents: number | null = null;

  if (plan.cap_amount_cents != null && plan.cap_applies_to === 'percentage') {
    if (percentageComponentCents > plan.cap_amount_cents) {
      capAppliedCents = plan.cap_amount_cents;
      percentageComponentCents = plan.cap_amount_cents;
    }
    subtotalCents = flatCents + percentageComponentCents;
  } else {
    subtotalCents = flatCents + percentageComponentCents;
    if (plan.cap_amount_cents != null && subtotalCents > plan.cap_amount_cents) {
      capAppliedCents = plan.cap_amount_cents;
      subtotalCents = plan.cap_amount_cents;
    }
  }

  // Apply outstanding business credits (FIFO) against the subtotal; floor at zero.
  const { rows: creditRows } = await adminPool.query(
    `SELECT id, remaining_cents FROM pay_business_credits
     WHERE business_id = $1 AND status = 'active' AND remaining_cents > 0
     ORDER BY created_at ASC`,
    [businessId],
  );
  let remainingToCharge = subtotalCents;
  let creditAppliedCents = 0;
  for (const c of creditRows) {
    if (remainingToCharge <= 0) break;
    const draw = Math.min(c.remaining_cents, remainingToCharge);
    creditAppliedCents += draw;
    remainingToCharge -= draw;
  }
  const amountChargedCents = Math.max(0, remainingToCharge);

  return {
    businessId,
    tenantId: plan.tenant_id,
    planId: plan.id,
    cycle,
    flatComponentCents: flatCents,
    netCollectionsCents,
    percentageRate: rate,
    percentageComponentCents,
    capAppliedCents,
    creditAppliedCents,
    amountChargedCents,
    creditCarriedForwardCents: 0,
    currency,
    isZero: amountChargedCents === 0,
  };
}

/** The business's default stored payment method id, or null. */
async function getBusinessDefaultMethodId(businessId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT id FROM pay_payment_methods
     WHERE owner_level = 'business' AND business_id = $1 AND status = 'active'
     ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [businessId],
  );
  return rows[0]?.id ?? null;
}

/** Draw down active credits by `amount` (FIFO), marking exhausted ones. */
async function applyCredits(client: any, businessId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const { rows } = await client.query(
    `SELECT id, remaining_cents FROM pay_business_credits
     WHERE business_id = $1 AND status = 'active' AND remaining_cents > 0
     ORDER BY created_at ASC FOR UPDATE`,
    [businessId],
  );
  let left = amount;
  let applied = 0;
  for (const c of rows) {
    if (left <= 0) break;
    const draw = Math.min(c.remaining_cents, left);
    const newRemaining = c.remaining_cents - draw;
    await client.query(
      `UPDATE pay_business_credits
       SET remaining_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [newRemaining, newRemaining === 0 ? 'exhausted' : 'active', c.id],
    );
    applied += draw;
    left -= draw;
  }
  return applied;
}

export interface ChargeResult {
  chargeId: string;
  referenceNumber: number;
  status: 'zero' | 'pending' | 'settled' | 'failed' | 'retrying';
  amountChargedCents: number;
  failureReason?: string;
}

/**
 * Bill a business for a cycle: compute the amount, apply credits, and settle it
 * against the business's stored method via the tenant's processor connection.
 * Idempotent per (business, cycle) — re-running settles/retries the SAME charge
 * row rather than creating a duplicate (B3.11). Returns the resulting charge record.
 */
export async function billBusinessForCycle(
  businessId: string, tenantId: string, cycle: BillingCycle, currency = 'USD', runContext: RunContext = MANUAL_RUN,
): Promise<ChargeResult> {
  // Idempotency: if a settled/zero charge already exists for this cycle, return it.
  const existing = await adminPool.query(
    `SELECT id, reference_number, status, amount_charged_cents FROM pay_business_billing_charges
     WHERE business_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int`,
    [businessId, cycle.year, cycle.month],
  );
  if (existing.rows[0] && ['settled', 'zero'].includes(existing.rows[0].status)) {
    const r = existing.rows[0];
    return { chargeId: r.id, referenceNumber: Number(r.reference_number), status: r.status, amountChargedCents: r.amount_charged_cents };
  }

  const computed = await computeChargeForCycle(businessId, cycle, currency);
  if (!computed) {
    throw Object.assign(new Error('Business has no billing plan configured'), { code: 'NO_PLAN' });
  }

  // Create or load the charge row (idempotent per business+cycle), then draw down
  // credits inside the same transaction so retries don't double-apply.
  const client = await adminPool.connect();
  let chargeRow: any;
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT * FROM pay_business_billing_charges
       WHERE business_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int FOR UPDATE`,
      [businessId, cycle.year, cycle.month],
    );

    if (found.rows[0]) {
      chargeRow = found.rows[0];
    } else {
      let subtotal = computed.flatComponentCents + computed.percentageComponentCents;
      if (computed.capAppliedCents != null && computed.capAppliedCents < subtotal) {
        subtotal = computed.capAppliedCents;
      }
      // First time for this cycle: draw down real credits against the subtotal.
      const creditApplied = await applyCredits(client, businessId, subtotal);
      const amount = Math.max(0, subtotal - creditApplied);
      const status = amount === 0 ? 'zero' : 'pending';
      const ins = await client.query(
        `INSERT INTO pay_business_billing_charges
           (business_id, tenant_id, plan_id, cycle_year, cycle_month, reference_number,
            flat_component_cents, net_collections_cents, percentage_rate, percentage_component_cents,
            cap_applied_cents, credit_applied_cents, amount_charged_cents, currency, status)
         VALUES ($1,$2,$3,$4,$5, nextval('pay_business_billing_charge_ref_seq'),
                 $6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [businessId, tenantId, computed.planId, cycle.year, cycle.month,
         computed.flatComponentCents, computed.netCollectionsCents, computed.percentageRate, computed.percentageComponentCents,
         computed.capAppliedCents, creditApplied, amount, currency, status],
      );
      chargeRow = ins.rows[0];
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  // Zero charge: recorded, no transaction attempted (B3.8). Still log an attempt.
  if (chargeRow.status === 'zero' || chargeRow.amount_charged_cents === 0) {
    await recordAttempt(chargeRow, 'zero', runContext, undefined, undefined);
    return { chargeId: chargeRow.id, referenceNumber: Number(chargeRow.reference_number), status: 'zero', amountChargedCents: 0 };
  }

  return settleCharge(chargeRow, runContext);
}

/** Write one per-attempt audit row (pay_billing_charge_attempts, scope_level='tenant'). */
async function recordAttempt(
  chargeRow: any, outcome: 'settled' | 'pending' | 'failed' | 'zero', runContext: RunContext,
  providerReference?: string | null, failureReason?: string | null,
): Promise<void> {
  await adminPool.query(
    `INSERT INTO pay_billing_charge_attempts
       (run_execution_id, trigger, scope_level, charge_id, tenant_id, business_id, cycle_year, cycle_month,
        outcome, amount_cents, currency, provider_reference, failure_reason)
     VALUES ($1,$2,'tenant',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      runContext.executionId, runContext.trigger, chargeRow.id, chargeRow.tenant_id, chargeRow.business_id,
      chargeRow.cycle_year, chargeRow.cycle_month, outcome, chargeRow.amount_charged_cents,
      chargeRow.currency, providerReference ?? null, failureReason ?? null,
    ],
  );
}

/**
 * Attempt (or retry) settlement of an existing charge row against the business's
 * stored method. Updates the row's status/attempts. Separated so the daily run
 * can retry failed charges without recomputing them.
 */
export async function settleCharge(chargeRow: any, runContext: RunContext = MANUAL_RUN): Promise<ChargeResult> {
  const businessId = chargeRow.business_id;
  const tenantId = chargeRow.tenant_id;
  const owner = { ownerLevel: 'business' as const, businessId, tenantId };

  const methodId = await getBusinessDefaultMethodId(businessId);
  const account = await resolveConnectedAccount(owner);

  const fail = async (reason: string): Promise<ChargeResult> => {
    await adminPool.query(
      `UPDATE pay_business_billing_charges
       SET status = 'failed', failure_reason = $1, attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reason, chargeRow.id],
    );
    await recordAttempt(chargeRow, 'failed', runContext, null, reason);
    return { chargeId: chargeRow.id, referenceNumber: Number(chargeRow.reference_number), status: 'failed', amountChargedCents: chargeRow.amount_charged_cents, failureReason: reason };
  };

  if (!methodId) return fail('No payment method on file for business');
  if (!account) return fail('No active tenant processor connection');

  const tokenInfo = await getProviderToken(methodId);
  if (!tokenInfo) return fail('Stored payment method is no longer available');

  // The vaulted method is attached to the owner's Stripe Customer; off-session
  // charges must reference it.
  const customerRef = await getCustomerRef(owner, account.provider);

  // Build the charging adapter from the TENANT connection's secrets (the tenant
  // charges the business → tenant connection owns the vault & account).
  const secrets = await getDecryptedSecrets({ ownerLevel: 'tenant', tenantId });
  const adapter = getConfiguredAdapter(account.provider, secrets);

  let outcome: 'succeeded' | 'pending' | 'failed';
  let providerReference: string | undefined;
  let failureReason: string | undefined;
  try {
    const result = await adapter.charge({
      account,
      amount: chargeRow.amount_charged_cents,
      currency: chargeRow.currency,
      methodToken: tokenInfo.token,
      customerRef,
      idempotencyKey: `tenbill:${businessId}:${chargeRow.cycle_year}-${chargeRow.cycle_month}`,
      description: `Tenant billing ${chargeRow.cycle_year}-${String(chargeRow.cycle_month).padStart(2, '0')}`,
      // Metadata must be STABLE for a given idempotency key (business+cycle).
      metadata: {
        kind: 'tenant_billing',
        business_id: businessId,
        tenant_id: tenantId,
        cycle: `${chargeRow.cycle_year}-${String(chargeRow.cycle_month).padStart(2, '0')}`,
      },
    });
    outcome = result.outcome;
    providerReference = result.providerReference;
    failureReason = result.failureReason;
  } catch (e: any) {
    return fail(e?.message || 'Charge failed');
  }

  // Map adapter outcome to charge status. Bank debits settle asynchronously, so
  // 'pending' is normal and the webhook later flips it to settled/failed.
  const status = outcome === 'succeeded' ? 'settled' : outcome === 'pending' ? 'pending' : 'failed';
  await adminPool.query(
    `UPDATE pay_business_billing_charges
     SET status = $1::varchar, provider_reference = $2, payment_method_id = $3, failure_reason = $4,
         attempts = attempts + 1, last_attempt_at = NOW(),
         settled_at = CASE WHEN $1::varchar = 'settled' THEN NOW() ELSE settled_at END, updated_at = NOW()
     WHERE id = $5`,
    [status, providerReference ?? null, methodId, outcome === 'failed' ? (failureReason ?? 'Declined') : null, chargeRow.id],
  );

  await recordAttempt(
    chargeRow,
    status === 'settled' ? 'settled' : status === 'pending' ? 'pending' : 'failed',
    runContext, providerReference ?? null, outcome === 'failed' ? (failureReason ?? 'Declined') : null,
  );

  return {
    chargeId: chargeRow.id,
    referenceNumber: Number(chargeRow.reference_number),
    status: status as ChargeResult['status'],
    amountChargedCents: chargeRow.amount_charged_cents,
    failureReason: outcome === 'failed' ? failureReason : undefined,
  };
}

// ============================================================
// Plan management (B1), credits (B4), and read views (B5)
// ============================================================

export interface BusinessBillingPlanInput {
  flatAmountCents: number;
  percentageRate: number;              // percent, e.g. 2.5
  capAmountCents?: number | null;
  capAppliesTo?: 'percentage' | 'combined';
  introPeriodMonths?: number;
  introFlatAmountCents?: number;
  introPercentageRate?: number;
  billingDay: number;                  // 1-31
  planStartDate?: string;              // YYYY-MM-DD
}

/** The current (un-ended) plan for a business, as a display view (or null). */
export async function getBusinessPlan(businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT id, business_id, tenant_id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date,
            effective_from, created_at
     FROM pay_business_billing_plans
     WHERE business_id = $1::uuid AND ended_at IS NULL
     ORDER BY version DESC LIMIT 1`,
    [businessId],
  );
  return rows[0] ?? null;
}

/**
 * Save a new plan VERSION for a business: end the current one and insert the new
 * one (version + 1), preserving history so past charges stay explainable (B1.15).
 * `tenantId` is required for the row's isolation column.
 */
export async function saveBusinessPlan(
  businessId: string, tenantId: string, input: BusinessBillingPlanInput, userId: string | null,
): Promise<any> {
  const client = await adminPool.connect();
  let newRow: any;
  let prevRow: any = null;
  try {
    await client.query('BEGIN');
    const prev = await client.query(
      `SELECT * FROM pay_business_billing_plans WHERE business_id = $1::uuid AND ended_at IS NULL FOR UPDATE`,
      [businessId],
    );
    prevRow = prev.rows[0] ?? null;
    const nextVersion = (prevRow?.version ?? 0) + 1;
    if (prevRow) {
      await client.query(
        `UPDATE pay_business_billing_plans SET ended_at = NOW() WHERE business_id = $1::uuid AND ended_at IS NULL`,
        [businessId],
      );
    }
    const { rows } = await client.query(
      `INSERT INTO pay_business_billing_plans
         (business_id, tenant_id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
          intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date, created_by)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        businessId, tenantId, nextVersion, input.flatAmountCents, input.percentageRate,
        input.capAmountCents ?? null, input.capAppliesTo ?? 'combined',
        input.introPeriodMonths ?? 0, input.introFlatAmountCents ?? 0, input.introPercentageRate ?? 0,
        input.billingDay, input.planStartDate ?? new Date().toISOString().slice(0, 10), userId,
      ],
    );
    newRow = rows[0];
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Audit: record what changed (from → to) on the business's billing plan.
  const changes = diffFields(prevRow, newRow, [
    'flat_amount_cents', 'percentage_rate', 'cap_amount_cents', 'cap_applies_to',
    'intro_period_months', 'intro_flat_amount_cents', 'intro_percentage_rate', 'billing_day', 'plan_start_date',
  ]);
  await logAudit({
    tenantId,
    userId: userId ?? undefined,
    action: prevRow ? 'billing_plan.updated' : 'billing_plan.created',
    resourceType: 'business',
    resourceId: businessId,
    details: { version: newRow.version, changes },
  });

  return newRow;
}

/** All plan versions for a business (newest first) — the plan change history. */
export async function listBusinessPlanVersions(businessId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day,
            plan_start_date, effective_from, ended_at, created_by, created_at
     FROM pay_business_billing_plans
     WHERE business_id = $1::uuid
     ORDER BY version DESC`,
    [businessId],
  );
  return rows;
}

/** List a business's charge history (most recent first). */
export async function listBusinessCharges(businessId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, cycle_year, cycle_month, reference_number, flat_component_cents, net_collections_cents,
            percentage_rate, percentage_component_cents, cap_applied_cents, credit_applied_cents,
            amount_charged_cents, currency, status, provider_reference, failure_reason, attempts,
            last_attempt_at, settled_at, created_at
     FROM pay_business_billing_charges
     WHERE business_id = $1::uuid
     ORDER BY cycle_year DESC, cycle_month DESC, created_at DESC`,
    [businessId],
  );
  return rows;
}

/** Issue a business credit (B4): amount + required reason. */
export async function issueBusinessCredit(
  businessId: string, tenantId: string, amountCents: number, reason: string, userId: string | null,
): Promise<any> {
  const { rows } = await adminPool.query(
    `INSERT INTO pay_business_credits (business_id, tenant_id, amount_cents, remaining_cents, reason, issued_by)
     VALUES ($1::uuid,$2::uuid,$3,$3,$4,$5) RETURNING *`,
    [businessId, tenantId, amountCents, reason, userId],
  );
  await logAudit({
    tenantId,
    userId: userId ?? undefined,
    action: 'billing_credit.issued',
    resourceType: 'business',
    resourceId: businessId,
    details: { amount_cents: amountCents, reason },
  });
  return rows[0];
}

/** List a business's credits with remaining balances. */
export async function listBusinessCredits(businessId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, amount_cents, remaining_cents, reason, status, created_at
     FROM pay_business_credits WHERE business_id = $1::uuid ORDER BY created_at DESC`,
    [businessId],
  );
  return rows;
}

/** Total un-applied credit a business has (carry-forward balance). */
export async function getBusinessCreditBalance(businessId: string): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(remaining_cents),0)::int AS total FROM pay_business_credits
     WHERE business_id = $1::uuid AND status = 'active'`,
    [businessId],
  );
  return rows[0]?.total ?? 0;
}

/** Manually bill a business for a cycle (idempotent per business+cycle). */
export async function chargeBusinessNow(
  businessId: string, tenantId: string, cycle: BillingCycle, currency = 'USD',
): Promise<ChargeResult> {
  return billBusinessForCycle(businessId, tenantId, cycle, currency, MANUAL_RUN);
}

// ============================================================
// Tenant billing SCHEDULE (B6) — one per-tenant daily run.
// One sys_scheduled_jobs row at scope_level='tenant', job_type='tenant_billing'.
// ============================================================

export interface TenantScheduleView {
  enabled: boolean;
  scheduleTime: string;      // 'HH:MM'
  scheduleTimezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

/** Read a tenant's billing schedule (null if never configured). */
export async function getTenantSchedule(tenantId: string): Promise<TenantScheduleView | null> {
  const { rows } = await adminPool.query(
    `SELECT enabled, schedule_time, schedule_timezone, last_run_at, last_run_status, next_run_at
     FROM sys_scheduled_jobs
     WHERE scope_level = 'tenant' AND tenant_id = $1::uuid AND job_type = 'tenant_billing' LIMIT 1`,
    [tenantId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    enabled: r.enabled,
    scheduleTime: typeof r.schedule_time === 'string' ? r.schedule_time.slice(0, 5) : String(r.schedule_time).slice(0, 5),
    scheduleTimezone: r.schedule_timezone,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastRunStatus: r.last_run_status,
    nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
  };
}

/**
 * Create or update a tenant's billing schedule: a single daily job at the given
 * time in the given timezone (B6), scoped to this tenant. One row per tenant.
 */
export async function saveTenantSchedule(
  tenantId: string, scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<TenantScheduleView> {
  const [h, m] = scheduleTime.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  await adminPool.query(
    `INSERT INTO sys_scheduled_jobs
       (scope_level, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at)
     VALUES ('tenant', $1::uuid, 'tenant_billing', $2, $3, 'daily', $4, $5)
     ON CONFLICT (tenant_id, job_type) WHERE scope_level = 'tenant'
     DO UPDATE SET schedule_time = $2, schedule_timezone = $3, enabled = $4,
                   next_run_at = $5, updated_at = NOW()`,
    [tenantId, scheduleTime, scheduleTimezone, enabled, next.toISOString()],
  );
  return (await getTenantSchedule(tenantId))!;
}

/** Run a tenant's billing now (manual trigger of the daily run). */
export async function runTenantBillingNow(tenantId: string): Promise<BillingRunSummary> {
  return runTenantBilling(tenantId);
}

// ============================================================
// Observability (B5.3): job-run history + tenant-wide charges / failed report
// ============================================================

/**
 * A tenant's billing job runs within a date range (default: last 7 days), newest
 * first. Filtered to this tenant's scheduled job via the job's tenant scope.
 */
export async function listTenantBillingRuns(
  tenantId: string, opts: { from?: string; to?: string; limit?: number } = {},
): Promise<any[]> {
  const limit = opts.limit ?? 200;
  const from = opts.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = opts.to ?? new Date().toISOString();
  const { rows } = await adminPool.query(
    `SELECT e.id, e.started_at, e.completed_at, e.status, e.duration_ms, e.result, e.error
     FROM sys_job_executions e
     JOIN sys_scheduled_jobs j ON j.id = e.job_id
     WHERE e.job_type = 'tenant_billing' AND j.scope_level = 'tenant' AND j.tenant_id = $1::uuid
       AND e.started_at >= $2::timestamptz AND e.started_at <= $3::timestamptz
     ORDER BY e.started_at DESC
     LIMIT $4`,
    [tenantId, from, to, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    status: r.status,
    durationMs: r.duration_ms,
    summary: r.result || null,
    error: r.error || null,
  }));
}

/**
 * Tenant-wide charges across all the tenant's businesses (B5.3 + failed-charge
 * report B3.12). `status` filters (e.g. 'failed'); omit for all. Joined to the
 * business name.
 */
export async function listAllBusinessCharges(
  tenantId: string, opts: { status?: string; limit?: number } = {},
): Promise<any[]> {
  const limit = opts.limit ?? 100;
  const params: any[] = [tenantId, limit];
  let statusClause = '';
  if (opts.status) {
    params.push(opts.status);
    statusClause = `AND c.status = $3::varchar`;
  }
  const { rows } = await adminPool.query(
    `SELECT c.id, c.business_id, b.name AS business_name, c.cycle_year, c.cycle_month, c.reference_number,
            c.amount_charged_cents, c.currency, c.status, c.provider_reference, c.failure_reason,
            c.attempts, c.last_attempt_at, c.settled_at, c.created_at
     FROM pay_business_billing_charges c
     JOIN sys_businesses b ON b.id = c.business_id
     WHERE c.tenant_id = $1::uuid ${statusClause}
     ORDER BY c.created_at DESC
     LIMIT $2`,
    params,
  );
  return rows;
}

/**
 * The charge attempts made during a specific run (drill-down from a run row).
 * Reads pay_billing_charge_attempts for that execution at the tenant scope,
 * joined to the business and the charge's reference number.
 */
export async function getRunCharges(runExecutionId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT a.id, a.charge_id, a.business_id, b.name AS business_name, a.cycle_year, a.cycle_month,
            a.outcome, a.amount_cents, a.currency, a.provider_reference, a.failure_reason, a.trigger, a.created_at,
            c.reference_number
     FROM pay_billing_charge_attempts a
     JOIN sys_businesses b ON b.id = a.business_id
     LEFT JOIN pay_business_billing_charges c ON c.id = a.charge_id
     WHERE a.run_execution_id = $1 AND a.scope_level = 'tenant'
     ORDER BY a.created_at`,
    [runExecutionId],
  );
  return rows;
}

// ============================================================
// Tenant receiving/billing bank account (the tenant's own account where its
// businesses' payments are deposited). The tenant-level mirror of DayStream's
// Platform Receiving Account. Plain bank display detail, not processor secrets.
// ============================================================

export interface TenantBillingAccount {
  bank_name: string;
  account_holder: string;
  account_number: string;
  routing_number: string;
  iban: string;
  swift: string;
}

/** Read a tenant's billing bank account (null if never configured). */
export async function getTenantBillingAccount(tenantId: string): Promise<TenantBillingAccount | null> {
  const { rows } = await adminPool.query(
    `SELECT bank_name, account_holder, account_number, routing_number, iban, swift
     FROM pay_tenant_billing_accounts WHERE tenant_id = $1::uuid`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/** Create or update a tenant's billing bank account (one row per tenant). */
export async function saveTenantBillingAccount(
  tenantId: string, input: Partial<TenantBillingAccount>, userId: string | null,
): Promise<TenantBillingAccount> {
  await adminPool.query(
    `INSERT INTO pay_tenant_billing_accounts
       (tenant_id, bank_name, account_holder, account_number, routing_number, iban, swift, updated_by, updated_at)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       bank_name = $2, account_holder = $3, account_number = $4, routing_number = $5,
       iban = $6, swift = $7, updated_by = $8, updated_at = NOW()`,
    [
      tenantId, input.bank_name ?? '', input.account_holder ?? '', input.account_number ?? '',
      input.routing_number ?? '', input.iban ?? '', input.swift ?? '', userId,
    ],
  );
  return (await getTenantBillingAccount(tenantId))!;
}
