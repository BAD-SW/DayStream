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

/**
 * A named section within a multi-section report. Each section is its own table
 * with its own columns, rows, and totals — used when one report needs to present
 * distinct datasets side by side (e.g. Staff Utilization + Resource Utilization).
 */
export interface ReportSection {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  /** Keyed by column key, for columns declared with `total: true`. */
  totals: Record<string, number>;
}

export interface ReportRunResult {
  /**
   * Single-table reports populate columns/rows/totals. Multi-section reports
   * instead populate `sections` (and leave columns/rows empty). The runner
   * renders sections stacked when present, otherwise the single table.
   */
  columns: ReportColumn[];
  rows: Record<string, any>[];
  /** Keyed by column key, for columns declared with `total: true`. */
  totals: Record<string, number>;
  /** Present for multi-section reports; each renders as its own titled table. */
  sections?: ReportSection[];
  meta: ReportRunMeta;
}

export type ReportExportFormat = 'csv' | 'pdf';
