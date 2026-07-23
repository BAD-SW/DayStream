import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import * as staffApi from '../api/staff';

interface ScheduleEntry {
  id: string;
  staff_id: string;
  schedule_date: string;
  start_time: string;
  end_time: string;
  entry_type: string;
  staff_first_name: string;
  staff_last_name: string;
}

interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
}

interface BusinessHour {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

interface AvailabilitySlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

type ViewMode = 'week' | 'day';

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

function generateTimeSlots(startHour: number, endHour: number): string[] {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

const SLOT_HEIGHT = 28;

export function Schedule() {
  const businessId = localStorage.getItem('business_id') || '';
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>([]);
  const [staffAvailability, setStaffAvailability] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaffId, setSelectedStaffId] = useState('');

  const weekDates = getWeekDates(currentDate);
  const visibleDates = viewMode === 'week' ? weekDates : [currentDate];
  const dateFrom = toDateStr(visibleDates[0]);
  const dateTo = toDateStr(visibleDates[visibleDates.length - 1]);

  // Compute visible time range from business hours (+/- 1 hour)
  const computeTimeRange = (): { startHour: number; endHour: number } => {
    let earliest = 9;
    let latest = 17;
    for (const bh of businessHours) {
      if (bh.is_closed || !bh.open_time || !bh.close_time) continue;
      const openH = parseInt(bh.open_time.slice(0, 2));
      const closeH = parseInt(bh.close_time.slice(0, 2)) + (parseInt(bh.close_time.slice(3, 5)) > 0 ? 1 : 0);
      if (openH < earliest) earliest = openH;
      if (closeH > latest) latest = closeH;
    }
    return { startHour: Math.max(0, earliest - 1), endHour: Math.min(24, latest + 1) };
  };

  const { startHour, endHour } = computeTimeRange();
  const timeSlots = generateTimeSlots(startHour, endHour);

  // Fetch locations on mount
  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/locations?business_id=${businessId}`).then((res) => {
      const locs = res.data.data || [];
      setLocations(locs);
      const primary = locs.find((l: any) => l.is_primary);
      if (primary) setSelectedLocationId(primary.id);
      else if (locs.length > 0) setSelectedLocationId(locs[0].id);
    }).catch(() => {});
  }, [businessId]);

  // Fetch business hours when location changes
  useEffect(() => {
    if (!selectedLocationId) return;
    apiClient.get(`/v1/schedule/business-hours?location_id=${selectedLocationId}`).then((res) => {
      setBusinessHours(res.data.data || []);
    }).catch(() => {});
  }, [selectedLocationId]);

  // Fetch staff availability when staff selection changes
  useEffect(() => {
    if (!selectedStaffId) { setStaffAvailability([]); return; }
    staffApi.getAvailabilityPatterns(selectedStaffId).then((patterns) => {
      // Use the first active pattern's slots
      const activePattern = patterns.find((p) => p.is_default) || patterns[0];
      if (activePattern) {
        setStaffAvailability(activePattern.slots.map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time.slice(0, 5),
          end_time: s.end_time.slice(0, 5),
        })));
      } else {
        setStaffAvailability([]);
      }
    }).catch(() => setStaffAvailability([]));
  }, [selectedStaffId]);

  // Fetch staff and schedule entries
  const fetchData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      let staffData: any[] = [];
      if (selectedLocationId) {
        const locStaffRes = await apiClient.get(`/v1/locations/${selectedLocationId}/staff`);
        staffData = locStaffRes.data.data || [];
      }
      // If no staff assigned to location, fall back to all business staff
      if (staffData.length === 0) {
        const allStaffRes = await apiClient.get(`/v1/schedule/staff?business_id=${businessId}`);
        staffData = allStaffRes.data.data || [];
      }
      const entriesRes = await apiClient.get(`/v1/schedule?business_id=${businessId}&date_from=${dateFrom}&date_to=${dateTo}`);
      // Normalize: location staff endpoint returns staff_id, schedule endpoint returns id
      setStaff(staffData.map((s: any) => ({ id: s.staff_id || s.id, first_name: s.first_name, last_name: s.last_name })));
      setEntries(entriesRes.data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, selectedLocationId, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Navigation
  const prev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - (viewMode === 'week' ? 7 : 1)); setCurrentDate(d); };
  const next = () => { const d = new Date(currentDate); d.setDate(d.getDate() + (viewMode === 'week' ? 7 : 1)); setCurrentDate(d); };
  const goToday = () => setCurrentDate(new Date());

  // Check if a time slot is within business hours for a given day
  const isBusinessHour = (dayOfWeek: number, slotTime: string): boolean => {
    const bh = businessHours.find((h) => h.day_of_week === dayOfWeek);
    if (!bh || bh.is_closed) return false;
    if (!bh.open_time || !bh.close_time) return false;
    return slotTime >= bh.open_time.slice(0, 5) && slotTime < bh.close_time.slice(0, 5);
  };

  // Check if a time slot is within the selected staff's availability
  const isStaffAvailable = (dayOfWeek: number, slotTime: string): boolean => {
    if (!selectedStaffId || staffAvailability.length === 0) return true; // No staff selected = show all as available
    const daySlots = staffAvailability.filter((s) => s.day_of_week === dayOfWeek);
    if (daySlots.length === 0) return false;
    return daySlots.some((s) => slotTime >= s.start_time && slotTime < s.end_time);
  };

  // Handle clicking on a cell to add a shift
  const handleCellClick = async (date: Date, slotTime: string) => {
    if (!selectedStaffId) { alert('Select a staff member first'); return; }
    const [h, m] = slotTime.split(':').map(Number);
    const endH = h + 1;
    const endTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    try {
      await apiClient.post(`/v1/schedule?business_id=${businessId}`, {
        staff_id: selectedStaffId,
        schedule_date: toDateStr(date),
        start_time: slotTime,
        end_time: endTime,
      });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add shift'); }
  };

  // Handle deleting a shift
  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Remove this shift?')) return;
    await apiClient.delete(`/v1/schedule/${entryId}?business_id=${businessId}`);
    fetchData();
  };

  // Get entries for a specific date
  const getEntriesForDate = (dateStr: string) => entries.filter((e) => e.schedule_date.split('T')[0] === dateStr);

  // Calculate position and height of a shift block
  const getShiftPosition = (startTime: string, endTime: string) => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startSlot = (sh - startHour) * 2 + (sm >= 30 ? 1 : 0);
    const endSlot = (eh - startHour) * 2 + (em >= 30 ? 1 : 0);
    return { top: startSlot * SLOT_HEIGHT, height: Math.max((endSlot - startSlot) * SLOT_HEIGHT, SLOT_HEIGHT) };
  };

  const today = toDateStr(new Date());

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Schedule</h1>
        <div style={styles.nav}>
          <Button variant="secondary" size="sm" onClick={prev}>←</Button>
          <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          <Button variant="secondary" size="sm" onClick={next}>→</Button>
          <span style={styles.weekLabel}>
            {viewMode === 'week'
              ? `${weekDates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
              : currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            }
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {locations.length > 0 && (
            <select style={styles.select} value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}>
              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <div style={styles.toggleGroup}>
            <button onClick={() => setViewMode('week')} style={viewMode === 'week' ? styles.toggleActive : styles.toggleBtn}>Week</button>
            <button onClick={() => setViewMode('day')} style={viewMode === 'day' ? styles.toggleActive : styles.toggleBtn}>Day</button>
          </div>
        </div>
      </div>

      {/* Staff selector */}
      <div style={styles.toolbar}>
        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Staff:</label>
        <select style={{ ...styles.select, minWidth: '200px' }} value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
          <option value="">Select staff to schedule...</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
        </select>
        {selectedStaffId && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Click an available time slot to add a 1-hour shift</span>}
      </div>

      {/* Grid */}
      {loading ? <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p> : (
        <div style={styles.gridWrapper}>
          <div style={{ ...styles.grid, gridTemplateColumns: `60px repeat(${visibleDates.length}, 1fr)` }}>
            {/* Header row */}
            <div style={styles.timeHeader} />
            {visibleDates.map((d) => (
              <div key={toDateStr(d)} style={{ ...styles.dayHeader, ...(toDateStr(d) === today ? styles.todayHeader : {}) }}>
                <div style={styles.dayName}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div style={styles.dayDate}>{d.getDate()}</div>
              </div>
            ))}

            {/* Time column + day columns */}
            <div style={styles.timeColumn}>
              {timeSlots.map((slot) => (
                <div key={slot} style={{ ...styles.timeLabel, height: SLOT_HEIGHT }}>
                  {slot.endsWith(':00') ? formatTime(slot) : ''}
                </div>
              ))}
            </div>

            {visibleDates.map((d) => {
              const dateStr = toDateStr(d);
              const dayOfWeek = d.getDay();
              const dayEntries = getEntriesForDate(dateStr);

              return (
                <div key={dateStr} style={styles.dayColumn}>
                  {/* Background slots */}
                  {timeSlots.map((slot) => {
                    const isBizHour = isBusinessHour(dayOfWeek, slot);
                    const isAvailable = isBizHour && isStaffAvailable(dayOfWeek, slot);
                    const isClickable = isAvailable && !!selectedStaffId;

                    let bg = 'var(--color-background)'; // non-business hours (gray/beige)
                    if (isBizHour && !isAvailable) bg = '#f0ebe0'; // business hours but staff unavailable
                    if (isAvailable) bg = '#FFFFFF'; // available for scheduling

                    return (
                      <div
                        key={slot}
                        style={{ ...styles.slot, height: SLOT_HEIGHT, background: bg, cursor: isClickable ? 'pointer' : 'default' }}
                        onClick={() => isClickable && handleCellClick(d, slot)}
                      />
                    );
                  })}

                  {/* Shift blocks overlaid */}
                  {dayEntries.map((entry) => {
                    const pos = getShiftPosition(entry.start_time.slice(0, 5), entry.end_time.slice(0, 5));
                    return (
                      <div
                        key={entry.id}
                        style={{ ...styles.shiftBlock, top: pos.top, height: pos.height }}
                        onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                        title={`${entry.staff_first_name} ${entry.staff_last_name}\n${formatTime(entry.start_time.slice(0,5))}–${formatTime(entry.end_time.slice(0,5))}\nClick to remove`}
                      >
                        <span style={styles.shiftName}>{entry.staff_first_name}</span>
                        <span style={styles.shiftTime}>{formatTime(entry.start_time.slice(0, 5))}–{formatTime(entry.end_time.slice(0, 5))}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1400px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)', flexWrap: 'wrap', gap: 'var(--space-sm)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  nav: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' },
  weekLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginLeft: 'var(--space-sm)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  toggleGroup: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  toggleBtn: { background: 'var(--color-surface)', border: 'none', padding: '6px 14px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  toggleActive: { background: 'var(--color-primary)', border: 'none', padding: '6px 14px', fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-contrast, #1A1A1A)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontWeight: 600 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  gridWrapper: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'auto', maxHeight: 'calc(100vh - 200px)' },
  grid: { display: 'grid', minWidth: '600px' },
  timeHeader: { padding: '8px', borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  dayHeader: { padding: '8px', textAlign: 'center' as const, borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  todayHeader: { background: 'var(--color-primary)', color: '#fff' },
  dayName: { fontSize: '11px', textTransform: 'uppercase' as const, fontWeight: 600 },
  dayDate: { fontSize: 'var(--font-size-md)', fontWeight: 700 },
  timeColumn: { borderRight: '1px solid var(--color-border)' },
  timeLabel: { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '6px', fontSize: '10px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', boxSizing: 'border-box' as const },
  dayColumn: { position: 'relative' as const, borderRight: '1px solid var(--color-border)' },
  slot: { borderBottom: '1px solid var(--color-border)', boxSizing: 'border-box' as const },
  shiftBlock: { position: 'absolute' as const, left: '2px', right: '2px', borderRadius: '4px', background: 'var(--color-primary)', color: 'var(--color-primary-contrast, #1A1A1A)', padding: '2px 4px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', fontSize: '11px', zIndex: 2 },
  shiftName: { fontWeight: 600, fontSize: '11px', lineHeight: 1.2 },
  shiftTime: { fontSize: '10px', opacity: 0.8 },
};
