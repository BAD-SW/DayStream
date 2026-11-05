import { adminPool } from '../../db/pool';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason, parseDateCell,
} from './import-core';

/**
 * Transaction History import (spec 50, Wave 3). This is HISTORY, not accounting. Each row
 * becomes a `cus_activities` timeline entry (activityType 'payment', `imported: true` in
 * metadata) ONLY — it NEVER writes `pay_transactions`, the general ledger, revenue
 * recognition, or any reporting table. That separation is the whole point: a business can
 * see a customer's past payments on the timeline without those payments being double-counted
 * as new revenue in DayStream's books (the real opening financial position comes in through
 * Account Balance import instead).
 *
 * Per row: customer (unified matching) + date + amount (stored as integer cents) + description,
 * with optional method and external reference. The activity's `created_at` is backdated to the
 * transaction date so the timeline is chronological. Idempotent per
 * (customer + date + amount + external reference). No emails.
 */

interface MappedRow { [field: string]: string }

/** Parse a money string ("€12.50", "-4,00", "1200") to integer cents, or null. */
function parseCents(v: string | null | undefined): number | null {
  const cleaned = (v || '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function runTransactionImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
}): Promise<ImportResult> {
  const { businessId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;

  // (customer|date|cents|reference) already handled in THIS file → trial matches commit.
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message } as RowFailure);
    };

    const dateStr = parseDateCell(r.date);
    if (!dateStr) {
      fail('date', (r.date || '').trim() ? `"${r.date}" is not a valid date` : 'A transaction date is required');
      continue;
    }

    const cents = parseCents(r.amount);
    if (cents === null) {
      fail('amount', (r.amount || '').trim() ? `"${r.amount}" is not a valid amount` : 'A transaction amount is required');
      continue;
    }

    const match = await matchCustomer(businessId, {
      legacyCustomerId: r.legacy_customer_id, email: r.email, phone: r.phone,
    });
    if (!match.customerId) { fail('customer', noCustomerReason(r)); continue; }
    const customerId = match.customerId;

    const reference = (r.reference || '').trim();
    const method = (r.method || '').trim();
    const description = (r.description || '').trim();

    // Idempotency: customer + calendar date + amount + external reference.
    const key = `${customerId}|${dateStr}|${cents}|${reference}`;
    if (seen.has(key)) { result.matched += 1; continue; }
    const { rows: existing } = await adminPool.query(
      `SELECT 1 FROM cus_activities
       WHERE business_id = $1 AND customer_id = $2 AND activity_type = 'payment'
         AND metadata->>'imported' = 'true'
         AND (metadata->>'amount_cents')::int = $3
         AND metadata->>'date' = $4
         AND COALESCE(metadata->>'reference','') = $5
       LIMIT 1`,
      [businessId, customerId, cents, dateStr, reference],
    );
    seen.add(key);
    if (existing.length > 0) { result.matched += 1; continue; }

    if (!commit) { result.imported += 1; continue; }

    try {
      const amountStr = (cents / 100).toFixed(2);
      const desc = description
        || `Payment of ${amountStr}${method ? ` (${method})` : ''}${reference ? ` · ${reference}` : ''}`;
      // Backdate created_at to the transaction date (noon UTC for a stable calendar date).
      await adminPool.query(
        `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by, created_at)
         VALUES ($1,$2,'payment',$3,$4,$5,$6)`,
        [customerId, businessId, desc,
          JSON.stringify({
            imported: true, amount_cents: cents, date: dateStr,
            method: method || null, reference: reference || null,
          }),
          userId || null, `${dateStr}T12:00:00Z`],
      );
      result.imported += 1;
    } catch (e: any) {
      fail('general', e?.message || 'Failed to import transaction');
    }
  }

  return result;
}
