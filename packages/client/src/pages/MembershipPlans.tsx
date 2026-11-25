import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as membershipsApi from '../api/memberships';
import type { MembershipPlan } from '../api/memberships';
import { formatCurrency } from '../utils/currency';
import { useTranslation } from 'react-i18next';

export function MembershipPlans() {
  const { t } = useTranslation('offerings');
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
    } catch { void showMessage({ message: t('membershipPlans.statusFailed'), tone: 'error' }); }
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
      setCreateError(err.response?.data?.error || t('membershipPlans.saveFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/memberships')}>{t('membershipPlans.back')}</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={styles.title}>{t('membershipPlans.title')}</h1>
          <Button onClick={() => showCreate ? (setShowCreate(false), setEditingPlan(null)) : openCreate()}>{showCreate ? t('common:cancel') : t('memberships.createPlan')}</Button>
        </div>
      </div>

      {showCreate && (
        <div style={styles.createForm}>
          <h3 style={{ margin: '0 0 16px 0', color: 'var(--color-text)' }}>{editingPlan ? t('membershipPlans.edit') : t('membershipPlans.new')}</h3>
          {createError && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-base)' }}>{createError}</p>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.label}>{t('shared.nameRequired')}</label>
                <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('membershipPlans.exampleName')} />
              </div>
              <div style={styles.formField}>
                <label style={styles.label}>{t('membershipPlans.typeRequired')}</label>
                <select style={styles.input} value={form.plan_type} onChange={(e) => setForm({ ...form, plan_type: e.target.value })}>
                  <option value="unlimited">{t('membershipPlans.planType.unlimited')}</option>
                  <option value="credit">{t('membershipPlans.creditBased')}</option>
                  <option value="hybrid">{t('membershipPlans.planType.hybrid')}</option>
                  <option value="punch_card">{t('membershipPlans.planType.punch_card')}</option>
                  <option value="intro_package">{t('membershipPlans.introPackage')}</option>
                </select>
                <div style={styles.typeHelper}>
                  {form.plan_type === 'unlimited' && <span>{t('membershipPlans.help.unlimited')}</span>}
                  {form.plan_type === 'credit' && <span>{t('membershipPlans.help.credit')}</span>}
                  {form.plan_type === 'hybrid' && <span>{t('membershipPlans.help.hybrid')}</span>}
                  {form.plan_type === 'punch_card' && <span>{t('membershipPlans.help.punch_card')}</span>}
                  {form.plan_type === 'intro_package' && <span>{t('membershipPlans.help.intro_package')}</span>}
                </div>
              </div>
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>{t('shared.description')}</label>
              <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('membershipPlans.briefDescription')} />
            </div>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.label}>{t('shared.priceRequired')}</label>
                <input style={styles.input} type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="0.00" />
              </div>
              <div style={styles.formField}>
                <label style={styles.label}>{t('memberships.billingCycleRequired')}</label>
                <select style={styles.input} value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                  <option value="monthly">{t('shared.billing.monthly')}</option>
                  <option value="quarterly">{t('shared.billing.quarterly')}</option>
                  <option value="annually">{t('shared.billing.annually')}</option>
                  <option value="one_time">{t('membershipPlans.oneTime')}</option>
                </select>
              </div>
            </div>
            {(form.plan_type === 'credit' || form.plan_type === 'hybrid') && (
              <div style={styles.formField}>
                <label style={styles.label}>{t('membershipPlans.creditsPerCycle')}</label>
                <input style={styles.input} type="number" min="1" value={form.credits_per_cycle} onChange={(e) => setForm({ ...form, credits_per_cycle: e.target.value })} placeholder={t('pricing.exampleTen')} />
              </div>
            )}
            {(form.plan_type === 'punch_card' || form.plan_type === 'intro_package') && (
              <div style={styles.formRow}>
                <div style={styles.formField}>
                  <label style={styles.label}>{t('membershipPlans.totalSessions')}</label>
                  <input style={styles.input} type="number" min="1" value={form.total_sessions} onChange={(e) => setForm({ ...form, total_sessions: e.target.value })} placeholder={t('pricing.exampleTen')} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>{t('pricing.expirationDays')}</label>
                  <input style={styles.input} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} placeholder={t('membershipPlans.exampleNinety')} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); setEditingPlan(null); }}>{t('common:cancel')}</Button>
              <Button type="submit" loading={creating}>{editingPlan ? t('membershipPlans.saveChanges') : t('memberships.createPlan')}</Button>
            </div>
          </form>
        </div>
      )}

      {loading && <p style={styles.empty}>{t('common:loading')}</p>}

      <div style={styles.planGrid}>
        {plans.map((plan) => (
          <div key={plan.id} style={styles.planCard} onClick={() => openEdit(plan)}>
            <h3 style={styles.planName}>{plan.name}</h3>
            <Badge variant={plan.status === 'active' ? 'success' : 'neutral'}>{t(`shared.status.${plan.status}`, { defaultValue: plan.status })}</Badge>
            <Badge variant="neutral">{t(`membershipPlans.planType.${plan.plan_type}`, { defaultValue: plan.plan_type })}</Badge>
            <div style={styles.planPrice}>{formatCurrency(plan.price)}<span style={styles.cycle}>/{t(`shared.frequency.${plan.billing_cycle}`, { defaultValue: plan.billing_cycle })}</span></div>
            {plan.credits_per_cycle && <p style={styles.planDetail}>{t('membershipPlans.creditsPerCycleBadge', { count: Number(plan.credits_per_cycle) })}</p>}
            {plan.total_sessions && <p style={styles.planDetail}>{t('membershipPlans.sessionsBadge', { count: Number(plan.total_sessions) })}</p>}
            <button
              style={{ marginTop: '8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)' }}
              onClick={(e) => { e.stopPropagation(); handleArchiveToggle(plan); }}
            >
              {plan.status === 'active' ? t('shared.archive') : t('shared.activate')}
            </button>
          </div>
        ))}
      </div>

      {!loading && plans.length === 0 && <p style={styles.empty}>{t('membershipPlans.empty')}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-lg)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)' },
  createForm: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-surface)' },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formField: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const },
  typeHelper: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic' as const },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--space-lg)' },
  planCard: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', cursor: 'pointer' },
  planName: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any },
  planPrice: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' },
  cycle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-normal)' as any, color: 'var(--color-text-secondary)' },
  planDetail: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
};
