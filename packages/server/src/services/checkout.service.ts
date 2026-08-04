import { adminPool } from '../db/pool';

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
  // Load booking with service/variant details
  const { rows: bookings } = await adminPool.query(
    `SELECT b.*, s.name AS service_name, sv.name AS variant_name, sv.price AS variant_price,
            c.id AS cust_id, c.first_name AS cust_first, c.last_name AS cust_last
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
  if (existing.length > 0) {
    return getOrder(existing[0].id);
  }

  // Create order
  const order = await createOrder({
    businessId,
    customerId: booking.cust_id || undefined,
    bookingId,
    checkedOutBy,
    creditedTo: booking.staff_id || undefined,
  });

  // Add service as first line item (credited to the assigned staff)
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
  // Verify order is open
  const { rows: orderRows } = await adminPool.query(
    `SELECT id, status FROM fin_orders WHERE id = $1`, [orderId],
  );
  if (orderRows.length === 0) throw new Error('Order not found');
  if (orderRows[0].status !== 'open') throw new Error('Order is not open');

  const totalPrice = (input.unitPrice * input.quantity) - (input.discountAmount || 0) + (input.taxAmount || 0);

  const { rows } = await adminPool.query(
    `INSERT INTO fin_order_items (order_id, item_type, item_id, item_name, variant_id, variant_name, quantity, unit_price, discount_amount, tax_amount, total_price, credited_to, booking_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [orderId, input.itemType, input.itemId || null, input.itemName, input.variantId || null, input.variantName || null,
     input.quantity, input.unitPrice, input.discountAmount || 0, input.taxAmount || 0, totalPrice,
     input.creditedTo || null, input.bookingId || null, input.notes || null],
  );

  // Recalculate order totals
  await recalculateOrderTotals(orderId);
  return rows[0];
}

/**
 * Update a line item (change quantity, price, credited_to, etc.)
 */
