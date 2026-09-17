import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ReportRunResult, ReportExportFormat, ReportColumn } from '@daystream/shared';
import { Button } from '../../design-system/components/actions/Button';
import { Table } from '../../design-system/components/data/Table';
import { useContextManager } from '../../context/ContextManager';
import * as reportsApi from '../../api/reports';
import { REPORT_CATALOG } from './reportCatalog';
import { formatReportValue, columnAlign, isNumericType } from './reportFormat';

function findCatalogEntry(reportId: string) {
  for (const category of REPORT_CATALOG) {
    const entry = category.reports.find((r) => r.id === reportId);
    if (entry) return entry;
  }
  return null;
}

/** Build design-system Table columns from a report column set, with fixed-layout
 *  proportional widths and per-type value formatting. Shared by the single-table
 *  view and each section of a multi-section report. */
function buildTableColumns(cols: ReportColumn[], currency: string) {
  const weightFor = (col: ReportColumn) => {
    if (col.type === 'currency' || col.type === 'number' || col.type === 'percent') return 1;
    if (col.type === 'date') return 1;
    return 2; // text columns get more room
  };
  const totalWeight = cols.reduce((sum, c) => sum + weightFor(c), 0) || 1;
  return cols.map((col) => ({
    key: col.key,
    header: col.header,
    sortable: true,
    width: col.width || `${((weightFor(col) / totalWeight) * 100).toFixed(2)}%`,
    align: columnAlign(col),
    // Keep report headers on a single line; the column widths give them room.
    headerStyle: { whiteSpace: 'nowrap' as const },
    render: (value: any) => (
      <span style={{ display: 'block', textAlign: columnAlign(col) }}>
        {formatReportValue(value, col.type, currency)}
      </span>
    ),
  }));
}

/** Build a footer-cells row (label in first cell, totals in totaled columns). */
function buildFooterCellsFor(cols: ReportColumn[], totals: Record<string, number>, currency: string, label: string) {
  return cols.map((col, idx) => ({
    align: columnAlign(col),
    content:
      idx === 0
        ? label
        : col.total && totals[col.key] != null
          ? formatReportValue(totals[col.key], col.type, currency)
          : '',
  }));
}

function isoFirstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportRunner() {
  const { reportId = '' } = useParams();
  const navigate = useNavigate();
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId;

  const entry = findCatalogEntry(reportId);

  const [fromDate, setFromDate] = useState<string>(isoFirstOfMonth());
  const [toDate, setToDate] = useState<string>(isoToday());
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState<string[]>([]);

  const rangeInvalid = !fromDate || !toDate || fromDate > toDate;

  const groupableColumns = result?.columns.filter((c) => c.groupable) ?? [];

  function toggleGroupBy(key: string) {
    setGroupBy((g) => (g.includes(key) ? g.filter((k) => k !== key) : [...g, key]));
  }

  const handleRun = useCallback(async () => {
    if (!businessId || !reportId || !fromDate || !toDate || fromDate > toDate) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await reportsApi.runReport(reportId, { start_date: fromDate, end_date: toDate });
      setResult(data);
      setFilters({});
      setGroupBy([]);
    } catch {
      setErrorMsg('Failed to run report. Check that a business is selected and try again.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, reportId, fromDate, toDate]);

  // Auto-run: generate the report on open and whenever the date range (or the
  // active business/report) changes. A short debounce coalesces the rapid
  // updates a date picker emits so we issue one request per settled range.
  // The Run button is intentionally omitted — changing a date IS the run.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!businessId || rangeInvalid) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void handleRun(); }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [businessId, rangeInvalid, handleRun]);

  async function handleExport(format: ReportExportFormat) {
    if (rangeInvalid) return;
    setExporting(format);
    try {
      const blob = await reportsApi.exportRunReport(reportId, format, { start_date: fromDate, end_date: toDate });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportId}_${fromDate}_${toDate}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMsg(`Failed to export ${format.toUpperCase()}.`);
    } finally {
      setExporting(null);
    }
  }

  // Client-side per-column filtering over the returned rows.
  const filteredRows = useMemo(() => {
    if (!result) return [];
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (active.length === 0) return result.rows;
    return result.rows.filter((row) =>
      active.every(([key, val]) => {
        const cell = row[key];
        if (cell == null) return false;
        return String(cell).toLowerCase().includes(val.trim().toLowerCase());
      }),
    );
  }, [result, filters]);

  // Totals recomputed from the currently filtered rows.
  const filteredTotals = useMemo(() => {
    if (!result) return {};
    const totals: Record<string, number> = {};
    for (const col of result.columns) {
      if (col.total && isNumericType(col.type)) {
        totals[col.key] = filteredRows.reduce((sum, row) => sum + (Number(row[col.key]) || 0), 0);
      }
    }
    return totals;
  }, [result, filteredRows]);

  // Grouped view: sections keyed by the selected group-by column values, each
  // with its own subtotals. Only active when at least one groupable column is selected.
  const groups = useMemo(() => {
    if (!result || groupBy.length === 0) return null;
    const totalCols = result.columns.filter((c) => c.total && isNumericType(c.type));
    const map = new Map<string, { label: string; rows: Record<string, any>[]; subtotals: Record<string, number> }>();
    for (const row of filteredRows) {
      const label = groupBy.map((k) => String(row[k] ?? '—')).join(' · ');
      let g = map.get(label);
      if (!g) {
        g = { label, rows: [], subtotals: {} };
        for (const col of totalCols) g.subtotals[col.key] = 0;
        map.set(label, g);
      }
      g.rows.push(row);
      for (const col of totalCols) g.subtotals[col.key] += Number(row[col.key]) || 0;
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [result, filteredRows, groupBy]);

  const columns = useMemo(() => (result ? buildTableColumns(result.columns, result.meta.currency) : []), [result]);

  // Build a footer-cells array (one per column, same order) for a totals row so
  // it renders inside the table and shares the exact column widths.
  function buildFooterCells(label: string, totals: Record<string, number>) {
    if (!result) return [];
    return buildFooterCellsFor(result.columns, totals, result.meta.currency, label);
  }

  if (!entry) {
    return (
      <div style={styles.page}>
        <Button variant="ghost" onClick={() => navigate('/reports')}>← Reports</Button>
        <p style={styles.errorText}>Unknown report: {reportId}</p>
      </div>
    );
  }

  const hasTotals = result?.columns.some((c) => c.total) ?? false;

  const filterRow = result ? (
    <>
      {result.columns.map((col) => (
        <th key={col.key} style={styles.filterCell}>
          {col.filterable ? (
            <input
              type="text"
              value={filters[col.key] || ''}
              placeholder="Filter…"
              onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
              style={styles.filterInput}
              aria-label={`Filter by ${col.header}`}
            />
          ) : null}
        </th>
      ))}
    </>
  ) : undefined;

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <Button variant="ghost" onClick={() => navigate('/reports')}>← Reports</Button>
          <h1 style={styles.title}>{entry.title}</h1>
          <p style={styles.description}>{entry.description}</p>
        </div>
      </div>

      <div style={styles.controlBar}>
        <div style={styles.dateField}>
          <label htmlFor="report-from" style={styles.dateLabel}>From</label>
          <input
            id="report-from"
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            style={styles.dateInput}
          />
        </div>
        <div style={styles.dateField}>
          <label htmlFor="report-to" style={styles.dateLabel}>To</label>
          <input
            id="report-to"
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            style={styles.dateInput}
          />
        </div>
        {loading && <span style={styles.runningHint}>Running…</span>}
        {result && groupableColumns.length > 0 && (
          <div style={styles.groupInline}>
            <span style={styles.groupBarLabel}>Group by</span>
            {groupableColumns.map((col) => (
              <label key={col.key} style={styles.groupCheck}>
                <input
                  type="checkbox"
                  checked={groupBy.includes(col.key)}
                  onChange={() => toggleGroupBy(col.key)}
                />
                {col.header}
              </label>
            ))}
          </div>
        )}
        <div style={styles.spacer} />
        <Button variant="outline" onClick={() => handleExport('csv')} loading={exporting === 'csv'} disabled={!result}>
          Save as CSV
        </Button>
        <Button variant="outline" onClick={() => handleExport('pdf')} loading={exporting === 'pdf'} disabled={!result}>
          Save as PDF
        </Button>
      </div>

      {!businessId && (
        <p style={styles.hint}>Select a business to run this report.</p>
      )}
      {businessId && rangeInvalid && (
        <p style={styles.hint}>Choose a From date on or before the To date.</p>
      )}
      {errorMsg && <p style={styles.errorText}>{errorMsg}</p>}

      {result && (
        <div style={styles.tableCard}>
          <div style={styles.resultMeta}>
            <span>{result.meta.businessName}</span>
            <span>
              {result.sections
                ? `${result.meta.dateRange.start} to ${result.meta.dateRange.end}`
                : `${filteredRows.length} of ${result.rows.length} rows · ${result.meta.dateRange.start} to ${result.meta.dateRange.end}`}
            </span>
          </div>

          {result.sections ? (
            <>
              {result.sections.map((section, secIdx) => {
                const secCols = buildTableColumns(section.columns, result.meta.currency);
                const hasSecTotals = section.columns.some((c) => c.total);
                const isLastSection = secIdx === result.sections!.length - 1;
                return (
                  <div key={section.id} style={{ ...styles.groupSection, ...(isLastSection ? {} : styles.sectionGap) }}>
                    <div style={styles.groupHeader}>{section.title} <span style={styles.groupCount}>({section.rows.length})</span></div>
                    <Table
                      columns={secCols}
                      data={section.rows}
                      clientSort
                      fixedLayout
                      emptyMessage="No data for the selected range"
                      footerRows={hasSecTotals && section.rows.length > 0
                        ? [{ cells: buildFooterCellsFor(section.columns, section.totals, result.meta.currency, 'Total'), strong: true }]
                        : undefined}
                    />
                  </div>
                );
              })}
            </>
          ) : groups ? (
            <>
              {groups.map((g, groupIdx) => {
                const isLast = groupIdx === groups.length - 1;
                const footerRows = [];
                if (hasTotals) {
                  footerRows.push({ cells: buildFooterCells('Subtotal', g.subtotals) });
                  // The grand total rides on the last group's table so it shares
                  // that table's exact column widths and stays aligned.
                  if (isLast && filteredRows.length > 0) {
                    footerRows.push({ cells: buildFooterCells('Grand Total', filteredTotals), strong: true });
                  }
                }
                return (
                  <div key={g.label} style={styles.groupSection}>
                    <div style={styles.groupHeader}>{g.label} <span style={styles.groupCount}>({g.rows.length})</span></div>
                    <Table
                      columns={columns}
                      data={g.rows}
                      clientSort
                      fixedLayout
                      emptyMessage="No rows"
                      footerRows={footerRows.length > 0 ? footerRows : undefined}
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <Table
              columns={columns}
              data={filteredRows}
              clientSort
              fixedLayout
              filterRow={filterRow}
              emptyMessage="No data for the selected range"
              footerRows={hasTotals && filteredRows.length > 0 ? [{ cells: buildFooterCells('Grand Total', filteredTotals), strong: true }] : undefined}
            />
          )}
        </div>
      )}

      {!result && !loading && businessId && !rangeInvalid && (
        <p style={styles.hint}>Generating report…</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 'var(--space-sm) 0 0' },
  description: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 0' },
  controlBar: { display: 'flex', alignItems: 'flex-end', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  dateField: { display: 'flex', flexDirection: 'column', gap: '4px' },
  dateLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  dateInput: { fontSize: 'var(--font-size-sm)', padding: '7px 9px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  spacer: { flex: 1 },
  hint: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  runningHint: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', paddingBottom: '9px' },
  errorText: { color: 'var(--color-danger, #b3261e)', fontSize: 'var(--font-size-sm)' },
  tableCard: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  resultMeta: { display: 'flex', justifyContent: 'space-between', padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' },
  filterCell: { padding: '4px var(--space-md)', borderBottom: '1px solid var(--color-border)' },
  filterInput: { width: '100%', fontSize: 'var(--font-size-xs)', padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text)' },
  groupInline: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', paddingBottom: '7px', marginLeft: '10px' },
  groupBarLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-bold)' as any, textTransform: 'uppercase', letterSpacing: '0.04em' },
  groupCheck: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  groupSection: { borderBottom: '1px solid var(--color-border)' },
  sectionGap: { marginBottom: 'var(--space-xl)' },
  groupHeader: { padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface-hover)', fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  groupCount: { color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-xs)' },
};
