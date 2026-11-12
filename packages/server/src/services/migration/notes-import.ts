import { adminPool } from '../../db/pool';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason, parseDateCell,
  fileDateOrder, customerMatchInput, DateOrder,
} from './import-core';

/**
 * Notes import (spec 50, Requirement 18). Notes are a one-to-many relationship — a customer may
 * have none or hundreds — so they are their OWN import, not fields on the customer file. Each row
 * is one note; it lands on the customer Timeline (`cus_activities`, activityType 'note',
 * `imported: true`), the same home as imported appointment and transaction history. It never
 * writes the encrypted `cus_notes` store, which requires a per-business note category and
 * field-level encryption a migration file can't supply.
 *
 * Per row: customer (unified matching) + note text (required); optional date, author, category.
 * The note's `created_at` is backdated to its date when given (noon UTC for a stable calendar
 * day), else the import time. Idempotent per (customer + note date + note text): re-running the
 * same file reports matched, not duplicated. Two genuinely distinct notes sharing a customer,
 * date, and identical text collapse to one — an accepted, conservative limitation (notes carry
 * no external reference to key on). No emails.
 */

interface MappedRow { [field: string]: string }

/** Normalise note text for the idempotency key: trimmed, collapsed whitespace, lowercased. */
function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function runNotesImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
  dateOrder?: DateOrder | null;
}): Promise<ImportResult> {
  const { businessId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;

  const dateOrder = await fileDateOrder(businessId, rows, ['date'], args.dateOrder);
  // (customer|date|normalized-text) already handled in THIS file → trial matches commit.
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message } as RowFailure);
    };

    const text = (r.note || '').trim();
    if (!text) { fail('note', 'The note text is required'); continue; }

    // Date is optional; if a value is present it must parse.
    let dateStr: string | null = null;
    if ((r.date || '').trim()) {
      dateStr = parseDateCell(r.date, dateOrder);
      if (!dateStr) { fail('date', `"${r.date}" is not a valid date`); continue; }
    }

    const matchInput = customerMatchInput(r);
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', match.conflict ?? noCustomerReason(matchInput)); continue; }
    const customerId = match.customerId;

    const author = (r.author || '').trim();
    const category = (r.category || '').trim();
    const normalized = normalizeText(text);

    // Idempotency: customer + note date (or '' when undated) + normalized text.
    const key = `${customerId}|${dateStr ?? ''}|${normalized}`;
    if (seen.has(key)) { result.matched += 1; continue; }
    const { rows: existing } = await adminPool.query(
      `SELECT 1 FROM cus_activities
       WHERE business_id = $1 AND customer_id = $2 AND activity_type = 'note'
         AND metadata->>'imported' = 'true'
         AND metadata->>'note_key' = $3
       LIMIT 1`,
      [businessId, customerId, key],
    );
    seen.add(key);
    if (existing.length > 0) { result.matched += 1; continue; }

    if (!commit) { result.imported += 1; continue; }

    try {
      // Backdate to the note date at noon UTC when given; otherwise now.
      const createdAt = dateStr ? `${dateStr}T12:00:00Z` : new Date().toISOString();
      await adminPool.query(
        `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by, created_at)
         VALUES ($1,$2,'note',$3,$4,$5,$6)`,
        [customerId, businessId, text,
          JSON.stringify({
            imported: true, note_key: key, date: dateStr,
            author: author || null, category: category || null,
          }),
          userId || null, createdAt],
      );
      result.imported += 1;
    } catch (e: any) {
      fail('general', e?.message || 'Failed to import note');
    }
  }

  return result;
}
