import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import * as staffApi from '../api/staff';
import type { StaffProfile } from '../api/staff';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success',
  onboarding: 'info',
  inactive: 'warning',
  terminated: 'error',
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
};

export function Staff() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const businessId = localStorage.getItem('business_id') || '';
      // Every staff member (100 per call until all are in): the column filters replace the menu
      // above the table (column filters beside the sort icon, David 2026-11-02).
      const rows: StaffProfile[] = [];
      for (let p = 1; ; p++) {
        const result = await staffApi.getStaffList({ business_id: businessId || undefined, search: search || undefined, page: p, limit: 100 });
        rows.push(...result.data);
        if (result.data.length < 100 || p * 100 >= (result.meta?.total || 0)) break;
      }
      setStaff(rows);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns = [
    { key: 'staff_ref', header: 'Ref', width: '100px', sortable: true },
    {
      key: 'first_name', header: 'Name', sortable: true,
      render: (_: any, row: StaffProfile) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'email', header: 'Email', sortable: true },
    {
      key: 'user_role', header: 'Role',
      render: (_: unknown, row: StaffProfile) =>
        staffApi.STAFF_ROLE_OPTIONS.find((o) => o.value === staffApi.normalizeStaffRole(row.user_role))?.label ?? (row.user_role ? row.user_role : 'No login'),
    },
    {
      key: 'employment_type', header: 'Type', sortable: true,
      render: (val: string) => EMPLOYMENT_LABELS[val] || val,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (val: string) => (
        <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>
          {val.charAt(0).toUpperCase() + val.slice(1)}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search staff..." />
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => navigate('/staff/new')}>Add Staff</Button>
      </div>

      <Table
        columns={columns}
        data={staff}
        loading={loading}
        onRowClick={(row) => navigate(`/staff/${row.id}`)}
        emptyMessage="No staff members found"
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
