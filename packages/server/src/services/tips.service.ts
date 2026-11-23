import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';

/**
 * Tips (spec 51, gap 14; design 14). A tip is charged with the sale (fin_orders.tip_amount, next to
 * the sale's total_amount) but is never a sale: it is owed to the staff who served the customer
 * (2700 Tips Payable) until it is handed over (a cash or other manual payment) or paid in payroll
 * (card and other electronic payments). Each staff member's part is a row of fin_tip_shares.
 */

export class TipError extends Error {
  constructor(message: string, public code: string) { super(message); this.name = 'TipError'; }
}

type Db = PoolClient | typeof adminPool;

export interface TipSettings {
  enabled: boolean;
  /** The tip slider at Checkout: where it starts, and its highest percentage (owner, 23 Nov 2026). */
  defaultPercent: number;
  maxPercent: number;
  /** A tip may be added to cash and other manual payments (false: card payments only). */
  onManual: boolean;
  /** How a tip is shared between the staff on the order: by the value of their services, or evenly. */
  split: 'value' | 'even';
  /** What a suggested percentage is of: the total before tax (default) or including tax. */
  base: 'before_tax' | 'after_tax';
}

const DEFAULTS: TipSettings = { enabled: false, defaultPercent: 15, maxPercent: 30, onManual: true, split: 'value', base: 'before_tax' };
const KEYS = { enabled: 'tips.enabled', defaultPercent: 'tips.default_percent', maxPercent: 'tips.max_percent', onManual: 'tips.on_manual', split: 'tips.split', base: 'tips.base' } as const;

/** Methods whose money arrives electronically: their tips are paid in payroll. */
const ELECTRONIC = new Set(['card', 'bank_draw', 'google_pay', 'apple_pay', 'gift_card']);
/** Methods recorded by hand: the tip is handed to staff at the time. */
export const MANUAL_TIP_METHODS = new Set(['cash', 'bank_transfer', 'transfer', 'check', 'other']);
export const isElectronic = (method: string | null | undefined) => ELECTRONIC.has(String(method || ''));

const asBool = (v: unknown, d: boolean) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : d);
/** A whole percentage from `lo` to 100, else the default. */
const asPercent = (v: unknown, d: number, lo: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= 100 ? n : d;
};
/** The slider's highest percentage (1 to 100), and its default within it. */
function slider(defaultPercent: unknown, maxPercent: unknown): { defaultPercent: number; maxPercent: number } {
  const max = asPercent(maxPercent, DEFAULTS.maxPercent, 1);
  return { maxPercent: max, defaultPercent: Math.min(asPercent(defaultPercent, DEFAULTS.defaultPercent, 0), max) };
}

export async function getTipSettings(businessId: string, db: Db = adminPool): Promise<TipSettings> {
  const { rows } = await db.query(
    `SELECT d.key, COALESCE(b.value, d.default_value) AS value
       FROM sys_configuration_definitions d
       LEFT JOIN sys_business_configurations b ON b.key = d.key AND b.business_id = $1
      WHERE d.key = ANY($2)`,
    [businessId, Object.values(KEYS)]);
  const v = (k: string) => rows.find((r: { key: string }) => r.key === k)?.value;
  return {
    enabled: asBool(v(KEYS.enabled), DEFAULTS.enabled),
    ...slider(v(KEYS.defaultPercent), v(KEYS.maxPercent)),
    onManual: asBool(v(KEYS.onManual), DEFAULTS.onManual),
    split: v(KEYS.split) === 'even' ? 'even' : 'value',
    base: v(KEYS.base) === 'after_tax' ? 'after_tax' : 'before_tax',
  };
}

