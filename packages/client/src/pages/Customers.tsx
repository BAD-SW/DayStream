import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { lifecycleStageLabel, personSourceLabel, PEOPLE_VIEWS, PERSON_SOURCE_LABELS, LIFECYCLE_STAGES } from '@daystream/shared';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { DateRangeFilter, DateRange } from '../design-system/components/data/DateRangeFilter';
import * as customersApi from '../api/customers';
import type { Customer, ViewCounts, Segment } from '../api/customers';

const STAGE_COLORS: Record<string, { bg: string; fg: string }> = {
  lead: { bg: 'var(--stage-lead-bg)', fg: 'var(--stage-lead-fg)' },
  trial: { bg: 'var(--stage-trial-bg)', fg: 'var(--stage-trial-fg)' },
  active: { bg: 'var(--stage-active-bg)', fg: 'var(--stage-active-fg)' },
  at_risk: { bg: 'var(--stage-at-risk-bg)', fg: 'var(--stage-at-risk-fg)' },
  churned: { bg: 'var(--stage-churned-bg)', fg: 'var(--stage-churned-fg)' },
  winback: { bg: 'var(--stage-winback-bg)', fg: 'var(--stage-winback-fg)' },
};

const VIEW_STORAGE_KEY = 'ds_people_view';

