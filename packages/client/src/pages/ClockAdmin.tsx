import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { getStaffList } from '../api/staff';
import { useContextManager } from '../context/ContextManager';
import * as clockApi from '../api/clock';
import type { ClockEvent, ClockEventType, DayHours } from '../api/clock';

/**
 * Clock Admin — manager/owner view of staff clock records. Pick a staff member
 * and date range to see their punches and computed daily hours (net of breaks),
 * add a missed punch, edit a prior correction, delete an entry, or set/reset the
 * staff member's clock PIN. All corrections are recorded as manual events with
 * an audit trail (created_by). Only manual events can be edited; live punches
 * can be deleted but not altered in place.
 */

const EVENT_LABEL: Record<ClockEventType, string> = {
  clock_in: 'Clock In',
  break_start: 'Start Break',
  break_end: 'End Break',
  clock_out: 'Clock Out',
};

interface StaffRow {
  id: string;              // stf_profiles.id
  linked_user_id: string | null;
  first_name: string;
  last_name: string;
  staff_ref: string;
}

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

export function ClockAdmin() {
  // Use the active context, not localStorage: the stored business_id can be
  // empty or stale and point at a different business than the one on screen.
  const businessId = useContextManager().activeContext.businessId || '';

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffRow | null>(null);
  const [start, setStart] = useState(isoDaysAgo(13));
  const [end, setEnd] = useState(isoToday());

  const [events, setEvents] = useState<ClockEvent[]>([]);
  const [hours, setHours] = useState<DayHours[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Add-event form
  const [newType, setNewType] = useState<ClockEventType>('clock_in');
  const [newAt, setNewAt] = useState('');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  // PIN form
  const [pinValue, setPinValue] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  // Load staff for the picker
  useEffect(() => {
    if (!businessId) return;
    getStaffList({ business_id: businessId, status: 'active' })
      .then((res) => {
        const rows: StaffRow[] = (res.data || []).filter((s: any) => s.linked_user_id);
        setStaff(rows);
        if (rows.length > 0) setSelectedStaff(rows[0]);
      })
      .catch(() => setStaff([]));
  }, [businessId]);

  const load = useCallback(async () => {
    if (!selectedStaff?.linked_user_id || !start || !end || start > end) { setEvents([]); setHours([]); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ev, hr] = await Promise.all([
        clockApi.getClockEvents(businessId, selectedStaff.linked_user_id, start, end),
        clockApi.getClockHours(businessId, selectedStaff.linked_user_id, start, end),
      ]);
      setEvents(ev);
      setHours(hr);
    } catch {
      setErrorMsg('Failed to load clock records.');
      setEvents([]); setHours([]);
    } finally { setLoading(false); }
  }, [businessId, selectedStaff, start, end]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStaff?.linked_user_id || !newAt) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await clockApi.createClockEvent({
        business_id: businessId,
        user_id: selectedStaff.linked_user_id,
        event_type: newType,
        event_at: new Date(newAt).toISOString(),
        note: newNote || undefined,
      });
      setNewAt(''); setNewNote('');
      await load();
    } catch { setErrorMsg('Failed to add entry.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(ev: ClockEvent) {
    if (!confirm(`Delete this ${EVENT_LABEL[ev.event_type]} entry?`)) return;
    try { await clockApi.deleteClockEvent(ev.id, businessId); await load(); }
    catch { setErrorMsg('Failed to delete entry.'); }
  }

  async function handleSetPin() {
    if (!selectedStaff) return;
    if (!/^\d{4}$/.test(pinValue)) { setPinMsg('PIN must be exactly 4 digits.'); return; }
    setPinMsg(null);
    try {
      await clockApi.setClockPin(selectedStaff.id, businessId, pinValue);
      setPinValue('');
      setPinMsg('PIN updated.');
    } catch { setPinMsg('Failed to set PIN.'); }
  }

  const totalWorked = hours.reduce((s, d) => s + d.worked_minutes, 0);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Time Clock — Records & Corrections</h1>
      </div>

      <div style={styles.toolbar}>
        <select
          style={styles.select}
          value={selectedStaff?.id || ''}
          onChange={(e) => setSelectedStaff(staff.find((s) => s.id === e.target.value) || null)}
        >
          {staff.length === 0 && <option value="">No staff with accounts</option>}
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.staff_ref})</option>
          ))}
        </select>
        <input type="date" style={styles.select} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        <input type="date" style={styles.select} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
      </div>

      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      {/* PIN management */}
      {selectedStaff && (
        <div style={styles.pinRow}>
          <span style={styles.pinLabel}>Set clock PIN for {selectedStaff.first_name}:</span>
          <input
            style={{ ...styles.select, width: '120px' }}
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            type="password"
            placeholder="4 digits"
          />
          <Button size="sm" variant="outline" onClick={handleSetPin} disabled={pinValue.length !== 4}>Set PIN</Button>
          {pinMsg && <span style={styles.pinMsg}>{pinMsg}</span>}
        </div>
      )}

      {/* Daily hours summary */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>Daily Hours {hours.length > 0 && <span style={styles.muted}>· total {fmtMinutes(totalWorked)}</span>}</div>
        {loading ? <p style={styles.muted}>Loading…</p> : hours.length === 0 ? (
          <p style={styles.muted}>No clocked hours in this range.</p>
        ) : (
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Date</th><th style={styles.th}>Worked</th><th style={styles.th}>Break</th></tr></thead>
            <tbody>
              {hours.map((d) => (
                <tr key={d.date}>
                  <td style={styles.td}>{d.date}</td>
                  <td style={styles.td}>{fmtMinutes(d.worked_minutes)}</td>
                  <td style={styles.td}>{fmtMinutes(d.break_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Events + corrections */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>Punches</div>
        {events.length === 0 ? (
          <p style={styles.muted}>No punches in this range.</p>
        ) : (
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>When</th><th style={styles.th}>Event</th><th style={styles.th}>Source</th><th style={styles.th}>Note</th><th style={styles.th}></th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td style={styles.td}>{new Date(ev.event_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={styles.td}>{EVENT_LABEL[ev.event_type]}</td>
                  <td style={styles.td}>{ev.source === 'manual' ? 'Manual' : 'Clock'}</td>
                  <td style={styles.td}>{ev.note || '—'}</td>
                  <td style={styles.td}>
                    <button style={styles.linkBtn} onClick={() => handleDelete(ev)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add a missed punch */}
        {selectedStaff && (
          <form onSubmit={handleAdd} style={styles.addForm}>
            <span style={styles.addLabel}>Add entry:</span>
            <select style={styles.select} value={newType} onChange={(e) => setNewType(e.target.value as ClockEventType)}>
              {(Object.keys(EVENT_LABEL) as ClockEventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_LABEL[t]}</option>
              ))}
            </select>
            <input type="datetime-local" style={styles.select} value={newAt} onChange={(e) => setNewAt(e.target.value)} required />
            <input type="text" style={{ ...styles.select, flex: 1 }} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Note (optional)" />
            <Button type="submit" size="sm" loading={saving} disabled={!newAt}>Add</Button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)' },
  pinRow: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  pinLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  pinMsg: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  cardHeader: { fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-base)', color: 'var(--color-text)', marginBottom: 'var(--space-sm)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left' as const, padding: '6px 10px', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text-secondary)', borderBottom: '2px solid var(--color-border)' },
  td: { padding: '6px 10px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-error, #C4291C)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
  addForm: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: 'var(--space-md)', flexWrap: 'wrap' as const },
  addLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
