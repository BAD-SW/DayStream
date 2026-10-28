/**
 * Start, duration and end of an event as the Create Event form shows them (David, 2026-10-28):
 * the start suggests 9:00, times are offered in 15-minute steps but any minute may be typed,
 * and changing the duration moves the end while changing the end changes the duration.
 *
 * Values are wall-clock dates ("YYYY-MM-DD") and times ("HH:mm") with no time zone; the
 * arithmetic is done in UTC so that it never shifts by the browser's own time zone.
 */

export const DEFAULT_START_TIME = '09:00';

export type DurationUnit = 'hours' | 'days';

export interface Duration { amount: number; unit: DurationUnit }

/** "00:00", "00:15", … "23:45": the suggestions offered in the time fields. */
export const QUARTER_HOURS: string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

function toMs(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
}

function fromMs(ms: number): { date: string; time: string } {
  const x = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`, time: `${p(x.getUTCHours())}:${p(x.getUTCMinutes())}` };
}

const HOUR = 3600 * 1000;

export function durationMs(d: Duration): number {
  return Math.round((Number(d.amount) || 0) * (d.unit === 'days' ? 24 : 1) * HOUR);
}

/** The end that follows from a start and a duration, or null while the start is incomplete. */
export function endFrom(startDate: string, startTime: string, d: Duration): { date: string; time: string } | null {
  const start = toMs(startDate, startTime);
  return start === null ? null : fromMs(start + durationMs(d));
}

/**
 * The duration between a start and an end: in days when it is a whole number of days and the
 * current unit is days, otherwise in hours (up to two decimals). Null when the end is not after
 * the start or a value is incomplete.
 */
export function durationBetween(startDate: string, startTime: string, endDate: string, endTime: string, unit: DurationUnit): Duration | null {
  const start = toMs(startDate, startTime);
  const end = toMs(endDate, endTime);
  if (start === null || end === null || end <= start) return null;
  const hours = (end - start) / HOUR;
  if (unit === 'days' && hours % 24 === 0) return { amount: hours / 24, unit: 'days' };
  return { amount: Math.round(hours * 100) / 100, unit: 'hours' };
}

/** True when both are complete and the end is not after the start. */
export function endNotAfterStart(startDate: string, startTime: string, endDate: string, endTime: string): boolean {
  const start = toMs(startDate, startTime);
  const end = toMs(endDate, endTime);
  return start !== null && end !== null && end <= start;
}
