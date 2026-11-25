import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { adminPool } from '../db/pool';
import { msg } from '../i18n';

/**
 * An appointment's history (spec 51, gap 18; design 18): its creation, each status change, each
 * change to its fields (before and after) and its payments; who made it (a staff member, the
 * customer or the system), where it came from, and for an automatic job its name and rule.
 * Entries are never edited or deleted (a trigger refuses it), except to anonymise a customer.
 */

type Db = Pick<PoolClient, 'query'>;

export type HistoryEvent = 'created' | 'status' | 'changed' | 'payment';
export type HistoryActor = 'staff' | 'customer' | 'system';
export type HistorySource = 'staff' | 'widget' | 'customer_portal' | 'self_check_in' | 'import' | 'job' | 'system';

/** A field changed: its value before and after, as shown (names, not ids; times as ISO). */
export interface HistoryChange { field: HistoryField; from: string | number | null; to: string | number | null }
export type HistoryField =
  | 'start_time' | 'end_time' | 'service' | 'option' | 'staff' | 'location' | 'resource'
  | 'participants' | 'price' | 'notes' | 'customer' | 'addons';

export interface PaymentDetails {
  kind: 'order' | 'paid' | 'refunded' | 'fee';
  order_id?: string | null; order_number?: string | null; amount_cents?: number | null; method?: string | null;
  /** A fee: no_show or late_cancellation. */
  fee?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Who and where: set once per request (and per automatic job), read when an entry is written
// ---------------------------------------------------------------------------------------------

interface HistoryContext { req?: Request; actor?: HistoryActor; source?: HistorySource; userId?: string | null; job?: string | null }
const context = new AsyncLocalStorage<HistoryContext>();

/** Where a request comes from, by its path. */
function sourceOf(path: string): HistorySource {
  if (path.startsWith('/api/v1/widget')) return 'widget';
  if (path.startsWith('/api/v1/public/check-in')) return 'self_check_in';
  if (path.startsWith('/api/v1/profile/customer') || path.startsWith('/api/v1/public')) return 'customer_portal';
  if (path.startsWith('/api/v1/import') || path.startsWith('/api/v1/data-migration')) return 'import';
  return 'staff';
}

/** App-level middleware: every request carries its own history context (who is read later, after sign-in). */
export function historyContext(req: Request, _res: Response, next: NextFunction): void {
  context.run({ req }, () => next());
}

/** Run an automatic job (or any work without a person) under its name, so its changes say so. */
export function runAsJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
  return context.run({ actor: 'system', source: 'job', userId: null, job }, fn);
}

/** Run work as an import, so its changes say so. */
export function runAsImport<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  return context.run({ actor: 'staff', source: 'import', userId }, fn);
}

