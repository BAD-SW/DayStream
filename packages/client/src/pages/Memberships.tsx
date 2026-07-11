import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as membershipsApi from '../api/memberships';
import * as customersApi from '../api/customers';
import type { Membership, MembershipPlan } from '../api/memberships';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', frozen: 'info', cancelled: 'error', expired: 'error', pending: 'neutral',
};

export function Memberships() {
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => setShowEnroll(!showEnroll)}>{showEnroll ? 'Cancel' : 'Enroll Customer'}</Button>
          <button style={styles.navBtn} onClick={() => navigate('/memberships/plans')}>Manage Plans</button>
        </div>
      </div>

      {showEnroll && (
        <EnrollForm businessId={businessId} onEnrolled={() => { setShowEnroll(false); fetchMemberships(); }} />
      )}

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

function EnrollForm({ businessId, onEnrolled }: { businessId: string; onEnrolled: () => void }) {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    membershipsApi.getPlans(businessId).then(setPlans).catch(() => {});
  }, [businessId]);

  // Customer search with debounce
  useEffect(() => {
    if (!customerSearch || customerSearch.length < 2) { setCustomerResults([]); setShowDropdown(false); return; }
    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await customersApi.getCustomers(businessId, { search: customerSearch, limit: 10 });
        setCustomerResults(res.data);
        setShowDropdown(true);
      } catch { setCustomerResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerSearch, businessId]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !selectedPlan) { setError('Select a customer and a plan'); return; }
    setEnrolling(true);
    setError('');
    try {
      await membershipsApi.createMembership({ business_id: businessId, customer_id: selectedCustomer.id, plan_id: selectedPlan });
      onEnrolled();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to enroll customer');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div style={styles.enrollForm}>
      <h3 style={{ margin: '0 0 12px 0', color: 'var(--color-text)', fontSize: '16px' }}>Enroll Customer in Plan</h3>
      {error && <p style={{ color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}
      <form onSubmit={handleEnroll} style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
        {/* Customer search */}
        <div style={{ position: 'relative' as const }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: '4px' }}>Customer *</label>
          {selectedCustomer ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: '14px' }}>
              <span>{selectedCustomer.first_name} {selectedCustomer.last_name} ({selectedCustomer.email})</span>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--color-text-secondary)' }} onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}>×</button>
            </div>
          ) : (
            <input style={styles.select} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customer..." autoComplete="off"
              onFocus={() => { if (customerResults.length > 0) setShowDropdown(true); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)} />
          )}
          {showDropdown && customerResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '150px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {customerResults.map((c) => (
                <button key={c.id} type="button" style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontSize: '13px', borderBottom: '1px solid var(--color-border)' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setSelectedCustomer(c); setShowDropdown(false); setCustomerSearch(''); }}>
                  <strong>{c.first_name} {c.last_name}</strong> — {c.email}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Plan select */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: '4px' }}>Plan *</label>
          <select style={styles.select} value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} required>
            <option value="">Select a plan...</option>
            {plans.filter((p) => p.status === 'active').map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price)}/{p.billing_cycle}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button type="submit" loading={enrolling} disabled={!selectedCustomer || !selectedPlan}>Enroll</Button>
        </div>
      </form>
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
  enrollForm: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-surface)' },
};