export async function setTipSettings(businessId: string, userId: string, s: TipSettings): Promise<TipSettings> {
  const range = slider(s.defaultPercent, s.maxPercent);
  const values: Record<string, string> = {
    [KEYS.enabled]: String(!!s.enabled),
    [KEYS.defaultPercent]: String(range.defaultPercent),
    [KEYS.maxPercent]: String(range.maxPercent),
    [KEYS.onManual]: String(!!s.onManual),
    [KEYS.split]: s.split === 'even' ? 'even' : 'value',
    [KEYS.base]: s.base === 'after_tax' ? 'after_tax' : 'before_tax',
  };
  for (const [key, value] of Object.entries(values)) {
    await adminPool.query(
      `INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (business_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [businessId, key, value, userId]);
  }
  return getTipSettings(businessId);
}

export interface TipShare { user_id: string; name: string; amount_cents: number }

/**
 * The orders a tip is based on: the order itself and, at the visit of an appointment paid at
 * reservation, the order that paid the service (shown on the visit's order, read only).
 */
async function tipOrders(orderId: string, db: Db): Promise<{ ids: string[]; prepaidId: string | null }> {
  const { rows } = await db.query('SELECT booking_id FROM fin_orders WHERE id = $1', [orderId]);
  const { findPrepaidOrderId } = await import('./prepaid-order.service');
  const prepaidId = rows[0] ? await findPrepaidOrderId(orderId, rows[0].booking_id, db) : null;
  return { ids: prepaidId ? [orderId, prepaidId] : [orderId], prepaidId };
}

/** What a suggested percentage is of: the order's total and tax, with a service paid at reservation (not refunded). */
async function tipBaseOf(orderId: string, db: Db = adminPool): Promise<{ total: number; tax: number; hasPrepaid: boolean }> {
  const { ids, prepaidId } = await tipOrders(orderId, db);
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0)::int AS total, COALESCE(SUM(tax_amount), 0)::int AS tax
       FROM fin_orders WHERE id = ANY($1::uuid[]) AND (id = $2 OR status = 'completed')`, [ids, orderId]);
  return { total: rows[0].total, tax: rows[0].tax, hasPrepaid: !!prepaidId };
}

/**
 * The staff on an order's lines (a line's credit, else the order's), with the value of their
 * lines; at a prepaid appointment's visit, with the lines of the order that paid the service.
 */
async function staffOnOrder(orderId: string, db: Db): Promise<Array<{ user_id: string; name: string; value: number }>> {
  const { ids } = await tipOrders(orderId, db);
  const { rows } = await db.query(
    `SELECT COALESCE(oi.credited_to, o.credited_to) AS user_id,
            MIN(TRIM(CONCAT(u.first_name, ' ', u.last_name))) AS name,
            SUM(GREATEST(oi.total_price, 0))::bigint AS value
       FROM fin_order_items oi
       JOIN fin_orders o ON o.id = oi.order_id
       JOIN usr_users u ON u.id = COALESCE(oi.credited_to, o.credited_to)
      WHERE oi.order_id = ANY($1::uuid[]) AND COALESCE(oi.credited_to, o.credited_to) IS NOT NULL
      GROUP BY 1
      ORDER BY 2`,
    [ids]);
  if (rows.length > 0) return rows.map((r: { user_id: string; name: string; value: string }) => ({ ...r, value: Number(r.value) }));
  // No line credited: the order's own credit.
  const { rows: o } = await db.query(
    `SELECT o.credited_to AS user_id, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name
       FROM fin_orders o JOIN usr_users u ON u.id = o.credited_to WHERE o.id = $1`, [orderId]);
  return o.map((r: { user_id: string; name: string }) => ({ ...r, value: 0 }));
}

/** Split cents by weights (largest remainder), so the parts always add up to the whole. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (total * x) / wsum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i] += 1;
  return parts;
}

/**
 * Who gets an order's tip: the split set by hand, else the staff on the order shared by the
 * business's rule (by value or evenly). Empty when no staff member is on the order.
 */
export async function sharesFor(orderId: string, db: Db = adminPool): Promise<{ shares: TipShare[]; byHand: boolean; staff: Array<{ user_id: string; name: string }> }> {
  const { rows } = await db.query('SELECT business_id, tip_amount, tip_split FROM fin_orders WHERE id = $1', [orderId]);
  if (!rows[0]) throw new TipError('Order not found', 'NOT_FOUND');
  const tip = Number(rows[0].tip_amount) || 0;
  const staff = await staffOnOrder(orderId, db);
  const plain = staff.map(({ user_id, name }) => ({ user_id, name }));
  const manual = Array.isArray(rows[0].tip_split) ? (rows[0].tip_split as Array<{ user_id: string; amount_cents: number }>) : null;
  if (manual && manual.reduce((t, s) => t + s.amount_cents, 0) === tip) {
    const { rows: names } = await db.query(
      `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM usr_users WHERE id = ANY($1::uuid[])`, [manual.map((s) => s.user_id)]);
    return {
      byHand: true, staff: plain,
      shares: manual.filter((s) => s.amount_cents > 0).map((s) => ({ ...s, name: names.find((n: { id: string }) => n.id === s.user_id)?.name || '' })),
    };
  }
  if (tip === 0 || staff.length === 0) return { shares: [], byHand: false, staff: plain };
  const { split } = await getTipSettings(rows[0].business_id, db);
  const parts = allocate(tip, split === 'even' ? staff.map(() => 1) : staff.map((s) => s.value));
  return { byHand: false, staff: plain, shares: staff.map((s, i) => ({ user_id: s.user_id, name: s.name, amount_cents: parts[i] })).filter((s) => s.amount_cents > 0) };
}

/** A suggested percentage of the order: of the total before tax (the default) or including tax. */
const tipFromPercent = (s: TipSettings, totalAmount: number, taxAmount: number, percent: number): number =>
  Math.max(0, Math.round(((s.base === 'after_tax' ? totalAmount : totalAmount - taxAmount) * percent) / 100));

/**
 * Keep an open order's tip in step with the order (owner, 23 Nov 2026), after its lines, promo
 * or staff change: a tip picked as a percentage is worked out again; an order with no lines left
 * has no tip; and a split by hand is dropped when the tip or the staff on the order change, so
 * the usual split applies to the order as it now is. A typed tip amount is kept as typed.
 */
export async function refreshOrderTip(orderId: string, opts: { staffChanged: boolean }): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT o.business_id, o.status, o.tip_amount, o.tip_percent, o.tip_split,
            (SELECT COUNT(*)::int FROM fin_order_items i WHERE i.order_id = o.id) AS lines
       FROM fin_orders o WHERE o.id = $1`, [orderId]);
  const o = rows[0];
  if (!o || o.status !== 'open') return;
  let tip = Number(o.tip_amount) || 0;
  let percent: number | null = o.tip_percent === null ? null : Number(o.tip_percent);
  const base = await tipBaseOf(orderId);
  // No lines left, and no service paid at reservation to tip on: no tip.
  if (o.lines === 0 && !base.hasPrepaid) { tip = 0; percent = null; }
  else if (percent !== null) tip = tipFromPercent(await getTipSettings(o.business_id), base.total, base.tax, percent);
  const dropSplit = o.tip_split !== null && (opts.staffChanged || tip !== Number(o.tip_amount));
  if (tip === Number(o.tip_amount) && percent === (o.tip_percent === null ? null : Number(o.tip_percent)) && !dropSplit) return;
  await adminPool.query(
    `UPDATE fin_orders SET tip_amount = $2, tip_percent = $3, tip_split = CASE WHEN $4 THEN NULL ELSE tip_split END, updated_at = NOW() WHERE id = $1`,
    [orderId, tip, percent, dropSplit]);
}

/**
 * Set (or clear) the tip on an open order; a split by hand must add up to the tip. A tip picked as
 * a suggested percentage is worked out here from the order and follows it if the order changes.
 */
export async function setOrderTip(args: {
  businessId: string; orderId: string; tipCents: number; percent?: number | null; split?: Array<{ user_id: string; amount_cents: number }> | null;
}): Promise<void> {
  const { rows } = await adminPool.query('SELECT status FROM fin_orders WHERE id = $1 AND business_id = $2', [args.orderId, args.businessId]);
  if (!rows[0]) throw new TipError('Order not found', 'NOT_FOUND');
  if (rows[0].status !== 'open') throw new TipError('The order is already paid.', 'CONFLICT');
  // 0 is a choice too (the slider at no tip), kept so the default is not put back.
  const percent = args.percent != null && args.percent >= 0 ? args.percent : null;
  if (percent !== null) {
    if (!(percent <= 100)) throw new TipError('Enter a percentage up to 100.', 'INVALID');
    const base = await tipBaseOf(args.orderId);
    args = { ...args, tipCents: tipFromPercent(await getTipSettings(args.businessId), base.total, base.tax, percent) };
  }
  if (!Number.isInteger(args.tipCents) || args.tipCents < 0) throw new TipError('Enter a tip of 0 or more.', 'INVALID');
  if (args.tipCents > 0 && !(await getTipSettings(args.businessId)).enabled) throw new TipError('Tipping is switched off for this business.', 'INVALID');
  let split: Array<{ user_id: string; amount_cents: number }> | null = null;
  if (args.split && args.split.length > 0 && args.tipCents > 0) {
    if (args.split.some((s) => !Number.isInteger(s.amount_cents) || s.amount_cents < 0)) throw new TipError('Each share is a whole amount of 0 or more.', 'INVALID');
    if (args.split.reduce((t, s) => t + s.amount_cents, 0) !== args.tipCents) throw new TipError('The shares must add up to the tip.', 'INVALID');
    const ids = [...new Set(args.split.map((s) => s.user_id))];
    if (ids.length !== args.split.length) throw new TipError('Each staff member can have one share.', 'INVALID');
    const { rows: ok } = await adminPool.query(
      `SELECT id FROM usr_users WHERE id = ANY($1::uuid[]) AND business_id = $2 AND persona = 'business'`, [ids, args.businessId]);
    if (ok.length !== ids.length) throw new TipError('A share is for someone who is not staff of this business.', 'INVALID');
    split = args.split.filter((s) => s.amount_cents > 0);
  }
  await adminPool.query(
    'UPDATE fin_orders SET tip_amount = $2, tip_split = $3, tip_percent = $4, updated_at = NOW() WHERE id = $1',
    [args.orderId, args.tipCents, split ? JSON.stringify(split) : null, percent]);
}

/**
 * When an order is paid: write each staff member's share. A tip on a manual payment is handed
 * over at the time (paid at once); an electronic one is owed until payroll pays it.
 */
export async function recordShares(orderId: string, paymentMethod: string): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT o.business_id, o.tip_amount, b.tenant_id FROM fin_orders o JOIN sys_businesses b ON b.id = o.business_id WHERE o.id = $1`, [orderId]);
  if (!rows[0] || !(Number(rows[0].tip_amount) > 0)) return;
  const { shares } = await sharesFor(orderId);
  const electronic = isElectronic(paymentMethod);
  // No staff member on the order: the tip goes to the business's tip pool, shared out later
  // (owner, 22 Nov 2026). A cash tip stays in the till until then.
  if (shares.length === 0) {
    await adminPool.query(
      // (the unique key does not cover a NULL user, so a second call must not add a second row)
      `INSERT INTO fin_tip_shares (tenant_id, business_id, order_id, user_id, amount_cents, electronic, status, paid_cents)
       SELECT $1, $2, $3, NULL, $4, $5, 'pool', 0
        WHERE NOT EXISTS (SELECT 1 FROM fin_tip_shares WHERE order_id = $3 AND user_id IS NULL)`,
      [rows[0].tenant_id, rows[0].business_id, orderId, Number(rows[0].tip_amount), electronic]);
    return;
  }
  for (const s of shares) {
    await adminPool.query(
      `INSERT INTO fin_tip_shares (tenant_id, business_id, order_id, user_id, amount_cents, electronic, status, paid_cents, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (order_id, user_id) DO NOTHING`,
      [rows[0].tenant_id, rows[0].business_id, orderId, s.user_id, s.amount_cents, electronic,
        electronic ? 'owed' : 'handed_over', electronic ? 0 : s.amount_cents, electronic ? null : new Date()]);
  }
}

