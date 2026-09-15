import { adminPool } from '../../../db/pool';
import { ReportColumn } from '@daystream/shared';
import { ReportContext, ReportSectionDef } from '../types';

/**
 * Utilization report — two sections in one report:
 *
 *   Staff Utilization    = booked staff-time ÷ scheduled working time
 *   Resource Utilization = booked resource-time ÷ business open time
 *
 * Booked time includes buffers (the staff member / resource is occupied during
 * prep/cleanup) and counts, per booking: for past/today appointments, statuses
 * completed + in_progress (what actually happened); for future appointments,
 * confirmed (what's committed). Cancellations and no-shows never count.
 *
 * Staff scheduled time comes from the business's scheduling model ('schedule'
 * mode -> stf_schedule_entries shifts; otherwise stf_availability_patterns +
 * slots, minus 'remove' overrides).
 *
 * Resource availability: there is no resource operating-hours config in use and
 * no business-hours table, so the business "open window" for a day is taken as
 * the coverage span of staff schedules that day — earliest staff start to latest
 * staff end (across all staff, not one person). A day with no staff scheduled is
 * a closed day (0 available). A resource's available time is the open window;
 * capacity is not a factor (utilization measures whether the resource was
 * occupied during open hours, not how full it was).
 *
 * Rows with no denominator show "—" utilization.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */

const STAFF_COLUMNS: ReportColumn[] = [
  { key: 'name', header: 'Staff', type: 'text', filterable: true },
  { key: 'scheduled_hours', header: 'Scheduled Hours', type: 'number' },
  { key: 'booked_hours', header: 'Booked Hours', type: 'number' },
  { key: 'utilization', header: 'Utilization %', type: 'percent' },
];

const RESOURCE_COLUMNS: ReportColumn[] = [
  { key: 'name', header: 'Resource', type: 'text', filterable: true },
  { key: 'available_hours', header: 'Available Hours', type: 'number' },
  { key: 'booked_hours', header: 'Booked Hours', type: 'number' },
  { key: 'utilization', header: 'Utilization %', type: 'percent' },
];

