import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface PriceCalculationInput {
  businessId: string;
  items: Array<{ variant_id: string }>;
  customerId?: string;
  discountCode?: string;
  bookingDatetime?: string;   // ISO 8601 — for time/day-based rules
}

interface DiscountApplied {
  rule_name: string;
  rule_type: string;
  discount_type: string;
  amount: number;             // cents saved
}

interface PriceBreakdown {
  base_price: number;
  discounts: DiscountApplied[];
  subtotal: number;
  tax_rate: number;           // basis points
  tax_amount: number;
  total: number;
  currency: string;
  discount_code_applied?: string;
  savings: number;
}

/**
 * Calculate final price for given items with all applicable rules.
 */
export async function calculatePrice(input: PriceCalculationInput): Promise<PriceBreakdown> {
  const { businessId, items, customerId, discountCode, bookingDatetime } = input;

  // 1. Load base prices
  const variantIds = items.map((i) => i.variant_id);
  const { rows: variants } = await adminPool.query(
    `SELECT sv.id, sv.price, sv.service_id, s.tax_category_id
     FROM svc_variants sv
     JOIN svc_services s ON s.id = sv.service_id
     WHERE sv.id = ANY($1)`,
    [variantIds],
  );

  if (variants.length === 0) {
    return emptyBreakdown();
  }

  const basePrice = variants.reduce((sum, v) => sum + v.price, 0);

  // 2. Load customer context
  let customerMembershipPlanIds: string[] = [];
  let corporateAccountId: string | null = null;
  let customerBookingCount = 0;

  if (customerId) {
    const { rows: memberships } = await adminPool.query(
      "SELECT plan_id FROM mem_memberships WHERE customer_id = $1 AND business_id = $2 AND status = 'active'",
      [customerId, businessId],
    );
    customerMembershipPlanIds = memberships.map((m) => m.plan_id);

    const { rows: corpMembers } = await adminPool.query(
      `SELECT cam.account_id FROM pri_corporate_members cam
       JOIN pri_corporate_accounts ca ON ca.id = cam.account_id
       WHERE cam.customer_id = $1 AND ca.business_id = $2 AND ca.status = 'active'`,
      [customerId, businessId],
    );
    if (corpMembers.length > 0) corporateAccountId = corpMembers[0].account_id;

    const { rows: bookingCount } = await adminPool.query(
      "SELECT COUNT(*)::int AS count FROM apt_bookings WHERE customer_id = $1 AND business_id = $2 AND status IN ('confirmed', 'completed')",
      [customerId, businessId],
    );
    customerBookingCount = bookingCount[0].count;
  }

  // 3. Load applicable rules
  const serviceIds = variants.map((v) => v.service_id);
  const { rows: rules } = await adminPool.query(
    `SELECT * FROM pri_rules
     WHERE business_id = $1 AND status = 'active'
       AND (effective_from IS NULL OR effective_from <= NOW())
       AND (effective_to IS NULL OR effective_to >= NOW())
       AND (max_redemptions IS NULL OR current_redemptions < max_redemptions)
     ORDER BY priority ASC`,
    [businessId],
  );

  // 4. Filter rules by scope and conditions
  const bookingDt = bookingDatetime ? new Date(bookingDatetime) : new Date();
  const applicableRules = rules.filter((rule) => {
    // Service scope
    if (!rule.applies_to_all_services) {
      const ruleServiceIds = rule.service_ids || [];
      const ruleCategoryIds = rule.category_ids || [];
      const ruleVariantIds = rule.variant_ids || [];
      const matchesService = ruleServiceIds.some((id: string) => serviceIds.includes(id));
      const matchesVariant = ruleVariantIds.some((id: string) => variantIds.includes(id));
      // Category check would need a join — simplified: check if any overlap
      if (!matchesService && !matchesVariant && ruleCategoryIds.length === 0) return false;
    }

    // Customer scope
    if (!rule.applies_to_all_customers) {
      if (rule.membership_plan_ids && rule.membership_plan_ids.length > 0) {
        if (!rule.membership_plan_ids.some((id: string) => customerMembershipPlanIds.includes(id))) return false;
      }
      if (rule.corporate_account_id) {
        if (rule.corporate_account_id !== corporateAccountId) return false;
      }
      if (rule.customer_segment) {
        // Simplified: skip segment check for now
      }
    }

    // Type-specific conditions
    if (rule.rule_type === 'first_time') {
      const limit = rule.first_time_booking_limit || 1;
      if (customerBookingCount >= limit) return false;
    }

    if (rule.rule_type === 'time_of_day' && rule.time_from && rule.time_to) {
      const bookingMinutes = bookingDt.getUTCHours() * 60 + bookingDt.getUTCMinutes();
      const fromMinutes = timeToMinutes(rule.time_from);
      const toMinutes = timeToMinutes(rule.time_to);
      if (bookingMinutes < fromMinutes || bookingMinutes >= toMinutes) return false;
    }

    if (rule.rule_type === 'day_of_week' && rule.days_of_week) {
      if (!rule.days_of_week.includes(bookingDt.getUTCDay())) return false;
    }

    if (rule.rule_type === 'membership') {
      if (customerMembershipPlanIds.length === 0) return false;
    }

    if (rule.rule_type === 'corporate') {
      if (!corporateAccountId) return false;
    }

    if (rule.rule_type === 'volume') {
      if (items.length < 2) return false; // volume = multi-item
    }

    return true;
  });

  // 5. Evaluate stacking
  const discounts: DiscountApplied[] = [];
  let totalDiscount = 0;

  const exclusiveRules = applicableRules.filter((r) => r.stacking_mode === 'exclusive');
  const stackableRules = applicableRules.filter((r) => r.stacking_mode === 'stackable');
  const nonStackableRules = applicableRules.filter((r) => r.stacking_mode === 'non_stackable');

  if (exclusiveRules.length > 0) {
    // Use best exclusive rule only
    let bestExclusive = exclusiveRules[0];
    let bestAmount = calculateDiscountAmount(bestExclusive, basePrice);
    for (const rule of exclusiveRules.slice(1)) {
      const amount = calculateDiscountAmount(rule, basePrice);
      if (amount > bestAmount) { bestExclusive = rule; bestAmount = amount; }
    }
    discounts.push({ rule_name: bestExclusive.name, rule_type: bestExclusive.rule_type, discount_type: bestExclusive.discount_type, amount: bestAmount });
    totalDiscount = bestAmount;
  } else {
    // Apply non-stackable (one per type)
    const appliedTypes = new Set<string>();
    for (const rule of nonStackableRules) {
      if (appliedTypes.has(rule.rule_type)) continue;
      const amount = calculateDiscountAmount(rule, basePrice);
      discounts.push({ rule_name: rule.name, rule_type: rule.rule_type, discount_type: rule.discount_type, amount });
      totalDiscount += amount;
      appliedTypes.add(rule.rule_type);
    }

    // Apply stackable
    for (const rule of stackableRules) {
      const amount = calculateDiscountAmount(rule, basePrice - totalDiscount);
      discounts.push({ rule_name: rule.name, rule_type: rule.rule_type, discount_type: rule.discount_type, amount });
      totalDiscount += amount;
    }
  }

  // 6. Apply discount code
  let discountCodeApplied: string | undefined;
  if (discountCode) {
    const codeDiscount = await applyDiscountCode(discountCode, businessId, customerId, basePrice - totalDiscount, serviceIds);
    if (codeDiscount > 0) {
      discounts.push({ rule_name: `Code: ${discountCode}`, rule_type: 'discount_code', discount_type: 'code', amount: codeDiscount });
      totalDiscount += codeDiscount;
      discountCodeApplied = discountCode;
    }
  }

  // 7. Enforce max discount and min price
  const maxDiscountPct = 50; // TODO: load from tenant config
  const minPriceFloor = 0;   // TODO: load from tenant config
  const maxDiscountAmount = Math.round(basePrice * maxDiscountPct / 100);
  if (totalDiscount > maxDiscountAmount) totalDiscount = maxDiscountAmount;

  let subtotal = basePrice - totalDiscount;
  if (subtotal < minPriceFloor) subtotal = minPriceFloor;

  // 8. Calculate tax
  const taxRate = await getTaxRate(variants[0]?.tax_category_id, businessId);
  const taxAmount = Math.round(subtotal * taxRate / 10000);
  const total = subtotal + taxAmount;

  return {
    base_price: basePrice,
    discounts,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    currency: 'EUR', // TODO: load from tenant config
    discount_code_applied: discountCodeApplied,
    savings: totalDiscount,
  };
}