/** Refund part of an order's tip: each share gives up its part, in the same proportions. */
export async function refundTipShares(client: PoolClient, orderId: string, cents: number): Promise<void> {
  if (!(cents > 0)) return;
  const { rows } = await client.query(
    // a pool share already shared out is not refunded itself: the staff shares made from it are
    `SELECT id, amount_cents, refunded_cents FROM fin_tip_shares WHERE order_id = $1 AND status <> 'allocated' ORDER BY id FOR UPDATE`, [orderId]);
  if (rows.length === 0) return;
  const left = rows.map((r: { amount_cents: number; refunded_cents: number }) => r.amount_cents - r.refunded_cents);
  const parts = allocate(cents, left);
  for (let i = 0; i < rows.length; i++) {
    const part = Math.min(parts[i], left[i]);
    if (part > 0) await client.query('UPDATE fin_tip_shares SET refunded_cents = refunded_cents + $2, updated_at = NOW() WHERE id = $1', [rows[i].id, part]);
  }
}

/**
 * Electronic tips owed to each staff member up to the end of a pay period (collected then or
 * earlier and not yet paid), for the payroll calculation; a share refunded after it was paid is
 * below zero, so the run takes it off.
 */
export async function tipsOwedForPayroll(businessId: string, periodEnd: string): Promise<Map<string, { cents: number; shares: Array<{ id: string; cents: number }> }>> {
  const { rows } = await adminPool.query(
    `SELECT s.id, s.user_id, (s.amount_cents - s.refunded_cents - s.paid_cents)::int AS owed
       FROM fin_tip_shares s
       JOIN sys_businesses b ON b.id = s.business_id
      WHERE s.business_id = $1 AND s.user_id IS NOT NULL
        AND (s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date <= $2::date
        -- electronic tips still owed; and any tip refunded after it was paid or handed over
        -- (below zero: the staff member gives it back through this pay run)
        AND ((s.electronic AND s.amount_cents - s.refunded_cents - s.paid_cents <> 0)
             OR s.amount_cents - s.refunded_cents - s.paid_cents < 0)`,
    [businessId, periodEnd]);
  const out = new Map<string, { cents: number; shares: Array<{ id: string; cents: number }> }>();
  for (const r of rows as Array<{ id: string; user_id: string; owed: number }>) {
    const e = out.get(r.user_id) || { cents: 0, shares: [] };
    e.cents += r.owed; e.shares.push({ id: r.id, cents: r.owed });
    out.set(r.user_id, e);
  }
  return out;
}

