import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';

/**
 * Paying with a membership or package (spec 51, gap 19; design 19). One place decides what a
 * customer's memberships (`mbr_*`) and packages (`pkg_*`) cover, holds an allowance for a booking,
 * counts it as used when the order is paid, and gives it back. New Appointment, the payment step,
 * the price shown while booking and Checkout all use it, so they never disagree.
 */

type Db = Pick<PoolClient, 'query'>;

export type BenefitKind = 'membership' | 'package';

/** A membership or package chosen to pay: the enrollment or purchase, and its item. */
export interface BenefitRef {
  kind: BenefitKind;
  /** mbr_enrollments.id or pkg_purchases.id */
  source_id: string;
  /** mbr_plan_items.id or pkg_package_items.id */
  item_id: string;
}

/** What is being paid for: a service (and option) or a product (and variant). */
export interface BenefitTarget {
  businessId: string;
  customerId: string;
  itemType: 'service' | 'product';
  /** svc_services.id or prd_merchandise.id */
  itemId: string;
  variantId?: string | null;
  /** When it is used: the appointment's start (or now, for a sale), or a day (YYYY-MM-DD) before a time is chosen. */
  on?: Date | string | null;
  /** People (a service) or items (a product). */
  quantity?: number;
  /** A service's length, for a minutes package. */
  minutes?: number | null;
}

export interface BenefitOption extends BenefitRef {
  name: string;
  /** What one use is counted in. */
  unit: 'uses' | 'sessions' | 'minutes' | 'items';
  /** The allowance in the window (membership) or in total (package); null: without limit. */
  allowance: number | null;
  used: number;
  held: number;
  /** allowance − used − held; null: without limit. */
  left: number | null;
  /** What this use needs, in the same unit. */
  needed: number;
  /** A membership's allowance window ('daily', 'weekly', 'monthly', 'unlimited'), and its days. */
  frequency: string | null;
  window_start: string | null;
  window_end: string | null;
  /** A package's expiry. */
  expires_at: string | null;
  covers: boolean;
  /** Why it does not cover this (used up, expired, not for this option, ...). */
  reason: string | null;
}

export class BenefitError extends Error {
  constructor(message: string, public code: 'NOT_COVERED' | 'NOT_FOUND' | 'INVALID') { super(message); this.name = 'BenefitError'; }
}

// ---------------------------------------------------------------------------------------------
// Days and windows, in the business's time zone
// ---------------------------------------------------------------------------------------------

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The local day (YYYY-MM-DD) of a moment in a time zone. */
export function localDay(at: Date, timeZone: string): string {
  return at.toLocaleDateString('sv-SE', { timeZone });
}

/**
 * The allowance window a day falls in: the day itself (daily), Monday to Sunday (weekly), or a
 * month counted from the membership's start day (monthly; the 31st is the last day of a short
 * month). Unlimited has no window.
 */
export function allowanceWindow(frequency: string, day: string, startDate: string): { start: string; end: string } | null {
  if (frequency === 'unlimited') return null;
  if (frequency === 'daily') return { start: day, end: day };
  if (frequency === 'weekly') {
    const dow = (parseDay(day).getUTCDay() + 6) % 7; // Monday 0
    const start = addDays(day, -dow);
    return { start, end: addDays(start, 6) };
  }
  // monthly (and anything else): from the start day of the month
  const anchor = Number(startDate.slice(8, 10));
  const at = (y: number, m: number) => {
    const yy = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12;
    return ymd(new Date(Date.UTC(yy, mm, Math.min(anchor, daysIn(yy, mm)))));
  };
  const d = parseDay(day); let y = d.getUTCFullYear(); let m = d.getUTCMonth();
  if (at(y, m) > day) m -= 1;
  const start = at(y, m);
  return { start, end: addDays(at(y, m + 1), -1) };
}

async function businessZone(businessId: string, db: Db): Promise<string> {
  const { rows } = await db.query("SELECT COALESCE(timezone, 'UTC') AS tz FROM sys_businesses WHERE id = $1", [businessId]);
  return rows[0]?.tz || 'UTC';
}

