import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as marketingApi from '../api/marketing';

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      marketingApi.getCampaign(id),
      marketingApi.getCampaignAnalytics(id).catch(() => null),
    ]).then(([c, a]) => { setCampaign(c); setAnalytics(a); }).finally(() => setLoading(false));
  }, [id]);

  const handleSend = async () => {
    if (!id || !confirm('Send this campaign now?')) return;
    try {
      await marketingApi.sendCampaign(id);
      setCampaign({ ...campaign, status: 'sent' });
    } catch { alert('Send failed'); }
  };

  if (loading) return <div style={styles.page}><p>Loading...</p></div>;
  if (!campaign) return <div style={styles.page}><p>Campaign not found.</p></div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/marketing')}>← Back to Marketing</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{campaign.name}</h1>
        <Badge variant={campaign.status === 'sent' ? 'success' : campaign.status === 'draft' ? 'neutral' : 'info'}>{campaign.status}</Badge>
      </div>

      <div style={styles.card}>
        <div style={styles.field}><span style={styles.label}>Channel</span><span style={styles.value}>{campaign.channel}</span></div>
        <div style={styles.field}><span style={styles.label}>Subject</span><span style={styles.value}>{campaign.subject}</span></div>
        {campaign.created_at && <div style={styles.field}><span style={styles.label}>Created</span><span style={styles.value}>{new Date(campaign.created_at).toLocaleDateString()}</span></div>}
      </div>

      {campaign.status === 'draft' && (
        <div style={styles.actions}>
          <Button onClick={handleSend}>Send Now</Button>
        </div>
      )}

      {analytics && (
        <>
          <h2 style={{ ...styles.title, fontSize: 'var(--font-size-lg)', marginTop: 'var(--space-xl)' }}>Analytics</h2>
          <div style={styles.card}>
            {Object.entries(analytics).map(([key, val]) => (
              <div key={key} style={styles.field}>
                <span style={styles.label}>{key.replace(/_/g, ' ')}</span>
                <span style={styles.value}>{String(val)}</span>
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
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  value: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 500 as any },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' },
};
