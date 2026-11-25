import { adminPool } from '../db/pool';
import * as checkout from './checkout.service';
import { getCustomerCreditBalance } from './account-credit.service';
import { optionFor, setBookingBenefit, bookingBenefit, BenefitError, benefitOptions } from './benefits.service';
import type { BenefitRef, BenefitOption } from './benefits.service';
import { msg } from '../i18n';

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
  /** The membership or package that pays (spec 51, gap 19); null or absent: paid normally. */
  benefit?: BenefitRef | null;
  /** When it is booked for (a membership's allowance window). */
  startTime?: string | null;
  /** An existing booking (its own hold is not counted against it). */
  bookingId?: string | null;
  useCredit?: boolean;
  userId: string;
  /** The add-ons chosen (svc_addons ids) (spec 51, gap 15). */
  addons?: string[];
}

interface Benefits {
  credit: number;
  cards: Array<{ id: string; label: string }>;
  /** the customer's saved bank accounts (SEPA / ACH direct debit) */
  banks: Array<{ id: string; label: string }>;
}

/** The customer's account credit and saved methods. Memberships and packages: benefits.service. */
async function benefits(businessId: string, customerId: string | null | undefined): Promise<Benefits> {
  const out: Benefits = { credit: 0, cards: [], banks: [] };
  if (!customerId) return out;
  out.credit = await getCustomerCreditBalance(businessId, customerId).then((x) => x.availableCents || 0).catch(() => 0);
  const { rows: cards } = await adminPool.query(
    `SELECT id, display_brand, display_last4 FROM pay_payment_methods
      WHERE owner_level = 'customer' AND customer_id = $1 AND business_id = $2 AND status = 'active' AND method_type = 'card'
      ORDER BY is_default DESC, created_at DESC`,
    [customerId, businessId],
  );
  out.cards = cards.map((c: any) => ({ id: c.id, label: `${c.display_brand || 'Card'} •••• ${c.display_last4 || ''}`.trim() }));
  const { rows: banks } = await adminPool.query(
    `SELECT id, display_brand, display_last4 FROM pay_payment_methods
      WHERE owner_level = 'customer' AND customer_id = $1 AND business_id = $2 AND status = 'active' AND method_type = 'bank_draw'
      ORDER BY is_default DESC, created_at DESC`,
    [customerId, businessId],
  );
  out.banks = banks.map((c: any) => ({ id: c.id, label: `${c.display_brand || 'Bank account'} ···· ${c.display_last4 || ''}`.trim() }));
  return out;
}

/** What a chosen membership or package does for the booking: its name, and why not when it does not cover it. */
interface BenefitResult { name: string; covers: boolean; reason: string | null; left_after: number | null }

const leftAfter = (o: BenefitOption) => (o.left === null ? null : o.left - o.needed);
const paidWithLabel = (name: string, left: number | null) => `Paid with ${name}${left === null ? '' : ` (${left} left after this)`}`;

/**
 * The lines shown for an order: the service, what a membership or package pays of it, a code,
 * tax. On the scratch order of a quote the chosen benefit is applied here; on a booking's order
 * it is already applied by Checkout's own rule (the booking's hold pays its line).
 */