// ---------------------------------------------------------------------------------------------
// What covers
// ---------------------------------------------------------------------------------------------

/**
 * Every membership and package of the customer for this service or product, each marked as
 * covering it or not (with why not), most useful first: those that cover, the one that runs out
 * soonest first. `exceptUseIds` leaves out uses being replaced (a booking's own hold, when it is
 * moved or changed).
 */
export async function benefitOptions(t: BenefitTarget, opts: { exceptUseIds?: string[]; db?: Db } = {}): Promise<BenefitOption[]> {
  const db = opts.db || adminPool;
  const except = opts.exceptUseIds || [];
  const tz = await businessZone(t.businessId, db);
  // A day without a time (the day chosen in New Appointment, before its time): that day.
  const dayOnly = typeof t.on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.on);
  const on = t.on ? new Date(dayOnly ? `${t.on}T12:00:00Z` : t.on) : new Date();
  const day = dayOnly ? (t.on as string) : localDay(on, tz);
  const today = localDay(new Date(), tz);
  const qty = Math.max(1, Math.round(t.quantity || 1));
  const kindOf = t.itemType === 'service' ? 'service' : 'merchandise';
  const out: BenefitOption[] = [];

  // Memberships: an active enrollment of a plan with an item for this service or product.
  const { rows: mem } = await db.query(
    `SELECT e.id AS enrollment_id, e.status, e.cancelled_at, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(e.current_period_end, 'YYYY-MM-DD') AS period_end,
            pl.name, pi.id AS item_id, pi.variant_id, pi.quantity_per_period, COALESCE(pi.access_frequency, 'monthly') AS frequency
       FROM mbr_enrollments e
       JOIN mbr_plans pl ON pl.id = e.plan_id
       JOIN mbr_plan_items pi ON pi.plan_id = pl.id
      WHERE e.business_id = $1 AND e.customer_id = $2 AND e.status = 'active'
        AND pi.item_type = $3 AND ${kindOf === 'service' ? 'pi.service_id' : 'pi.merchandise_id'} = $4
      ORDER BY pl.name`,
    [t.businessId, t.customerId, kindOf, t.itemId]);
  for (const r of mem) {
    // Only what can be used is listed (owner, 23 Nov 2026): a membership cancelled to end at the
    // close of its period covers until then, and is left out once it has ended (or before it starts).
    if (r.cancelled_at && r.period_end && day > r.period_end) continue;
    if (r.start_date > day) continue;
    const win = allowanceWindow(r.frequency, day, r.start_date);
    const unlimited = win === null;
    const { rows: c } = await db.query(
      `SELECT COALESCE(SUM(quantity) FILTER (WHERE status = 'used'), 0)::int AS used,
              COALESCE(SUM(quantity) FILTER (WHERE status = 'held'), 0)::int AS held
         FROM pay_benefit_uses
        WHERE enrollment_id = $1 AND plan_item_id = $2 AND status <> 'released'
          AND ($3::date IS NULL OR window_start = $3::date) AND NOT (id = ANY($4::uuid[]))`,
      [r.enrollment_id, r.item_id, win?.start ?? null, except]);
    const allowance = unlimited ? null : Number(r.quantity_per_period) || 0;
    const left = allowance === null ? null : allowance - c[0].used - c[0].held;
    let reason: string | null = null;
    if (r.variant_id && t.variantId && r.variant_id !== t.variantId) reason = 'Not for this option.';
    else if (r.variant_id && !t.variantId) reason = 'Only for one option.';
    else if (left !== null && left < qty) reason = left <= 0 ? `Used up ${windowWord(r.frequency, win, today)}.` : `Only ${left} left ${windowWord(r.frequency, win, today)}.`;
    out.push({
      kind: 'membership', source_id: r.enrollment_id, item_id: r.item_id, name: r.name,
      unit: kindOf === 'service' ? 'uses' : 'items', allowance, used: c[0].used, held: c[0].held, left, needed: qty,
      frequency: r.frequency, window_start: win?.start ?? null, window_end: win?.end ?? null, expires_at: null,
      covers: reason === null, reason,
    });
  }

  // Packages: an active purchase with an item for this service or product.
  const { rows: pkg } = await db.query(
    `SELECT pp.id AS purchase_id, pp.status, pp.expires_at, p.name, i.id AS item_id, i.variant_id, i.quantity,
            COALESCE(i.redemption_type, 'sessions') AS redemption_type
       FROM pkg_purchases pp
       JOIN pkg_packages p ON p.id = pp.package_id
       JOIN pkg_package_items i ON i.package_id = p.id
      WHERE pp.business_id = $1 AND pp.customer_id = $2 AND pp.status = 'active'
        AND i.item_type = $3 AND ${kindOf === 'service' ? 'i.service_id' : 'i.merchandise_id'} = $4
      ORDER BY pp.expires_at NULLS LAST, pp.purchased_at`,
    [t.businessId, t.customerId, kindOf, t.itemId]);
  for (const r of pkg) {
    const minutesItem = r.redemption_type === 'minutes';
    const { rows: red } = await db.query(
      `SELECT COALESCE(SUM(${minutesItem ? 'minutes_redeemed' : 'quantity_redeemed'}), 0)::int AS used
         FROM pkg_redemptions WHERE purchase_id = $1 AND package_item_id = $2`, [r.purchase_id, r.item_id]);
    const { rows: hold } = await db.query(
      `SELECT COALESCE(SUM(${minutesItem ? 'COALESCE(minutes, 0)' : 'quantity'}), 0)::int AS held
         FROM pay_benefit_uses WHERE purchase_id = $1 AND package_item_id = $2 AND status = 'held' AND NOT (id = ANY($3::uuid[]))`,
      [r.purchase_id, r.item_id, except]);
    const needed = minutesItem ? Math.max(0, Math.round(t.minutes || 0)) * qty : qty;
    const allowance = Number(r.quantity) || 0;
    const left = allowance - red[0].used - hold[0].held;
    // An expired package, or one with nothing left at all, is not listed (owner, 23 Nov 2026).
    if (r.expires_at && new Date(r.expires_at) <= on) continue;
    if (left <= 0 && hold[0].held === 0) continue;
    let reason: string | null = null;
    if (r.variant_id && t.variantId && r.variant_id !== t.variantId) reason = 'Not for this option.';
    else if (r.variant_id && !t.variantId) reason = 'Only for one option.';
    else if (minutesItem && needed === 0) reason = 'The length is not known.';
    else if (left < needed) reason = left <= 0 ? 'Used up.' : `Only ${left} ${minutesItem ? 'minutes' : 'left'}${minutesItem ? ' left' : ''}.`;
    out.push({
      kind: 'package', source_id: r.purchase_id, item_id: r.item_id, name: r.name,
      unit: minutesItem ? 'minutes' : (kindOf === 'service' ? 'sessions' : 'items'), allowance, used: red[0].used, held: hold[0].held, left, needed,
      frequency: null, window_start: null, window_end: null, expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      covers: reason === null, reason,
    });
  }

  // The order a default is picked in (owner, 23 Nov 2026): those that cover first; a membership
  // before a package; packages by the earliest expiry (none last), then the fewest left; and
  // memberships by the allowance that renews soonest.
  const ends = (o: BenefitOption) => (o.kind === 'package'
    ? (o.expires_at ? o.expires_at.slice(0, 10) : '9999-12-31')
    : (o.window_end || '9999-12-31'));
  return out.sort((a, b) => Number(b.covers) - Number(a.covers)
    || Number(a.kind === 'package') - Number(b.kind === 'package')
    || ends(a).localeCompare(ends(b))
    || (a.left ?? Number.MAX_SAFE_INTEGER) - (b.left ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

const SHORT = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "today", "this week", "this month"; or, for another window, "on 28 Nov", "the week of 30 Nov", "until 4 Jan". */
const windowWord = (f: string, win: { start: string; end: string } | null, today: string) => {
  const current = !win || (win.start <= today && today <= win.end);
  if (f === 'daily') return current ? 'today' : `on ${SHORT(win!.start)}`;
  if (f === 'weekly') return current ? 'this week' : `the week of ${SHORT(win!.start)}`;
  return current ? 'this month' : `for ${SHORT(win!.start)} to ${SHORT(win!.end)}`;
};

/** The option for a chosen membership or package, or null when the customer has no such one. */
export async function optionFor(t: BenefitTarget, ref: BenefitRef, opts: { exceptUseIds?: string[]; db?: Db } = {}): Promise<BenefitOption | null> {
  const all = await benefitOptions(t, opts);
  return all.find((o) => o.kind === ref.kind && o.source_id === ref.source_id && o.item_id === ref.item_id) || null;
}

// ---------------------------------------------------------------------------------------------
// Holding, using and giving back
// ---------------------------------------------------------------------------------------------

export interface BenefitUse {
  id: string; kind: BenefitKind; status: 'held' | 'used' | 'released';
  enrollment_id: string | null; plan_item_id: string | null; purchase_id: string | null; package_item_id: string | null;
  booking_id: string | null; order_id: string | null; order_item_id: string | null;
  quantity: number; minutes: number | null; window_start: string | null; window_end: string | null;
  redemption_id: string | null; mbr_usage_id: string | null;
}

/**
 * Hold a membership's or package's allowance (for a booking, or an order line), after checking it
 * covers. Locked per allowance, so the same allowance cannot be promised twice. Runs in the
 * caller's transaction when a client is given.
 */
export async function holdBenefit(args: {
  target: BenefitTarget; ref: BenefitRef; bookingId?: string | null; orderId?: string | null; orderItemId?: string | null;
  userId?: string | null; exceptUseIds?: string[]; client?: PoolClient;
}): Promise<BenefitUse> {
  const own = !args.client;
  const client = args.client || await adminPool.connect();
  try {
    if (own) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`benefit:${args.ref.source_id}:${args.ref.item_id}`]);
    const option = await optionFor(args.target, args.ref, { exceptUseIds: args.exceptUseIds, db: client });
    if (!option) throw new BenefitError('This customer has no such membership or package for this.', 'NOT_FOUND');
    if (!option.covers) throw new BenefitError(`${option.name} does not cover this: ${option.reason}`, 'NOT_COVERED');
    const { rows: biz } = await client.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [args.target.businessId]);
    const membership = args.ref.kind === 'membership';
    const { rows } = await client.query(
      `INSERT INTO pay_benefit_uses (tenant_id, business_id, customer_id, kind, enrollment_id, plan_item_id, purchase_id, package_item_id,
         booking_id, order_id, order_item_id, quantity, minutes, window_start, window_end, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'held', $16) RETURNING *`,
      [biz[0].tenant_id, args.target.businessId, args.target.customerId, args.ref.kind,
        membership ? args.ref.source_id : null, membership ? args.ref.item_id : null,
        membership ? null : args.ref.source_id, membership ? null : args.ref.item_id,
        args.bookingId ?? null, args.orderId ?? null, args.orderItemId ?? null,
        Math.max(1, Math.round(args.target.quantity || 1)), option.unit === 'minutes' ? option.needed : null,
        option.window_start, option.window_end, args.userId ?? null]);
    if (own) await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    if (own) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { if (own) client.release(); }
}

