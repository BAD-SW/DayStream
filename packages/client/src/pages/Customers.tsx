import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { DateRangeFilter, DateRange } from '../design-system/components/data/DateRangeFilter';
import * as customersApi from '../api/customers';
import type { Customer, LifecycleSummary } from '../api/customers';

const STAGE_COLORS: Record<string, { bg: string; fg: string }> = {
  lead: { bg: 'var(--stage-lead-bg)', fg: 'var(--stage-lead-fg)' },
  trial: { bg: 'var(--stage-trial-bg)', fg: 'var(--stage-trial-fg)' },
  active: { bg: 'var(--stage-active-bg)', fg: 'var(--stage-active-fg)' },
  at_risk: { bg: 'var(--stage-at-risk-bg)', fg: 'var(--stage-at-risk-fg)' },
  churned: { bg: 'var(--stage-churned-bg)', fg: 'var(--stage-churned-fg)' },
  winback: { bg: 'var(--stage-winback-bg)', fg: 'var(--stage-winback-fg)' },
};

const STAGES = ['lead', 'trial', 'active', 'at_risk', 'churned', 'winback'];

function formatStage(stage: string): string {
  return stage.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface ColumnFilters {
  ref: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export function Customers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<LifecycleSummary | null>(null);
  const [sortKey, setSortKey] = useState(searchParams.get('sort') || 'created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>((searchParams.get('order') as 'asc' | 'desc') || 'desc');

  const [stageFilter, setStageFilter] = useState(searchParams.get('lifecycle_stage') || '');
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
    if (stageFilter) next.set('lifecycle_stage', stageFilter);
    if (dateRange) { next.set('created_from', dateRange.from); next.set('created_to', dateRange.to); }
    (Object.keys(debouncedFilters) as (keyof ColumnFilters)[]).forEach((k) => {
      if (debouncedFilters[k]) next.set(k, debouncedFilters[k]);
    });
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortKey, sortOrder, stageFilter, dateRange, debouncedFilters]);

  const fetchCustomers = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await customersApi.getCustomers(businessId, {
        lifecycle_stage: stageFilter || undefined,
        ref: debouncedFilters.ref || undefined,
        first_name: debouncedFilters.first_name || undefined,
        last_name: debouncedFilters.last_name || undefined,
        email: debouncedFilters.email || undefined,
        phone: debouncedFilters.phone || undefined,
        created_from: dateRange?.from,
        created_to: dateRange?.to,
        sort: sortKey,
        order: sortOrder,
        page,
        limit: 20,
      });
      setCustomers(result.data);
      setTotalPages(result.meta.totalPages);
    } catch {
      // Handle error silently for now
    } finally {
      setLoading(false);
    }
  }, [businessId, stageFilter, debouncedFilters, dateRange, sortKey, sortOrder, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getLifecycleSummary(businessId).then(setSummary).catch(() => {});
  }, [businessId]);

  function updateColumnFilter(key: keyof ColumnFilters, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    setSortKey(key);
    setSortOrder(order);
    setPage(1);
  }

  const columns = [
    { key: 'reference_number', header: 'Ref', width: '110px', sortable: true },
    { key: 'first_name', header: 'Name', sortable: true },
    { key: 'last_name', header: 'Surname(s)', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'phone', header: 'Phone', sortable: true },
    {
      key: 'lifecycle_stage', header: 'Stage', sortable: true,
      render: (val: string) => {
        const colors = STAGE_COLORS[val];
        return <Badge bg={colors?.bg} fg={colors?.fg}>{formatStage(val)}</Badge>;
      },
    },
    {
      key: 'created_at', header: 'Joined', sortable: true,
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
            value={columnFilters[key]}
            onChange={(e) => updateColumnFilter(key, e.target.value)}
          />
        </th>
      ))}
      <th style={styles.filterCell}>
        <select
          style={styles.filterInput}
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{formatStage(s)}</option>)}
        </select>
      </th>
      <th style={styles.filterCell}>
        <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} />
      </th>
    </>
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Customers</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
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
              link.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
              link.click();
              URL.revokeObjectURL(link.href);
            } catch { alert('Export failed'); }
          }}>Export CSV</Button>
          <Button onClick={() => navigate('/customers/new')}>Add Customer</Button>
        </div>
      </div>

      {/* Lifecycle summary cards */}
      {summary && (
        <div style={styles.summaryRow}>
          {Object.entries(summary).map(([stage, count]) => (
            <button
              key={stage}
              style={{ ...styles.summaryCard, ...(stageFilter === stage ? styles.summaryCardActive : {}) }}
              onClick={() => { setStageFilter(stageFilter === stage ? '' : stage); setPage(1); }}
              aria-pressed={stageFilter === stage}
            >
              <span style={styles.summaryCount}>{count}</span>
              <span style={styles.summaryLabel}>{formatStage(stage)}</span>
            </button>
          ))}
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
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No customers found"
        mobileCardMode
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-page-title)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  summaryRow: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const },
  summaryCard: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    cursor: 'pointer', minWidth: '80px', fontFamily: 'var(--font-family)',
  },
  summaryCardActive: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  summaryCount: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  summaryLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  noContext: { padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  filterCell: { padding: '4px var(--space-md) var(--space-sm)', fontWeight: 'normal' as any, textTransform: 'none' as any },
  filterInput: {
    width: '100%', fontSize: 'var(--font-size-xs)', padding: '6px 9px',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)',
  },
};
