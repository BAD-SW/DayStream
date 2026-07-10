import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as bookingsApi from '../api/bookings';
import { apiClient } from '../api/client';

const STATUS_COLORS: Record<string, string> = {
  confirmed: '#4A90A4',
  in_progress: '#E6A817',
  completed: '#2E7D32',
  cancelled: '#D32F2F',
  no_show: '#D32F2F',
  pending: '#8A8A8A',
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am to 8pm

export function BookingCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarData, setCalendarData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');

  const businessId = localStorage.getItem('business_id') || '';

  // Load business timezone
  useEffect(() => {
    if (!businessId) return;
    apiClient.get('/v1/admin/businesses').then((res) => {
      const biz = res.data.data?.find((b: any) => b.id === businessId);
      if (biz?.timezone) setBusinessTimezone(biz.timezone);
    }).catch(() => {});
  }, [businessId]);

  // Fetch calendar data
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    bookingsApi.getCalendar(businessId, view, date)
      .then(setCalendarData)
      .catch(() => setCalendarData(null))
      .finally(() => setLoading(false));
  }, [businessId, view, date]);

  const navigateDate = (direction: number) => {
    const d = new Date(date + 'T12:00:00Z');
    if (view === 'day') d.setUTCDate(d.getUTCDate() + direction);
    else if (view === 'week') d.setUTCDate(d.getUTCDate() + 7 * direction);
    else d.setUTCMonth(d.getUTCMonth() + direction);
    setDate(d.toISOString().slice(0, 10));
  };

  const dateLabel = useMemo(() => {
    const d = new Date(date + 'T12:00:00Z');
    if (view === 'day') return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (view === 'week') {
      const start = getWeekStart(date);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
    }
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [date, view]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/bookings')}>← Booking List</button>
        <h1 style={styles.title}>Calendar</h1>
      </div>

      <div style={styles.controls}>
        <div style={styles.viewToggle}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} style={{ ...styles.viewBtn, ...(view === v ? styles.viewBtnActive : {}) }} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div style={styles.dateNav}>
          <button style={styles.navBtn} onClick={() => navigateDate(-1)}>←</button>
          <span style={styles.dateLabel}>{dateLabel}</span>
          <button style={styles.navBtn} onClick={() => navigateDate(1)}>→</button>
          <button style={styles.todayBtn} onClick={() => setDate(new Date().toISOString().slice(0, 10))}>Today</button>
        </div>
      </div>

      {loading && <p style={styles.empty}>Loading...</p>}

      {!loading && view === 'day' && (
        <DayView bookings={calendarData?.bookings || []} date={date} timezone={businessTimezone} onBookingClick={(id) => navigate(`/bookings/${id}/edit`)} />
      )}

      {!loading && view === 'week' && (
        <WeekView bookings={calendarData?.bookings || []} date={date} timezone={businessTimezone} onBookingClick={(id) => navigate(`/bookings/${id}/edit`)} />
      )}

      {!loading && view === 'month' && (
        <MonthView days={calendarData?.days || []} date={date} onDayClick={(d) => { setDate(d); setView('day'); }} />
      )}
    </div>
  );
}

// ============================================================
// Day View — single column time grid with booking blocks
// ============================================================

