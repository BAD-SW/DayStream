import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import * as customersApi from '../api/customers';
import type { Customer, LifecycleSummary } from '../api/customers';

const LIFECYCLE_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  lead: 'neutral',
  trial: 'info',
  active: 'success',
  at_risk: 'warning',
  churned: 'error',
  winback: 'info',
};

function formatStage(stage: string): string {
  return stage.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<LifecycleSummary | null>(null);

  // TODO: Get from auth context
  const businessId = localStorage.getItem('business_id') || '';

  const fetchCustomers = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const result = await customersApi.getCustomers(businessId, {
        search: search || undefined,
        lifecycle_stage: lifecycleFilter || undefined,
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
  }, [businessId, search, lifecycleFilter, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getLifecycleSummary(businessId).then(setSummary).catch(() => {});
  }, [businessId]);

  // Debounce search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns = [
    { key: 'reference_number', header: 'Ref', width: '100px', sortable: true },
    {
      key: 'name', header: 'Name', sortable: true,
      render: (_: any, row: Customer) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'phone', header: 'Phone' },
    {
      key: 'lifecycle_stage', header: 'Stage', sortable: true,
      render: (val: string) => <Badge variant={LIFECYCLE_VARIANTS[val] || 'neutral'}>{formatStage(val)}</Badge>,
    },
    {
      key: 'created_at', header: 'Joined', sortable: true,
      render: (val: string) => new Date(val).toLocaleDateString(),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Customers</h1>
        <Button onClick={() => navigate('/customers/new')}>Add Customer</Button>
      </div>

      {/* Lifecycle summary cards */}
      {summary && (
        <div style={styles.summaryRow}>
          {Object.entries(summary).map(([stage, count]) => (
            <button
              key={stage}
              style={{ ...styles.summaryCard, ...(lifecycleFilter === stage ? styles.summaryCardActive : {}) }}
              onClick={() => { setLifecycleFilter(lifecycleFilter === stage ? '' : stage); setPage(1); }}
              aria-pressed={lifecycleFilter === stage}
            >
              <span style={styles.summaryCount}>{count}</span>
              <span style={styles.summaryLabel}>{formatStage(stage)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search & filters */}
      <div style={styles.toolbar}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search customers..."
        />
        {selectedIds.length > 0 && (
          <span style={styles.selectedCount}>{selectedIds.length} selected</span>
        )}
      </div>

      {/* Table */}
      <Table
        columns={columns}
        data={customers}
        loading={loading}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        onSort={(key, order) => {
          // Re-fetch with sort
          // TODO: pass sort/order to API
        }}
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
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  summaryRow: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const },
  summaryCard: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    cursor: 'pointer', minWidth: '80px', fontFamily: 'var(--font-family)',
  },
  summaryCardActive: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  summaryCount: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  summaryLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)' },
  selectedCount: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
