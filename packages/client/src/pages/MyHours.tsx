import { useState, useEffect, useCallback } from 'react';
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

const EVENT_LABEL: Record<ClockEventType, string> = {
  clock_in: 'Clock In',
  break_start: 'Start Break',
  break_end: 'End Break',
  clock_out: 'Clock Out',
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

export function MyHours() {
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
      setErrorMsg('Failed to load your clock records.');
      setEvents([]); setHours([]);
    } finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const totalWorked = hours.reduce((s, d) => s + d.worked_minutes, 0);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Hours</h1>
        <p style={styles.subtitle}>Your own clock entries. To correct an entry, speak to your manager.</p>
      </div>

      <div style={styles.toolbar}>
        <input type="date" style={styles.select} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        <input type="date" style={styles.select} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
      </div>

      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      {/* Daily hours summary */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>Daily Hours {hours.length > 0 && <span style={styles.muted}>· total {fmtMinutes(totalWorked)}</span>}</div>
        {loading ? <p style={styles.muted}>Loading…</p> : hours.length === 0 ? (
          <p style={styles.muted}>No clocked hours in this range.</p>
        ) : (
          <Table
            rowId={(d: DayHours) => d.date}
            data={hours}
            clientSort
            columns={[
              { key: 'date', header: 'Date', sortable: true, filter: 'date' as const },
              { key: 'worked_minutes', header: 'Worked', sortable: true, filterLabel: (v: string) => fmtMinutes(Number(v)), render: (v: number) => fmtMinutes(v) },
              { key: 'break_minutes', header: 'Break', sortable: true, filterLabel: (v: string) => fmtMinutes(Number(v)), render: (v: number) => fmtMinutes(v) },
            ]}
          />
        )}
      </div>

      {/* Punches (read-only) */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>Punches</div>
        {loading ? <p style={styles.muted}>Loading…</p> : events.length === 0 ? (
          <p style={styles.muted}>No punches in this range.</p>
        ) : (
          <Table
            rowId={(ev: ClockEvent) => ev.id}
            data={events}
            clientSort
            columns={[
              { key: 'event_at', header: 'When', sortable: true, filter: 'date' as const, render: (v: string) => new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) },
              { key: 'event_type', header: 'Event', sortable: true, filterLabel: (v: string) => EVENT_LABEL[v as ClockEventType] || v, render: (v: ClockEventType) => EVENT_LABEL[v] },
              { key: 'source', header: 'Source', sortable: true, filterLabel: (v: string) => (v === 'manual' ? 'Manual' : 'Clock'), render: (v: string) => (v === 'manual' ? 'Manual' : 'Clock') },
              { key: 'note', header: 'Note', sortable: true, render: (v: string) => v || '—' },
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
