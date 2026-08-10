import { adminPool } from '../db/pool';
import { generateJournalEntries } from './order-journal.service';

interface CreateOrderInput {
  businessId: string;
  customerId?: string;
  bookingId?: string;
  checkedOutBy: string;
  creditedTo?: string;
  notes?: string;
}

interface AddItemInput {
  itemType: 'service' | 'product' | 'membership' | 'package';
  itemId?: string;
  itemName: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  taxAmount?: number;
  creditedTo?: string;
  bookingId?: string;
  notes?: string;
}

interface CompleteOrderInput {
  paymentMethod: 'cash' | 'card' | 'transfer' | 'other';
  paymentReference?: string;
  checkedOutBy: string;
}

/**
 * Create a new order (open cart).
 */
export async function createOrder(input: CreateOrderInput) {
  const { rows: numRows } = await adminPool.query(
    'SELECT generate_order_number($1) AS num', [input.businessId],
  );
  const orderNumber = numRows[0].num;

  const { rows } = await adminPool.query(
    `INSERT INTO fin_orders (business_id, customer_id, booking_id, order_number, status, checked_out_by, credited_to, notes)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7) RETURNING *`,
    [input.businessId, input.customerId || null, input.bookingId || null, orderNumber, input.checkedOutBy, input.creditedTo || null, input.notes || null],
  );
  return rows[0];
}

/**
 * Create an order pre-populated from a booking (service line item auto-added).
 */
export async function createOrderFromBooking(bookingId: string, businessId: string, checkedOutBy: string) {
  const { rows: bookings } = await adminPool.query(
    `SELECT b.*, s.name AS service_name, s.tax_category_id,
            sv.name AS variant_name, sv.price AS variant_price,
            c.id AS cust_id
     FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
     LEFT JOIN svc_variants sv ON sv.id = b.variant_id
     LEFT JOIN cus_customers c ON c.id = b.customer_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId],
  );

  if (bookings.length === 0) throw new Error('Booking not found');
  const booking = bookings[0];

  // Check if an open order already exists for this booking
  const { rows: existing } = await adminPool.query(
    `SELECT id FROM fin_orders WHERE booking_id = $1 AND status = 'open'`, [bookingId],
  );
  if (existing.length > 0) return getOrder(existing[0].id);

  const order = await createOrder({
    businessId,
    customerId: booking.cust_id || undefined,
    bookingId,
    checkedOutBy,
    creditedTo: booking.staff_id || undefined,
  });

  const price = booking.variant_price || booking.price || 0;
  await addItem(order.id, {
    itemType: 'service',
    itemId: booking.service_id,
    itemName: booking.service_name,
    variantId: booking.variant_id || undefined,
    variantName: booking.variant_name || undefined,
    quantity: 1,
    unitPrice: price,
    creditedTo: booking.staff_id || undefined,
    bookingId,
  });

  return getOrder(order.id);
}

/**
 * Add a line item to an open order.
 */
export async function addItem(orderId: string, input: AddItemInput) {
  const { rows: orderRows } = await adminPool.query(
    `SELECT id, status FROM fin_orders WHERE id = $1`, [orderId],
  );
  if (orderRows.length === 0) throw new Error('Order not found');
  if (orderRows[0].status !== 'open') throw new Error('Order is not open');

  // Prorate membership if not the 1st of the month
  let unitPrice = input.unitPrice;
  let itemNotes = input.notes || null;
  if (input.itemType === 'membership') {
    const today = new Date();
    const dayOfMonth = today.getDate();
    if (dayOfMonth > 1) {
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const remainingDays = daysInMonth - dayOfMonth + 1; // include today
      const proratedPrice = Math.round(input.unitPrice * remainingDays / daysInMonth);
      unitPrice = proratedPrice;
      itemNotes = `Prorated: ${remainingDays}/${daysInMonth} days`;
    }
  }

  // Calculate tax on the net amount (unit_price * quantity - discount)
  const grossAmount = unitPrice * input.quantity;
  const discount = input.discountAmount || 0;
  const netAmount = grossAmount - discount;

  let taxAmount = 0;
  if (input.taxAmount !== undefined) {
    taxAmount = input.taxAmount;
  } else if (input.itemId) {
    taxAmount = await calculateTaxOnAmount(input.itemType, input.itemId, netAmount);
  }

  const totalPrice = netAmount + taxAmount;

  const { rows } = await adminPool.query(
    `INSERT INTO fin_order_items (order_id, item_type, item_id, item_name, variant_id, variant_name, quantity, unit_price, discount_amount, tax_amount, total_price, credited_to, booking_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [orderId, input.itemType, input.itemId || null, input.itemName, input.variantId || null, input.variantName || null,
     input.quantity, unitPrice, discount, taxAmount, totalPrice,
     input.creditedTo || null, input.bookingId || null, itemNotes],
  );

  await recalculateOrderTotals(orderId);
  return rows[0];
}

/**
 * Update a line item.
 */
export async function updateItem(itemId: string, orderId: string, updates: Partial<AddItemInput>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE id = $1 AND order_id = $2', [itemId, orderId],
  );
  if (existing.length === 0) throw new Error('Item not found');

  const { rows: orderRows } = await adminPool.query('SELECT status FROM fin_orders WHERE id = $1', [orderId]);
  if (orderRows[0]?.status !== 'open') throw new Error('Order is not open');

  const item = existing[0];
  const quantity = updates.quantity ?? item.quantity;
  const unitPrice = updates.unitPrice ?? item.unit_price;
  const discount = updates.discountAmount ?? item.discount_amount;
  const netAmount = (unitPrice * quantity) - discount;

  // Recalculate tax on the new net amount
  let tax = item.tax_amount;
  if (updates.quantity !== undefined || updates.unitPrice !== undefined || updates.discountAmount !== undefined) {
    tax = await calculateTaxOnAmount(item.item_type, item.item_id, netAmount);
  } else if (updates.taxAmount !== undefined) {
    tax = updates.taxAmount;
  }

  const totalPrice = netAmount + tax;

  const { rows } = await adminPool.query(
    `UPDATE fin_order_items SET
       quantity = $1, unit_price = $2, discount_amount = $3, tax_amount = $4, total_price = $5,
       credited_to = $6, notes = $7
     WHERE id = $8 RETURNING *`,
    [quantity, unitPrice, discount, tax, totalPrice,
     updates.creditedTo !== undefined ? updates.creditedTo || null : item.credited_to,
     updates.notes !== undefined ? updates.notes : item.notes, itemId],
  );

  await recalculateOrderTotals(orderId);
  return rows[0];
}

