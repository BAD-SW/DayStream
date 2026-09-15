import { ReportColumn, ReportRunResult, ReportSection } from '@daystream/shared';
import { adminPool } from '../../db/pool';
import { ReportContext, ReportDefinition } from './types';

/** Sum `total: true` numeric/currency columns over a row set. */
function computeTotals(columns: ReportColumn[], rows: Record<string, any>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const col of columns) {
    if (col.total && (col.type === 'currency' || col.type === 'number')) {
      totals[col.key] = rows.reduce((sum, row) => sum + (Number(row[col.key]) || 0), 0);
    }
  }
  return totals;
}

/**
 * Runs a report definition and assembles a full ReportRunResult. Single-table
 * reports (columns + run) populate columns/rows/totals; section-based reports
 * (buildSections) populate the sections array instead. Both carry meta
 * (business name + currency, date range, generated timestamp).
 */
export async function runReport(
  definition: ReportDefinition,
  ctx: ReportContext,
): Promise<ReportRunResult> {
  const { businessName, currency } = await resolveBusinessMeta(ctx.businessId);
  const meta = {
    reportId: definition.id,
    title: definition.title,
    businessName,
    dateRange: { start: ctx.start, end: ctx.end },
    generatedAt: new Date().toISOString(),
    currency,
  };

  // Multi-section report
  if (definition.buildSections) {
    const built = await definition.buildSections(ctx);
    const sections: ReportSection[] = built.map((s) => ({
      id: s.id,
      title: s.title,
      columns: s.columns,
      rows: s.rows,
      totals: computeTotals(s.columns, s.rows),
    }));
    return { columns: [], rows: [], totals: {}, sections, meta };
  }

  // Single-table report
  const columns = definition.columns ?? [];
  const rows = definition.run ? await definition.run(ctx) : [];
  return {
    columns,
    rows,
    totals: computeTotals(columns, rows),
    meta,
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
