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

  useEffect(() => {
    if (!businessId) return;
    resourcesApi.getResourceTypes({ business_id: businessId }).then(setTypes).catch(() => {});
  }, [businessId]);

  const fetchResources = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      // Every resource (100 per call until all are in): the column filters replace the menus
      // above the table (column filters beside the sort icon, David 2026-11-02).
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const result = await resourcesApi.getResources({ business_id: businessId, search: search || undefined, page: p, limit: 100 });
        rows.push(...result.data);
        if (result.data.length < 100 || p >= (result.meta?.totalPages || Math.ceil((result.meta?.total || 0) / 100) || 1)) break;
      }
      setResources(rows);
    } catch {} finally { setLoading(false); }
  }, [businessId, search]);

  useEffect(() => { fetchResources(); }, [fetchResources]);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 300); return () => clearTimeout(t); }, [searchInput]);

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'category', header: 'Category', sortable: true,
      render: (val: string) => val ? val.charAt(0).toUpperCase() + val.slice(1) : '—',
    },
    {
      key: 'capacity', header: 'Capacity', sortable: true,
      render: (val: number) => val > 1 ? `${val} concurrent` : 'Exclusive',
    },
    {
      key: 'buffer_minutes', header: 'Buffer', sortable: true,
      render: (val: number) => val > 0 ? `${val} min` : '—',
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search resources..." />
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => navigate('/resources/new')}>Add Resource</Button>
      </div>

      <Table
        columns={columns}
        data={resources}
        loading={loading}
        onRowClick={(row) => navigate(`/resources/${row.id}`)}
        emptyMessage="No resources found"
        mobileCardMode
        clientSort
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
