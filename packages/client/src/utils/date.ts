/**
 * Date helpers for DATE-only values coming from the API.
 *
 * Postgres DATE columns (e.g. a journal entry's entry_date, an invoice due_date)
 * serialize as a plain `YYYY-MM-DD` string with NO time or zone. The trap:
 * `new Date("2026-10-14")` parses that as MIDNIGHT UTC, so rendering it in a
 * timezone behind UTC (e.g. US Eastern) shows the PREVIOUS day. These helpers
 * interpret a date-only string in the LOCAL calendar instead, so the day shown
 * matches the day stored.
 *
 * Use these for date-only values. For true timestamps (created_at etc., which
 * carry a time + zone), `new Date(ts)` is correct and these are unnecessary.
 */

/** Parse a `YYYY-MM-DD` (optionally with a time) into a LOCAL-time Date. */
export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  // Take just the date part and build a local date (month is 0-indexed).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Fallback: let the engine try (handles full timestamps).
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Locale date string for a DATE-only value, with no timezone day-shift. */
export function formatDateOnly(value: string | Date | null | undefined, locale?: string): string {
  const d = parseDateOnly(value);
  return d ? d.toLocaleDateString(locale) : '';
}

/** ISO `YYYY-MM-DD` for a DATE-only value in LOCAL calendar terms (for CSV/export). */
export function toISODateOnly(value: string | Date | null | undefined): string {
  const d = parseDateOnly(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
