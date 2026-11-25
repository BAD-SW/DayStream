import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PEOPLE_VIEWS, LIFECYCLE_STAGES } from '@daystream/shared';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as customersApi from '../api/customers';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
import { useColumnOrder, orderColumns, stageText, sourceText } from '../utils/peopleColumns';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';
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
// Their words are people.col.<key> in the translation file.
const OPTIONAL_COLUMNS: string[] = [
  'email', 'phone', 'lifecycle_stage', 'source', 'owner_name', 'last_activity_at', 'created_at',
  // THE-18, hidden until a user shows them.
  'last_contacted_at', 'next_booking_at', 'visits_count',
];
const OFF_BY_DEFAULT = ['last_contacted_at', 'next_booking_at', 'visits_count'];
const SHOWN_STORAGE_KEY = 'ds_people_columns_shown';
// People's columns in the business column order (Settings → People lists).
const PEOPLE_CANONICAL: Record<string, string> = {
  reference_number: 'reference_number', email: 'email', phone: 'phone', lifecycle_stage: 'stage', source: 'source', owner_name: 'owner',
  last_activity_at: 'last_activity', created_at: 'created_at', last_contacted_at: 'last_contacted', next_booking_at: 'next_booking', visits_count: 'visits',
};

// Their words are people.bulk.action.<id> in the translation file.
const BULK_ACTIONS: Array<{ id: customersApi.BulkAction }> = [
  { id: 'add_tag' },
  { id: 'remove_tag' },
  { id: 'assign_owner' },
  { id: 'change_stage' },
  { id: 'add_to_list' },
  { id: 'archive' },
  { id: 'delete' }, // TEMPORARY: test-data cleanup; remove later
];

const PAGE_SIZE = 50;
const readFilters = (raw: string | null): TableFilters => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

function relativeDay(t: TFunction, value?: string | null): string {
  if (!value) return '—';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return t('people.today');
  if (days === 1) return t('people.yesterday');
  if (days < 30) return t('people.daysAgo', { count: days });
  return formatDate(value);
}

/**
 * People (Phase 46): everyone the business knows, leads and customers alike, in one list.
 * "Leads", "Customers", "At risk" and "Former" are views of this list, not separate lists.
 */
