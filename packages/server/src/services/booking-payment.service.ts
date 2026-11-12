import { adminPool } from '../db/pool';
import * as checkout from './checkout.service';
import { redeemPackageItem, getRemainingBalance } from './package.service';
import { getCustomerCreditBalance } from './account-credit.service';

/**
 * Payment step of New Appointment (PAY-1 = A, David 11 Nov 2026; DayStream Hub → Designs → Payment step).
 * "What is paid": the option's price; a membership that includes the service (nothing to pay) or gives a
 * member price; one session of a package the customer holds for it; a promotion or discount code; account
 * credit when it covers what is left (two methods on one booking = split payment, PAY-2, later); tax as the
 * app's checkout charges it. "How it is paid": card on file, card form, cash, bank transfer, gift card,
 * other, or pay later (nothing preselected, PAY-6).
 * The quote runs the checkout's own order logic on a scratch order that is deleted afterwards, so the
 * numbers are exactly what the order will say.
 */

export interface PayChoices {
  businessId: string;
  customerId?: string | null;
  serviceId: string;
  variantId: string;
  participants?: number;
  promoCode?: string | null;
  usePackage?: boolean;
  useCredit?: boolean;
  userId: string;
}

interface Benefits {
  membership: { name: string; access: 'included' | 'discounted'; percent: number } | null;
  pkg: { purchase_id: string; item_id: string; name: string; left: number } | null;
  credit: number;
  cards: Array<{ id: string; label: string }>;
}

async function benefits(businessId: string, customerId: string | null | undefined, serviceId: string): Promise<Benefits> {
  const out: Benefits = { membership: null, pkg: null, credit: 0, cards: [] };
  if (!customerId) return out;
  const { rows: mem } = await adminPool.query(
    `SELECT p.name, a.access_type, COALESCE(a.discount_percentage, 0) AS pct
       FROM mem_memberships m
       JOIN mem_plans p ON p.id = m.plan_id
       JOIN mem_plan_service_access a ON a.plan_id = p.id
       JOIN svc_services s ON s.id = $3
      WHERE m.customer_id = $1 AND m.business_id = $2 AND m.status = 'active'
        AND (a.service_id = s.id OR (a.service_id IS NULL AND a.category_id = s.category_id))
        AND a.access_type IN ('included', 'discounted')
      ORDER BY (a.access_type = 'included') DESC, a.discount_percentage DESC NULLS LAST LIMIT 1`,
    [customerId, businessId, serviceId],
  ).catch(() => ({ rows: [] as any[] }));
  if (mem[0]) out.membership = { name: mem[0].name, access: mem[0].access_type, percent: Number(mem[0].pct) || 0 };
  const { rows: pk } = await adminPool.query(
    `SELECT pp.id AS purchase_id, i.id AS item_id, p.name
       FROM pkg_purchases pp JOIN pkg_packages p ON p.id = pp.package_id
       JOIN pkg_package_items i ON i.package_id = p.id AND i.service_id = $3
      WHERE pp.customer_id = $1 AND pp.business_id = $2 AND pp.status = 'active' AND (pp.expires_at IS NULL OR pp.expires_at > NOW())
      ORDER BY pp.expires_at NULLS LAST, pp.purchased_at`,
    [customerId, businessId, serviceId],
  );
  for (const r of pk) {
    const bal = await getRemainingBalance(r.purchase_id, r.item_id).catch(() => null);
    if (bal && bal.unit === 'sessions' && bal.remaining > 0) { out.pkg = { purchase_id: r.purchase_id, item_id: r.item_id, name: r.name, left: bal.remaining }; break; }
  }
  out.credit = await getCustomerCreditBalance(businessId, customerId).then((x) => x.availableCents || 0).catch(() => 0);
  const { rows: cards } = await adminPool.query(
    `SELECT id, display_brand, display_last4 FROM pay_payment_methods
      WHERE owner_level = 'customer' AND customer_id = $1 AND business_id = $2 AND status = 'active' AND method_type = 'card'
      ORDER BY is_default DESC, created_at DESC`,
    [customerId, businessId],
  );
  out.cards = cards.map((c: any) => ({ id: c.id, label: `${c.display_brand || 'Card'} •••• ${c.display_last4 || ''}`.trim() }));
  return out;
}

