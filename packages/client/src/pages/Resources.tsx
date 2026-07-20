import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import * as resourcesApi from '../api/resources';
import type { Resource, ResourceType } from '../api/resources';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', inactive: 'neutral', maintenance: 'warning',
};

export function Resources() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [resources, setResources] = useState<Resource[]>([]);
  const [types, setTypes] = useState<ResourceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!businessId) return;
    resourcesApi.getResourceTypes({ business_id: businessId }).then(setTypes).catch(() => {});
  }, [businessId]);

  const fetchResources = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const result = await resourcesApi.getResources({
        business_id: businessId,
        search: search || undefined,
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        page, limit: 20,
      });
      setResources(result.data);
      const meta = result.meta || {};
      setTotalPages(meta.totalPages || Math.ceil((meta.total || 0) / 20) || 1);
    } catch {} finally { setLoading(false); }
  }, [businessId, search, categoryFilter, statusFilter, page]);

  useEffect(() => { fetchResources(); }, [fetchResources]);
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'category', header: 'Category',
      render: (val: string) => val ? val.charAt(0).toUpperCase() + val.slice(1) : '—',
    },
    {
      key: 'capacity', header: 'Capacity',
      render: (val: number) => val > 1 ? `${val} concurrent` : 'Exclusive',
    },
    {
      key: 'buffer_minutes', header: 'Buffer',
      render: (val: number) => val > 0 ? `${val} min` : '—',
    },
    {
      key: 'status', header: 'Status',
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search resources..." />
        <select style={styles.select} value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <select style={styles.select} value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
          <option value="">All Categories</option>
          <option value="room">Rooms</option>
          <option value="equipment">Equipment</option>
          <option value="facility">Facilities</option>
        </select>
        <div style={{ flex: 1 }} />
        <Button onClick={() => navigate('/resources/new')}>Add Resource</Button>
      </div>

      <Table
        columns={columns}
        data={resources}
        loading={loading}
        onRowClick={(row) => navigate(`/resources/${row.id}`)}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No resources found"
        mobileCardMode
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
