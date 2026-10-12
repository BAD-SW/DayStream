/**
 * Wall-clock time in a business's own time zone.
 *
 * Bookings are stored as instants (UTC). Opening hours, staff availability and shifts are
 * stored as wall-clock times ("09:00") that mean 09:00 where the business is. To compare the
 * two, the instant has to be read in the business's time zone: reading its UTC clock instead
 * shifts every comparison by the zone's offset (two hours for Madrid in summer) and, near
 * midnight, moves it to the wrong day.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  /** Calendar date where the business is, YYYY-MM-DD. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, where the business is. */
  dayOfWeek: number;
  /** Minutes since local midnight. */
  minutes: number;
}

/** An instant as the business's local date, weekday and time of day. Unknown zones fall back to UTC. */
export function localParts(instant: Date, timeZone: string | null | undefined): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone || 'UTC').formatToParts(instant);
  } catch {
    parts = formatterFor('UTC').formatToParts(instant);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dayOfWeek: WEEKDAYS[get('weekday')] ?? 0,
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
  };
}

/**
 * A slot as local minutes since midnight of its starting day. The end is the start plus the
 * slot's length, so a slot that runs past midnight ends after 24:00 instead of wrapping to 00:xx.
 */
export function localSlotMinutes(start: Date, end: Date, timeZone: string | null | undefined): { date: string; dayOfWeek: number; startMinutes: number; endMinutes: number } {
  const s = localParts(start, timeZone);
  return { date: s.date, dayOfWeek: s.dayOfWeek, startMinutes: s.minutes, endMinutes: s.minutes + Math.round((end.getTime() - start.getTime()) / 60000) };
}
