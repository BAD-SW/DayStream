import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, useDraftSections, useDraft, useDraftList, fieldMark, checkMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { apiClient } from '../api/client';
import * as locationsApi from '../api/locations';
import type { Location } from '../api/locations';
import { parseDateOnly } from '../utils/date';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
  temporarily_closed: 'warning',
};

// One Save for the location (David, 2026-11-02, as in Settings, Events and People): details,
// hours, holiday hours and staff wait for Save changes; Set Primary and Deactivate act straight away.
export function LocationDetail() {
  return (
    <DraftSectionsProvider>
      <LocationDetailPage />
    </DraftSectionsProvider>
  );
}

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

function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const { dirtySections } = useDraftSections();

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    locationsApi.getLocation(id, businessId)
      .then(setLocation)
      .catch(() => setLocation(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

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
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => guardedNavigate('/business?tab=locations')}>← Back to Business</button>

        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h1 style={styles.title}>{location.name}</h1>
            <div style={styles.badges}>
              {location.is_primary && <Badge variant="info">Primary</Badge>}
              <Badge variant={STATUS_VARIANTS[location.status] || 'neutral'}>{location.status.replace('_', ' ')}</Badge>
            </div>
          </div>
          <div style={styles.headerActions}>
            <SaveChanges />
            {!location.is_primary && location.status === 'active' && (
              <Button size="sm" variant="outline" onClick={handleSetPrimary}>Set Primary</Button>
            )}
            {location.status === 'active' && !location.is_primary && (
              <Button size="sm" variant="outline" onClick={handleDeactivate}>Deactivate</Button>
            )}
          </div>
        </div>
      </StickyPageTop>

      <LocationDetailsForm location={location} businessId={businessId} onUpdate={setLocation} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xl)', marginTop: 'var(--space-xl)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-lg)' }}>
        <LocationHoursSection locationId={location.id} />
        <LocationHourOverridesSection locationId={location.id} />
      </div>

      <LocationStaffSection locationId={location.id} businessId={businessId} />
    </div>
  );
}

// --- Location details (always editable; saved with the page's Save changes) ---

