import bcrypt from 'bcrypt';
import { adminPool } from '../db/pool';

/**
 * Clock in/out time tracking — an append-only event log (clk_events) of punches:
 * clock_in, break_start, break_end, clock_out. A staff member's current state is
 * derived from their latest event; worked hours are computed by pairing events
 * in time order (clocked spans minus break spans).
 *
 * Live punches happen at a shared screen authenticated by staff number
 * (stf_profiles.staff_ref) + a 4-digit PIN (bcrypt-hashed in stf_profiles.
 * clock_pin_hash). Managers/owners add/edit/delete entries as corrections
 * (source = 'manual').
 */

const SALT_ROUNDS = 12;

export type ClockEventType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type ClockState = 'clocked_out' | 'working' | 'on_break';

/** Allowed next events from each state — the clock state machine. */
const ALLOWED_NEXT: Record<ClockState, ClockEventType[]> = {
  clocked_out: ['clock_in'],
  working: ['break_start', 'clock_out'],
  on_break: ['break_end'],
};

/** The state a given event transitions the user INTO. */
const STATE_AFTER: Record<ClockEventType, ClockState> = {
  clock_in: 'working',
  break_start: 'on_break',
  break_end: 'working',
  clock_out: 'clocked_out',
};

// --- PIN brute-force guard (in-memory, per staff_ref) -----------------------
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const pinAttempts = new Map<string, { count: number; firstAt: number }>();

function pinLockKey(businessId: string, staffRef: string): string {
  return `${businessId}:${staffRef.toLowerCase()}`;
}

function isPinLocked(key: string): boolean {
  const rec = pinAttempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOCKOUT_MS) { pinAttempts.delete(key); return false; }
  return rec.count >= MAX_PIN_ATTEMPTS;
}

function registerPinFailure(key: string): void {
  const rec = pinAttempts.get(key);
  if (!rec || Date.now() - rec.firstAt > LOCKOUT_MS) {
    pinAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    rec.count += 1;
  }
}

function clearPinFailures(key: string): void {
  pinAttempts.delete(key);
}

// --- PIN management ---------------------------------------------------------

