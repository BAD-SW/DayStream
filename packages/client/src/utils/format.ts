import { currentLocale } from '../i18n';
import { parseDateOnly } from './date';
import { getBusinessCurrency } from './currency';

/**
 * The one place that formats dates, times and numbers for display (Phase 44, design section 5).
 *
 * Everything uses the device's regional setting when it is for the language shown (en-GB or en-US
 * for English), otherwise the language's own default (es-ES for Spanish). Amounts stay in the
 * business's currency whatever the language; appointment times are shown in the business's time zone.
 */

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** A timestamp's date, e.g. 24/11/2026 or 11/24/2026. Pass timeZone for the business's calendar day. */
export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = {}): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(currentLocale(), options).format(d) : '';
}

/** A DATE-only value ("2026-11-24") with no time-zone day shift. */
export function formatDay(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  const d = parseDateOnly(value);
  return d ? new Intl.DateTimeFormat(currentLocale(), options).format(d) : '';
}

/** A time of day, e.g. 9:00 AM or 09:00, in the given time zone (the business's). */
export function formatTime(value: DateInput, timeZone?: string, options: Intl.DateTimeFormatOptions = {}): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone, ...options }).format(d) : '';
}

/** A date and time, in the given time zone (the business's). */
export function formatDateTime(value: DateInput, timeZone?: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(currentLocale(), { timeZone, ...options }).format(d) : '';
}

export function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}): string {
  return value === null || value === undefined || isNaN(value) ? '' : new Intl.NumberFormat(currentLocale(), options).format(value);
}

/** A percentage from a number of percent (12.5 → "12.5%" or "12,5 %"). */
export function formatPercent(percent: number | null | undefined, maximumFractionDigits = 2): string {
  return percent === null || percent === undefined || isNaN(percent)
    ? ''
    : new Intl.NumberFormat(currentLocale(), { style: 'percent', maximumFractionDigits }).format(percent / 100);
}

/** An amount in cents, in the business's currency unless another is given ("€12.50", "12,50 €"). */
export function formatMoney(cents: number, currency?: string): string {
  const curr = (currency || getBusinessCurrency()).toUpperCase();
  try {
    return new Intl.NumberFormat(currentLocale(), { style: 'currency', currency: curr }).format(cents / 100);
  } catch {
    return `${curr} ${(cents / 100).toFixed(2)}`;
  }
}

/**
 * A country's name in the language shown, from the browser's built-in names (Intl.DisplayNames: every
 * country, in every language); `fallback` (the English name) when the browser has none.
 */
export function formatCountry(iso2: string, fallback?: string): string {
  try {
    const name = new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(iso2.toUpperCase());
    if (name && name.toUpperCase() !== iso2.toUpperCase()) return name;
  } catch { /* an older browser */ }
  return fallback ?? iso2;
}

/** The decimal separator of the current format ("." or ","), for amount inputs. */
export function decimalSeparator(): string {
  return new Intl.NumberFormat(currentLocale()).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
}
