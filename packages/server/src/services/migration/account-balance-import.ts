import crypto from 'crypto';
import { adminPool } from '../../db/pool';
import { issueCreditNote } from '../credit-note.service';
import { issueImportedInvoice } from '../invoice.service';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason,
  customerMatchInput, parseDateCell, fileDateOrder, DateOrder,
} from './import-core';

/**
 * The key recorded on an imported credit or invoice (migration 167): the same customer, kind,
 * amounts, dates and description is the same balance, so re-importing the file reports it as
 * already imported instead of creating it again. Two genuinely identical balances for the same
 * customer in one file collapse to one: an accepted, conservative limitation (balances carry no
 * external reference to key on). Hashed so a long description fits the column.
 */
export function balanceImportKey(parts: {
  kind: 'credit' | 'invoice'; customerId: string; amountCents: number;
  paidCents?: number; issueDate?: string | null; dueDate?: string | null; description?: string | null;
}): string {
  const desc = (parts.description || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const raw = [parts.kind, parts.customerId, parts.amountCents, parts.paidCents ?? 0,
    parts.issueDate ?? '', parts.dueDate ?? '', desc].join('|');
  return `v1:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

/**
 * Account Balance import (spec 50, Wave 1). Brings across a customer's CURRENT
 * financial position — account credits and outstanding invoices — as real,
 * ledger-affecting records (distinct from timeline-only transaction history):
 *   - credit  → a drawable account-credit balance (via issueCreditNote)
 *   - invoice → an issued/outstanding invoice (via issueImportedInvoice, which
 *               preserves the original issue date + already-paid amount)
 *
 * Row kind is taken from a `type` field ('credit' | 'invoice'); a sensible
 * fallback infers 'credit' when only an amount is present and 'invoice' when a
 * due date is present. Customer matched by the unified rule (legacy id → email →
 * phone). Partial success: unmatched/invalid rows fail with a reason.
 */

interface MappedRow { [field: string]: string }

function parseCents(v: string): number | null {
  const cleaned = (v || '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function rowKind(r: MappedRow): 'credit' | 'invoice' | null {
  const t = (r.type || '').trim().toLowerCase();
  if (t === 'credit' || t === 'account_credit') return 'credit';
  if (t === 'invoice' || t === 'outstanding' || t === 'debit') return 'invoice';
  if (!t) {
    if ((r.due_date || '').trim()) return 'invoice';
    if ((r.amount || '').trim()) return 'credit';
  }
  return null;
}

export async function runAccountBalanceImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
  dateOrder?: DateOrder | null;
}): Promise<ImportResult> {
  const { businessId, tenantId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;
  const dateOrder = await fileDateOrder(businessId, rows, ['issue_date', 'due_date', 'date'], args.dateOrder);
  // Keys already handled in THIS file, so a duplicate row is "matched" in the trial as in the commit.
  const seen = new Set<string>();

  /** True when a balance with this key was already imported (now or earlier in this file). */
  const alreadyImported = async (table: 'pay_invoices' | 'pay_credit_notes', key: string): Promise<boolean> => {
    if (seen.has(key)) return true;
    seen.add(key);
    const { rows: hit } = await adminPool.query(
      `SELECT 1 FROM ${table} WHERE business_id = $1 AND import_key = $2 LIMIT 1`, [businessId, key],
    );
    return hit.length > 0;
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message } as RowFailure);
    };

    const kind = rowKind(r);
    if (!kind) { fail('type', 'Row is neither a credit nor an invoice (set a "type" of credit or invoice)'); continue; }

    const amountCents = parseCents(r.amount);
    if (amountCents === null || amountCents <= 0) { fail('amount', `"${r.amount}" is not a valid positive amount`); continue; }

    const matchInput = customerMatchInput(r);
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', match.conflict ?? noCustomerReason(matchInput)); continue; }

    if (kind === 'invoice') {
      const issueRaw = (r.issue_date || r.date || '').trim();
      if (!issueRaw) { fail('issue_date', 'An issue date is required for an invoice'); continue; }
      const issueDate = parseDateCell(issueRaw, dateOrder);
      if (!issueDate) { fail('issue_date', `"${issueRaw}" is not a valid date`); continue; }
      const dueRaw = (r.due_date || '').trim();
      const dueDate = dueRaw ? parseDateCell(dueRaw, dateOrder) : issueDate;
      if (!dueDate) { fail('due_date', `"${dueRaw}" is not a valid date`); continue; }
      const paidCents = parseCents(r.amount_paid || '') ?? 0;

      const importKey = balanceImportKey({
        kind, customerId: match.customerId, amountCents, paidCents, issueDate, dueDate, description: r.description,
      });
      if (await alreadyImported('pay_invoices', importKey)) { result.matched += 1; continue; }

      if (!commit) { result.imported += 1; continue; }
      try {
        await issueImportedInvoice({
          businessId, tenantId, customerId: match.customerId,
          issueDate, dueDate,
          amountPaidCents: paidCents,
          lineItems: [{ description: (r.description || 'Outstanding balance (imported)').trim(), unitPriceCents: amountCents }],
          notes: 'Imported outstanding balance', createdBy: userId, importKey,
        });
        result.imported += 1;
      } catch (e: any) {
        fail('general', e?.message || 'Failed to import invoice');
      }
    } else {
      // credit
      const importKey = balanceImportKey({ kind, customerId: match.customerId, amountCents, description: r.description });
      if (await alreadyImported('pay_credit_notes', importKey)) { result.matched += 1; continue; }

      if (!commit) { result.imported += 1; continue; }
      try {
        await issueCreditNote({
          businessId, tenantId, customerId: match.customerId,
          reason: (r.description || 'Imported account credit').trim(),
          lineItems: [{ description: (r.description || 'Imported account credit').trim(), unitPriceCents: amountCents }],
          createdBy: userId, importKey,
        });
        result.imported += 1;
      } catch (e: any) {
        fail('general', e?.message || 'Failed to import account credit');
      }
    }
  }

  return result;
}
