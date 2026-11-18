import { apiClient } from './client';

/** Retail inventory (spec 51, gap 7). */

export interface StockLine {
  location_id: string; location_name: string; variant_id: string | null; variant_name: string | null;
  on_hand: number; avg_cost_cents: number; reorder_level: number | null; reorder_qty: number | null; low: boolean;
}

export interface StockMovement {
  id: string; created_at: string; reason: string; adjust_reason: string | null; qty_change: number; on_hand_after: number;
  unit_cost_cents: number | null; note: string | null; location_name: string; variant_name: string | null;
  order_number: string | null; by_name: string | null;
}

export type AdjustReason = 'damaged' | 'lost' | 'used_in_service' | 'found' | 'correction';
export const ADJUST_REASONS: { value: AdjustReason; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'used_in_service', label: 'Used in a service' },
  { value: 'found', label: 'Found' },
  { value: 'correction', label: 'Correction' },
];

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening stock', sale: 'Sold', sale_cancelled: 'Sale not completed (put back)', refund_restock: 'Returned to stock',
  refund_write_off: 'Returned, written off', receive: 'Received', adjust: 'Adjusted', count: 'Counted',
  transfer_in: 'Moved in', transfer_out: 'Moved out',
};

export async function getProductStock(productId: string, businessId: string): Promise<{ track_stock: boolean; lines: StockLine[] }> {
  const res = await apiClient.get(`/v1/inventory/products/${productId}/stock`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function getProductHistory(productId: string, businessId: string): Promise<StockMovement[]> {
  const res = await apiClient.get(`/v1/inventory/products/${productId}/history`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function changeStock(productId: string, data: {
  business_id: string; location_id: string; variant_id: string | null; mode: 'set' | 'add' | 'remove'; qty: number;
  reason?: AdjustReason; unit_cost_cents?: number | null; note?: string | null;
}): Promise<{ on_hand: number; avg_cost_cents: number }> {
  const res = await apiClient.post(`/v1/inventory/products/${productId}/stock`, data);
  return res.data.data;
}

export async function setReorder(productId: string, data: {
  business_id: string; location_id: string; variant_id: string | null; reorder_level: number | null; reorder_qty: number | null;
}): Promise<void> {
  await apiClient.put(`/v1/inventory/products/${productId}/reorder`, data);
}

/** On hand of every tracked product (and variant) at a location, for Checkout. */
export async function getLocationStock(locationId: string, businessId: string): Promise<{
  tracked_ids: string[]; stock: Array<{ merchandise_id: string; variant_id: string | null; on_hand: number; low: boolean }>;
}> {
  const res = await apiClient.get(`/v1/inventory/locations/${locationId}/stock`, { params: { business_id: businessId } });
  return res.data.data;
}

/** Move stock of a product from one location to another (it arrives at once). */
export async function createTransfer(data: {
  business_id: string; from_location_id: string; to_location_id: string; note?: string | null;
  lines: Array<{ merchandise_id: string; variant_id: string | null; qty: number }>;
}): Promise<{ id: string }> {
  const res = await apiClient.post('/v1/inventory/transfers', data);
  return res.data.data;
}