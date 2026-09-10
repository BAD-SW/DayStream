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

/**
 * A report definition: the shared contract that makes adding a new report a
 * matter of declaring columns plus a query, with no new UI or endpoints.
 */
export interface ReportDefinition {
  /** Stable identifier, e.g. 'revenue'. Must match the client catalog entry id. */
  id: string;
  title: string;
  columns: ReportColumn[];
  /** Returns raw rows (money in cents, dates as ISO/date) keyed by column key. */
  run: (ctx: ReportContext) => Promise<Record<string, any>[]>;
}
