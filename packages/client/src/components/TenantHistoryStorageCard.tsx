import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { TIMEZONES } from '../utils/timezones';
import * as bookingsApi from '../api/bookings';
import type { HistoryStorageSchedule } from '../api/bookings';

/**
 * TenantHistoryStorageCard — when long-past appointment history moves from the database to file
 * storage (spec 51, gap 18). One run per tenant, for all its businesses, at a time the tenant
 * chooses in its own time zone, so it never runs during a business's opening hours. A PROCESS,
 * on the tenant Processes page beside the billing run.
 */
export function TenantHistoryStorageCard() {
  const [time, setTime] = useState('03:00');
  const [tz, setTz] = useState('UTC');
  const [months, setMonths] = useState('12');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState<HistoryStorageSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const show = (s: HistoryStorageSchedule) => {
    setSchedule(s); setTime(s.scheduleTime); setTz(s.scheduleTimezone); setMonths(String(s.months)); setEnabled(s.enabled);
  };
  useEffect(() => {
    bookingsApi.getHistoryStorage().then(show).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const errText = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const handleSave = async () => {
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1 || m > 120) { setMessage({ text: 'Enter a whole number of months from 1 to 120.', error: true }); return; }
    setSaving(true); setMessage(null);
    try { show(await bookingsApi.saveHistoryStorage({ scheduleTime: time, scheduleTimezone: tz, enabled, months: m })); setMessage({ text: 'Schedule saved.', error: false }); }
    catch (err) { setMessage({ text: errText(err, 'Failed to save the schedule'), error: true }); }
    finally { setSaving(false); }
  };

  const handleRunNow = async () => {
    setRunning(true); setMessage(null);
    try {
      const r = await bookingsApi.runHistoryStorageNow();
      setMessage({
        text: r.archived === 0 && r.failed === 0
          ? 'Nothing to move: no appointment is old enough yet.'
          : `Moved the history of ${r.archived} appointment${r.archived === 1 ? '' : 's'} (${r.entries} entries)${r.failed ? `; ${r.failed} could not be moved and will be tried again` : ''}.`,
        error: r.failed > 0,
      });
      show(await bookingsApi.getHistoryStorage());
    } catch (err) { setMessage({ text: errText(err, 'Failed to run'), error: true }); }
    finally { setRunning(false); }
  };

  if (loading) return null;
  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>Appointment History Storage</h3>
      <p style={styles.subtext}>
        Each appointment&apos;s history (who changed what, and when) is kept in the database while it is recent. Once an
        appointment is long past, its history moves to file storage, so the database does not keep growing. It still shows
        on the appointment as before. One daily run for all your businesses, at a quiet time in your time zone.
      </p>
      {message && <div style={{ ...styles.message, color: message.error ? 'var(--color-error)' : 'var(--color-success)' }} role="status">{message.text}</div>}
      <div style={styles.section}>
        <div style={styles.row}>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-time">Run time</label>
            <input id="history-storage-time" style={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-tz">Timezone</label>
            <select id="history-storage-tz" style={styles.input} value={tz} onChange={(e) => setTz(e.target.value)}>
              {!TIMEZONES.some((t) => t.value === tz) && <option value={tz}>{tz}</option>}
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-months">Move after (months)</label>
            <input id="history-storage-months" style={styles.input} type="number" min={1} max={120} step={1} value={months} onChange={(e) => setMonths(e.target.value)} />
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
            {schedule.lastRunAt && ` · Last run: ${new Date(schedule.lastRunAt).toLocaleString()} (${schedule.lastRunStatus || '—'})`}
            {` · ${schedule.inTable} appointment${schedule.inTable === 1 ? '' : 's'} with history in the database, ${schedule.archived} in file storage`}
          </p>
        )}
        {schedule?.lastError && <p style={{ ...styles.subtext, color: 'var(--color-error)' }}>Last error: {schedule.lastError}</p>}
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
  title: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'], margin: '0 0 var(--space-xs)', color: 'var(--color-text)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' },
  message: { fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm)' },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  row: { display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '180px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'], color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' },
};
