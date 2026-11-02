import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import cssStyles from './Table.module.css';
import {
  ColumnFilter, TableFilters, FilterOption, FilterColumnDef, applyTableFilters, optionsFrom, dayOf,
  looksLikeDate, isFilterOn, SortIcon, FunnelIcon, ValuesFilter, DateFilter, AmountFilter,
} from './TableFilters';

export type { ColumnFilter, TableFilters, FilterOption } from './TableFilters';
export { applyTableFilters, optionsFrom } from './TableFilters';

interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (value: any, row: T) => ReactNode;
  width?: string;
  /** Header text alignment. Defaults to left. */
  align?: 'left' | 'right' | 'center';
  /** Optional extra style for this column's header cell (e.g. whiteSpace). */
  headerStyle?: CSSProperties;
  /**
   * The column filter (filter icon beside the sort icon, David 2026-11-02): a list of the
   * column's values or, for dates, a calendar. Found by itself from the data when left out;
   * `false` turns it off (e.g. a column of buttons).
   */
  filter?: 'values' | 'date' | 'amount' | false;
  /** The value a row has for filtering, when it is not `row[key]`. */
  filterValue?: (row: T) => unknown;
  /** How a value is named in the filter list, when not as the cell shows it. */
  filterLabel?: (value: string) => string;
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
  /** The row shown as open (e.g. its details beside the table). */
  activeRowId?: string | null;
  /** A row that opens its details under it (e.g. a payroll breakdown): the open row, and what it shows. */
  expandedRowId?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  /** Scroll inside its own area of this height (e.g. '100%' of a fixed panel), header pinned at its top. */
  scrollHeight?: string;
  // Pagination (kept for older callers; tables now scroll and load more instead)
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
  // Column filters
  /** Controlled filters: the page filters the rows itself (on the server, or with applyTableFilters). */
  filters?: TableFilters;
  onFiltersChange?: (filters: TableFilters) => void;
  /** The values of a column with counts, from the server, for tables that hold only some rows. */
  filterOptions?: (key: string) => Promise<FilterOption[]>;
  /** All rows, when `data` is already filtered by the page (the filter lists show every value). */
  filterSource?: T[];
  /** Filters a self-filtering table starts with (e.g. this month on a date column). */
  initialFilters?: TableFilters;
  /** Turns column filters off for this table (e.g. a small summary table). */
  noFilters?: boolean;
  // Load more as the page scrolls (no pages)
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

const sortValue = (v: any) => (typeof v === 'number' ? v : looksLikeDate(v) ? new Date(v).getTime() : v == null ? v : String(v).toLowerCase());

