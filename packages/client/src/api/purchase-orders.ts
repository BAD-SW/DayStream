import { apiClient } from './client';

/** Purchase orders (spec 51, gap 7): ordered from a vendor, received into stock, billed. `label` in PO_STATUS is a translation key: show it with t(label). */
export type PoStatus = 'draft' | 'sent' | 'partly_received' | 'received' | 'closed' | 'cancelled';

export const PO_STATUS: Record<PoStatus, { label: string; variant: 'neutral' | 'info' | 'warning' | 'success' | 'error' }> = {
  draft: { label: 'inventory:po.status.draft', variant: 'neutral' },
  sent: { label: 'inventory:po.status.sent', variant: 'info' },
  partly_received: { label: 'inventory:po.status.partly_received', variant: 'warning' },
  received: { label: 'inventory:po.status.received', variant: 'success' },
  closed: { label: 'inventory:po.status.closed', variant: 'neutral' },
  cancelled: { label: 'inventory:po.status.cancelled', variant: 'error' },
};

export interface PoSummary {
  id: string; po_number: string; status: PoStatus; expected_on: string | null; created_at: string; sent_at: string | null; note: string | null;
  vendor_name: string; location_name: string; qty_ordered: number; qty_received: number; total_cents: number; to_bill_cents: number;
}
export interface PoLine {
  id: string; merchandise_id: string; variant_id: string | null; product_name: string; variant_name: string | null; sku: string | null;
  qty_ordered: number; qty_received: number; qty_billed: number; unit_cost_cents: number; on_hand: number;
}
export interface PoBill { id: string; invoice_number: string | null; amount: number; due_date: string; status: string; created_at: string }
export interface PurchaseOrder {
  id: string; po_number: string; status: PoStatus; vendor_id: string; vendor_name: string; vendor_email: string | null; vendor_payment_terms: number | null;
  location_id: string; location_name: string; expected_on: string | null; note: string | null; sent_at: string | null;
  created_at: string; created_by_name: string | null; lines: PoLine[]; bills: PoBill[];
}
export interface PoInput {
  vendor_id: string; location_id: string; expected_on?: string | null; note?: string | null;
  lines: Array<{ merchandise_id: string; variant_id: string | null; qty_ordered: number; unit_cost_cents: number }>;
}

export async function getPurchaseOrders(businessId: string): Promise<PoSummary[]> {
  const res = await apiClient.get('/v1/purchase-orders', { params: { business_id: businessId } });
  return res.data.data;
}
export async function getPurchaseOrder(businessId: string, id: string): Promise<PurchaseOrder> {
  const res = await apiClient.get(`/v1/purchase-orders/${id}`, { params: { business_id: businessId } });
  return res.data.data;
}
export async function createPurchaseOrder(businessId: string, data: PoInput): Promise<{ id: string }> {
  const res = await apiClient.post('/v1/purchase-orders', { business_id: businessId, ...data });
  return res.data.data;
}
export async function updatePurchaseOrder(businessId: string, id: string, data: PoInput): Promise<PurchaseOrder> {
  const res = await apiClient.put(`/v1/purchase-orders/${id}`, { business_id: businessId, ...data });
  return res.data.data;
}
export async function sendPurchaseOrder(businessId: string, id: string, email: boolean): Promise<{ emailedTo: string | null }> {
  const res = await apiClient.post(`/v1/purchase-orders/${id}/send`, { business_id: businessId, email });
  return res.data.data;
}
export async function receivePurchaseOrder(businessId: string, id: string, lines: Array<{ line_id: string; qty: number; unit_cost_cents: number | null }>, note?: string | null): Promise<{ status: PoStatus }> {
  const res = await apiClient.post(`/v1/purchase-orders/${id}/receive`, { business_id: businessId, lines, note: note || null });
  return res.data.data;
}
export async function billPurchaseOrder(businessId: string, id: string, data: { invoice_number?: string | null; due_date?: string | null }): Promise<{ billId: string; amount: number }> {
  const res = await apiClient.post(`/v1/purchase-orders/${id}/bill`, { business_id: businessId, ...data });
  return res.data.data;
}
export async function closePurchaseOrder(businessId: string, id: string): Promise<{ status: PoStatus }> {
  // a JSON body, not null: the server's JSON parser refuses a bare null
  const res = await apiClient.post(`/v1/purchase-orders/${id}/close`, { business_id: businessId });
  return res.data.data;
}