/** Set (or reset) a staff member's 4-digit clock PIN. Stored bcrypt-hashed. */
export async function setClockPin(staffProfileId: string, businessId: string, pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const hash = await bcrypt.hash(pin, SALT_ROUNDS);
  const { rowCount } = await adminPool.query(
    `UPDATE stf_profiles sp SET clock_pin_hash = $1, updated_at = NOW()
       WHERE sp.id = $2
         AND sp.user_id IN (SELECT id FROM usr_users WHERE business_id = $3)`,
    [hash, staffProfileId, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Self-service: set the caller's OWN clock PIN, resolved from their user id. The
 * target staff profile is derived from the authenticated user — never from
 * client input — so a staff member can only ever change their own PIN.
 */
export async function setOwnClockPin(userId: string, pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const hash = await bcrypt.hash(pin, SALT_ROUNDS);
  const { rowCount } = await adminPool.query(
    `UPDATE stf_profiles SET clock_pin_hash = $1, updated_at = NOW() WHERE user_id = $2`,
    [hash, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Self-service status: whether the caller has a staff profile and a PIN set.
 * Used by the profile UI to show "set" vs "change" and whether clocking is
 * available to them. Never returns the PIN itself.
 */
export async function getOwnClockPinStatus(userId: string): Promise<{ hasProfile: boolean; hasPin: boolean; staffRef: string | null }> {
  const { rows } = await adminPool.query(
    `SELECT staff_ref, clock_pin_hash FROM stf_profiles WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return { hasProfile: false, hasPin: false, staffRef: null };
  return { hasProfile: true, hasPin: !!rows[0].clock_pin_hash, staffRef: rows[0].staff_ref };
}

interface ResolvedStaff {
  user_id: string;
  staff_profile_id: string;
  tenant_id: string;
  staff_ref: string | null;
  first_name: string;
  last_name: string;
}

/**
 * Verify a staff member's EMAIL + PIN for a business. Email is the convenient,
 * familiar identifier staff type at the clock; the resolved record is still
 * keyed to the immutable user_id (and the staff_ref is carried through for the
 * audit stamp), so an email change never affects clock history. Returns the
 * resolved staff on success, or null on bad credentials. Throws { code:'LOCKED' }
 * when rate-limited.
 */
export async function verifyClockPin(
  businessId: string,
  email: string,
  pin: string,
): Promise<ResolvedStaff | null> {
  const key = pinLockKey(businessId, email);
  if (isPinLocked(key)) {
    const err: any = new Error('Too many failed attempts. Try again shortly.');
    err.code = 'LOCKED';
    throw err;
  }

  // Resolve by the user's login email within the business. The staff profile
  // carries the stable staff_ref and the clock PIN.
  const { rows } = await adminPool.query(
    `SELECT sp.id AS staff_profile_id, sp.user_id, sp.tenant_id, sp.clock_pin_hash,
            sp.staff_ref, sp.first_name, sp.last_name
       FROM usr_users u
       JOIN stf_profiles sp ON sp.user_id = u.id
      WHERE u.business_id = $1 AND LOWER(u.email) = LOWER($2) AND sp.status = 'active'`,
    [businessId, email],
  );

  const staff = rows[0];
  // Always run a compare (even with no match / no PIN set) to avoid leaking which
  // staff numbers exist via timing. Use a dummy hash when absent.
  const hash = staff?.clock_pin_hash || '$2b$12$0000000000000000000000000000000000000000000000000000';
  const ok = await bcrypt.compare(pin, hash);

  if (!staff || !staff.clock_pin_hash || !ok) {
    registerPinFailure(key);
    return null;
  }

  clearPinFailures(key);
  return {
    user_id: staff.user_id,
    staff_profile_id: staff.staff_profile_id,
    tenant_id: staff.tenant_id,
    staff_ref: staff.staff_ref,
    first_name: staff.first_name,
    last_name: staff.last_name,
  };
}

// --- State ------------------------------------------------------------------

/** Current clock state for a user, derived from their most recent event. */
export async function getCurrentState(userId: string, businessId: string): Promise<{
  state: ClockState;
  since: string | null;
  allowed: ClockEventType[];
}> {
  const { rows } = await adminPool.query(
    `SELECT event_type, event_at FROM clk_events
      WHERE user_id = $1 AND business_id = $2
      ORDER BY event_at DESC, created_at DESC LIMIT 1`,
    [userId, businessId],
  );
  const last = rows[0];
  const state: ClockState = last ? STATE_AFTER[last.event_type as ClockEventType] : 'clocked_out';
  return { state, since: last ? last.event_at : null, allowed: ALLOWED_NEXT[state] };
}

// --- Punch (live, PIN-authenticated) ----------------------------------------

/**
 * Record a live clock punch after verifying it's a valid transition from the
 * user's current state. Returns the created event and the new state.
 */
export async function punch(
  businessId: string,
  tenantId: string,
  userId: string,
  eventType: ClockEventType,
  staffRef: string | null,
): Promise<{ event: any; state: ClockState }> {
  const { state } = await getCurrentState(userId, businessId);
  if (!ALLOWED_NEXT[state].includes(eventType)) {
    const err: any = new Error(`Cannot ${eventType.replace('_', ' ')} while ${state.replace('_', ' ')}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  // staff_ref is stamped as an audit snapshot; user_id remains the stable key.
  const { rows } = await adminPool.query(
    `INSERT INTO clk_events (tenant_id, business_id, user_id, event_type, source, created_by, staff_ref)
     VALUES ($1, $2, $3, $4, 'clock', $3, $5) RETURNING *`,
    [tenantId, businessId, userId, eventType, staffRef],
  );
  return { event: rows[0], state: STATE_AFTER[eventType] };
}

// --- Manager corrections (manual) -------------------------------------------

/** List clock events for a user within a date range (inclusive). */
export async function listEvents(
  businessId: string,
  userId: string,
  start: string,
  end: string,
): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT ce.*, TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS staff
       FROM clk_events ce
       JOIN usr_users u ON u.id = ce.user_id
      WHERE ce.business_id = $1 AND ce.user_id = $2
        AND ce.event_at >= $3::timestamptz AND ce.event_at < ($4::date + INTERVAL '1 day')
      ORDER BY ce.event_at ASC`,
    [businessId, userId, start, end],
  );
  return rows;
}

/** Create a manual (manager-entered) clock event — a correction. */
export async function createManualEvent(input: {
  businessId: string;
  tenantId: string;
  userId: string;
  eventType: ClockEventType;
  eventAt: string;
  note?: string;
  createdBy: string;
}): Promise<any> {
  // Stamp the staff_ref from the user's profile at insert time (audit snapshot).
  const { rows } = await adminPool.query(
    `INSERT INTO clk_events (tenant_id, business_id, user_id, event_type, event_at, source, created_by, note, staff_ref)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7,
             (SELECT staff_ref FROM stf_profiles WHERE user_id = $3))
     RETURNING *`,
    [input.tenantId, input.businessId, input.userId, input.eventType, input.eventAt, input.createdBy, input.note || null],
  );
  return rows[0];
}

/** Update a manual clock event (time / type / note). Only manual events are editable. */
export async function updateManualEvent(
  id: string,
  businessId: string,
  updates: { eventType?: ClockEventType; eventAt?: string; note?: string },
): Promise<any | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (updates.eventType !== undefined) { fields.push(`event_type = $${idx++}`); values.push(updates.eventType); }
  if (updates.eventAt !== undefined) { fields.push(`event_at = $${idx++}`); values.push(updates.eventAt); }
  if (updates.note !== undefined) { fields.push(`note = $${idx++}`); values.push(updates.note); }
  if (fields.length === 0) return null;
  values.push(id, businessId);
  const { rows } = await adminPool.query(
    `UPDATE clk_events SET ${fields.join(', ')}
      WHERE id = $${idx++} AND business_id = $${idx} AND source = 'manual'
      RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/** Delete a clock event (manager correction). */
export async function deleteEvent(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    `DELETE FROM clk_events WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Hours computation ------------------------------------------------------

export interface DayHours {
  date: string;         // YYYY-MM-DD in business tz
  worked_minutes: number;
  break_minutes: number;
}

/**
 * Compute worked and break minutes per local day for a user over a range, by
 * pairing events in time order. A clock_in opens a work span closed by clock_out;
 * break_start opens a break span (within work) closed by break_end. Spans are
 * attributed to the local day of the span's START (business timezone).
 *
 * Dangling opens (e.g. a forgotten clock_out) are ignored for totals — they
 * contribute no time until closed/corrected, which is the safe default and the
 * signal a manager acts on.
 */
export async function computeDailyHours(
  businessId: string,
  userId: string,
  start: string,
  end: string,
  timezone: string,
): Promise<DayHours[]> {
  const { rows: events } = await adminPool.query(
    `SELECT event_type, event_at FROM clk_events
      WHERE business_id = $1 AND user_id = $2
        AND event_at >= $3::timestamptz AND event_at < ($4::date + INTERVAL '1 day')
      ORDER BY event_at ASC, created_at ASC`,
    [businessId, userId, start, end],
  );

  const localDate = (d: Date): string => d.toLocaleDateString('sv-SE', { timeZone: timezone });
  const byDay = new Map<string, { worked: number; break: number }>();
  const add = (day: string, kind: 'worked' | 'break', mins: number) => {
    let r = byDay.get(day);
    if (!r) { r = { worked: 0, break: 0 }; byDay.set(day, r); }
    r[kind] += mins;
  };

  let workStart: Date | null = null;
  let breakStart: Date | null = null;

  for (const e of events) {
    const at = new Date(e.event_at);
    switch (e.event_type as ClockEventType) {
      case 'clock_in':
        workStart = at; breakStart = null;
        break;
      case 'break_start':
        if (workStart) breakStart = at;
        break;
      case 'break_end':
        if (breakStart) {
          add(localDate(breakStart), 'break', (at.getTime() - breakStart.getTime()) / 60000);
          breakStart = null;
        }
        break;
      case 'clock_out':
        if (workStart) {
          // Close any open break first.
          if (breakStart) {
            add(localDate(breakStart), 'break', (at.getTime() - breakStart.getTime()) / 60000);
            breakStart = null;
          }
          add(localDate(workStart), 'worked', (at.getTime() - workStart.getTime()) / 60000);
          workStart = null;
        }
        break;
    }
  }

  return Array.from(byDay.entries())
    .map(([date, r]) => ({
      date,
      worked_minutes: Math.round(r.worked - r.break),
      break_minutes: Math.round(r.break),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Total clocked hours (net of breaks) for a user over a range — the payroll feed. */
export async function clockedHoursForUser(
  businessId: string,
  userId: string,
  start: string,
  end: string,
  timezone: string,
): Promise<number> {
  const days = await computeDailyHours(businessId, userId, start, end, timezone);
  const minutes = days.reduce((sum, d) => sum + d.worked_minutes, 0);
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Total SCHEDULED hours for a user over a date range — the other payroll feed for
 * hourly compensation. Sums the duration of their 'shift' schedule entries
 * (stf_schedule_entries) whose schedule_date falls in the range. Schedule entries
 * are keyed by stf_profiles.id, so we join through to the user. start_time/end_time
 * are naive local TIME; EXTRACT(EPOCH ...) on the difference gives the shift
 * length regardless of timezone.
 */
export async function scheduledHoursForUser(
  businessId: string,
  userId: string,
  start: string,
  end: string,
): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 3600.0), 0)::numeric AS hours
       FROM stf_schedule_entries e
       JOIN stf_profiles sp ON sp.id = e.staff_id
      WHERE e.business_id = $1
        AND sp.user_id = $2
        AND e.entry_type = 'shift'
        AND e.schedule_date >= $3::date AND e.schedule_date <= $4::date`,
    [businessId, userId, start, end],
  );
  return Math.round((parseFloat(rows[0].hours) || 0) * 100) / 100;
}

// ============================================================
// Self-service (the signed-in employee's OWN records, read-only)
// ============================================================

/**
 * Resolve the signed-in user's own business id and that business's timezone.
 * The business is taken from usr_users.business_id — never from client input —
 * so self-service lookups can only ever target the caller's own data.
 */
async function ownBusinessContext(userId: string): Promise<{ businessId: string; timezone: string } | null> {
  const { rows } = await adminPool.query(
    `SELECT u.business_id, COALESCE(b.timezone, 'UTC') AS timezone
       FROM usr_users u
       LEFT JOIN sys_businesses b ON b.id = u.business_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !row.business_id) return null;
  return { businessId: row.business_id, timezone: row.timezone };
}

/** The caller's OWN clock events for a date range. Scoped to their user + business. */
export async function listOwnEvents(userId: string, start: string, end: string): Promise<any[]> {
  const ctx = await ownBusinessContext(userId);
  if (!ctx) return [];
  return listEvents(ctx.businessId, userId, start, end);
}

/** The caller's OWN computed daily hours for a date range. Scoped to their user + business. */
export async function computeOwnDailyHours(userId: string, start: string, end: string): Promise<DayHours[]> {
  const ctx = await ownBusinessContext(userId);
  if (!ctx) return [];
  return computeDailyHours(ctx.businessId, userId, start, end, ctx.timezone);
}
