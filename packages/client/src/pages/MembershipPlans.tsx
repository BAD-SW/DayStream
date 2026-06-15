import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as membershipsApi from '../api/memberships';
import type { MembershipPlan } from '../api/memberships';

const TYPE_LABELS: Record<string, string> = {
  unlimited: 'Unlimited', credit: 'Credit', hybrid: 'Hybrid', punch_card: 'Punch Card', intro_package: 'Intro',
};

export function MembershipPlans() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    membershipsApi.getPlans(businessId).then(setPlans).finally(() => setLoading(false));
  }, [businessId]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/memberships')}>← Memberships</button>
        <h1 style={styles.title}>Membership Plans</h1>
      </div>

      {loading && <p style={styles.empty}>Loading...</p>}

      <div style={styles.planGrid}>
        {plans.map((plan) => (
          <div key={plan.id} style={styles.planCard}>
            <h3 style={styles.planName}>{plan.name}</h3>
            <Badge variant="neutral">{TYPE_LABELS[plan.plan_type] || plan.plan_type}</Badge>
            <div style={styles.planPrice}>€{(plan.price / 100).toFixed(2)}<span style={styles.cycle}>/{plan.billing_cycle}</span></div>
            {plan.credits_per_cycle && <p style={styles.planDetail}>{plan.credits_per_cycle} credits/cycle</p>}
            {plan.total_sessions && <p style={styles.planDetail}>{plan.total_sessions} sessions</p>}
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
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--space-lg)' },
  planCard: { padding: 'var(--space-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  planName: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any },
  planPrice: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' },
  cycle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-normal)' as any, color: 'var(--color-text-secondary)' },
  planDetail: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
};
