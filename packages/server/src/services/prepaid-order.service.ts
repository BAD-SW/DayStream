import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';

type Db = Pick<PoolClient, 'query'>;

/**
 * The order that paid an appointment's service before the visit (paid at reservation, spec 51
 * gap 5): another paid order of the same booking holding the booking's service line. The visit's
 * own order shows it, read only, and bases the tip on it too (spec 51, gap 14; owner, 23 Nov 2026);
 * its lines and payment stay on that order, so nothing is posted twice.
 */
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
    /** The membership or package that paid the line (spec 51, gap 19, criterion 11). */
    paid_with: string | null;
  }>;
}

export async function findPrepaidOrderId(orderId: string, bookingId: string | null, db: Db = adminPool): Promise<string | null> {
  if (!bookingId) return null;
  const { rows } = await db.query(
    `SELECT o.id FROM fin_orders o
      WHERE o.booking_id = $1 AND o.id <> $2 AND o.status IN ('completed', 'refunded')
        AND EXISTS (SELECT 1 FROM fin_order_items i WHERE i.order_id = o.id AND i.booking_id = $1 AND i.item_type = 'service')
      ORDER BY o.completed_at LIMIT 1`,
    [bookingId, orderId]);
  return rows[0]?.id ?? null;
}

export async function getPrepaidOrder(orderId: string, bookingId: string | null, db: Db = adminPool): Promise<PrepaidOrder | null> {
  const id = await findPrepaidOrderId(orderId, bookingId, db);
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT id, order_number, status, completed_at, payment_method, subtotal, tax_amount, discount_amount, total_amount
       FROM fin_orders WHERE id = $1`, [id]);
  const { rows: items } = await db.query(
    `SELECT i.id, i.item_type, i.item_name, i.variant_name, i.quantity, i.unit_price, i.discount_amount, i.tax_amount, i.total_price,
            COALESCE(i.credited_to, o.credited_to) AS credited_to,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS credited_name
       FROM fin_order_items i
       JOIN fin_orders o ON o.id = i.order_id
       LEFT JOIN usr_users u ON u.id = COALESCE(i.credited_to, o.credited_to)
      WHERE i.order_id = $1 ORDER BY i.created_at`, [id]);
  const { orderLineBenefits } = await import('./benefits.service');
  const paidWith = await orderLineBenefits(items.map((i: { id: string }) => i.id));
  return { ...rows[0], items: items.map((i: { id: string }) => ({ ...i, paid_with: paidWith.get(i.id)?.name ?? null })) };
}
