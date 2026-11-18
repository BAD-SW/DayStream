import type { PoolClient } from 'pg';
import { formatCurrency } from '@daystream/shared';
import { adminPool } from '../db/pool';
import { StockError, move, inTx } from './inventory.service';

/**
 * Purchase orders (spec 51, gap 7; design 7.7). An order placed with a vendor for tracked products,
 * delivered to one location. Draft: lines can be changed. Sent (by email, or marked sent): it can be
 * received, in one go or in parts; each receipt adds stock at the cost entered (moving the average
 * cost). What has been received and not yet billed can be turned into a vendor bill (Dr Inventory
 * 1300, Cr Accounts Payable 2100). An order is finished when all is received, or closed short.
 */

export type PoStatus = 'draft' | 'sent' | 'partly_received' | 'received' | 'closed' | 'cancelled';

export interface PoLineInput { merchandiseId: string; variantId: string | null; qtyOrdered: number; unitCostCents: number }

async function tenantOf(db: PoolClient | typeof adminPool, businessId: string): Promise<string> {
  const { rows } = await db.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  if (!rows[0]) throw new StockError('Business not found', 'INVALID');
  return rows[0].tenant_id;
}

/** Lines must be tracked products of the business, each option at most once. */
async function checkLines(c: PoolClient, businessId: string, lines: PoLineInput[]) {
  if (lines.length === 0) throw new StockError('Add at least one product.', 'INVALID');
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.qtyOrdered) || l.qtyOrdered <= 0) throw new StockError('Order a whole number of 1 or more of each product.', 'INVALID');
    if (!Number.isInteger(l.unitCostCents) || l.unitCostCents < 0) throw new StockError('Enter a cost of 0 or more for each product.', 'INVALID');
    const key = `${l.merchandiseId}:${l.variantId || ''}`;
    if (seen.has(key)) throw new StockError('Each product (or option) can be on the order once; change its quantity instead.', 'INVALID');
    seen.add(key);
    const { rows } = await c.query(
      `SELECT m.name, m.track_stock,
              (SELECT COUNT(*) FROM prd_merchandise_variants v WHERE v.merchandise_id = m.id AND v.status <> 'inactive')::int AS options,
              (SELECT 1 FROM prd_merchandise_variants v WHERE v.id = $2 AND v.merchandise_id = m.id) AS variant_ok
         FROM prd_merchandise m WHERE m.id = $1 AND m.business_id = $3`,
      [l.merchandiseId, l.variantId, businessId]);
    const p = rows[0];
    if (!p) throw new StockError('One of the products is not a product of this business.', 'INVALID');
    if (!p.track_stock) throw new StockError(`${p.name}: stock is not tracked. Turn on Track stock first.`, 'NOT_TRACKED');
    if (l.variantId ? !p.variant_ok : p.options > 0) throw new StockError(`${p.name}: choose one of its options.`, 'INVALID');
  }
}

