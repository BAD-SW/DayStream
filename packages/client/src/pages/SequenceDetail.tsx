import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as marketingApi from '../api/marketing';

export function SequenceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sequence, setSequence] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      marketingApi.getSequence(id),
      marketingApi.getSequenceEnrollments(id).catch(() => []),
    ]).then(([s, e]) => { setSequence(s); setEnrollments(e); }).finally(() => setLoading(false));
  }, [id]);

  const handleActivate = async () => {
    if (!id) return;
    try {
      const updated = await marketingApi.activateSequence(id);
      setSequence(updated);
    } catch { alert('Activation failed'); }
  };

  const handlePause = async () => {
    if (!id) return;
    try {
      const updated = await marketingApi.pauseSequence(id);
      setSequence(updated);
    } catch { alert('Pause failed'); }
  };

  if (loading) return <div style={styles.page}><p>Loading...</p></div>;
  if (!sequence) return <div style={styles.page}><p>Sequence not found.</p></div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/marketing')}>← Back to Marketing</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{sequence.name}</h1>
        <Badge variant={sequence.status === 'active' ? 'success' : sequence.status === 'paused' ? 'warning' : 'neutral'}>{sequence.status}</Badge>
      </div>

      <div style={styles.card}>
        <div style={styles.field}><span style={styles.label}>Trigger</span><span style={styles.value}>{sequence.trigger_type}</span></div>
        {sequence.description && <div style={styles.field}><span style={styles.label}>Description</span><span style={styles.value}>{sequence.description}</span></div>}
        {sequence.steps && <div style={styles.field}><span style={styles.label}>Steps</span><span style={styles.value}>{sequence.steps.length || 0}</span></div>}
      </div>

      <div style={styles.actions}>
        {sequence.status !== 'active' && <Button onClick={handleActivate}>Activate</Button>}
        {sequence.status === 'active' && <Button onClick={handlePause}>Pause</Button>}
      </div>

      {enrollments.length > 0 && (
        <>
          <h2 style={{ ...styles.title, fontSize: 'var(--font-size-lg)', marginTop: 'var(--space-xl)' }}>Enrollments</h2>
          <div style={styles.card}>
            {enrollments.slice(0, 20).map((e: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{e.customer_name || e.customer_id?.slice(0, 8)}</span>
                <Badge variant={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Badge>
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