function current(): { actor: HistoryActor; source: HistorySource; userId: string | null; job: string | null } {
  const c = context.getStore();
  if (!c) return { actor: 'system', source: 'system', userId: null, job: null };
  if (!c.req) return { actor: c.actor || 'system', source: c.source || 'system', userId: c.userId ?? null, job: c.job ?? null };
  const user = (c.req as Request & { user?: { sub: string; role?: string; permissions?: string[] } }).user;
  const source = sourceOf(c.req.originalUrl || c.req.url || '');
  // a customer's own login (the same rule as tenant-context's isCustomerLogin)
  const customerLogin = !!user && String(user.role || '').trim().toLowerCase() === 'customer';
  const actor: HistoryActor = source === 'widget' || source === 'customer_portal' || source === 'self_check_in' || customerLogin
    ? 'customer'
    : user ? 'staff' : 'system';
  return { actor, source: customerLogin && source === 'staff' ? 'customer_portal' : source, userId: user?.sub ?? null, job: null };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export interface HistoryEntryInput {
  bookingId: string;
  event: HistoryEvent;
  fromStatus?: string | null;
  toStatus?: string | null;
  changes?: HistoryChange[] | null;
  details?: PaymentDetails | null;
  reason?: string | null;
  /** The person, when known better than the request (e.g. the staff member passed to a service). */
  userId?: string | null;
  /** Overrides, for work done on behalf of someone else (e.g. an automatic job's rule). */
  actor?: HistoryActor;
  source?: HistorySource;
  job?: string | null;
}

/** Write one entry. Never fails the change it records: a failure is logged. */
export async function recordBookingEvent(e: HistoryEntryInput, db: Db = adminPool): Promise<void> {
  const c = current();
  const userId = e.userId !== undefined ? e.userId : c.userId;
  const actor = e.actor || (c.actor === 'system' && userId ? 'staff' : c.actor);
  try {
    await db.query(
      `INSERT INTO apt_booking_status_history
         (booking_id, event, from_status, to_status, changes, details, reason, changed_by, actor_type, source, job, created_at)
       -- the moment it is written (not the transaction's start), so entries keep their order
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp())`,
      [e.bookingId, e.event, e.fromStatus ?? null, e.toStatus ?? null,
        e.changes && e.changes.length ? JSON.stringify(e.changes) : null, e.details ? JSON.stringify(e.details) : null,
        e.reason ?? null, userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null, actor, e.source || c.source, e.job ?? c.job]);
  } catch (err) {
    console.error('[History] Not recorded for booking', e.bookingId, (err as Error)?.message || err);
  }
}

/** A status change. */
export function recordStatus(bookingId: string, from: string | null, to: string, opts: Omit<HistoryEntryInput, 'bookingId' | 'event' | 'fromStatus' | 'toStatus'> = {}, db?: Db) {
  return recordBookingEvent({ ...opts, bookingId, event: from === null ? 'created' : 'status', fromStatus: from, toStatus: to }, db);
}

/** A payment that follows from the appointment (criterion 5). */
export function recordPayment(bookingId: string, details: PaymentDetails, opts: Omit<HistoryEntryInput, 'bookingId' | 'event' | 'details'> = {}, db?: Db) {
  return recordBookingEvent({ ...opts, bookingId, event: 'payment', details }, db);
}

// ---------------------------------------------------------------------------------------------
// Field changes: a snapshot before, compared with the appointment after
// ---------------------------------------------------------------------------------------------

export type BookingSnapshot = Record<HistoryField, string | number | null>;

/** The appointment's fields as shown (names, not ids). */
export async function snapshotBooking(bookingId: string, db: Db = adminPool): Promise<BookingSnapshot | null> {
  const { rows } = await db.query(
    `SELECT b.start_time, b.end_time, s.name AS service, v.name AS option,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS staff, l.name AS location, r.name AS resource,
            b.participant_count AS participants, b.price, b.notes,
            COALESCE(NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), ''), b.walk_in_name) AS customer,
            (SELECT string_agg(ba.name, ', ' ORDER BY ba.name) FROM apt_booking_addons ba
              WHERE ba.booking_id = b.id AND ba.status = 'active') AS addons
       FROM apt_bookings b
       LEFT JOIN svc_services s ON s.id = b.service_id
       LEFT JOIN svc_variants v ON v.id = b.variant_id
       LEFT JOIN usr_users u ON u.id = b.staff_id
       LEFT JOIN sys_locations l ON l.id = b.location_id
       LEFT JOIN res_resources r ON r.id = b.resource_id
       LEFT JOIN cus_customers c ON c.id = b.customer_id
      WHERE b.id = $1`, [bookingId]);
  const r = rows[0];
  if (!r) return null;
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return {
    start_time: iso(r.start_time), end_time: iso(r.end_time), service: r.service, option: r.option, staff: r.staff,
    location: r.location, resource: r.resource, participants: r.participants == null ? null : Number(r.participants),
    price: r.price == null ? null : Number(r.price), notes: r.notes || null, customer: r.customer,
    addons: r.addons || null,
  };
}

/** What differs between two snapshots (the end time follows the start or the option, so it is only listed alone). */
export function diffSnapshots(before: BookingSnapshot, after: BookingSnapshot): HistoryChange[] {
  const fields: HistoryField[] = ['start_time', 'service', 'option', 'addons', 'staff', 'location', 'resource', 'participants', 'price', 'customer', 'notes'];
  const out: HistoryChange[] = fields.filter((f) => (before[f] ?? null) !== (after[f] ?? null)).map((f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }));
  if ((before.end_time ?? null) !== (after.end_time ?? null) && !out.some((c) => c.field === 'start_time' || c.field === 'option')) {
    out.push({ field: 'end_time', from: before.end_time, to: after.end_time });
  }
  return out;
}