/** Build the order lines on an open order: price, membership, package, code. Returns the lines shown. */
async function priceOrder(orderId: string, businessId: string, c: PayChoices, b: Benefits) {
  const order = await checkout.getOrder(orderId);
  const item = (order as any).items?.find((x: any) => x.item_type === 'service');
  const lines: Array<{ label: string; amount: number }> = [];
  if (!item) return { lines, total: 0 };
  const gross = item.unit_price * item.quantity;
  lines.push({ label: `${item.item_name}${item.variant_name ? ' · ' + item.variant_name : ''}${item.quantity > 1 ? ' × ' + item.quantity : ''}`, amount: gross });
  let discount = 0; const notes: string[] = [];
  if (b.membership?.access === 'included') { discount = gross; lines.push({ label: `Included in the ${b.membership.name} membership`, amount: -gross }); notes.push(`Included in ${b.membership.name}`); }
  else if (b.membership?.access === 'discounted' && b.membership.percent > 0) {
    const d = Math.round(gross * b.membership.percent / 100); discount += d;
    lines.push({ label: `${b.membership.name} member price (−${b.membership.percent}%)`, amount: -d }); notes.push(`${b.membership.name} member price`);
  }
  if (b.pkg && c.usePackage && gross - discount > 0) {
    const d = gross - discount; discount += d;
    lines.push({ label: `1 session from ${b.pkg.name} (${b.pkg.left - 1} left after)`, amount: -d }); notes.push(`Package ${b.pkg.name}`);
  }
  if (discount > 0) await checkout.updateItem(item.id, orderId, { discountAmount: discount, notes: notes.join('; ') } as any);
  let promo: { code: string; ok: boolean; message?: string } | null = null;
  if (c.promoCode && gross - discount > 0) {
    try {
      const before = (await checkout.getOrder(orderId) as any);
      await checkout.applyPromoCode(orderId, businessId, c.promoCode);
      const after = (await checkout.getOrder(orderId) as any);
      const d = (after.discount_amount || 0) - (before.discount_amount || 0);
      lines.push({ label: `Code ${c.promoCode.toUpperCase()}`, amount: -Math.max(d, 0) });
      promo = { code: c.promoCode, ok: true };
    } catch (e: any) { promo = { code: c.promoCode, ok: false, message: e?.message || 'This code is not valid.' }; }
  }
  const final = await checkout.getOrder(orderId) as any;
  if (final.tax_amount > 0) lines.push({ label: 'Tax', amount: final.tax_amount });
  return { lines, total: final.total_amount as number, promo };
}

