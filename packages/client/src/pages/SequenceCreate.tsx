import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as marketingApi from '../api/marketing';

export function SequenceCreate() {
  const { t } = useTranslation('marketing');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    trigger_type: 'manual',
    description: '',
  });

  const businessId = localStorage.getItem('business_id') || '';

  const handleChange = (field: string, value: string) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) { setError(t('campaign.noBusiness')); return; }
    setLoading(true);
    setError('');
    try {
      const sequence = await marketingApi.createSequence({ ...form, business_id: businessId });
      navigate(`/marketing/sequences/${sequence.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || t('sequence.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/marketing')}>{t('page.back')}</button>
      <h1 style={styles.title}>{t('sequence.createTitle')}</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>{t('sequence.name')}</label>
          <input style={styles.input} value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>{t('sequence.triggerType')}</label>
          <select style={styles.input} value={form.trigger_type} onChange={(e) => handleChange('trigger_type', e.target.value)}>
            <option value="manual">{t('sequence.triggerManual')}</option>
            <option value="event">{t('sequence.triggerEvent')}</option>
            <option value="segment">{t('sequence.triggerSegment')}</option>
            <option value="date">{t('sequence.triggerDate')}</option>
          </select>
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>{t('sequence.description')}</label>
          <textarea style={{ ...styles.input, minHeight: '80px' }} value={form.description} onChange={(e) => handleChange('description', e.target.value)} />
        </div>
        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/marketing')}>{t('common:cancel')}</Button>
          <Button type="submit" disabled={loading}>{loading ? t('campaign.creating') : t('sequence.createTitle')}</Button>
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
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
