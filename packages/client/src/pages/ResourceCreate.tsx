import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as resourcesApi from '../api/resources';

const RESOURCE_CATEGORIES = ['room', 'equipment', 'facility'];

export function ResourceCreate() {
  const { t } = useTranslation('setup');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    capacity: 1,
    buffer_minutes: 0,
    is_24_7: false,
  });

  const handleChange = (field: string, value: any) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.category) { setError(t('resourceCreate.errCategoryRequired')); return; }
    const businessId = localStorage.getItem('business_id') || '';
    if (!businessId) { setError(t('resourceCreate.errNoBusiness')); return; }
    setLoading(true);
    setError('');
    try {
      const resource = await resourcesApi.createResource({ ...form, business_id: businessId });
      navigate(`/resources/${resource.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || t('resourceCreate.errFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=resources')}>{t('resourceCreate.back')}</button>
      <h1 style={styles.title}>{t('resourceCreate.title')}</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>{t('resourceCreate.name')}</label>
          <input style={styles.input} value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>{t('resourceCreate.description')}</label>
          <textarea style={{ ...styles.input, minHeight: '80px' }} value={form.description} onChange={(e) => handleChange('description', e.target.value)} />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('resourceCreate.category')}</label>
            <select style={styles.input} value={form.category} onChange={(e) => handleChange('category', e.target.value)} required>
              <option value="">{t('resourceCreate.select')}</option>
              {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`resources.category_${c}`)}</option>)}
            </select>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('resourceCreate.capacity')}</label>
            <input style={styles.input} type="number" min={1} value={form.capacity} onChange={(e) => handleChange('capacity', Number(e.target.value))} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('resourceCreate.buffer')}</label>
            <input style={styles.input} type="number" min={0} value={form.buffer_minutes} onChange={(e) => handleChange('buffer_minutes', Number(e.target.value))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', alignSelf: 'end', paddingBottom: '10px' }}>
            <input type="checkbox" checked={form.is_24_7} onChange={(e) => handleChange('is_24_7', e.target.checked)} />
            {t('resourceCreate.available247')}
          </label>
        </div>
        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/business?tab=resources')}>{t('common:cancel')}</Button>
          <Button type="submit" disabled={loading}>{loading ? t('resourceCreate.creating') : t('resourceCreate.submit')}</Button>
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
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