/** The numbers of step 4, before the booking exists. */
export async function quote(c: PayChoices) {
  const b = await benefits(c.businessId, c.customerId, c.serviceId);
  const { rows: v } = await adminPool.query(
    `SELECT v.name AS variant_name, v.price, s.name AS service_name, s.booking_type, s.max_capacity
       FROM svc_variants v JOIN svc_services s ON s.id = v.service_id WHERE v.id = $1 AND s.id = $2 AND s.business_id = $3`,
    [c.variantId, c.serviceId, c.businessId],
  );
  if (!v[0]) throw Object.assign(new Error('Service or option not found'), { code: 'NOT_FOUND' });
  const qty = (v[0].booking_type === 'shared' || v[0].booking_type === 'group') ? Math.max(1, c.participants || 1) : 1;
  // a scratch order with its own reference, so no order number is used up (numbers stay without gaps)
  const { rows: scratch } = await adminPool.query(
    `INSERT INTO fin_orders (business_id, customer_id, order_number, status, checked_out_by, notes) VALUES ($1, $2, $3, 'open', $4, 'Quote (deleted)') RETURNING id`,
    [c.businessId, c.customerId || null, 'Q-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), c.userId],
  );
  const order = { id: scratch[0].id as string };
  try {
    await checkout.addItem(order.id, { itemType: 'service', itemId: c.serviceId, itemName: v[0].service_name, variantId: c.variantId, variantName: v[0].variant_name, quantity: qty, unitPrice: v[0].price } as any);
    const priced = await priceOrder(order.id, c.businessId, c, b);
    const creditUse = c.useCredit && b.credit > 0 && priced.total > 0 ? Math.min(b.credit, priced.total) : 0;
    const lines = [...priced.lines];
    if (creditUse) lines.push({ label: 'Account credit', amount: -creditUse });
    return {
      lines, total: priced.total, due: priced.total - creditUse, promo: priced.promo,
      // credit covers only part: the rest would need a second method (split payment, PAY-2, later)
      credit_needs_split: creditUse > 0 && creditUse < priced.total,
      membership: b.membership, package: b.pkg, credit: b.credit, cards: b.cards,
    };
  } finally {
    await adminPool.query('DELETE FROM fin_order_items WHERE order_id = $1', [order.id]);
    await adminPool.query('DELETE FROM fin_orders WHERE id = $1', [order.id]);
  }
}

export interface PayInput extends PayChoices {
  bookingId: string;
  method: 'onfile' | 'card' | 'cash' | 'transfer' | 'gift' | 'other' | 'later' | 'covered';
  paymentMethodId?: string | null;
  giftCardCode?: string | null;
  reference?: string | null;
  cashReceived?: number | null;
}

/**
 * Pay a booking that was just created from the window: its order (as Checkout makes it), the
 * membership / package / code applied, then the method. "card" (the card form) returns the open
 * order: the screen takes the card with the one-time charge and completes it, as Checkout does.
 */
export async function payBooking(p: PayInput) {
  if (p.method === 'later') return { status: 'unpaid' as const };
  const b = await benefits(p.businessId, p.customerId, p.serviceId);
  const order = await checkout.createOrderFromBooking(p.bookingId, p.businessId, p.userId);
  const priced = await priceOrder(order.id, p.businessId, p, b);
  if (b.pkg && p.usePackage) await redeemPackageItem({ purchaseId: b.pkg.purchase_id, packageItemId: b.pkg.item_id, quantityRedeemed: 1, bookingId: p.bookingId, notes: 'Booked with payment step' });
  const total = priced.total;
  if (total <= 0) {
    const done = await checkout.completeOrder(order.id, p.businessId, { paymentMethod: 'other' as any, paymentReference: b.membership?.access === 'included' ? `Included: ${b.membership.name}` : b.pkg && p.usePackage ? `Package: ${b.pkg.name}` : 'Nothing to pay', checkedOutBy: p.userId });
    return { status: 'paid' as const, order: done, total };
  }
  if (p.useCredit && b.credit >= total) {
    // account credit covers all of it: draw it down oldest first and record each use
    let left = total;
    const { rows: credits } = await adminPool.query(
      `SELECT id, remaining_cents FROM pay_account_credits WHERE business_id = $1 AND customer_id = $2 AND status = 'available' AND remaining_cents > 0 ORDER BY created_at`,
      [p.businessId, p.customerId],
    );
    for (const cr of credits) {
      if (left <= 0) break;
      const use = Math.min(left, cr.remaining_cents);
      await adminPool.query(`UPDATE pay_account_credits SET remaining_cents = remaining_cents - $2, status = CASE WHEN remaining_cents - $2 <= 0 THEN 'applied' ELSE status END WHERE id = $1`, [cr.id, use]);
      await adminPool.query('INSERT INTO pay_account_credit_applications (credit_id, amount_cents, applied_by) VALUES ($1, $2, $3)', [cr.id, use, p.userId]);
      left -= use;
    }
    const done = await checkout.completeOrder(order.id, p.businessId, { paymentMethod: 'other' as any, paymentReference: 'Account credit', checkedOutBy: p.userId });
    return { status: 'paid' as const, order: done, total };
  }
  if (p.method === 'card') return { status: 'card_form' as const, order_id: order.id, total };
  const map: Record<string, any> = {
    onfile: { paymentMethod: 'card', paymentMethodId: p.paymentMethodId },
    cash: { paymentMethod: 'cash', paymentReference: p.cashReceived ? `Received ${(p.cashReceived / 100).toFixed(2)}, change ${((p.cashReceived - total) / 100).toFixed(2)}` : undefined },
    transfer: { paymentMethod: 'bank_transfer', paymentReference: p.reference || undefined },
    gift: { paymentMethod: 'gift_card', giftCardCode: p.giftCardCode },
    other: { paymentMethod: 'other', paymentReference: p.reference || undefined },
  };
  const done = await checkout.completeOrder(order.id, p.businessId, { ...map[p.method], checkedOutBy: p.userId });
  return { status: 'paid' as const, order: done, total };
}