/**
 * Count a held use as used (its order was paid): a package use writes its redemption, a
 * membership use adds to the membership's usage for its period, so the existing reports and the
 * customer's timeline stay right.
 */
export async function markUsed(useId: string, client?: PoolClient): Promise<void> {
  const db: Db = client || adminPool;
  const { rows } = await db.query(`SELECT * FROM pay_benefit_uses WHERE id = $1 AND status = 'held' FOR UPDATE`, [useId]);
  const u = rows[0] as BenefitUse | undefined;
  if (!u) return;
  let redemptionId: string | null = null; let usageId: string | null = null;
  if (u.kind === 'package') {
    const { rows: r } = await db.query(
      `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, minutes_redeemed, booking_id, notes)
       VALUES ($1, $2, $3, $4, $5, 'Paid with package') RETURNING id`,
      [u.purchase_id, u.package_item_id, u.minutes ? 1 : u.quantity, u.minutes, u.booking_id]);
    redemptionId = r[0].id;
  } else {
    const { rows: r } = await db.query(
      `UPDATE mbr_usage mu SET quantity_used = mu.quantity_used + $3, updated_at = NOW()
         FROM mbr_enrollments e
        WHERE e.id = mu.enrollment_id AND mu.enrollment_id = $1 AND mu.plan_item_id = $2 AND mu.period_start = e.current_period_start
        RETURNING mu.id`,
      [u.enrollment_id, u.plan_item_id, u.quantity]);
    usageId = r[0]?.id ?? null;
  }
  await db.query(
    `UPDATE pay_benefit_uses SET status = 'used', redemption_id = $2, mbr_usage_id = $3, updated_at = NOW() WHERE id = $1`,
    [useId, redemptionId, usageId]);
}

