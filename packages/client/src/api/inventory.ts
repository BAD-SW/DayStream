import { apiClient } from './client';
import i18n from '../i18n';

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
/** `label` and the MOVEMENT_LABELS values are translation keys: show them with t(label), or use the helpers below. */
export const ADJUST_REASONS: { value: AdjustReason; label: string }[] = [
  { value: 'damaged', label: 'inventory:adjust.damaged' },
  { value: 'lost', label: 'inventory:adjust.lost' },
  { value: 'used_in_service', label: 'inventory:adjust.used_in_service' },
  { value: 'found', label: 'inventory:adjust.found' },
  { value: 'correction', label: 'inventory:adjust.correction' },
];

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'inventory:movement.opening', sale: 'inventory:movement.sale', sale_cancelled: 'inventory:movement.sale_cancelled', refund_restock: 'inventory:movement.refund_restock',
  refund_write_off: 'inventory:movement.refund_write_off', receive: 'inventory:movement.receive', adjust: 'inventory:movement.adjust', count: 'inventory:movement.count',
  transfer_in: 'inventory:movement.transfer_in', transfer_out: 'inventory:movement.transfer_out',
};

/** What a stock movement reason reads as, in the language shown. */
export const movementLabel = (reason: string): string => (MOVEMENT_LABELS[reason] ? i18n.t(MOVEMENT_LABELS[reason]) : reason);
/** What a stock adjustment reason reads as, in the language shown. */
export const adjustReasonLabel = (reason: string): string => {
  const found = ADJUST_REASONS.find((r) => r.value === reason);
  return found ? i18n.t(found.label) : reason;
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