/** Record the fields changed since `before` (nothing when nothing changed). */
export async function recordChanges(bookingId: string, before: BookingSnapshot | null, opts: Omit<HistoryEntryInput, 'bookingId' | 'event' | 'changes'> = {}): Promise<void> {
  if (!before) return;
  const after = await snapshotBooking(bookingId);
  if (!after) return;
  const changes = diffSnapshots(before, after);
  if (changes.length > 0) await recordBookingEvent({ ...opts, bookingId, event: 'changed', changes });
}

// ---------------------------------------------------------------------------------------------
// Reading, in plain words (criterion 3)
// ---------------------------------------------------------------------------------------------

export interface HistoryEntry {
  id: string; at: string; event: HistoryEvent;
  who: string; actor: HistoryActor; source: HistorySource | null; job: string | null;
  /** What happened, in plain words. */
  text: string;
  /** Each field changed, in plain words. */
  lines: string[];
  reason: string | null;
  /** Recorded before the full history (only statuses and moves were kept then). */
  early: boolean;
}

const STATUS: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in', in_progress: 'In progress', ready: 'Ready',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show', waitlisted: 'Waitlisted',
};
const status = (s: string | null) => (s ? STATUS[s] || s.replace(/_/g, ' ') : '—');
const FIELD: Record<HistoryField, string> = {
  start_time: 'Time', end_time: 'End time', service: 'Service', option: 'Option', staff: 'Staff', location: 'Location',
  resource: 'Resource', participants: 'People', price: 'Price', notes: 'Notes', customer: 'Customer', addons: 'Add-ons',
};
const SOURCE: Record<HistorySource, string> = {
  staff: 'staff screen', widget: 'booking widget', customer_portal: 'customer link', self_check_in: 'self check-in',
  import: 'import', job: 'automatic job', system: 'system',
};

/** One entry as stored (in the table, or in an appointment's archive file), with the staff member's name. */
interface HistoryRow {
  id: string; created_at: string; event: HistoryEvent; from_status: string | null; to_status: string | null;
  changes: HistoryChange[] | null; details: PaymentDetails | null; reason: string | null;
  actor_type: HistoryActor | null; source: HistorySource | null; job: string | null;
  changed_by: string | null; user_name: string | null;
}

const ROW_COLUMNS = `h.id, h.created_at, h.event, h.from_status, h.to_status, h.changes, h.details, h.reason,
            h.actor_type, h.source, h.job, h.changed_by, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS user_name`;

