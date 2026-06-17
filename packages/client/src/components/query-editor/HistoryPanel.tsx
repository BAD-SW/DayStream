import { useState, useMemo } from 'react';
import { filterBySubstring } from './utils';
import type { QueryHistoryDTO } from '@daystream/shared';

export interface HistoryPanelProps {
  entries: QueryHistoryDTO[];
  loading?: boolean;
  error?: string;
  onSelect: (queryText: string) => void;
  onRetry: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'var(--color-success, #22c55e)',
  error: 'var(--color-error, #dc2626)',
  timeout: 'var(--color-warning, #f59e0b)',
  cancelled: 'var(--color-text-muted, #666)',
};

/**
 * HistoryPanel displays recent query history with search, click to load,
 * and status badges.
 */
export function HistoryPanel({
  entries,
  loading,
  error,
  onSelect,
  onRetry,
}: HistoryPanelProps) {
  const [search, setSearch] = useState('');

  const filteredEntries = useMemo(
    () => filterBySubstring(entries, search, (e) => e.queryText),
    [entries, search]
  );

  // Error state
  if (error) {
    return (
      <div style={styles.container} data-testid="history-panel">
        <div style={styles.errorState}>
          <span style={styles.errorText}>{error}</span>
          <button style={styles.retryButton} onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} data-testid="history-panel">
      <div style={styles.header}>
        <span style={styles.title}>History</span>
      </div>

      {/* Search */}
      <div style={styles.searchWrapper}>
        <input
          type="text"
          placeholder="Search queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
          data-testid="history-search"
        />
      </div>

      {/* Loading */}
      {loading && <div style={styles.loadingBar}>Loading...</div>}

      {/* Entry list */}
      <div style={styles.listContainer}>
        {filteredEntries.length === 0 && !loading ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyText}>
              {search ? 'No matching queries' : 'No query history'}
            </span>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              style={styles.entry}
              onClick={() => onSelect(entry.queryText)}
              title={entry.queryText}
              data-testid={`history-entry-${entry.id}`}
            >
              <div style={styles.entryHeader}>
                <span
                  style={{
                    ...styles.statusBadge,
                    color: STATUS_COLORS[entry.status] || '#999',
                  }}
                >
                  {entry.status}
                </span>
                <span style={styles.executionTime}>
                  {entry.executionTimeMs < 1000
                    ? `${entry.executionTimeMs}ms`
                    : `${(entry.executionTimeMs / 1000).toFixed(2)}s`}
                </span>
              </div>
              <div style={styles.queryText}>
                {entry.queryText.length > 120
                  ? entry.queryText.slice(0, 120) + '…'
                  : entry.queryText}
              </div>
              <div style={styles.timestamp}>
                {formatTimestamp(entry.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
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
  listContainer: {
    flex: 1,
    overflow: 'auto',
  },
  entry: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--color-border, #222)',
    cursor: 'pointer',
  },
  entryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  executionTime: {
    fontSize: '11px',
    color: 'var(--color-text-muted, #666)',
  },
  queryText: {
    fontSize: '12px',
    fontFamily: 'monospace',
    color: 'var(--color-text, #e0e0e0)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timestamp: {
    fontSize: '11px',
    color: 'var(--color-text-muted, #666)',
    marginTop: '4px',
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
};
