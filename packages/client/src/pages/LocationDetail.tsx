import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as locationsApi from '../api/locations';
import type { Location } from '../api/locations';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
  temporarily_closed: 'warning',
};

export function LocationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    locationsApi.getLocation(id, businessId)
      .then((loc) => { setLocation(loc); setForm(toForm(loc)); })
      .catch(() => setLocation(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

  function toForm(loc: Location) {
    return {
      name: loc.name || '',
      phone: loc.phone || '',
      email: loc.email || '',
      timezone: loc.timezone || '',
      address_line1: loc.address_line1 || '',
      address_line2: loc.address_line2 || '',
      city: loc.city || '',
      state_province: loc.state_province || '',
      postal_code: loc.postal_code || '',
      country: loc.country || '',
      description: loc.description || '',
      status: loc.status || 'active',
    };
  }

  const handleSave = async () => {
    if (!id || !location) return;
    setSaving(true);
    try {
      const updated = await locationsApi.updateLocation(id, businessId, form);
      setLocation(updated);
      setForm(toForm(updated));
      setEditing(false);
    } catch {
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async () => {
    if (!id) return;
    try {
      const updated = await locationsApi.updateLocation(id, businessId, { is_primary: true });
      setLocation(updated);
    } catch {
      alert('Failed to set as primary');
    }
  };

  const handleDeactivate = async () => {
    if (!id || !confirm('Deactivate this location?')) return;
    try {
      await locationsApi.deactivateLocation(id, businessId);
      navigate('/business');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to deactivate');
    }
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!location) return <div style={styles.loading}>Location not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business')}>← Back to Business</button>

      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>{location.name}</h1>
          <div style={styles.badges}>
            {location.is_primary && <Badge variant="info">Primary</Badge>}
            <Badge variant={STATUS_VARIANTS[location.status] || 'neutral'}>{location.status.replace('_', ' ')}</Badge>
          </div>
        </div>
        <div style={styles.headerActions}>
          {!location.is_primary && location.status === 'active' && (
            <Button variant="outline" onClick={handleSetPrimary}>Set Primary</Button>
          )}
          {location.status === 'active' && !location.is_primary && (
            <Button variant="outline" onClick={handleDeactivate}>Deactivate</Button>
          )}
          {!editing && <Button onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>

      {!editing ? (
        <div style={styles.detailGrid}>
          <Field label="Name" value={location.name} />
          <Field label="Status" value={location.status} />
          <Field label="Phone" value={location.phone} />
          <Field label="Email" value={location.email} />
          <Field label="Timezone" value={location.timezone} />
          <Field label="Address" value={[location.address_line1, location.address_line2].filter(Boolean).join(', ')} />
          <Field label="City" value={location.city} />
          <Field label="State/Province" value={location.state_province} />
          <Field label="Postal Code" value={location.postal_code} />
          <Field label="Country" value={location.country} />
          {location.description && <Field label="Description" value={location.description} span2 />}
          {location.staff_count !== undefined && (
            <>
              <Field label="Staff Assigned" value={String(location.staff_count)} />
              <Field label="Services Offered" value={String(location.service_count)} />
              <Field label="Resources" value={String(location.resource_count)} />
            </>
          )}
        </div>
      ) : (
        <div style={styles.editSection}>
          <div style={styles.formGrid}>
            <FormField label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <FormField label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <FormField label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <FormField label="Timezone" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} placeholder="e.g. America/New_York" />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Status</label>
              <select style={styles.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="temporarily_closed">Temporarily Closed</option>
              </select>
            </div>
            <FormField label="Address Line 1" value={form.address_line1} onChange={(v) => setForm({ ...form, address_line1: v })} span2 />
            <FormField label="Address Line 2" value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} span2 />
            <FormField label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <FormField label="State/Province" value={form.state_province} onChange={(v) => setForm({ ...form, state_province: v })} />
            <FormField label="Postal Code" value={form.postal_code} onChange={(v) => setForm({ ...form, postal_code: v })} />
            <FormField label="Country (2-letter)" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Description</label>
              <textarea
                style={{ ...styles.input, minHeight: '80px' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <div style={styles.formActions}>
            <Button variant="outline" onClick={() => { setEditing(false); setForm(toForm(location)); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value?: string | null; span2?: boolean }) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : {}}>
      <span style={styles.label}>{label}</span>
      <span style={styles.fieldValue}>{value || '—'}</span>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, span2 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; span2?: boolean;
}) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : {}}>
      <label style={styles.label}>{label}</label>
      <input style={styles.input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  headerLeft: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)' },
  headerActions: { display: 'flex', gap: 'var(--space-sm)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  badges: { display: 'flex', gap: 'var(--space-xs)' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-md)' },
  editSection: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', background: 'var(--color-surface)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' },
  formActions: { display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any, display: 'block', marginBottom: '2px' },
  fieldValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', display: 'block' },
  input: { width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', boxSizing: 'border-box' as const },
};
