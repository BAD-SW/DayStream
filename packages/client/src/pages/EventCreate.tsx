import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as eventsApi from '../api/events';

export function EventCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [eventTypes, setEventTypes] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_type_id: '',
    start_time: '',
    end_time: '',
    location_name: '',
    capacity: 50,
  });

  useEffect(() => {
    eventsApi.getEventTypes().then(setEventTypes).catch(() => {});
  }, []);

  const handleChange = (field: string, value: any) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const event = await eventsApi.createEvent(form);
      navigate(`/events/${event.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/events')}>← Back to Events</button>
      <h1 style={styles.title}>Create Event</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Title *</label>
          <input style={styles.input} value={form.title} onChange={(e) => handleChange('title', e.target.value)} required />
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Description</label>
          <textarea style={{ ...styles.input, minHeight: '80px' }} value={form.description} onChange={(e) => handleChange('description', e.target.value)} />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Event Type</label>
            <select style={styles.input} value={form.event_type_id} onChange={(e) => handleChange('event_type_id', e.target.value)}>
              <option value="">— Select —</option>
              {eventTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Capacity</label>
            <input style={styles.input} type="number" min={1} value={form.capacity} onChange={(e) => handleChange('capacity', Number(e.target.value))} />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Start Time *</label>
            <input style={styles.input} type="datetime-local" value={form.start_time} onChange={(e) => handleChange('start_time', e.target.value)} required />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>End Time *</label>
            <input style={styles.input} type="datetime-local" value={form.end_time} onChange={(e) => handleChange('end_time', e.target.value)} required />
          </div>
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Location</label>
          <input style={styles.input} value={form.location_name} onChange={(e) => handleChange('location_name', e.target.value)} />
        </div>
        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/events')}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Event'}</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '700px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
