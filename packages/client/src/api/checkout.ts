import { apiClient } from './client';
import type { BenefitOption, BenefitRef, BenefitUse } from './bookings';

// ============================================================
// Orders
// ============================================================

export interface OrderItem {
  id: string;
  order_id: string;
  item_type: 'service' | 'product' | 'membership' | 'package' | 'no_show_fee' | 'gift_card' | 'event';
  item_id: string | null;
  item_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_price: number;
  /** The line was taken from stock when sold (spec 51, gap 7). */
  from_stock?: boolean;
  credited_to: string | null;
  credited_first_name: string | null;
  credited_last_name: string | null;
  booking_id: string | null;
  notes: string | null;
  /** The membership or package paying the line (spec 51, gap 19). */
  benefit?: { use_id: string; kind: 'membership' | 'package'; name: string; status: string } | null;
  refunded_quantity: number;
  refunded_amount_cents: number;
}

export interface PrepaidOrder {
  id: string;
  order_number: string;
  status: 'completed' | 'refunded';
  completed_at: string | null;
  payment_method: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  items: Array<{
    id: string; item_type: string; item_name: string; variant_name: string | null; quantity: number;
    unit_price: number; discount_amount: number; tax_amount: number; total_price: number;
    credited_to: string | null; credited_name: string | null;
    /** The membership or package that paid the line (spec 51, gap 19). */
    paid_with?: string | null;
  }>;
}

export interface Order {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  walk_in_name: string | null;
  booking_id: string | null;
  /** The order that already paid this order's appointment at reservation (spec 51, gap 5). */
  prepaid_order_number?: string | null;
  /** The order that paid this appointment's service at reservation: shown read only, never charged again (spec 51, gap 14). */
  prepaid?: PrepaidOrder | null;
  /** Where the sale happens; tracked products are sold from this location's stock (spec 51, gap 7). */
  location_id?: string | null;
  /** Set on the answer to adding or changing a line when its quantity was limited to what is on hand. */
  stock_limited?: { requested: number; added: number; onHand: number } | null;
  order_number: string;
  status: 'open' | 'completed' | 'voided' | 'refunded' | 'partially_refunded';
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  /** The tip on top of the sale (spec 51, gap 14); what is paid is total_amount + tip_amount. */
  tip_amount?: number;
  tip_refunded_cents?: number;
  /** The suggested percentage the tip was picked as (it follows the order); null when typed. */
  tip_percent?: number | string | null;
  /** What a suggested tip is of: with a service paid at reservation, and lines paid with a membership or package at their normal price. */
  tip_base?: { total: number; tax: number };
  payment_method: string | null;
  payment_reference: string | null;
  credited_to: string | null;
  promo_code: string | null;
  promotion_id: string | null;
  notes: string | null;
  checked_out_by: string | null;
  completed_at: string | null;
  created_at: string;
  items: OrderItem[];
  /**
   * Present only on the response from completing an order: memberships on the order
   * whose payment succeeded but whose enrollment did NOT complete (e.g. already
   * enrolled in that plan, or no customer on the order). The money was taken, so
   * staff must be told to follow up (manual enroll / refund).
   */
  enrollment_warnings?: Array<{ planId: string; planName: string | null; reason: string }>;
  /** Present on a completion response: gift cards created from this order (code to hand to the buyer). */
  gift_cards_issued?: Array<{ code: string; amountCents: number }>;
}

export async function createOrder(data: { business_id: string; customer_id?: string; booking_id?: string; notes?: string }): Promise<Order> {
  const res = await apiClient.post('/v1/checkout/orders', data);
  return res.data.data;
}

export async function createOrderFromBooking(businessId: string, bookingId: string): Promise<Order> {
  const res = await apiClient.post('/v1/checkout/orders/from-booking', { business_id: businessId, booking_id: bookingId });
  return res.data.data;
}

export async function getOrders(businessId: string, filters?: {
  status?: string; customer_id?: string; date_from?: string; date_to?: string;
  order_number?: string; product?: string; page?: number; limit?: number;
  columns?: Record<string, { values?: string[]; contains?: string; from?: string; to?: string }>;
}) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.customer_id) params.set('customer_id', filters.customer_id);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.order_number) params.set('order_number', filters.order_number);
  if (filters?.product) params.set('product', filters.product);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.columns && Object.keys(filters.columns).length) params.set('cf', JSON.stringify(filters.columns));
  const res = await apiClient.get(`/v1/checkout/orders?${params}`);
  return res.data;
}

