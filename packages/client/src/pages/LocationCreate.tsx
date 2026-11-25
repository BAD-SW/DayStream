import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as locationsApi from '../api/locations';

export function LocationCreate() {
  const { t } = useTranslation('setup');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    timezone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
    description: '',
  });

  const businessId = localStorage.getItem('business_id') || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('locationCreate.errNameRequired')); return; }
    if (!businessId) { setError(t('locationCreate.errNoBusiness')); return; }

    setLoading(true);
    setError('');
    try {
      const loc = await locationsApi.createLocation({ ...form, business_id: businessId });
      navigate(`/settings/locations/${loc.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || t('locationCreate.errFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=locations')}>{t('locationCreate.back')}</button>
      <h1 style={styles.title}>{t('locationCreate.title')}</h1>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.formGrid}>
          <FormField label={t('locationCreate.name')} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <FormField label={t('locationCreate.phone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <FormField label={t('locationCreate.email')} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <FormField label={t('locationCreate.timezone')} value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} placeholder={t('locationCreate.timezonePlaceholder')} />
          <FormField label={t('locationCreate.addressLine1')} value={form.address_line1} onChange={(v) => setForm({ ...form, address_line1: v })} span2 />
          <FormField label={t('locationCreate.addressLine2')} value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} span2 />
          <FormField label={t('locationCreate.city')} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
          <FormField label={t('locationCreate.stateProvince')} value={form.state_province} onChange={(v) => setForm({ ...form, state_province: v })} />
          <FormField label={t('locationCreate.postalCode')} value={form.postal_code} onChange={(v) => setForm({ ...form, postal_code: v })} />
          <FormField label={t('locationCreate.country')} value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={styles.label}>{t('locationCreate.description')}</label>
            <textarea
              style={{ ...styles.input, minHeight: '80px' }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
        <div style={styles.formActions}>
          <Button type="button" variant="outline" onClick={() => navigate('/business?tab=locations')}>{t('common:cancel')}</Button>
          <Button type="submit" disabled={loading}>{loading ? t('locationCreate.creating') : t('locationCreate.submit')}</Button>
        </div>
      </form>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, span2 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; span2?: boolean;
}) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : {}}>
      <label style={styles.label}>{label}</label>
      <input style={styles.input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '700px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' },
  formActions: { display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any, display: 'block', marginBottom: '2px' },
  input: { width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', boxSizing: 'border-box' as const },
};
