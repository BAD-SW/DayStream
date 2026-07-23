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
      navigate('/business?tab=locations');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to deactivate');
    }
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!location) return <div style={styles.loading}>Location not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=locations')}>← Back to Business</button>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xl)', marginTop: 'var(--space-xl)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-lg)' }}>
        <LocationHoursSection locationId={location.id} />
        <LocationHourOverridesSection locationId={location.id} />
      </div>
    </div>
  );
}

// --- Location Hours Section ---

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function LocationHoursSection({ locationId }: { locationId: string }) {
  const [hours, setHours] = useState<Array<{ day_of_week: number; is_closed: boolean; open_time: string; close_time: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    locationsApi.getLocationHours(locationId).then((data) => {
      // Fill all 7 days, using data where available
      const filled = DAY_NAMES.map((_, i) => {
        const existing = data.find((h) => h.day_of_week === i);
        return {
          day_of_week: i,
          is_closed: existing ? existing.is_closed : true,
          open_time: existing?.open_time?.slice(0, 5) || '09:00',
          close_time: existing?.close_time?.slice(0, 5) || '17:00',
        };
      });
      setHours(filled);
    }).finally(() => setLoading(false));
  }, [locationId]);

  const updateDay = (dayIndex: number, field: string, value: any) => {
    setHours(hours.map((h) => h.day_of_week === dayIndex ? { ...h, [field]: value } : h));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await locationsApi.setLocationHours(locationId, hours);
      setDirty(false);
    } catch { alert('Failed to save hours'); }
    finally { setSaving(false); }
  };

  if (loading) return null;

  return (
    <div style={styles.hoursSection}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={styles.hoursTitle}>Hours of Operation</h3>
        {dirty && <Button size="sm" onClick={handleSave} loading={saving}>Save Hours</Button>}
      </div>
      <div style={styles.hoursGrid}>
        {hours.map((day) => (
          <div key={day.day_of_week} style={styles.hoursRow}>
            <span style={styles.dayLabel}>{DAY_NAMES[day.day_of_week]}</span>
            <label style={styles.closedToggle}>
              <input type="checkbox" checked={!day.is_closed} onChange={(e) => updateDay(day.day_of_week, 'is_closed', !e.target.checked)} style={{ width: '14px', height: '14px' }} />
              Open
            </label>
            {!day.is_closed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="time" style={styles.timeInput} value={day.open_time} onChange={(e) => updateDay(day.day_of_week, 'open_time', e.target.value)} />
                <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                <input type="time" style={styles.timeInput} value={day.close_time} onChange={(e) => updateDay(day.day_of_week, 'close_time', e.target.value)} />
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Location Hour Overrides Section ---

function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function LocationHourOverridesSection({ locationId }: { locationId: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [yearOptions, setYearOptions] = useState<number[]>([currentYear]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
  const [saving, setSaving] = useState(false);

  const fetchYears = async () => {
    const years = await locationsApi.getLocationHourOverrideYears(locationId);
    // Always include current year
    const combined = Array.from(new Set([...years, currentYear])).sort();
    setYearOptions(combined);
  };

  const fetchOverrides = async (y: number) => {
    setLoading(true);
    locationsApi.getLocationHourOverrides(locationId, y).then(setOverrides).finally(() => setLoading(false));
  };

  useEffect(() => { fetchYears(); }, [locationId]);
  useEffect(() => { fetchOverrides(year); }, [locationId, year]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const openAdd = () => {
    setEditingId(null);
    setForm({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
    setShowAdd(true);
  };

  const openEdit = (o: any) => {
    setEditingId(o.id);
    setForm({
      override_date: o.override_date.split('T')[0],
      label: o.label || '',
      is_closed: o.is_closed,
      open_time: o.open_time ? o.open_time.slice(0, 5) : '09:00',
      close_time: o.close_time ? o.close_time.slice(0, 5) : '17:00',
    });
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!form.override_date) return;
    setSaving(true);
    try {
      await locationsApi.saveLocationHourOverride(locationId, {
        override_date: form.override_date,
        label: form.label || undefined,
        is_closed: form.is_closed,
        open_time: form.is_closed ? undefined : form.open_time,
        close_time: form.is_closed ? undefined : form.close_time,
      });
      setShowAdd(false);
      setEditingId(null);
      setForm({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
      fetchOverrides(year);
      fetchYears();
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this holiday override?')) return;
    await locationsApi.deleteLocationHourOverride(locationId, id);
    fetchOverrides(year);
  };

  return (
    <div style={styles.hoursSection}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={styles.hoursTitle}>Holiday & Special Hours</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select style={{ ...styles.timeInput, width: '90px' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={openAdd}>Add</Button>
        </div>
      </div>

      {showAdd && (
        <div style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Date *</label>
              <input type="date" style={styles.timeInput} value={form.override_date} onChange={(e) => setForm({ ...form, override_date: e.target.value })} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Label (e.g. Christmas Day)</label>
              <input style={styles.timeInput} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_closed} onChange={(e) => setForm({ ...form, is_closed: e.target.checked })} style={{ width: '14px', height: '14px' }} />
            Closed all day
          </label>
          {!form.is_closed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="time" style={styles.timeInput} value={form.open_time} onChange={(e) => setForm({ ...form, open_time: e.target.value })} />
              <span style={{ color: 'var(--color-text-muted)' }}>–</span>
              <input type="time" style={styles.timeInput} value={form.close_time} onChange={(e) => setForm({ ...form, close_time: e.target.value })} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" onClick={handleSave} loading={saving}>{editingId ? 'Save Changes' : 'Save'}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setEditingId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Loading...</p> :
       overrides.length === 0 ? <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No holiday overrides for {year}.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {overrides.map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', minWidth: '50px' }}>
                {new Date(o.override_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              {o.label && <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', flex: 1 }}>{o.label}</span>}
              {!o.label && <span style={{ flex: 1 }} />}
              {o.is_closed ? (
                <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', background: 'var(--color-error-bg, rgba(211,47,47,0.1))', color: 'var(--color-error)' }}>Closed</span>
              ) : (
                <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>{formatTime(o.open_time)}–{formatTime(o.close_time)}</span>
              )}
              <button onClick={() => openEdit(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px' }}>✏️</button>
              <button onClick={() => handleDelete(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px' }}>🗑️</button>
            </div>
          ))}
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
  hoursSection: {},
  hoursTitle: { margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  hoursGrid: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  hoursRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minHeight: '36px' },
  dayLabel: { width: '100px', fontSize: 'var(--font-size-sm)', fontWeight: 500 as any, color: 'var(--color-text)' },
  closedToggle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', cursor: 'pointer', width: '60px' },
  timeInput: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', width: '120px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
};