function LocationDetailsForm({ location, businessId, onUpdate }: { location: Location; businessId: string; onUpdate: (l: Location) => void }) {
  const draft = useDraft('location-details', 'Location details', toForm(location), async (form) => {
    const updated = await locationsApi.updateLocation(location.id, businessId, form);
    onUpdate(updated);
    return toForm(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const changed = (key: keyof typeof form) => draft.changed((v) => v[key]);

  return (
    <div style={{ ...styles.editSection, ...draftBox(draft.dirty) }}>
      <h3 style={{ ...styles.hoursTitle, marginBottom: 'var(--space-md)' }}>Details<UnsavedTag dirty={draft.dirty} /></h3>
      <div style={styles.formGrid}>
        <FormField label="Name *" value={form.name} changed={changed('name')} onChange={(v) => setForm({ ...form, name: v })} />
        <FormField label="Phone" value={form.phone} changed={changed('phone')} onChange={(v) => setForm({ ...form, phone: v })} />
        <FormField label="Email" value={form.email} changed={changed('email')} onChange={(v) => setForm({ ...form, email: v })} />
        <FormField label="Timezone" value={form.timezone} changed={changed('timezone')} onChange={(v) => setForm({ ...form, timezone: v })} placeholder="e.g. America/New_York" />
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={styles.label}>Status</label>
          <select style={{ ...styles.input, ...fieldMark(changed('status')) }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="temporarily_closed">Temporarily Closed</option>
          </select>
        </div>
        <FormField label="Address Line 1" value={form.address_line1} changed={changed('address_line1')} onChange={(v) => setForm({ ...form, address_line1: v })} span2 />
        <FormField label="Address Line 2" value={form.address_line2} changed={changed('address_line2')} onChange={(v) => setForm({ ...form, address_line2: v })} span2 />
        <FormField label="City" value={form.city} changed={changed('city')} onChange={(v) => setForm({ ...form, city: v })} />
        <FormField label="State/Province" value={form.state_province} changed={changed('state_province')} onChange={(v) => setForm({ ...form, state_province: v })} />
        <FormField label="Postal Code" value={form.postal_code} changed={changed('postal_code')} onChange={(v) => setForm({ ...form, postal_code: v })} />
        <FormField label="Country (2-letter)" value={form.country} changed={changed('country')} onChange={(v) => setForm({ ...form, country: v })} />
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={styles.label}>Description</label>
          <textarea
            style={{ ...styles.input, minHeight: '80px', ...fieldMark(changed('description')) }}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
      {location.staff_count !== undefined && (
        <div style={{ ...styles.detailGrid, marginTop: 'var(--space-md)' }}>
          <Field label="Staff Assigned" value={String(location.staff_count)} />
          <Field label="Services Offered" value={String(location.service_count)} />
          <Field label="Resources" value={String(location.resource_count)} />
        </div>
      )}
    </div>
  );
}

// --- Location Hours Section (saved with the page's Save changes) ---

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type DayHours = { day_of_week: number; is_closed: boolean; open_time: string; close_time: string };

function LocationHoursSection({ locationId }: { locationId: string }) {
  const [loading, setLoading] = useState(true);
  const draft = useDraft<DayHours[]>('location-hours', 'Hours of operation', [], async (hours) => {
    await locationsApi.setLocationHours(locationId, hours);
  });
  const hours = draft.value;

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
      draft.load(filled);
    }).finally(() => setLoading(false));
  }, [locationId, draft.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDay = (dayIndex: number, field: string, value: any) => {
    draft.setValue(hours.map((h) => h.day_of_week === dayIndex ? { ...h, [field]: value } : h));
  };
  const dayChanged = (dayIndex: number, field: keyof DayHours) => draft.changed((v) => v.find((h) => h.day_of_week === dayIndex)?.[field]);

  if (loading) return null;

  return (
    <div style={{ ...styles.hoursSection, ...draftBox(draft.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={styles.hoursTitle}>Hours of Operation<UnsavedTag dirty={draft.dirty} /></h3>
      </div>
      <div style={styles.hoursGrid}>
        {hours.map((day) => (
          <div key={day.day_of_week} style={styles.hoursRow}>
            <span style={styles.dayLabel}>{DAY_NAMES[day.day_of_week]}</span>
            <label style={styles.closedToggle}>
              <input type="checkbox" checked={!day.is_closed} onChange={(e) => updateDay(day.day_of_week, 'is_closed', !e.target.checked)} style={{ width: '14px', height: '14px', ...checkMark(dayChanged(day.day_of_week, 'is_closed')) }} />
              Open
            </label>
            {!day.is_closed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="time" style={{ ...styles.timeInput, ...fieldMark(dayChanged(day.day_of_week, 'open_time')) }} value={day.open_time} onChange={(e) => updateDay(day.day_of_week, 'open_time', e.target.value)} />
                <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                <input type="time" style={{ ...styles.timeInput, ...fieldMark(dayChanged(day.day_of_week, 'close_time')) }} value={day.close_time} onChange={(e) => updateDay(day.day_of_week, 'close_time', e.target.value)} />
              </div>
            ) : (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Location Hour Overrides Section (saved with the page's Save changes) ---

function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const overrideData = (o: any) => ({
  override_date: String(o.override_date).split('T')[0],
  label: o.label || undefined,
  is_closed: o.is_closed,
  open_time: o.is_closed ? undefined : String(o.open_time).slice(0, 5),
  close_time: o.is_closed ? undefined : String(o.close_time).slice(0, 5),
});

function LocationHourOverridesSection({ locationId }: { locationId: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [yearOptions, setYearOptions] = useState<number[]>([currentYear]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
  // Holiday hours are stored by date: saving one for a date replaces what that date had.
  const list = useDraftList<any>('location-overrides', 'Holiday & special hours', {
    create: (o) => locationsApi.saveLocationHourOverride(locationId, overrideData(o)).then((saved: any) => ({ ...o, ...(saved || {}) })),
    update: async (o, before) => {
      // A changed date moves the entry: the old date is cleared, the new one saved.
      if (overrideData(o).override_date !== overrideData(before).override_date) await locationsApi.deleteLocationHourOverride(locationId, o.id);
      const saved: any = await locationsApi.saveLocationHourOverride(locationId, overrideData(o));
      return { ...o, ...(saved || {}) };
    },
    remove: (o) => locationsApi.deleteLocationHourOverride(locationId, o.id).then(() => undefined),
  });

  const fetchYears = useCallback(async () => {
    const years = await locationsApi.getLocationHourOverrideYears(locationId);
    // Always include current year
    const combined = Array.from(new Set([...years, currentYear])).sort();
    setYearOptions(combined);
  }, [locationId, currentYear]);

  useEffect(() => { fetchYears(); }, [fetchYears]);
  useEffect(() => {
    setLoading(true);
    locationsApi.getLocationHourOverrides(locationId, year).then(list.load).finally(() => setLoading(false));
  }, [locationId, year, list.load]);

  const [editingKey, setEditingKey] = useState<string | null>(null);

  const openAdd = () => {
    setEditingKey(null);
    setForm({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
    setShowAdd(true);
  };

  const openEdit = (key: string, o: any) => {
    setEditingKey(key);
    setForm({
      override_date: String(o.override_date).split('T')[0],
      label: o.label || '',
      is_closed: o.is_closed,
      open_time: o.open_time ? o.open_time.slice(0, 5) : '09:00',
      close_time: o.close_time ? o.close_time.slice(0, 5) : '17:00',
    });
    setShowAdd(true);
  };

  const handleDone = () => {
    if (!form.override_date) return;
    const data = {
      override_date: form.override_date,
      label: form.label || null,
      is_closed: form.is_closed,
      open_time: form.is_closed ? null : form.open_time,
      close_time: form.is_closed ? null : form.close_time,
    };
    if (editingKey) list.edit(editingKey, data);
    else list.add(data);
    setShowAdd(false);
    setEditingKey(null);
    setForm({ override_date: '', label: '', is_closed: false, open_time: '09:00', close_time: '17:00' });
  };

  return (
    <div style={{ ...styles.hoursSection, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={styles.hoursTitle}>Holiday & Special Hours<UnsavedTag dirty={list.dirty} /></h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Another year shows other entries: first save or undo the changes on this one. */}
          <select style={{ ...styles.timeInput, width: '90px' }} value={year} disabled={list.dirty} title={list.dirty ? 'Save or undo the changes first' : undefined} onChange={(e) => setYear(Number(e.target.value))}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' }}>
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
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Saved with the page's Save changes.</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" onClick={handleDone}>{editingKey ? 'Done' : 'Add'}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setEditingKey(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Loading...</p> :
       list.rows.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>No holiday overrides for {year}.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {list.rows.map((r) => {
            const o = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, overrideData);
            return (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--color-border)', opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', minWidth: '50px', textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  {parseDateOnly(o.override_date)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flex: 1 }}>
                  {o.label}
                  {r.isNew && <> <RowTag>New</RowTag></>}
                  {edited && <> <RowTag>Changed</RowTag></>}
                  {r.deleted && <> <RowTag>Deleted when you save</RowTag></>}
                </span>
                {o.is_closed ? (
                  <span style={{ fontSize: 'var(--font-size-sm)', padding: '2px 8px', borderRadius: '4px', background: 'var(--color-error-bg, rgba(211,47,47,0.1))', color: 'var(--color-error)' }}>Closed</span>
                ) : (
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>{formatTime(o.open_time)}–{formatTime(o.close_time)}</span>
                )}
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                  <button onClick={() => openEdit(r.key, o)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '2px' }}>✏️</button>
                  <button onClick={() => list.remove(r.key)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '2px' }}>🗑️</button>
                </>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Location Staff Section (saved with the page's Save changes) ---

function LocationStaffSection({ locationId, businessId }: { locationId: string; businessId: string }) {
  const [allStaff, setAllStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const list = useDraftList<any>('location-staff', 'Staff at this location', {
    // Assigning returns nothing: the row is known by its staff member until the page is reloaded.
    create: (s) => locationsApi.assignStaffToLocation(locationId, s.staff_id).then(() => ({ ...s, id: `staff-${s.staff_id}` })),
    remove: (s) => locationsApi.removeStaffFromLocation(locationId, s.staff_id).then(() => undefined),
  });

  useEffect(() => {
    setLoading(true);
    locationsApi.getLocationStaff(locationId).then(list.load).finally(() => setLoading(false));
  }, [locationId, list.load]);

  const openAdd = async () => {
    // Fetch all business staff to show unassigned ones
    try {
      const res = await apiClient.get(`/v1/schedule/staff?business_id=${businessId}`);
      setAllStaff(res.data.data || []);
    } catch { /* silent */ }
    setSelectedStaffId('');
    setShowAdd(true);
  };

  const handleAssign = () => {
    if (!selectedStaffId) return;
    const s = allStaff.find((x) => x.id === selectedStaffId);
    list.add({ staff_id: selectedStaffId, first_name: s?.first_name, last_name: s?.last_name });
    setShowAdd(false);
  };

  // Filter out already-assigned staff from the add dropdown
  const assignedIds = list.rows.filter((r) => !r.deleted).map((r) => r.item.staff_id);
  const availableStaff = allStaff.filter((s) => !assignedIds.includes(s.id));

  return (
    <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-lg)', ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={styles.hoursTitle}>Staff at this Location<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={openAdd}>Add Staff</Button>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <select style={{ ...styles.timeInput, width: '220px' }} value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
            <option value="">Select staff member...</option>
            {availableStaff.map((s: any) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
          </select>
          <Button size="sm" onClick={handleAssign}>Assign</Button>
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
        </div>
      )}

      {loading ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Loading...</p> :
       list.rows.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>No staff assigned to this location.</p> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {list.rows.map((r) => {
            const s = r.item;
            return (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', opacity: r.deleted ? 0.6 : 1 }}>
                <span style={{ textDecoration: r.deleted ? 'line-through' : 'none' }}>{s.first_name} {s.last_name}</span>
                {r.isNew && <RowTag>New</RowTag>}
                {r.deleted
                  ? <><RowTag>Removed when you save</RowTag><button onClick={() => list.undo(r.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>Undo</button></>
                  : <button onClick={() => list.remove(r.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '0 2px', color: 'var(--color-text-muted)' }} title="Remove">×</button>}
              </div>
            );
          })}
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

function FormField({ label, value, onChange, placeholder, span2, changed }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; span2?: boolean; changed?: boolean;
}) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : {}}>
      <label style={styles.label}>{label}</label>
      <input style={{ ...styles.input, ...fieldMark(!!changed) }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  headerLeft: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)' },
  headerActions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  title: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
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
  closedToggle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', width: '60px' },
  timeInput: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', width: '120px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
};
