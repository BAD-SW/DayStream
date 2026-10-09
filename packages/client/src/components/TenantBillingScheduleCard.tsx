import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { TIMEZONES } from '../utils/timezones';
import * as payApi from '../api/payments';

/**
 * TenantBillingScheduleCard — the tenant's billing run schedule (B6) plus a manual
 * "Run now" trigger. The direct mirror of PlatformBillingScheduleCard one level
 * down: one schedule per tenant, charging that tenant's businesses. A PROCESS, so
 * it lives on the tenant Processes page, not under Settings.
 */
export function TenantBillingScheduleCard() {
  const [time, setTime] = useState('02:00');
  const [tz, setTz] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState<payApi.PlatformSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    payApi.getTenantSchedule()
      .then((s) => {
        if (s) { setSchedule(s); setTime(s.scheduleTime); setTz(s.scheduleTimezone); setEnabled(s.enabled); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      const s = await payApi.saveTenantSchedule(time, tz, enabled);
      setSchedule(s);
      setMessage('Billing run schedule saved.');
    } catch (err: any) { setMessage(err.response?.data?.error || 'Failed to save schedule'); }
    finally { setSaving(false); }
  };

  const handleRunNow = async () => {
    setRunning(true); setMessage(null);
    try {
      const r = await payApi.runTenantBillingNow();
      setMessage(`Run complete: ${r.newCharges} new, ${r.retries} retried, ${r.settled} settled, ${r.failed} failed, ${r.skippedSuspended} skipped.`);
      const s = await payApi.getTenantSchedule();
      if (s) setSchedule(s);
    } catch (err: any) { setMessage(err.response?.data?.error || 'Failed to run billing'); }
    finally { setRunning(false); }
  };

  if (loading) return null;

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>Business Billing Run</h3>
      <p style={styles.subtext}>The daily run that charges every business due that day. One schedule for this tenant.</p>
      {message && <div style={styles.message}>{message}</div>}
      <div style={styles.section}>
        <div style={styles.row}>
          <div style={styles.group}>
            <label style={styles.label}>Run time</label>
            <input style={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div style={styles.group}>
            <label style={styles.label}>Timezone</label>
            <select style={styles.input} value={tz} onChange={(e) => setTz(e.target.value)}>
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div style={styles.group}>
          <label style={{ ...styles.label, display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>
        {schedule && (
          <p style={styles.subtext}>
            Next run: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '—'}
            {schedule.lastRunAt && ` · Last run: ${new Date(schedule.lastRunAt).toLocaleString()} (${schedule.lastRunStatus})`}
          </p>
        )}
      </div>
      <div style={styles.actions}>
        <Button onClick={handleSave} loading={saving}>Save Schedule</Button>
        <Button variant="outline" onClick={handleRunNow} loading={running}>Run now</Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)', maxWidth: '720px' },
  title: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any, margin: '0 0 var(--space-xs)', color: 'var(--color-text)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' },
  message: { fontSize: 'var(--font-size-sm)', color: 'var(--color-success, #17794A)', margin: '0 0 var(--space-sm)' },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  row: { display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '200px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' },
};