async function priceOrder(orderId: string, businessId: string, c: PayChoices, scratch: { option: BenefitOption | null } | null) {
  const order = await checkout.getOrder(orderId);
  const item = (order as any).items?.find((x: any) => x.item_type === 'service');
  const lines: Array<{ label: string; amount: number }> = [];
  let benefit: BenefitResult | null = null;
  if (!item) return { lines, total: 0, benefit, promo: null };
  const gross = item.unit_price * item.quantity;
  lines.push({ label: `${item.item_name}${item.variant_name ? ' · ' + item.variant_name : ''}${item.quantity > 1 ? ' × ' + item.quantity : ''}`, amount: gross });
  let covered = false;
  if (scratch?.option) {
    const o = scratch.option;
    benefit = { name: o.name, covers: o.covers, reason: o.reason, left_after: o.covers ? leftAfter(o) : null };
    if (o.covers) {
      await checkout.updateItem(item.id, orderId, { discountAmount: gross, notes: `Paid with ${o.name}` } as any);
      lines.push({ label: paidWithLabel(o.name, leftAfter(o)), amount: -gross }); covered = true;
    }
  } else if (item.benefit) {
    benefit = { name: item.benefit.name, covers: true, reason: null, left_after: null };
    lines.push({ label: `Paid with ${item.benefit.name}`, amount: -gross }); covered = true;
  }
  // Each add-on under the service (spec 51, gap 15), and what a package pays of it. (Re-read: a
  // package may have been applied to it above.)
  const withAddons = await checkout.getOrder(orderId) as any;
  for (const a of (withAddons.items || []).filter((x: any) => x.item_type === 'add_on')) {
    const gross = a.unit_price * a.quantity;
    lines.push({ label: `+ ${a.item_name}`, amount: gross });
    const paidWith = a.benefit?.name || (a.discount_amount >= gross && gross > 0 && String(a.notes || '').startsWith('Paid with ') ? String(a.notes).slice('Paid with '.length).split(';')[0] : null);
    if (paidWith) lines.push({ label: `Paid with ${paidWith}`, amount: -gross });
  }
  let promo: { code: string; ok: boolean; message?: string } | null = null;
  if (c.promoCode && !covered) {
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
  return { lines, total: final.total_amount as number, promo, benefit };
}
/** The numbers of step 4, before the booking exists. */
export async function quote(c: PayChoices) {
  const b = await benefits(c.businessId, c.customerId);
  const { rows: v } = await adminPool.query(
    `SELECT v.name AS variant_name, v.price, v.duration, s.name AS service_name, s.booking_type, s.max_capacity
       FROM svc_variants v JOIN svc_services s ON s.id = v.service_id WHERE v.id = $1 AND s.id = $2 AND s.business_id = $3`,
    [c.variantId, c.serviceId, c.businessId],
  );
  if (!v[0]) throw Object.assign(new Error(msg('errors:bookingPayment.serviceOrOptionNotFound')), { code: 'NOT_FOUND' });
  const qty = (v[0].booking_type === 'shared' || v[0].booking_type === 'group') ? Math.max(1, c.participants || 1) : 1;
  // a scratch order with its own reference, so no order number is used up (numbers stay without gaps)
  const { rows: scratch } = await adminPool.query(
    `INSERT INTO fin_orders (business_id, customer_id, order_number, status, checked_out_by, notes) VALUES ($1, $2, $3, 'open', $4, 'Quote (deleted)') RETURNING id`,
    [c.businessId, c.customerId || null, 'Q-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), c.userId],
  );
  const order = { id: scratch[0].id as string };
  try {
    await checkout.addItem(order.id, { itemType: 'service', itemId: c.serviceId, itemName: v[0].service_name, variantId: c.variantId, variantName: v[0].variant_name, quantity: qty, unitPrice: v[0].price } as any);
    // The add-ons chosen, each its own line (spec 51, gap 15): one the booking already has keeps its
    // price; a new one is at the service's price now.
    if (c.addons && c.addons.length > 0) {
      const { serviceAddons, bookingAddons } = await import('./addons.service');
      const offered = await serviceAddons(c.serviceId, c.businessId);
      const kept = c.bookingId ? await bookingAddons(c.bookingId) : [];
      for (const id of [...new Set(c.addons)]) {
        const k = kept.find((x) => x.addon_id === id);
        const o = offered.find((x) => x.addon_id === id);
        const line = k ? { addon_id: k.addon_id, name: k.name, price: k.price } : o ? { addon_id: o.id, name: o.name, price: o.price } : null;
        if (line) await checkout.addAddonLine(order.id, line, { serviceId: c.serviceId });
        // The package chosen for the service also pays the add-on when it includes it (gap 15, criterion 8).
        if (line && c.benefit?.kind === 'package' && c.customerId) {
          const opts = await benefitOptions({ businessId: c.businessId, customerId: c.customerId, itemType: 'add_on', itemId: id, on: c.startTime || null, quantity: 1 });
          const covering = opts.find((o) => o.kind === 'package' && o.source_id === c.benefit!.source_id && o.covers);
          if (covering) {
            const { rows: li } = await adminPool.query(
              'SELECT id, unit_price, quantity FROM fin_order_items WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [order.id]);
            if (li[0]) await checkout.updateItem(li[0].id, order.id, { discountAmount: li[0].unit_price * li[0].quantity, notes: `Paid with ${covering.name}` } as any);
          }
        }
      }
    }
    // The membership or package chosen (spec 51, gap 19): the booking's own hold is not counted against it.
    let option: BenefitOption | null = null;
    if (c.benefit && c.customerId) {
      const held = c.bookingId ? await bookingBenefit(c.bookingId) : null;
      option = await optionFor({
        businessId: c.businessId, customerId: c.customerId, itemType: 'service', itemId: c.serviceId, variantId: c.variantId,
        on: c.startTime || null, quantity: qty, minutes: v[0].duration ?? null,
      }, c.benefit, { exceptUseIds: held && held.status === 'held' ? [held.id] : [] });
    }
    const priced = await priceOrder(order.id, c.businessId, c, { option });
    const creditUse = c.useCredit && b.credit > 0 && priced.total > 0 ? Math.min(b.credit, priced.total) : 0;
    const lines = [...priced.lines];
    if (creditUse) lines.push({ label: 'Account credit', amount: -creditUse });
    return {
      lines, total: priced.total, due: priced.total - creditUse, promo: priced.promo,
      // credit covers only part: the rest would need a second method (split payment, PAY-2, later)
      credit_needs_split: creditUse > 0 && creditUse < priced.total,
      benefit: priced.benefit, credit: b.credit, cards: b.cards, banks: b.banks,
    };
  } finally {
    await adminPool.query('DELETE FROM fin_order_items WHERE order_id = $1', [order.id]);
    await adminPool.query('DELETE FROM fin_orders WHERE id = $1', [order.id]);
  }
}

export interface PayInput extends PayChoices {
  bookingId: string;
  method: 'onfile' | 'card' | 'bank' | 'cash' | 'transfer' | 'gift' | 'other' | 'later' | 'covered';
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
  // Paying while booking (spec 51, gap 5): only a card or a bank account (direct debit). Cash, check,
  // gift cards and other methods are taken at Checkout, and "pay later" is what a service whose
  // Reservation Payment Rule needs no payment already does.
  if (!['onfile', 'card', 'bank', 'covered'].includes(p.method)) {
    throw Object.assign(new Error(msg('errors:bookingPayment.whenBookingPaymentIsByCard')), { code: 'METHOD_NOT_ALLOWED' });
  }
  const b = await benefits(p.businessId, p.customerId);
  // The membership or package chosen is held for the booking (normally already, when it was made);
  // the booking's order then pays its service line with it, and it is used when the order is paid.
  if (p.benefit !== undefined) {
    const held = await bookingBenefit(p.bookingId);
    const same = held && p.benefit && held.kind === p.benefit.kind
      && (held.kind === 'membership' ? held.enrollment_id === p.benefit.source_id && held.plan_item_id === p.benefit.item_id
        : held.purchase_id === p.benefit.source_id && held.package_item_id === p.benefit.item_id);
    if (!same && !(held && held.status === 'used')) {
      try { await setBookingBenefit(p.bookingId, p.benefit, p.userId); }
      catch (e) { if (e instanceof BenefitError) throw Object.assign(new Error(e.message), { code: 'NOT_COVERED' }); throw e; }
    }
  }
  const order = await checkout.createOrderFromBooking(p.bookingId, p.businessId, p.userId);
  const priced = await priceOrder(order.id, p.businessId, p, null);
  const total = priced.total;
  if (total <= 0) {
    const done = await checkout.completeOrder(order.id, p.businessId, { paymentMethod: 'other' as any, paymentReference: priced.benefit ? `Paid with ${priced.benefit.name}` : 'Nothing to pay', checkedOutBy: p.userId });
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
    bank: { paymentMethod: 'bank_draw', paymentMethodId: p.paymentMethodId },
    cash: { paymentMethod: 'cash', paymentReference: p.cashReceived ? `Received ${(p.cashReceived / 100).toFixed(2)}, change ${((p.cashReceived - total) / 100).toFixed(2)}` : undefined },
    transfer: { paymentMethod: 'bank_transfer', paymentReference: p.reference || undefined },
    gift: { paymentMethod: 'gift_card', giftCardCode: p.giftCardCode },
    other: { paymentMethod: 'other', paymentReference: p.reference || undefined },
  };
  const done = await checkout.completeOrder(order.id, p.businessId, { ...map[p.method], checkedOutBy: p.userId });
  return { status: 'paid' as const, order: done, total };
}
