import { reportDb } from '../lib/report-db';
import { ReportDefinition } from '../types';

/**
 * Inventory reports (spec 51, gap 7; owner, 19 Nov 2026: their own Inventory category).
 *
 * A stock item is a tracked product without variants, or one active variant of it, at one active
 * location. Stock on Hand & Value and Low Stock are point-in-time snapshots (the date range does
 * not apply, as in Active Memberships and Gift Cards); Stock Movements covers the date range.
 * Business-scoped via ctx.businessId.
 */

const NIL = '00000000-0000-0000-0000-000000000000';

/** Every stock item of the business at every active location, with what is on hand there. */
const STOCK_ITEMS = `
  SELECT m.id AS merchandise_id, m.name AS product, v.name AS variant,
         COALESCE(v.sku, m.sku) AS sku, COALESCE(v.barcode, m.barcode) AS barcode,
         COALESCE(fv.name, '') AS supplier, COALESCE(c.name, '') AS category,
         l.id AS location_id, l.name AS location, l.is_primary,
         COALESCE(v.price, m.price) AS price, COALESCE(v.cost_cents, m.cost_cents) AS cost_price,
         COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.avg_cost_cents, 0) AS avg_cost,
         s.reorder_level, s.reorder_qty, v.id AS variant_id, COALESCE(v.display_order, 0) AS variant_order
    FROM prd_merchandise m
    LEFT JOIN prd_merchandise_variants v ON v.merchandise_id = m.id AND v.status <> 'inactive'
    LEFT JOIN fin_vendors fv ON fv.id = m.supplier_id
    LEFT JOIN svc_categories c ON c.id = m.category_id
    JOIN sys_locations l ON l.business_id = m.business_id AND l.status = 'active'
    LEFT JOIN inv_stock s ON s.location_id = l.id AND s.merchandise_id = m.id
         AND COALESCE(s.variant_id, '${NIL}'::uuid) = COALESCE(v.id, '${NIL}'::uuid)
   WHERE m.business_id = $1 AND m.track_stock = true AND m.status <> 'archived'`;

// SKU, Barcode, Supplier, Status and Category columns dropped (owner, 19 Nov 2026).
export const stockOnHandValueReport: ReportDefinition = {
  id: 'inventory-stock-value',
  title: 'Stock on Hand & Value',
  asOf: true,
  // Always grouped by location, with no Group by options; the location is the group's title, not a column.
  groupBy: ['location'],
  // Header layout (owner, 19 Nov 2026): figures can be sorted but have no value filter (the funnel
  // pushed the icons onto a line of their own), labels are kept short, and the figures get the room.
  columns: [
    { key: 'product', header: 'Product', type: 'text', filterable: true, width: '13%', link: { to: 'product', idKey: 'merchandise_id' } },
    { key: 'variant', header: 'Variant', type: 'text', filterable: true, width: '13%' },
    { key: 'location', header: 'Location', type: 'text', hidden: true },
    { key: 'on_hand', header: 'On Hand', type: 'number', filterable: false, width: '8%', total: true },
    { key: 'reorder_level', header: 'Reorder At', type: 'number', filterable: false, width: '8%' },
    { key: 'cost_price', header: 'Cost Price', type: 'currency', filterable: false, width: '8%' },
    { key: 'avg_cost', header: 'Avg Cost', type: 'currency', filterable: false, width: '8%' },
    { key: 'stock_value', header: 'Stock Value', type: 'currency', filterable: false, width: '9%', total: true },
    { key: 'price', header: 'Retail Price', type: 'currency', filterable: false, width: '8%' },
    { key: 'retail_value', header: 'Retail Value', type: 'currency', filterable: false, width: '9%', total: true },
    { key: 'margin', header: 'Margin', type: 'currency', filterable: false, width: '8%' },
    { key: 'margin_pct', header: 'Margin %', type: 'percent', filterable: false, width: '8%' },
  ],
  run: async (ctx) => {
    // As of ctx.end (owner, 19 Nov 2026): on hand and average cost are rebuilt from the stock history
    // up to the end of that day, in the business's time zone, exactly as the stock service kept them
    // (each movement in at its unit cost moves the average; out leaves it). Before stock tracking
    // started an item had nothing on hand. Prices, cost prices and reorder levels are today's.
    const { rows: items } = await reportDb.query(
      `${STOCK_ITEMS} ORDER BY m.name, COALESCE(v.display_order, 0), v.name, l.is_primary DESC, l.name`, [ctx.businessId]);
    const { rows: moves } = await reportDb.query(
      `SELECT location_id, merchandise_id, variant_id, qty_change, unit_cost_cents
         FROM inv_movements
        WHERE business_id = $1 AND created_at::date <= $2::date AND qty_change <> 0
        ORDER BY created_at, id`,
      [ctx.businessId, ctx.end]);
    const key = (loc: string, m: string, v: string | null) => `${loc}:${m}:${v || ''}`;
    const held = new Map<string, { onHand: number; avg: number }>();
    for (const mv of moves as Array<{ location_id: string; merchandise_id: string; variant_id: string | null; qty_change: number; unit_cost_cents: number | null }>) {
      const k = key(mv.location_id, mv.merchandise_id, mv.variant_id);
      const s = held.get(k) || { onHand: 0, avg: 0 };
      if (mv.qty_change > 0 && mv.unit_cost_cents != null) {
        const before = Math.max(s.onHand, 0);
        s.avg = Math.round((before * s.avg + mv.qty_change * mv.unit_cost_cents) / (before + mv.qty_change));
      }
      s.onHand += mv.qty_change;
      held.set(k, s);
    }
    // Margin is the retail price less the average cost; an item never stocked at a known cost
    // uses its cost price. No cost known: no margin.
    return (items as Array<Record<string, any>>).map((i) => {
      const s = held.get(key(i.location_id, i.merchandise_id, i.variant_id)) || { onHand: 0, avg: 0 };
      const onHand = Math.max(0, s.onHand);
      const basis = s.avg > 0 ? s.avg : i.cost_price;
      const price = Number(i.price) || 0;
      return {
        merchandise_id: i.merchandise_id, product: i.product, variant: i.variant || '', location: i.location,
        on_hand: onHand, reorder_level: i.reorder_level, cost_price: i.cost_price,
        avg_cost: s.avg > 0 ? s.avg : null,
        stock_value: onHand * s.avg,
        price, retail_value: onHand * price,
        margin: basis == null ? null : price - basis,
        margin_pct: basis == null || price === 0 ? null : Math.round((1000 * (price - basis)) / price) / 10,
      };
    });
  },
};

