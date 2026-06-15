import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as membershipsApi from '../api/memberships';
import type { Membership } from '../api/memberships';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', frozen: 'info', cancelled: 'error', expired: 'error', pending: 'neutral',
};

export function Memberships() {
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchMemberships = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await membershipsApi.getMemberships(businessId, { status: statusFilter || undefined, page });
      setMemberships(result.data);
      setTotalPages(result.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, statusFilter, page]);

  useEffect(() => { fetchMemberships(); }, [fetchMemberships]);

  const handleAction = async (action: string, m: Membership) => {
    try {
      if (action === 'cancel') await membershipsApi.cancelMembership(m.id, businessId);
      else if (action === 'pause') await membershipsApi.pauseMembership(m.id, businessId, 14);
      else if (action === 'resume') await membershipsApi.resumeMembership(m.id, businessId);
      fetchMemberships();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'customer', header: 'Customer', render: (_: any, row: Membership) => `${row.first_name} ${row.last_name}` },
    { key: 'plan_name', header: 'Plan' },
    { key: 'plan_type', header: 'Type', render: (v: string) => v.replace('_', ' ') },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={STATUS_VARIANTS[v] || 'neutral'}>{v}</Badge> },
    { key: 'credit_balance', header: 'Credits' },
    { key: 'next_billing_date', header: 'Next Billing', render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' },
    {
      key: 'actions', header: '',
      render: (_: any, row: Membership) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label="Resume" onClick={() => handleAction('resume', row)} />}
          {['active', 'paused'].includes(row.status) && <ActionBtn label="Cancel" onClick={() => handleAction('cancel', row)} />}
        </div>
      ),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Memberships</h1>
        <button style={styles.navBtn} onClick={() => navigate('/memberships/plans')}>Manage Plans</button>
      </div>
      <div style={styles.toolbar}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>
      <Table columns={columns} data={memberships} loading={loading} onRowClick={(row) => navigate(`/memberships/${row.id}`)} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No memberships found" mobileCardMode />
    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>{label}</button>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
