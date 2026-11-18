import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';

/**
 * Retail inventory (spec 51, gap 7; design 7). In-person sales only.
 *
 * A stock item is a tracked product without variants, or one variant of it, at one location.
 * Stock changes only through a movement (inv_movements), written in the same transaction as the
 * change to on_hand (inv_stock, row locked), so on_hand always equals the sum of movements and can
 * never go below zero (a CHECK as well). Stock is valued at average cost, updated on each receipt.
 */

export class StockError extends Error {
  constructor(message: string, public code: 'OUT_OF_STOCK' | 'NOT_ENOUGH_STOCK' | 'NOT_TRACKED' | 'INVALID') { super(message); this.name = 'StockError'; }
}

type Db = PoolClient | typeof adminPool;
type Reason = 'opening' | 'sale' | 'sale_cancelled' | 'refund_restock' | 'refund_write_off'
  | 'receive' | 'adjust' | 'count' | 'transfer_in' | 'transfer_out';

export interface StockKey { businessId: string; locationId: string; merchandiseId: string; variantId: string | null }

const NIL = '00000000-0000-0000-0000-000000000000';

async function tenantOf(db: Db, businessId: string): Promise<string> {
  const { rows } = await db.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  if (!rows[0]) throw new StockError('Business not found', 'INVALID');
  return rows[0].tenant_id;
}

/** Whether a product's stock is tracked (an unknown product: no). */
export async function isTracked(merchandiseId: string, db: Db = adminPool): Promise<boolean> {
  const { rows } = await db.query('SELECT track_stock FROM prd_merchandise WHERE id = $1', [merchandiseId]);
  return !!rows[0]?.track_stock;
}

/** The stock row of an item, created (at zero) if missing, locked for this transaction. */
async function lockedRow(client: PoolClient, k: StockKey) {
  const tenantId = await tenantOf(client, k.businessId);
  await client.query(
    `INSERT INTO inv_stock (tenant_id, business_id, location_id, merchandise_id, variant_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, merchandise_id, COALESCE(variant_id, '${NIL}'::uuid)) DO NOTHING`,
    [tenantId, k.businessId, k.locationId, k.merchandiseId, k.variantId],
  );
  const { rows } = await client.query(
    `SELECT * FROM inv_stock WHERE location_id = $1 AND merchandise_id = $2
        AND COALESCE(variant_id, '${NIL}'::uuid) = COALESCE($3::uuid, '${NIL}'::uuid) FOR UPDATE`,
    [k.locationId, k.merchandiseId, k.variantId],
  );
  return { row: rows[0], tenantId };
}

/**
 * Write one movement and change on_hand by it, inside the caller's transaction. A receipt also
 * updates the average cost. Refuses a change that would take stock below zero.
 */
