import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as reportsApi from '../api/reports';

export function ScheduledReports() {
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
    } catch { alert('Failed to create scheduled report'); }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/reports')}>← Back to Reports</button>
      <div style={styles.header}>
        <h1 style={styles.title}>Scheduled Reports</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancel' : 'New Schedule'}</Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.card}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>Report Type</label>
              <select style={styles.input} value={form.report_type} onChange={(e) => setForm({ ...form, report_type: e.target.value })}>
                <option value="revenue">Revenue</option>
                <option value="bookings">Bookings</option>
                <option value="memberships">Memberships</option>
                <option value="staff">Staff</option>
                <option value="customers">Customers</option>
                <option value="financial">Financial</option>
              </select>
            </div>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>Frequency</label>
              <select style={styles.input} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Recipients (comma-separated emails)</label>
            <input style={styles.input} value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
          </div>
          <Button type="submit">Create Schedule</Button>
        </form>
      )}

      {loading ? <p style={styles.loading}>Loading...</p> : reports.length === 0 ? (
        <p style={styles.loading}>No scheduled reports configured.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {reports.map((r: any) => (
            <div key={r.id} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.name}</span>
                <Badge variant={r.active !== false ? 'success' : 'neutral'}>{r.active !== false ? 'Active' : 'Inactive'}</Badge>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {r.report_type} · {r.frequency}{r.next_run ? ` · Next: ${new Date(r.next_run).toLocaleDateString()}` : ''}
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
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