/** Give a use back: a hold is let go; a used one also removes its redemption or usage. */
export async function releaseUse(useId: string, client?: PoolClient): Promise<void> {
  const db: Db = client || adminPool;
  const { rows } = await db.query(`SELECT * FROM pay_benefit_uses WHERE id = $1 AND status <> 'released' FOR UPDATE`, [useId]);
  const u = rows[0] as BenefitUse | undefined;
  if (!u) return;
  if (u.status === 'used') {
    if (u.redemption_id) await db.query('DELETE FROM pkg_redemptions WHERE id = $1', [u.redemption_id]);
    if (u.mbr_usage_id) {
      await db.query('UPDATE mbr_usage SET quantity_used = GREATEST(quantity_used - $2, 0), updated_at = NOW() WHERE id = $1', [u.mbr_usage_id, u.quantity]);
    }
  }
  await db.query(`UPDATE pay_benefit_uses SET status = 'released', updated_at = NOW() WHERE id = $1`, [useId]);
}

/**
 * A booking that will not happen gives back what was held for it; a cancelled one also gives back
 * what it already used (paid at reservation), since the service was not given. A no-show keeps
 * what it used.
 */
export async function releaseForBooking(bookingId: string, opts: { includeUsed?: boolean; client?: PoolClient } = {}): Promise<number> {
  const db: Db = opts.client || adminPool;
  const { rows } = await db.query(
    `SELECT id FROM pay_benefit_uses WHERE booking_id = $1 AND status = ANY($2::text[])`,
    [bookingId, opts.includeUsed ? ['held', 'used'] : ['held']]);
  for (const r of rows) await releaseUse(r.id, opts.client);
  return rows.length;
}