export const lowStockReport: ReportDefinition = {
  id: 'inventory-low-stock',
  title: 'Low Stock',
  // As Stock on Hand & Value (owner, 19 Nov 2026): as of today, always grouped by location with no
  // Group by options, no SKU or Supplier, figures sortable without a value filter. Reorder Qty, On
  // Order and Reorder Cost are this report's own.
  asOf: true,
  groupBy: ['location'],
  columns: [
    // Product and Variant give up room so Reorder Cost fits on one line (owner, 19 Nov 2026).
    { key: 'product', header: 'Product', type: 'text', filterable: true, width: '17%', link: { to: 'product', idKey: 'merchandise_id' } },
    { key: 'variant', header: 'Variant', type: 'text', filterable: true, width: '17%' },
    { key: 'location', header: 'Location', type: 'text', hidden: true },
    { key: 'on_hand', header: 'On Hand', type: 'number', filterable: false, width: '10%', total: true },
    { key: 'reorder_level', header: 'Reorder At', type: 'number', filterable: false, width: '10%' },
    { key: 'reorder_qty', header: 'Reorder Qty', type: 'number', filterable: false, width: '10%', total: true },
    { key: 'on_order', header: 'On Order', type: 'number', filterable: false, width: '10%', total: true },
    { key: 'cost_price', header: 'Cost Price', type: 'currency', filterable: false, width: '10%' },
    { key: 'reorder_cost', header: 'Reorder Cost', type: 'currency', filterable: false, width: '16%', total: true },
  ],
  run: async (ctx) => {
    // On Order: still to come on purchase orders sent to the vendor for that location.
    // Reorder Cost: the reorder quantity at the cost price (else the average cost).
    const { rows } = await reportDb.query(
      `WITH i AS (${STOCK_ITEMS})
       SELECT i.merchandise_id, i.product, COALESCE(i.variant, '') AS variant, i.location,
              i.on_hand, i.reorder_level, i.reorder_qty,
              COALESCE((SELECT SUM(pl.qty_ordered - pl.qty_received)
                          FROM inv_po_lines pl JOIN inv_purchase_orders po ON po.id = pl.po_id
                         WHERE po.business_id = $1 AND po.location_id = i.location_id AND po.status IN ('sent', 'partly_received')
                           AND pl.merchandise_id = i.merchandise_id
                           AND COALESCE(pl.variant_id, '${NIL}'::uuid) = COALESCE(i.variant_id, '${NIL}'::uuid)), 0)::int AS on_order,
              i.cost_price,
              CASE WHEN i.reorder_qty IS NULL THEN NULL
                   ELSE i.reorder_qty * COALESCE(i.cost_price, NULLIF(i.avg_cost, 0), 0) END AS reorder_cost
         FROM i
        WHERE i.reorder_level IS NOT NULL AND i.on_hand <= i.reorder_level
        ORDER BY i.product, i.variant_order, i.variant, i.is_primary DESC, i.location`,
      [ctx.businessId],
    );
    return rows;
  },
};