interface ColumnFilters {
  ref: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

function relativeDay(value?: string | null): string {
  if (!value) return '—';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(value).toLocaleDateString();
}

/**
 * People (Phase 46): everyone the business knows, leads and customers alike, in one list.
 * "Leads", "Customers", "At risk" and "Former" are views of this list, not separate lists.
 */
export function Customers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [viewCounts, setViewCounts] = useState<ViewCounts | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [sortKey, setSortKey] = useState(searchParams.get('sort') || 'created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>((searchParams.get('order') as 'asc' | 'desc') || 'desc');

  // The view in the address wins; otherwise the last view this user chose.
  const [view, setView] = useState(() => {
    const fromUrl = searchParams.get('view');
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem(VIEW_STORAGE_KEY) || 'all'; } catch { return 'all'; }
  });
  const [stageFilter, setStageFilter] = useState(searchParams.get('lifecycle_stage') || '');
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') || '');
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get('owner') || '');
  const [segmentId, setSegmentId] = useState(searchParams.get('segment_id') || '');
  const [dateRange, setDateRange] = useState<DateRange | null>(
    searchParams.get('created_from') && searchParams.get('created_to')
      ? { from: searchParams.get('created_from')!, to: searchParams.get('created_to')! }
      : null,
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    ref: searchParams.get('ref') || '',
    first_name: searchParams.get('first_name') || '',
    last_name: searchParams.get('last_name') || '',
    email: searchParams.get('email') || '',
    phone: searchParams.get('phone') || '',
  });
  // Debounced text-filter values actually sent to the API
  const [debouncedFilters, setDebouncedFilters] = useState<ColumnFilters>(columnFilters);

  // TODO: Get from auth context
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(columnFilters);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [columnFilters]);

  // Reflect active filters in the URL so the view is shareable/bookmarkable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set('page', String(page));
    if (sortKey) next.set('sort', sortKey);
    if (sortOrder) next.set('order', sortOrder);
    if (view && view !== 'all') next.set('view', view);
    if (stageFilter) next.set('lifecycle_stage', stageFilter);
    if (sourceFilter) next.set('source', sourceFilter);
    if (ownerFilter) next.set('owner', ownerFilter);
    if (segmentId) next.set('segment_id', segmentId);
    if (dateRange) { next.set('created_from', dateRange.from); next.set('created_to', dateRange.to); }
    (Object.keys(debouncedFilters) as (keyof ColumnFilters)[]).forEach((k) => {
      if (debouncedFilters[k]) next.set(k, debouncedFilters[k]);
    });
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortKey, sortOrder, view, stageFilter, sourceFilter, ownerFilter, segmentId, dateRange, debouncedFilters]);

  const currentFilters = useCallback(() => ({
    view,
    lifecycle_stage: stageFilter || undefined,
    source: sourceFilter || undefined,
    owner: ownerFilter || undefined,
    segment_id: segmentId || undefined,
    ref: debouncedFilters.ref || undefined,
    first_name: debouncedFilters.first_name || undefined,
    last_name: debouncedFilters.last_name || undefined,
    email: debouncedFilters.email || undefined,
    phone: debouncedFilters.phone || undefined,
    created_from: dateRange?.from,
    created_to: dateRange?.to,
    sort: sortKey,
    order: sortOrder,
  }), [view, stageFilter, sourceFilter, ownerFilter, segmentId, debouncedFilters, dateRange, sortKey, sortOrder]);

  const fetchCustomers = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await customersApi.getCustomers(businessId, { ...currentFilters(), page, limit: 20 });
      setCustomers(result.data);
      setTotalPages(result.meta.totalPages);
      setTotal(result.meta.total);
    } catch {
      // Handle error silently for now
    } finally {
      setLoading(false);
    }
  }, [businessId, currentFilters, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getViewCounts(businessId).then(setViewCounts).catch(() => {});
    customersApi.getSegments(businessId).then(setSegments).catch(() => setSegments([]));
  }, [businessId]);

  function chooseView(next: string) {
    setView(next);
    // A view is a set of stages, so a stage picked in another view no longer applies.
    setStageFilter('');
    setPage(1);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* storage unavailable: the view still applies */ }
  }

  function updateColumnFilter(key: keyof ColumnFilters, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    setSortKey(key);
    setSortOrder(order);
    setPage(1);
  }

  // Stages offered in the stage filter: only those of the current view.
  const viewStages = PEOPLE_VIEWS.find((v) => v.id === view)?.stages || [...LIFECYCLE_STAGES];

  const columns = [
    { key: 'reference_number', header: 'Ref', width: '110px', sortable: true },
    {
      key: 'first_name', header: 'Name', sortable: true,
      // With no name on record, show how the person can be reached instead of a blank cell.
      render: (val: string, row: Customer) => (
        <span style={styles.nameCell}>
          {val || (!row.last_name ? (row.email || row.phone || '—') : '')}
          {row.incomplete && <Badge variant="warning">Incomplete</Badge>}
        </span>
      ),
    },
    { key: 'last_name', header: 'Surname(s)', sortable: true },
    { key: 'email', header: 'Email', sortable: true, render: (val: string | null) => val || '—' },
    { key: 'phone', header: 'Phone', sortable: true, render: (val: string | null) => val || '—' },
    {
      key: 'lifecycle_stage', header: 'Stage', sortable: true,
      render: (val: string) => {
        const colors = STAGE_COLORS[val];
        return <Badge bg={colors?.bg} fg={colors?.fg}>{lifecycleStageLabel(val)}</Badge>;
      },
    },
    {
      key: 'source', header: 'Source', sortable: true,
      render: (val: string, row: Customer) => <span title={personSourceLabel(val, row.source_detail)}>{personSourceLabel(val)}</span>,
    },
    { key: 'owner_name', header: 'Owner', sortable: true, render: (val: string | null) => val || '—' },
    {
      key: 'last_activity_at', header: 'Last activity', sortable: true,
      render: (val: string | null) => <span title={val ? new Date(val).toLocaleString() : undefined}>{relativeDay(val)}</span>,
    },
    {
      key: 'created_at', header: 'Added', sortable: true,
      render: (val: string) => new Date(val).toLocaleDateString(),
    },
  ];

  const filterRow = (
    <>
      {(['ref', 'first_name', 'last_name', 'email', 'phone'] as (keyof ColumnFilters)[]).map((key) => (
        <th key={key} style={styles.filterCell}>
          <input
            style={styles.filterInput}
            placeholder="Filter…"
            aria-label={`Filter by ${key.replace('_', ' ')}`}
            value={columnFilters[key]}
            onChange={(e) => updateColumnFilter(key, e.target.value)}
          />
        </th>
      ))}
      <th style={styles.filterCell}>
        <select
          style={styles.filterInput}
          aria-label="Filter by stage"
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
        >
          <option value="">All stages</option>
          {viewStages.map((s) => <option key={s} value={s}>{lifecycleStageLabel(s)}</option>)}
        </select>
      </th>
      <th style={styles.filterCell}>
        <select
          style={styles.filterInput}
          aria-label="Filter by source"
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
        >
          <option value="">All sources</option>
          {Object.entries(PERSON_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </th>
      <th style={styles.filterCell}>
        <select
          style={styles.filterInput}
          aria-label="Filter by owner"
          value={ownerFilter}
          onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }}
        >
          <option value="">Anyone</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
        </select>
      </th>
      <th style={styles.filterCell} />
      <th style={styles.filterCell}>
        <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} />
      </th>
    </>
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>People</h1>
        <div style={styles.headerActions}>
          <Button variant="outline" onClick={() => navigate('/customers/segments')}>Segments</Button>
          <Button variant="outline" onClick={() => navigate('/customers/import')}>Import CSV</Button>
          <Button variant="outline" onClick={async () => {
            try {
              const url = customersApi.getExportUrl(businessId, {
                lifecycle_stage: stageFilter || undefined,
                ...debouncedFilters,
                created_from: dateRange?.from,
                created_to: dateRange?.to,
                sort: sortKey,
                order: sortOrder,
              });
              const res = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } });
              if (!res.ok) throw new Error('Export failed');
              const blob = await res.blob();
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `people-${new Date().toISOString().split('T')[0]}.csv`;
              link.click();
              URL.revokeObjectURL(link.href);
            } catch { alert('Export failed'); }
          }}>Export CSV</Button>
          <Button onClick={() => navigate('/customers/new')}>Add Person</Button>
        </div>
      </div>

      {/* System views: one list, seen through its stages */}
      <div style={styles.viewRow} role="tablist" aria-label="People views">
        {PEOPLE_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            style={{ ...styles.viewTab, ...(view === v.id ? styles.viewTabActive : {}) }}
            onClick={() => chooseView(v.id)}
          >
            <span>{v.label}</span>
            <span style={styles.viewCount}>{viewCounts ? viewCounts[v.id] ?? 0 : '…'}</span>
          </button>
        ))}
        <select
          style={styles.segmentSelect}
          aria-label="Show a segment"
          value={segmentId}
          onChange={(e) => { setSegmentId(e.target.value); setPage(1); }}
        >
          <option value="">Segment: none</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.kind === 'static' ? ' (fixed list)' : ''}</option>
          ))}
        </select>
      </div>

      <p style={styles.resultCount} aria-live="polite">{loading ? ' ' : `${total} ${total === 1 ? 'person' : 'people'}`}</p>

      {/* Table */}
      {!businessId && !loading && (
        <div style={styles.noContext}>
          <p>No business context found. Please log out and log back in to refresh your session.</p>
        </div>
      )}
      <Table
        columns={columns}
        data={customers}
        loading={loading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        onSort={handleSort}
        filterRow={filterRow}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No people found"
        mobileCardMode
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1400px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  headerActions: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  viewRow: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' as const, alignItems: 'center' },
  viewTab: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)',
  },
  viewTabActive: { border: '1px solid var(--color-primary)', background: 'var(--color-surface-hover)', fontWeight: 'var(--font-weight-semibold)' as any },
  viewCount: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' },
  segmentSelect: {
    marginLeft: 'auto', fontSize: 'var(--font-size-sm)', padding: 'var(--space-sm) var(--space-md)',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', maxWidth: '100%',
  },
  resultCount: { margin: '0 0 var(--space-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', minHeight: '1.2em' },
  nameCell: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)' },
  noContext: { padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  filterCell: { padding: '4px var(--space-md) var(--space-sm)', fontWeight: 'normal' as any, textTransform: 'none' as any },
  filterInput: {
    width: '100%', fontSize: 'var(--font-size-xs)', padding: '6px 9px',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)',
  },
};
