import { apiClient } from './client';

// ============================================================
// Orders
// ============================================================

export interface OrderItem {
  id: string;
  order_id: string;
  item_type: 'service' | 'product' | 'membership' | 'package';
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
}

export interface Order {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  booking_id: string | null;
  order_number: string;
  status: 'open' | 'completed' | 'voided' | 'refunded';
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
}

export async function createOrder(data: { business_id: string; customer_id?: string; booking_id?: string; notes?: string }): Promise<Order> {
  const res = await apiClient.post('/v1/checkout/orders', data);
  return res.data.data;
}

export async function createOrderFromBooking(businessId: string, bookingId: string): Promise<Order> {
  const res = await apiClient.post('/v1/checkout/orders/from-booking', { business_id: businessId, booking_id: bookingId });
  return res.data.data;
}

export async function getOrders(businessId: string, filters?: { status?: string; customer_id?: string; date_from?: string; date_to?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.customer_id) params.set('customer_id', filters.customer_id);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
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
}): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/complete?business_id=${businessId}`, data);
  return res.data.data;
}

export async function updateOrderCreditedTo(orderId: string, businessId: string, creditedTo: string | null): Promise<Order> {
  const res = await apiClient.put(`/v1/checkout/orders/${orderId}/credited-to?business_id=${businessId}`, { credited_to: creditedTo });
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
