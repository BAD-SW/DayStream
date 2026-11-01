import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import * as eventsApi from '../api/events';
import { getLocations } from '../api/locations';
import { getTaxCategories } from '../api/services';
import { QuarterTimeInput } from '../design-system/components/forms/QuarterTimeInput';
import { DEFAULT_START_TIME, endFrom, durationBetween, endNotAfterStart } from '../utils/eventTiming';
import type { Duration, DurationUnit } from '../utils/eventTiming';

export function EventCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [eventTypes, setEventTypes] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_type_id: '',
    location_name: '',
    location_id: '',
    tax_category_id: '',
    capacity: 50,
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  // When (David, 2026-10-28): the start suggests 9:00; times are offered in 15-minute steps and
  // any minute can be typed; duration and end follow each other.
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  // Default 3 hours (David, 2026-10-29), changeable here.
  const [duration, setDuration] = useState<Duration>({ amount: 3, unit: 'hours' });
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const endTooEarly = endNotAfterStart(startDate, startTime, endDate, endTime);

  const changeStart = (date: string, time: string) => {
    setStartDate(date); setStartTime(time);
    const end = endFrom(date, time, duration);
    if (end) { setEndDate(end.date); setEndTime(end.time); }
  };
  const changeDuration = (next: Duration) => {
    setDuration(next);
    const end = endFrom(startDate, startTime, next);
    if (end) { setEndDate(end.date); setEndTime(end.time); }
  };
  const changeEnd = (date: string, time: string) => {
    setEndDate(date); setEndTime(time);
    const d = durationBetween(startDate, startTime, date, time, duration.unit);
    if (d) setDuration(d);
  };

  useEffect(() => {
    eventsApi.getEventTypes().then(setEventTypes).catch(() => {});
    const businessId = localStorage.getItem('business_id') || '';
    if (businessId) {
      getLocations(businessId).then(setLocations).catch(() => {});
      getTaxCategories(businessId).then(setTaxes).catch(() => {});
    }
  }, []);

  const handleChange = (field: string, value: any) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endTooEarly) { setError('The end must be after the start'); return; }
    setLoading(true);
    setError('');
    try {
      const event = await eventsApi.createEvent({
        ...form, location_id: form.location_id || null, tax_category_id: form.tax_category_id || null,
        start_time: `${startDate}T${startTime}`, end_time: `${endDate}T${endTime}`,
      });
      navigate(`/events/${event.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  // Layout: Proposal A, chosen by David on 2026-10-28 — title row with the buttons, then
  // "About the event" on the left and "When" and "Where and tickets" on the right, all on one screen.
  return (
    <div style={styles.page}>
      <form id="create-event" onSubmit={handleSubmit}>
        <StickyPageTop>
          <button type="button" style={styles.back} onClick={() => navigate('/events')}>← Events</button>
          <PageHeader
            title="Create Event"
            actions={<>
              <Button type="button" variant="outline" onClick={() => navigate('/events')}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Event'}</Button>
            </>}
          />
        </StickyPageTop>
        {error && <Alert variant="error">{error}</Alert>}
        <div style={styles.columns}>
          <section style={styles.card} aria-labelledby="ce-about">
            <h2 id="ce-about" style={styles.cardTitle}>About the event</h2>
            <div style={styles.fieldWrapper}>
              <label style={styles.label} htmlFor="event-title">Title *</label>
              <input id="event-title" style={styles.input} value={form.title} onChange={(e) => handleChange('title', e.target.value)} required />
            </div>
            <div style={styles.typeRow}>
              <div style={styles.fieldWrapper}>
                <label style={styles.label} htmlFor="event-type">Event Type *</label>
                <select id="event-type" style={styles.input} required value={form.event_type_id} onChange={(e) => handleChange('event_type_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {eventTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div style={styles.fieldWrapper}>
                <label style={styles.label} htmlFor="event-capacity">Capacity</label>
                <input id="event-capacity" style={styles.input} type="number" min={1} value={form.capacity} onChange={(e) => handleChange('capacity', Number(e.target.value))} />
              </div>
            </div>
            <div style={{ ...styles.fieldWrapper, flexGrow: 1 }}>
              <label style={styles.label} htmlFor="event-description">Description</label>
              <textarea id="event-description" style={{ ...styles.input, minHeight: '220px', flexGrow: 1, resize: 'vertical' }} value={form.description} onChange={(e) => handleChange('description', e.target.value)} />
            </div>
          </section>

          <div style={styles.side}>
            <section style={styles.card} aria-labelledby="ce-when">
              <h2 id="ce-when" style={styles.cardTitle}>When</h2>
              <div style={styles.when}>
                <div style={styles.fieldWrapper}>
                  <label style={styles.label} htmlFor="event-start-date">Start *</label>
                  <div style={styles.pair}>
                    <input id="event-start-date" style={styles.input} type="date" value={startDate} onChange={(e) => changeStart(e.target.value, startTime)} required aria-label="Start date" />
                    <QuarterTimeInput style={{ ...styles.input, ...styles.time }} value={startTime} onChange={(t) => changeStart(startDate, t)} required aria-label="Start time" />
                  </div>
                </div>
                <div style={styles.fieldWrapper}>
                  <label style={styles.label} htmlFor="event-duration">Duration *</label>
                  <div style={styles.pair}>
                    <input id="event-duration" style={{ ...styles.input, ...styles.amount }} type="number" min={0.01} step="any" value={duration.amount}
                      onChange={(e) => changeDuration({ ...duration, amount: Number(e.target.value) })} required aria-label="Duration" />
                    <select style={styles.input} value={duration.unit} onChange={(e) => changeDuration({ ...duration, unit: e.target.value as DurationUnit })} aria-label="Duration unit">
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                </div>
              </div>
              <div style={styles.fieldWrapper}>
                <label style={styles.label} htmlFor="event-end-date">End *</label>
                <div style={styles.pair}>
                  <input id="event-end-date" style={styles.input} type="date" min={startDate || undefined} value={endDate} onChange={(e) => changeEnd(e.target.value, endTime)} required aria-label="End date" />
                  <QuarterTimeInput style={{ ...styles.input, ...styles.time }} value={endTime} onChange={(t) => changeEnd(endDate, t)} required aria-label="End time" />
                </div>
                {endTooEarly && <span role="alert" style={styles.fieldError}>The end must be after the start.</span>}
              </div>
            </section>

            <section style={styles.card} aria-labelledby="ce-where">
              <h2 id="ce-where" style={styles.cardTitle}>Where and tickets</h2>
              <div style={styles.row}>
                <div style={styles.fieldWrapper}>
                  <label style={styles.label} htmlFor="event-hosted-at">Hosted at</label>
                  <select id="event-hosted-at" style={styles.input} value={form.location_id} onChange={(e) => {
                    const loc = locations.find((l) => l.id === e.target.value);
                    setForm({ ...form, location_id: e.target.value, location_name: form.location_name || loc?.name || '' });
                  }}>
                    <option value="">— Select —</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div style={styles.fieldWrapper}>
                  <label style={styles.label} htmlFor="event-location-name">Location shown to customers</label>
                  <input id="event-location-name" style={styles.input} value={form.location_name} onChange={(e) => handleChange('location_name', e.target.value)} />
                </div>
              </div>
              <span style={styles.help}>The business of this location sells the tickets.</span>
              <div style={styles.fieldWrapper}>
                <label style={styles.label} htmlFor="event-tax">Ticket tax</label>
                <select id="event-tax" style={styles.input} value={form.tax_category_id} onChange={(e) => handleChange('tax_category_id', e.target.value)}>
                  <option value="">Business default tax</option>
                  {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.rate / 100).toLocaleString()}%)</option>)}
                </select>
              </div>
            </section>
          </div>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '0 var(--space-lg) var(--space-lg)', maxWidth: '1240px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)' },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 'var(--space-lg)', alignItems: 'stretch' },
  side: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-lg)', minWidth: 0 },
  card: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)', padding: 'var(--space-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 700, color: 'var(--color-text)' },
  typeRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 'var(--space-md)' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-md)' },
  when: { display: 'flex', flexWrap: 'wrap' as const, gap: 'var(--space-md)' },
  pair: { display: 'flex', gap: '6px' },
  time: { width: '96px', flexShrink: 0, boxSizing: 'border-box' as const },
  amount: { width: '80px', flexShrink: 0 },
  fieldError: { fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px', minWidth: 0 },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minWidth: 0 },
  help: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 'calc(-1 * var(--space-sm))' },
};