/** The uses of a booking or of order lines that are not given back. */
export async function usesFor(where: { bookingId?: string; orderItemIds?: string[]; orderId?: string }, db: Db = adminPool): Promise<BenefitUse[]> {
  const { rows } = await db.query(
    `SELECT * FROM pay_benefit_uses
      WHERE status <> 'released'
        AND (($1::uuid IS NOT NULL AND booking_id = $1) OR ($2::uuid[] IS NOT NULL AND order_item_id = ANY($2::uuid[])) OR ($3::uuid IS NOT NULL AND order_id = $3))
      ORDER BY created_at`,
    [where.bookingId ?? null, where.orderItemIds ?? null, where.orderId ?? null]);
  return rows;
}

/** The name of what a use pays with (the plan or the package), for the order and the receipt. */
export async function useName(u: Pick<BenefitUse, 'kind' | 'enrollment_id' | 'purchase_id'>, db: Db = adminPool): Promise<string> {
  const { rows } = u.kind === 'membership'
    ? await db.query('SELECT pl.name FROM mbr_enrollments e JOIN mbr_plans pl ON pl.id = e.plan_id WHERE e.id = $1', [u.enrollment_id])
    : await db.query('SELECT p.name FROM pkg_purchases pp JOIN pkg_packages p ON p.id = pp.package_id WHERE pp.id = $1', [u.purchase_id]);
  return rows[0]?.name || (u.kind === 'membership' ? 'Membership' : 'Package');
}

