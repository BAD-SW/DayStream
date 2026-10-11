import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Section C — Vouchers (spec 10-payment-platform, task 4.8 / Requirement C8).
 *
 * Business-scoped discount codes tied to specific services/categories: free
 * service, fixed discount, or percentage discount. Vouchers integrate with the
 * Pricing Engine by producing a discount the checkout folds into the
 * Price_Breakdown (C8.7) — this service validates eligibility and computes the
 * discount; the checkout/pricing flow applies it. Single-use and multi-use
 * supported, with expiry and eligibility checks at redemption.
 *
 * `discount_value` semantics (per migration 127): fixed → cents; percentage →
 * basis points (e.g. 1500 = 15%). `free` ignores the value (full amount off).
 */

class VoucherError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'VoucherError';
    this.code = code;
  }
}

type DiscountType = 'free' | 'fixed' | 'percentage';

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `V-${pick(4)}-${pick(4)}`;
}

export interface CreateVoucherInput {
  businessId: string;
  tenantId: string;
  discountType: DiscountType;
  discountValue?: number | null;      // cents (fixed) or basis points (percentage); ignored for 'free'
  appliesTo?: { serviceIds?: string[]; categoryIds?: string[] } | null;  // null => everything
  singleUse?: boolean;
  maxRedemptions?: number | null;
  expiresAt?: string | null;          // YYYY-MM-DD
  createdBy: string;
}

export async function createVoucher(input: CreateVoucherInput): Promise<any> {
  if (!['free', 'fixed', 'percentage'].includes(input.discountType)) {
    throw new VoucherError('Invalid discount type', 'INVALID_TYPE');
  }
  if (input.discountType !== 'free' && (input.discountValue == null || input.discountValue <= 0)) {
    throw new VoucherError('A positive discount value is required for fixed/percentage vouchers', 'INVALID_VALUE');
  }
  if (input.discountType === 'percentage' && (input.discountValue ?? 0) > 10000) {
    throw new VoucherError('Percentage discount cannot exceed 100% (10000 basis points)', 'INVALID_VALUE');
  }

  let voucher: any = null;
  for (let attempt = 0; attempt < 5 && !voucher; attempt++) {
    const code = generateCode();
    try {
      const { rows } = await adminPool.query(
        `INSERT INTO pay_vouchers
           (tenant_id, business_id, code, discount_type, discount_value, applies_to,
            single_use, max_redemptions, redemption_count, expires_at, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'active',$10)
         RETURNING *`,
        [
          input.tenantId, input.businessId, code, input.discountType,
          input.discountType === 'free' ? null : input.discountValue,
          input.appliesTo ? JSON.stringify(input.appliesTo) : null,
          input.singleUse ?? true, input.maxRedemptions ?? null, input.expiresAt ?? null, input.createdBy,
        ],
      );
      voucher = rows[0];
    } catch (e: any) {
      if (e?.code === '23505') continue;  // unique code collision — retry
      throw e;
    }
  }
  if (!voucher) throw new VoucherError('Could not allocate a unique voucher code', 'CODE_ALLOCATION_FAILED');

  await logAudit({
    tenantId: input.tenantId, userId: input.createdBy, action: 'voucher.created',
    resourceType: 'voucher', resourceId: voucher.id,
    details: { code: voucher.code, discount_type: input.discountType, discount_value: input.discountValue ?? null },
  }).catch(() => {});

  return voucher;
}

export async function listVouchers(businessId: string, filters: { status?: string } = {}): Promise<any[]> {
  const conditions = ['business_id = $1'];
  const params: any[] = [businessId];
  if (filters.status) { conditions.push(`status = $2`); params.push(filters.status); }
  const { rows } = await adminPool.query(
    `SELECT * FROM pay_vouchers WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function getVoucher(id: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT * FROM pay_vouchers WHERE id = $1 AND business_id = $2`, [id, businessId],
  );
  return rows[0] || null;
}

export interface VoucherValidation {
  valid: boolean;
  reason?: string;
  voucherId?: string;
  code?: string;
  discountType?: DiscountType;
  discountCents?: number;   // the discount to apply to the provided amount
}

