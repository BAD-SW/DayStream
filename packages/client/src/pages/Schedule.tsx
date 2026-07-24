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

// Color palette for staff members
const STAFF_COLORS = [
  '#C9A96E', '#4A90A4', '#7B9E6B', '#D4784A', '#8B6BAE',
  '#C75B7A', '#4AADA4', '#B8945A', '#5B8FC7', '#9B7D4E',
  '#6B8E7B', '#C76B4A', '#7A6BAE', '#4A9E8B', '#AE8B5A',
];

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
    if (businessHours.length === 0) return true; // No hours defined = always open
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
    await createShift(selectedStaffId, date, slotTime);
  };

  // Create a shift for a given staff member at a date/time
  const createShift = async (staffId: string, date: Date, slotTime: string) => {
    const [h, m] = slotTime.split(':').map(Number);
    const endH = h + 1;
    const endTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    try {
      await apiClient.post(`/v1/schedule?business_id=${businessId}`, {
        staff_id: staffId,
        schedule_date: toDateStr(date),
        start_time: slotTime,
        end_time: endTime,
        location_id: selectedLocationId || undefined,
      });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add shift'); }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, staffId: string) => {
    e.dataTransfer.setData('text/plain', `new:${staffId}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleShiftDragStart = (e: React.DragEvent, entry: ScheduleEntry) => {
    e.stopPropagation();
    const [sh, sm] = entry.start_time.slice(0, 5).split(':').map(Number);
    const [eh, em] = entry.end_time.slice(0, 5).split(':').map(Number);
    const durationMin = (eh * 60 + em) - (sh * 60 + sm);
    e.dataTransfer.setData('text/plain', `move:${entry.id}:${durationMin}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, date: Date, slotTime: string) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;

    if (data.startsWith('new:')) {
      const staffId = data.slice(4);
      await createShift(staffId, date, slotTime);
    } else if (data.startsWith('move:')) {
      const parts = data.split(':');
      const entryId = parts[1];
      const durationMin = parseInt(parts[2]);
      const [h, m] = slotTime.split(':').map(Number);
      const endMin = h * 60 + m + durationMin;
      const newEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

      try {
        await apiClient.put(`/v1/schedule/${entryId}?business_id=${businessId}`, {
          schedule_date: toDateStr(date),
          start_time: slotTime,
          end_time: newEnd,
        });
        fetchData();
      } catch (err: any) { alert(err.response?.data?.error || 'Failed to move shift'); }
    }
  };

  // Handle deleting a shift
  const handleDeleteEntry = async (entryId: string) => {
    await apiClient.delete(`/v1/schedule/${entryId}?business_id=${businessId}`);
    fetchData();
  };

  // Resize state
  const [resizing, setResizing] = useState<{ entryId: string; edge: 'top' | 'bottom'; startY: number; origStart: string; origEnd: string; dayOfWeek: number } | null>(null);
  const [resizeDelta, setResizeDelta] = useState(0);

  const handleResizeStart = (e: React.MouseEvent, entryId: string, edge: 'top' | 'bottom', startTime: string, endTime: string, dayOfWeek: number) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDelta(0);
    setResizing({ entryId, edge, startY: e.clientY, origStart: startTime.slice(0, 5), origEnd: endTime.slice(0, 5), dayOfWeek });
  };

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - resizing.startY;
      const snappedDelta = Math.round(delta / SLOT_HEIGHT) * SLOT_HEIGHT;
      setResizeDelta(snappedDelta);
    };

    const handleMouseUp = async (e: MouseEvent) => {
      if (!resizing) return;
      const deltaY = e.clientY - resizing.startY;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      if (deltaSlots === 0) { setResizing(null); setResizeDelta(0); return; }

      const [sh, sm] = resizing.origStart.split(':').map(Number);
      const [eh, em] = resizing.origEnd.split(':').map(Number);

      let newStartMin = sh * 60 + sm;
      let newEndMin = eh * 60 + em;

      if (resizing.edge === 'top') {
        newStartMin += deltaSlots * 30;
      } else {
        newEndMin += deltaSlots * 30;
      }

      // Clamp to business hours
      const bh = businessHours.find((h) => h.day_of_week === resizing.dayOfWeek);
      if (bh && !bh.is_closed && bh.open_time && bh.close_time) {
        const [oh, om] = bh.open_time.slice(0, 5).split(':').map(Number);
        const [ch, cm] = bh.close_time.slice(0, 5).split(':').map(Number);
        const openMin = oh * 60 + om;
        const closeMin = ch * 60 + cm;
        if (newStartMin < openMin) newStartMin = openMin;
        if (newEndMin > closeMin) newEndMin = closeMin;
      }

      // Enforce minimum 30-min shift
      if (newEndMin - newStartMin < 30) {
        setResizing(null);
        setResizeDelta(0);
        return;
      }

      const newStart = `${String(Math.floor(newStartMin / 60)).padStart(2, '0')}:${String(newStartMin % 60).padStart(2, '0')}`;
      const newEnd = `${String(Math.floor(newEndMin / 60)).padStart(2, '0')}:${String(newEndMin % 60).padStart(2, '0')}`;

      try {
        await apiClient.put(`/v1/schedule/${resizing.entryId}?business_id=${businessId}`, {
          start_time: newStart,
          end_time: newEnd,
        });
        fetchData();
      } catch { /* silent */ }
      setResizing(null);
      setResizeDelta(0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  // Get entries for a specific date
  const getEntriesForDate = (dateStr: string) => entries.filter((e) => e.schedule_date.split('T')[0] === dateStr);

  // Get color for a staff member
  const getStaffColor = (staffId: string): string => {
    const idx = staff.findIndex((s) => s.id === staffId);
    if (idx >= 0) return STAFF_COLORS[idx % STAFF_COLORS.length];
    // Fallback: hash the staffId for a consistent color
    const hash = staffId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return STAFF_COLORS[hash % STAFF_COLORS.length];
  };

  // Compute overlap positioning for entries on a given date
  const getOverlapLayout = (dayEntries: ScheduleEntry[]) => {
    // For each entry, determine how many overlap it and its position index
    const layout: Map<string, { totalOverlap: number; index: number }> = new Map();
    for (let i = 0; i < dayEntries.length; i++) {
      const a = dayEntries[i];
      const aStart = a.start_time.slice(0, 5);
      const aEnd = a.end_time.slice(0, 5);
      const overlapping = dayEntries.filter((b) => {
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return bStart < aEnd && bEnd > aStart;
      });
      const sortedOverlap = overlapping.sort((x, y) => x.staff_id.localeCompare(y.staff_id));
      const idx = sortedOverlap.findIndex((x) => x.id === a.id);
      layout.set(a.id, { totalOverlap: overlapping.length, index: idx });
    }
    return layout;
  };

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

      {/* Staff selector - selected name is draggable */}
      <div style={styles.toolbar}>
        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Staff:</label>
        <select style={{ ...styles.select, minWidth: '200px' }} value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
          <option value="">Select staff to schedule...</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
        </select>
        {selectedStaffId && (
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, selectedStaffId)}
            style={styles.dragHandle}
            title="Drag onto schedule"
          >
            ⠿ {staff.find((s) => s.id === selectedStaffId)?.first_name} — drag to schedule
          </div>
        )}
        {!selectedStaffId && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Select a staff member, then drag or click to schedule</span>}
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
                <div key={dateStr} style={styles.dayColumn} onDragOver={(e) => e.preventDefault()}>
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
                        onDragOver={isBizHour ? handleDragOver : undefined}
                        onDrop={isBizHour ? (e) => handleDrop(e, d, slot) : undefined}
                      />
                    );
                  })}

                  {/* Shift blocks overlaid */}
                  {(() => {
                    const layout = getOverlapLayout(dayEntries);
                    return dayEntries.map((entry) => {
                      const pos = getShiftPosition(entry.start_time.slice(0, 5), entry.end_time.slice(0, 5));
                      const overlap = layout.get(entry.id) || { totalOverlap: 1, index: 0 };
                      const widthPct = 100 / overlap.totalOverlap;
                      const leftPct = overlap.index * widthPct;
                      const color = getStaffColor(entry.staff_id);

                      const isResizingThis = resizing?.entryId === entry.id;
                      let adjustedTop = pos.top;
                      let adjustedHeight = pos.height;
                      if (isResizingThis) {
                        if (resizing.edge === 'top') {
                          adjustedTop = pos.top + resizeDelta;
                          adjustedHeight = pos.height - resizeDelta;
                        } else {
                          adjustedHeight = pos.height + resizeDelta;
                        }
                        adjustedHeight = Math.max(adjustedHeight, SLOT_HEIGHT);
                      }
                      return (
                        <div
                          key={entry.id}
                          draggable={!isResizingThis}
                          onDragStart={(e) => handleShiftDragStart(e, entry)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Calculate which time slot based on Y position within the day column
                            const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                            const relY = e.clientY - rect.top;
                            const slotIndex = Math.floor(relY / SLOT_HEIGHT);
                            const slotTime = timeSlots[Math.max(0, Math.min(slotIndex, timeSlots.length - 1))];
                            if (slotTime) handleDrop(e, d, slotTime);
                          }}
                          style={{ ...styles.shiftBlock, top: adjustedTop, height: adjustedHeight, left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: isResizingThis ? 0.85 : 1 }}
                          title={`${entry.staff_first_name} ${entry.staff_last_name}\n${formatTime(entry.start_time.slice(0,5))}–${formatTime(entry.end_time.slice(0,5))}\nDrag to move`}
                        >
                          <div
                            style={styles.resizeHandleTop}
                            onMouseDown={(e) => handleResizeStart(e, entry.id, 'top', entry.start_time, entry.end_time, dayOfWeek)}
                          />
                          <span style={styles.shiftName}>{entry.staff_first_name}</span>
                          <span style={styles.shiftTime}>{formatTime(entry.start_time.slice(0, 5))}–{formatTime(entry.end_time.slice(0, 5))}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                            style={styles.shiftDeleteBtn}
                            title="Remove shift"
                          >×</button>
                          <div
                            style={styles.resizeHandleBottom}
                            onMouseDown={(e) => handleResizeStart(e, entry.id, 'bottom', entry.start_time, entry.end_time, dayOfWeek)}
                          />
                        </div>
                      );
                    });
                  })()}
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
  dragHandle: { padding: '4px 12px', fontSize: '12px', fontWeight: 500, color: 'var(--color-primary)', background: 'var(--color-surface)', border: '1px dashed var(--color-primary)', borderRadius: 'var(--radius-md)', cursor: 'grab', userSelect: 'none' as const },
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
  shiftBlock: { position: 'absolute' as const, borderRadius: '4px', color: '#FFFFFF', padding: '2px 4px', overflow: 'hidden', cursor: 'grab', display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', fontSize: '11px', zIndex: 2, boxSizing: 'border-box' as const },
  shiftName: { fontWeight: 600, fontSize: '11px', lineHeight: 1.2, color: '#FFFFFF' },
  shiftTime: { fontSize: '10px', opacity: 0.9, color: '#FFFFFF' },
  shiftDeleteBtn: { position: 'absolute' as const, top: '1px', right: '3px', background: 'none', border: 'none', color: '#FFFFFF', fontSize: '14px', cursor: 'pointer', padding: '0', lineHeight: 1, opacity: 0.7 },
  resizeHandleTop: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: '5px', cursor: 'n-resize', zIndex: 3 },
  resizeHandleBottom: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '5px', cursor: 's-resize', zIndex: 3 },
};
