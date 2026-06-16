import { useState, useMemo, useCallback } from 'react';
import { filterBySubstring } from './utils';
import type { SchemaTable } from '@daystream/shared';

export interface SchemaPanelProps {
  tables: SchemaTable[];
  loading?: boolean;
  error?: string;
  onRefresh: () => void;
  onInsert: (identifier: string) => void;
}

/**
 * SchemaPanel displays a tree view of tables and columns with search,
 * click-to-insert, and refresh capabilities.
 */
export function SchemaPanel({
  tables,
  loading,
  error,
  onRefresh,
  onInsert,
}: SchemaPanelProps) {
  const [search, setSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const filteredTables = useMemo(
    () => filterBySubstring(tables, search, (t) => t.tableName),
    [tables, search]
  );

  const toggleTable = useCallback((tableName: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  }, []);

  const handleTableClick = useCallback(
    (tableName: string) => {
      onInsert(tableName);
    },
    [onInsert]
  );

  const handleColumnClick = useCallback(
    (columnName: string) => {
      onInsert(columnName);
    },
    [onInsert]
  );

  // Error state
  if (error) {
    return (
      <div style={styles.container} data-testid="schema-panel">
        <div style={styles.errorState}>
          <span style={styles.errorText}>{error}</span>
          <button style={styles.retryButton} onClick={onRefresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!loading && tables.length === 0) {
    return (
      <div style={styles.container} data-testid="schema-panel">
        <div style={styles.header}>
          <span style={styles.title}>Schema</span>
          <button style={styles.refreshButton} onClick={onRefresh} title="Refresh schema">
            ↻
          </button>
        </div>
        <div style={styles.emptyState}>
          <span style={styles.emptyText}>No tables found</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} data-testid="schema-panel">
      <div style={styles.header}>
        <span style={styles.title}>Schema</span>
        <button
          style={styles.refreshButton}
          onClick={onRefresh}
          disabled={loading}
          title="Refresh schema"
        >
          ↻
        </button>
      </div>

      {/* Search input */}
      <div style={styles.searchWrapper}>
        <input
          type="text"
          placeholder="Filter tables..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
          data-testid="schema-search"
        />
      </div>

      {/* Loading indicator */}
      {loading && <div style={styles.loadingBar}>Loading...</div>}

      {/* Table tree */}
      <div style={styles.treeContainer}>
        {filteredTables.map((table) => {
          const isExpanded = expandedTables.has(table.tableName);
          return (
            <div key={table.tableName} style={styles.tableNode}>
              <div style={styles.tableRow}>
                <button
                  style={styles.expandButton}
                  onClick={() => toggleTable(table.tableName)}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <span
                  style={styles.tableName}
                  onClick={() => handleTableClick(table.tableName)}
                  title={`Click to insert "${table.tableName}"`}
                >
                  {table.tableName}
                </span>
                <span style={styles.columnCount}>
                  ({table.columns.length})
                </span>
              </div>

              {isExpanded && (
                <div style={styles.columnList}>
                  {table.columns.map((col) => (
                    <div
                      key={col.columnName}
                      style={styles.columnRow}
                      onClick={() => handleColumnClick(col.columnName)}
                      title={`Click to insert "${col.columnName}"`}
                    >
                      <span style={styles.columnName}>{col.columnName}</span>
                      <span style={styles.columnType}>{col.dataType}</span>
                      {col.isNullable && (
                        <span style={styles.nullableBadge}>nullable</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  title: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--color-text, #fff)',
  },
  refreshButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary, #999)',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  searchWrapper: {
    padding: '8px',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  searchInput: {
    width: '100%',
    padding: '6px 8px',
    fontSize: '12px',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '3px',
    backgroundColor: 'var(--color-surface, #1e1e1e)',
    color: 'var(--color-text, #e0e0e0)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  loadingBar: {
    padding: '4px 12px',
    fontSize: '11px',
    color: 'var(--color-text-secondary, #999)',
    textAlign: 'center',
  },
  treeContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 0',
  },
  tableNode: {
    marginBottom: '2px',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
  },
  expandButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary, #999)',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '0 4px',
    width: '20px',
    textAlign: 'center',
  },
  tableName: {
    fontSize: '12px',
    color: 'var(--color-primary, #C9A96E)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  columnCount: {
    fontSize: '11px',
    color: 'var(--color-text-muted, #666)',
  },
  columnList: {
    paddingLeft: '28px',
  },
  columnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '3px 8px',
    cursor: 'pointer',
    borderRadius: '2px',
  },
  columnName: {
    fontSize: '12px',
    color: 'var(--color-text, #e0e0e0)',
  },
  columnType: {
    fontSize: '11px',
    color: 'var(--color-text-muted, #666)',
  },
  nullableBadge: {
    fontSize: '10px',
    color: 'var(--color-warning, #f59e0b)',
    padding: '1px 4px',
    borderRadius: '2px',
    backgroundColor: 'var(--color-warning-bg, rgba(245, 158, 11, 0.1))',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '24px',
  },
  errorText: {
    fontSize: '13px',
    color: 'var(--color-error, #dc2626)',
    textAlign: 'center',
  },
  retryButton: {
    padding: '6px 12px',
    fontSize: '12px',
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-primary, #C9A96E)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary, #999)',
  },
};
