import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';

interface ScheduleEntry {
  id: string;
  staff_id: string;
  schedule_date: string;
  start_time: string;
  end_time: string;
  entry_type: string;
  notes: string | null;
  staff_first_name: string;
  staff_last_name: string;
}

interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  staff_ref: string;
}

function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getWeekDates(baseDate: Date): Date[] {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - ((day + 6) % 7));
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function Schedule() {
  const businessId = localStorage.getItem('business_id') || '';
  const [currentDate, setCurrentDate] = useState(new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ staff_id: '', schedule_date: '', start_time: '09:00', end_time: '17:00', entry_type: 'shift', notes: '' });
  const [saving, setSaving] = useState(false);

  const weekDates = getWeekDates(currentDate);
  const dateFrom = toDateStr(weekDates[0]);
  const dateTo = toDateStr(weekDates[6]);

  // Fetch locations on mount
  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/locations?business_id=${businessId}`).then((res) => {
      const locs = res.data.data || [];
      setLocations(locs);
      // Default to primary or first location
      const primary = locs.find((l: any) => l.is_primary);
      if (primary) setSelectedLocationId(primary.id);
      else if (locs.length > 0) setSelectedLocationId(locs[0].id);
    }).catch(() => {});
  }, [businessId]);

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [staffRes, entriesRes] = await Promise.all([
        apiClient.get(`/v1/schedule/staff?business_id=${businessId}`),
        apiClient.get(`/v1/schedule?business_id=${businessId}&date_from=${dateFrom}&date_to=${dateTo}`),
      ]);
      setStaff(staffRes.data.data || []);
      setEntries(entriesRes.data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const prevWeek = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); };
  const nextWeek = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); };
  const goToday = () => setCurrentDate(new Date());

  const handleAdd = async () => {
    if (!form.staff_id || !form.schedule_date || !form.start_time || !form.end_time) return;
    setSaving(true);
    try {
      await apiClient.post(`/v1/schedule?business_id=${businessId}`, form);
      setShowAdd(false);
      setForm({ staff_id: '', schedule_date: '', start_time: '09:00', end_time: '17:00', entry_type: 'shift', notes: '' });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add shift'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (entryId: string) => {
    if (!confirm('Remove this shift?')) return;
    await apiClient.delete(`/v1/schedule/${entryId}?business_id=${businessId}`);
    fetchData();
  };

  const getEntriesForCell = (staffId: string, date: string) => {
    return entries.filter((e) => e.staff_id === staffId && e.schedule_date.split('T')[0] === date);
  };

  const today = toDateStr(new Date());

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Schedule</h1>
        <div style={styles.nav}>
          <Button variant="secondary" size="sm" onClick={prevWeek}>← Prev</Button>
          <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          <Button variant="secondary" size="sm" onClick={nextWeek}>Next →</Button>
          <span style={styles.weekLabel}>
            {weekDates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {locations.length > 0 && (
            <select style={styles.input} value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}>
              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <Button variant="secondary" onClick={() => setShowAdd(true)}>Add Shift</Button>
        </div>
      </div>

      {showAdd && (
        <div style={styles.addForm}>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Staff *</label>
              <select style={styles.input} value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
                <option value="">Select...</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Date *</label>
              <input type="date" style={styles.input} value={form.schedule_date} onChange={(e) => setForm({ ...form, schedule_date: e.target.value })} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Start</label>
              <input type="time" style={styles.input} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>End</label>
              <input type="time" style={styles.input} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button size="sm" onClick={handleAdd} loading={saving}>Add</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p> : (
        <div style={styles.grid}>
          {/* Header row */}
          <div style={styles.gridHeader}>
            <div style={styles.staffCol}>Staff</div>
            {weekDates.map((d) => (
              <div key={toDateStr(d)} style={{ ...styles.dayCol, ...(toDateStr(d) === today ? styles.todayCol : {}) }}>
                <div style={styles.dayName}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div style={styles.dayDate}>{d.getDate()}</div>
              </div>
            ))}
          </div>

          {/* Staff rows */}
          {staff.map((s) => (
            <div key={s.id} style={styles.gridRow}>
              <div style={styles.staffCol}>
                <span style={styles.staffName}>{s.first_name} {s.last_name}</span>
              </div>
              {weekDates.map((d) => {
                const dateStr = toDateStr(d);
                const cellEntries = getEntriesForCell(s.id, dateStr);
                return (
                  <div key={dateStr} style={{ ...styles.dayCell, ...(dateStr === today ? styles.todayCell : {}) }}>
                    {cellEntries.map((entry) => (
                      <div key={entry.id} style={styles.shiftBlock} onClick={() => handleDelete(entry.id)} title="Click to remove">
                        {formatTime(entry.start_time)}–{formatTime(entry.end_time)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}

          {staff.length === 0 && (
            <p style={{ padding: 'var(--space-lg)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              No active staff members. Add staff in Business Setup first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1400px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 'var(--space-sm)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  nav: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  weekLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginLeft: 'var(--space-sm)' },
  addForm: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--space-sm)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  grid: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  gridHeader: { display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  gridRow: { display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)' },
  staffCol: { padding: '10px 12px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--color-border)' },
  staffName: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  dayCol: { padding: '8px', textAlign: 'center' as const, borderRight: '1px solid var(--color-border)' },
  dayName: { fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const },
  dayDate: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  todayCol: { background: 'var(--color-primary)', color: '#fff', borderRadius: '0' },
  dayCell: { padding: '6px', borderRight: '1px solid var(--color-border)', minHeight: '50px', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  todayCell: { background: 'rgba(201, 169, 110, 0.05)' },
  shiftBlock: { fontSize: '11px', padding: '3px 6px', borderRadius: '4px', background: 'var(--color-primary)', color: 'var(--color-primary-contrast, #1A1A1A)', cursor: 'pointer', textAlign: 'center' as const, fontWeight: 500 },
};
