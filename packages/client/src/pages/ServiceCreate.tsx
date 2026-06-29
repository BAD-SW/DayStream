import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as servicesApi from '../api/services';

export function ServiceCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<servicesApi.ServiceCategory[]>([]);
  const [form, setForm] = useState({
    name: '',
    description: '',
    booking_type: 'appointment',
    default_duration: 60,
    max_capacity: 1,
    category_id: '',
    online_booking_enabled: true,
  });

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (businessId) {
      servicesApi.getCategories(businessId).then(setCategories).catch(() => {});
    }
  }, [businessId]);

  const handleChange = (field: string, value: any) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) { setError('No business context.'); return; }
    setLoading(true);
    setError('');
    try {
      const service = await servicesApi.createService({ ...form, business_id: businessId });
      navigate(`/services/${service.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create service');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/services')}>← Back to Services</button>
      <h1 style={styles.title}>Create Service</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Name *</label>
          <input style={styles.input} value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Description</label>
          <textarea style={{ ...styles.input, minHeight: '80px' }} value={form.description} onChange={(e) => handleChange('description', e.target.value)} />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Booking Type</label>
            <select style={styles.input} value={form.booking_type} onChange={(e) => handleChange('booking_type', e.target.value)}>
              <option value="appointment">Appointment</option>
              <option value="class">Class</option>
              <option value="resource">Resource</option>
            </select>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Category</label>
            <select style={styles.input} value={form.category_id} onChange={(e) => handleChange('category_id', e.target.value)}>
              <option value="">— Select —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Duration (min) *</label>
            <input style={styles.input} type="number" min={5} value={form.default_duration} onChange={(e) => handleChange('default_duration', Number(e.target.value))} required />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Max Capacity</label>
            <input style={styles.input} type="number" min={1} value={form.max_capacity} onChange={(e) => handleChange('max_capacity', Number(e.target.value))} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => handleChange('online_booking_enabled', e.target.checked)} />
          Enable online booking
        </label>
        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/services')}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Service'}</Button>
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
