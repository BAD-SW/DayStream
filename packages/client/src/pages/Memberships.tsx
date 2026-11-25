import { askText } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as membershipsApi from '../api/memberships';
import * as customersApi from '../api/customers';
import type { Membership, MembershipPlan } from '../api/memberships';
import { formatCurrency } from '../utils/currency';
import { formatDate } from '../utils/format';
import { useTranslation } from 'react-i18next';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', renewing: 'warning', frozen: 'info', cancelled: 'error', expired: 'error', pending: 'neutral',
};

/** The status label comes from `memberships.status.<status>` (renewing reads as "Past due" for staff clarity). */
export function Memberships() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchMemberships = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Every membership: the column filters work on all of them (David, 2026-11-02).
      const result = await membershipsApi.getMemberships(businessId, {});
      setMemberships(result.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { fetchMemberships(); }, [fetchMemberships]);

  const handleAction = async (action: string, m: Membership) => {
    try {
      if (action === 'cancel') await membershipsApi.cancelMembership(m.id, businessId);
      else if (action === 'pause') await membershipsApi.pauseMembership(m.id, businessId, 14);
      else if (action === 'resume') await membershipsApi.resumeMembership(m.id, businessId);
      else if (action === 'downgrade') {
        const planId = await askText({ message: t('memberships.promptPlanId') });
        if (planId) await membershipsApi.downgradeMembership(m.id, businessId, planId);
      }
      fetchMemberships();
    } catch { /* silent */ }
  };

  const handleCreditAction = async (action: string, m: Membership) => {
    const amount = await askText({ message: t(`memberships.creditPrompt.${action}`, { defaultValue: `Enter credit amount to ${action}:` }) });
    if (!amount || isNaN(Number(amount))) return;
    const reason = (await askText({ message: t('memberships.promptReason') })) || undefined;
    try {
      if (action === 'adjust') await membershipsApi.adjustCredits(m.id, { amount: Number(amount), reason });
      else if (action === 'deduct') await membershipsApi.deductCredits(m.id, { amount: Number(amount), reason });
      else if (action === 'restore') await membershipsApi.restoreCredits(m.id, { amount: Number(amount), reason });
      fetchMemberships();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'customer', header: t('memberships.customer'), filter: 'values' as const, filterValue: (row: any) => [row.customer_first_name ?? row.first_name, row.customer_last_name ?? row.last_name].filter(Boolean).join(' ') || row.customer_email || '', render: (_: any, row: any) => [row.customer_first_name ?? row.first_name, row.customer_last_name ?? row.last_name].filter(Boolean).join(' ') || row.customer_email || '—' },
    { key: 'plan_name', header: t('memberships.plan') },
    // The list carries the plan's billing frequency (there is no plan_type: reading it crashed the screen).
    { key: 'billing_frequency', header: t('memberships.billing'), render: (v: string) => (v ? t(`shared.frequency.${v}`, { defaultValue: v.replace(/_/g, ' ') }) : '—') },
    { key: 'status', header: t('shared.status'), filterLabel: (v: string) => t(`memberships.status.${v}`, { defaultValue: v }), render: (v: string) => <Badge variant={STATUS_VARIANTS[v] || 'neutral'}>{t(`memberships.status.${v}`, { defaultValue: v })}</Badge> },
    { key: 'credit_balance', header: t('memberships.credits'), render: (v: any) => (v === undefined || v === null ? '—' : v) },
    { key: 'next_billing_date', header: t('memberships.nextBilling'), render: (v: string) => v ? formatDate(v) : '—' },
    {
      key: 'actions', header: '',
      render: (_: any, row: Membership) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label={t('memberships.resume')} onClick={() => handleAction('resume', row)} />}
          {row.status === 'active' && <ActionBtn label={t('memberships.downgrade')} onClick={() => handleAction('downgrade', row)} />}
          {['active', 'paused'].includes(row.status) && <ActionBtn label={t('common:cancel')} onClick={() => handleAction('cancel', row)} />}
          <ActionBtn label={t('memberships.adjustCredits')} onClick={() => handleCreditAction('adjust', row)} />
          <ActionBtn label={t('memberships.deductCredits')} onClick={() => handleCreditAction('deduct', row)} />
          <ActionBtn label={t('memberships.restoreCredits')} onClick={() => handleCreditAction('restore', row)} />
        </div>
      ),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('memberships.title')}</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => setShowEnroll(!showEnroll)}>{showEnroll ? t('common:cancel') : t('memberships.enroll')}</Button>
          <button style={styles.navBtn} onClick={() => navigate('/memberships/plans')}>{t('memberships.managePlans')}</button>
        </div>
      </div>

      {showEnroll && (
        <EnrollForm businessId={businessId} onEnrolled={() => { setShowEnroll(false); fetchMemberships(); }} />
      )}

      <Table columns={columns} data={memberships} loading={loading} onRowClick={(row) => navigate(`/memberships/${row.id}`)} emptyMessage={t('memberships.listEmpty')} mobileCardMode />
    </div>
  );
}

function EnrollForm({ businessId, onEnrolled }: { businessId: string; onEnrolled: () => void }) {
  const { t } = useTranslation('offerings');
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
    if (!selectedCustomer || !selectedPlan) { setError(t('memberships.selectCustomerPlan')); return; }
    setEnrolling(true);
    setError('');
    try {
      await membershipsApi.createMembership({ business_id: businessId, customer_id: selectedCustomer.id, plan_id: selectedPlan });
      onEnrolled();
    } catch (err: any) {
      setError(err.response?.data?.error || t('memberships.enrollFailed'));
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div style={styles.enrollForm}>
      <h3 style={{ margin: '0 0 12px 0', color: 'var(--color-text)', fontSize: 'var(--font-size-base)' }}>{t('memberships.enrollTitle')}</h3>
      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px' }}>{error}</p>}
      <form onSubmit={handleEnroll} style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
        {/* Customer search */}
        <div style={{ position: 'relative' as const }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: '4px' }}>{t('memberships.customerRequired')}</label>
          {selectedCustomer ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-base)' }}>
              <span>{selectedCustomer.first_name} {selectedCustomer.last_name} ({selectedCustomer.email})</span>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }} onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}>×</button>
            </div>
          ) : (
            <input style={styles.select} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder={t('memberships.searchCustomer')} autoComplete="off"
              onFocus={() => { if (customerResults.length > 0) setShowDropdown(true); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)} />
          )}
          {showDropdown && customerResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '150px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {customerResults.map((c) => (
                <button key={c.id} type="button" style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--color-border)' }}
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
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: '4px' }}>{t('memberships.planRequired')}</label>
          <select style={styles.select} value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} required>
            <option value="">{t('memberships.selectPlan')}</option>
            {plans.filter((p) => p.status === 'active').map((p) => (
              <option key={p.id} value={p.id}>{t('memberships.planOption', { name: p.name, price: formatCurrency(p.price), cycle: t(`shared.frequency.${p.billing_cycle}`, { defaultValue: p.billing_cycle }) })}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button type="submit" loading={enrolling} disabled={!selectedCustomer || !selectedPlan}>{t('memberships.enrollButton')}</Button>
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
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)' },
  enrollForm: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-surface)' },
};
