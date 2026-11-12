/** Wall-clock helpers in the business's time zone (calendar and New Appointment). */

export const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Local date and minutes of an instant in a time zone. */
export function zonedParts(d: Date, timezone: string): { date: string; minutes: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}

/** UTC ISO instant of a local date + "HH:MM" in a time zone. */
export function zonedToIso(date: string, time: string, timezone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const inTz = new Date(guess.toLocaleString('en-US', { timeZone: timezone }));
  const inUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (inUtc.getTime() - inTz.getTime())).toISOString();
}

export const addDays = (date: string, n: number) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayLabel = (date: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
