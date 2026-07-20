import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import * as locationsApi from '../api/locations';
import type { Location } from '../api/locations';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
  temporarily_closed: 'warning',
};

export function Locations() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const fetchLocations = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const locs = await locationsApi.getLocations(businessId, { search: search || undefined, status: statusFilter || undefined });
      setLocations(locs);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search, statusFilter]);

  useEffect(() => { fetchLocations(); }, [fetchLocations]);

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'address_line1', header: 'Address',
      render: (_: any, row: Location) => {
        const parts = [row.address_line1, row.city, row.state_province].filter(Boolean);
        return parts.join(', ') || '—';
      },
    },
    { key: 'phone', header: 'Phone', render: (val: string) => val || '—' },
    { key: 'timezone', header: 'Timezone', render: (val: string) => val || '—' },
    {
      key: 'status', header: 'Status',
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val.replace('_', ' ')}</Badge>,
    },
    {
      key: 'is_primary', header: '',
      render: (val: boolean) => val ? <Badge variant="info">Primary</Badge> : null,
    },
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search locations..." />
        <select style={styles.select} value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="temporarily_closed">Temporarily Closed</option>
        </select>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => navigate('/settings/locations/new')}>Add Location</Button>
      </div>

      <Table
        columns={columns}
        data={locations}
        loading={loading}
        onRowClick={(row) => navigate(`/settings/locations/${row.id}`)}
        emptyMessage="No locations found"
        mobileCardMode
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