export async function updateItem(itemId: string, orderId: string, updates: Partial<AddItemInput>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE id = $1 AND order_id = $2', [itemId, orderId],
  );
  if (existing.length === 0) throw new Error('Item not found');

  // Verify order is open
  const { rows: orderRows } = await adminPool.query('SELECT status FROM fin_orders WHERE id = $1', [orderId]);
  if (orderRows[0]?.status !== 'open') throw new Error('Order is not open');

  const item = existing[0];
  const quantity = updates.quantity ?? item.quantity;
  const unitPrice = updates.unitPrice ?? item.unit_price;
  const discount = updates.discountAmount ?? item.discount_amount;
  const tax = updates.taxAmount ?? item.tax_amount;
  const totalPrice = (unitPrice * quantity) - discount + tax;

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

  // Check order has items
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

  // Mark associated booking as completed if present
  if (orderRows[0].booking_id) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'completed' WHERE id = $1 AND status IN ('checked_in', 'in_progress')`,
      [orderRows[0].booking_id],
    );
  }

  return getOrder(orderId);
}

/**
 * Apply a promotional code to an open order.
 */
export async function applyPromoCode(orderId: string, businessId: string, promoCode: string) {
  // Verify order is open
  const { rows: orderRows } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2 AND status = $3', [orderId, businessId, 'open'],
  );
  if (orderRows.length === 0) throw new Error('Order not found or not open');

  // Find the promotion (case-insensitive match on promo_code)
  const { rows: promos } = await adminPool.query(
    `SELECT * FROM prm_promotions WHERE business_id = $1 AND LOWER(promo_code) = LOWER($2) AND status = 'active'`,
    [businessId, promoCode.trim()],
  );
  if (promos.length === 0) throw new Error('Invalid promotion code');
  const promo = promos[0];

  // Check date validity
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

  // Check day of week validity
  if (promo.days_of_week && promo.days_of_week.length > 0) {
    const currentDay = now.getDay(); // 0=Sun, 6=Sat
    if (!promo.days_of_week.includes(currentDay)) {
      throw new Error('Promotion is not valid on this day of the week');
    }
  }

  // Check time of day validity
  if (promo.time_from && promo.time_to) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [fh, fm] = (typeof promo.time_from === 'string' ? promo.time_from : promo.time_from.toString()).split(':').map(Number);
    const [th, tm] = (typeof promo.time_to === 'string' ? promo.time_to : promo.time_to.toString()).split(':').map(Number);
    const fromMinutes = fh * 60 + fm;
    const toMinutes = th * 60 + tm;
    if (currentMinutes < fromMinutes || currentMinutes > toMinutes) {
      throw new Error('Promotion is not valid at this time of day');
    }
  }

  // Check max redemptions
  if (promo.max_redemptions && promo.redemption_count >= promo.max_redemptions) {
    throw new Error('Promotion has reached its maximum redemptions');
  }

  // Calculate discount based on qualifying line items
  const order = orderRows[0];

  // Load order items to check scope
  const { rows: items } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE order_id = $1', [orderId],
  );

  // Determine which items qualify based on applies_to scope
  let qualifyingTotal = 0;
  const qualifyingItems: string[] = [];

  for (const item of items) {
    let qualifies = false;

    // Determine if service_ids/variant_ids/merchandise_ids impose restrictions
    const hasServiceScope = promo.service_ids && promo.service_ids.length > 0;
    const hasVariantScope = promo.variant_ids && promo.variant_ids.length > 0;
    const hasMerchScope = promo.merchandise_ids && promo.merchandise_ids.length > 0;
    const hasAnyScope = hasServiceScope || hasMerchScope;

    if (!hasAnyScope) {
      // No item-level restrictions — applies to everything
      qualifies = true;
    } else {
      // Check against specific item scopes
      if (item.item_type === 'service' && hasServiceScope) {
        if (promo.service_ids.includes(item.item_id)) {
          // Service matches — now check variant if variants are scoped
          if (hasVariantScope) {
            qualifies = item.variant_id ? promo.variant_ids.includes(item.variant_id) : false;
          } else {
            qualifies = true;
          }
        }
      } else if (item.item_type === 'product' && hasMerchScope) {
        if (promo.merchandise_ids.includes(item.item_id)) {
          qualifies = true;
        }
      }
      // memberships and packages don't qualify unless explicitly in a scope list
    }

    if (qualifies) {
      qualifyingTotal += item.total_price;
      qualifyingItems.push(`${item.item_name} (${item.item_type}): ${item.total_price}`);
    }
  }

  console.log(`[Promo] Code: ${promoCode}, Type: ${promo.type}, Value: ${promo.value}`);
  console.log(`[Promo] Applies to: ${promo.applies_to}`);
  console.log(`[Promo] Service IDs: ${JSON.stringify(promo.service_ids)}`);
  console.log(`[Promo] Variant IDs: ${JSON.stringify(promo.variant_ids)}`);
  console.log(`[Promo] Merch IDs: ${JSON.stringify(promo.merchandise_ids)}`);
  console.log(`[Promo] Order subtotal: ${order.subtotal}`);
  console.log(`[Promo] Items in order:`);
  for (const item of items) {
    console.log(`[Promo]   - ${item.item_name} (${item.item_type}) item_id=${item.item_id} variant_id=${item.variant_id} total=${item.total_price}`);
  }
  console.log(`[Promo] Qualifying items total: ${qualifyingTotal}`);
  console.log(`[Promo] Qualifying items: ${qualifyingItems.join(', ') || 'none'}`);

  if (qualifyingTotal <= 0) throw new Error('Promotion code does not apply to items in this order');

  let discountAmount = 0;

  if (promo.type === 'discount_percentage') {
    // value is the percentage as a whole number (e.g., 10 = 10%)
    discountAmount = Math.round(qualifyingTotal * promo.value / 100);
    console.log(`[Promo] Percentage discount: ${promo.value}% of ${qualifyingTotal} = ${discountAmount} cents`);
  } else if (promo.type === 'discount_fixed') {
    // value is cents
    discountAmount = Math.min(promo.value, qualifyingTotal);
    console.log(`[Promo] Fixed discount: ${promo.value} cents (capped at qualifying total ${qualifyingTotal})`);
  } else if (promo.type === 'price_override') {
    throw new Error('This promotion type cannot be applied as a code');
  } else if (promo.type === 'premium_percentage' || promo.type === 'premium_fixed') {
    throw new Error('This promotion type adds a surcharge and cannot be applied as a discount code');
  }

  if (discountAmount <= 0) throw new Error('Promotion does not apply to this order');

  console.log(`[Promo] Final discount: ${discountAmount} cents applied to order ${orderId}`);

  // Apply to order
  const totalAmount = order.subtotal - discountAmount + order.tax_amount;
  await adminPool.query(
    `UPDATE fin_orders SET promo_code = $1, promotion_id = $2, discount_amount = $3, total_amount = $4, updated_at = NOW()
     WHERE id = $5`,
    [promoCode.trim(), promo.id, discountAmount, Math.max(0, totalAmount), orderId],
  );

  return getOrder(orderId);
}

/**
 * Remove a promotional code from an open order.
 */
export async function removePromoCode(orderId: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2 AND status = $3', [orderId, businessId, 'open'],
  );
  if (rows.length === 0) throw new Error('Order not found or not open');

  const order = rows[0];
  const totalAmount = order.subtotal + order.tax_amount;
  await adminPool.query(
    `UPDATE fin_orders SET promo_code = NULL, promotion_id = NULL, discount_amount = 0, total_amount = $1, updated_at = NOW()
     WHERE id = $2`,
    [totalAmount, orderId],
  );

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
 * Recalculate order totals from line items.
 */
async function recalculateOrderTotals(orderId: string) {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(unit_price * quantity), 0)::int AS subtotal,
            COALESCE(SUM(tax_amount), 0)::int AS tax,
            COALESCE(SUM(discount_amount), 0)::int AS item_discount
     FROM fin_order_items WHERE order_id = $1`,
    [orderId],
  );
  const { subtotal, tax, item_discount } = rows[0];

  // Check if a promo is applied — if so, recalculate promo discount against new subtotal
  const { rows: orderRows } = await adminPool.query(
    'SELECT promotion_id FROM fin_orders WHERE id = $1', [orderId],
  );
  let promoDiscount = 0;
  if (orderRows[0]?.promotion_id) {
    const { rows: promoRows } = await adminPool.query(
      'SELECT type, value, service_ids, variant_ids, merchandise_ids FROM prm_promotions WHERE id = $1',
      [orderRows[0].promotion_id],
    );
    if (promoRows.length > 0) {
      const promo = promoRows[0];
      // Recalculate qualifying total
      const { rows: items } = await adminPool.query(
        'SELECT item_type, item_id, variant_id, total_price FROM fin_order_items WHERE order_id = $1', [orderId],
      );
      const hasServiceScope = promo.service_ids && promo.service_ids.length > 0;
      const hasVariantScope = promo.variant_ids && promo.variant_ids.length > 0;
      const hasMerchScope = promo.merchandise_ids && promo.merchandise_ids.length > 0;
      const hasAnyScope = hasServiceScope || hasMerchScope;

      let qualifyingTotal = 0;
      for (const item of items) {
        if (!hasAnyScope) {
          qualifyingTotal += item.total_price;
        } else if (item.item_type === 'service' && hasServiceScope && promo.service_ids.includes(item.item_id)) {
          if (hasVariantScope) {
            if (item.variant_id && promo.variant_ids.includes(item.variant_id)) qualifyingTotal += item.total_price;
          } else {
            qualifyingTotal += item.total_price;
          }
        } else if (item.item_type === 'product' && hasMerchScope && promo.merchandise_ids.includes(item.item_id)) {
          qualifyingTotal += item.total_price;
        }
      }

      if (promo.type === 'discount_percentage') {
        promoDiscount = Math.round(qualifyingTotal * promo.value / 100);
      } else if (promo.type === 'discount_fixed') {
        promoDiscount = Math.min(promo.value, qualifyingTotal);
      }
    }
  }

  const totalDiscount = item_discount + promoDiscount;
  const totalAmount = subtotal + tax - totalDiscount;

  await adminPool.query(
    `UPDATE fin_orders SET subtotal = $1, tax_amount = $2, discount_amount = $3, total_amount = $4, updated_at = NOW()
     WHERE id = $5`,
    [subtotal, tax, totalDiscount, Math.max(0, totalAmount), orderId],
  );
}
