import type { ReportColumn, ReportColumnType } from '@daystream/shared';

/**
 * Client-side value formatting keyed by column type, used by the report table
 * render. Mirrors the server formatter so the on-screen table matches exports.
 */
export function formatReportValue(
  value: any,
  type: ReportColumnType,
  currency: string,
  locale = 'en-US',
): string {
  if (value == null || value === '') return '';
  switch (type) {
    case 'currency':
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value) / 100);
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale);
    }
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'number':
      return new Intl.NumberFormat(locale).format(Number(value));
    default:
      return String(value);
  }
}

/** Default column alignment derived from type unless explicitly overridden. */
export function columnAlign(col: ReportColumn): 'left' | 'right' | 'center' {
  if (col.align) return col.align;
  return col.type === 'currency' || col.type === 'number' ? 'right' : 'left';
}

/** True for column types whose raw value should be compared numerically when filtering. */
export function isNumericType(type: ReportColumnType): boolean {
  return type === 'currency' || type === 'number' || type === 'percent';
}
