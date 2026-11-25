import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay, formatDateTime } from '../utils/format';
import * as clockApi from '../api/clock';
import { Table } from '../design-system/components/data/Table';
import type { ClockEvent, ClockEventType, DayHours } from '../api/clock';

/**
 * MyHours — a read-only self-service view of the signed-in employee's own clock
 * records. Shows daily hours (net of breaks) and the underlying punches for a
 * date range. Deliberately has NO add/edit/delete controls: corrections are a
 * manager/owner capability (see ClockAdmin). The server endpoints are scoped to
 * the authenticated user, so this can only ever show the caller's own data.
 */

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }

export function MyHours() {
  const { t } = useTranslation('staff');
  const fmtMinutes = (mins: number): string => t('hours.hm', { h: Math.floor(mins / 60), m: Math.round(mins % 60) });
  const [start, setStart] = useState(isoDaysAgo(13));
  const [end, setEnd] = useState(isoToday());

  const [events, setEvents] = useState<ClockEvent[]>([]);
  const [hours, setHours] = useState<DayHours[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!start || !end || start > end) { setEvents([]); setHours([]); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ev, hr] = await Promise.all([
        clockApi.getMyClockEvents(start, end),
        clockApi.getMyClockHours(start, end),
      ]);
      setEvents(ev);
      setHours(hr);
    } catch {
      setErrorMsg(t('hours.errLoadMine'));
      setEvents([]); setHours([]);
    } finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const totalWorked = hours.reduce((s, d) => s + d.worked_minutes, 0);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('hours.myTitle')}</h1>
        <p style={styles.subtitle}>{t('hours.myIntro')}</p>
      </div>

      <div style={styles.toolbar}>
        <input type="date" style={styles.select} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        <input type="date" style={styles.select} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
      </div>

      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      {/* Daily hours summary */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>{t('hours.daily')} {hours.length > 0 && <span style={styles.muted}>{t('hours.total', { time: fmtMinutes(totalWorked) })}</span>}</div>
        {loading ? <p style={styles.muted}>{t('hours.loading')}</p> : hours.length === 0 ? (
          <p style={styles.muted}>{t('hours.noHours')}</p>
        ) : (
          <Table
            rowId={(d: DayHours) => d.date}
            data={hours}
            clientSort
            columns={[
              { key: 'date', header: t('hours.date'), sortable: true, filter: 'date' as const, render: (v: string) => formatDay(v) },
              { key: 'worked_minutes', header: t('hours.worked'), sortable: true, filterLabel: (v: string) => fmtMinutes(Number(v)), render: (v: number) => fmtMinutes(v) },
              { key: 'break_minutes', header: t('hours.break'), sortable: true, filterLabel: (v: string) => fmtMinutes(Number(v)), render: (v: number) => fmtMinutes(v) },
            ]}
          />
        )}
      </div>

      {/* Punches (read-only) */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>{t('hours.punches')}</div>
        {loading ? <p style={styles.muted}>{t('hours.loading')}</p> : events.length === 0 ? (
          <p style={styles.muted}>{t('hours.noPunches')}</p>
        ) : (
          <Table
            rowId={(ev: ClockEvent) => ev.id}
            data={events}
            clientSort
            columns={[
              { key: 'event_at', header: t('hours.when'), sortable: true, filter: 'date' as const, render: (v: string) => formatDateTime(v, undefined, { dateStyle: 'short', timeStyle: 'short' }) },
              { key: 'event_type', header: t('hours.event'), sortable: true, filterLabel: (v: string) => t(`clock.event.${v}`, { defaultValue: v }), render: (v: ClockEventType) => t(`clock.event.${v}`) },
              { key: 'source', header: t('hours.source'), sortable: true, filterLabel: (v: string) => (v === 'manual' ? t('hours.sourceManual') : t('hours.sourceClock')), render: (v: string) => (v === 'manual' ? t('hours.sourceManual') : t('hours.sourceClock')) },
              { key: 'note', header: t('hours.note'), sortable: true, render: (v: string) => v || '—' },
            ]}
          />
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  subtitle: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 'var(--space-xs) 0 0' },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  cardHeader: { fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-base)', color: 'var(--color-text)', marginBottom: 'var(--space-sm)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
