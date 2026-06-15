import { adminPool } from '../db/pool';

export interface TaxResult {
  subtotal: number;
  tax_amount: number;
  total: number;
  tax_rate: number;       // basis points
  display_mode: string;   // 'inclusive' or 'exclusive'
}

/**
 * Calculate tax for a given amount.
 * Supports tax-inclusive (price shown includes tax) and tax-exclusive (tax added on top).
 */
export function calculateTax(amount: number, rateBasisPoints: number, displayMode: 'inclusive' | 'exclusive'): TaxResult {
  if (rateBasisPoints <= 0) {
    return { subtotal: amount, tax_amount: 0, total: amount, tax_rate: 0, display_mode: displayMode };
  }

  if (displayMode === 'exclusive') {
    // Price shown is net; tax is added
    const taxAmount = Math.round(amount * rateBasisPoints / 10000);
    return {
      subtotal: amount,
      tax_amount: taxAmount,
      total: amount + taxAmount,
      tax_rate: rateBasisPoints,
      display_mode: 'exclusive',
    };
  }

  // Inclusive: price shown already includes tax; extract tax from total
  const total = amount;
  const subtotal = Math.round(total * 10000 / (10000 + rateBasisPoints));
  const taxAmount = total - subtotal;
  return {
    subtotal,
    tax_amount: taxAmount,
    total,
    tax_rate: rateBasisPoints,
    display_mode: 'inclusive',
  };
}

/**
 * Get the tax display mode for a business (from tenant configuration).
 */
export async function getTaxDisplayMode(businessId: string): Promise<'inclusive' | 'exclusive'> {
  // Check business_configurations for tax.display_mode
  const { rows } = await adminPool.query(
    `SELECT value FROM business_configurations WHERE business_id = $1 AND key = 'tax.display_mode'`,
    [businessId],
  );

  if (rows.length > 0) {
    return rows[0].value === 'inclusive' ? 'inclusive' : 'exclusive';
  }

  // Default to exclusive
  return 'exclusive';
}

/**
 * Get the applicable tax rate for a service variant.
 */
export async function getTaxRateForVariant(variantId: string, businessId: string): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT tc.rate FROM service_variants sv
     JOIN services s ON s.id = sv.service_id
     LEFT JOIN tax_categories tc ON tc.id = s.tax_category_id
     WHERE sv.id = $1`,
    [variantId],
  );

  if (rows.length > 0 && rows[0].rate !== null) return rows[0].rate;

  // Fallback to business default
  const { rows: defRows } = await adminPool.query(
    'SELECT rate FROM tax_categories WHERE business_id = $1 AND is_default = true', [businessId],
  );
  return defRows.length > 0 ? defRows[0].rate : 0;
}