export function Table<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = 'No data found',
  onSort,
  clientSort,
  onRowClick,
  activeRowId,
  expandedRowId,
  renderExpanded,
  scrollHeight,
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
  filters: controlledFilters,
  onFiltersChange,
  filterOptions,
  filterSource,
  initialFilters,
  noFilters,
  onLoadMore,
  hasMore,
  loadingMore,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [ownFilters, setOwnFilters] = useState<TableFilters>(initialFilters || {});
  const [openFilter, setOpenFilter] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const controlled = !!onFiltersChange;
  const filters = controlled ? controlledFilters || {} : ownFilters;
  const setFilters = (f: TableFilters) => (controlled ? onFiltersChange!(f) : setOwnFilters(f));
  const sentinel = useRef<HTMLTableRowElement>(null);
  // A table wider than its place scrolls sideways inside itself (its header then stops pinning);
  // one that fits scrolls with the page, header pinned.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooWide, setTooWide] = useState(false);
  const [inBox, setInBox] = useState(false);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const check = () => { const t = el.firstElementChild as HTMLElement | null; setTooWide(!!t && t.scrollWidth > el.clientWidth + 1); };
    // Inside a box that clips or scrolls, the header cannot pin to the page: it stays in place.
    let boxed = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') { boxed = true; break; }
    }
    setInBox(boxed);
    check();
    if (typeof ResizeObserver === 'undefined') return; // e.g. the test DOM: no resizing to follow
    const ro = new ResizeObserver(check); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });

  // Which columns can be filtered, and how: from the column, or found from the rows' values.
  const source = filterSource || data;
  const filterDefs = useMemo(() => {
    const defs = new Map<string, FilterColumnDef<T> & { label?: (v: string) => string }>();
    if (noFilters || filterRow) return defs;
    for (const col of columns) {
      if (col.filter === false) continue;
      const value = col.filterValue || ((row: T) => row[col.key]);
      let kind = col.filter as 'values' | 'date' | 'amount' | undefined;
      if (!kind) {
        const sample = source.slice(0, 200).map(value).filter((v) => v != null && v !== '');
        if (sample.length === 0 && !(filterOptions && controlled)) continue;
        if (sample.some((v) => typeof v === 'object')) continue;
        kind = sample.length > 0 && sample.every(looksLikeDate) ? 'date' : 'values';
      }
      // Name each value as its cell shows it, when the cell is plain text.
      const label = col.filterLabel || (col.render ? (v: string) => {
        const row = source.find((r) => String(value(r) ?? '') === v);
        const out = row ? col.render!(row[col.key], row) : null;
        return typeof out === 'string' || typeof out === 'number' ? String(out) : v;
      } : undefined);
      defs.set(col.key, { key: col.key, kind, value, label });
    }
    return defs;
  }, [columns, source, noFilters, filterRow, filterOptions, controlled]);

  function handleSort(key: string) {
    const newOrder = sortKey === key && sortOrder === 'asc' ? 'desc' : 'asc';
    setSortKey(key);
    setSortOrder(newOrder);
    onSort?.(key, newOrder);
  }

  // Rows this table filters itself (when the page does not).
  const visible = useMemo(() => (controlled ? data : applyTableFilters(data, [...filterDefs.values()], filters)), [controlled, data, filterDefs, filters]);

  // Client-side sorting
  let sortedData = visible;
  if (clientSort && sortKey) {
    sortedData = [...visible].sort((a, b) => {
      const aVal = sortValue(a[sortKey]);
      const bVal = sortValue(b[sortKey]);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortOrder === 'asc' ? -1 : 1;
      if (bVal == null) return sortOrder === 'asc' ? 1 : -1;
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  // Load the next rows when the end of the table scrolls into view.
  useEffect(() => {
    if (!onLoadMore || !hasMore || !sentinel.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting) && !loadingMore) onLoadMore(); }, { rootMargin: '400px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onLoadMore, hasMore, loadingMore, sortedData.length]);

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    const newSelection = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    onSelectionChange(newSelection);
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    if (selectedIds.length === visible.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(visible.map(rowId));
    }
  }

  const anyFilter = Object.values(filters).some(isFilterOn);
  const applyFilter = (key: string, f: ColumnFilter | undefined) => {
    const next = { ...filters };
    if (f) next[key] = f; else delete next[key];
    setFilters(next);
    setOpenFilter(null);
  };
  const openDef = openFilter ? filterDefs.get(openFilter.key) : undefined;
  const openCol = openFilter ? columns.find((c) => c.key === openFilter.key) : undefined;
  const popover = openFilter && openDef && openCol ? (openDef.kind === 'amount' ? (
    <AmountFilter anchor={openFilter.anchor} title={openCol.header} current={filters[openCol.key]}
      loadOptions={() => (filterOptions ? filterOptions(openCol.key) : optionsFrom(source, openDef.value))}
      onApply={(f) => applyFilter(openCol.key, f)} onClose={() => setOpenFilter(null)} />
  ) : openDef.kind === 'date' ? (
    <DateFilter anchor={openFilter.anchor} title={openCol.header} current={filters[openCol.key]}
      countFor={controlled && filterOptions ? undefined : (from, to) => (from ? source.filter((r) => { const d = dayOf(openDef.value(r)); return !!d && d >= from && d <= (to || from); }).length : source.length)}
      onApply={(f) => applyFilter(openCol.key, f)} onClose={() => setOpenFilter(null)} />
  ) : (
    <ValuesFilter anchor={openFilter.anchor} title={openCol.header} current={filters[openCol.key]}
      loadOptions={() => (filterOptions ? filterOptions(openCol.key) : optionsFrom(source, openDef.value, openDef.label))}
      onApply={(f) => applyFilter(openCol.key, f)} onClose={() => setOpenFilter(null)} />
  )) : null;

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
      </div>
    );
  }

  if (data.length === 0 && !filterRow && !footerRows && !anyFilter) {
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
      {popover}
      <div ref={wrapRef} className={cssStyles.wrapper} data-wide={tooWide || !!scrollHeight || undefined} data-inbox={(inBox && !tooWide && !scrollHeight) || undefined} style={scrollHeight ? { maxHeight: scrollHeight } : undefined}>
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
                    checked={selectedIds.length === visible.length && visible.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col) => {
                const def = filterDefs.get(col.key);
                const on = isFilterOn(filters[col.key]);
                const sorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cssStyles.stickyTh}
                    style={{ ...styles.th, width: col.width, textAlign: col.align || 'left', ...col.headerStyle }}
                    aria-sort={sorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {/* Label, then the sort icon, then the filter icon beside it (David, 2026-11-02). */}
                    <span style={{ ...styles.headWrap, justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start' }}>
                      {col.sortable
                        ? <button type="button" style={styles.headLabel} onClick={() => handleSort(col.key)}>{col.header}</button>
                        : <span>{col.header}</span>}
                      {col.sortable && (
                        <button type="button" className={cssStyles.headIcon} data-on={sorted || undefined} onClick={() => handleSort(col.key)}
                          aria-label={`Sort by ${col.header}`} title={`Sort by ${col.header}`}>
                          <SortIcon dir={sorted ? sortOrder : undefined} />
                        </button>
                      )}
                      {def && (
                        <button type="button" className={cssStyles.headIcon} data-on={on || undefined}
                          aria-label={`Filter ${col.header}`} title={`Filter ${col.header}`} aria-haspopup="dialog"
                          aria-expanded={openFilter?.key === col.key}
                          onClick={(e) => { const anchor = e.currentTarget.closest('th') as HTMLElement; setOpenFilter(openFilter?.key === col.key ? null : { key: col.key, anchor }); }}>
                          <FunnelIcon on={on} />
                          {on && <span className={cssStyles.headBadge}>{filters[col.key].values?.length || '•'}</span>}
                        </button>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={columns.length + (selectable ? 1 : 0)}>
                  <div style={styles.empty}>{anyFilter && data.length > 0 ? 'Nothing matches these filters.' : emptyMessage}</div>
                </td>
              </tr>
            )}
            {sortedData.map((row, rowIndex) => {
              const id = rowId(row);
              const open = !!renderExpanded && expandedRowId != null && expandedRowId === id;
              return (
                <Fragment key={rowIndex}>
                <tr
                  className={onRowClick ? cssStyles.rowClickable : undefined}
                  style={{ ...styles.tr, ...(selectedIds.includes(id) || (activeRowId != null && activeRowId === id) ? styles.trSelected : {}) }}
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
                        <span className={cssStyles.rowEditAffordance}>{renderExpanded ? (open ? 'Hide' : 'Details ›') : <>Edit &rsaquo;</>}</span>
                      )}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr>
                    <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ ...styles.td, background: 'var(--color-background)' }}>{renderExpanded!(row)}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {onLoadMore && hasMore && (
              <tr ref={sentinel}>
                <td style={{ ...styles.td, ...styles.more }} colSpan={columns.length + (selectable ? 1 : 0)}>
                  {loadingMore ? 'Loading more…' : <button type="button" style={styles.moreBtn} onClick={onLoadMore}>Show more</button>}
                </td>
              </tr>
            )}
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
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--table-font-size)' },
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
    height: 'var(--table-row-height)',
  },
  filterRow: {
    borderBottom: '1px solid var(--color-border)',
  },
  trSelected: { background: 'var(--color-surface-hover)' },
  td: { padding: 'var(--table-cell-padding-y) var(--space-md)', color: 'var(--color-text)', wordBreak: 'break-word' },
  footerRow: { borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  footerRowStrong: { borderTop: '2px solid var(--color-border)', background: 'var(--color-surface-hover)' },
  footerCell: { padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text)', fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap' },
  // In a narrow column the icons wrap under the label instead of being cut off.
  headWrap: { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px', width: '100%' },
  headLabel: { border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', textAlign: 'inherit', whiteSpace: 'inherit', overflowWrap: 'anywhere' },
  more: { textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  moreBtn: { border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 999, padding: '6px 14px', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)', fontWeight: 600, cursor: 'pointer' },
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
