import { useState, useCallback } from 'react';
import { sortByColumn, type SortDirection } from './utils';
import { truncateCellValue } from './utils';

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
 * ResultsPanel displays query results in a sortable table with fixed headers,
 * horizontal scrolling, null display, cell truncation, and various states.
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
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [expandedCell, setExpandedCell] = useState<{ row: number; col: string } | null>(null);

  const handleSort = useCallback(
    (columnName: string) => {
      if (sortColumn === columnName) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(columnName);
        setSortDirection('asc');
      }
    },
    [sortColumn]
  );

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

  // Sort rows
  const displayRows = sortColumn
    ? sortByColumn(rows, sortColumn, sortDirection)
    : rows;

  return (
    <div style={styles.container} data-testid="results-panel">
      {/* Truncation notice */}
      {truncated && (
        <div style={styles.truncationNotice}>
          Results truncated: showing first {maxRows ?? rows.length} of {rowCount ?? 'unknown'} rows
        </div>
      )}

      {/* Table with fixed headers and scroll */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.name}
                  style={styles.headerCell}
                  onClick={() => handleSort(col.name)}
                  title={`Sort by ${col.name} (${col.dataType})`}
                >
                  <span>{col.name}</span>
                  {sortColumn === col.name && (
                    <span style={styles.sortIndicator}>
                      {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIdx) => (
              <tr key={rowIdx} style={rowIdx % 2 === 0 ? styles.evenRow : undefined}>
                {columns.map((col) => {
                  const cellInfo = truncateCellValue(row[col.name]);
                  const isNull = row[col.name] === null;
                  const isExpanded =
                    expandedCell?.row === rowIdx && expandedCell?.col === col.name;

                  return (
                    <td
                      key={col.name}
                      style={{
                        ...styles.cell,
                        ...(isNull ? styles.nullCell : {}),
                      }}
                      onClick={
                        cellInfo.isTruncated
                          ? () =>
                              setExpandedCell(
                                isExpanded ? null : { row: rowIdx, col: col.name }
                              )
                          : undefined
                      }
                      title={cellInfo.isTruncated ? cellInfo.fullValue : undefined}
                    >
                      {isNull ? (
                        <span style={styles.nullValue}>NULL</span>
                      ) : isExpanded ? (
                        <span style={styles.expandedValue}>{cellInfo.fullValue}</span>
                      ) : (
                        <>
                          {cellInfo.displayValue}
                          {cellInfo.isTruncated && (
                            <span style={styles.truncationIndicator}>…</span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
    fontSize: '14px',
  },
  loadingText: {
    color: 'var(--color-text-secondary, #999)',
    fontSize: '14px',
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
    fontSize: '16px',
  },
  errorText: {
    fontSize: '13px',
    fontFamily: 'monospace',
    wordBreak: 'break-word',
  },
  truncationNotice: {
    padding: '6px 12px',
    fontSize: '12px',
    color: 'var(--color-warning, #f59e0b)',
    backgroundColor: 'var(--color-warning-bg, rgba(245, 158, 11, 0.1))',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  tableWrapper: {
    flex: 1,
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
    fontFamily: 'monospace',
  },
  headerCell: {
    position: 'sticky',
    top: 0,
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '12px',
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
    borderBottom: '1px solid var(--color-border, #333)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    zIndex: 1,
  },
  sortIndicator: {
    fontSize: '10px',
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
    fontSize: '12px',
    color: 'var(--color-text-secondary, #999)',
    borderTop: '1px solid var(--color-border, #333)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
  },
  executionTime: {
    color: 'var(--color-text-secondary, #999)',
  },
};