/**
 * Remove a line item from an open order.
 */
export async function removeItem(itemId: string, orderId: string) {
  const { rows: orderRows } = await adminPool.query('SELECT status FROM fin_orders WHERE id = $1', [orderId]);
  if (orderRows[0]?.status !== 'open') throw new Error('Order is not open');

  const { rowCount } = await adminPool.query(
    'DELETE FROM fin_order_items WHERE id = $1 AND order_id = $2', [itemId, orderId],
  );
  if ((rowCount ?? 0) === 0) throw new Error('Item not found');

  await recalculateOrderTotals(orderId);
  return true;
}

/**
 * Complete an order (process payment).
 */
export async function completeOrder(orderId: string, businessId: string, input: CompleteOrderInput) {
  const { rows: orderRows } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2', [orderId, businessId],
  );
  if (orderRows.length === 0) throw new Error('Order not found');
  if (orderRows[0].status !== 'open') throw new Error('Order is not open');

  const { rows: items } = await adminPool.query(
    'SELECT id FROM fin_order_items WHERE order_id = $1', [orderId],
  );
  if (items.length === 0) throw new Error('Cannot complete an empty order');

  const { rows } = await adminPool.query(
    `UPDATE fin_orders SET status = 'completed', payment_method = $1, payment_reference = $2,
       checked_out_by = $3, completed_at = NOW(), updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [input.paymentMethod, input.paymentReference || null, input.checkedOutBy, orderId],
  );

  if (orderRows[0].booking_id) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'completed' WHERE id = $1 AND status IN ('checked_in', 'in_progress')`,
      [orderRows[0].booking_id],
    );
  }

  // Auto-generate journal entries for accounting
  try {
    await generateJournalEntries(orderId, businessId, input.checkedOutBy);
  } catch (err: any) {
    console.error('[Journal] Failed to generate entries:', err.message, err.stack);
    // Don't fail the order completion if journaling fails
  }

  return getOrder(orderId);
}

