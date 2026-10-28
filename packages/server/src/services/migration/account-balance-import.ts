import { issueCreditNote } from '../credit-note.service';
import { issueImportedInvoice } from '../invoice.service';
import { ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason } from './import-core';

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
}): Promise<ImportResult> {
  const { businessId, tenantId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;

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

    const match = await matchCustomer(businessId, {
      legacyCustomerId: r.legacy_customer_id, email: r.email, phone: r.phone,
    });
    if (!match.customerId) { fail('customer', noCustomerReason(r)); continue; }

    if (kind === 'invoice') {
      const issueDate = (r.issue_date || r.date || '').trim();
      const dueDate = (r.due_date || issueDate || '').trim();
      if (!issueDate) { fail('issue_date', 'An issue date is required for an invoice'); continue; }
      if (isNaN(new Date(issueDate).getTime())) { fail('issue_date', `"${issueDate}" is not a valid date`); continue; }
      const paidCents = parseCents(r.amount_paid || '') ?? 0;

      if (!commit) { result.imported += 1; continue; }
      try {
        await issueImportedInvoice({
          businessId, tenantId, customerId: match.customerId,
          issueDate, dueDate,
          amountPaidCents: paidCents,
          lineItems: [{ description: (r.description || 'Outstanding balance (imported)').trim(), unitPriceCents: amountCents }],
          notes: 'Imported outstanding balance', createdBy: userId,
        });
        result.imported += 1;
      } catch (e: any) {
        fail('general', e?.message || 'Failed to import invoice');
      }
    } else {
      // credit
      if (!commit) { result.imported += 1; continue; }
      try {
        await issueCreditNote({
          businessId, tenantId, customerId: match.customerId,
          reason: (r.description || 'Imported account credit').trim(),
          lineItems: [{ description: (r.description || 'Imported account credit').trim(), unitPriceCents: amountCents }],
          createdBy: userId,
        });
        result.imported += 1;
      } catch (e: any) {
        fail('general', e?.message || 'Failed to import account credit');
      }
    }
  }

  return result;
}