/** A finalised pay run paid these tips: they are no longer owed. */
export async function markTipsPaid(periodId: string, shares: Array<{ id: string; cents: number }>): Promise<void> {
  for (const s of shares) {
    await adminPool.query(
      `UPDATE fin_tip_shares SET paid_cents = paid_cents + $2, pay_period_id = $3, paid_at = NOW(), updated_at = NOW(),
              status = CASE WHEN amount_cents - refunded_cents - (paid_cents + $2) = 0 THEN 'paid' ELSE status END
        WHERE id = $1`,
      [s.id, s.cents, periodId]);
  }
}

// ---------------------------------------------------------------------------------------------
// The tip pool (owner, 22 Nov 2026): tips on orders with no staff member on them, shared out by
// the owner or a manager, by hand or among the staff clocked in on the day of each tip.
// ---------------------------------------------------------------------------------------------

export type PoolMode = 'hand' | 'hours' | 'even';

interface PoolShare { id: string; tenant_id: string; order_id: string; electronic: boolean; left: number; day: string }

/** Pool shares waiting to be shared out, tipped from `start` (or the beginning) to `end` (local days). */
async function waitingPool(businessId: string, start: string | null, end: string, db: Db = adminPool): Promise<PoolShare[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.tenant_id, s.order_id, s.electronic,
            (s.amount_cents - s.refunded_cents - s.paid_cents)::int AS left,
            to_char((s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date, 'YYYY-MM-DD') AS day
       FROM fin_tip_shares s JOIN sys_businesses b ON b.id = s.business_id
      WHERE s.business_id = $1 AND s.status = 'pool'
        AND s.amount_cents - s.refunded_cents - s.paid_cents > 0
        AND ($2::date IS NULL OR (s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date >= $2::date)
        AND (s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date <= $3::date
      ORDER BY s.created_at, s.id`,
    [businessId, start, end]);
  return rows;
}

/** What is waiting in the pool: in total, electronic and cash, and the first and last day. */
export async function poolSummary(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(s.amount_cents - s.refunded_cents - s.paid_cents), 0)::int AS waiting,
            COALESCE(SUM(CASE WHEN s.electronic THEN s.amount_cents - s.refunded_cents - s.paid_cents ELSE 0 END), 0)::int AS electronic,
            COUNT(*)::int AS tips,
            to_char(MIN((s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date), 'YYYY-MM-DD') AS first_day,
            to_char(MAX((s.created_at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date), 'YYYY-MM-DD') AS last_day
       FROM fin_tip_shares s JOIN sys_businesses b ON b.id = s.business_id
      WHERE s.business_id = $1 AND s.status = 'pool' AND s.amount_cents - s.refunded_cents - s.paid_cents > 0`,
    [businessId]);
  const r = rows[0];
  return { waiting_cents: r.waiting, electronic_cents: r.electronic, cash_cents: r.waiting - r.electronic, tips: r.tips, first_day: r.first_day, last_day: r.last_day };
}

/** The business's active staff logins. */
async function businessStaff(businessId: string, db: Db = adminPool): Promise<Array<{ user_id: string; name: string }>> {
  const { rows } = await db.query(
    `SELECT id AS user_id, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM usr_users
      WHERE business_id = $1 AND persona = 'business' AND COALESCE(status, 'active') = 'active' ORDER BY first_name, last_name`,
    [businessId]);
  return rows;
}

/** Minutes each staff member was clocked in on each local day of a range: day -> user -> minutes. */
async function clockedMinutesByDay(businessId: string, days: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (days.length === 0) return out;
  const sorted = [...days].sort();
  const start = sorted[0]; const end = sorted[sorted.length - 1];
  const { rows: tz } = await adminPool.query("SELECT COALESCE(timezone, 'UTC') AS tz FROM sys_businesses WHERE id = $1", [businessId]);
  const { rows: users } = await adminPool.query(
    `SELECT DISTINCT user_id FROM clk_events WHERE business_id = $1 AND event_at >= $2::date - INTERVAL '1 day' AND event_at < $3::date + INTERVAL '2 day'`,
    [businessId, start, end]);
  const { computeDailyHours } = await import('./clock.service');
  for (const u of users as Array<{ user_id: string }>) {
    for (const d of await computeDailyHours(businessId, u.user_id, start, end, tz[0].tz)) {
      if (!(d.worked_minutes > 0) || !days.includes(d.date)) continue;
      const m = out.get(d.date) || new Map<string, number>();
      m.set(u.user_id, (m.get(u.user_id) || 0) + d.worked_minutes);
      out.set(d.date, m);
    }
  }
  return out;
}

export interface PoolPlan {
  total_cents: number;
  /** Each staff member's part (and, sharing by the clock, their hours on the days shared). */
  staff: Array<{ user_id: string; name: string; amount_cents: number; hours: number }>;
  /** Shared by the clock: what stays in the pool because nobody was clocked in that day. */
  left_cents: number;
  /** By hand: what is still to be given to someone (sharing needs this to be 0). */
  unassigned_cents: number;
  days_without_staff: string[];
  /** Each pool share's parts: shareId -> [{ user_id, cents }]. */
  parts: Map<string, Array<{ user_id: string; cents: number }>>;
}

/**
 * Work out how the pool would be shared (nothing is changed): by hand (amounts per staff member
 * that add up to the pool for the period), or by the clock: each tip among the staff clocked in on
 * its day, by their hours that day or evenly.
 */
export async function planPool(args: {
  businessId: string; start: string | null; end: string; mode: PoolMode; amounts?: Array<{ user_id: string; amount_cents: number }>;
}): Promise<PoolPlan> {
  const shares = await waitingPool(args.businessId, args.start, args.end);
  const total = shares.reduce((t, s) => t + s.left, 0);
  const staff = await businessStaff(args.businessId);
  const nameOf = new Map(staff.map((s) => [s.user_id, s.name]));
  const parts = new Map<string, Array<{ user_id: string; cents: number }>>();
  const per = new Map<string, { amount: number; minutes: number }>();
  const add = (u: string, cents: number, minutes = 0) => { const e = per.get(u) || { amount: 0, minutes: 0 }; e.amount += cents; e.minutes += minutes; per.set(u, e); };
  let left = 0; let unassigned = 0; const emptyDays = new Set<string>();

  if (args.mode === 'hand') {
    const wanted = (args.amounts || []).filter((a) => a.amount_cents > 0);
    if (wanted.some((a) => !nameOf.has(a.user_id))) throw new TipError('A share is for someone who is not staff of this business.', 'INVALID');
    if (wanted.some((a) => !Number.isInteger(a.amount_cents))) throw new TipError('Each share is a whole amount.', 'INVALID');
    unassigned = total - wanted.reduce((t, a) => t + a.amount_cents, 0);
    if (unassigned < 0) throw new TipError('The shares come to more than is in the pool for these dates.', 'INVALID');
    // Fill each tip in turn from the staff still to be given their amount, so the totals are exact.
    const need = wanted.map((a) => ({ ...a }));
    for (const s of shares) {
      let room = s.left; const list: Array<{ user_id: string; cents: number }> = [];
      for (const n of need) {
        if (room === 0) break;
        const take = Math.min(room, n.amount_cents);
        if (take > 0) { list.push({ user_id: n.user_id, cents: take }); n.amount_cents -= take; room -= take; add(n.user_id, take); }
      }
      parts.set(s.id, list);
    }
  } else {
    const byDay = await clockedMinutesByDay(args.businessId, [...new Set(shares.map((s) => s.day))]);
    const counted = new Set<string>();
    for (const s of shares) {
      const day = byDay.get(s.day);
      if (!day || day.size === 0) { left += s.left; emptyDays.add(s.day); continue; }
      const users = [...day.keys()].sort();
      const split = allocate(s.left, args.mode === 'even' ? users.map(() => 1) : users.map((u) => day.get(u) || 0));
      const list = users.map((u, i) => ({ user_id: u, cents: split[i] })).filter((x) => x.cents > 0);
      parts.set(s.id, list);
      for (const x of list) add(x.user_id, x.cents);
      // each staff member's hours on each day counted once
      if (!counted.has(s.day)) { counted.add(s.day); for (const [u, m] of day) add(u, 0, m); }
    }
  }
  return {
    total_cents: total, left_cents: left, unassigned_cents: unassigned, days_without_staff: [...emptyDays].sort(), parts,
    staff: [...per.entries()].map(([user_id, e]) => ({ user_id, name: nameOf.get(user_id) || '', amount_cents: e.amount, hours: Math.round((e.minutes / 60) * 100) / 100 }))
      .filter((s) => s.amount_cents > 0).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Share the pool out as planned: each part becomes the staff member's own share of that tip
 * (electronic: owed until payroll; cash: handed over now, Dr 2700 / Cr 1100), and the pool share
 * is marked shared. A tip nobody could be given (no one clocked in that day) stays in the pool.
 */
export async function sharePool(args: {
  businessId: string; start: string | null; end: string; mode: PoolMode; amounts?: Array<{ user_id: string; amount_cents: number }>; userId: string;
}): Promise<{ shared_cents: number; left_cents: number; staff: PoolPlan['staff'] }> {
  const plan = await planPool(args);
  if (plan.unassigned_cents !== 0) throw new TipError('The shares must add up to what is in the pool for these dates.', 'INVALID');
  if (plan.total_cents - plan.left_cents <= 0) throw new TipError('There is nothing in the pool to share for these dates, or nobody was clocked in on those days.', 'INVALID');
  const client = await adminPool.connect();
  let cash = 0; let shared = 0;
  try {
    await client.query('BEGIN');
    for (const [shareId, list] of plan.parts) {
      const { rows } = await client.query(
        `SELECT id, tenant_id, order_id, electronic, created_at, (amount_cents - refunded_cents - paid_cents)::int AS left
           FROM fin_tip_shares WHERE id = $1 AND status = 'pool' FOR UPDATE`, [shareId]);
      const s = rows[0];
      const sum = list.reduce((t, x) => t + x.cents, 0);
      if (!s || s.left !== sum || sum === 0) {
        if (s && sum > 0) throw new TipError('The pool changed while it was being shared (a tip was refunded). Try again.', 'CONFLICT');
        continue;
      }
      for (const x of list) {
        await client.query(
          `INSERT INTO fin_tip_shares (tenant_id, business_id, order_id, user_id, amount_cents, electronic, status, paid_cents, paid_at, from_pool_share_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (order_id, user_id) DO UPDATE SET amount_cents = fin_tip_shares.amount_cents + EXCLUDED.amount_cents,
             paid_cents = fin_tip_shares.paid_cents + EXCLUDED.paid_cents, updated_at = NOW()`,
          [s.tenant_id, args.businessId, s.order_id, x.user_id, x.cents, s.electronic,
            s.electronic ? 'owed' : 'handed_over', s.electronic ? 0 : x.cents, s.electronic ? null : new Date(), s.id, s.created_at]);
      }
      await client.query(
        `UPDATE fin_tip_shares SET status = 'allocated', paid_cents = paid_cents + $2, paid_at = NOW(), updated_at = NOW() WHERE id = $1`, [s.id, sum]);
      shared += sum; if (!s.electronic) cash += sum;
    }
    // Cash taken from the till for the staff: Dr Tips Payable, Cr Cash.
    if (cash > 0) {
      const { rows: acc } = await client.query(
        `SELECT code, id FROM fin_chart_of_accounts WHERE business_id = $1 AND code IN ('2700', '1100')`, [args.businessId]);
      const tips = acc.find((a: { code: string }) => a.code === '2700')?.id; const till = acc.find((a: { code: string }) => a.code === '1100')?.id;
      if (tips && till) {
        const { rows: tz } = await client.query("SELECT COALESCE(timezone, 'UTC') AS tz FROM sys_businesses WHERE id = $1", [args.businessId]);
        const { rows: e } = await client.query(
          `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
           VALUES ($1, $2, 'Tip pool shared out (cash)', 'tip_pool', gen_random_uuid(), $3) RETURNING id`,
          [args.businessId, new Date().toLocaleDateString('sv-SE', { timeZone: tz[0].tz }), args.userId]);
        await client.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, $3, 0, 'Cash tips handed to staff'), ($1, $4, 0, $3, 'Cash tips handed to staff')`,
          [e[0].id, tips, cash, till]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
  return { shared_cents: shared, left_cents: plan.left_cents, staff: plan.staff };
}

/** The staff who can be given a share by hand. */
export async function poolStaff(businessId: string) { return businessStaff(businessId); }