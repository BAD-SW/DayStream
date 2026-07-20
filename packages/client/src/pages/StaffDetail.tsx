import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import * as staffApi from '../api/staff';
import type { StaffProfile, Qualification, AvailabilityPattern, AvailabilityOverride } from '../api/staff';

type Tab = 'profile' | 'qualifications' | 'availability' | 'calendar';

/** Format a time string (HH:mm or HH:mm:ss) to locale format */
function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(true);

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
  ];

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=staff')}>← Back to Business Setup</button>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>{staff.first_name} {staff.last_name}</h1>
          <span style={styles.subtitle}>{staff.staff_ref} · {staff.employment_type.replace('_', ' ')}</span>
        </div>
        <Badge variant={staff.status === 'active' ? 'success' : 'warning'}>{staff.status}</Badge>
      </div>

      <div style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                padding: '10px 16px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                whiteSpace: 'nowrap' as const,
                marginBottom: '-1px',
              }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'profile' && <ProfileTab staff={staff} onUpdate={setStaff} />}
      {activeTab === 'qualifications' && <QualificationsTab staffId={staff.id} />}
      {activeTab === 'availability' && <AvailabilityTab staffId={staff.id} />}
      {activeTab === 'calendar' && <CalendarTab staffId={staff.id} />}
    </div>
  );
}

// --- Profile Tab (Editable) ---

function ProfileTab({ staff, onUpdate }: { staff: StaffProfile; onUpdate: (s: StaffProfile) => void }) {
  const [form, setForm] = useState({
    first_name: staff.first_name,
    last_name: staff.last_name,
    email: staff.email || '',
    mobile_phone: staff.mobile_phone || '',
    employment_type: staff.employment_type,
    hire_date: staff.hire_date ? staff.hire_date.split('T')[0] : '',
    languages: staff.languages || '',
    bio: staff.bio || '',
    show_on_directory: staff.show_on_directory,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isDirty = form.first_name !== staff.first_name || form.last_name !== staff.last_name ||
    form.email !== (staff.email || '') || form.mobile_phone !== (staff.mobile_phone || '') ||
    form.employment_type !== staff.employment_type ||
    form.hire_date !== (staff.hire_date ? staff.hire_date.split('T')[0] : '') ||
    form.languages !== (staff.languages || '') || form.bio !== (staff.bio || '') ||
    form.show_on_directory !== staff.show_on_directory;

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const updated = await staffApi.updateStaff(staff.id, {
        ...form,
        hire_date: form.hire_date || null,
        mobile_phone: form.mobile_phone || null,
        languages: form.languages || null,
        bio: form.bio || null,
      });
      onUpdate(updated);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
      first_name: staff.first_name, last_name: staff.last_name,
      email: staff.email || '', mobile_phone: staff.mobile_phone || '',
      employment_type: staff.employment_type,
      hire_date: staff.hire_date ? staff.hire_date.split('T')[0] : '',
      languages: staff.languages || '', bio: staff.bio || '',
      show_on_directory: staff.show_on_directory,
    });
  };

  const handleDeactivate = async () => {
    if (!confirm('Deactivate this staff member? They will no longer be bookable.')) return;
    try {
      const updated = await staffApi.deactivateStaff(staff.id);
      onUpdate(updated);
    } catch { /* silent */ }
  };

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}
      {isDirty && (
        <div style={styles.saveBar}>
          <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>You have unsaved changes</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </div>
      )}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Personal Information</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>First Name</label>
            <input style={styles.input} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Last Name</label>
            <input style={styles.input} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input type="email" style={styles.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Mobile Phone</label>
            <input style={styles.input} value={form.mobile_phone} onChange={(e) => setForm({ ...form, mobile_phone: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Languages</label>
            <input style={styles.input} value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} placeholder="e.g., English, Spanish" />
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Employment</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Employment Type</label>
            <select style={styles.input} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Hire Date</label>
            <input type="date" style={styles.input} value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Public Profile</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Bio</label>
            <textarea style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }} value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Public-facing bio shown to customers..." />
          </div>
          <div style={styles.formGroup}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.show_on_directory} onChange={(e) => setForm({ ...form, show_on_directory: e.target.checked })} style={{ width: '16px', height: '16px' }} />
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

