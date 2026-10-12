import { useEffect, useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import * as customersApi from '../api/customers';
import type { Customer } from '../api/customers';

/** True when a person lacks a first name, a last name or an email. */
export function hasMissingDetails(person: Pick<Customer, 'first_name' | 'last_name' | 'email'> | null | undefined): boolean {
  if (!person) return false;
  return !person.email || !(person.first_name || '').trim() || !(person.last_name || '').trim();
}

/**
 * Asks for the details a person is still missing (name, email) the first time they book or
 * buy, because bookings and invoices need them (Phase 46 R2). Shows nothing for a complete
 * profile. Only the missing fields are asked for; what is already known is not touched.
 */
export function MissingDetailsPrompt({ customerId, businessId, person: given, onCompleted }: {
  customerId: string;
  businessId: string;
  /** The person, when the caller already has them; otherwise they are loaded here. */
  person?: Customer | null;
  onCompleted?: (person: Customer) => void;
}) {
  const [person, setPerson] = useState<Customer | null>(given || null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setForm({ first_name: '', last_name: '', email: '' });
    if (given) { setPerson(given); return; }
    let cancelled = false;
    setPerson(null);
    customersApi.getCustomer(customerId, businessId).then((p) => { if (!cancelled) setPerson(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [customerId, businessId, given]);

  if (!person || !hasMissingDetails(person)) return null;

  const missing = {
    first_name: !(person.first_name || '').trim(),
    last_name: !(person.last_name || '').trim(),
    email: !person.email,
  };
  const ready = (!missing.first_name || form.first_name.trim()) && (!missing.last_name || form.last_name.trim()) && (!missing.email || form.email.trim());

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      const data: Record<string, string> = {};
      if (missing.first_name) data.first_name = form.first_name.trim();
      if (missing.last_name) data.last_name = form.last_name.trim();
      if (missing.email) data.email = form.email.trim();
      const updated = await customersApi.updateCustomer(person.id, businessId, data);
      setPerson(updated);
      onCompleted?.(updated);
    } catch (err: any) {
      setError(err.response?.data?.error || 'These details could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: 'first_name' | 'last_name' | 'email', label: string, type = 'text') => missing[key] && (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        style={styles.input} type={type} value={form[key]} aria-label={label}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
      />
    </label>
  );

  return (
    <div style={styles.box} role="group" aria-label="Missing details">
      <strong style={styles.title}>A few details are missing</strong>
      <span style={styles.hint}>Bookings and invoices need a name and an email. Please complete them now.</span>
      <div style={styles.row}>
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('email', 'Email', 'email')}
        <Button type="button" size="sm" disabled={!ready} loading={saving} onClick={save}>Save details</Button>
      </div>
      {error && <span style={styles.error} role="alert">{error}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: 'var(--space-md)', marginTop: 'var(--space-sm)',
    border: '1px solid var(--color-warning, #b54708)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
  },
  title: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  row: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  input: {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
    color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)',
  },
  error: { fontSize: 'var(--font-size-xs)', color: 'var(--color-error, #b42318)' },
};
