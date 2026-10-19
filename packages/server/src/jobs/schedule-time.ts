/**
 * Timezone-correct scheduling math (shared by every job scheduler).
 *
 * A scheduled job stores a wall-clock `schedule_time` ("02:00") plus an IANA
 * `schedule_timezone` ("Europe/Madrid"). "Due" means the next instant at which the
 * wall clock in THAT zone reads the scheduled time — a fixed point in UTC that is
 * independent of where the server or the browser happen to be.
 *
 * The previous implementations leaked the SERVER's local zone into the math
 * (`new Date().setHours(...)` / a `toLocaleString` round-trip), so a job scheduled
 * for 02:00 Madrid fired at the server-offset-shifted time. These helpers compute
 * the UTC instant purely from (time, timezone) using Intl, with no dependency and
 * no server-zone leakage, and they are DST-correct.
 */

/**
 * How far ahead of UTC timezone `tz` is at instant `date`, in milliseconds.
 * Positive = ahead of UTC (e.g. Europe/Madrid summer = +2h). Derived by reading
 * the instant's wall-clock fields in `tz` and comparing to the same fields as UTC.
 */
function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** The UTC instant for a wall clock Y-M-D H:M in `tz` (DST-correct). */
function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = zoneOffsetMs(new Date(utcGuess), tz);
  let instant = utcGuess - offset;
  // Settle the result near a DST boundary, where the offset at the guessed
  // instant can differ from the offset at the true instant.
  const offset2 = zoneOffsetMs(new Date(instant), tz);
  if (offset2 !== offset) instant = utcGuess - offset2;
  return new Date(instant);
}

/** The calendar Y-M-D and weekday of `instant` AS SEEN in `tz`. */
function zonedParts(instant: Date, tz: string): { y: number; mo: number; d: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), dow: dowMap[parts.weekday] ?? 0 };
}

export interface ScheduleSpec {
  scheduleTime: string;              // "HH:MM"
  timezone: string;                  // IANA zone, e.g. "Europe/Madrid"
  frequency: string;                 // every_15min | hourly | daily | weekly | monthly
  dayOfWeek?: number | number[] | null; // 0=Sun..6=Sat (weekly)
  dayOfMonth?: number | null;        // 1..31, or -1 for last day (monthly)
}

/**
 * Compute the next run as a UTC ISO string. `from` defaults to now and is the
 * instant we schedule strictly AFTER (so a just-finished job moves forward).
 */
export function computeNextRunUtc(spec: ScheduleSpec, from: Date = new Date()): string {
  const tz = spec.timezone || 'UTC';
  const [h, mi] = (spec.scheduleTime || '02:00').split(':').map(Number);
  const freq = spec.frequency || 'daily';

  // High-frequency schedules are offset-based, not wall-clock-based.
  if (freq === 'every_15min') return new Date(from.getTime() + 15 * 60 * 1000).toISOString();
  if (freq === 'hourly') return new Date(from.getTime() + 60 * 60 * 1000).toISOString();

  // Candidate = today (in tz) at HH:MM. Walk forward until it's strictly after `from`
  // and (for weekly/monthly) lands on an allowed day. Capped so we always terminate.
  const base = zonedParts(from, tz);
  for (let addDays = 0; addDays <= 366; addDays++) {
    // The calendar day `addDays` after today, in tz. Build via a UTC noon anchor to
    // avoid DST edge issues, then read back the zone's date.
    const anchor = new Date(Date.UTC(base.y, base.mo - 1, base.d + addDays, 12, 0, 0));
    const cal = zonedParts(anchor, tz);
    const candidate = zonedWallClockToUtc(cal.y, cal.mo, cal.d, h, mi, tz);
    if (candidate.getTime() <= from.getTime()) continue;

    if (freq === 'daily') return candidate.toISOString();

    if (freq === 'weekly') {
      const days = Array.isArray(spec.dayOfWeek)
        ? spec.dayOfWeek
        : (spec.dayOfWeek != null ? [spec.dayOfWeek] : [1]);
      if (days.includes(cal.dow)) return candidate.toISOString();
      continue;
    }

    if (freq === 'monthly') {
      const target = spec.dayOfMonth ?? 1;
      // Last day of the candidate's month, as seen in tz.
      const lastDay = new Date(Date.UTC(cal.y, cal.mo, 0, 12, 0, 0)).getUTCDate();
      const wanted = target === -1 ? lastDay : target;
      if (cal.d === wanted) return candidate.toISOString();
      continue;
    }

    // Unknown frequency: treat as daily.
    return candidate.toISOString();
  }

  // Fallback (should never hit): tomorrow at the time, in tz.
  const fallback = zonedWallClockToUtc(base.y, base.mo, base.d + 1, h, mi, tz);
  return fallback.toISOString();
}
