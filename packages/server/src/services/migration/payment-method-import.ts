import { adminPool } from '../../db/pool';
import { ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason } from './import-core';

/**
 * Payment Method import (spec 50, Wave 1) — the processor Mapping File.
 *
 * Stripe runs the actual card migration (moving vaulted cards onto the business's
 * DayStream Stripe account, attached to Stripe Customer objects) and returns a
 * Mapping File: legacy customer id → migrated Stripe Customer id + payment-method
 * token (+ brand/last4/exp). This import consumes that file; it never handles raw
 * card data.
 *
 * Per row it: matches the DayStream customer (legacy id preferred — the Mapping
 * File carries it — else email/phone); records the migrated Stripe Customer id in
 * `pay_customer_refs` (which off-session charging requires, per migration 119);
 * and stores the token in `pay_payment_methods`. First method per customer → default.
 * No emails. Idempotent: re-importing the same token updates rather than duplicates.
 */

interface MappedRow { [field: string]: string }

export type ImportedMethodType = 'card' | 'bank_draw';

const BANK_WORDS = ['sepa', 'bacs', 'bank', 'direct debit', 'us_bank_account', 'iban'];
const looksBank = (s: string) => BANK_WORDS.some((w) => s.includes(w)) || /\bach\b/.test(s); // "ach" only as a whole word
const CARD_WORDS = ['card', 'credit', 'debit card', 'visa', 'mastercard', 'amex', 'american express', 'discover', 'maestro'];

/**
 * Work out whether a row is a card or a bank-account (SEPA / ACH / Bacs direct debit) method.
 * Uses the explicit method-type value first, then the brand text ("SEPA Direct Debit"), else card
 * (the default for a mapping file with no type column). An unrecognised explicit type is an error
 * rather than a silent guess, so a bank account is never stored as a card.
 */
export function resolveMethodType(r: { method_type?: string; brand?: string; display_brand?: string }):
  { type: ImportedMethodType; scheme: 'SEPA' | 'ACH' | 'Bacs' | null } | { error: string } {
  const explicit = (r.method_type || '').trim().toLowerCase();
  const brand = (r.brand || r.display_brand || '').trim().toLowerCase();
  const schemeOf = (s: string): 'SEPA' | 'ACH' | 'Bacs' | null =>
    s.includes('sepa') || s.includes('iban') ? 'SEPA' : /\bach\b/.test(s) || s.includes('us_bank') ? 'ACH' : s.includes('bacs') ? 'Bacs' : null;

  if (explicit) {
    if (looksBank(explicit)) return { type: 'bank_draw', scheme: schemeOf(explicit) ?? schemeOf(brand) };
    if (CARD_WORDS.some((w) => explicit.includes(w))) return { type: 'card', scheme: null };
    return { error: `"${r.method_type!.trim()}" isn't a method type I recognise. Use Card, or a bank account type such as SEPA, ACH or Bacs` };
  }
  if (looksBank(brand)) return { type: 'bank_draw', scheme: schemeOf(brand) };
  return { type: 'card', scheme: null };
}

/**
 * Card expiry from either separate month/year columns or one combined column ("09/28", "9/2028").
 * Two-digit years are 20xx. Out-of-range values come back null rather than being stored wrong.
 */
export function parseExpiry(r: { exp_month?: string; exp_year?: string; expiry?: string }): { month: number | null; year: number | null } {
  let month = parseInt((r.exp_month || '').trim(), 10);
  let year = parseInt((r.exp_year || '').trim(), 10);
  const combined = (r.expiry || '').trim().match(/^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/);
  if (combined) {
    if (!isFinite(month)) month = parseInt(combined[1], 10);
    if (!isFinite(year)) year = parseInt(combined[2], 10);
  }
  if (isFinite(year) && year < 100) year += 2000;
  return {
    month: isFinite(month) && month >= 1 && month <= 12 ? month : null,
    year: isFinite(year) && year >= 2000 && year <= 2100 ? year : null,
  };
}

const SCHEME_LABEL: Record<string, string> = { SEPA: 'SEPA Direct Debit', ACH: 'ACH Direct Debit', Bacs: 'Bacs Direct Debit' };

