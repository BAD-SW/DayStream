import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as staffApi from '../api/staff';

export function StaffCreate() {
  const { t } = useTranslation('staff');
  const navigate = useNavigate();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    mobile_phone: '',
    employment_type: 'full_time',
    role: 'technician',
    hire_date: '',
    bio: '',
    languages: '',
    show_on_directory: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name) {
      setError(t('create.errNameRequired'));
      return;
    }
    if (!form.email) {
      setError(t('create.errEmailRequired'));
      return;
    }
    if (!form.password || form.password.length < 8) {
      setError(t('create.errPasswordShort'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const businessId = localStorage.getItem('business_id') || '';
      const staff = await staffApi.createStaff({ ...form, business_id: businessId });
      navigate(`/staff/${staff.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || t('create.errFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=staff')}>{t('create.back')}</button>
      <h1 style={styles.title}>{t('create.title')}</h1>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} autoComplete="off">
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>{t('create.personalInfo')}</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.firstName')}</label>
              <input style={styles.input} value={form.first_name} autoComplete="off"
                onChange={(e) => updateField('first_name', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.lastName')}</label>
              <input style={styles.input} value={form.last_name} autoComplete="off"
                onChange={(e) => updateField('last_name', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.email')}</label>
              <input type="email" style={styles.input} value={form.email} autoComplete="new-email"
                onChange={(e) => updateField('email', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.mobilePhone')}</label>
              <input style={styles.input} value={form.mobile_phone} autoComplete="off"
                onChange={(e) => updateField('mobile_phone', e.target.value)} placeholder={t('create.optional')} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.languages')}</label>
              <input style={styles.input} value={form.languages} autoComplete="off"
                onChange={(e) => updateField('languages', e.target.value)} placeholder={t('create.languagesPlaceholder')} />
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>{t('create.accountRole')}</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.password')}</label>
              <input type="password" style={styles.input} value={form.password} autoComplete="new-password"
                onChange={(e) => updateField('password', e.target.value)} placeholder={t('create.passwordPlaceholder')} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.role')}</label>
              <select style={styles.input} value={form.role}
                onChange={(e) => updateField('role', e.target.value)}>
                {staffApi.STAFF_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                {staffApi.STAFF_ROLE_OPTIONS.find((o) => o.value === form.role)?.hint}
              </span>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.employmentType')}</label>
              <select style={styles.input} value={form.employment_type}
                onChange={(e) => updateField('employment_type', e.target.value)}>
                <option value="full_time">{t('employment.full_time')}</option>
                <option value="part_time">{t('employment.part_time')}</option>
                <option value="contractor">{t('employment.contractor')}</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.hireDate')}</label>
              <input type="date" style={styles.input} value={form.hire_date}
                onChange={(e) => updateField('hire_date', e.target.value)} />
              <span style={styles.helper}>{t('create.optional')}</span>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>{t('create.publicProfile')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('create.bio')}</label>
              <textarea style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }} value={form.bio}
                onChange={(e) => updateField('bio', e.target.value)} placeholder={t('create.bioPlaceholder')} />
            </div>
            <div style={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.show_on_directory}
                  onChange={(e) => updateField('show_on_directory', e.target.checked)} style={{ width: '16px', height: '16px' }} />
                {t('create.showOnDirectory')}
              </label>
            </div>
          </div>
        </div>

        <div style={styles.actions}>
          <Button variant="secondary" type="button" onClick={() => navigate('/business?tab=staff')}>{t('common:cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? t('create.creating') : t('create.submit')}</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)', marginTop: 'var(--space-sm)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' },
};
