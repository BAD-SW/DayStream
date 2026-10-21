import { apiClient } from './client';

// ============================================================
// Orders
// ============================================================

export interface OrderItem {
  id: string;
  order_id: string;
  item_type: 'service' | 'product' | 'membership' | 'package' | 'no_show_fee' | 'gift_card';
  item_id: string | null;
  item_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_price: number;
  credited_to: string | null;
  credited_first_name: string | null;
  credited_last_name: string | null;
  booking_id: string | null;
  notes: string | null;
  refunded_quantity: number;
  refunded_amount_cents: number;
}

export interface Order {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  walk_in_name: string | null;
  booking_id: string | null;
  order_number: string;
  status: 'open' | 'completed' | 'voided' | 'refunded' | 'partially_refunded';
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
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
  order_number?: string; product?: string; page?: number;
}) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.customer_id) params.set('customer_id', filters.customer_id);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.order_number) params.set('order_number', filters.order_number);
  if (filters?.product) params.set('product', filters.product);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/checkout/orders?${params}`);
  return res.data;
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
export const REFUNDABLE_ITEM_TYPES: ReadonlySet<string> = new Set(['product', 'no_show_fee']);

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
  lines: Array<{ order_item_id: string; quantity: number }>,
): Promise<OrderRefundResult> {
  const res = await apiClient.post(`/v1/checkout/orders/${orderId}/refund?business_id=${businessId}`, { reason, lines });
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