export async function move(client: PoolClient, k: StockKey, m: {
  qty: number; reason: Reason; unitCostCents?: number | null; adjustReason?: string | null;
  orderId?: string | null; orderItemId?: string | null; note?: string | null; userId?: string | null;
  transferId?: string | null; poLineId?: string | null;
}): Promise<{ onHand: number; avgCostCents: number; movementId: string; unitCostCents: number }> {
  if (!Number.isInteger(m.qty) || m.qty === 0) throw new StockError('A stock change needs a whole, non-zero quantity.', 'INVALID');
  const { row, tenantId } = await lockedRow(client, k);
  const after = row.on_hand + m.qty;
  if (after < 0) {
    throw new StockError(row.on_hand === 0 ? 'Out of stock.' : `Only ${row.on_hand} in stock.`, row.on_hand === 0 ? 'OUT_OF_STOCK' : 'NOT_ENOUGH_STOCK');
  }
  let avg = row.avg_cost_cents;
  // Stock coming in at a known cost moves the average (a receipt, opening stock, a count or a
  // return at the cost it was sold at).
  if (m.qty > 0 && m.unitCostCents != null) {
    const before = Math.max(row.on_hand, 0);
    avg = Math.round((before * row.avg_cost_cents + m.qty * m.unitCostCents) / (before + m.qty));
  }
  await client.query('UPDATE inv_stock SET on_hand = $2, avg_cost_cents = $3, updated_at = NOW() WHERE id = $1', [row.id, after, avg]);
  const unitCost = m.unitCostCents ?? row.avg_cost_cents;
  const { rows: mv } = await client.query(
    `INSERT INTO inv_movements (tenant_id, business_id, location_id, merchandise_id, variant_id, qty_change, reason,
       adjust_reason, unit_cost_cents, on_hand_after, order_id, order_item_id, note, created_by, transfer_id, po_line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [tenantId, k.businessId, k.locationId, k.merchandiseId, k.variantId, m.qty, m.reason, m.adjustReason ?? null,
      unitCost, after, m.orderId ?? null, m.orderItemId ?? null, m.note ?? null, m.userId ?? null,
      m.transferId ?? null, m.poLineId ?? null],
  );
  return { onHand: after, avgCostCents: avg, movementId: mv[0].id, unitCostCents: unitCost };
}

/** Run fn in one transaction. */
export async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------------------------
// Accounting of stock (design 7.5). Stock is held in 1300 Inventory at its cost. A sale moves it
// to 5000 Cost of Goods Sold with the order's journal (order-journal.service); a return to stock
// moves it back; counts and adjustments go against 5100 Inventory Adjustments; opening stock
// against 3900 Opening Balance Equity; a purchase order's bill brings it in against Accounts
// Payable. Transfers between locations stay in 1300 and post nothing.
// ---------------------------------------------------------------------------------------------

export const INVENTORY_ACCOUNT = '1300';
export const COGS_ACCOUNT = '5000';
export const ADJUSTMENT_ACCOUNT = '5100';
export const OPENING_EQUITY_ACCOUNT = '3900';

/**
 * One journal entry (Dr debitCode, Cr creditCode, amount) for a stock movement, in the caller's
 * transaction. Nothing is posted for a zero value; a missing account is logged and skipped so a
 * stock change never fails on the books.
 */
export async function postStockJournal(c: PoolClient, args: {
  businessId: string; movementId: string; debitCode: string; creditCode: string; amountCents: number; description: string; userId?: string | null;
}): Promise<void> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) return;
  const { rows: accts } = await c.query(
    'SELECT code, id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = ANY($2)', [args.businessId, [args.debitCode, args.creditCode]]);
  const id = (code: string) => accts.find((a: { code: string }) => a.code === code)?.id as string | undefined;
  const debit = id(args.debitCode); const credit = id(args.creditCode);
  if (!debit || !credit) {
    console.warn(`[Journal] Stock movement ${args.movementId}: account ${!debit ? args.debitCode : args.creditCode} missing for business ${args.businessId}; not posted`);
    return;
  }
  const { rows: tz } = await c.query('SELECT timezone FROM sys_businesses WHERE id = $1', [args.businessId]);
  const entryDate = new Date().toLocaleDateString('sv-SE', { timeZone: tz[0]?.timezone || 'UTC' });
  const { rows: e } = await c.query(
    `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, 'inventory_movement', $4, $5) RETURNING id`,
    [args.businessId, entryDate, args.description, args.movementId, args.userId ?? null]);
  await c.query(
    `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES ($1, $2, $3, 0, $4), ($1, $5, 0, $3, $4)`,
    [e[0].id, debit, args.amountCents, args.description, credit]);
}

/** Cost of what an order took from stock (its sales, less any put back), for its journal. */
export async function orderCostOfSales(orderId: string, db: Db = adminPool): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(-qty_change * COALESCE(unit_cost_cents, 0)), 0)::bigint AS cost
       FROM inv_movements WHERE order_id = $1 AND reason IN ('sale', 'sale_cancelled')`, [orderId]);
  return Math.max(0, Number(rows[0]?.cost ?? 0));
}

// ---------------------------------------------------------------------------------------------
// Low-stock notification (design 7.4; owner, 19 Nov 2026: an automated process). Sent once when an
// item is at or below its reorder level, and again only after it has been restocked above it.
// ---------------------------------------------------------------------------------------------