export const stockMovementsReport: ReportDefinition = {
  id: 'inventory-movements',
  title: 'Stock Movements',
  // As Stock on Hand & Value (owner, 19 Nov 2026), keeping its From and To dates: always grouped by
  // location with no Group by options, figures sortable without a value filter; the text columns
  // keep their filters.
  groupBy: ['location'],
  // Time, Reference and Note dropped; the widths keep every header clear of its icons (owner, 19 Nov 2026).
  columns: [
    { key: 'moved_on', header: 'Date', type: 'date', filterable: true, width: '10%' },
    { key: 'product', header: 'Product', type: 'text', filterable: true, width: '13%', link: { to: 'product', idKey: 'merchandise_id' } },
    { key: 'variant', header: 'Variant', type: 'text', filterable: true, width: '12%' },
    { key: 'location', header: 'Location', type: 'text', hidden: true },
    { key: 'movement', header: 'Movement', type: 'text', filterable: true, width: '13%' },
    { key: 'reason', header: 'Reason', type: 'text', filterable: true, width: '11%' },
    { key: 'qty_change', header: 'Change', type: 'number', filterable: false, width: '8%', total: true },
    { key: 'unit_cost', header: 'Unit Cost', type: 'currency', filterable: false, width: '8%' },
    { key: 'value', header: 'Value', type: 'currency', filterable: false, width: '8%', total: true },
    { key: 'on_hand_after', header: 'On Hand After', type: 'number', filterable: false, width: '8%' },
    { key: 'by_name', header: 'By', type: 'text', filterable: true, width: '9%' },
  ],
  run: async (ctx) => {
    // Value is the change at its unit cost (stock in positive, stock out negative). A write-off on
    // a refund changes nothing on hand, so its value is 0.
    const { rows } = await reportDb.query(
      `SELECT mv.created_at::date AS moved_on, TO_CHAR(mv.created_at, 'HH24:MI') AS moved_at,
              m.id AS merchandise_id, m.name AS product, COALESCE(v.name, '') AS variant, l.name AS location,
              CASE mv.reason
                WHEN 'opening' THEN 'Opening stock' WHEN 'sale' THEN 'Sold' WHEN 'sale_cancelled' THEN 'Sale not completed'
                WHEN 'refund_restock' THEN 'Returned to stock' WHEN 'refund_write_off' THEN 'Returned, written off'
                WHEN 'receive' THEN 'Received' WHEN 'adjust' THEN 'Adjusted' WHEN 'count' THEN 'Counted'
                WHEN 'transfer_in' THEN 'Moved in' WHEN 'transfer_out' THEN 'Moved out' ELSE INITCAP(mv.reason) END AS movement,
              CASE mv.adjust_reason
                WHEN 'damaged' THEN 'Damaged' WHEN 'lost' THEN 'Lost or stolen' WHEN 'used_in_service' THEN 'Used in a service'
                WHEN 'found' THEN 'Found' WHEN 'correction' THEN 'Correction' ELSE COALESCE(INITCAP(mv.adjust_reason), '') END AS reason,
              mv.qty_change, mv.unit_cost_cents AS unit_cost,
              (mv.qty_change * COALESCE(mv.unit_cost_cents, 0))::bigint AS value,
              mv.on_hand_after,
              COALESCE(o.order_number, po.po_number, '') AS reference, o.id AS order_id,
              COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), '') AS by_name,
              COALESCE(mv.note, '') AS note
         FROM inv_movements mv
         JOIN prd_merchandise m ON m.id = mv.merchandise_id
         LEFT JOIN prd_merchandise_variants v ON v.id = mv.variant_id
         JOIN sys_locations l ON l.id = mv.location_id
         LEFT JOIN fin_orders o ON o.id = mv.order_id
         LEFT JOIN inv_po_lines pl ON pl.id = mv.po_line_id
         LEFT JOIN inv_purchase_orders po ON po.id = pl.po_id
         LEFT JOIN usr_users u ON u.id = mv.created_by
        WHERE mv.business_id = $1 AND mv.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY mv.created_at DESC`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows.map((r: Record<string, unknown>) => ({ ...r, value: Number(r.value) }));
  },
};
