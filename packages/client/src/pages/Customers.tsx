import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { lifecycleStageLabel, personSourceLabel, PEOPLE_VIEWS, PERSON_SOURCE_LABELS, LIFECYCLE_STAGES } from '@daystream/shared';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { DateRangeFilter, DateRange } from '../design-system/components/data/DateRangeFilter';
import * as customersApi from '../api/customers';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
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
const COLUMNS_STORAGE_KEY = 'ds_people_columns';

// Columns the user may hide. Ref, name and surname always stay.
const OPTIONAL_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'lifecycle_stage', label: 'Stage' },
  { key: 'source', label: 'Source' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'last_activity_at', label: 'Last activity' },
  { key: 'created_at', label: 'Added' },
];

const BULK_ACTIONS: Array<{ id: customersApi.BulkAction; label: string }> = [
  { id: 'add_tag', label: 'Add a tag' },
  { id: 'remove_tag', label: 'Remove a tag' },
  { id: 'assign_owner', label: 'Assign an owner' },
  { id: 'change_stage', label: 'Change stage' },
  { id: 'add_to_list', label: 'Add to a fixed list' },
  { id: 'archive', label: 'Archive' },
];

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

  // Bulk changes need the right to edit people; read-only roles (reception) are not offered them.
  const { user } = useAuth();
  const canEditPeople = getPermissionsFromRole(user?.role || '').some((p) => p === '*:*' || p === 'customers:*');

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
  // Columns hidden by this user (remembered on this device).
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [showColumns, setShowColumns] = useState(false);

  // Bulk actions: the people ticked on this page, or everyone matching the filters.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [bulkAction, setBulkAction] = useState<customersApi.BulkAction | ''>('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [owners, setOwners] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);

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
      // A new page or filter is a new set of rows: the old ticks no longer describe it.
      setSelectedIds([]);
      setAllMatching(false);
      setBulkConfirm(null);
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
    customersApi.getTags(businessId).then(setTags).catch(() => setTags([]));
    customersApi.getOwners(businessId).then(setOwners).catch(() => setOwners([]));
  }, [businessId]);

  function toggleColumn(key: string) {
    setHiddenColumns((hidden) => {
      const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }

  const fixedLists = segments.filter((seg) => seg.kind === 'static');
  const bulkNeedsValue = bulkAction !== '' && bulkAction !== 'archive';
  const bulkReady = bulkAction !== '' && (!bulkNeedsValue || bulkValue !== '');
  const selectedCount = allMatching ? total : selectedIds.length;

  function bulkTarget(): customersApi.BulkTarget {
    if (!allMatching) return { ids: selectedIds };
    const { sort: _sort, order: _order, ...filters } = currentFilters();
    return { filters };
  }

  function bulkPayload(): customersApi.BulkPayload {
    switch (bulkAction) {
      case 'add_tag': case 'remove_tag': return { tag_id: bulkValue };
      case 'assign_owner': return { owner_user_id: bulkValue === 'none' ? null : bulkValue };
      case 'change_stage': return { stage: bulkValue };
      case 'add_to_list': return { segment_id: bulkValue };
      default: return {};
    }
  }

  // Step 1: ask the server how many people the change would touch, and show that for confirmation.
  async function previewBulk() {
    if (!bulkReady) return;
    setBulkBusy(true);
    setBulkMessage('');
    try { setBulkConfirm(await customersApi.previewBulk(businessId, bulkTarget())); }
    catch (err: any) { setBulkMessage(err.response?.data?.error || 'Could not prepare this change'); }
    finally { setBulkBusy(false); }
  }

  // Step 2: apply it.
  async function applyBulk() {
    if (!bulkAction) return;
    setBulkBusy(true);
    try {
      const result = await customersApi.runBulk(businessId, bulkTarget(), bulkAction, bulkPayload());
      const label = BULK_ACTIONS.find((a) => a.id === bulkAction)?.label || 'Change';
      setBulkAction('');
      setBulkValue('');
      await fetchCustomers();
      customersApi.getViewCounts(businessId).then(setViewCounts).catch(() => {});
      setBulkMessage(result.background
        ? `${label}: ${result.count} people are being changed in the background. Reload the list in a minute to see the result.`
        : `${label}: ${result.affected} ${result.affected === 1 ? 'person' : 'people'} changed.`);
    } catch (err: any) {
      setBulkConfirm(null);
      setBulkMessage(err.response?.data?.error || 'The change could not be applied');
    } finally { setBulkBusy(false); }
  }

  function clearSelection() {
    setSelectedIds([]);
    setAllMatching(false);
    setBulkConfirm(null);
    setBulkAction('');
    setBulkValue('');
  }

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

  const allColumns = [
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
  const columns = allColumns.filter((c) => !hiddenColumns.includes(c.key));

  // One filter control per column, keyed like the columns so hiding a column hides its filter.
  const textFilter = (key: keyof ColumnFilters) => (
    <input
      style={styles.filterInput}
      placeholder="Filter…"
      aria-label={`Filter by ${key.replace('_', ' ')}`}
      value={columnFilters[key]}
      onChange={(e) => updateColumnFilter(key, e.target.value)}
    />
  );
  const filterControls: Record<string, React.ReactNode> = {
    reference_number: textFilter('ref'),
    first_name: textFilter('first_name'),
    last_name: textFilter('last_name'),
    email: textFilter('email'),
    phone: textFilter('phone'),
    lifecycle_stage: (
      <select style={styles.filterInput} aria-label="Filter by stage" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
        <option value="">All stages</option>
        {viewStages.map((st) => <option key={st} value={st}>{lifecycleStageLabel(st)}</option>)}
      </select>
    ),
    source: (
      <select style={styles.filterInput} aria-label="Filter by source" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}>
        <option value="">All sources</option>
        {Object.entries(PERSON_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    ),
    owner_name: (
      <select style={styles.filterInput} aria-label="Filter by owner" value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }}>
        <option value="">Anyone</option>
        <option value="me">Mine</option>
        <option value="none">Unassigned</option>
      </select>
    ),
    created_at: <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} />,
  };

  const filterRow = (
    <>
      {columns.map((c) => <th key={c.key} style={styles.filterCell}>{filterControls[c.key]}</th>)}
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

      <div style={styles.listToolbar}>
        <p style={styles.resultCount} aria-live="polite">{loading ? ' ' : `${total} ${total === 1 ? 'person' : 'people'}`}</p>
        <div style={styles.columnsWrap}>
          <button style={styles.columnsButton} aria-expanded={showColumns} onClick={() => setShowColumns((v) => !v)}>Columns</button>
          {showColumns && (
            <div style={styles.columnsMenu} role="group" aria-label="Columns shown">
              {OPTIONAL_COLUMNS.map((c) => (
                <label key={c.key} style={styles.columnsOption}>
                  <input type="checkbox" checked={!hiddenColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {bulkMessage && selectedCount === 0 && <p style={styles.bulkMessage} role="status">{bulkMessage}</p>}

      {/* Bulk actions: shown once someone is ticked */}
      {selectedCount > 0 && (
        <div style={styles.bulkBar} role="region" aria-label="Bulk actions">
          <div style={styles.bulkLine}>
            <strong>{selectedCount} selected</strong>
            {!allMatching && selectedIds.length === customers.length && total > customers.length && (
              <button style={styles.linkButton} onClick={() => { setAllMatching(true); setBulkConfirm(null); }}>
                Select all {total} matching these filters
              </button>
            )}
            {allMatching && <span style={styles.bulkHint}>Everyone matching these filters, on all pages.</span>}
            <button style={styles.linkButton} onClick={clearSelection}>Clear selection</button>
          </div>
          {bulkConfirm === null ? (
            <div style={styles.bulkLine}>
              <select style={styles.bulkSelect} aria-label="Bulk action" value={bulkAction} onChange={(e) => { setBulkAction(e.target.value as customersApi.BulkAction | ''); setBulkValue(''); }}>
                <option value="">Choose an action…</option>
                {BULK_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') && (
                <select style={styles.bulkSelect} aria-label="Tag" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{tags.length ? 'Choose a tag…' : 'No tags defined yet'}</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {bulkAction === 'assign_owner' && (
                <select style={styles.bulkSelect} aria-label="Owner" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">Choose an owner…</option>
                  <option value="none">Unassigned</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
                </select>
              )}
              {bulkAction === 'change_stage' && (
                <select style={styles.bulkSelect} aria-label="Stage" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">Choose a stage…</option>
                  {LIFECYCLE_STAGES.map((st) => <option key={st} value={st}>{lifecycleStageLabel(st)}</option>)}
                </select>
              )}
              {bulkAction === 'add_to_list' && (
                <select style={styles.bulkSelect} aria-label="Fixed list" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{fixedLists.length ? 'Choose a list…' : 'No fixed lists yet (create one in Segments)'}</option>
                  {fixedLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              <Button size="sm" disabled={!bulkReady} loading={bulkBusy} onClick={previewBulk}>Continue</Button>
            </div>
          ) : (
            <div style={styles.bulkLine}>
              <span>
                {BULK_ACTIONS.find((a) => a.id === bulkAction)?.label} for <strong>{bulkConfirm} {bulkConfirm === 1 ? 'person' : 'people'}</strong>?
                {bulkAction === 'archive' ? ' They will be hidden from the list.' : ''}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setBulkConfirm(null)}>Back</Button>
              <Button size="sm" loading={bulkBusy} onClick={applyBulk}>Confirm</Button>
            </div>
          )}
          {bulkMessage && <p style={styles.bulkMessage} role="status">{bulkMessage}</p>}
        </div>
      )}

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
        selectable={canEditPeople}
        selectedIds={selectedIds}
        onSelectionChange={(ids) => { setSelectedIds(ids); setAllMatching(false); setBulkConfirm(null); setBulkMessage(''); }}
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
  listToolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)' },
  columnsWrap: { position: 'relative' as const, marginBottom: 'var(--space-sm)' },
  columnsButton: {
    padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
    color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)',
  },
  columnsMenu: {
    position: 'absolute' as const, right: 0, top: 'calc(100% + 4px)', zIndex: 10, minWidth: '170px', display: 'flex', flexDirection: 'column' as const,
    gap: 'var(--space-xs)', padding: 'var(--space-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  columnsOption: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  bulkBar: {
    display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', padding: 'var(--space-md)', marginBottom: 'var(--space-sm)',
    border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
    fontSize: 'var(--font-size-sm)', color: 'var(--color-text)',
  },
  bulkLine: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  bulkHint: { color: 'var(--color-text-secondary)' },
  bulkSelect: {
    fontSize: 'var(--font-size-sm)', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', maxWidth: '100%',
  },
  bulkMessage: { margin: '0 0 var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  linkButton: {
    background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline',
    fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)',
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