export function Customers() {
  const { t } = useTranslation('customers');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Bulk changes need the right to edit people; read-only roles (reception) are not offered them.
  const { user } = useAuth();
  const canEditPeople = getPermissionsFromRole(user?.role || '').some((p) => p === '*:*' || p === 'customers:*');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  // No pages (David, 2026-11-02): more people load as the list scrolls.
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const [segmentId, setSegmentId] = useState(searchParams.get('segment_id') || '');
  // Archived people are hidden unless asked for (they still count as existing during an import).
  const [showArchived, setShowArchived] = useState(searchParams.get('archived') === '1');
  // Column filters from the filter icon beside each sort icon (David, 2026-11-02).
  const [tableFilters, setTableFilters] = useState<TableFilters>(() => readFilters(searchParams.get('cf')));
  // Columns hidden by this user (remembered on this device).
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    let hidden: string[] = []; let shown: string[] = [];
    try { hidden = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) || '[]'); shown = JSON.parse(localStorage.getItem(SHOWN_STORAGE_KEY) || '[]'); } catch { /* storage unavailable */ }
    return [...hidden, ...OFF_BY_DEFAULT.filter((k) => !shown.includes(k) && !hidden.includes(k))];
  });
  const columnOrder = useColumnOrder();
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

  // TODO: Get from auth context
  const businessId = localStorage.getItem('business_id') || '';

  // Reflect active filters in the URL so the view is shareable/bookmarkable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (sortKey) next.set('sort', sortKey);
    if (sortOrder) next.set('order', sortOrder);
    if (view && view !== 'all') next.set('view', view);
    if (segmentId) next.set('segment_id', segmentId);
    if (showArchived) next.set('archived', '1');
    if (Object.keys(tableFilters).length) next.set('cf', JSON.stringify(tableFilters));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortOrder, view, segmentId, showArchived, tableFilters]);

  const currentFilters = useCallback(() => ({
    view,
    segment_id: segmentId || undefined,
    include_archived: showArchived || undefined,
    columns: tableFilters,
    sort: sortKey,
    order: sortOrder,
  }), [view, segmentId, showArchived, tableFilters, sortKey, sortOrder]);

  const fetchCustomers = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await customersApi.getCustomers(businessId, { ...currentFilters(), page: 1, limit: PAGE_SIZE });
      setCustomers(result.data);
      setPage(1);
      // A new filter is a new set of rows: the old ticks no longer describe it.
      setSelectedIds([]);
      setAllMatching(false);
      setBulkConfirm(null);
      setTotal(result.meta.total);
    } catch {
      // Handle error silently for now
    } finally {
      setLoading(false);
    }
  }, [businessId, currentFilters]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // The next people, when the end of the list scrolls into view.
  const loadMore = useCallback(async () => {
    if (loadingMore || customers.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await customersApi.getCustomers(businessId, { ...currentFilters(), page: page + 1, limit: PAGE_SIZE });
      setCustomers((rows) => [...rows, ...result.data]);
      setPage(page + 1);
      setTotal(result.meta.total);
    } catch { /* the Show more button stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, currentFilters, page, loadingMore, customers.length, total]);

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
      try {
        localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next.filter((k) => !OFF_BY_DEFAULT.includes(k))));
        localStorage.setItem(SHOWN_STORAGE_KEY, JSON.stringify(OFF_BY_DEFAULT.filter((k) => !next.includes(k))));
      } catch { /* storage unavailable */ }
      return next;
    });
  }

  const fixedLists = segments.filter((seg) => seg.kind === 'static');
  const bulkNeedsValue = bulkAction !== '' && bulkAction !== 'archive' && bulkAction !== 'delete';
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
    catch (err: any) { setBulkMessage(err.response?.data?.error || t('people.bulk.prepareFailed')); }
    finally { setBulkBusy(false); }
  }

  // Step 2: apply it.
  async function applyBulk() {
    if (!bulkAction) return;
    setBulkBusy(true);
    try {
      const result = await customersApi.runBulk(businessId, bulkTarget(), bulkAction, bulkPayload());
      const found = BULK_ACTIONS.find((a) => a.id === bulkAction);
      const label = found ? t('people.bulk.action.' + found.id) : t('people.bulk.change');
      setBulkAction('');
      setBulkValue('');
      await fetchCustomers();
      customersApi.getViewCounts(businessId).then(setViewCounts).catch(() => {});
      setBulkMessage(result.background
        ? t('people.bulk.background', { label, n: result.count })
        : `${t('people.bulk.changed', { label, count: result.affected })}${result.skipped ? ` ${t('people.bulk.skipped', { n: result.skipped })}` : ''}`);
    } catch (err: any) {
      setBulkConfirm(null);
      setBulkMessage(err.response?.data?.error || t('people.bulk.applyFailed'));
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
    setTableFilters(({ lifecycle_stage: _stage, ...rest }) => rest);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* storage unavailable: the view still applies */ }
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    setSortKey(key);
    setSortOrder(order);
  }

  // A column's filter list: every value among the people matching the other filters, named as the cells show them.
  const filterOptions = useCallback(async (key: string) => {
    const values = await customersApi.getColumnValues(businessId, key, currentFilters());
    return values.map((v) => ({
      value: v.value, count: v.count,
      label: key === 'lifecycle_stage' ? stageText(t, v.value)
        : key === 'source' ? sourceText(t, v.value)
        : key === 'owner_name' ? (v.label || t('people.unassigned'))
        : v.label || v.value,
    }));
  }, [businessId, currentFilters, t]);

  const allColumns = [
    { key: 'reference_number', header: t('people.col.reference_number'), width: '110px', sortable: true },
    {
      key: 'first_name', header: t('people.col.first_name'), sortable: true,
      // With no name on record, show how the person can be reached instead of a blank cell.
      render: (val: string, row: Customer) => (
        <span style={styles.nameCell}>
          {val || (!row.last_name ? (row.email || row.phone || '—') : '')}
          {row.incomplete && <Badge variant="warning">{t('people.incomplete')}</Badge>}
          {row.status === 'archived' && <Badge variant="neutral">{t('people.archived')}</Badge>}
        </span>
      ),
    },
    { key: 'last_name', header: t('people.col.last_name'), sortable: true },
    { key: 'email', header: t('people.col.email'), sortable: true, render: (val: string | null) => val || '—' },
    { key: 'phone', header: t('people.col.phone'), sortable: true, render: (val: string | null) => val || '—' },
    {
      key: 'lifecycle_stage', header: t('people.col.lifecycle_stage'), sortable: true,
      render: (val: string) => {
        const colors = STAGE_COLORS[val];
        return <Badge bg={colors?.bg} fg={colors?.fg}>{stageText(t, val)}</Badge>;
      },
    },
    {
      key: 'source', header: t('people.col.source'), sortable: true,
      render: (val: string, row: Customer) => <span title={sourceText(t, val, row.source_detail)}>{sourceText(t, val)}</span>,
    },
    { key: 'owner_name', header: t('people.col.owner_name'), sortable: true, render: (val: string | null) => val || '—' },
    {
      key: 'last_activity_at', header: t('people.col.last_activity_at'), sortable: true, filter: 'date' as const,
      render: (val: string | null) => <span title={val ? formatDateTime(val) : undefined}>{relativeDay(t, val)}</span>,
    },
    {
      key: 'created_at', header: t('people.col.created_at'), sortable: true, filter: 'date' as const,
      render: (val: string) => formatDate(val),
    },
    {
      key: 'last_contacted_at', header: t('people.col.last_contacted_at'), sortable: true, filter: false as const,
      render: (val: string | null) => <span title={val ? formatDateTime(val) : undefined}>{relativeDay(t, val)}</span>,
    },
    {
      key: 'next_booking_at', header: t('people.col.next_booking_at'), sortable: true, filter: false as const,
      render: (val: string | null) => (val ? formatDateTime(val, undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'),
    },
    { key: 'visits_count', header: t('people.col.visits_count'), sortable: true, filter: false as const, align: 'right' as const, render: (val: number | null) => formatNumber(val ?? 0) },
  ];
  const columns = orderColumns(allColumns.filter((c) => !hiddenColumns.includes(c.key)), columnOrder, PEOPLE_CANONICAL, ['first_name', 'last_name']);


  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('people.title')}</h1>
        <div style={styles.headerActions}>
          <Button variant="outline" onClick={() => navigate('/customers/segments')}>{t('segments.title')}</Button>
          <Button variant="outline" onClick={async () => {
            try {
              const url = customersApi.getExportUrl(businessId, currentFilters());
              const res = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` } });
              if (!res.ok) throw new Error('Export failed');
              const blob = await res.blob();
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `people-${new Date().toISOString().split('T')[0]}.csv`;
              link.click();
              URL.revokeObjectURL(link.href);
            } catch { void showMessage({ message: t('people.exportFailed'), tone: 'error' }); }
          }}>{t('people.exportCsv')}</Button>
          <Button onClick={() => navigate('/customers/new')}>{t('people.addPerson')}</Button>
        </div>
      </div>

      {/* System views: one list, seen through its stages */}
      <div style={styles.viewRow} role="tablist" aria-label={t('people.views')}>
        {PEOPLE_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            style={{ ...styles.viewTab, ...(view === v.id ? styles.viewTabActive : {}) }}
            onClick={() => chooseView(v.id)}
          >
            <span>{t('people.view.' + v.id, { defaultValue: v.label })}</span>
            <span style={styles.viewCount}>{viewCounts ? formatNumber(viewCounts[v.id] ?? 0) : '…'}</span>
          </button>
        ))}
        <select
          style={styles.segmentSelect}
          aria-label={t('people.showSegment')}
          value={segmentId}
          onChange={(e) => { setSegmentId(e.target.value); setPage(1); }}
        >
          <option value="">{t('people.segmentNone')}</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.kind === 'static' ? t('people.segmentFixed', { name: s.name }) : s.name}</option>
          ))}
        </select>
      </div>

      <div style={styles.listToolbar}>
        <p style={styles.resultCount} aria-live="polite">{loading ? ' ' : t('people.count', { count: total })}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); setPage(1); }} />
          {t('people.showArchived')}
        </label>
        <div style={styles.columnsWrap}>
          <button style={styles.columnsButton} aria-expanded={showColumns} onClick={() => setShowColumns((v) => !v)}>{t('people.columns')}</button>
          {showColumns && (
            <div style={styles.columnsMenu} role="group" aria-label={t('people.columnsShown')}>
              {OPTIONAL_COLUMNS.map((c) => (
                <label key={c} style={styles.columnsOption}>
                  <input type="checkbox" checked={!hiddenColumns.includes(c)} onChange={() => toggleColumn(c)} />
                  {t('people.col.' + c)}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {bulkMessage && selectedCount === 0 && <p style={styles.bulkMessage} role="status">{bulkMessage}</p>}

      {/* Bulk actions: shown once someone is ticked */}
      {selectedCount > 0 && (
        <div style={styles.bulkBar} role="region" aria-label={t('people.bulk.title')}>
          <div style={styles.bulkLine}>
            <strong>{t('people.bulk.selected', { count: selectedCount })}</strong>
            {!allMatching && selectedIds.length === customers.length && total > customers.length && (
              <button style={styles.linkButton} onClick={() => { setAllMatching(true); setBulkConfirm(null); }}>
                {t('people.bulk.selectAll', { n: formatNumber(total) })}
              </button>
            )}
            {allMatching && <span style={styles.bulkHint}>{t('people.bulk.everyone')}</span>}
            <button style={styles.linkButton} onClick={clearSelection}>{t('people.bulk.clear')}</button>
          </div>
          {bulkConfirm === null ? (
            <div style={styles.bulkLine}>
              <select style={styles.bulkSelect} aria-label={t('people.bulk.action.label')} value={bulkAction} onChange={(e) => { setBulkAction(e.target.value as customersApi.BulkAction | ''); setBulkValue(''); }}>
                <option value="">{t('people.bulk.chooseAction')}</option>
                {BULK_ACTIONS.map((a) => <option key={a.id} value={a.id}>{t('people.bulk.action.' + a.id)}</option>)}
              </select>
              {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') && (
                <select style={styles.bulkSelect} aria-label={t('people.bulk.tag')} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{tags.length ? t('people.bulk.chooseTag') : t('people.bulk.noTags')}</option>
                  {tags.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                </select>
              )}
              {bulkAction === 'assign_owner' && (
                <select style={styles.bulkSelect} aria-label={t('people.bulk.staffMember')} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{t('people.bulk.chooseStaff')}</option>
                  <option value="none">{t('people.unassigned')}</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
                </select>
              )}
              {bulkAction === 'change_stage' && (
                <select style={styles.bulkSelect} aria-label={t('people.bulk.stage')} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{t('people.bulk.chooseStage')}</option>
                  {LIFECYCLE_STAGES.map((st) => <option key={st} value={st}>{stageText(t, st)}</option>)}
                </select>
              )}
              {bulkAction === 'add_to_list' && (
                <select style={styles.bulkSelect} aria-label={t('people.bulk.fixedList')} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">{fixedLists.length ? t('people.bulk.chooseList') : t('people.bulk.noLists')}</option>
                  {fixedLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              <Button size="sm" disabled={!bulkReady} loading={bulkBusy} onClick={previewBulk}>{t('people.bulk.continue')}</Button>
            </div>
          ) : (
            <div style={styles.bulkLine}>
              <span>
                <Trans t={t} i18nKey="people.bulk.confirm" count={bulkConfirm} values={{ action: bulkAction ? t('people.bulk.action.' + bulkAction) : '', n: formatNumber(bulkConfirm) }} components={[<strong />]} />
                {bulkAction === 'archive' ? ` ${t('people.bulk.archiveNote')}` : ''}
                {bulkAction === 'delete' ? ` ${t('people.bulk.deleteNote')}` : ''}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setBulkConfirm(null)}>{t('common:back')}</Button>
              <Button size="sm" loading={bulkBusy} onClick={applyBulk}>{t('common:confirm')}</Button>
            </div>
          )}
          {bulkMessage && <p style={styles.bulkMessage} role="status">{bulkMessage}</p>}
        </div>
      )}

      {/* Table */}
      {!businessId && !loading && (
        <div style={styles.noContext}>
          <p>{t('people.noContext')}</p>
        </div>
      )}
      <Table
        columns={columns}
        data={customers}
        loading={loading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        onSort={handleSort}
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        filterOptions={filterOptions}
        selectable={canEditPeople}
        selectedIds={selectedIds}
        onSelectionChange={(ids) => { setSelectedIds(ids); setAllMatching(false); setBulkConfirm(null); setBulkMessage(''); }}
        onLoadMore={loadMore}
        hasMore={customers.length < total}
        loadingMore={loadingMore}
        emptyMessage={t('people.none')}
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