// --- Helpers ---

function calculateDiscountAmount(rule: any, currentPrice: number): number {
  if (rule.discount_type === 'percentage') {
    return Math.round(currentPrice * rule.discount_value / 100);
  }
  return Math.min(rule.discount_value, currentPrice);
}

async function applyDiscountCode(code: string, businessId: string, customerId: string | undefined, currentPrice: number, serviceIds: string[]): Promise<number> {
  const { rows } = await adminPool.query(
    "SELECT * FROM pri_discount_codes WHERE business_id = $1 AND UPPER(code) = UPPER($2) AND status = 'active'",
    [businessId, code],
  );

  if (rows.length === 0) return 0;
  const dc = rows[0];

  // Date validity
  if (dc.valid_from && new Date(dc.valid_from) > new Date()) return 0;
  if (dc.valid_to && new Date(dc.valid_to) < new Date()) return 0;

  // Usage limits
  if (dc.max_total_uses && dc.current_uses >= dc.max_total_uses) return 0;

  // Per-customer check
  if (customerId && dc.max_uses_per_customer) {
    const { rows: usageRows } = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM pri_discount_usage WHERE code_id = $1 AND customer_id = $2',
      [dc.id, customerId],
    );
    if (usageRows[0].count >= dc.max_uses_per_customer) return 0;
  }

  // Min purchase
  if (dc.min_purchase_amount && currentPrice < dc.min_purchase_amount) return 0;

  // Service scope
  if (!dc.applies_to_all_services) {
    const codeServiceIds = dc.service_ids || [];
    if (codeServiceIds.length > 0 && !codeServiceIds.some((id: string) => serviceIds.includes(id))) return 0;
  }

  // Calculate discount
  if (dc.discount_type === 'percentage') {
    return Math.round(currentPrice * dc.discount_value / 100);
  }
  return Math.min(dc.discount_value, currentPrice);
}

async function getTaxRate(taxCategoryId: string | null, businessId: string): Promise<number> {
  if (taxCategoryId) {
    const { rows } = await adminPool.query('SELECT rate FROM tax_categories WHERE id = $1', [taxCategoryId]);
    if (rows.length > 0) return rows[0].rate;
  }
  // Fall back to default tax category
  const { rows } = await adminPool.query(
    'SELECT rate FROM tax_categories WHERE business_id = $1 AND is_default = true', [businessId],
  );
  return rows.length > 0 ? rows[0].rate : 0;
}

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function emptyBreakdown(): PriceBreakdown {
  return { base_price: 0, discounts: [], subtotal: 0, tax_rate: 0, tax_amount: 0, total: 0, currency: 'EUR', savings: 0 };
}
