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
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const businessId = localStorage.getItem('business_id') || '';
      const result = await staffApi.getStaffList({
        business_id: businessId || undefined,
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        limit: 20,
      });
      setStaff(result.data);
      setTotalPages(Math.ceil((result.meta?.total || 0) / 20));
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns = [
    { key: 'staff_ref', header: 'Ref', width: '100px' },
    {
      key: 'name', header: 'Name',
      render: (_: any, row: StaffProfile) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'email', header: 'Email' },
    {
      key: 'employment_type', header: 'Type',
      render: (val: string) => EMPLOYMENT_LABELS[val] || val,
    },
    {
      key: 'status', header: 'Status',
      render: (val: string) => (
        <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>
          {val.charAt(0).toUpperCase() + val.slice(1)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <Button onClick={() => navigate('/staff/new')}>Add Staff</Button>
      </div>

      <div className="flex gap-4 mb-4">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search by name or email..."
        />
        <select
          className="border rounded px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="onboarding">Onboarding</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>

      <Table
        columns={columns}
        data={staff}
        loading={loading}
        onRowClick={(row) => navigate(`/staff/${row.id}`)}
        emptyMessage="No staff members found"
      />

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="px-3 py-2 text-sm">Page {page} of {totalPages}</span>
          <Button variant="ghost" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
