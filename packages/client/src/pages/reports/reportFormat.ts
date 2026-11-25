import type { ReportColumn, ReportColumnType } from '@daystream/shared';
import { formatDate, formatDay, formatMoney, formatNumber } from '../../utils/format';

/**
 * Client-side value formatting keyed by column type, used by the report table
 * render. Mirrors the server formatter so the on-screen table matches exports.
 */
export function formatReportValue(
  value: any,
  type: ReportColumnType,
  currency: string,
): string {
  if (value == null || value === '') return '';
  switch (type) {
    case 'currency':
      return formatMoney(Number(value), currency);
    case 'date': {
      // A report date is a bare CALENDAR date already in the business's timezone
      // (the server runs reports on the business clock). It arrives as a
      // 'YYYY-MM-DD' string; parse those components directly and render as a local
      // date WITHOUT any timezone conversion. Using new Date('YYYY-MM-DD') would
      // parse it as midnight UTC and then shift it a day for viewers behind UTC —
      // the classic date-only off-by-one. Only fall back to Date parsing for a
      // value that isn't a plain date string.
      const s = typeof value === 'string' ? value : '';
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) return formatDay(`${m[1]}-${m[2]}-${m[3]}`);
      return formatDate(value) || String(value);
    }
    case 'percent':
      return formatNumber(Number(value) / 100, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'number':
      return formatNumber(Number(value));
    default:
      return String(value);
  }
}

/** Default column alignment derived from type unless explicitly overridden. */
export function columnAlign(col: ReportColumn): 'left' | 'right' | 'center' {
  if (col.align) return col.align;
  // Numeric columns are centered so the header label and values line up.
  return col.type === 'currency' || col.type === 'number' || col.type === 'percent' ? 'center' : 'left';
}

/** True for column types whose raw value should be compared numerically when filtering. */
export function isNumericType(type: ReportColumnType): boolean {
  return type === 'currency' || type === 'number' || type === 'percent';
}
