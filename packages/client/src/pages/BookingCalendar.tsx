import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as bookingsApi from '../api/bookings';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--color-info-light)',
  in_progress: 'var(--color-warning)',
  completed: 'var(--color-success-light)',
  cancelled: 'var(--color-error-light)',
  no_show: 'var(--color-error-light)',
  pending: 'var(--color-text-secondary)',
};

export function BookingCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarData, setCalendarData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    bookingsApi.getCalendar(businessId, view, date)
      .then(setCalendarData)
      .catch(() => setCalendarData(null))
      .finally(() => setLoading(false));
  }, [businessId, view, date]);

  const navigateDate = (direction: number) => {
    const d = new Date(date);
    if (view === 'day') d.setUTCDate(d.getUTCDate() + direction);
    else if (view === 'week') d.setUTCDate(d.getUTCDate() + 7 * direction);
    else d.setUTCMonth(d.getUTCMonth() + direction);
    setDate(d.toISOString().slice(0, 10));
  };

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
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.dateInput} />
          <button style={styles.navBtn} onClick={() => navigateDate(1)}>→</button>
          <button style={styles.todayBtn} onClick={() => setDate(new Date().toISOString().slice(0, 10))}>Today</button>
        </div>
      </div>

      {loading && <p style={styles.empty}>Loading...</p>}

      {!loading && calendarData && view === 'month' && (
        <MonthView data={calendarData} onDayClick={(d) => { setDate(d); setView('day'); }} />
      )}

      {!loading && calendarData && (view === 'day' || view === 'week') && (
        <BookingsList bookings={calendarData.bookings || []} />
      )}
    </div>
  );
}

function MonthView({ data, onDayClick }: { data: any; onDayClick: (date: string) => void }) {
  return (
    <div style={styles.monthGrid}>
      {data.days.map((day: any) => (
        <div key={day.date} style={styles.monthDay} onClick={() => onDayClick(day.date)}>
          <span style={styles.monthDate}>{new Date(day.date).getUTCDate()}</span>
          <span style={styles.monthCount}>{day.count} booking{day.count !== 1 ? 's' : ''}</span>
        </div>
      ))}
      {data.days.length === 0 && <p style={styles.empty}>No bookings this month</p>}
    </div>
  );
}

function BookingsList({ bookings }: { bookings: any[] }) {
  if (bookings.length === 0) return <p style={styles.empty}>No bookings for this period</p>;

  return (
    <div style={styles.bookingsList}>
      {bookings.map((bk: any) => (
        <div key={bk.id} style={styles.bookingCard}>
          <div style={{ ...styles.statusBar, background: STATUS_COLORS[bk.status] || 'var(--color-border)' }} />
          <div style={styles.bookingContent}>
            <div style={styles.bookingTime}>
              {new Date(bk.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              {' – '}
              {new Date(bk.end_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={styles.bookingMain}>
              <strong>{bk.service_name}</strong>
              <span style={styles.bookingCustomer}>{bk.customer_name}</span>
            </div>
            <div style={styles.bookingMeta}>
              {bk.staff_name && <span>{bk.staff_name}</span>}
              <Badge variant="neutral">{bk.status.replace('_', ' ')}</Badge>
              <span style={styles.bookingRef}>{bk.booking_reference}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-lg)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  controls: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const, gap: 'var(--space-md)' },
  viewToggle: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  viewBtn: { background: 'none', border: 'none', padding: '8px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  viewBtnActive: { background: 'var(--color-surface-hover)', color: 'var(--color-primary)' },
  dateNav: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  todayBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)' },
  dateInput: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)', fontSize: 'var(--font-size-sm)' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-xs)' },
  monthDay: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  monthDate: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any },
  monthCount: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  bookingsList: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  bookingCard: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  statusBar: { width: '4px', flexShrink: 0 },
  bookingContent: { padding: 'var(--space-sm) var(--space-md)', flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-md)' },
  bookingTime: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', minWidth: '110px' },
  bookingMain: { flex: 1, display: 'flex', flexDirection: 'column' as const },
  bookingCustomer: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  bookingMeta: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-xs)' },
  bookingRef: { color: 'var(--color-text-disabled)' },
};