/** The customer's active membership plans (for pricing rules limited to members of some plans). */
export async function activePlanIds(businessId: string, customerId: string, db: Db = adminPool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT plan_id FROM mbr_enrollments WHERE business_id = $1 AND customer_id = $2 AND status = 'active' AND cancelled_at IS NULL`,
    [businessId, customerId]);
  return rows.map((r: { plan_id: string }) => r.plan_id);
}

// ---------------------------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------------------------

/** What a booking pays for, as a benefit target (its service, option, start, people and length). */
export async function bookingTarget(bookingId: string, db: Db = adminPool): Promise<BenefitTarget | null> {
  const { rows } = await db.query(
    `SELECT b.business_id, b.customer_id, b.service_id, b.variant_id, b.start_time, b.end_time, COALESCE(b.participant_count, 1) AS people,
            v.duration
       FROM apt_bookings b LEFT JOIN svc_variants v ON v.id = b.variant_id WHERE b.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b || !b.customer_id) return null;
  const length = b.duration || Math.round((new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60000);
  return {
    businessId: b.business_id, customerId: b.customer_id, itemType: 'service', itemId: b.service_id,
    variantId: b.variant_id, on: b.start_time, quantity: Number(b.people) || 1, minutes: length > 0 ? length : null,
  };
}

/**
 * Set what pays for a booking: hold the chosen membership or package (giving back what was held
 * before), or give it back (null). In one transaction, so a choice that no longer covers leaves
 * the booking as it was. A use already paid is not moved.
 */
export async function setBookingBenefit(bookingId: string, ref: BenefitRef | null, userId: string | null): Promise<BenefitUse | null> {
  // Already used (paid at reservation) or paying its open order's line: the same choice changes
  // nothing; another one is made at Checkout, on the line.
  const locked = (await usesFor({ bookingId })).find((u) => u.status === 'used' || u.order_item_id);
  if (locked) {
    const lockedRef: BenefitRef = locked.kind === 'membership'
      ? { kind: 'membership', source_id: locked.enrollment_id!, item_id: locked.plan_item_id! }
      : { kind: 'package', source_id: locked.purchase_id!, item_id: locked.package_item_id! };
    if (ref && ref.kind === lockedRef.kind && ref.source_id === lockedRef.source_id && ref.item_id === lockedRef.item_id) return locked;
    throw new BenefitError(locked.status === 'used'
      ? `This appointment is already paid with ${await useName(locked)}.`
      : `This appointment's Checkout is open: change how it is paid there.`, 'INVALID');
  }
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: held } = await client.query(
      `SELECT id FROM pay_benefit_uses WHERE booking_id = $1 AND status = 'held' AND order_item_id IS NULL FOR UPDATE`, [bookingId]);
    const heldIds = held.map((r: { id: string }) => r.id);
    let use: BenefitUse | null = null;
    if (ref) {
      const target = await bookingTarget(bookingId, client);
      if (!target) throw new BenefitError('Choose a customer to pay with a membership or package.', 'INVALID');
      use = await holdBenefit({ target, ref, bookingId, userId, exceptUseIds: heldIds, client });
    }
    for (const id of heldIds) await releaseUse(id, client);
    await client.query('COMMIT');
    return use;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}

/**
 * After a booking changes (service, option, time, people or customer): its hold is checked again
 * and kept when it still covers; otherwise it is given back. Returns the reason when it was.
 */
export async function recheckBookingBenefit(bookingId: string, userId: string | null): Promise<string | null> {
  const [held] = (await usesFor({ bookingId })).filter((u) => u.status === 'held' && !u.order_item_id);
  if (!held) return null;
  const ref: BenefitRef = held.kind === 'membership'
    ? { kind: 'membership', source_id: held.enrollment_id!, item_id: held.plan_item_id! }
    : { kind: 'package', source_id: held.purchase_id!, item_id: held.package_item_id! };
  try {
    await setBookingBenefit(bookingId, ref, userId);
    return null;
  } catch (e) {
    if (!(e instanceof BenefitError)) throw e;
    await setBookingBenefit(bookingId, null, userId);
    return e.message;
  }
}

/** What a booking is held against, for the booking and Checkout (name, kind, what is left after it). */
export async function bookingBenefit(bookingId: string): Promise<(BenefitUse & { name: string }) | null> {
  const [u] = await usesFor({ bookingId });
  if (!u) return null;
  return { ...u, name: await useName(u) };
}

