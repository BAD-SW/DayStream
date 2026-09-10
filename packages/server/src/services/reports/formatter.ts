import { ReportColumnType } from '@daystream/shared';

/**
 * Server-side value formatting keyed by column type, used by the CSV and PDF
 * exporters so exports match the report definition's declared types.
 *
 * CSV favors machine-friendly values (no currency symbol, ISO dates); PDF
 * favors human-readable values (currency symbol, locale date).
 */

function centsToDecimalString(cents: number): string {
  return (Number(cents) / 100).toFixed(2);
}

function toIsoDate(value: any): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

/** Format a value for CSV (no symbols, ISO dates, raw numbers). */
export function formatForCsv(value: any, type: ReportColumnType): string {
  if (value == null) return '';
  switch (type) {
    case 'currency':
      return centsToDecimalString(Number(value));
    case 'date':
      return toIsoDate(value);
    case 'percent':
      return String(value);
    case 'number':
      return String(value);
    default:
      return String(value);
  }
}

/** Format a value for the PDF table (human-readable). */
export function formatForPdf(value: any, type: ReportColumnType, currency: string, locale = 'en-US'): string {
  if (value == null) return '';
  switch (type) {
    case 'currency':
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value) / 100);
    case 'date':
      return toIsoDate(value);
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'number':
      return new Intl.NumberFormat(locale).format(Number(value));
    default:
      return String(value);
  }
}