export async function notifyLowStock(): Promise<number> {
  // Restocked above the level (or the level removed): it may be told about again.
  await adminPool.query(
    `UPDATE inv_stock SET low_notified_at = NULL
      WHERE low_notified_at IS NOT NULL AND (reorder_level IS NULL OR on_hand > reorder_level)`);
  const { rows } = await adminPool.query(
    `SELECT s.id, s.business_id, s.merchandise_id, s.on_hand, s.reorder_level, s.reorder_qty,
            m.name AS product_name, v.name AS variant_name, l.name AS location_name,
            (SELECT COUNT(*) FROM sys_locations x WHERE x.business_id = s.business_id AND x.status = 'active')::int AS locations
       FROM inv_stock s
       JOIN prd_merchandise m ON m.id = s.merchandise_id AND m.track_stock = true AND m.status <> 'archived'
       LEFT JOIN prd_merchandise_variants v ON v.id = s.variant_id
       JOIN sys_locations l ON l.id = s.location_id AND l.status = 'active'
      WHERE s.reorder_level IS NOT NULL AND s.on_hand <= s.reorder_level AND s.low_notified_at IS NULL
        AND (s.variant_id IS NULL OR v.status <> 'inactive')
      ORDER BY s.business_id, m.name, v.name`);
  if (rows.length === 0) return 0;
  const { notify } = await import('./inbox.service');
  const byBusiness = new Map<string, typeof rows>();
  for (const r of rows) byBusiness.set(r.business_id, [...(byBusiness.get(r.business_id) || []), r]);
  for (const [businessId, items] of byBusiness) {
    const lines = items.map((i: { product_name: string; variant_name: string | null; location_name: string; locations: number; on_hand: number; reorder_level: number; reorder_qty: number | null }) =>
      `${i.product_name}${i.variant_name ? ` (${i.variant_name})` : ''}${i.locations > 1 ? ` at ${i.location_name}` : ''}: ${i.on_hand} left`
      + ` (reorder at ${i.reorder_level}${i.reorder_qty ? `, order ${i.reorder_qty}` : ''})`);
    const one = items.length === 1 ? items[0] : null;
    await notify(businessId, 'low_stock', {
      title: one ? `Low stock: ${one.product_name}${one.variant_name ? ` (${one.variant_name})` : ''}` : `Low stock: ${items.length} items`,
      body: lines.join('\n'),
      link: one ? `/offers/merchandise/${one.merchandise_id}` : '/offers?tab=products',
      emailNote: 'Order more from Accounting > Purchase Orders in DayStream.',
    });
    await adminPool.query('UPDATE inv_stock SET low_notified_at = NOW() WHERE id = ANY($1::uuid[])', [items.map((i: { id: string }) => i.id)]);
  }
  return rows.length;
}

/** On hand of one item at one location (0 when never stocked). */
export async function onHand(k: StockKey, db: Db = adminPool): Promise<number> {
  const { rows } = await db.query(
    `SELECT on_hand FROM inv_stock WHERE location_id = $1 AND merchandise_id = $2
        AND COALESCE(variant_id, '${NIL}'::uuid) = COALESCE($3::uuid, '${NIL}'::uuid)`,
    [k.locationId, k.merchandiseId, k.variantId],
  );
  return rows[0]?.on_hand ?? 0;
}

/** The business's location for a sale with no location chosen: the primary one. */
export async function primaryLocation(businessId: string, db: Db = adminPool): Promise<string | null> {
  const { rows } = await db.query(
    "SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1", [businessId],
  );
  return rows[0]?.id ?? null;
}

/** Where an order's stock comes from: its location, else the business's primary location. */
export async function orderLocation(orderId: string, db: Db = adminPool): Promise<{ businessId: string; locationId: string | null }> {
  const { rows } = await db.query('SELECT business_id, location_id FROM fin_orders WHERE id = $1', [orderId]);
  if (!rows[0]) throw new StockError('Order not found', 'INVALID');
  return { businessId: rows[0].business_id, locationId: rows[0].location_id || await primaryLocation(rows[0].business_id, db) };
}

/**
 * How many of a tracked item may still go on an order: on hand at the order's location, less what
 * the order's other lines already hold. null when the product is not tracked (no limit).
 */