// ---------------------------------------------------------------------------------------------
// Orders (Checkout, and the payment step's order)
// ---------------------------------------------------------------------------------------------

/** The benefit note on a line paid with a membership or package. */
const paidWithNote = (name: string) => `Paid with ${name}`;

/** An order line as a benefit target: its service or product, option, people or items, and date. */
async function lineTarget(orderItemId: string, db: Db = adminPool): Promise<{ target: BenefitTarget; orderId: string; bookingId: string | null; gross: number } | null> {
  const { rows } = await db.query(
    `SELECT oi.id, oi.order_id, oi.item_type, oi.item_id, oi.variant_id, oi.quantity, oi.unit_price, oi.booking_id,
            o.business_id, o.customer_id, o.status, v.duration,
            -- the line's appointment, else the appointment the order is for (a line added at its Checkout)
            COALESCE(b.start_time, ob.start_time) AS start_time, COALESCE(b.end_time, ob.end_time) AS end_time
       FROM fin_order_items oi JOIN fin_orders o ON o.id = oi.order_id
       LEFT JOIN apt_bookings b ON b.id = oi.booking_id
       LEFT JOIN apt_bookings ob ON ob.id = o.booking_id
       LEFT JOIN svc_variants v ON v.id = oi.variant_id AND oi.item_type = 'service'
      WHERE oi.id = $1`, [orderItemId]);
  const r = rows[0];
  if (!r || !r.customer_id || !r.item_id || !['service', 'product'].includes(r.item_type)) return null;
  const length = r.duration || (r.start_time && r.end_time ? Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000) : null);
  return {
    orderId: r.order_id, bookingId: r.booking_id, gross: r.unit_price * r.quantity,
    target: {
      businessId: r.business_id, customerId: r.customer_id, itemType: r.item_type, itemId: r.item_id, variantId: r.variant_id,
      on: r.start_time || new Date(), quantity: r.quantity, minutes: length,
    },
  };
}

/** Price a line as paid by a benefit (the whole line, its tax with it) or as normal again. */
async function priceLine(orderItemId: string, orderId: string, name: string | null): Promise<void> {
  const checkout = await import('./checkout.service');
  const { rows } = await adminPool.query('SELECT unit_price, quantity, notes FROM fin_order_items WHERE id = $1', [orderItemId]);
  if (!rows[0]) return;
  const gross = rows[0].unit_price * rows[0].quantity;
  // Keep any other note on the line; the "Paid with" part is ours.
  const other = String(rows[0].notes || '').split('; ').filter((n) => n && !n.startsWith('Paid with ')).join('; ');
  await checkout.updateItem(orderItemId, orderId, {
    discountAmount: name ? gross : 0,
    notes: [name ? paidWithNote(name) : '', other].filter(Boolean).join('; '),
  } as Parameters<typeof checkout.updateItem>[2]);
}

/** The options for an order line (what of the customer's memberships and packages covers it). */
export async function lineOptions(orderItemId: string): Promise<{ options: BenefitOption[]; use: (BenefitUse & { name: string }) | null } | null> {
  const lt = await lineTarget(orderItemId);
  if (!lt) return null;
  const [use] = await usesFor({ orderItemIds: [orderItemId] });
  const options = await benefitOptions(lt.target, { exceptUseIds: use ? [use.id] : [] });
  return { options, use: use ? { ...use, name: await useName(use) } : null };
}

/**
 * Pay an open order's line with a membership or package, or normally again (null). What was held
 * for it is given back, unless it is its booking's hold and nothing else is chosen, in which case
 * it goes back to the booking.
 */
