import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, useDraftList, fieldMark, checkMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import type { DraftRow } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import * as staffApi from '../api/staff';
import * as payrollApi from '../api/payroll';
import { formatDateOnly } from '../utils/date';
import type { StaffProfile, Qualification, AvailabilityPattern, AvailabilityOverride } from '../api/staff';

type Tab = 'profile' | 'qualifications' | 'availability' | 'calendar' | 'compensation';

/** Format a time string (HH:mm or HH:mm:ss) to locale format */
function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Labels on a row of a list kept as a draft. */
function RowTags<T>({ row, edited }: { row: DraftRow<T>; edited?: boolean }) {
  return <>
    {row.isNew && <> <RowTag>New</RowTag></>}
    {edited && <> <RowTag>Changed</RowTag></>}
    {row.deleted && <> <RowTag>Deleted when you save</RowTag></>}
  </>;
}

// One Save for the staff member (David, 2026-11-02, as in Settings, Events and People): profile,
// qualifications, availability and compensation wait for Save changes; Deactivate acts straight away.
export function StaffDetail() {
  return (
    <DraftSectionsProvider>
      <StaffDetailPage />
    </DraftSectionsProvider>
  );
}

function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(true);
  const { dirtySections } = useDraftSections();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    staffApi.getStaff(id).then(setStaff).catch(() => navigate('/business?tab=staff')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!staff) return <div style={styles.loading}>Staff not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'qualifications', label: 'Qualifications' },
    { key: 'availability', label: 'Availability' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'compensation', label: 'Compensation' },
  ];

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => guardedNavigate('/business?tab=staff')}>← Back to Business Setup</button>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>{staff.first_name} {staff.last_name}</h1>
            <span style={styles.subtitle}>{staff.staff_ref} · {staff.employment_type.replace('_', ' ')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <SaveChanges />
            <Badge variant={staff.status === 'active' ? 'success' : 'warning'}>{staff.status}</Badge>
          </div>
        </div>
        <TabBar aria-label="Staff sections" tabs={tabs.map((t) => ({ ...t, changed: dirtySections.some((s) => s.tab === t.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>

      {/* Tabs with drafts stay mounted, so their edits survive switching tabs. */}
      <div style={{ marginTop: 'var(--space-lg)' }}>
        <div hidden={activeTab !== 'profile'}><DraftTab tab="profile"><ProfileTab staff={staff} onUpdate={setStaff} /></DraftTab></div>
        <div hidden={activeTab !== 'qualifications'}><DraftTab tab="qualifications"><QualificationsTab staffId={staff.id} /></DraftTab></div>
        <div hidden={activeTab !== 'availability'}><DraftTab tab="availability"><AvailabilityTab staffId={staff.id} /></DraftTab></div>
        {activeTab === 'calendar' && <CalendarTab staffId={staff.id} />}
        <div hidden={activeTab !== 'compensation'}><DraftTab tab="compensation"><CompensationTab userId={staff.user_id} /></DraftTab></div>
      </div>
    </div>
  );
}

// --- Profile Tab (Editable; saved with the page's Save changes) ---

function ProfileTab({ staff, onUpdate }: { staff: StaffProfile; onUpdate: (s: StaffProfile) => void }) {
  const fromStaff = (s: StaffProfile) => ({
    first_name: s.first_name,
    last_name: s.last_name,
    email: s.email || '',
    mobile_phone: s.mobile_phone || '',
    employment_type: s.employment_type,
    hire_date: s.hire_date ? s.hire_date.split('T')[0] : '',
    languages: s.languages || '',
    bio: s.bio || '',
    show_on_directory: s.show_on_directory,
  });
  const draft = useDraft('staff-profile', 'Profile', fromStaff(staff), async (form) => {
    const updated = await staffApi.updateStaff(staff.id, {
      ...form,
      hire_date: form.hire_date || null,
      mobile_phone: form.mobile_phone || null,
      languages: form.languages || null,
      bio: form.bio || null,
    });
    onUpdate(updated);
    return fromStaff(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));
  const [error, setError] = useState('');

  const handleDeactivate = async () => {
    if (!confirm('Deactivate this staff member? They will no longer be bookable.')) return;
    setError('');
    try {
      const updated = await staffApi.deactivateStaff(staff.id);
      onUpdate(updated);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to deactivate'); }
  };

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}
      <div style={{ ...styles.card, ...draftBox(draft.changed((v) => [v.first_name, v.last_name, v.email, v.mobile_phone, v.languages])) }}>
        <h3 style={styles.cardTitle}>Personal Information</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>First Name</label>
            <input style={{ ...styles.input, ...mark('first_name') }} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Last Name</label>
            <input style={{ ...styles.input, ...mark('last_name') }} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input type="email" style={{ ...styles.input, ...mark('email') }} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Mobile Phone</label>
            <input style={{ ...styles.input, ...mark('mobile_phone') }} value={form.mobile_phone} onChange={(e) => setForm({ ...form, mobile_phone: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Languages</label>
            <input style={{ ...styles.input, ...mark('languages') }} value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} placeholder="e.g., English, Spanish" />
          </div>
        </div>
      </div>

      <div style={{ ...styles.card, ...draftBox(draft.changed((v) => [v.employment_type, v.hire_date])) }}>
        <h3 style={styles.cardTitle}>Employment</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Employment Type</label>
            <select style={{ ...styles.input, ...mark('employment_type') }} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Hire Date</label>
            <input type="date" style={{ ...styles.input, ...mark('hire_date') }} value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={{ ...styles.card, ...draftBox(draft.changed((v) => [v.bio, v.show_on_directory])) }}>
        <h3 style={styles.cardTitle}>Public Profile</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Bio</label>
            <textarea style={{ ...styles.input, minHeight: '100px', resize: 'vertical', ...mark('bio') }} value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Public-facing bio shown to customers..." />
          </div>
          <div style={styles.formGroup}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.show_on_directory} onChange={(e) => setForm({ ...form, show_on_directory: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.show_on_directory)) }} />
              Show on public directory
            </label>
          </div>
        </div>
      </div>

      {staff.status === 'active' && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <Button variant="destructive" onClick={handleDeactivate}>Deactivate Staff Member</Button>
        </div>
      )}
    </>
  );
}

// --- Qualifications Tab (saved with the page's Save changes) ---

const qualData = (q: Qualification) => ({
  name: q.name, issuing_body: q.issuing_body || null, certification_number: q.certification_number || null,
  date_obtained: q.date_obtained ? q.date_obtained.split('T')[0] : null, expiry_date: q.expiry_date ? q.expiry_date.split('T')[0] : null,
  show_on_directory: q.show_on_directory,
});

function QualificationsTab({ staffId }: { staffId: string }) {
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', issuing_body: '', certification_number: '', date_obtained: '', expiry_date: '', show_on_directory: true });
  const list = useDraftList<Qualification>('staff-qualifications', 'Qualifications', {
    create: (q) => staffApi.addQualification(staffId, qualData(q)),
    update: (q) => staffApi.updateQualification(staffId, q.id, qualData(q)),
    remove: (q) => staffApi.deleteQualification(staffId, q.id).then(() => undefined),
  });

  const fetchQuals = useCallback(async () => {
    setLoading(true);
    staffApi.getQualifications(staffId).then(list.load).finally(() => setLoading(false));
  }, [staffId, list.load]);

  useEffect(() => { fetchQuals(); }, [fetchQuals]);

  const openAdd = () => { setEditingKey(null); setForm({ name: '', issuing_body: '', certification_number: '', date_obtained: '', expiry_date: '', show_on_directory: true }); setShowForm(true); };
  const openEdit = (key: string, q: Qualification) => {
    setEditingKey(key);
    setForm({ name: q.name, issuing_body: q.issuing_body || '', certification_number: q.certification_number || '', date_obtained: q.date_obtained ? q.date_obtained.split('T')[0] : '', expiry_date: q.expiry_date ? q.expiry_date.split('T')[0] : '', show_on_directory: q.show_on_directory });
    setShowForm(true);
  };

  const handleDone = () => {
    if (!form.name) return;
    const data = { ...form, issuing_body: form.issuing_body || null, certification_number: form.certification_number || null, date_obtained: form.date_obtained || null, expiry_date: form.expiry_date || null } as unknown as Partial<Qualification>;
    if (editingKey) list.edit(editingKey, data);
    else list.add(data as Qualification);
    setShowForm(false);
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div style={draftBox(list.dirty)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Qualifications & Certifications<UnsavedTag dirty={list.dirty} /></h3>
        <Button variant="secondary" size="sm" onClick={openAdd}>Add Qualification</Button>
      </div>

      {showForm && (
        <div style={styles.card}>
          <h4 style={{ ...styles.cardTitle, fontSize: 'var(--font-size-base)' }}>{editingKey ? 'Edit Qualification' : 'Add Qualification'}</h4>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Issuing Body</label><input style={styles.input} value={form.issuing_body} onChange={(e) => setForm({ ...form, issuing_body: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Certification #</label><input style={styles.input} value={form.certification_number} onChange={(e) => setForm({ ...form, certification_number: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Date Obtained</label><input type="date" style={styles.input} value={form.date_obtained} onChange={(e) => setForm({ ...form, date_obtained: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Expiry Date</label><input type="date" style={styles.input} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
            <div style={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '20px' }}>
                <input type="checkbox" checked={form.show_on_directory} onChange={(e) => setForm({ ...form, show_on_directory: e.target.checked })} style={{ width: '16px', height: '16px' }} /> Show publicly
              </label>
            </div>
          </div>
          <p style={{ ...styles.emptyText, marginTop: 'var(--space-sm)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
            <Button size="sm" onClick={handleDone}>{editingKey ? 'Done' : 'Add'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {list.rows.length === 0 && !showForm && <p style={styles.emptyText}>No qualifications recorded. Add certifications, licenses, or training records.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const q = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, qualData);
            return (
              <div key={r.key} style={{ ...styles.listItem, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{q.name}</strong>
                  {q.issuing_body && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>— {q.issuing_body}</span>}
                  {q.certification_number && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>#{q.certification_number}</span>}
                  <RowTags row={r} edited={edited} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {q.expiry_date && <Badge variant={new Date(q.expiry_date) < new Date() ? 'error' : 'info'}>{`Exp: ${formatDateOnly(q.expiry_date)}`}</Badge>}
                  {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                    <button style={styles.iconBtn} onClick={() => openEdit(r.key, q)} title="Edit">✏️</button>
                    <button style={styles.iconBtn} onClick={() => list.remove(r.key)} title="Delete">🗑️</button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Availability Tab (patterns and overrides saved with the page's Save changes) ---

interface SlotEntry { day_of_week: number; start_time: string; end_time: string; }

const patternData = (p: AvailabilityPattern) => ({
  name: p.name,
  effective_from: p.effective_from ? p.effective_from.split('T')[0] : '',
  effective_to: p.effective_to ? p.effective_to.split('T')[0] : null,
  is_default: p.is_default,
  slots: (p.slots || []).map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })),
});

function AvailabilityTab({ staffId }: { staffId: string }) {
  const [loading, setLoading] = useState(true);
  const [showPatternForm, setShowPatternForm] = useState(false);
  const [editingPatternKey, setEditingPatternKey] = useState<string | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [patternForm, setPatternForm] = useState({ name: '', effective_from: '', effective_to: '', is_default: true });
  const [patternSlots, setPatternSlots] = useState<SlotEntry[]>([]);
  const [overrideForm, setOverrideForm] = useState({ override_date: '', start_time: '09:00', end_time: '17:00', override_type: 'remove' as 'remove' | 'modify' | 'add', reason: '' });
  const patterns = useDraftList<AvailabilityPattern>('staff-patterns', 'Weekly patterns', {
    create: (p) => staffApi.createAvailabilityPattern(staffId, patternData(p)),
    update: (p) => staffApi.updateAvailabilityPattern(staffId, p.id, patternData(p)),
    remove: (p) => staffApi.deleteAvailabilityPattern(staffId, p.id).then(() => undefined),
  });
  const overrides = useDraftList<AvailabilityOverride>('staff-overrides', 'Overrides & time off', {
    create: (o) => {
      const data: Record<string, any> = { override_date: o.override_date, override_type: o.override_type };
      if (o.override_type !== 'remove') { data.start_time = o.start_time; data.end_time = o.end_time; }
      if (o.reason) data.reason = o.reason;
      return staffApi.createAvailabilityOverride(staffId, data);
    },
    remove: (o) => staffApi.deleteAvailabilityOverride(staffId, o.id).then(() => undefined),
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    Promise.all([
      staffApi.getAvailabilityPatterns(staffId),
      staffApi.getAvailabilityOverrides(staffId),
    ]).then(([p, o]) => { patterns.load(p); overrides.load(o); }).finally(() => setLoading(false));
  }, [staffId, patterns.load, overrides.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbrev = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // --- Pattern Helpers ---
  const openPatternForm = () => {
    setEditingPatternKey(null);
    setPatternForm({ name: 'Default Schedule', effective_from: new Date().toISOString().split('T')[0], effective_to: '', is_default: true });
    setPatternSlots([]);
    setShowPatternForm(true);
  };

  const openEditPattern = (key: string, p: AvailabilityPattern) => {
    setEditingPatternKey(key);
    setPatternForm({
      name: p.name,
      effective_from: p.effective_from ? p.effective_from.split('T')[0] : '',
      effective_to: p.effective_to ? p.effective_to.split('T')[0] : '',
      is_default: p.is_default,
    });
    setPatternSlots(p.slots.map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })));
    setShowPatternForm(true);
  };

  const addSlot = (dayOfWeek: number) => {
    setPatternSlots([...patternSlots, { day_of_week: dayOfWeek, start_time: '09:00', end_time: '17:00' }]);
  };

  const updateSlot = (index: number, field: 'start_time' | 'end_time', value: string) => {
    const updated = [...patternSlots];
    updated[index] = { ...updated[index], [field]: value };
    setPatternSlots(updated);
  };

  const removeSlot = (index: number) => {
    setPatternSlots(patternSlots.filter((_, i) => i !== index));
  };

  const handlePatternDone = () => {
    if (!patternForm.name || !patternForm.effective_from) return;
    const data = {
      name: patternForm.name,
      effective_from: patternForm.effective_from,
      effective_to: patternForm.effective_to || null,
      is_default: patternForm.is_default,
      slots: patternSlots,
    } as unknown as AvailabilityPattern;
    if (editingPatternKey) patterns.edit(editingPatternKey, data);
    else patterns.add(data);
    setShowPatternForm(false);
    setEditingPatternKey(null);
  };

  // A copy is added like a new pattern: "(copy)", not default, same dates and hours.
  const handleCopyPattern = (p: AvailabilityPattern) => {
    patterns.add({ ...patternData(p), name: `${p.name} (copy)`, is_default: false } as unknown as AvailabilityPattern);
  };

  // --- Override Helpers ---
  const handleAddOverride = () => {
    if (!overrideForm.override_date) return;
    overrides.add({
      override_date: overrideForm.override_date,
      override_type: overrideForm.override_type,
      start_time: overrideForm.override_type !== 'remove' ? overrideForm.start_time : null,
      end_time: overrideForm.override_type !== 'remove' ? overrideForm.end_time : null,
      reason: overrideForm.reason || null,
    } as unknown as AvailabilityOverride);
    setShowOverrideForm(false);
    setOverrideForm({ override_date: '', start_time: '09:00', end_time: '17:00', override_type: 'remove', reason: '' });
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <>
      <div style={{ ...styles.card, ...draftBox(patterns.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Weekly Patterns<UnsavedTag dirty={patterns.dirty} /></h3>
          <Button variant="secondary" size="sm" onClick={openPatternForm}>Create Pattern</Button>
        </div>

        {showPatternForm && (
          <div style={{ ...styles.card, background: 'var(--color-background)', marginBottom: 'var(--space-md)' }}>
            <h4 style={{ ...styles.cardTitle, fontSize: 'var(--font-size-base)' }}>{editingPatternKey ? 'Edit Availability Pattern' : 'New Availability Pattern'}</h4>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}><label style={styles.label}>Pattern Name *</label><input style={styles.input} value={patternForm.name} onChange={(e) => setPatternForm({ ...patternForm, name: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Effective From *</label><input type="date" style={styles.input} value={patternForm.effective_from} onChange={(e) => setPatternForm({ ...patternForm, effective_from: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Effective To</label><input type="date" style={styles.input} value={patternForm.effective_to} onChange={(e) => setPatternForm({ ...patternForm, effective_to: e.target.value })} placeholder="Ongoing" /></div>
              <div style={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '20px' }}>
                  <input type="checkbox" checked={patternForm.is_default} onChange={(e) => setPatternForm({ ...patternForm, is_default: e.target.checked })} style={{ width: '16px', height: '16px' }} /> Default pattern
                </label>
              </div>
            </div>

            <div style={{ marginTop: 'var(--space-md)' }}>
              <label style={{ ...styles.label, marginBottom: '8px', display: 'block' }}>Working Hours</label>
              {dayNames.map((day, idx) => {
                const daySlots = patternSlots.filter((s) => s.day_of_week === idx);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', minHeight: '36px' }}>
                    <span style={{ width: '90px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' }}>{day}</span>
                    {daySlots.length === 0 ? (
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', flex: 1 }}>Off</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
                        {daySlots.map((slot) => {
                          const slotIndex = patternSlots.indexOf(slot);
                          return (
                            <div key={slotIndex} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input type="time" style={{ ...styles.input, width: '110px', padding: '6px 8px', fontSize: 'var(--font-size-sm)' }} value={slot.start_time} onChange={(e) => updateSlot(slotIndex, 'start_time', e.target.value)} />
                              <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                              <input type="time" style={{ ...styles.input, width: '110px', padding: '6px 8px', fontSize: 'var(--font-size-sm)' }} value={slot.end_time} onChange={(e) => updateSlot(slotIndex, 'end_time', e.target.value)} />
                              <button style={styles.iconBtn} onClick={() => removeSlot(slotIndex)} title="Remove">×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <button style={{ ...styles.iconBtn, fontSize: 'var(--font-size-lg)', color: 'var(--color-primary)' }} onClick={() => addSlot(idx)} title={`Add hours for ${day}`}>+</button>
                  </div>
                );
              })}
            </div>

            <p style={{ ...styles.emptyText, marginTop: 'var(--space-sm)' }}>Saved with the page's Save changes.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
              <Button size="sm" onClick={handlePatternDone}>{editingPatternKey ? 'Done' : 'Create Pattern'}</Button>
              <Button variant="secondary" size="sm" onClick={() => { setShowPatternForm(false); setEditingPatternKey(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {patterns.rows.length === 0 && !showPatternForm && <p style={styles.emptyText}>No availability patterns defined. Create one to set this staff member's working hours.</p>}
        {patterns.rows.map((r) => {
          const p = r.item;
          const edited = !r.isNew && !r.deleted && patterns.changed(r, patternData);
          return (
            <div key={r.key} style={{ ...styles.listItem, flexDirection: 'column', alignItems: 'stretch', padding: 'var(--space-md)', marginBottom: '8px', opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--color-text)', textDecoration: r.deleted ? 'line-through' : 'none' }}>{p.name}<RowTags row={r} edited={edited} /></strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{formatDateOnly(p.effective_from)} → {p.effective_to ? formatDateOnly(p.effective_to) : 'Ongoing'}</span>
                  {r.deleted ? <Button size="sm" variant="ghost" onClick={() => patterns.undo(r.key)}>Undo</Button> : <>
                    <button style={styles.iconBtn} onClick={() => openEditPattern(r.key, p)} title="Edit">✏️</button>
                    <Button variant="ghost" size="sm" onClick={() => handleCopyPattern(p)}>Copy</Button>
                    <button style={styles.iconBtn} onClick={() => patterns.remove(r.key)} title="Delete">🗑️</button>
                  </>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
                {dayAbbrev.map((day, idx) => {
                  const slots = (p.slots || []).filter((s) => s.day_of_week === idx);
                  return (
                    <div key={idx}>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{day}</div>
                      {slots.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>Off</div>
                      ) : (
                        slots.map((s, i) => (
                          <div key={i} style={{ color: 'var(--color-success, #2E7D32)' }}>{formatTime(s.start_time)}-{formatTime(s.end_time)}</div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ ...styles.card, ...draftBox(overrides.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Overrides & Time Off<UnsavedTag dirty={overrides.dirty} /></h3>
          <Button variant="secondary" size="sm" onClick={() => setShowOverrideForm(true)}>Add Override</Button>
        </div>

        {showOverrideForm && (
          <div style={{ ...styles.card, background: 'var(--color-background)', marginBottom: 'var(--space-md)' }}>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}><label style={styles.label}>Date *</label><input type="date" style={styles.input} value={overrideForm.override_date} onChange={(e) => setOverrideForm({ ...overrideForm, override_date: e.target.value })} /></div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Override Type *</label>
                <select style={styles.input} value={overrideForm.override_type} onChange={(e) => setOverrideForm({ ...overrideForm, override_type: e.target.value as any })}>
                  <option value="remove">Day off — fully unavailable</option>
                  <option value="modify">Change hours — different hours than normal</option>
                  <option value="add">Extra availability — working on a day normally off</option>
                </select>
              </div>
              <div style={styles.formGroup}><label style={styles.label}>Reason</label><input style={styles.input} value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} placeholder="Optional (e.g., covering for Sarah)" /></div>
            </div>
            {overrideForm.override_type !== 'remove' && (
              <div style={{ ...styles.formGrid, marginTop: 'var(--space-sm)' }}>
                <div style={styles.formGroup}><label style={styles.label}>Start Time *</label><input type="time" style={styles.input} value={overrideForm.start_time} onChange={(e) => setOverrideForm({ ...overrideForm, start_time: e.target.value })} /></div>
                <div style={styles.formGroup}><label style={styles.label}>End Time *</label><input type="time" style={styles.input} value={overrideForm.end_time} onChange={(e) => setOverrideForm({ ...overrideForm, end_time: e.target.value })} /></div>
              </div>
            )}
            <p style={{ ...styles.emptyText, marginTop: 'var(--space-sm)' }}>Saved with the page's Save changes.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
              <Button size="sm" onClick={handleAddOverride}>Add Override</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowOverrideForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {overrides.rows.length === 0 && !showOverrideForm && <p style={styles.emptyText}>No overrides scheduled.</p>}
        {overrides.rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {overrides.rows.map((r) => {
              const o = r.item;
              return (
                <div key={r.key} style={{ ...styles.listItem, opacity: r.deleted ? 0.6 : 1 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', textDecoration: r.deleted ? 'line-through' : 'none' }}>
                    <strong style={{ color: 'var(--color-text)' }}>{formatDateOnly(o.override_date)}</strong>
                    {o.override_type === 'remove' ? <Badge variant="warning">Day Off</Badge> : o.override_type === 'add' ? <Badge variant="success">Extra</Badge> : <Badge variant="info">Modified</Badge>}
                    {o.override_type !== 'remove' && o.start_time && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-success, #2E7D32)' }}>{formatTime(o.start_time)}–{formatTime(o.end_time!)}</span>}
                    {o.reason && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>({o.reason})</span>}
                    <RowTags row={r} />
                  </div>
                  {r.deleted ? <Button size="sm" variant="ghost" onClick={() => overrides.undo(r.key)}>Undo</Button>
                    : <button style={styles.iconBtn} onClick={() => overrides.remove(r.key)} title="Delete">🗑️</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// --- Calendar Tab ---

function CalendarTab({ staffId }: { staffId: string }) {
  const [calendar, setCalendar] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const start = today.toISOString().split('T')[0];
    const end = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    staffApi.getStaffCalendar(staffId, start, end).then(setCalendar).finally(() => setLoading(false));
  }, [staffId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!calendar) return <p style={styles.emptyText}>Failed to load calendar</p>;

  return (
    <>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>This Week's Appointments</h3>
        {calendar.bookings.length === 0 ? (
          <p style={styles.emptyText}>No appointments this week.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {calendar.bookings.map((b: any) => (
              <div key={b.id} style={styles.listItem}>
                <span style={{ color: 'var(--color-text)' }}>{b.serviceName} — {b.customerName || 'Walk-in'}</span>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{new Date(b.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {calendar.leave && calendar.leave.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Scheduled Leave</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {calendar.leave.map((l: any) => (
              <div key={l.id} style={styles.listItem}>
                <Badge variant="warning">{l.leaveType}</Badge>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>{l.startDate} → {l.endDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// --- Compensation Tab (rules saved with the page's Save changes) ---

const RULE_TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly Rate',
  per_session: 'Flat Rate',
  commission: 'Commission',
  salary: 'Salary',
};

const REF_TYPE_LABELS: Record<string, string> = {
  service: 'Service',
  product: 'Product',
  membership: 'Membership',
  package: 'Package',
};

interface CompensationRule {
  id: string;
  rule_type: string;
  rate: number;
  threshold_amount: number | null;
  reference_type: string | null;
  reference_ids: string[] | null;
  overtime_multiplier: number;
  overtime_after_hours: number;
  holiday_multiplier: number;
  hours_basis: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

interface OfferingItem { id: string; name: string; }

// What is stored for a rule (the type is fixed once the rule exists).
const ruleData = (r: CompensationRule) => ({
  rate: r.rate,
  threshold_amount: r.threshold_amount,
  reference_type: r.reference_type,
  reference_ids: r.reference_ids,
  overtime_multiplier: Number(r.overtime_multiplier),
  overtime_after_hours: Number(r.overtime_after_hours),
  holiday_multiplier: Number(r.holiday_multiplier),
  hours_basis: r.rule_type === 'hourly' ? r.hours_basis : null,
  effective_from: r.effective_from ? r.effective_from.split('T')[0] : '',
  effective_to: r.effective_to ? r.effective_to.split('T')[0] : null,
  status: r.status,
});

function CompensationTab({ userId }: { userId: string | null }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<{ key: string; rule: CompensationRule } | null>(null);
  const [offerings, setOfferings] = useState<Record<string, OfferingItem[]>>({ service: [], product: [], membership: [], package: [] });
  const list = useDraftList<CompensationRule>('staff-compensation', 'Compensation rules', {
    create: (r) => { const { status: _status, ...data } = ruleData(r); return payrollApi.createCompensationRule({ business_id: businessId, user_id: userId, rule_type: r.rule_type, ...data }); },
    update: (r) => payrollApi.updateCompensationRule(r.id, businessId, ruleData(r)),
    remove: (r) => payrollApi.deleteCompensationRule(r.id, businessId),
  });

  const emptyForm = {
    rule_type: 'hourly' as string,
    rate: '',
    threshold_amount: '',
    reference_type: '' as string,
    reference_ids: [] as string[],
    overtime_multiplier: '1.5',
    overtime_after_hours: '40',
    holiday_multiplier: '2.0',
    hours_basis: 'scheduled' as string, // hourly rules only: 'scheduled' | 'clocked'
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
  };
  const [form, setForm] = useState(emptyForm);

  const fetchRules = useCallback(async () => {
    if (!userId || !businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await payrollApi.getCompensationRules(businessId, userId);
      list.load(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [userId, businessId, list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRules(); }, [fetchRules]);

  useEffect(() => {
    if (!businessId) return;
    const loadOfferings = async () => {
      const [svcMod, { apiClient }] = await Promise.all([
        import('../api/services'),
        import('../api/client'),
      ]);
      const results: Record<string, OfferingItem[]> = { service: [], product: [], membership: [], package: [] };
      try { const r = await svcMod.getServices(businessId); const l = (r as any).data || r; results.service = Array.isArray(l) ? l.map((s: any) => ({ id: s.id, name: s.name })) : []; } catch {}
      try { const r = await apiClient.get(`/v1/merchandise?business_id=${businessId}&limit=100`); results.product = (r.data.data || []).map((p: any) => ({ id: p.id, name: p.name })); } catch {}
      try { const r = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}&limit=100`); results.membership = (r.data.data || []).map((m: any) => ({ id: m.id, name: m.name })); } catch {}
      try { const r = await apiClient.get(`/v1/packages?business_id=${businessId}&limit=100`); results.package = (r.data.data || []).map((p: any) => ({ id: p.id, name: p.name })); } catch {}
      setOfferings(results);
    };
    loadOfferings();
  }, [businessId]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (key: string, rule: CompensationRule) => {
    setEditing({ key, rule });
    setForm({
      rule_type: rule.rule_type,
      rate: String(rule.rate / 100),
      threshold_amount: rule.threshold_amount ? String(rule.threshold_amount / 100) : '',
      reference_type: rule.reference_type || '',
      reference_ids: rule.reference_ids || [],
      overtime_multiplier: String(rule.overtime_multiplier),
      overtime_after_hours: String(rule.overtime_after_hours),
      holiday_multiplier: String(rule.holiday_multiplier),
      hours_basis: rule.hours_basis || 'scheduled',
      effective_from: rule.effective_from ? rule.effective_from.split('T')[0] : '',
      effective_to: rule.effective_to ? rule.effective_to.split('T')[0] : '',
    });
    setShowForm(true);
  };

  const handleDone = () => {
    if (!form.rate || !form.effective_from) return;
    const data = {
      rule_type: form.rule_type,
      rate: Math.round(parseFloat(form.rate) * 100),
      threshold_amount: form.threshold_amount ? Math.round(parseFloat(form.threshold_amount) * 100) : null,
      reference_type: form.reference_type || null,
      reference_ids: form.reference_ids.length > 0 ? form.reference_ids : null,
      overtime_multiplier: parseFloat(form.overtime_multiplier),
      overtime_after_hours: parseInt(form.overtime_after_hours),
      holiday_multiplier: parseFloat(form.holiday_multiplier),
      hours_basis: form.rule_type === 'hourly' ? form.hours_basis : null,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
    };
    if (editing) list.edit(editing.key, data);
    else list.add({ ...data, status: 'active' } as CompensationRule);
    setShowForm(false);
  };

  const formatRate = (rule: CompensationRule) => {
    if (rule.rule_type === 'commission') {
      return `${(rule.rate / 100).toFixed(1)}%`;
    }
    return `€${(rule.rate / 100).toFixed(2)}`;
  };

  const formatRateLabel = (ruleType: string) => {
    switch (ruleType) {
      case 'hourly': return 'Rate (€/hour)';
      case 'per_session': return 'Rate (€/flat)';
      case 'commission': return 'Rate (%)';
      case 'salary': return 'Rate (€/period)';
      default: return 'Rate';
    }
  };

  const getRefNames = (rule: CompensationRule): string => {
    if (!rule.reference_type || !rule.reference_ids || rule.reference_ids.length === 0) return '';
    const items = offerings[rule.reference_type] || [];
    return rule.reference_ids.map((id) => items.find((i) => i.id === id)?.name || id.slice(0, 8)).join(', ');
  };

  const toggleReferenceId = (id: string) => {
    const current = form.reference_ids;
    if (current.includes(id)) {
      setForm({ ...form, reference_ids: current.filter((x) => x !== id) });
    } else {
      setForm({ ...form, reference_ids: [...current, id] });
    }
  };

  if (!userId) {
    return (
      <div style={styles.card}>
        <p style={styles.emptyText}>This staff member does not have an associated user account. Compensation rules require a linked user.</p>
      </div>
    );
  }

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div style={draftBox(list.dirty)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Compensation Rules<UnsavedTag dirty={list.dirty} /></h3>
        <Button variant="secondary" size="sm" onClick={openAdd}>Add Rule</Button>
      </div>

      {showForm && (
        <div style={styles.card}>
          <h4 style={{ ...styles.cardTitle, fontSize: 'var(--font-size-base)' }}>{editing ? 'Edit Compensation Rule' : 'Add Compensation Rule'}</h4>
          <div style={styles.formGrid}>
            {!editing && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Type *</label>
                <select style={styles.input} value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value, reference_type: '', reference_ids: [] })}>
                  <option value="hourly">Hourly Rate</option>
                  <option value="per_session">Flat Rate</option>
                  <option value="commission">Commission (%)</option>
                  <option value="salary">Salary</option>
                </select>
              </div>
            )}
            <div style={styles.formGroup}>
              <label style={styles.label}>{formatRateLabel(form.rule_type)} *</label>
              <input type="number" step="0.01" min="0" style={styles.input} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </div>
            {form.rule_type === 'commission' && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Threshold (€)</label>
                <input type="number" step="0.01" min="0" style={styles.input} value={form.threshold_amount} onChange={(e) => setForm({ ...form, threshold_amount: e.target.value })} placeholder="Revenue threshold before commission kicks in" />
              </div>
            )}
            {(form.rule_type === 'per_session' || form.rule_type === 'commission') && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Offering Type</label>
                  <select style={styles.input} value={form.reference_type} onChange={(e) => setForm({ ...form, reference_type: e.target.value, reference_ids: [] })}>
                    <option value="">— All (Generic) —</option>
                    <option value="service">Service</option>
                    <option value="product">Product</option>
                    <option value="membership">Membership</option>
                    <option value="package">Package</option>
                  </select>
                </div>
                {form.reference_type && (
                  <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
                    <label style={styles.label}>Specific {REF_TYPE_LABELS[form.reference_type] || 'Items'} (leave empty for all of this type)</label>
                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px', maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(offerings[form.reference_type] || []).length === 0 && (
                        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>No {form.reference_type}s found</span>
                      )}
                      {(offerings[form.reference_type] || []).map((item) => (
                        <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: form.reference_ids.includes(item.id) ? 'var(--color-surface-hover, rgba(255,255,255,0.05))' : 'transparent' }}>
                          <input type="checkbox" checked={form.reference_ids.includes(item.id)} onChange={() => toggleReferenceId(item.id)} style={{ width: '14px', height: '14px' }} />
                          {item.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {form.rule_type === 'hourly' && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Hours Based On *</label>
                  <select style={styles.input} value={form.hours_basis} onChange={(e) => setForm({ ...form, hours_basis: e.target.value })}>
                    <option value="scheduled">Scheduled hours</option>
                    <option value="clocked">Clocked hours</option>
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Overtime After (hours/week)</label>
                  <input type="number" min="1" style={styles.input} value={form.overtime_after_hours} onChange={(e) => setForm({ ...form, overtime_after_hours: e.target.value })} />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Overtime Multiplier</label>
                  <input type="number" step="0.1" min="1" max="5" style={styles.input} value={form.overtime_multiplier} onChange={(e) => setForm({ ...form, overtime_multiplier: e.target.value })} />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Holiday Multiplier</label>
                  <input type="number" step="0.1" min="1" max="5" style={styles.input} value={form.holiday_multiplier} onChange={(e) => setForm({ ...form, holiday_multiplier: e.target.value })} />
                </div>
              </>
            )}
            <div style={styles.formGroup}>
              <label style={styles.label}>Effective From *</label>
              <input type="date" style={styles.input} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Effective To</label>
              <input type="date" style={styles.input} value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
            </div>
          </div>
          <p style={{ ...styles.emptyText, marginTop: 'var(--space-sm)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
            <Button size="sm" onClick={handleDone}>{editing ? 'Done' : 'Add'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {list.rows.length === 0 && !showForm && <p style={styles.emptyText}>No compensation rules configured. Add pay rates, commissions, or salary to track this staff member's compensation.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const rule = r.item;
            const refNames = getRefNames(rule);
            const refTypeLabel = rule.reference_type ? REF_TYPE_LABELS[rule.reference_type] : null;
            const edited = !r.isNew && !r.deleted && list.changed(r, ruleData);
            return (
            <div key={r.key} style={{ ...styles.listItem, opacity: rule.status === 'inactive' || r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
              <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                <strong style={{ color: 'var(--color-text)' }}>{RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}</strong>
                {refTypeLabel && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)', padding: '2px 6px', borderRadius: '4px' }}>{refTypeLabel}</span>}
                <span style={{ marginLeft: '12px', fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-primary)' }}>{formatRate(rule)}</span>
                {rule.rule_type === 'commission' && rule.threshold_amount && (
                  <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>after €{(rule.threshold_amount / 100).toFixed(2)} revenue</span>
                )}
                <RowTags row={r} edited={edited} />
                {refNames && (
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Applies to: {refNames}</div>
                )}
                {!refNames && refTypeLabel && (
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Applies to: All {refTypeLabel}s</div>
                )}
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                  From {formatDateOnly(rule.effective_from)}
                  {rule.effective_to && ` to ${formatDateOnly(rule.effective_to)}`}
                  {rule.rule_type === 'hourly' && (
                    <span style={{ marginLeft: '12px' }}>OT: {rule.overtime_multiplier}x after {rule.overtime_after_hours}h · Holiday: {rule.holiday_multiplier}x</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge variant={rule.status === 'active' ? 'success' : 'neutral'}>{rule.status}</Badge>
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                  <button style={styles.iconBtn} onClick={() => openEdit(r.key, rule)} title="Edit">✏️</button>
                  <button style={styles.iconBtn} onClick={() => list.edit(r.key, { status: rule.status === 'active' ? 'inactive' : 'active' })} title={rule.status === 'active' ? 'Deactivate' : 'Activate'}>
                    {rule.status === 'active' ? '⏸️' : '▶️'}
                  </button>
                  <button style={styles.iconBtn} onClick={() => list.remove(r.key)} title="Delete">🗑️</button>
                </>}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  subtitle: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '4px' },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' },
  tab: { background: 'none', border: 'none', borderBottom: '3px solid transparent', padding: '10px 16px', fontSize: 'var(--font-size-sm)', fontWeight: 500 as any, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', whiteSpace: 'nowrap' as const, marginBottom: '-1px', outline: 'none', WebkitAppearance: 'none' as any },
  tabActive: { borderBottomColor: 'var(--color-primary)', color: 'var(--color-text)', fontWeight: 600 as any },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%', boxSizing: 'border-box' as const },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-md)' },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' },
  emptyText: { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '4px' },
  statCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  statLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  statValue: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
};