function DayView({ bookings, date, timezone, onBookingClick }: { bookings: any[]; date: string; timezone: string; onBookingClick: (id: string) => void }) {
  return (
    <div style={styles.timeGrid}>
      <div style={styles.timeLabels}>
        {HOURS.map((h) => (
          <div key={h} style={styles.timeLabel}>{formatHour(h)}</div>
        ))}
      </div>
      <div style={styles.dayColumn}>
        {HOURS.map((h) => (
          <div key={h} style={styles.hourRow} />
        ))}
        {bookings.map((bk) => {
          const pos = getBookingPosition(bk, timezone);
          if (!pos) return null;
          return (
            <div
              key={bk.id}
              style={{ ...styles.bookingBlock, top: `${pos.top}%`, height: `${pos.height}%`, background: STATUS_COLORS[bk.status] || '#8A8A8A', cursor: 'pointer' }}
              onClick={() => onBookingClick(bk.id)}
              title={`${bk.service_name} — ${bk.customer_name} (${bk.status})`}
            >
              <span style={styles.blockTime}>{formatTime(bk.start_time, timezone)}</span>
              <span style={styles.blockTitle}>{bk.service_name}</span>
              <span style={styles.blockSub}>{bk.customer_name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Week View — 7 columns with time grid
// ============================================================

function WeekView({ bookings, date, timezone, onBookingClick }: { bookings: any[]; date: string; timezone: string; onBookingClick: (id: string) => void }) {
  const weekStart = getWeekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });

  // Group bookings by day
  const bookingsByDay = new Map<string, any[]>();
  for (const bk of bookings) {
    const bkDate = new Date(bk.start_time).toLocaleDateString('sv-SE', { timeZone: timezone }); // YYYY-MM-DD format
    if (!bookingsByDay.has(bkDate)) bookingsByDay.set(bkDate, []);
    bookingsByDay.get(bkDate)!.push(bk);
  }

  return (
    <div style={styles.weekContainer}>
      <div style={styles.weekHeader}>
        <div style={styles.timeLabelsHeader} />
        {days.map((d) => (
          <div key={d} style={{ ...styles.weekDayHeader, ...(d === new Date().toISOString().slice(0, 10) ? styles.todayHeader : {}) }}>
            <span style={styles.weekDayName}>{new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
            <span style={styles.weekDayNum}>{new Date(d + 'T12:00:00Z').getUTCDate()}</span>
          </div>
        ))}
      </div>
      <div style={styles.weekBody}>
        <div style={styles.timeLabels}>
          {HOURS.map((h) => (
            <div key={h} style={styles.timeLabel}>{formatHour(h)}</div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} style={styles.dayColumn}>
            {HOURS.map((h) => (
              <div key={h} style={styles.hourRow} />
            ))}
            {(bookingsByDay.get(d) || []).map((bk) => {
              const pos = getBookingPosition(bk, timezone);
              if (!pos) return null;
              return (
                <div
                  key={bk.id}
                  style={{ ...styles.bookingBlock, top: `${pos.top}%`, height: `${Math.max(pos.height, 3)}%`, background: STATUS_COLORS[bk.status] || '#8A8A8A', cursor: 'pointer' }}
                  onClick={() => onBookingClick(bk.id)}
                  title={`${bk.service_name} — ${bk.customer_name}`}
                >
                  <span style={styles.blockTime}>{formatTime(bk.start_time, timezone)}</span>
                  <span style={styles.blockTitle}>{bk.service_name}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Month View — calendar grid with booking counts
// ============================================================

function MonthView({ days, date, onDayClick }: { days: any[]; date: string; onDayClick: (date: string) => void }) {
  const d = new Date(date + 'T12:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  // Build calendar grid
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const startDow = firstDay.getUTCDay(); // 0=Sun
  const totalDays = lastDay.getUTCDate();

  const dayCountMap = new Map<string, number>();
  for (const day of days) {
    const dateStr = typeof day.date === 'string' ? day.date.split('T')[0] : day.date;
    dayCountMap.set(dateStr, day.count);
  }

  const cells: Array<{ date: string | null; day: number; count: number; isToday: boolean }> = [];
  // Leading empty cells
  for (let i = 0; i < startDow; i++) cells.push({ date: null, day: 0, count: 0, isToday: false });
  // Day cells
  const todayStr = new Date().toISOString().slice(0, 10);
  for (let i = 1; i <= totalDays; i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    cells.push({ date: dateStr, day: i, count: dayCountMap.get(dateStr) || 0, isToday: dateStr === todayStr });
  }

  return (
    <div>
      <div style={styles.monthHeader}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={styles.monthHeaderCell}>{d}</div>
        ))}
      </div>
      <div style={styles.monthGrid}>
        {cells.map((cell, idx) => (
          <div
            key={idx}
            style={{ ...styles.monthCell, ...(cell.isToday ? styles.monthCellToday : {}), ...(cell.date ? { cursor: 'pointer' } : {}) }}
            onClick={cell.date ? () => onDayClick(cell.date!) : undefined}
          >
            {cell.date && (
              <>
                <span style={styles.monthCellDay}>{cell.day}</span>
                {cell.count > 0 && <span style={styles.monthCellCount}>{cell.count}</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function getWeekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day); // Sunday
  return d;
}

function getBookingPosition(bk: any, timezone: string): { top: number; height: number } | null {
  const start = new Date(bk.start_time);
  const end = new Date(bk.end_time);

  // Get hours/minutes in business timezone
  const startParts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: timezone }).formatToParts(start);
  const endParts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: timezone }).formatToParts(end);

  const startHour = parseInt(startParts.find(p => p.type === 'hour')?.value || '0');
  const startMin = parseInt(startParts.find(p => p.type === 'minute')?.value || '0');
  const endHour = parseInt(endParts.find(p => p.type === 'hour')?.value || '0');
  const endMin = parseInt(endParts.find(p => p.type === 'minute')?.value || '0');

  const gridStart = HOURS[0]; // 7
  const gridEnd = HOURS[HOURS.length - 1] + 1; // 21
  const gridRange = gridEnd - gridStart; // 14 hours

  const startOffset = (startHour - gridStart) + startMin / 60;
  const endOffset = (endHour - gridStart) + endMin / 60;

  if (endOffset <= 0 || startOffset >= gridRange) return null;

  const top = (Math.max(0, startOffset) / gridRange) * 100;
  const height = ((Math.min(gridRange, endOffset) - Math.max(0, startOffset)) / gridRange) * 100;

  return { top, height };
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function formatTime(isoStr: string, timezone: string): string {
  return new Date(isoStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-md)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  controls: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, gap: 'var(--space-sm)' },
  viewToggle: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  viewBtn: { background: 'none', border: 'none', borderRight: '1px solid var(--color-border)', padding: '8px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  viewBtnActive: { background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A', fontWeight: 600 },
  dateNav: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  dateLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', minWidth: '180px', textAlign: 'center' as const },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  todayBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)' },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)', fontSize: 'var(--font-size-sm)' },

  // Time grid (shared by day/week)
  timeGrid: { display: 'grid', gridTemplateColumns: '60px 1fr', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  timeLabels: { display: 'flex', flexDirection: 'column' as const },
  timeLabelsHeader: { width: '60px', flexShrink: 0 },
  timeLabel: { height: '60px', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', fontSize: '11px', color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' },
  dayColumn: { position: 'relative' as const, minHeight: `${HOURS.length * 60}px` },
  hourRow: { height: '60px', borderTop: '1px solid var(--color-border)', boxSizing: 'border-box' as const },

  // Booking blocks
  bookingBlock: { position: 'absolute' as const, left: '2px', right: '2px', borderRadius: '4px', padding: '2px 4px', overflow: 'hidden', fontSize: '11px', color: '#fff', zIndex: 1 },
  blockTime: { fontWeight: 600, fontSize: '10px', display: 'block' },
  blockTitle: { display: 'block', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  blockSub: { display: 'block', fontSize: '10px', opacity: 0.8, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },

  // Week view
  weekContainer: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  weekHeader: { display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)' },
  weekDayHeader: { padding: '8px 4px', textAlign: 'center' as const, fontSize: '12px' },
  todayHeader: { background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A', borderRadius: '4px' },
  weekDayName: { display: 'block', fontWeight: 500 },
  weekDayNum: { display: 'block', fontSize: '16px', fontWeight: 600 },
  weekBody: { display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', overflow: 'auto', maxHeight: '700px' },

  // Month view
  monthHeader: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)', marginBottom: '4px' },
  monthHeaderCell: { textAlign: 'center' as const, padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' },
  monthCell: { minHeight: '80px', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 6px', display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  monthCellToday: { background: 'rgba(201, 169, 110, 0.1)', borderColor: 'var(--color-accent, #C9A96E)' },
  monthCellDay: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  monthCellCount: { fontSize: '11px', color: 'var(--color-accent, #C9A96E)', fontWeight: 600 },
};
