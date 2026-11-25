import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as reportsApi from '../api/reports';
import { formatDate } from '../utils/format';

// Stored report types and frequencies, shown through reports:scheduled.type.<value> and .frequency.<value>.
const REPORT_TYPES = ['revenue', 'bookings', 'memberships', 'staff', 'customers', 'financial'];
const FREQUENCIES = ['daily', 'weekly', 'monthly'];

export function ScheduledReports() {
  const { t } = useTranslation('reports');
  const typeLabel = (v: string) => (REPORT_TYPES.includes(v) ? t(`scheduled.type.${v}`) : v);
  const frequencyLabel = (v: string) => (FREQUENCIES.includes(v) ? t(`scheduled.frequency.${v}`) : v);
  const navigate = useNavigate();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', report_type: 'revenue', frequency: 'weekly', recipients: '' });

  useEffect(() => {
    reportsApi.getScheduledReports().then(setReports).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await reportsApi.createScheduledReport({
        ...form,
        recipients: form.recipients.split(',').map((r) => r.trim()).filter(Boolean),
      });
      setReports([...reports, created]);
      setShowCreate(false);
      setForm({ name: '', report_type: 'revenue', frequency: 'weekly', recipients: '' });
    } catch { void showMessage({ message: t('scheduled.createFailed'), tone: 'error' }); }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/reports')}>{t('view.backArrow')}</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('scheduled.title')}</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? t('common:cancel') : t('scheduled.new')}</Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.card}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('scheduled.name')}</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>{t('scheduled.reportType')}</label>
              <select style={styles.input} value={form.report_type} onChange={(e) => setForm({ ...form, report_type: e.target.value })}>
                {REPORT_TYPES.map((v) => <option key={v} value={v}>{t(`scheduled.typeOption.${v}`)}</option>)}
              </select>
            </div>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>{t('scheduled.frequencyLabel')}</label>
              <select style={styles.input} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {FREQUENCIES.map((v) => <option key={v} value={v}>{t(`scheduled.frequencyOption.${v}`)}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('scheduled.recipients')}</label>
            <input style={styles.input} value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
          </div>
          <Button type="submit">{t('scheduled.create')}</Button>
        </form>
      )}

      {loading ? <p style={styles.loading}>{t('common:loading')}</p> : reports.length === 0 ? (
        <p style={styles.loading}>{t('scheduled.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {reports.map((r: any) => (
            <div key={r.id} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.name}</span>
                <Badge variant={r.active !== false ? 'success' : 'neutral'}>{r.active !== false ? t('scheduled.active') : t('scheduled.inactive')}</Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                {typeLabel(r.report_type)} · {frequencyLabel(r.frequency)}{r.next_run ? ` · ${t('scheduled.next', { date: formatDate(r.next_run) })}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