export async function runPaymentMethodImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
}): Promise<ImportResult> {
  const { businessId, tenantId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message } as RowFailure);
    };

    const token = (r.payment_method_token || r.token || r.payment_method_id || '').trim();
    const stripeCustomerId = (r.stripe_customer_id || r.provider_customer_id || r.customer_ref || '').trim();
    if (!token) { fail('payment_method_token', 'Missing migrated payment-method token'); continue; }
    if (!stripeCustomerId) { fail('stripe_customer_id', 'Missing migrated Stripe Customer id (required so the method can be charged off-session)'); continue; }

    const kindInfo = resolveMethodType(r);
    if ('error' in kindInfo) { fail('method_type', kindInfo.error); continue; }

    // Processor ids first: the previous processor's id (Stripe processor import), then the Stripe
    // customer id itself (a Stripe-to-Stripe copy keeps customer ids unchanged).
    const matchInput = {
      processorCustomerIds: [r.previous_processor_customer_id, stripeCustomerId],
      legacyCustomerId: r.legacy_customer_id, email: r.email, phone: r.phone,
    };
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', match.conflict ?? noCustomerReason(matchInput)); continue; }

    // Idempotency: is this token already stored for this customer?
    const existing = await adminPool.query(
      `SELECT 1 FROM pay_payment_methods
       WHERE business_id = $1 AND customer_id = $2 AND provider_token = $3 AND status = 'active' LIMIT 1`,
      [businessId, match.customerId, token],
    );
    if (existing.rows.length > 0) { result.matched += 1; continue; }

    if (!commit) { result.imported += 1; continue; }

    try {
      // 1. Record the migrated Stripe Customer id for this DayStream customer so
      //    off-session charges (e.g. membership renewals) resolve the attached
      //    Customer. One provider customer per owner (unique index handles upsert).
      await adminPool.query(
        `INSERT INTO pay_customer_refs
           (owner_level, tenant_id, business_id, customer_id, provider, provider_customer_id)
         VALUES ('customer', $1, $2, $3, 'stripe', $4)
         ON CONFLICT (owner_level, provider,
            COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
            COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid),
            COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET provider_customer_id = EXCLUDED.provider_customer_id, updated_at = NOW()`,
        [tenantId, businessId, match.customerId, stripeCustomerId],
      );

      // 2. First active method for this customer becomes default.
      const { rows: countRows } = await adminPool.query(
        `SELECT COUNT(*)::int AS n FROM pay_payment_methods
         WHERE owner_level = 'customer' AND business_id = $1 AND customer_id = $2 AND status = 'active'`,
        [businessId, match.customerId],
      );
      const explicitDefault = ['1', 'true', 'yes', 'default'].includes((r.is_default || '').trim().toLowerCase());
      const isDefault = countRows[0].n === 0 || explicitDefault;
      if (isDefault) {
        await adminPool.query(
          `UPDATE pay_payment_methods SET is_default = false, updated_at = NOW()
           WHERE owner_level = 'customer' AND business_id = $1 AND customer_id = $2 AND is_default = true`,
          [businessId, match.customerId],
        );
      }

      // 3. Store the migrated token + masked display.
      // Bank accounts have no expiry; their display brand is the scheme ("SEPA Direct Debit").
      const isBank = kindInfo.type === 'bank_draw';
      const exp = isBank ? { month: null, year: null } : parseExpiry(r);
      const expMonth = exp.month ?? NaN;
      const expYear = exp.year ?? NaN;
      const rawBrand = (r.brand || r.display_brand || '').trim();
      const brand = isBank
        ? (kindInfo.scheme ? SCHEME_LABEL[kindInfo.scheme] : (rawBrand || 'Bank account'))
        : (rawBrand || null);
      // Keep digits only ("**** 4242" → 4242); the column holds 4 characters.
      const last4 = (r.last4 || r.display_last4 || '').replace(/\D/g, '').slice(-4) || null;
      await adminPool.query(
        `INSERT INTO pay_payment_methods
           (tenant_id, owner_level, business_id, customer_id, method_type, provider,
            provider_token, display_brand, display_last4, exp_month, exp_year, is_default)
         VALUES ($1,'customer',$2,$3,$4,'stripe',$5,$6,$7,$8,$9,$10)`,
        [
          tenantId, businessId, match.customerId, kindInfo.type, token, brand, last4,
          isFinite(expMonth) ? expMonth : null,
          isFinite(expYear) ? expYear : null,
          isDefault,
        ],
      );
      result.imported += 1;
    } catch (e: any) {
      result.failed += 1;
      result.failures.push({ row: rowNum, field: 'general', message: e?.message || 'Failed to import payment method' });
    }
  }

  return result;
}
