import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';
import crypto from 'crypto';

interface CreateCodeInput {
  businessId: string;
  code: string;
  discountType: string;
  discountValue: number;
  validFrom?: string;
  validTo?: string;
  maxTotalUses?: number;
  maxUsesPerCustomer?: number;
  minPurchaseAmount?: number;
  appliesToAllServices?: boolean;
  serviceIds?: string[];
  categoryIds?: string[];
  isSingleUse?: boolean;
}

/**
 * Create a discount code.
 */
export async function createCode(input: CreateCodeInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pri_discount_codes (business_id, code, discount_type, discount_value, valid_from, valid_to,
       max_total_uses, max_uses_per_customer, min_purchase_amount,
       applies_to_all_services, service_ids, category_ids, is_single_use)
     VALUES ($1, UPPER($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.businessId, input.code, input.discountType, input.discountValue,
      input.validFrom || null, input.validTo || null,
      input.maxTotalUses ?? null, input.maxUsesPerCustomer ?? 1,
      input.minPurchaseAmount ?? null,
      input.appliesToAllServices ?? true, input.serviceIds || null, input.categoryIds || null,
      input.isSingleUse ?? false,
    ],
  );
  return rows[0];
}

/**
 * List discount codes for a business.
 */
export async function getCodes(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM pri_discount_codes WHERE business_id = $1 ORDER BY created_at DESC',
    [businessId],
  );
  return rows;
}

/**
 * Validate a discount code (without redeeming it).
 */
export async function validateCode(
  code: string, businessId: string, customerId?: string, purchaseAmount?: number, serviceIds?: string[],
): Promise<{ valid: boolean; discount_type?: string; discount_value?: number; error?: string }> {
  const { rows } = await adminPool.query(
    "SELECT * FROM pri_discount_codes WHERE business_id = $1 AND UPPER(code) = UPPER($2) AND status = 'active'",
    [businessId, code],
  );

  if (rows.length === 0) return { valid: false, error: 'Code not found or inactive' };
  const dc = rows[0];

  // Date validity
  if (dc.valid_from && new Date(dc.valid_from) > new Date()) return { valid: false, error: 'Code is not yet valid' };
  if (dc.valid_to && new Date(dc.valid_to) < new Date()) return { valid: false, error: 'Code has expired' };

  // Total uses
  if (dc.max_total_uses && dc.current_uses >= dc.max_total_uses) return { valid: false, error: 'Code has reached maximum uses' };

  // Per-customer uses
  if (customerId && dc.max_uses_per_customer) {
    const { rows: usageRows } = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM pri_discount_usage WHERE code_id = $1 AND customer_id = $2',
      [dc.id, customerId],
    );
    if (usageRows[0].count >= dc.max_uses_per_customer) return { valid: false, error: 'You have already used this code' };
  }

  // Min purchase
  if (dc.min_purchase_amount && purchaseAmount && purchaseAmount < dc.min_purchase_amount) {
    return { valid: false, error: `Minimum purchase of €${(dc.min_purchase_amount / 100).toFixed(2)} required` };
  }

  // Service scope
  if (!dc.applies_to_all_services && serviceIds) {
    const codeServiceIds = dc.service_ids || [];
    if (codeServiceIds.length > 0 && !codeServiceIds.some((id: string) => serviceIds.includes(id))) {
      return { valid: false, error: 'Code does not apply to selected services' };
    }
  }

  return { valid: true, discount_type: dc.discount_type, discount_value: dc.discount_value };
}

/**
 * Record a code redemption.
 */
export async function redeemCode(
  code: string, businessId: string, customerId: string, amountSaved: number, bookingId?: string,
): Promise<boolean> {
  const { rows } = await adminPool.query(
    "SELECT id FROM pri_discount_codes WHERE business_id = $1 AND UPPER(code) = UPPER($2) AND status = 'active'",
    [businessId, code],
  );
  if (rows.length === 0) return false;

  const codeId = rows[0].id;

  // Record usage
  await adminPool.query(
    `INSERT INTO pri_discount_usage (code_id, customer_id, booking_id, amount_saved)
     VALUES ($1, $2, $3, $4)`,
    [codeId, customerId, bookingId || null, amountSaved],
  );

  // Increment counter
  await adminPool.query(
    'UPDATE pri_discount_codes SET current_uses = current_uses + 1 WHERE id = $1',
    [codeId],
  );

  return true;
}

/**
 * Bulk generate unique discount codes.
 */
export async function bulkGenerateCodes(
  businessId: string,
  count: number,
  prefix: string,
  discountType: string,
  discountValue: number,
  options?: { validTo?: string; maxUsesPerCustomer?: number; isSingleUse?: boolean },
): Promise<string[]> {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const uniquePart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `${prefix}${uniquePart}`;

    try {
      await adminPool.query(
        `INSERT INTO pri_discount_codes (business_id, code, discount_type, discount_value, valid_to, max_uses_per_customer, is_single_use, max_total_uses)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [businessId, code, discountType, discountValue, options?.validTo || null, options?.maxUsesPerCustomer ?? 1, options?.isSingleUse ?? true, 1],
      );
      codes.push(code);
    } catch {
      // Duplicate — skip and try next iteration
      i--;
    }
  }

  logger.info('Bulk codes generated', { businessId, count: codes.length, prefix });
  return codes;
}

/**
 * Update/deactivate a code.
 */
export async function updateCode(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM pri_discount_codes WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowed: Record<string, string> = {
    status: 'status', valid_to: 'valid_to', max_total_uses: 'max_total_uses', max_uses_per_customer: 'max_uses_per_customer',
  };

  for (const [key, value] of Object.entries(updates)) {
    if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(value); }
  }

  if (fields.length === 0) return existing[0];
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE pri_discount_codes SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}