/**
 * Apply a promotional code to an open order.
 * Distributes discount/premium directly onto qualifying line items.
 */
export async function applyPromoCode(orderId: string, businessId: string, promoCode: string) {
  const { rows: orderRows } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2 AND status = $3', [orderId, businessId, 'open'],
  );
  if (orderRows.length === 0) throw new Error('Order not found or not open');

  // Find and validate promotion
  const { rows: promos } = await adminPool.query(
    `SELECT * FROM prm_promotions WHERE business_id = $1 AND LOWER(promo_code) = LOWER($2) AND status = 'active'`,
    [businessId, promoCode.trim()],
  );
  if (promos.length === 0) throw new Error('Invalid promotion code');
  const promo = promos[0];

  // Date validation
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (promo.date_from) {
    const fromStr = typeof promo.date_from === 'string' ? promo.date_from.split('T')[0] : promo.date_from.toISOString().slice(0, 10);
    if (today < fromStr) throw new Error('Promotion has not started yet');
  }
  if (promo.date_to) {
    const toStr = typeof promo.date_to === 'string' ? promo.date_to.split('T')[0] : promo.date_to.toISOString().slice(0, 10);
    if (today > toStr) throw new Error('Promotion has expired');
  }
  if (promo.days_of_week && promo.days_of_week.length > 0) {
    if (!promo.days_of_week.includes(now.getDay())) throw new Error('Promotion is not valid on this day of the week');
  }
  if (promo.time_from && promo.time_to) {
    const mins = now.getHours() * 60 + now.getMinutes();
    const [fh, fm] = String(promo.time_from).split(':').map(Number);
    const [th, tm] = String(promo.time_to).split(':').map(Number);
    if (mins < fh * 60 + fm || mins > th * 60 + tm) throw new Error('Promotion is not valid at this time of day');
  }
  if (promo.max_redemptions && promo.redemption_count >= promo.max_redemptions) {
    throw new Error('Promotion has reached its maximum redemptions');
  }

  // Load items and determine scope
  const { rows: items } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE order_id = $1', [orderId],
  );

  const hasServiceScope = promo.service_ids && promo.service_ids.length > 0;
  const hasVariantScope = promo.variant_ids && promo.variant_ids.length > 0;
  const hasMerchScope = promo.merchandise_ids && promo.merchandise_ids.length > 0;
  const hasAnyScope = hasServiceScope || hasMerchScope;

  // Identify qualifying items and their pre-tax amounts
  const qualifyingItems: Array<{ id: string; itemType: string; itemId: string; grossAmount: number }> = [];
  let qualifyingTotal = 0;

  for (const item of items) {
    let qualifies = false;
    if (!hasAnyScope) {
      qualifies = true;
    } else if (item.item_type === 'service' && hasServiceScope && promo.service_ids.includes(item.item_id)) {
      qualifies = hasVariantScope ? (item.variant_id ? promo.variant_ids.includes(item.variant_id) : false) : true;
    } else if (item.item_type === 'product' && hasMerchScope && promo.merchandise_ids.includes(item.item_id)) {
      qualifies = true;
    }

    if (qualifies) {
      const gross = item.unit_price * item.quantity;
      qualifyingItems.push({ id: item.id, itemType: item.item_type, itemId: item.item_id, grossAmount: gross });
      qualifyingTotal += gross;
    }
  }

  if (qualifyingTotal <= 0) throw new Error('Promotion code does not apply to items in this order');

  // Calculate total promo amount
  let promoAmount = 0;
  let isDiscount = true;

  if (promo.type === 'discount_percentage') {
    promoAmount = Math.round(qualifyingTotal * promo.value / 100);
  } else if (promo.type === 'discount_fixed') {
    promoAmount = Math.min(promo.value, qualifyingTotal);
  } else if (promo.type === 'premium_percentage') {
    promoAmount = Math.round(qualifyingTotal * promo.value / 100);
    isDiscount = false;
  } else if (promo.type === 'premium_fixed') {
    promoAmount = promo.value;
    isDiscount = false;
  } else if (promo.type === 'price_override') {
    throw new Error('Price override promotions cannot be applied as a code');
  }

  if (promoAmount <= 0) throw new Error('Promotion code does not apply to items in this order');

  // Distribute promo amount to each qualifying line item proportionally
  let distributed = 0;
  for (let i = 0; i < qualifyingItems.length; i++) {
    const qi = qualifyingItems[i];
    let itemPromo: number;

    // Last item gets the remainder to avoid rounding errors
    if (i === qualifyingItems.length - 1) {
      itemPromo = promoAmount - distributed;
    } else {
      itemPromo = Math.round(promoAmount * qi.grossAmount / qualifyingTotal);
    }
    distributed += itemPromo;

    // Calculate the new discount and net amount for this item
    const itemDiscount = isDiscount ? itemPromo : -itemPromo; // negative discount = surcharge
    const netAmount = qi.grossAmount - itemDiscount;

    // Recalculate tax on the net amount using this item's own rate
    const tax = await calculateTaxOnAmount(qi.itemType, qi.itemId, netAmount);
    const totalPrice = netAmount + tax;

    // Update the line item
    await adminPool.query(
      `UPDATE fin_order_items SET discount_amount = $1, tax_amount = $2, total_price = $3 WHERE id = $4`,
      [itemDiscount, tax, totalPrice, qi.id],
    );
  }

  // Store promo reference on order
  await adminPool.query(
    `UPDATE fin_orders SET promo_code = $1, promotion_id = $2, updated_at = NOW() WHERE id = $3`,
    [promoCode.trim(), promo.id, orderId],
  );

  // Recalculate order totals (pure sum of line items)
  await recalculateOrderTotals(orderId);
  return getOrder(orderId);
}

