import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as marketingApi from '../api/marketing';
import * as customersApi from '../api/customers';
import type { Segment, AudienceSummary } from '../api/customers';

export function CampaignCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    subject: '',
    channel: 'email',
    content: '',
  });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentId, setSegmentId] = useState('');
  const [audience, setAudience] = useState<AudienceSummary | null>(null);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) return;
    customersApi.getSegments(businessId).then(setSegments).catch(() => setSegments([]));
  }, [businessId]);

  // Who in the chosen segment may be sent a marketing message on this channel.
  useEffect(() => {
    setAudience(null);
    if (!businessId || !segmentId) return;
    let cancelled = false;
    customersApi.getAudienceSummary(segmentId, businessId, form.channel)
      .then((a) => { if (!cancelled) setAudience(a); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [businessId, segmentId, form.channel]);

  const handleChange = (field: string, value: string) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) { setError('No business context.'); return; }
    if (!segmentId) { setError('Choose who this campaign goes to.'); return; }
    setLoading(true);
    setError('');
    try {
      const campaign = await marketingApi.createCampaign({ ...form, segmentId, business_id: businessId });
      navigate(`/marketing/campaigns/${campaign.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/marketing')}>← Back to Marketing</button>
      <h1 style={styles.title}>Create Campaign</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Campaign Name *</label>
          <input style={styles.input} value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Channel</label>
            <select style={styles.input} value={form.channel} onChange={(e) => handleChange('channel', e.target.value)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="push">Push Notification</option>
            </select>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Subject *</label>
            <input style={styles.input} value={form.subject} onChange={(e) => handleChange('subject', e.target.value)} required />
          </div>
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label} htmlFor="campaign-audience">Audience *</label>
          <select id="campaign-audience" style={styles.input} value={segmentId} onChange={(e) => setSegmentId(e.target.value)} required>
            <option value="">Choose a segment or fixed list…</option>
            {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}{seg.kind === 'static' ? ' (fixed list)' : ''}</option>)}
          </select>
          {segmentId && (
            <p style={styles.audience} aria-live="polite">
              {!audience && 'Checking the audience…'}
              {audience && (
                <>
                  <strong>{audience.willReceive} of {audience.total}</strong> {audience.total === 1 ? 'person' : 'people'} will receive it.
                  {audience.excludedByReason.length > 0 && (
                    <> Left out: {audience.excludedByReason.map((r) => `${r.label} (${r.count})`).join('; ')}.</>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Content *</label>
          <textarea style={{ ...styles.input, minHeight: '120px' }} value={form.content} onChange={(e) => handleChange('content', e.target.value)} required />
        </div>
        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/marketing')}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Campaign'}</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '700px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  audience: { margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
