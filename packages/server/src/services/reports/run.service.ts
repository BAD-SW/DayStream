import { ReportRunResult } from '@daystream/shared';
import { adminPool } from '../../db/pool';
import { ReportContext, ReportDefinition } from './types';

/**
 * Runs a report definition and assembles a full ReportRunResult: rows from the
 * definition's query, server-side totals for `total: true` columns, and meta
 * (business name + currency, date range, generated timestamp).
 */
export async function runReport(
  definition: ReportDefinition,
  ctx: ReportContext,
): Promise<ReportRunResult> {
  const rows = await definition.run(ctx);

  // Server-side totals over the full result set.
  const totals: Record<string, number> = {};
  for (const col of definition.columns) {
    if (col.total && (col.type === 'currency' || col.type === 'number')) {
      totals[col.key] = rows.reduce((sum, row) => sum + (Number(row[col.key]) || 0), 0);
    }
  }

  const { businessName, currency } = await resolveBusinessMeta(ctx.businessId);

  return {
    columns: definition.columns,
    rows,
    totals,
    meta: {
      reportId: definition.id,
      title: definition.title,
      businessName,
      dateRange: { start: ctx.start, end: ctx.end },
      generatedAt: new Date().toISOString(),
      currency,
    },
  };
}

async function resolveBusinessMeta(businessId: string): Promise<{ businessName: string; currency: string }> {
  const { rows } = await adminPool.query(
    `SELECT name, currency FROM sys_businesses WHERE id = $1`,
    [businessId],
  );
  if (rows.length === 0) {
    return { businessName: 'Business', currency: 'USD' };
  }
  return { businessName: rows[0].name, currency: rows[0].currency || 'USD' };
}
