import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as customersApi from '../api/customers';

export function CustomerCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    preferred_language: 'en',
    country: '',
  });

  const businessId = localStorage.getItem('business_id') || '';

  const handleChange = (field: string, value: string) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      setError('No business context. Please log in again.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const customer = await customersApi.createCustomer({
        business_id: businessId,
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || undefined,
        date_of_birth: form.date_of_birth || undefined,
        gender: form.gender || undefined,
        preferred_language: form.preferred_language,
        country: form.country || undefined,
      });
      navigate(`/customers/${customer.id}`);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to create customer';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/customers')}>← Back to Customers</button>
      <h1 style={styles.title}>Add Customer</h1>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.row}>
          <Field label="First Name *" value={form.first_name} onChange={(v) => handleChange('first_name', v)} required />
          <Field label="Last Name *" value={form.last_name} onChange={(v) => handleChange('last_name', v)} required />
        </div>

        <Field label="Email *" type="email" value={form.email} onChange={(v) => handleChange('email', v)} required />
        <Field label="Phone" type="tel" value={form.phone} onChange={(v) => handleChange('phone', v)} />

        <div style={styles.row}>
          <Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => handleChange('date_of_birth', v)} />
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Gender</label>
            <select value={form.gender} onChange={(e) => handleChange('gender', e.target.value)} style={styles.input}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non_binary">Non-binary</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
        </div>

        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Language</label>
            <select value={form.preferred_language} onChange={(e) => handleChange('preferred_language', e.target.value)} style={styles.input}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
            </select>
          </div>
          <Field label="Country" value={form.country} onChange={(v) => handleChange('country', v)} />
        </div>

        <div style={styles.actions}>
          <Button type="button" onClick={() => navigate('/customers')}>Cancel</Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div style={styles.fieldWrapper}>
      <label style={styles.label}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={styles.input}
      />
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
