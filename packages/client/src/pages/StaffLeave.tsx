import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import * as staffApi from '../api/staff';
import type { LeaveRequest } from '../api/staff';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'neutral',
};

export function StaffLeave() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffApi.getLeaveRequests({
        status: statusFilter || undefined,
        page,
        limit: 20,
      });
      setRequests(result.data);
      setTotal(result.meta?.total || 0);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleApprove = async (id: string) => {
    await staffApi.approveLeave(id);
    fetchRequests();
  };

  const handleReject = async (id: string) => {
    await staffApi.rejectLeave(id);
    fetchRequests();
  };

  const columns = [
    {
      key: 'staff', header: 'Staff',
      render: (_: any, row: LeaveRequest) => `${row.first_name} ${row.last_name}`,
    },
    { key: 'leave_type', header: 'Type', render: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },

    { key: 'start_date', header: 'From' },
    { key: 'end_date', header: 'To' },
    {
      key: 'status', header: 'Status',
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
    {
      key: 'actions', header: '',
      render: (_: any, row: LeaveRequest) => row.status === 'pending' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleApprove(row.id)}>Approve</Button>
          <Button size="sm" variant="destructive" onClick={() => handleReject(row.id)}>Reject</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Leave Management</h1>

      <div className="flex gap-4 mb-4">
        <select
          className="border rounded px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <Table
        columns={columns}
        data={requests}
        loading={loading}
        emptyMessage="No leave requests found"
      />

      {total > 20 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="px-3 py-2 text-sm">Page {page} of {Math.ceil(total / 20)}</span>
          <Button variant="ghost" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
