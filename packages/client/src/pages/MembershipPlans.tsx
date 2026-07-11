import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as membershipsApi from '../api/memberships';
import type { MembershipPlan } from '../api/memberships';
import { formatCurrency } from '../utils/currency';

const TYPE_LABELS: Record<string, string> = {
  unlimited: 'Unlimited', credit: 'Credit', hybrid: 'Hybrid', punch_card: 'Punch Card', intro_package: 'Intro',
};

export function MembershipPlans() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    plan_type: 'unlimited',
    billing_cycle: 'monthly',
    price: '',
    credits_per_cycle: '',
    total_sessions: '',
    expiration_days: '',
  });

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    membershipsApi.getPlans(businessId, true).then(setPlans).finally(() => setLoading(false));
  }, [businessId]);

  const handleArchiveToggle = async (plan: MembershipPlan) => {
    try {
      if (plan.status === 'active') {
        await membershipsApi.archivePlan(plan.id, businessId);
        setPlans(plans.map((p) => p.id === plan.id ? { ...p, status: 'archived' } : p));
      } else {
        await membershipsApi.updatePlan(plan.id, businessId, { status: 'active' });
        setPlans(plans.map((p) => p.id === plan.id ? { ...p, status: 'active' } : p));
      }
    } catch { alert('Failed to update plan status'); }
  };

  const resetForm = () => {
    setForm({ name: '', description: '', plan_type: 'unlimited', billing_cycle: 'monthly', price: '', credits_per_cycle: '', total_sessions: '', expiration_days: '' });
  };

  const openEdit = (plan: MembershipPlan) => {
    setEditingPlan(plan);
    setShowCreate(true);
    setCreateError('');
    setForm({
      name: plan.name,
      description: plan.description || '',
      plan_type: plan.plan_type,
      billing_cycle: plan.billing_cycle,
      price: (plan.price / 100).toFixed(2),
      credits_per_cycle: plan.credits_per_cycle ? String(plan.credits_per_cycle) : '',
      total_sessions: plan.total_sessions ? String(plan.total_sessions) : '',
      expiration_days: plan.expiration_days ? String(plan.expiration_days) : '',
    });
  };

  const openCreate = () => {
    setEditingPlan(null);
    resetForm();
    setShowCreate(true);
    setCreateError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const data: any = {
        name: form.name,
        plan_type: form.plan_type,
        billing_cycle: form.billing_cycle,
        price: Math.round(parseFloat(form.price || '0') * 100),
      };
      if (form.description) data.description = form.description;
      if (form.credits_per_cycle) data.credits_per_cycle = parseInt(form.credits_per_cycle);
      if (form.total_sessions) data.total_sessions = parseInt(form.total_sessions);
      if (form.expiration_days) data.expiration_days = parseInt(form.expiration_days);

      if (editingPlan) {
        const updated = await membershipsApi.updatePlan(editingPlan.id, businessId, data);
        setPlans(plans.map((p) => p.id === editingPlan.id ? updated : p));
      } else {
        data.business_id = businessId;
        const plan = await membershipsApi.createPlan(data);
        setPlans([...plans, plan]);
      }
      setShowCreate(false);
      setEditingPlan(null);
      resetForm();
    } catch (err: any) {
      setCreateError(err.response?.data?.error || 'Failed to save plan');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/memberships')}>← Memberships</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={styles.title}>Membership Plans</h1>
          <Button onClick={() => showCreate ? (setShowCreate(false), setEditingPlan(null)) : openCreate()}>{showCreate ? 'Cancel' : 'Create Plan'}</Button>
        </div>
      </div>

      {showCreate && (
        <div style={styles.createForm}>
          <h3 style={{ margin: '0 0 16px 0', color: 'var(--color-text)' }}>{editingPlan ? 'Edit Plan' : 'New Plan'}</h3>
          {createError && <p style={{ color: 'var(--color-error)', fontSize: '14px' }}>{createError}</p>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.label}>Name *</label>
                <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Gold Monthly" />
              </div>
              <div style={styles.formField}>
                <label style={styles.label}>Type *</label>
                <select style={styles.input} value={form.plan_type} onChange={(e) => setForm({ ...form, plan_type: e.target.value })}>
                  <option value="unlimited">Unlimited</option>
                  <option value="credit">Credit-based</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="punch_card">Punch Card</option>
                  <option value="intro_package">Intro Package</option>
                </select>
                <div style={styles.typeHelper}>
                  {form.plan_type === 'unlimited' && <span>Flat fee for unlimited access to services during the billing cycle.</span>}
                  {form.plan_type === 'credit' && <span>Customer receives a set number of credits per cycle to book services.</span>}
                  {form.plan_type === 'hybrid' && <span>Unlimited access to some services, credit-based for others.</span>}
                  {form.plan_type === 'punch_card' && <span>Pre-paid fixed number of sessions. No recurring billing — expires after use or time limit.</span>}
                  {form.plan_type === 'intro_package' && <span>One-time introductory offer for new customers. Limited sessions with an expiration.</span>}
                </div>
              </div>
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Description</label>
              <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of what's included" />
            </div>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.label}>Price *</label>
                <input style={styles.input} type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="0.00" />
              </div>
              <div style={styles.formField}>
                <label style={styles.label}>Billing Cycle *</label>
                <select style={styles.input} value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                  <option value="one_time">One-time</option>
                </select>
              </div>
            </div>
            {(form.plan_type === 'credit' || form.plan_type === 'hybrid') && (
              <div style={styles.formField}>
                <label style={styles.label}>Credits per Cycle</label>
                <input style={styles.input} type="number" min="1" value={form.credits_per_cycle} onChange={(e) => setForm({ ...form, credits_per_cycle: e.target.value })} placeholder="e.g. 10" />
              </div>
            )}
            {(form.plan_type === 'punch_card' || form.plan_type === 'intro_package') && (
              <div style={styles.formRow}>
                <div style={styles.formField}>
                  <label style={styles.label}>Total Sessions</label>
                  <input style={styles.input} type="number" min="1" value={form.total_sessions} onChange={(e) => setForm({ ...form, total_sessions: e.target.value })} placeholder="e.g. 10" />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Expiration (days)</label>
                  <input style={styles.input} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} placeholder="e.g. 90" />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); setEditingPlan(null); }}>Cancel</Button>
              <Button type="submit" loading={creating}>{editingPlan ? 'Save Changes' : 'Create Plan'}</Button>
            </div>
          </form>
        </div>
      )}

      {loading && <p style={styles.empty}>Loading...</p>}

      <div style={styles.planGrid}>
        {plans.map((plan) => (
          <div key={plan.id} style={styles.planCard} onClick={() => openEdit(plan)}>
            <h3 style={styles.planName}>{plan.name}</h3>
            <Badge variant={plan.status === 'active' ? 'success' : 'neutral'}>{plan.status}</Badge>
            <Badge variant="neutral">{TYPE_LABELS[plan.plan_type] || plan.plan_type}</Badge>
            <div style={styles.planPrice}>{formatCurrency(plan.price)}<span style={styles.cycle}>/{plan.billing_cycle}</span></div>
            {plan.credits_per_cycle && <p style={styles.planDetail}>{plan.credits_per_cycle} credits/cycle</p>}
            {plan.total_sessions && <p style={styles.planDetail}>{plan.total_sessions} sessions</p>}
            <button
              style={{ marginTop: '8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)' }}
              onClick={(e) => { e.stopPropagation(); handleArchiveToggle(plan); }}
            >
              {plan.status === 'active' ? 'Archive' : 'Activate'}
            </button>
          </div>
        ))}
      </div>

      {!loading && plans.length === 0 && <p style={styles.empty}>No plans configured yet.</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-lg)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)' },
  createForm: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-surface)' },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formField: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const },
  typeHelper: { fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic' as const },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--space-lg)' },
  planCard: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', cursor: 'pointer' },
  planName: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any },
  planPrice: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' },
  cycle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-normal)' as any, color: 'var(--color-text-secondary)' },
  planDetail: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
};
