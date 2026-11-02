import { useState, useRef, useEffect } from 'react';
import { truncateCellValue } from './utils';
import { Table } from '../../design-system/components/data/Table';

export interface ResultsPanelProps {
  columns: { name: string; dataType: string }[];
  rows: Record<string, unknown>[];
  executionTimeMs?: number;
  rowCount?: number;
  truncated?: boolean;
  maxRows?: number;
  error?: string;
  loading?: boolean;
}

/**
 * ResultsPanel displays query results on the shared table (sort, column filters
 * beside the sort icon — David 2026-11-02) scrolling inside the panel with its
 * header pinned, plus null display, cell truncation, and various states.
 */
export function ResultsPanel({
  columns,
  rows,
  executionTimeMs,
  rowCount,
  truncated,
  maxRows,
  error,
  loading,
}: ResultsPanelProps) {
  // The expanded cell: the row object itself (stays right when the rows are sorted or filtered).
  const [expandedCell, setExpandedCell] = useState<{ row: Record<string, unknown>; col: string } | null>(null);
  // The table scrolls inside the panel: its height, measured (a percentage cannot reach the table).
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaHeight, setAreaHeight] = useState(0);
  useEffect(() => {
    const el = areaRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setAreaHeight(el.clientHeight));
    ro.observe(el); setAreaHeight(el.clientHeight);
    return () => ro.disconnect();
  });

  // Loading state
  if (loading) {
    return (
      <div style={styles.container} data-testid="results-panel">
        <div style={styles.centerState}>
          <span style={styles.loadingText}>Executing query...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.container} data-testid="results-panel">
        <div style={styles.errorPanel}>
          <span style={styles.errorIcon}>⚠</span>
          <span style={styles.errorText}>{error}</span>
        </div>
      </div>
    );
  }

  // Empty state
  if (!columns || columns.length === 0) {
    return (
      <div style={styles.container} data-testid="results-panel">
        <div style={styles.centerState}>
          <span style={styles.emptyText}>No results</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} data-testid="results-panel">
      {/* Truncation notice */}
      {truncated && (
        <div style={styles.truncationNotice}>
          Results truncated: showing first {maxRows ?? rows.length} of {rowCount ?? 'unknown'} rows
        </div>
      )}

      {/* Table with fixed headers and scroll */}
      <div ref={areaRef} style={styles.tableWrapper}>
        <Table
          rowId={(row) => String(rows.indexOf(row))}
          data={rows}
          clientSort
          scrollHeight={areaHeight ? `${areaHeight}px` : undefined}
          columns={columns.map((col) => ({
            key: col.name,
            header: col.name,
            // Wide enough for the name and its sort/filter icons on one line.
            headerStyle: { minWidth: `${Math.max(col.name.length * 9 + 56, 96)}px`, whiteSpace: 'nowrap' as const },
            sortable: true,
            render: (_: unknown, row: Record<string, unknown>) => {
              const cellInfo = truncateCellValue(row[col.name]);
              const isNull = row[col.name] === null;
              const isExpanded = expandedCell?.row === row && expandedCell?.col === col.name;
              if (isNull) return <span style={styles.nullValue}>NULL</span>;
              return (
                <span
                  style={{ ...styles.cellText, ...(isExpanded ? styles.cellTextExpanded : {}), ...(cellInfo.isTruncated ? { cursor: 'pointer' } : {}) }}
                  onClick={cellInfo.isTruncated ? () => setExpandedCell(isExpanded ? null : { row, col: col.name }) : undefined}
                  title={cellInfo.isTruncated ? cellInfo.fullValue : `${col.name} (${col.dataType})`}
                >
                  {isExpanded ? (
                    <span style={styles.expandedValue}>{cellInfo.fullValue}</span>
                  ) : (
                    <>
                      {cellInfo.displayValue}
                      {cellInfo.isTruncated && <span style={styles.truncationIndicator}>…</span>}
                    </>
                  )}
                </span>
              );
            },
          }))}
        />
      </div>

      {/* Footer with row count and execution time */}
      <div style={styles.footer}>
        <span>
          {rowCount ?? rows.length} row{(rowCount ?? rows.length) !== 1 ? 's' : ''}
        </span>
        {executionTimeMs != null && (
          <span style={styles.executionTime}>
            {executionTimeMs < 1000
              ? `${executionTimeMs}ms`
              : `${(executionTimeMs / 1000).toFixed(2)}s`}
          </span>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    border: '1px solid var(--color-border, #333)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  centerState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '120px',
    padding: '24px',
  },
  emptyText: {
    color: 'var(--color-text-secondary, #999)',
    fontSize: 'var(--font-size-base)',
  },
  loadingText: {
    color: 'var(--color-text-secondary, #999)',
    fontSize: 'var(--font-size-base)',
  },
  errorPanel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    margin: '12px',
    backgroundColor: 'var(--color-error-bg, rgba(220, 38, 38, 0.1))',
    border: '1px solid var(--color-error, #dc2626)',
    borderRadius: '4px',
    color: 'var(--color-error, #dc2626)',
  },
  errorIcon: {
    fontSize: 'var(--font-size-base)',
  },
  errorText: {
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'monospace',
    wordBreak: 'break-word',
  },
  truncationNotice: {
    padding: '6px 12px',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-warning, #f59e0b)',
    backgroundColor: 'var(--color-warning-bg, rgba(245, 158, 11, 0.1))',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  tableWrapper: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  cellText: {
    display: 'inline-block',
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    fontFamily: 'monospace',
    fontSize: 'var(--font-size-sm)',
  },
  cellTextExpanded: {
    whiteSpace: 'normal',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'monospace',
  },
  headerCell: {
    position: 'sticky',
    top: 0,
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
    borderBottom: '1px solid var(--color-border, #333)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    zIndex: 1,
  },
  sortIndicator: {
    fontSize: 'var(--font-size-xs)',
    opacity: 0.8,
  },
  evenRow: {
    backgroundColor: 'var(--color-surface-subtle, rgba(255,255,255,0.02))',
  },
  cell: {
    padding: '6px 12px',
    borderBottom: '1px solid var(--color-border, #222)',
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--color-text, #e0e0e0)',
  },
  nullCell: {},
  nullValue: {
    fontStyle: 'italic',
    color: 'var(--color-text-muted, #666)',
  },
  expandedValue: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  truncationIndicator: {
    color: 'var(--color-text-muted, #666)',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 12px',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary, #999)',
    borderTop: '1px solid var(--color-border, #333)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
  },
  executionTime: {
    color: 'var(--color-text-secondary, #999)',
  },
};