/** Every value of one orders column (with counts) among the orders matching the other filters. */
export async function getOrderColumnValues(businessId: string, column: string, columns: Record<string, unknown>, product?: string): Promise<Array<{ value: string; label: string; count: number }>> {
  const params = new URLSearchParams({ business_id: businessId, column });
  if (product) params.set('product', product);
  if (Object.keys(columns).length) params.set('cf', JSON.stringify(columns));
  const res = await apiClient.get(`/v1/checkout/orders/column-values?${params}`);
  return res.data.data;
}

export async function getOrder(orderId: string): Promise<Order> {
  const res = await apiClient.get(`/v1/checkout/orders/${orderId}`);
  return res.data.data;
}

// ============================================================
// Order Items
// ============================================================

export async function addItem(orderId: string, data: {
  item_type: string; item_id?: string; item_name: string; variant_id?: string; variant_name?: string;
  quantity: number; unit_price: number; discount_amount?: number; tax_amount?: number;
  credited_to?: string; booking_id?: string; notes?: string;
  gift_recipient_name?: string | null; gift_recipient_email?: string | null;
  gift_expiry?: string | null;
}): Promise<Order> {
  const res = await apiClient.post(`/v1/checkout/orders/${orderId}/items`, data);
  return res.data.data;
}

export async function updateItem(orderId: string, itemId: string, data: {
  quantity?: number; unit_price?: number; discount_amount?: number; tax_amount?: number;
  credited_to?: string | null; notes?: string;
}): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/items/${itemId}`, data);
  return res.data.data;
}

export async function removeItem(orderId: string, itemId: string): Promise<Order> {
  const res = await apiClient.delete(`/v1/checkout/orders/${orderId}/items/${itemId}`);
  return res.data.data;
}

// ============================================================
// Order Actions
// ============================================================

export async function completeOrder(orderId: string, businessId: string, data: {
  payment_method?: string; payment_reference?: string;
  payment_method_id?: string | null; gift_card_code?: string | null; check_number?: string | null;
  one_time_charge_ref?: string | null; walk_in_name?: string | null;
}): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/complete?business_id=${businessId}`, data);
  return res.data.data;
}

/** Line types that can be refunded through the order-refund flow (mirrors the server rule). */
export const REFUNDABLE_ITEM_TYPES: ReadonlySet<string> = new Set(['product', 'no_show_fee', 'event']);

export interface OneTimeChargeSession {
  providerReference: string;
  clientSecret?: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
}

/** Begin a walk-in one-time card charge: creates the PaymentIntent the browser confirms. */
export async function beginOneTimeCharge(orderId: string, businessId: string): Promise<OneTimeChargeSession> {
  const res = await apiClient.post(`/v1/checkout/orders/${orderId}/one-time-charge?business_id=${businessId}`, {});
  return res.data.data;
}

export interface OrderRefundResult {
  refundTransactionId: string;
  referenceNumber: string;
  status: 'completed' | 'pending' | 'failed';
  amountCents: number;
  orderStatus: string;
  failureReason?: string | null;
}

/** Partial / line-item refund of an order. */
export async function refundOrder(
  orderId: string, businessId: string, reason: string,
  lines: Array<{ order_item_id: string; quantity: number; restock?: boolean }>,
  tipCents = 0,
): Promise<OrderRefundResult> {
  const res = await apiClient.post(`/v1/checkout/orders/${orderId}/refund?business_id=${businessId}`, { reason, lines, tip_cents: tipCents });
  return res.data.data;
}

/** Where the sale happens (its stock comes from there). */
export async function setOrderLocation(orderId: string, businessId: string, locationId: string): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/location?business_id=${businessId}`, { location_id: locationId });
  return res.data.data;
}

export async function updateOrderCreditedTo(orderId: string, businessId: string, creditedTo: string | null): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/credited-to?business_id=${businessId}`, { credited_to: creditedTo });
  return res.data.data;
}

export async function updateOrderCustomer(orderId: string, businessId: string, customerId: string | null): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/customer?business_id=${businessId}`, { customer_id: customerId });
  return res.data.data;
}

export async function applyPromoCode(orderId: string, businessId: string, promoCode: string): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/promo?business_id=${businessId}`, { promo_code: promoCode });
  return res.data.data;
}

