import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import './StaffLeave.css';
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

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      // Every request (100 per call until all are in); the list starts on Pending, as before, as
      // the Status column's filter (column filters beside the sort icon, David 2026-11-02).
      const rows: LeaveRequest[] = [];
      for (let p = 1; ; p++) {
        const result = await staffApi.getLeaveRequests({ page: p, limit: 100 });
        rows.push(...result.data);
        if (result.data.length < 100 || p * 100 >= (result.meta?.total || 0)) break;
      }
      setRequests(rows);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, []);

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
      key: 'staff', header: 'Staff', filterValue: (row: LeaveRequest) => `${row.first_name} ${row.last_name}`,
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
        <div className="lv-actions">
          <Button size="sm" onClick={() => handleApprove(row.id)}>Approve</Button>
          <Button size="sm" variant="destructive" onClick={() => handleReject(row.id)}>Reject</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="Leave Management" />

      <Table
        columns={columns}
        data={requests}
        loading={loading}
        emptyMessage="No leave requests found"
        initialFilters={{ status: { values: ['pending'] } }}
      />

    </div>
  );
}
