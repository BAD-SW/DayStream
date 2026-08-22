import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { iso2ToCountry } from '@daystream/shared';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import { CountrySelect } from '../design-system/components/forms/CountrySelect';
import { apiClient } from '../api/client';
import { isoCountryFromTimezone } from '../utils/timezoneCountry';
import * as customersApi from '../api/customers';

export function CustomerCreate() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [form, setForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    preferred_language: 'en',
  });
  const [countryIso2, setCountryIso2] = useState('');
  const [phoneCountryIso2, setPhoneCountryIso2] = useState('US');

  const businessId = localStorage.getItem('business_id') || '';

  // Default the phone country code to the business's own country, falling back to US.
  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/admin/my-context?business_id=${businessId}`)
      .then((res) => {
        const timezone = res.data?.data?.business?.timezone;
        setPhoneCountryIso2(isoCountryFromTimezone(timezone));
      })
      .catch(() => {});
  }, [businessId]);

  const handleChange = (field: string, value: string) => {
    setForm({ ...form, [field]: value });
  };

  // Selecting a Country auto-selects the matching phone country code as a convenience
  // default; both remain independently editable afterwards (customers-page-requirements.md §A5).
  const handleCountryChange = (iso2: string) => {
    setCountryIso2(iso2);
    setPhoneCountryIso2(iso2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      setError('No business context. Please log in again.');
      return;
    }

    setPhoneError('');
    if (form.phone.trim() && !isValidPhoneNumber(form.phone.trim(), phoneCountryIso2 as any)) {
      const countryName = iso2ToCountry(phoneCountryIso2)?.name || phoneCountryIso2;
      const dialCode = iso2ToCountry(phoneCountryIso2)?.dialCode || '';
      setPhoneError(`Enter a valid phone number for the selected country (${countryName}, ${dialCode}).`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const dialCode = iso2ToCountry(phoneCountryIso2)?.dialCode || '';
      const customer = await customersApi.createCustomer({
        business_id: businessId,
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone.trim() ? `${dialCode} ${form.phone.trim()}` : undefined,
        date_of_birth: form.date_of_birth || undefined,
        gender: form.gender || undefined,
        preferred_language: form.preferred_language,
        country: countryIso2 ? iso2ToCountry(countryIso2)?.name : undefined,
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
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Basic Info</h2>
          <div style={styles.row}>
            <Field label="First Name *" value={form.first_name} onChange={(v) => handleChange('first_name', v)} required />
            <Field label="Last Name *" value={form.last_name} onChange={(v) => handleChange('last_name', v)} required />
          </div>

          <Field label="Email *" type="email" value={form.email} onChange={(v) => handleChange('email', v)} required />

          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Phone</label>
            <div style={styles.phoneRow}>
              <CountrySelect value={phoneCountryIso2} onChange={setPhoneCountryIso2} mode="dial" />
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => { handleChange('phone', e.target.value); setPhoneError(''); }}
                style={{ ...styles.input, flex: 1, ...(phoneError ? styles.inputError : {}) }}
              />
            </div>
            {phoneError && <span style={styles.errMsg}>{phoneError}</span>}
          </div>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Details</h2>
          <div style={styles.row}>
            <Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => handleChange('date_of_birth', v)} />
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>Gender</label>
              <select value={form.gender} onChange={(e) => handleChange('gender', e.target.value)} style={styles.input}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
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
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>Country</label>
              <CountrySelect value={countryIso2} onChange={handleCountryChange} mode="name" />
            </div>
          </div>
        </section>

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
  page: { padding: 'var(--space-lg)', maxWidth: '760px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--font-size-page-title)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xl)' },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-lg)' },
  sectionTitle: {
    fontSize: 'var(--font-size-section-header)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)',
    margin: 0, paddingBottom: 'var(--space-sm)', borderBottom: '1px solid var(--color-border)',
  },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '7px' },
  label: { fontSize: '13.5px', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: '15px' },
  inputError: { borderColor: 'var(--color-error)', background: 'var(--color-error-bg)' },
  phoneRow: { display: 'flex', gap: '8px' },
  errMsg: { fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' },
};