// --- Qualifications Tab ---

function QualificationsTab({ staffId }: { staffId: string }) {
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Qualification | null>(null);
  const [form, setForm] = useState({ name: '', issuing_body: '', certification_number: '', date_obtained: '', expiry_date: '', show_on_directory: true });

  const fetchQuals = useCallback(async () => {
    setLoading(true);
    staffApi.getQualifications(staffId).then(setQuals).finally(() => setLoading(false));
  }, [staffId]);

  useEffect(() => { fetchQuals(); }, [fetchQuals]);

  const openAdd = () => { setEditing(null); setForm({ name: '', issuing_body: '', certification_number: '', date_obtained: '', expiry_date: '', show_on_directory: true }); setShowForm(true); };
  const openEdit = (q: Qualification) => {
    setEditing(q);
    setForm({ name: q.name, issuing_body: q.issuing_body || '', certification_number: q.certification_number || '', date_obtained: q.date_obtained ? q.date_obtained.split('T')[0] : '', expiry_date: q.expiry_date ? q.expiry_date.split('T')[0] : '', show_on_directory: q.show_on_directory });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    const data = { ...form, issuing_body: form.issuing_body || null, certification_number: form.certification_number || null, date_obtained: form.date_obtained || null, expiry_date: form.expiry_date || null };
    if (editing) {
      await staffApi.updateQualification(staffId, editing.id, data);
    } else {
      await staffApi.addQualification(staffId, data);
    }
    setShowForm(false);
    fetchQuals();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this qualification?')) return;
    await staffApi.deleteQualification(staffId, id);
    fetchQuals();
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Qualifications & Certifications</h3>
        <Button variant="secondary" size="sm" onClick={openAdd}>Add Qualification</Button>
      </div>

      {showForm && (
        <div style={styles.card}>
          <h4 style={{ ...styles.cardTitle, fontSize: '14px' }}>{editing ? 'Edit Qualification' : 'Add Qualification'}</h4>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Issuing Body</label><input style={styles.input} value={form.issuing_body} onChange={(e) => setForm({ ...form, issuing_body: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Certification #</label><input style={styles.input} value={form.certification_number} onChange={(e) => setForm({ ...form, certification_number: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Date Obtained</label><input type="date" style={styles.input} value={form.date_obtained} onChange={(e) => setForm({ ...form, date_obtained: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>Expiry Date</label><input type="date" style={styles.input} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
            <div style={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '20px' }}>
                <input type="checkbox" checked={form.show_on_directory} onChange={(e) => setForm({ ...form, show_on_directory: e.target.checked })} style={{ width: '16px', height: '16px' }} /> Show publicly
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
            <Button size="sm" onClick={handleSave}>{editing ? 'Save' : 'Add'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {quals.length === 0 && !showForm && <p style={styles.emptyText}>No qualifications recorded. Add certifications, licenses, or training records.</p>}
      {quals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {quals.map((q) => (
            <div key={q.id} style={styles.listItem}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text)' }}>{q.name}</strong>
                {q.issuing_body && <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>— {q.issuing_body}</span>}
                {q.certification_number && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>#{q.certification_number}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {q.expiry_date && <Badge variant={new Date(q.expiry_date) < new Date() ? 'error' : 'info'}>{`Exp: ${new Date(q.expiry_date).toLocaleDateString()}`}</Badge>}
                <button style={styles.iconBtn} onClick={() => openEdit(q)} title="Edit">✏️</button>
                <button style={styles.iconBtn} onClick={() => handleDelete(q.id)} title="Delete">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// --- Availability Tab ---

interface SlotEntry { day_of_week: number; start_time: string; end_time: string; }

function AvailabilityTab({ staffId }: { staffId: string }) {
  const [patterns, setPatterns] = useState<AvailabilityPattern[]>([]);
  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPatternForm, setShowPatternForm] = useState(false);
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [patternForm, setPatternForm] = useState({ name: '', effective_from: '', effective_to: '', is_default: true });
  const [patternSlots, setPatternSlots] = useState<SlotEntry[]>([]);
  const [overrideForm, setOverrideForm] = useState({ override_date: '', start_time: '09:00', end_time: '17:00', override_type: 'remove' as 'remove' | 'modify' | 'add', reason: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    Promise.all([
      staffApi.getAvailabilityPatterns(staffId),
      staffApi.getAvailabilityOverrides(staffId),
    ]).then(([p, o]) => { setPatterns(p); setOverrides(o); }).finally(() => setLoading(false));
  }, [staffId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbrev = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // --- Pattern Helpers ---
  const openPatternForm = () => {
    setEditingPatternId(null);
    setPatternForm({ name: 'Default Schedule', effective_from: new Date().toISOString().split('T')[0], effective_to: '', is_default: true });
    setPatternSlots([]);
    setShowPatternForm(true);
  };

  const openEditPattern = (p: AvailabilityPattern) => {
    setEditingPatternId(p.id);
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

  const handleSavePattern = async () => {
    if (!patternForm.name || !patternForm.effective_from) return;
    const payload = {
      name: patternForm.name,
      effective_from: patternForm.effective_from,
      effective_to: patternForm.effective_to || null,
      is_default: patternForm.is_default,
      slots: patternSlots,
    };
    if (editingPatternId) {
      await staffApi.updateAvailabilityPattern(staffId, editingPatternId, payload);
    } else {
      await staffApi.createAvailabilityPattern(staffId, payload);
    }
    setShowPatternForm(false);
    setEditingPatternId(null);
    fetchData();
  };

  const handleDeletePattern = async (patternId: string) => {
    if (!confirm('Delete this availability pattern?')) return;
    await staffApi.deleteAvailabilityPattern(staffId, patternId);
    fetchData();
  };

  const handleCopyPattern = async (patternId: string) => {
    await staffApi.copyAvailabilityPattern(staffId, patternId);
    fetchData();
  };

  // --- Override Helpers ---
  const handleCreateOverride = async () => {
    if (!overrideForm.override_date) return;
    const data: Record<string, any> = {
      override_date: overrideForm.override_date,
      override_type: overrideForm.override_type,
    };
    if (overrideForm.override_type !== 'remove') {
      data.start_time = overrideForm.start_time;
      data.end_time = overrideForm.end_time;
    }
    if (overrideForm.reason) data.reason = overrideForm.reason;
    await staffApi.createAvailabilityOverride(staffId, data);
    setShowOverrideForm(false);
    setOverrideForm({ override_date: '', start_time: '09:00', end_time: '17:00', override_type: 'remove', reason: '' });
    fetchData();
  };

  const handleDeleteOverride = async (overrideId: string) => {
    if (!confirm('Delete this override?')) return;
    await staffApi.deleteAvailabilityOverride(staffId, overrideId);
    setOverrides(overrides.filter((o) => o.id !== overrideId));
  };

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <>
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Weekly Patterns</h3>
          <Button variant="secondary" size="sm" onClick={openPatternForm}>Create Pattern</Button>
        </div>

        {showPatternForm && (
          <div style={{ ...styles.card, background: 'var(--color-background)', marginBottom: 'var(--space-md)' }}>
            <h4 style={{ ...styles.cardTitle, fontSize: '14px' }}>{editingPatternId ? 'Edit Availability Pattern' : 'New Availability Pattern'}</h4>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}><label style={styles.label}>Pattern Name *</label><input style={styles.input} value={patternForm.name} onChange={(e) => setPatternForm({ ...patternForm, name: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Effective From *</label><input type="date" style={styles.input} value={patternForm.effective_from} onChange={(e) => setPatternForm({ ...patternForm, effective_from: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Effective To</label><input type="date" style={styles.input} value={patternForm.effective_to} onChange={(e) => setPatternForm({ ...patternForm, effective_to: e.target.value })} placeholder="Ongoing" /></div>
              <div style={styles.formGroup}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '20px' }}>
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
                    <span style={{ width: '90px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>{day}</span>
                    {daySlots.length === 0 ? (
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flex: 1 }}>Off</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
                        {daySlots.map((slot) => {
                          const slotIndex = patternSlots.indexOf(slot);
                          return (
                            <div key={slotIndex} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input type="time" style={{ ...styles.input, width: '110px', padding: '6px 8px', fontSize: '12px' }} value={slot.start_time} onChange={(e) => updateSlot(slotIndex, 'start_time', e.target.value)} />
                              <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                              <input type="time" style={{ ...styles.input, width: '110px', padding: '6px 8px', fontSize: '12px' }} value={slot.end_time} onChange={(e) => updateSlot(slotIndex, 'end_time', e.target.value)} />
                              <button style={styles.iconBtn} onClick={() => removeSlot(slotIndex)} title="Remove">×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <button style={{ ...styles.iconBtn, fontSize: '18px', color: 'var(--color-primary)' }} onClick={() => addSlot(idx)} title={`Add hours for ${day}`}>+</button>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
              <Button size="sm" onClick={handleSavePattern}>{editingPatternId ? 'Save Changes' : 'Create Pattern'}</Button>
              <Button variant="secondary" size="sm" onClick={() => { setShowPatternForm(false); setEditingPatternId(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {patterns.length === 0 && !showPatternForm && <p style={styles.emptyText}>No availability patterns defined. Create one to set this staff member's working hours.</p>}
        {patterns.map((p) => (
          <div key={p.id} style={{ ...styles.listItem, flexDirection: 'column', alignItems: 'stretch', padding: 'var(--space-md)', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ color: 'var(--color-text)' }}>{p.name}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{new Date(p.effective_from).toLocaleDateString()} → {p.effective_to ? new Date(p.effective_to).toLocaleDateString() : 'Ongoing'}</span>
                <button style={styles.iconBtn} onClick={() => openEditPattern(p)} title="Edit">✏️</button>
                <Button variant="ghost" size="sm" onClick={() => handleCopyPattern(p.id)}>Copy</Button>
                <button style={styles.iconBtn} onClick={() => handleDeletePattern(p.id)} title="Delete">🗑️</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '12px', textAlign: 'center' }}>
              {dayAbbrev.map((day, idx) => {
                const slots = p.slots.filter((s) => s.day_of_week === idx);
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
        ))}
      </div>

      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Overrides & Time Off</h3>
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
            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
              <Button size="sm" onClick={handleCreateOverride}>Save Override</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowOverrideForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {overrides.length === 0 && !showOverrideForm && <p style={styles.emptyText}>No overrides scheduled.</p>}
        {overrides.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {overrides.map((o) => (
              <div key={o.id} style={styles.listItem}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{new Date(o.override_date).toLocaleDateString()}</strong>
                  {o.override_type === 'remove' ? <Badge variant="warning">Day Off</Badge> : o.override_type === 'add' ? <Badge variant="success">Extra</Badge> : <Badge variant="info">Modified</Badge>}
                  {o.override_type !== 'remove' && o.start_time && <span style={{ fontSize: '13px', color: 'var(--color-success, #2E7D32)' }}>{formatTime(o.start_time)}–{formatTime(o.end_time!)}</span>}
                  {o.reason && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>({o.reason})</span>}
                </div>
                <button style={styles.iconBtn} onClick={() => handleDeleteOverride(o.id)} title="Delete">🗑️</button>
              </div>
            ))}
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
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{new Date(b.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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
                <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>{l.startDate} → {l.endDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
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
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '4px' },
  statCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  statLabel: { fontSize: '12px', color: 'var(--color-text-secondary)' },
  statValue: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
};
