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
      else if (action === 'downgrade') {
        const planId = prompt('Enter plan ID to downgrade to:');
        if (planId) await membershipsApi.downgradeMembership(m.id, businessId, planId);
      }
      fetchMemberships();
    } catch { /* silent */ }
  };

  const handleCreditAction = async (action: string, m: Membership) => {
    const amount = prompt(`Enter credit amount to ${action}:`);
    if (!amount || isNaN(Number(amount))) return;
    const reason = prompt('Reason (optional):') || undefined;
    try {
      if (action === 'adjust') await membershipsApi.adjustCredits(m.id, { amount: Number(amount), reason });
      else if (action === 'deduct') await membershipsApi.deductCredits(m.id, { amount: Number(amount), reason });
      else if (action === 'restore') await membershipsApi.restoreCredits(m.id, { amount: Number(amount), reason });
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
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label="Resume" onClick={() => handleAction('resume', row)} />}
          {row.status === 'active' && <ActionBtn label="Downgrade" onClick={() => handleAction('downgrade', row)} />}
          {['active', 'paused'].includes(row.status) && <ActionBtn label="Cancel" onClick={() => handleAction('cancel', row)} />}
          <ActionBtn label="Adjust Credits" onClick={() => handleCreditAction('adjust', row)} />
          <ActionBtn label="Deduct Credits" onClick={() => handleCreditAction('deduct', row)} />
          <ActionBtn label="Restore Credits" onClick={() => handleCreditAction('restore', row)} />
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
      <FamilySection businessId={businessId} />
    </div>
  );
}

function FamilySection({ businessId }: { businessId: string }) {
  const [membershipId, setMembershipId] = useState('');
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [showFamily, setShowFamily] = useState(false);

  const loadFamily = async () => {
    if (!membershipId) return;
    try {
      const members = await membershipsApi.getFamilyMembers(membershipId);
      setFamilyMembers(members);
      setShowFamily(true);
    } catch { alert('Could not load family members'); }
  };

  const handleRemove = async (customerId: string) => {
    if (!confirm('Remove this member from the family plan?')) return;
    await membershipsApi.removeFamilyMember(membershipId, customerId);
    setFamilyMembers(familyMembers.filter((m: any) => m.customer_id !== customerId));
  };

  return (
    <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-lg)' }}>
      <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, marginBottom: 'var(--space-md)' }}>Family Members</h2>
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <input style={styles.select} placeholder="Membership ID" value={membershipId} onChange={(e) => setMembershipId(e.target.value)} />
        <button style={styles.navBtn} onClick={loadFamily}>Load Family</button>
      </div>
      {showFamily && (
        <div>
          {familyMembers.length === 0 ? <p style={{ color: 'var(--color-text-secondary)' }}>No family members</p> : (
            familyMembers.map((m: any) => (
              <div key={m.customer_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '4px' }}>
                <span>{m.first_name} {m.last_name}</span>
                <button style={styles.actionBtn} onClick={() => handleRemove(m.customer_id)}>Remove</button>
              </div>
            ))
          )}
        </div>
      )}
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
