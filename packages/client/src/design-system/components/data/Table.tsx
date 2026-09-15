import { ReactNode, useState } from 'react';
import cssStyles from './Table.module.css';

interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (value: any, row: T) => ReactNode;
  width?: string;
  /** Header text alignment. Defaults to left. */
  align?: 'left' | 'right' | 'center';
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onSort?: (key: string, order: 'asc' | 'desc') => void;
  /** When true, the Table will sort data locally without needing onSort */
  clientSort?: boolean;
  onRowClick?: (row: T) => void;
  // Pagination
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  // Row selection
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  rowId?: (row: T) => string;
  // Responsive
  mobileCardMode?: boolean;
  /** Optional second header row (e.g. per-column filter inputs), one cell per column in the same order. */
  filterRow?: ReactNode;
  /**
   * Optional footer row (e.g. totals / subtotals). One entry per column in the
   * same order; rendered as a real table row so it shares the column widths.
   */
  footerRows?: {
    cells: { content: ReactNode; align?: 'left' | 'right' | 'center' }[];
    strong?: boolean;
  }[];
  /**
   * Use a fixed table layout so columns take their widths from the column
   * definitions instead of their content. Needed when multiple tables must
   * share identical column widths (e.g. grouped report sections).
   */
  fixedLayout?: boolean;
}

export function Table<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = 'No data found',
  onSort,
  clientSort,
  onRowClick,
  page,
  totalPages,
  onPageChange,
  selectable,
  selectedIds = [],
  onSelectionChange,
  rowId = (row) => row.id,
  mobileCardMode,
  filterRow,
  footerRows,
  fixedLayout,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  function handleSort(key: string) {
    const newOrder = sortKey === key && sortOrder === 'asc' ? 'desc' : 'asc';
    setSortKey(key);
    setSortOrder(newOrder);
    onSort?.(key, newOrder);
  }

  // Client-side sorting
  let sortedData = data;
  if (clientSort && sortKey) {
    sortedData = [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortOrder === 'asc' ? -1 : 1;
      if (bVal == null) return sortOrder === 'asc' ? 1 : -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortOrder === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    const newSelection = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    onSelectionChange(newSelection);
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    if (selectedIds.length === data.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map(rowId));
    }
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
      </div>
    );
  }

  if (data.length === 0 && !filterRow && !footerRows) {
    return <div style={styles.empty}>{emptyMessage}</div>;
  }

  // Mobile card mode
  if (mobileCardMode && typeof window !== 'undefined' && window.innerWidth < 768) {
    return (
      <div style={styles.cardList}>
        {sortedData.map((row, rowIndex) => (
          <div key={rowIndex} style={{ ...styles.card, ...(onRowClick ? { cursor: 'pointer' } : {}) }} onClick={onRowClick ? () => onRowClick(row) : undefined}>
            {columns.map((col) => (
              <div key={col.key} style={styles.cardField}>
                <span style={styles.cardLabel}>{col.header}</span>
                <span style={styles.cardValue}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </span>
              </div>
            ))}
          </div>
        ))}
        {page && totalPages && onPageChange && renderPagination(page, totalPages, onPageChange)}
      </div>
    );
  }

  return (
    <div>
      <div style={styles.wrapper}>
        <table style={{ ...styles.table, ...(fixedLayout ? { tableLayout: 'fixed' as const } : {}) }}>
          <thead>
            {filterRow && (
              <tr style={styles.filterRow}>
                {selectable && <th style={styles.th} />}
                {filterRow}
              </tr>
            )}
            <tr>
              {selectable && (
                <th style={{ ...styles.th, width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.length === data.length && data.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ ...styles.th, width: col.width, textAlign: col.align || 'left', cursor: col.sortable ? 'pointer' : 'default' }}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={sortKey === col.key ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {col.header}
                  {col.sortable && (
                    <span style={styles.sortIcon}>
                      {sortKey === col.key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={columns.length + (selectable ? 1 : 0)}>
                  <div style={styles.empty}>{emptyMessage}</div>
                </td>
              </tr>
            )}
            {sortedData.map((row, rowIndex) => {
              const id = rowId(row);
              return (
                <tr
                  key={rowIndex}
                  className={onRowClick ? cssStyles.rowClickable : undefined}
                  style={{ ...styles.tr, ...(selectedIds.includes(id) ? styles.trSelected : {}) }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(id)}
                        onChange={() => toggleRow(id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                    </td>
                  )}
                  {columns.map((col, colIndex) => (
                    <td key={col.key} style={styles.td}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                      {onRowClick && colIndex === columns.length - 1 && (
                        <span className={cssStyles.rowEditAffordance}>Edit &rsaquo;</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footerRows && footerRows.length > 0 && (
            <tfoot>
              {footerRows.map((fr, rowIdx) => (
                <tr key={rowIdx} style={fr.strong ? styles.footerRowStrong : styles.footerRow}>
                  {selectable && <td style={styles.footerCell} />}
                  {fr.cells.map((cell, i) => (
                    <td key={columns[i]?.key ?? i} style={{ ...styles.footerCell, textAlign: cell.align || 'left' }}>
                      {cell.content}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      {page && totalPages && onPageChange && renderPagination(page, totalPages, onPageChange)}
    </div>
  );
}

function renderPagination(page: number, totalPages: number, onPageChange: (p: number) => void) {
  if (totalPages <= 1) return null;
  return (
    <div style={styles.pagination}>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        style={styles.pageBtn}
      >
        ← Prev
      </button>
      <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        style={styles.pageBtn}
      >
        Next →
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '15px' },
  th: {
    textAlign: 'left',
    padding: 'var(--space-sm) var(--space-md)',
    fontSize: 'var(--font-size-table-header)',
    fontWeight: 'var(--font-weight-bold)' as any,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'normal',
    overflowWrap: 'break-word',
    verticalAlign: 'bottom',
    userSelect: 'none',
  },
  tr: {
    borderBottom: '1px solid var(--color-border)',
    transition: 'background var(--duration-fast) var(--ease-default)',
    height: '40px',
  },
  filterRow: {
    borderBottom: '1px solid var(--color-border)',
  },
  trSelected: { background: 'var(--color-surface-hover)' },
  td: { padding: 'var(--space-md) var(--space-md)', color: 'var(--color-text)', wordBreak: 'break-word' },
  footerRow: { borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  footerRowStrong: { borderTop: '2px solid var(--color-border)', background: 'var(--color-surface-hover)' },
  footerCell: { padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text)', fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap' },
  sortIcon: { color: 'var(--color-text-disabled)', fontSize: '12px' },
  empty: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  loading: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: 'var(--space-md)' },
  skeleton: { height: '40px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-hover)' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', padding: 'var(--space-md) 0' },
  pageBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', padding: '6px 12px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  pageInfo: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  // Mobile card mode
  cardList: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' },
  cardField: { display: 'flex', justifyContent: 'space-between', padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--color-border)' },
  cardLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  cardValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