/** Round hours to 1 decimal. */
function hrs(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** "HH:MM[:SS]" -> minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Normalize a DB date/timestamp to yyyy-mm-dd. pg may return DATE columns as a
 * JS Date (whose String() form is a locale string, not ISO) or as a string —
 * normalize both so lexical date comparisons are reliable.
 */
function toYmd(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Each yyyy-mm-dd date in [start, end] inclusive, with its day-of-week (0=Sun). */
function eachDay(start: string, end: string): Array<{ date: string; dow: number }> {
  const out: Array<{ date: string; dow: number }> = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last) {
    out.push({ date: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A per-staff-per-day working interval, in minutes since midnight. */
interface WorkInterval { userId: string; date: string; startMin: number; endMin: number; }

/**
 * Resolve every staff working interval in the range from the business's
 * scheduling model. Returns per-user scheduled seconds (for the staff section)
 * and the flat interval list (for computing the daily business open window).
 */
async function resolveStaffIntervals(
  businessId: string, start: string, end: string,
): Promise<{ scheduledByUser: Map<string, number>; intervals: WorkInterval[] }> {
  const days = eachDay(start, end);
  const { rows: bizRows } = await adminPool.query(
    'SELECT scheduling_mode FROM sys_businesses WHERE id = $1', [businessId],
  );
  const mode = bizRows[0]?.scheduling_mode || 'availability';

  const intervals: WorkInterval[] = [];
  const scheduledByUser = new Map<string, number>();
  const add = (userId: string, date: string, startMin: number, endMin: number) => {
    if (endMin <= startMin) return;
    intervals.push({ userId, date, startMin, endMin });
    scheduledByUser.set(userId, (scheduledByUser.get(userId) || 0) + (endMin - startMin) * 60);
  };

  if (mode === 'schedule') {
    const { rows } = await adminPool.query(
      `SELECT sp.user_id, e.schedule_date, e.start_time, e.end_time
         FROM stf_schedule_entries e
         JOIN stf_profiles sp ON sp.id = e.staff_id
        WHERE e.business_id = $1 AND e.entry_type = 'shift'
          AND e.schedule_date BETWEEN $2::date AND $3::date`,
      [businessId, start, end],
    );
    for (const r of rows) {
      add(r.user_id, toYmd(r.schedule_date)!, timeToMinutes(r.start_time), timeToMinutes(r.end_time));
    }
  } else {
    const { rows: slots } = await adminPool.query(
      `SELECT sp.user_id, ps.day_of_week, ps.start_time, ps.end_time, p.effective_from, p.effective_to
         FROM stf_availability_pattern_slots ps
         JOIN stf_availability_patterns p ON p.id = ps.pattern_id
         JOIN stf_profiles sp ON sp.id = p.staff_id
         JOIN usr_users u ON u.id = sp.user_id
        WHERE u.business_id = $1 AND p.is_default = true`,
      [businessId],
    );
    const { rows: overrides } = await adminPool.query(
      `SELECT sp.user_id, o.override_date, o.override_type, o.start_time, o.end_time
         FROM stf_availability_overrides o
         JOIN stf_profiles sp ON sp.id = o.staff_id
         JOIN usr_users u ON u.id = sp.user_id
        WHERE u.business_id = $1 AND o.override_date BETWEEN $2::date AND $3::date`,
      [businessId, start, end],
    );
    const overrideByUserDate = new Map<string, any>();
    for (const o of overrides) overrideByUserDate.set(`${o.user_id}|${toYmd(o.override_date)}`, o);

    // Distinct users that have any pattern slot
    const userIds = [...new Set(slots.map((s: any) => s.user_id))];

    for (const { date, dow } of days) {
      for (const userId of userIds) {
        const ov = overrideByUserDate.get(`${userId}|${date}`);
        if (ov) {
          if (ov.override_type === 'remove') continue; // day off
          if ((ov.override_type === 'modify' || ov.override_type === 'add') && ov.start_time && ov.end_time) {
            add(userId, date, timeToMinutes(ov.start_time), timeToMinutes(ov.end_time));
            continue;
          }
        }
        const daySlots = slots.filter((sl: any) => {
          const ef = toYmd(sl.effective_from);
          const et = toYmd(sl.effective_to);
          return sl.user_id === userId && sl.day_of_week === dow
            && (!ef || date >= ef) && (!et || date <= et);
        });
        for (const sl of daySlots) {
          add(userId, date, timeToMinutes(sl.start_time), timeToMinutes(sl.end_time));
        }
      }
    }
  }

  return { scheduledByUser, intervals };
}

/**
 * The business open window per day = coverage span of staff schedules that day
 * (earliest start to latest end, across all staff). Returns total open seconds
 * summed over the range. A day with no staff = closed = contributes nothing.
 */
function businessOpenSeconds(intervals: WorkInterval[]): number {
  const byDate = new Map<string, { min: number; max: number }>();
  for (const iv of intervals) {
    const cur = byDate.get(iv.date);
    if (!cur) byDate.set(iv.date, { min: iv.startMin, max: iv.endMin });
    else { cur.min = Math.min(cur.min, iv.startMin); cur.max = Math.max(cur.max, iv.endMin); }
  }
  let secs = 0;
  for (const { min, max } of byDate.values()) secs += Math.max(0, max - min) * 60;
  return secs;
}

/**
 * Booked seconds (incl. buffers) per key (staff_id or resource_id), applying the
 * past/future status rule.
 */
async function bookedSecondsByKey(
  businessId: string, start: string, end: string, keyCol: 'staff_id' | 'resource_id',
): Promise<Map<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await adminPool.query(
    `SELECT ${keyCol} AS key,
            SUM(
              EXTRACT(EPOCH FROM (b.end_time - b.start_time))
              + COALESCE(b.buffer_before, 0) * 60
              + COALESCE(b.buffer_after, 0) * 60
            ) AS secs
       FROM apt_bookings b
      WHERE b.business_id = $1
        AND b.${keyCol} IS NOT NULL
        AND b.start_time::date BETWEEN $2::date AND $3::date
        AND (
          (b.start_time::date <= $4::date AND b.status IN ('completed', 'in_progress'))
          OR (b.start_time::date > $4::date AND b.status = 'confirmed')
        )
      GROUP BY ${keyCol}`,
    [businessId, start, end, today],
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.key, Number(r.secs) || 0);
  return map;
}

function buildStaffSection(
  staff: Array<{ user_id: string; first_name: string; last_name: string }>,
  scheduledByUser: Map<string, number>,
  bookedByStaff: Map<string, number>,
): ReportSectionDef {
  const rows = staff.map((s) => {
    const scheduledSecs = scheduledByUser.get(s.user_id) || 0;
    const bookedSecs = bookedByStaff.get(s.user_id) || 0;
    const utilization = scheduledSecs > 0 ? Math.round((bookedSecs / scheduledSecs) * 1000) / 10 : null;
    return {
      name: `${s.first_name} ${s.last_name}`.trim(),
      scheduled_hours: hrs(scheduledSecs),
      booked_hours: hrs(bookedSecs),
      utilization,
    };
  });
  return { id: 'staff', title: 'Staff Utilization', columns: STAFF_COLUMNS, rows };
}

async function buildResourceSection(
  businessId: string, start: string, end: string, openSecs: number,
): Promise<ReportSectionDef> {
  const { rows: resources } = await adminPool.query(
    `SELECT r.id, r.name, r.capacity
       FROM res_resources r
       JOIN sys_businesses b ON b.tenant_id = r.tenant_id
      WHERE b.id = $1 AND r.status = 'active'
      ORDER BY r.name`,
    [businessId],
  );

  const bookedByResource = await bookedSecondsByKey(businessId, start, end, 'resource_id');

  const rows = resources.map((r: any) => {
    // Available time = the business open window (time-based, capacity NOT a
    // factor): utilization measures whether the resource was occupied during
    // open hours, not how full it was. Denominator is 0 when the business had no
    // staff-covered days in the range → utilization "—".
    const bookedSecs = bookedByResource.get(r.id) || 0;
    const utilization = openSecs > 0 ? Math.round((bookedSecs / openSecs) * 1000) / 10 : null;
    return {
      name: r.name,
      available_hours: hrs(openSecs),
      booked_hours: hrs(bookedSecs),
      utilization,
    };
  });

  return { id: 'resource', title: 'Resource Utilization', columns: RESOURCE_COLUMNS, rows };
}

export const utilizationReport = {
  id: 'utilization',
  title: 'Utilization',
  buildSections: async (ctx: ReportContext): Promise<ReportSectionDef[]> => {
    const { businessId, start, end } = ctx;

    // Active staff (for the staff section rows)
    const { rows: staff } = await adminPool.query(
      `SELECT sp.user_id, u.first_name, u.last_name
         FROM stf_profiles sp
         JOIN usr_users u ON u.id = sp.user_id
        WHERE u.business_id = $1 AND sp.status = 'active' AND sp.user_id IS NOT NULL
        ORDER BY u.last_name, u.first_name`,
      [businessId],
    );

    const { scheduledByUser, intervals } = await resolveStaffIntervals(businessId, start, end);
    const openSecs = businessOpenSeconds(intervals);

    const [bookedByStaff, resourceSection] = await Promise.all([
      bookedSecondsByKey(businessId, start, end, 'staff_id'),
      buildResourceSection(businessId, start, end, openSecs),
    ]);

    const staffSection = buildStaffSection(staff, scheduledByUser, bookedByStaff);
    return [staffSection, resourceSection];
  },
};