async function writeLines(c: PoolClient, tenantId: string, businessId: string, poId: string, lines: PoLineInput[]) {
  await c.query('DELETE FROM inv_po_lines WHERE po_id = $1', [poId]);
  for (const l of lines) {
    await c.query(
      `INSERT INTO inv_po_lines (tenant_id, business_id, po_id, merchandise_id, variant_id, qty_ordered, unit_cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, businessId, poId, l.merchandiseId, l.variantId, l.qtyOrdered, l.unitCostCents]);
  }
}

/** Lock and load an order of the business. */
async function lockedPo(c: PoolClient, businessId: string, poId: string) {
  const { rows } = await c.query('SELECT * FROM inv_purchase_orders WHERE id = $1 AND business_id = $2 FOR UPDATE', [poId, businessId]);
  if (!rows[0]) throw new StockError('Purchase order not found', 'INVALID');
  return rows[0] as { id: string; status: PoStatus; location_id: string; vendor_id: string; po_number: string; tenant_id: string };
}

export async function createPo(args: {
  businessId: string; vendorId: string; locationId: string; expectedOn?: string | null; note?: string | null; userId: string; lines: PoLineInput[];
}): Promise<{ id: string }> {
  return inTx(async (c) => {
    await checkLines(c, args.businessId, args.lines);
    const tenantId = await tenantOf(c, args.businessId);
    // numbered one at a time per business: PO-0001, PO-0002, ...
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`inv_po_number:${args.businessId}`]);
    const { rows: n } = await c.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 'PO-([0-9]+)') AS INTEGER)), 0) + 1 AS next
         FROM inv_purchase_orders WHERE business_id = $1`, [args.businessId]);
    const poNumber = `PO-${String(n[0].next).padStart(4, '0')}`;
    const { rows } = await c.query(
      `INSERT INTO inv_purchase_orders (tenant_id, business_id, po_number, vendor_id, location_id, expected_on, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, args.businessId, poNumber, args.vendorId, args.locationId, args.expectedOn || null, args.note || null, args.userId]);
    await writeLines(c, tenantId, args.businessId, rows[0].id, args.lines);
    return { id: rows[0].id };
  });
}

/** Change a draft order (its vendor, location, date, note and lines). */
export async function updatePo(args: {
  businessId: string; poId: string; vendorId: string; locationId: string; expectedOn?: string | null; note?: string | null; lines: PoLineInput[];
}): Promise<void> {
  await inTx(async (c) => {
    const po = await lockedPo(c, args.businessId, args.poId);
    if (po.status !== 'draft') throw new StockError('Only a draft purchase order can be changed.', 'INVALID');
    await checkLines(c, args.businessId, args.lines);
    await c.query(
      `UPDATE inv_purchase_orders SET vendor_id = $2, location_id = $3, expected_on = $4, note = $5, updated_at = NOW() WHERE id = $1`,
      [po.id, args.vendorId, args.locationId, args.expectedOn || null, args.note || null]);
    await writeLines(c, po.tenant_id, args.businessId, po.id, args.lines);
  });
}

export async function listPos(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT po.id, po.po_number, po.status, po.expected_on, po.created_at, po.sent_at, po.note,
            v.name AS vendor_name, l.name AS location_name,
            COALESCE(SUM(pl.qty_ordered), 0)::int AS qty_ordered, COALESCE(SUM(pl.qty_received), 0)::int AS qty_received,
            COALESCE(SUM(pl.qty_ordered * pl.unit_cost_cents), 0)::bigint AS total_cents,
            COALESCE(SUM((pl.qty_received - pl.qty_billed) * pl.unit_cost_cents), 0)::bigint AS to_bill_cents
       FROM inv_purchase_orders po
       JOIN fin_vendors v ON v.id = po.vendor_id
       JOIN sys_locations l ON l.id = po.location_id
       LEFT JOIN inv_po_lines pl ON pl.po_id = po.id
      WHERE po.business_id = $1
      GROUP BY po.id, v.name, l.name
      ORDER BY po.created_at DESC
      LIMIT 500`,
    [businessId]);
  return rows.map((r: { total_cents: string; to_bill_cents: string }) => ({ ...r, total_cents: Number(r.total_cents), to_bill_cents: Number(r.to_bill_cents) }));
}

export async function getPo(businessId: string, poId: string) {
  const { rows } = await adminPool.query(
    `SELECT po.*, v.name AS vendor_name, v.email AS vendor_email, v.payment_terms AS vendor_payment_terms, l.name AS location_name,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS created_by_name
       FROM inv_purchase_orders po
       JOIN fin_vendors v ON v.id = po.vendor_id
       JOIN sys_locations l ON l.id = po.location_id
       LEFT JOIN usr_users u ON u.id = po.created_by
      WHERE po.id = $1 AND po.business_id = $2`,
    [poId, businessId]);
  if (!rows[0]) return null;
  const NIL = '00000000-0000-0000-0000-000000000000';
  const { rows: lines } = await adminPool.query(
    `SELECT pl.id, pl.merchandise_id, pl.variant_id, m.name AS product_name, v.name AS variant_name,
            COALESCE(v.sku, m.sku) AS sku, pl.qty_ordered, pl.qty_received, pl.qty_billed, pl.unit_cost_cents,
            COALESCE(s.on_hand, 0) AS on_hand
       FROM inv_po_lines pl
       JOIN prd_merchandise m ON m.id = pl.merchandise_id
       LEFT JOIN prd_merchandise_variants v ON v.id = pl.variant_id
       LEFT JOIN inv_stock s ON s.location_id = $2 AND s.merchandise_id = pl.merchandise_id
            AND COALESCE(s.variant_id, '${NIL}'::uuid) = COALESCE(pl.variant_id, '${NIL}'::uuid)
      WHERE pl.po_id = $1
      ORDER BY m.name, v.name`,
    [poId, rows[0].location_id]);
  const { rows: bills } = await adminPool.query(
    'SELECT id, invoice_number, amount, due_date, status, created_at FROM fin_bills WHERE purchase_order_id = $1 ORDER BY created_at', [poId]);
  return { ...rows[0], lines, bills };
}

/** Sent to the vendor: by email (when asked and the vendor has one), or only marked as sent. */
export async function sendPo(businessId: string, poId: string, opts: { email: boolean }): Promise<{ emailedTo: string | null }> {
  const po = await getPo(businessId, poId);
  if (!po) throw new StockError('Purchase order not found', 'INVALID');
  if (po.status !== 'draft' && po.status !== 'sent') throw new StockError('This purchase order has already been received.', 'INVALID');
  let emailedTo: string | null = null;
  if (opts.email) {
    if (!po.vendor_email) throw new StockError(`${po.vendor_name} has no email address. Add one to the vendor, or mark the order as sent.`, 'INVALID');
    const { rows: biz } = await adminPool.query('SELECT name, email, currency FROM sys_businesses WHERE id = $1', [businessId]);
    const { sendEmail } = await import('./email.service');
    // The business's Purchase Order template (Settings > Templates), when it has an active one;
    // otherwise the built-in layout. Replies go to the template's reply-to, else the business email.
    const { selectTemplate, resolveAndRender } = await import('./document-branding-resolver.service');
    const template = await selectTemplate(businessId, 'purchase_order.sent', null);
    if (template) {
      const doc = await resolveAndRender(businessId, 'purchase_order.sent', await poTokenData(po), null, poDetailsTable(po, biz[0]?.currency || 'EUR'));
      await sendEmail({ to: po.vendor_email, from: doc.senderName || biz[0]?.name, replyTo: doc.replyTo || biz[0]?.email || undefined, subject: doc.subject, html: doc.html, text: doc.text });
    } else {
      await sendEmail({ to: po.vendor_email, from: biz[0]?.name, replyTo: biz[0]?.email || undefined,
        subject: `Purchase order ${po.po_number} from ${biz[0]?.name ?? ''}`.trim(), html: poEmailHtml(po, biz[0]?.name ?? '') });
    }
    emailedTo = po.vendor_email;
  }
  await adminPool.query(
    "UPDATE inv_purchase_orders SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = $1 AND status IN ('draft', 'sent')", [poId]);
  return { emailedTo };
}

type PoDetail = NonNullable<Awaited<ReturnType<typeof getPo>>>;
type PoDetailLine = { product_name: string; variant_name: string | null; sku: string | null; qty_ordered: number; unit_cost_cents: number };

/** The placeholder values of the Purchase Order template (purchase_order.sent). */
async function poTokenData(po: PoDetail): Promise<Record<string, unknown>> {
  const { rows: v } = await adminPool.query('SELECT contact_name FROM fin_vendors WHERE id = $1', [po.vendor_id]);
  const { rows: l } = await adminPool.query(
    'SELECT address_line1, address_line2, city, postal_code, country FROM sys_locations WHERE id = $1', [po.location_id]);
  const a = l[0] || {};
  return {
    vendor_name: po.vendor_name,
    vendor_contact_name: v[0]?.contact_name || '',
    po_number: po.po_number,
    po_date: po.sent_at || new Date().toISOString(),
    expected_date: po.expected_on,
    deliver_to: po.location_name,
    deliver_to_address: [a.address_line1, a.address_line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', '),
    po_total_cents: po.lines.reduce((t: number, x: PoDetailLine) => t + x.qty_ordered * x.unit_cost_cents, 0),
    po_note: po.note || '',
  };
}

/** The {{details_table}} of a purchase order: each product with its unit cost, quantity and amount. */
function poDetailsTable(po: PoDetail, currency: string) {
  const rows = po.lines.map((x: PoDetailLine) => ({
    description: `${x.product_name}${x.variant_name ? ` (${x.variant_name})` : ''}${x.sku ? ` · ${x.sku}` : ''} @ ${formatCurrency(x.unit_cost_cents, currency, 'en-US')}`,
    qty: x.qty_ordered,
    amountCents: x.qty_ordered * x.unit_cost_cents,
  }));
  return { rows, totalCents: rows.reduce((t: number, r: { amountCents: number }) => t + r.amountCents, 0), currency };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const money = (cents: number) => (cents / 100).toFixed(2);

function poEmailHtml(po: NonNullable<Awaited<ReturnType<typeof getPo>>>, businessName: string): string {
  const rows = po.lines.map((l: { product_name: string; variant_name: string | null; sku: string | null; qty_ordered: number; unit_cost_cents: number }) =>
    `<tr><td>${esc(l.product_name)}${l.variant_name ? ` (${esc(l.variant_name)})` : ''}</td><td>${esc(l.sku || '')}</td>`
    + `<td style="text-align:right">${l.qty_ordered}</td><td style="text-align:right">${money(l.unit_cost_cents)}</td>`
    + `<td style="text-align:right">${money(l.qty_ordered * l.unit_cost_cents)}</td></tr>`).join('');
  const total = po.lines.reduce((t: number, l: { qty_ordered: number; unit_cost_cents: number }) => t + l.qty_ordered * l.unit_cost_cents, 0);
  return `<p>Hello ${esc(po.vendor_name)},</p>
<p>Please supply the following for ${esc(businessName)}, delivered to ${esc(po.location_name)}${po.expected_on ? ` by ${esc(String(po.expected_on).slice(0, 10))}` : ''}.</p>
<p><strong>Purchase order ${esc(po.po_number)}</strong></p>
<table cellpadding="6" style="border-collapse:collapse" border="1">
<tr><th align="left">Product</th><th align="left">SKU</th><th>Quantity</th><th>Unit cost</th><th>Total</th></tr>
${rows}
<tr><td colspan="4" align="right"><strong>Total</strong></td><td style="text-align:right"><strong>${money(total)}</strong></td></tr>
</table>
${po.note ? `<p>${esc(po.note)}</p>` : ''}
<p>Please quote ${esc(po.po_number)} on your delivery note and invoice.</p>
<p>${esc(businessName)}</p>`;
}

/** Receive some or all of what is still to come; each line adds stock at its cost. */
export async function receivePo(args: {
  businessId: string; poId: string; userId: string; note?: string | null;
  lines: Array<{ lineId: string; qty: number; unitCostCents?: number | null }>;
}): Promise<{ status: PoStatus }> {
  return inTx(async (c) => {
    const po = await lockedPo(c, args.businessId, args.poId);
    if (po.status === 'draft') throw new StockError('Send the purchase order (or mark it as sent) before receiving it.', 'INVALID');
    if (!['sent', 'partly_received'].includes(po.status)) throw new StockError('Everything on this purchase order has been received, or it is closed.', 'INVALID');
    let any = false;
    for (const r of args.lines) {
      if (!r.qty) continue;
      if (!Number.isInteger(r.qty) || r.qty < 0) throw new StockError('Received quantities are whole numbers of 0 or more.', 'INVALID');
      const { rows } = await c.query(
        `SELECT pl.*, m.name AS product_name, v.name AS variant_name FROM inv_po_lines pl
           JOIN prd_merchandise m ON m.id = pl.merchandise_id LEFT JOIN prd_merchandise_variants v ON v.id = pl.variant_id
          WHERE pl.id = $1 AND pl.po_id = $2 FOR UPDATE OF pl`, [r.lineId, po.id]);
      const line = rows[0];
      if (!line) throw new StockError('A line is not on this purchase order.', 'INVALID');
      const left = line.qty_ordered - line.qty_received;
      const name = line.variant_name ? `${line.product_name} (${line.variant_name})` : line.product_name;
      if (r.qty > left) throw new StockError(`${name}: only ${left} still to come.`, 'INVALID');
      const cost = r.unitCostCents ?? line.unit_cost_cents;
      if (!Number.isInteger(cost) || cost < 0) throw new StockError(`${name}: enter a cost of 0 or more.`, 'INVALID');
      await move(c, { businessId: args.businessId, locationId: po.location_id, merchandiseId: line.merchandise_id, variantId: line.variant_id }, {
        qty: r.qty, reason: 'receive', unitCostCents: cost, poLineId: line.id, userId: args.userId,
        note: args.note ? `${po.po_number}: ${args.note}` : po.po_number,
      });
      // the line keeps one cost: what is not yet billed is billed at the cost last received
      await c.query('UPDATE inv_po_lines SET qty_received = qty_received + $2, unit_cost_cents = $3, updated_at = NOW() WHERE id = $1', [line.id, r.qty, cost]);
      any = true;
    }
    if (!any) throw new StockError('Enter how many arrived of at least one product.', 'INVALID');
    const { rows: t } = await c.query('SELECT BOOL_AND(qty_received >= qty_ordered) AS all_in FROM inv_po_lines WHERE po_id = $1', [po.id]);
    const status: PoStatus = t[0].all_in ? 'received' : 'partly_received';
    await c.query('UPDATE inv_purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1', [po.id, status]);
    return { status };
  });
}

/** Turn what has been received and not yet billed into a vendor bill (Dr Inventory, Cr Accounts Payable). */
export async function billPo(args: {
  businessId: string; poId: string; userId: string; invoiceNumber?: string | null; dueDate?: string | null;
}): Promise<{ billId: string; amount: number }> {
  return inTx(async (c) => {
    const po = await lockedPo(c, args.businessId, args.poId);
    const { rows: lines } = await c.query(
      `SELECT pl.id, pl.qty_received - pl.qty_billed AS qty, pl.unit_cost_cents, m.name AS product_name, v.name AS variant_name
         FROM inv_po_lines pl JOIN prd_merchandise m ON m.id = pl.merchandise_id LEFT JOIN prd_merchandise_variants v ON v.id = pl.variant_id
        WHERE pl.po_id = $1 AND pl.qty_received > pl.qty_billed ORDER BY m.name, v.name FOR UPDATE OF pl`, [po.id]);
    if (lines.length === 0) throw new StockError('Nothing received is waiting to be billed.', 'INVALID');
    const { rows: acct } = await c.query("SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1300'", [args.businessId]);
    if (!acct[0]) throw new StockError('The Inventory account (1300) is missing from the chart of accounts.', 'INVALID');
    const { rows: vendor } = await c.query('SELECT payment_terms FROM fin_vendors WHERE id = $1', [po.vendor_id]);
    const amount = lines.reduce((t: number, l: { qty: number; unit_cost_cents: number }) => t + l.qty * l.unit_cost_cents, 0);
    const due = args.dueDate || new Date(Date.now() + (Number(vendor[0]?.payment_terms) || 0) * 86400000).toISOString().slice(0, 10);
    const { createBill } = await import('./bills.service');
    const bill = await createBill({
      businessId: args.businessId, vendorId: po.vendor_id, invoiceNumber: args.invoiceNumber || undefined, amount, dueDate: due,
      description: `Purchase order ${po.po_number}`, accountId: acct[0].id, createdBy: args.userId,
      lineItems: lines.map((l: { qty: number; unit_cost_cents: number; product_name: string; variant_name: string | null }) => ({
        description: l.variant_name ? `${l.product_name} (${l.variant_name})` : l.product_name, quantity: l.qty, unit_price: l.unit_cost_cents, account_id: acct[0].id,
      })),
    });
    // The goods were received against the order, so its bill is approved at once and can be paid
    // (owner, 19 Nov 2026).
    await c.query(
      "UPDATE fin_bills SET purchase_order_id = $2, status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW() WHERE id = $1",
      [bill.id, po.id, args.userId]);
    for (const l of lines) await c.query('UPDATE inv_po_lines SET qty_billed = qty_billed + $2, updated_at = NOW() WHERE id = $1', [l.id, l.qty]);
    return { billId: bill.id as string, amount };
  });
}

/** A draft or sent order with nothing received is cancelled; a partly received one is closed (the rest is not coming). */
export async function closePo(businessId: string, poId: string): Promise<{ status: PoStatus }> {
  return inTx(async (c) => {
    const po = await lockedPo(c, businessId, poId);
    let status: PoStatus;
    if (po.status === 'draft' || po.status === 'sent') status = 'cancelled';
    else if (po.status === 'partly_received') status = 'closed';
    else throw new StockError('This purchase order is already finished.', 'INVALID');
    await c.query('UPDATE inv_purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1', [po.id, status]);
    return { status };
  });
}
