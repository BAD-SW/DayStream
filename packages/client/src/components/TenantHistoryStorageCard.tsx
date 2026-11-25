import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../utils/format';
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
  const { t } = useTranslation('tenantOps');
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
    if (!Number.isInteger(m) || m < 1 || m > 120) { setMessage({ text: t('history.monthsInvalid'), error: true }); return; }
    setSaving(true); setMessage(null);
    try { show(await bookingsApi.saveHistoryStorage({ scheduleTime: time, scheduleTimezone: tz, enabled, months: m })); setMessage({ text: t('history.saved'), error: false }); }
    catch (err) { setMessage({ text: errText(err, t('history.saveFailed')), error: true }); }
    finally { setSaving(false); }
  };

  const handleRunNow = async () => {
    setRunning(true); setMessage(null);
    try {
      const r = await bookingsApi.runHistoryStorageNow();
      setMessage({
        text: r.archived === 0 && r.failed === 0
          ? t('history.nothingToMove')
          : r.failed
            ? t('history.movedWithFailed', { count: r.archived, entries: r.entries, failed: r.failed })
            : t('history.moved', { count: r.archived, entries: r.entries }),
        error: r.failed > 0,
      });
      show(await bookingsApi.getHistoryStorage());
    } catch (err) { setMessage({ text: errText(err, t('history.runFailed')), error: true }); }
    finally { setRunning(false); }
  };

  if (loading) return null;
  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>{t('history.title')}</h3>
      <p style={styles.subtext}>{t('history.subtitle')}</p>
      {message && <div style={{ ...styles.message, color: message.error ? 'var(--color-error)' : 'var(--color-success)' }} role="status">{message.text}</div>}
      <div style={styles.section}>
        <div style={styles.row}>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-time">{t('schedule.runTime')}</label>
            <input id="history-storage-time" style={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-tz">{t('schedule.timezone')}</label>
            <select id="history-storage-tz" style={styles.input} value={tz} onChange={(e) => setTz(e.target.value)}>
              {!TIMEZONES.some((zone) => zone.value === tz) && <option value={tz}>{tz}</option>}
              {TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
            </select>
          </div>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="history-storage-months">{t('history.moveAfter')}</label>
            <input id="history-storage-months" style={styles.input} type="number" min={1} max={120} step={1} value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
        </div>
        <div style={styles.group}>
          <label style={{ ...styles.label, display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('schedule.enabled')}
          </label>
        </div>
        {schedule && (
          <p style={styles.subtext}>
            {t('schedule.nextRun', { date: schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : '—' })}
            {schedule.lastRunAt && ` · ${t('schedule.lastRun', { date: formatDateTime(schedule.lastRunAt), status: schedule.lastRunStatus ? t(`schedule.runStatus.${schedule.lastRunStatus}`, { defaultValue: schedule.lastRunStatus }) : '—' })}`}
            {` · ${t('history.counts', { count: schedule.inTable, archived: schedule.archived })}`}
          </p>
        )}
        {schedule?.lastError && <p style={{ ...styles.subtext, color: 'var(--color-error)' }}>{t('history.lastError', { error: schedule.lastError })}</p>}
      </div>
      <div style={styles.actions}>
        <Button onClick={handleSave} loading={saving}>{t('schedule.save')}</Button>
        <Button variant="outline" onClick={handleRunNow} loading={running}>{t('schedule.runNow')}</Button>
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
