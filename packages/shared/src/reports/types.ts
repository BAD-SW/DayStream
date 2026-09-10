/**
 * Shared report contract used by both client and server.
 *
 * A report is defined once by its columns plus a server-side query runner. The
 * column `type` is the single source of truth for how a value is formatted on
 * screen, in CSV, and in PDF, so the three renderings never drift.
 */

export type ReportColumnType = 'text' | 'number' | 'currency' | 'date' | 'percent';
export type ReportColumnAlign = 'left' | 'right' | 'center';

export interface ReportColumn {
  /** Matches a key on each returned row. */
  key: string;
  /** Column header label. */
  header: string;
  /** Drives formatting, default alignment, and whether a total is meaningful. */
  type: ReportColumnType;
  /** Renders a per-column filter input in the runner. */
  filterable?: boolean;
  /** Offers a "Group by {header}" checkbox in the runner; groups rows by this column's value. */
  groupable?: boolean;
  /** Include a column total (number / currency columns only). */
  total?: boolean;
  /** Overrides the default alignment derived from `type`. */
  align?: ReportColumnAlign;
  /** Optional fixed column width (CSS value). */
  width?: string;
}

export interface ReportRunMeta {
  reportId: string;
  title: string;
  businessName: string;
  dateRange: { start: string; end: string };
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  /** ISO 4217 currency code used to format currency columns (e.g. 'USD', 'EUR'). */
  currency: string;
}

export interface ReportRunResult {
  columns: ReportColumn[];
  rows: Record<string, any>[];
  /** Keyed by column key, for columns declared with `total: true`. */
  totals: Record<string, number>;
  meta: ReportRunMeta;
}

export type ReportExportFormat = 'csv' | 'pdf';
