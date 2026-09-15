import { ReportColumn } from '@daystream/shared';

/**
 * Execution context passed to a report's query runner. `tenantId` is used to
 * scope RLS; `businessId` scopes the business; `start`/`end` are the inclusive
 * date-range bounds (yyyy-mm-dd).
 */
export interface ReportContext {
  tenantId: string;
  businessId: string;
  start: string;
  end: string;
}

/** One section of a multi-section report: its own columns and rows. */
export interface ReportSectionDef {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
}

/**
 * A report definition: the shared contract that makes adding a new report a
 * matter of declaring columns plus a query, with no new UI or endpoints.
 *
 * Most reports are single-table: provide `columns` + `run`. A report that needs
 * to present multiple distinct datasets provides `buildSections` instead, which
 * returns one section per table (each with its own columns/rows).
 */
export interface ReportDefinition {
  /** Stable identifier, e.g. 'revenue'. Must match the client catalog entry id. */
  id: string;
  title: string;
  /** Single-table reports: the column set. Omitted for section-based reports. */
  columns?: ReportColumn[];
  /** Single-table reports: returns raw rows keyed by column key. */
  run?: (ctx: ReportContext) => Promise<Record<string, any>[]>;
  /** Multi-section reports: returns one section per table. */
  buildSections?: (ctx: ReportContext) => Promise<ReportSectionDef[]>;
}