/** The entries still in the table. */
async function tableRows(bookingId: string, db: Db = adminPool): Promise<HistoryRow[]> {
  const { rows } = await db.query(
    `SELECT ${ROW_COLUMNS} FROM apt_booking_status_history h LEFT JOIN usr_users u ON u.id = h.changed_by
      WHERE h.booking_id = $1 ORDER BY h.created_at, h.id`, [bookingId]);
  return rows.map((r: any) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/** The entries moved to the appointment's archive file (none when it has none). */
async function archivedRows(path: string | null): Promise<HistoryRow[]> {
  if (!path) return [];
  const { storage } = await import('./storage.service');
  const data = await storage.read(path);
  if (!data) { console.error('[History] Archive file missing:', path); return []; }
  const parsed = JSON.parse(data.toString('utf8')) as { entries?: HistoryRow[] };
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

export async function getBookingHistory(bookingId: string): Promise<HistoryEntry[]> {
  const { rows: meta } = await adminPool.query(
    `SELECT b.history_archive_path, COALESCE(z.timezone, 'UTC') AS tz, COALESCE(z.currency, 'EUR') AS currency,
            NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), '') AS customer_name
       FROM apt_bookings b JOIN sys_businesses z ON z.id = b.business_id LEFT JOIN cus_customers c ON c.id = b.customer_id
      WHERE b.id = $1`, [bookingId]);
  if (!meta[0]) return [];
  // Recent entries from the table, older ones from the archive file: one history (spec 51, gap 18).
  const all = [...await archivedRows(meta[0].history_archive_path), ...await tableRows(bookingId)];
  const seen = new Set<string>();
  const rows = all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((x, y) => y.created_at.localeCompare(x.created_at) || y.id.localeCompare(x.id))
    .map((r) => ({ ...r, tz: meta[0].tz, currency: meta[0].currency, customer_name: meta[0].customer_name }));
  return rows.map((r: any): HistoryEntry => {
    const tz = r.tz as string;
    const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
    const money = (cents: unknown) => (cents == null ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: r.currency }).format(Number(cents) / 100));
    const value = (f: HistoryField, v: string | number | null) => (v === null || v === '' ? (f === 'addons' ? 'none' : '—')
      : f === 'start_time' || f === 'end_time' ? when(v) : f === 'price' ? money(v) : String(v));
    const changes: HistoryChange[] = Array.isArray(r.changes) ? r.changes : [];
    const d: PaymentDetails | null = r.details || null;
    const actor = (r.actor_type || (r.user_name ? 'staff' : 'system')) as HistoryActor;
    const who = actor === 'customer' ? (r.customer_name || 'The customer')
      : actor === 'system' ? (r.job ? `System (${r.job})` : 'System')
      : r.user_name || 'A staff member';
    let text: string;
    if (r.event === 'created') text = `Booked (${status(r.to_status)})`;
    else if (r.event === 'status') text = `${status(r.from_status)} → ${status(r.to_status)}`;
    else if (r.event === 'changed') {
      const moved = changes.find((c) => c.field === 'start_time');
      text = changes.length === 0 ? (r.reason === 'Rescheduled' ? 'Moved' : 'Changed')
        : moved && changes.length === 1 ? `Moved from ${value('start_time', moved.from)} to ${value('start_time', moved.to)}`
        : `Changed ${changes.map((c) => FIELD[c.field].toLowerCase()).join(', ')}`;
    } else {
      const order = d?.order_number ? ` (order ${d.order_number})` : '';
      text = d?.kind === 'paid' ? `Paid ${money(d.amount_cents)}${d.method ? ` by ${d.method.replace(/_/g, ' ')}` : ''}${order}`
        : d?.kind === 'refunded' ? `Refunded ${money(d.amount_cents)}${order}`
        : d?.kind === 'fee' ? `${d.fee === 'no_show' ? 'No-show' : 'Late cancellation'} fee ${money(d.amount_cents)} charged${order}`
        : `Checkout opened${order}`;
    }
    const lines = r.event === 'changed' && !(changes.length === 1 && changes[0].field === 'start_time')
      ? changes.map((c) => (c.field === 'notes' ? `Notes: ${c.to ? `“${c.to}”` : 'removed'}` : `${FIELD[c.field]}: ${value(c.field, c.from)} → ${value(c.field, c.to)}`))
      : [];
    return {
      id: r.id, at: new Date(r.created_at).toISOString(), event: r.event, who, actor, source: r.source, job: r.job,
      text, lines, reason: r.reason && !(r.event === 'changed' && r.reason === 'Rescheduled') ? r.reason : null,
      early: r.source === null,
    };
  });
}

export const sourceLabel = (s: HistorySource | null) => (s ? SOURCE[s] : null);

// ---------------------------------------------------------------------------------------------
// Anonymising a customer (criterion 6)
// ---------------------------------------------------------------------------------------------

/**
 * The customer's appointments keep their history (times, statuses, staff, payments), without
 * their personal data: reasons and notes are removed, and names of the customer replaced.
 */
export async function anonymiseHistory(customerId: string, businessId: string, inTransaction?: PoolClient): Promise<void> {
  const own = !inTransaction;
  const client = inTransaction || await adminPool.connect();
  try {
    if (own) await client.query('BEGIN');
    await client.query(`SET LOCAL app.history_anonymise = 'on'`);
    await client.query(
      `UPDATE apt_booking_status_history h
          SET reason = NULL,
              changes = (SELECT jsonb_agg(CASE WHEN c->>'field' IN ('notes', 'customer')
                                               THEN jsonb_build_object('field', c->>'field', 'from', NULL, 'to', NULL)
                                               ELSE c END)
                           FROM jsonb_array_elements(h.changes) c)
        FROM apt_bookings b
        WHERE b.id = h.booking_id AND b.customer_id = $1 AND b.business_id = $2
          AND (h.reason IS NOT NULL OR h.changes IS NOT NULL)`,
      [customerId, businessId]);
    // Only this anonymising may change entries: switched off again for the rest of the transaction.
    await client.query(`SET LOCAL app.history_anonymise = 'off'`);
    // History already moved to file storage: the same, in each file.
    const { rows: archived } = await client.query(
      `SELECT history_archive_path FROM apt_bookings WHERE customer_id = $1 AND business_id = $2 AND history_archive_path IS NOT NULL`,
      [customerId, businessId]);
    if (archived.length > 0) {
      const { storage } = await import('./storage.service');
      for (const a of archived as Array<{ history_archive_path: string }>) {
        const entries = (await archivedRows(a.history_archive_path)).map((r) => ({
          ...r, reason: null,
          changes: r.changes ? r.changes.map((c) => (c.field === 'notes' || c.field === 'customer' ? { field: c.field, from: null, to: null } : c)) : null,
        }));
        const data = await storage.read(a.history_archive_path);
        const file = data ? JSON.parse(data.toString('utf8')) : {};
        await storage.save(a.history_archive_path, Buffer.from(JSON.stringify({ ...file, entries, anonymised_at: new Date().toISOString() })));
      }
    }
    if (own) await client.query('COMMIT');
  } catch (e) {
    if (own) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { if (own) (client as PoolClient).release(); }
}

// ---------------------------------------------------------------------------------------------
// Moving long-past history to file storage (owner, 23 Nov 2026)
// ---------------------------------------------------------------------------------------------

/**
 * The history of appointments that ended more than `months` ago (and are finished: completed,
 * cancelled or no-show) is moved to file storage, one JSON file per appointment, and removed from
 * the table only once the file is written and read back. An appointment changed after that (a late
 * refund) gets the new entries added to its file the next time. The History section reads both.
 */
export async function archiveBookingHistory(opts: { months?: number; batch?: number; tenantId?: string | null } = {}): Promise<{ archived: number; entries: number; failed: number }> {
  const months = Math.max(1, Math.round(opts.months ?? 12));
  const batch = Math.max(1, Math.min(5000, Math.round(opts.batch ?? 500)));
  const { rows: due } = await adminPool.query(
    `SELECT b.id, b.business_id, z.tenant_id, b.history_archive_path, EXTRACT(YEAR FROM b.start_time)::int AS year
       FROM apt_bookings b JOIN sys_businesses z ON z.id = b.business_id
      WHERE b.end_time < NOW() - make_interval(months => $1)
        AND b.status IN ('completed', 'cancelled', 'no_show')
        AND EXISTS (SELECT 1 FROM apt_booking_status_history h WHERE h.booking_id = b.id)
        AND ($3::uuid IS NULL OR z.tenant_id = $3)
      ORDER BY b.end_time
      LIMIT $2`, [months, batch, opts.tenantId ?? null]);
  const { storage } = await import('./storage.service');
  const { storagePaths } = await import('../utils/storage-paths');
  let archived = 0; let entries = 0; let failed = 0;
  for (const b of due as Array<{ id: string; business_id: string; tenant_id: string; history_archive_path: string | null; year: number }>) {
    try {
      const fresh = await tableRows(b.id);
      if (fresh.length === 0) continue;
      const path = b.history_archive_path || storagePaths.bookingHistory(b.tenant_id, b.business_id, b.year, b.id);
      const earlier = await archivedRows(b.history_archive_path);
      const ids = new Set(earlier.map((r) => r.id));
      const all = [...earlier, ...fresh.filter((r) => !ids.has(r.id))].sort((x, y) => x.created_at.localeCompare(y.created_at));
      const body = Buffer.from(JSON.stringify({ booking_id: b.id, business_id: b.business_id, archived_at: new Date().toISOString(), entries: all }));
      await storage.save(path, body);
      // Removed from the table only once the file is there and complete.
      const back = await storage.read(path);
      if (!back || !back.equals(body)) throw new Error(msg('errors:bookingHistory.theArchiveFileDidNotRead'));
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.history_archive = 'on'`);
        await client.query(`DELETE FROM apt_booking_status_history WHERE booking_id = $1 AND id = ANY($2::uuid[])`, [b.id, fresh.map((r) => r.id)]);
        await client.query(`SET LOCAL app.history_archive = 'off'`);
        await client.query(`UPDATE apt_bookings SET history_archive_path = $2, history_archived_at = NOW() WHERE id = $1`, [b.id, path]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally { client.release(); }
      archived++; entries += fresh.length;
    } catch (e) {
      failed++;
      console.error('[History] Not archived for booking', b.id, (e as Error)?.message || e);
    }
  }
  return { archived, entries, failed };
}

// ---------------------------------------------------------------------------------------------
// The tenant's schedule for it (owner, 23 Nov 2026): one run per tenant, at a time the tenant
// chooses in its time zone, for all its businesses. Shown on the tenant's Processes page.
// ---------------------------------------------------------------------------------------------

export interface ArchiveScheduleView {
  enabled: boolean; scheduleTime: string; scheduleTimezone: string; months: number;
  lastRunAt: string | null; lastRunStatus: string | null; lastError: string | null; nextRunAt: string | null;
  /** Appointments whose history is in the table, and in files. */
  inTable: number; archived: number;
}

const ARCHIVE_JOB = 'booking_history_archive';

export async function getArchiveSchedule(tenantId: string): Promise<ArchiveScheduleView> {
  const { rows } = await adminPool.query(
    `SELECT enabled, schedule_time, schedule_timezone, config, last_run_at, last_run_status, last_error, next_run_at
       FROM sys_scheduled_jobs WHERE scope_level = 'tenant' AND tenant_id = $1::uuid AND job_type = $2 LIMIT 1`,
    [tenantId, ARCHIVE_JOB]);
  const { rows: counts } = await adminPool.query(
    `SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM apt_booking_status_history h WHERE h.booking_id = b.id))::int AS in_table,
            COUNT(*) FILTER (WHERE b.history_archive_path IS NOT NULL)::int AS archived
       FROM apt_bookings b JOIN sys_businesses z ON z.id = b.business_id WHERE z.tenant_id = $1`, [tenantId]);
  const r = rows[0];
  return {
    enabled: r ? r.enabled : true,
    scheduleTime: r ? String(r.schedule_time).slice(0, 5) : '03:00',
    scheduleTimezone: r?.schedule_timezone || 'UTC',
    months: Number(r?.config?.months) || 12,
    lastRunAt: r?.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastRunStatus: r?.last_run_status ?? null,
    lastError: r?.last_error ?? null,
    nextRunAt: r?.next_run_at ? new Date(r.next_run_at).toISOString() : null,
    inTable: counts[0].in_table, archived: counts[0].archived,
  };
}

export async function saveArchiveSchedule(tenantId: string, s: { scheduleTime: string; scheduleTimezone: string; enabled: boolean; months: number }): Promise<ArchiveScheduleView> {
  const { computeNextRunUtc } = await import('../jobs/schedule-time');
  const next = computeNextRunUtc({ scheduleTime: s.scheduleTime, timezone: s.scheduleTimezone, frequency: 'daily' });
  const months = Math.max(1, Math.min(120, Math.round(s.months)));
  await adminPool.query(
    `INSERT INTO sys_scheduled_jobs (scope_level, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at, config)
     VALUES ('tenant', $1::uuid, $2, $3, $4, 'daily', $5, $6, jsonb_build_object('months', $7::int, 'batch', 500))
     ON CONFLICT (tenant_id, job_type) WHERE scope_level = 'tenant'
     DO UPDATE SET schedule_time = $3, schedule_timezone = $4, enabled = $5, next_run_at = $6,
                   config = COALESCE(sys_scheduled_jobs.config, '{}'::jsonb) || jsonb_build_object('months', $7::int), updated_at = NOW()`,
    [tenantId, ARCHIVE_JOB, s.scheduleTime, s.scheduleTimezone, s.enabled, next, months]);
  return getArchiveSchedule(tenantId);
}

/** Run it now for the tenant (as the job would), and record the run on the job. */
export async function runArchiveNow(tenantId: string): Promise<{ archived: number; entries: number; failed: number }> {
  const { rows } = await adminPool.query(
    `SELECT id, config FROM sys_scheduled_jobs WHERE scope_level = 'tenant' AND tenant_id = $1::uuid AND job_type = $2 LIMIT 1`, [tenantId, ARCHIVE_JOB]);
  const started = Date.now();
  try {
    const result = await runAsJob('Appointment history storage', () => archiveBookingHistory({ tenantId, months: Number(rows[0]?.config?.months) || 12, batch: Number(rows[0]?.config?.batch) || 500 }));
    if (rows[0]) {
      await adminPool.query(
        `UPDATE sys_scheduled_jobs SET last_run_at = NOW(), last_run_status = $2, last_run_duration_ms = $3, last_error = NULL, updated_at = NOW() WHERE id = $1`,
        [rows[0].id, result.failed > 0 ? 'failed' : 'success', Date.now() - started]);
    }
    return result;
  } catch (e) {
    if (rows[0]) {
      await adminPool.query(
        `UPDATE sys_scheduled_jobs SET last_run_at = NOW(), last_run_status = 'failed', last_run_duration_ms = $2, last_error = $3, updated_at = NOW() WHERE id = $1`,
        [rows[0].id, Date.now() - started, (e as Error)?.message || String(e)]);
    }
    throw e;
  }
}

/** A new tenant starts with the job on (03:00 in its time zone, 12 months), so it is never forgotten. */
export async function ensureArchiveSchedule(tenantId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM sys_scheduled_jobs WHERE scope_level = 'tenant' AND tenant_id = $1::uuid AND job_type = $2`, [tenantId, ARCHIVE_JOB]);
  if (rows.length > 0) return;
  const { rows: tz } = await adminPool.query(`SELECT COALESCE(NULLIF(timezone, ''), 'UTC') AS tz FROM sys_tenants WHERE id = $1`, [tenantId]);
  await saveArchiveSchedule(tenantId, { scheduleTime: '03:00', scheduleTimezone: tz[0]?.tz || 'UTC', enabled: true, months: 12 });
}