export async function setLineBenefit(orderItemId: string, ref: BenefitRef | null, userId: string | null): Promise<void> {
  const lt = await lineTarget(orderItemId);
  if (!lt) throw new BenefitError('Only a service or product line of an order with a customer can be paid with a membership or package.', 'INVALID');
  const client = await adminPool.connect();
  let name: string | null = null;
  try {
    await client.query('BEGIN');
    const { rows: held } = await client.query(
      `SELECT id FROM pay_benefit_uses WHERE order_item_id = $1 AND status = 'held' FOR UPDATE`, [orderItemId]);
    const heldIds = held.map((r: { id: string }) => r.id);
    if (ref) {
      const use = await holdBenefit({
        target: lt.target, ref, bookingId: lt.bookingId, orderId: lt.orderId, orderItemId, userId, exceptUseIds: heldIds, client,
      });
      name = await useName(use, client);
    }
    for (const id of heldIds) await releaseUse(id, client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
  await priceLine(orderItemId, lt.orderId, name);
}

/**
 * When a booking's order is opened (Checkout, or the payment step): the booking's hold pays its
 * service line, if it still covers it; otherwise it is given back and the line is priced normally.
 */
export async function attachBookingBenefit(orderId: string, bookingId: string): Promise<void> {
  const [held] = (await usesFor({ bookingId })).filter((u) => u.status === 'held' && !u.order_item_id);
  if (!held) return;
  const { rows } = await adminPool.query(
    `SELECT id FROM fin_order_items WHERE order_id = $1 AND booking_id = $2 AND item_type = 'service' ORDER BY created_at LIMIT 1`, [orderId, bookingId]);
  if (!rows[0]) return;
  await adminPool.query(`UPDATE pay_benefit_uses SET order_id = $2, order_item_id = $3, updated_at = NOW() WHERE id = $1`, [held.id, orderId, rows[0].id]);
  const lt = await lineTarget(rows[0].id);
  const ref: BenefitRef = held.kind === 'membership'
    ? { kind: 'membership', source_id: held.enrollment_id!, item_id: held.plan_item_id! }
    : { kind: 'package', source_id: held.purchase_id!, item_id: held.package_item_id! };
  const option = lt ? await optionFor(lt.target, ref, { exceptUseIds: [held.id] }) : null;
  if (option?.covers) { await priceLine(rows[0].id, orderId, option.name); return; }
  await releaseUse(held.id);
}

/** The order was paid: what its lines held is now used. */
export async function useForOrder(orderId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT u.id FROM pay_benefit_uses u JOIN fin_order_items oi ON oi.id = u.order_item_id
      WHERE oi.order_id = $1 AND u.status = 'held'`, [orderId]);
  for (const r of rows) await markUsed(r.id);
}

/** A line is removed: what it held is given back (a booking's hold goes back to the booking). */
export async function releaseForOrderItem(orderItemId: string): Promise<void> {
  const { rows } = await adminPool.query(`SELECT id, booking_id, status FROM pay_benefit_uses WHERE order_item_id = $1 AND status <> 'released'`, [orderItemId]);
  for (const u of rows) {
    if (u.status === 'held' && u.booking_id) {
      await adminPool.query(`UPDATE pay_benefit_uses SET order_id = NULL, order_item_id = NULL, updated_at = NOW() WHERE id = $1`, [u.id]);
    } else await releaseUse(u.id);
  }
}

/** An open order is voided: its booking holds go back to their bookings, the rest are given back. */
export async function releaseForOrder(orderId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT u.order_item_id FROM pay_benefit_uses u JOIN fin_order_items oi ON oi.id = u.order_item_id
      WHERE oi.order_id = $1 AND u.status = 'held'`, [orderId]);
  for (const r of rows) await releaseForOrderItem(r.order_item_id);
}

/** A paid line refunded: what it used is given back. */
export async function releaseUsedForOrderItem(orderItemId: string): Promise<void> {
  const { rows } = await adminPool.query(`SELECT id FROM pay_benefit_uses WHERE order_item_id = $1 AND status = 'used'`, [orderItemId]);
  for (const r of rows) await releaseUse(r.id);
}

/** Each line's benefit, for the order (name and what is left after it). */
export async function orderLineBenefits(orderItemIds: string[]): Promise<Map<string, { use_id: string; kind: BenefitKind; name: string; status: string }>> {
  const out = new Map<string, { use_id: string; kind: BenefitKind; name: string; status: string }>();
  if (orderItemIds.length === 0) return out;
  for (const u of await usesFor({ orderItemIds })) {
    if (u.order_item_id && !out.has(u.order_item_id)) out.set(u.order_item_id, { use_id: u.id, kind: u.kind, name: await useName(u), status: u.status });
  }
  return out;
}