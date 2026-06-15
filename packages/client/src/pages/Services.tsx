import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import * as servicesApi from '../api/services';
import type { Service, ServiceCategory } from '../api/services';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error',
};

export function Services() {
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchServices = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await servicesApi.getServices(businessId, {
        search: search || undefined,
        status: statusFilter || undefined,
        category_id: categoryFilter || undefined,
        page,
      });
      setServices(result.data);
      setTotalPages(result.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search, statusFilter, categoryFilter, page]);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  useEffect(() => {
    if (!businessId) return;
    servicesApi.getCategories(businessId).then(setCategories).catch(() => {});
  }, [businessId]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleQuickAction = async (action: string, service: Service) => {
    try {
      if (action === 'archive') await servicesApi.archiveService(service.id, businessId);
      else if (action === 'pause') await servicesApi.pauseService(service.id, businessId);
      else if (action === 'activate') await servicesApi.activateService(service.id, businessId);
      else if (action === 'restore') await servicesApi.restoreService(service.id, businessId);
      fetchServices();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'category_name', header: 'Category' },
    {
      key: 'status', header: 'Status',
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
    { key: 'booking_type', header: 'Type', render: (val: string) => val.replace('_', ' ') },
    { key: 'default_duration', header: 'Duration', render: (val: number) => `${val} min` },
    {
      key: 'actions', header: '',
      render: (_: any, row: Service) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'draft' && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleQuickAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label="Archive" onClick={() => handleQuickAction('archive', row)} />}
          {row.status === 'archived' && <ActionBtn label="Restore" onClick={() => handleQuickAction('restore', row)} />}
        </div>
      ),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Services</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <Button onClick={() => navigate('/services/categories')}>Categories</Button>
          <Button onClick={() => navigate('/services/new')}>Add Service</Button>
        </div>
      </div>

      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search services..." />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <Table
        columns={columns}
        data={services}
        loading={loading}
        onRowClick={(row) => navigate(`/services/${row.id}`)}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No services found"
        mobileCardMode
      />
    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