export async function availableForOrder(orderId: string, merchandiseId: string, variantId: string | null, excludeItemId?: string | null): Promise<{ available: number; onHand: number } | null> {
  if (!(await isTracked(merchandiseId))) return null;
  const { businessId, locationId } = await orderLocation(orderId);
  if (!locationId) return { available: 0, onHand: 0 };
  const have = await onHand({ businessId, locationId, merchandiseId, variantId });
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS n FROM fin_order_items
      WHERE order_id = $1 AND item_type = 'product' AND item_id = $2
        AND COALESCE(variant_id, '${NIL}'::uuid) = COALESCE($3::uuid, '${NIL}'::uuid) AND ($4::uuid IS NULL OR id <> $4)`,
    [orderId, merchandiseId, variantId, excludeItemId ?? null],
  );
  return { available: Math.max(have - rows[0].n, 0), onHand: have };
}

/**
 * Take an order's tracked products out of stock (at completion, before the payment). Idempotent:
 * only what a line has not yet taken is taken. Refuses, naming the line, when stock is short.
 */
export async function takeForSale(orderId: string, userId: string): Promise<void> {
  await inTx(async (c) => {
    const { businessId, locationId } = await orderLocation(orderId, c);
    const { rows: lines } = await c.query(
      `SELECT oi.id, oi.item_id, oi.variant_id, oi.quantity, oi.item_name, oi.variant_name,
              COALESCE((SELECT -SUM(mv.qty_change) FROM inv_movements mv WHERE mv.order_item_id = oi.id
                         AND mv.reason IN ('sale', 'sale_cancelled')), 0)::int AS taken
         FROM fin_order_items oi JOIN prd_merchandise m ON m.id = oi.item_id
        WHERE oi.order_id = $1 AND oi.item_type = 'product' AND m.track_stock = true
        ORDER BY oi.item_id, oi.variant_id`,
      [orderId],
    );
    if (lines.length === 0) return;
    if (!locationId) throw new StockError('This business has no location to sell stock from.', 'INVALID');
    for (const l of lines) {
      const qty = l.quantity - l.taken;
      if (qty <= 0) continue;
      try {
        await move(c, { businessId, locationId, merchandiseId: l.item_id, variantId: l.variant_id },
          { qty: -qty, reason: 'sale', orderId, orderItemId: l.id, userId });
      } catch (e) {
        if (e instanceof StockError) {
          const name = l.variant_name ? `${l.item_name} (${l.variant_name})` : l.item_name;
          throw new StockError(`${name}: ${e.message} Reduce the quantity on this line.`, e.code);
        }
        throw e;
      }
    }
  });
}

/**
 * Check, without taking anything, that every tracked product line still fits what is on hand.
 * Used before a walk-in card is charged in the browser, since that money is taken before completion.
 */
export async function checkOrderFits(orderId: string): Promise<void> {
  const { rows: lines } = await adminPool.query(
    `SELECT oi.item_id, oi.variant_id, SUM(oi.quantity)::int AS qty, MIN(oi.item_name) AS item_name, MIN(oi.variant_name) AS variant_name
       FROM fin_order_items oi JOIN prd_merchandise m ON m.id = oi.item_id
      WHERE oi.order_id = $1 AND oi.item_type = 'product' AND m.track_stock = true
      GROUP BY oi.item_id, oi.variant_id`,
    [orderId],
  );
  if (lines.length === 0) return;
  const { businessId, locationId } = await orderLocation(orderId);
  if (!locationId) throw new StockError('This business has no location to sell stock from.', 'INVALID');
  for (const l of lines) {
    const have = await onHand({ businessId, locationId, merchandiseId: l.item_id, variantId: l.variant_id });
    if (l.qty > have) {
      const name = l.variant_name ? `${l.item_name} (${l.variant_name})` : l.item_name;
      throw new StockError(have === 0 ? `${name}: Out of stock. Reduce the quantity on this line.`
        : `${name}: Only ${have} in stock. Reduce the quantity on this line.`, have === 0 ? 'OUT_OF_STOCK' : 'NOT_ENOUGH_STOCK');
    }
  }
}

/** Put back what takeForSale took, when the payment did not go through. */
export async function cancelSale(orderId: string, userId: string): Promise<void> {
  await inTx(async (c) => {
    const { businessId, locationId } = await orderLocation(orderId, c);
    const { rows } = await c.query(
      `SELECT order_item_id, merchandise_id, variant_id, location_id, (-SUM(qty_change))::int AS taken
         FROM inv_movements WHERE order_id = $1 AND reason IN ('sale', 'sale_cancelled')
        GROUP BY order_item_id, merchandise_id, variant_id, location_id HAVING -SUM(qty_change) > 0`,
      [orderId],
    );
    for (const r of rows) {
      await move(c, { businessId, locationId: r.location_id || locationId, merchandiseId: r.merchandise_id, variantId: r.variant_id },
        { qty: r.taken, reason: 'sale_cancelled', orderId, orderItemId: r.order_item_id, userId, note: 'Payment not completed' });
    }
  });
}

/** A refunded product line: back into stock, or written off (recorded, no stock change). */
export async function returnFromRefund(client: PoolClient, args: {
  orderId: string; orderItemId: string; qty: number; restock: boolean; userId: string;
}): Promise<void> {
  const { rows } = await client.query(
    `SELECT mv.business_id, mv.location_id, mv.merchandise_id, mv.variant_id, mv.unit_cost_cents
       FROM inv_movements mv WHERE mv.order_item_id = $1 AND mv.reason = 'sale' ORDER BY mv.created_at LIMIT 1`,
    [args.orderItemId],
  );
  const sold = rows[0];
  if (!sold) return; // not taken from stock (not tracked when sold)
  const k = { businessId: sold.business_id, locationId: sold.location_id, merchandiseId: sold.merchandise_id, variantId: sold.variant_id };
  if (args.restock) {
    const out = await move(client, k, { qty: args.qty, reason: 'refund_restock', unitCostCents: sold.unit_cost_cents, orderId: args.orderId, orderItemId: args.orderItemId, userId: args.userId });
    // Back into stock: its cost leaves Cost of Goods Sold again (the sale's posting, reversed).
    const { rows: o } = await client.query('SELECT order_number FROM fin_orders WHERE id = $1', [args.orderId]);
    await postStockJournal(client, {
      businessId: k.businessId, movementId: out.movementId, amountCents: args.qty * (sold.unit_cost_cents ?? 0),
      debitCode: INVENTORY_ACCOUNT, creditCode: COGS_ACCOUNT, userId: args.userId,
      description: `Returned to stock, order ${o[0]?.order_number ?? ''}`.trim(),
    });
  } else {
    // a write-off moves nothing: the item left stock when it was sold; the record says it did not come back
    const { row, tenantId } = await lockedRow(client, k);
    await client.query(
      `INSERT INTO inv_movements (tenant_id, business_id, location_id, merchandise_id, variant_id, qty_change, reason,
         unit_cost_cents, on_hand_after, order_id, order_item_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,0,'refund_write_off',$6,$7,$8,$9,$10,$11)`,
      [tenantId, k.businessId, k.locationId, k.merchandiseId, k.variantId, sold.unit_cost_cents, row.on_hand,
        args.orderId, args.orderItemId, `${args.qty} returned, written off`, args.userId],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The product's Stock tab
// ---------------------------------------------------------------------------------------------

export interface StockLine {
  location_id: string; location_name: string; variant_id: string | null; variant_name: string | null;
  on_hand: number; avg_cost_cents: number; reorder_level: number | null; reorder_qty: number | null; low: boolean;
}

/** Every stock item of a product at every active location of its business (zero where never stocked). */
export async function productStock(merchandiseId: string, businessId: string): Promise<StockLine[]> {
  const { rows } = await adminPool.query(
    `WITH items AS (
       SELECT v.id AS variant_id, v.name AS variant_name, v.display_order FROM prd_merchandise_variants v
        WHERE v.merchandise_id = $1 AND v.status <> 'inactive'
       UNION ALL
       SELECT NULL, NULL, 0 WHERE NOT EXISTS (SELECT 1 FROM prd_merchandise_variants v WHERE v.merchandise_id = $1 AND v.status <> 'inactive')
     )
     SELECT l.id AS location_id, l.name AS location_name, i.variant_id, i.variant_name,
            COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.avg_cost_cents, 0) AS avg_cost_cents,
            s.reorder_level, s.reorder_qty
       FROM sys_locations l CROSS JOIN items i
       LEFT JOIN inv_stock s ON s.location_id = l.id AND s.merchandise_id = $1
            AND COALESCE(s.variant_id, '${NIL}'::uuid) = COALESCE(i.variant_id, '${NIL}'::uuid)
      WHERE l.business_id = $2 AND l.status = 'active'
      ORDER BY l.is_primary DESC, l.name, i.display_order, i.variant_name`,
    [merchandiseId, businessId],
  );
  return rows.map((r: any) => ({ ...r, low: r.reorder_level != null && r.on_hand <= r.reorder_level }));
}

/** Stock of every tracked item of a business at one location, for Checkout (by product, then variant). */
export async function stockAtLocation(businessId: string, locationId: string): Promise<Array<{ merchandise_id: string; variant_id: string | null; on_hand: number; low: boolean }>> {
  const { rows } = await adminPool.query(
    `SELECT s.merchandise_id, s.variant_id, s.on_hand, (s.reorder_level IS NOT NULL AND s.on_hand <= s.reorder_level) AS low
       FROM inv_stock s JOIN prd_merchandise m ON m.id = s.merchandise_id
      WHERE s.business_id = $1 AND s.location_id = $2 AND m.track_stock = true`,
    [businessId, locationId],
  );
  return rows;
}

const ADJUST_REASONS = ['damaged', 'lost', 'used_in_service', 'found', 'correction'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** Staff change: set the counted quantity (opening stock or a count), or add / remove with a reason. */
export async function changeStock(args: StockKey & {
  mode: 'set' | 'add' | 'remove'; qty: number; reason?: AdjustReason; unitCostCents?: number | null; note?: string | null; userId: string;
}): Promise<{ onHand: number; avgCostCents: number }> {
  if (!Number.isInteger(args.qty) || args.qty < 0) throw new StockError('Enter a whole number of 0 or more.', 'INVALID');
  if (!(await isTracked(args.merchandiseId))) throw new StockError('Stock is not tracked for this product. Turn on Track stock first.', 'NOT_TRACKED');
  if (args.mode !== 'set' && !args.reason) throw new StockError('Choose a reason.', 'INVALID');
  if (args.reason && !ADJUST_REASONS.includes(args.reason)) throw new StockError('Choose a valid reason.', 'INVALID');
  return inTx(async (c) => {
    const { row } = await lockedRow(c, args);
    // The first count of an item at a location is its opening stock.
    const { rows: prior } = await c.query(
      `SELECT 1 FROM inv_movements WHERE merchandise_id = $1 AND location_id = $2
          AND COALESCE(variant_id, '${NIL}'::uuid) = COALESCE($3::uuid, '${NIL}'::uuid) LIMIT 1`,
      [args.merchandiseId, args.locationId, args.variantId]);
    const delta = args.mode === 'set' ? args.qty - row.on_hand : args.mode === 'add' ? args.qty : -args.qty;
    if (delta === 0) return { onHand: row.on_hand, avgCostCents: row.avg_cost_cents };
    const reason: Reason = args.mode === 'set' ? (prior.length === 0 ? 'opening' : 'count') : 'adjust';
    // Stock coming in without a cost given is valued at the product's (or variant's) cost price.
    let unitCost = args.unitCostCents ?? null;
    if (delta > 0 && unitCost == null) {
      const { rows: cost } = await c.query(
        `SELECT COALESCE(v.cost_cents, m.cost_cents) AS cost FROM prd_merchandise m
           LEFT JOIN prd_merchandise_variants v ON v.id = $2 WHERE m.id = $1`, [args.merchandiseId, args.variantId]);
      unitCost = cost[0]?.cost ?? null;
    }
    const out = await move(c, args, {
      qty: delta, reason, adjustReason: args.mode === 'set' ? null : args.reason, note: args.note,
      unitCostCents: delta > 0 ? unitCost : null, userId: args.userId,
    });
    // On the books, at cost: opening stock against Opening Balance Equity; counts and adjustments
    // against Inventory Adjustments (stock found: Dr Inventory; stock gone: Cr Inventory).
    const { rows: nm } = await c.query(
      'SELECT m.name, v.name AS variant_name FROM prd_merchandise m LEFT JOIN prd_merchandise_variants v ON v.id = $2 WHERE m.id = $1',
      [args.merchandiseId, args.variantId]);
    const what = nm[0] ? `${nm[0].name}${nm[0].variant_name ? ` (${nm[0].variant_name})` : ''}` : 'Stock';
    const label = reason === 'opening' ? 'Opening stock' : reason === 'count' ? 'Stock count' : `Stock adjusted${args.reason ? ` (${args.reason.replace(/_/g, ' ')})` : ''}`;
    const other = reason === 'opening' ? OPENING_EQUITY_ACCOUNT : ADJUSTMENT_ACCOUNT;
    await postStockJournal(c, {
      businessId: args.businessId, movementId: out.movementId, amountCents: Math.abs(delta) * out.unitCostCents,
      debitCode: delta > 0 ? INVENTORY_ACCOUNT : other, creditCode: delta > 0 ? other : INVENTORY_ACCOUNT,
      description: `${label}: ${what} ${delta > 0 ? '+' : ''}${delta}`, userId: args.userId,
    });
    return out;
  });
}

/** Reorder level and quantity of one item at one location. */
export async function setReorder(args: StockKey & { reorderLevel: number | null; reorderQty: number | null }): Promise<void> {
  await inTx(async (c) => {
    const { row } = await lockedRow(c, args);
    await c.query('UPDATE inv_stock SET reorder_level = $2, reorder_qty = $3, updated_at = NOW() WHERE id = $1', [row.id, args.reorderLevel, args.reorderQty]);
  });
}

/** A product's stock history, newest first. */
export async function history(merchandiseId: string, businessId: string, limit = 100) {
  const { rows } = await adminPool.query(
    `SELECT mv.id, mv.created_at, mv.reason, mv.adjust_reason, mv.qty_change, mv.on_hand_after, mv.unit_cost_cents, mv.note,
            l.name AS location_name, v.name AS variant_name, o.order_number, po.po_number,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS by_name
       FROM inv_movements mv
       JOIN sys_locations l ON l.id = mv.location_id
       LEFT JOIN prd_merchandise_variants v ON v.id = mv.variant_id
       LEFT JOIN fin_orders o ON o.id = mv.order_id
       LEFT JOIN inv_po_lines pl ON pl.id = mv.po_line_id
       LEFT JOIN inv_purchase_orders po ON po.id = pl.po_id
       LEFT JOIN usr_users u ON u.id = mv.created_by
      WHERE mv.merchandise_id = $1 AND mv.business_id = $2
      ORDER BY mv.created_at DESC LIMIT $3`,
    [merchandiseId, businessId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Moving stock between locations, from the product's Stock card
// ---------------------------------------------------------------------------------------------

const itemName = (product: string, variant: string | null) => (variant ? `${product} (${variant})` : product);

/** Move stock between two locations at once; each item leaves at the source's average cost. */
export async function transfer(args: {
  businessId: string; fromLocationId: string; toLocationId: string; note?: string | null; userId: string;
  lines: Array<{ merchandiseId: string; variantId: string | null; qty: number }>;
}): Promise<{ id: string }> {
  if (args.fromLocationId === args.toLocationId) throw new StockError('Choose two different locations.', 'INVALID');
  // one line per item
  const merged = new Map<string, { merchandiseId: string; variantId: string | null; qty: number }>();
  for (const l of args.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new StockError('Enter a whole number of 1 or more for each item.', 'INVALID');
    const key = `${l.merchandiseId}:${l.variantId || ''}`;
    const prev = merged.get(key);
    merged.set(key, { ...l, qty: (prev?.qty ?? 0) + l.qty });
  }
  if (merged.size === 0) throw new StockError('Add at least one item to move.', 'INVALID');
  return inTx(async (c) => {
    const tenantId = await tenantOf(c, args.businessId);
    const { rows } = await c.query(
      `INSERT INTO inv_transfers (tenant_id, business_id, from_location_id, to_location_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, args.businessId, args.fromLocationId, args.toLocationId, args.note || null, args.userId],
    );
    const transferId = rows[0].id as string;
    for (const l of merged.values()) {
      const { rows: nm } = await c.query(
        `SELECT m.name, m.track_stock, v.name AS variant_name FROM prd_merchandise m
           LEFT JOIN prd_merchandise_variants v ON v.id = $2 AND v.merchandise_id = m.id
          WHERE m.id = $1 AND m.business_id = $3`, [l.merchandiseId, l.variantId, args.businessId]);
      if (!nm[0] || (l.variantId && !nm[0].variant_name)) throw new StockError('One of the items is not a product of this business.', 'INVALID');
      if (!nm[0].track_stock) throw new StockError(`${nm[0].name}: stock is not tracked.`, 'NOT_TRACKED');
      const base = { businessId: args.businessId, merchandiseId: l.merchandiseId, variantId: l.variantId };
      let out: { onHand: number; avgCostCents: number };
      try {
        out = await move(c, { ...base, locationId: args.fromLocationId }, { qty: -l.qty, reason: 'transfer_out', transferId, userId: args.userId, note: args.note });
      } catch (e) {
        if (e instanceof StockError) throw new StockError(`${itemName(nm[0].name, nm[0].variant_name)}: ${e.message}`, e.code);
        throw e;
      }
      await move(c, { ...base, locationId: args.toLocationId }, { qty: l.qty, reason: 'transfer_in', unitCostCents: out.avgCostCents, transferId, userId: args.userId, note: args.note });
    }
    return { id: transferId };
  });
}
