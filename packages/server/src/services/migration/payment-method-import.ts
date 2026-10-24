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

    const match = await matchCustomer(businessId, {
      legacyCustomerId: r.legacy_customer_id, email: r.email, phone: r.phone,
    });
    if (!match.customerId) { fail('customer', noCustomerReason(r)); continue; }

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
      const expMonth = parseInt((r.exp_month || '').trim(), 10);
      const expYear = parseInt((r.exp_year || '').trim(), 10);
      await adminPool.query(
        `INSERT INTO pay_payment_methods
           (tenant_id, owner_level, business_id, customer_id, method_type, provider,
            provider_token, display_brand, display_last4, exp_month, exp_year, is_default)
         VALUES ($1,'customer',$2,$3,'card','stripe',$4,$5,$6,$7,$8,$9)`,
        [
          tenantId, businessId, match.customerId, token,
          (r.brand || r.display_brand || null) || null,
          (r.last4 || r.display_last4 || null) || null,
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