export async function removePromoCode(orderId: string, businessId: string): Promise<Order> {
  const res = await apiClient.delete(`/v1/checkout/orders/${orderId}/promo?business_id=${businessId}`);
  return res.data.data;
}

export async function voidOrder(orderId: string, businessId: string): Promise<any> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/void?business_id=${businessId}`);
  return res.data.data;
}

// --- Tips (spec 51, gap 14) ---

/** default_percent / max_percent: the tip slider at Checkout starts at the default and goes from 0 to the highest (owner, 23 Nov 2026). */
export interface TipSettings { enabled: boolean; default_percent: number; max_percent: number; on_manual: boolean; split: 'value' | 'even'; base: 'before_tax' | 'after_tax' }
export interface TipShare { user_id: string; name: string; amount_cents: number }
export interface OrderTip { tip_cents: number; by_hand: boolean; shares: TipShare[]; staff: Array<{ user_id: string; name: string }> }

export async function getTipSettings(businessId: string): Promise<TipSettings> {
  const res = await apiClient.get('/v1/checkout/tip-settings', { params: { business_id: businessId } });
  return res.data.data;
}
export async function saveTipSettings(businessId: string, s: TipSettings): Promise<TipSettings> {
  const res = await apiClient.put('/v1/checkout/tip-settings', s, { params: { business_id: businessId } });
  return res.data.data;
}
export async function getOrderTip(orderId: string, businessId: string): Promise<OrderTip> {
  const res = await apiClient.get(`/v1/checkout/orders/${orderId}/tip`, { params: { business_id: businessId } });
  return res.data.data;
}
/** Set (or clear, with 0) the tip on an open order; a split by hand must add up to the tip. */
export async function setOrderTip(orderId: string, businessId: string, tipCents: number, split?: Array<{ user_id: string; amount_cents: number }> | null, percent?: number | null): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/tip`, { tip_cents: tipCents, percent: percent ?? null, split: split ?? null }, { params: { business_id: businessId } });
  return res.data.data;
}

// --- Tip pool: tips on orders with no staff member on them (spec 51, gap 14) ---

export type TipPoolMode = 'hand' | 'hours' | 'even';
export interface TipPoolSummary {
  waiting_cents: number; electronic_cents: number; cash_cents: number; tips: number;
  first_day: string | null; last_day: string | null;
  staff: Array<{ user_id: string; name: string }>;
}
export interface TipPoolRequest { mode: TipPoolMode; start: string | null; end: string; amounts?: Array<{ user_id: string; amount_cents: number }> }
export interface TipPoolPlan {
  total_cents: number; left_cents: number; unassigned_cents: number; days_without_staff: string[];
  staff: Array<{ user_id: string; name: string; amount_cents: number; hours: number }>;
}

export async function getTipPool(businessId: string): Promise<TipPoolSummary> {
  const res = await apiClient.get('/v1/checkout/tip-pool', { params: { business_id: businessId } });
  return res.data.data;
}
/** How the pool would be shared for these dates; nothing changes. */
export async function planTipPool(businessId: string, req: TipPoolRequest): Promise<TipPoolPlan> {
  const res = await apiClient.post('/v1/checkout/tip-pool/plan', req, { params: { business_id: businessId } });
  return res.data.data;
}
export async function shareTipPool(businessId: string, req: TipPoolRequest): Promise<{ shared_cents: number; left_cents: number; staff: TipPoolPlan['staff'] }> {
  const res = await apiClient.post('/v1/checkout/tip-pool/share', req, { params: { business_id: businessId } });
  return res.data.data;
}

// --- Paying a line with a membership or package (spec 51, gap 19) ---

export async function getLineBenefits(orderId: string, itemId: string, businessId: string): Promise<{ options: BenefitOption[]; use: BenefitUse | null }> {
  const res = await apiClient.get(`/v1/checkout/orders/${orderId}/items/${itemId}/benefits`, { params: { business_id: businessId } });
  return res.data.data;
}
/** Pay the line with a membership or package, or normally again (null). */
export async function setLineBenefit(orderId: string, itemId: string, businessId: string, benefit: BenefitRef | null): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/items/${itemId}/benefit`, { benefit }, { params: { business_id: businessId } });
  return res.data.data;
}