/**
 * Validate a voucher for a prospective redemption and compute its discount against
 * the supplied amount. Does NOT consume the voucher — call `redeemVoucher` once the
 * sale completes. The returned `discountCents` is what the checkout folds into the
 * Price_Breakdown (C8.7).
 */
export async function validateVoucher(input: {
  code: string; businessId: string; serviceId?: string | null; categoryId?: string | null; amountCents: number;
}): Promise<VoucherValidation> {
  const { rows } = await adminPool.query(
    `SELECT * FROM pay_vouchers WHERE code = $1 AND business_id = $2`,
    [input.code.trim(), input.businessId],
  );
  const v = rows[0];
  if (!v) return { valid: false, reason: 'Voucher not found' };
  if (v.status !== 'active') return { valid: false, reason: `Voucher is ${v.status}` };
  if (v.expires_at && new Date(v.expires_at) < new Date()) return { valid: false, reason: 'Voucher has expired' };

  // Usage limits (C8.4).
  if (v.single_use && v.redemption_count >= 1) return { valid: false, reason: 'Voucher has already been used' };
  if (v.max_redemptions != null && v.redemption_count >= v.max_redemptions) {
    return { valid: false, reason: 'Voucher has reached its redemption limit' };
  }

  // Eligibility: when scoped, the item must match a listed service or category (C8.1/C8.6).
  const appliesTo = v.applies_to as { serviceIds?: string[]; categoryIds?: string[] } | null;
  if (appliesTo && (appliesTo.serviceIds?.length || appliesTo.categoryIds?.length)) {
    const serviceOk = !!input.serviceId && (appliesTo.serviceIds || []).includes(input.serviceId);
    const categoryOk = !!input.categoryId && (appliesTo.categoryIds || []).includes(input.categoryId);
    if (!serviceOk && !categoryOk) return { valid: false, reason: 'Voucher does not apply to this item' };
  }

  if (input.amountCents <= 0) return { valid: false, reason: 'Nothing to discount' };

  // Compute the discount, clamped to the amount.
  let discountCents: number;
  switch (v.discount_type as DiscountType) {
    case 'free':
      discountCents = input.amountCents;
      break;
    case 'fixed':
      discountCents = Math.min(v.discount_value, input.amountCents);
      break;
    case 'percentage':
      discountCents = Math.min(Math.round((input.amountCents * v.discount_value) / 10000), input.amountCents);
      break;
    default:
      return { valid: false, reason: 'Unsupported discount type' };
  }

  return {
    valid: true,
    voucherId: v.id,
    code: v.code,
    discountType: v.discount_type,
    discountCents,
  };
}

/**
 * Consume a voucher after a successful sale. Increments the redemption count and
 * expires it when single-use or the max is reached. Audited (C8.8).
 */
export async function redeemVoucher(voucherId: string, businessId: string, tenantId: string, userId: string): Promise<boolean> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM pay_vouchers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [voucherId, businessId],
    );
    const v = rows[0];
    if (!v || v.status !== 'active') { await client.query('ROLLBACK'); return false; }
    if (v.single_use && v.redemption_count >= 1) { await client.query('ROLLBACK'); return false; }
    if (v.max_redemptions != null && v.redemption_count >= v.max_redemptions) { await client.query('ROLLBACK'); return false; }

    const newCount = v.redemption_count + 1;
    const exhausted = v.single_use || (v.max_redemptions != null && newCount >= v.max_redemptions);
    await client.query(
      `UPDATE pay_vouchers SET redemption_count = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [voucherId, newCount, exhausted ? 'void' : 'active'],
    );
    await client.query('COMMIT');

    await logAudit({
      tenantId, userId, action: 'voucher.redeemed', resourceType: 'voucher', resourceId: voucherId,
      details: { code: v.code, redemption_count: newCount, exhausted },
    }).catch(() => {});
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function voidVoucher(id: string, businessId: string, tenantId: string, userId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `UPDATE pay_vouchers SET status = 'void', updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND status = 'active' RETURNING code`,
    [id, businessId],
  );
  if (rows.length === 0) return false;
  await logAudit({
    tenantId, userId, action: 'voucher.voided', resourceType: 'voucher', resourceId: id,
    details: { code: rows[0].code },
  }).catch(() => {});
  return true;
}

export { VoucherError };