/**
 * Remove a promotional code from an open order.
 * Resets discounts on all line items and recalculates tax.
 */
export async function removePromoCode(orderId: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2 AND status = $3', [orderId, businessId, 'open'],
  );
  if (rows.length === 0) throw new Error('Order not found or not open');

  // Reset all line item discounts and recalculate their tax
  const { rows: items } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE order_id = $1', [orderId],
  );

  for (const item of items) {
    if (item.discount_amount !== 0) {
      const grossAmount = item.unit_price * item.quantity;
      const tax = await calculateTaxOnAmount(item.item_type, item.item_id, grossAmount);
      const totalPrice = grossAmount + tax;
      await adminPool.query(
        `UPDATE fin_order_items SET discount_amount = 0, tax_amount = $1, total_price = $2 WHERE id = $3`,
        [tax, totalPrice, item.id],
      );
    }
  }

  await adminPool.query(
    `UPDATE fin_orders SET promo_code = NULL, promotion_id = NULL, updated_at = NOW() WHERE id = $1`,
    [orderId],
  );

  await recalculateOrderTotals(orderId);
  return getOrder(orderId);
}

/**
 * Update the order-level credited_to staff member.
 */
export async function updateOrderCreditedTo(orderId: string, businessId: string, creditedTo: string | null) {
  const { rows } = await adminPool.query(
    `UPDATE fin_orders SET credited_to = $1, updated_at = NOW()
     WHERE id = $2 AND business_id = $3 AND status = 'open' RETURNING *`,
    [creditedTo, orderId, businessId],
  );
  if (rows.length === 0) throw new Error('Order not found or not open');
  return getOrder(orderId);
}

/**
 * Void an order.
 */
export async function voidOrder(orderId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `UPDATE fin_orders SET status = 'voided', updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND status = 'open' RETURNING *`,
    [orderId, businessId],
  );
  if (rows.length === 0) throw new Error('Order not found or cannot be voided');
  return rows[0];
}

/**
 * Get a single order with items.
 */
