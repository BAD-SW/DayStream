import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as membershipsApi from '../api/memberships';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', paused: 'warning', cancelled: 'error', expired: 'neutral',
};

export function MembershipDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [membership, setMembership] = useState<any>(null);
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    Promise.all([
      membershipsApi.getMembership(id, businessId),
      membershipsApi.getCredits(id).catch(() => []),
    ]).then(([m, c]) => { setMembership(m); setCredits(c); }).finally(() => setLoading(false));
  }, [id, businessId]);

  const handleCancel = async () => {
    if (!id || !confirm('Cancel this membership?')) return;
    try {
      await membershipsApi.cancelMembership(id, businessId, 'Cancelled by admin');
      setMembership({ ...membership, status: 'cancelled' });
    } catch { alert('Cancel failed'); }
  };

  const handlePause = async () => {
    if (!id) return;
    const days = prompt('Pause for how many days?', '30');
    if (!days) return;
    try {
      const updated = await membershipsApi.pauseMembership(id, businessId, Number(days));
      setMembership(updated);
    } catch { alert('Pause failed'); }
  };

  const handleResume = async () => {
    if (!id) return;
    try {
      const updated = await membershipsApi.resumeMembership(id, businessId);
      setMembership(updated);
    } catch { alert('Resume failed'); }
  };

  if (loading) return <div style={styles.page}><p>Loading...</p></div>;
  if (!membership) return <div style={styles.page}><p>Membership not found.</p></div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/memberships')}>← Back to Memberships</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{membership.first_name} {membership.last_name}</h1>
        <Badge variant={STATUS_VARIANTS[membership.status] || 'neutral'}>{membership.status}</Badge>
      </div>

      <div style={styles.card}>
        <div style={styles.field}><span style={styles.label}>Plan</span><span style={styles.value}>{membership.plan_name}</span></div>
        <div style={styles.field}><span style={styles.label}>Type</span><span style={styles.value}>{membership.plan_type}</span></div>
        <div style={styles.field}><span style={styles.label}>Start Date</span><span style={styles.value}>{new Date(membership.start_date).toLocaleDateString()}</span></div>
        {membership.next_billing_date && <div style={styles.field}><span style={styles.label}>Next Billing</span><span style={styles.value}>{new Date(membership.next_billing_date).toLocaleDateString()}</span></div>}
        <div style={styles.field}><span style={styles.label}>Credit Balance</span><span style={styles.value}>{membership.credit_balance}</span></div>
      </div>

      <div style={styles.actions}>
        {membership.status === 'active' && <Button onClick={handlePause}>Pause</Button>}
        {membership.status === 'paused' && <Button onClick={handleResume}>Resume</Button>}
        {membership.status === 'active' && <Button onClick={handleCancel}>Cancel Membership</Button>}
      </div>

      {credits.length > 0 && (
        <>
          <h2 style={{ ...styles.title, fontSize: 'var(--font-size-lg)', marginTop: 'var(--space-xl)' }}>Credit History</h2>
          <div style={styles.card}>
            {credits.slice(0, 20).map((c: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{c.description || c.type}</span>
                <span style={{ fontWeight: 600 }}>{c.amount > 0 ? '+' : ''}{c.amount}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  field: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  value: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 500 as any },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' },
};