export async function getOrder(orderId: string) {
  const { rows } = await adminPool.query(
    `SELECT o.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name
     FROM fin_orders o
     LEFT JOIN cus_customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (rows.length === 0) return null;

  const { rows: items } = await adminPool.query(
    `SELECT oi.*, u.first_name AS credited_first_name, u.last_name AS credited_last_name
     FROM fin_order_items oi
     LEFT JOIN usr_users u ON u.id = oi.credited_to
     WHERE oi.order_id = $1
     ORDER BY oi.created_at`,
    [orderId],
  );

  return { ...rows[0], items };
}

/**
 * List orders for a business with filters.
 */
export async function getOrders(businessId: string, filters?: {
  status?: string; customerId?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number;
}) {
  const conditions = ['o.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.status) { conditions.push(`o.status = $${idx++}`); params.push(filters.status); }
  if (filters?.customerId) { conditions.push(`o.customer_id = $${idx++}`); params.push(filters.customerId); }
  if (filters?.dateFrom) { conditions.push(`o.created_at >= $${idx++}::date`); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push(`o.created_at < ($${idx++}::date + interval '1 day')`); params.push(filters.dateTo); }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters?.limit || 20, 100);
  const page = filters?.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT o.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              (SELECT COUNT(*)::int FROM fin_order_items WHERE order_id = o.id) AS item_count
       FROM fin_orders o
       LEFT JOIN cus_customers c ON c.id = o.customer_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM fin_orders o WHERE ${where}`, params),
  ]);

  return {
    orders: dataResult.rows,
    meta: { total: countResult.rows[0].total, page, totalPages: Math.ceil(countResult.rows[0].total / limit) },
  };
}

/**
 * Calculate tax for an item based on its tax category rate, applied to a given net amount.
 */
async function calculateTaxOnAmount(itemType: string, itemId: string | null, netAmount: number): Promise<number> {
  if (!itemId || netAmount <= 0) return 0;

  let taxCategoryId: string | null = null;

  if (itemType === 'service') {
    const { rows } = await adminPool.query('SELECT tax_category_id FROM svc_services WHERE id = $1', [itemId]);
    if (rows.length > 0) taxCategoryId = rows[0].tax_category_id;
  } else if (itemType === 'product') {
    const { rows } = await adminPool.query('SELECT tax_category_id FROM prd_merchandise WHERE id = $1', [itemId]);
    if (rows.length > 0) taxCategoryId = rows[0].tax_category_id;
  } else if (itemType === 'membership') {
    const { rows } = await adminPool.query('SELECT tax_category_id FROM mbr_plans WHERE id = $1', [itemId]);
    if (rows.length > 0) taxCategoryId = rows[0].tax_category_id;
  } else if (itemType === 'package') {
    const { rows } = await adminPool.query('SELECT tax_category_id FROM pkg_packages WHERE id = $1', [itemId]);
    if (rows.length > 0) taxCategoryId = rows[0].tax_category_id;
  }

  if (!taxCategoryId) return 0;

  const { rows: taxRows } = await adminPool.query('SELECT rate FROM svc_tax_categories WHERE id = $1', [taxCategoryId]);
  if (taxRows.length === 0) return 0;

  const rate = taxRows[0].rate; // basis points (2100 = 21%)
  return Math.round(netAmount * rate / 10000);
}

/**
 * Calculate tax for an item using unit_price * quantity (for addItem when no discount yet).
 */
export async function calculateTaxForItem(itemType: string, itemId: string | null, unitPrice: number, quantity: number): Promise<number> {
  return calculateTaxOnAmount(itemType, itemId, unitPrice * quantity);
}

/**
 * Recalculate order totals as a pure sum of line items.
 */
async function recalculateOrderTotals(orderId: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COALESCE(SUM(unit_price * quantity), 0)::int AS subtotal,
       COALESCE(SUM(tax_amount), 0)::int AS tax,
       COALESCE(SUM(discount_amount), 0)::int AS discount,
       COALESCE(SUM(total_price), 0)::int AS total
     FROM fin_order_items WHERE order_id = $1`,
    [orderId],
  );

  await adminPool.query(
    `UPDATE fin_orders SET subtotal = $1, tax_amount = $2, discount_amount = $3, total_amount = $4, updated_at = NOW()
     WHERE id = $5`,
    [rows[0].subtotal, rows[0].tax, rows[0].discount, rows[0].total, orderId],
  );
}
