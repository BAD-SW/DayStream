import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Switch } from '../design-system/components/forms/Switch';
import * as customersApi from '../api/customers';
import type { Customer } from '../api/customers';

const LIFECYCLE_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  lead: 'neutral', trial: 'info', active: 'success', at_risk: 'warning', churned: 'error', winback: 'info',
};

function formatStage(stage: string): string {
  return stage.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [preferences, setPreferences] = useState<any>(null);
  const [tags, setTags] = useState<any[]>([]);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    Promise.all([
      customersApi.getCustomer(id, businessId),
      customersApi.getNotes(id, businessId).catch(() => []),
      customersApi.getActivities(id, businessId).then((r) => r.data).catch(() => []),
      customersApi.getPreferences(id, businessId).catch(() => null),
      customersApi.getTags(businessId).catch(() => []),
    ]).then(([cust, n, acts, prefs, t]) => {
      setCustomer(cust);
      setNotes(n);
      setActivities(acts);
      setPreferences(prefs);
      setTags(t);
    }).finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!customer) return <div style={styles.loading}>Customer not found</div>;

  const handlePreferenceChange = async (key: string, value: boolean) => {
    const updated = await customersApi.updatePreferences(customer.id, businessId, { [key]: value });
    setPreferences(updated);
  };

  return (
    <div style={styles.page}>
      {/* Back button */}
      <button style={styles.back} onClick={() => navigate('/customers')}>← Back to Customers</button>

      {/* Profile Header */}
      <div style={styles.profileHeader}>
        <div style={styles.avatar}>
          {customer.first_name[0]}{customer.last_name[0]}
        </div>
        <div style={styles.profileInfo}>
          <h1 style={styles.name}>{customer.first_name} {customer.last_name}</h1>
          <span style={styles.refNum}>{customer.reference_number}</span>
          <Badge variant={LIFECYCLE_VARIANTS[customer.lifecycle_stage] || 'neutral'}>
            {formatStage(customer.lifecycle_stage)}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        items={[
          { id: 'overview', label: 'Overview', content: <OverviewTab customer={customer} tags={tags} onUpdate={setCustomer} /> },
          { id: 'notes', label: 'Notes', content: <NotesTab notes={notes} customerId={customer.id} businessId={businessId} onRefresh={(n) => setNotes(n)} /> },
          { id: 'timeline', label: 'Timeline', content: <TimelineTab activities={activities} customerId={customer.id} businessId={businessId} /> },
          { id: 'preferences', label: 'Preferences', content: <PreferencesTab preferences={preferences} onChange={handlePreferenceChange} /> },
        ]}
      />
    </div>
  );
}

// --- Sub-components for tabs ---

function OverviewTab({ customer, tags, onUpdate }: { customer: Customer; tags: any[]; onUpdate: (c: Customer) => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone || '',
    date_of_birth: customer.date_of_birth || '',
    gender: customer.gender || '',
    preferred_language: customer.preferred_language || 'en',
    country: customer.country || '',
    lifecycle_stage: customer.lifecycle_stage || 'lead',
  });
  const [statusChanging, setStatusChanging] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await customersApi.updateCustomer(customer.id, businessId, form);
      onUpdate(updated);
      setEditing(false);
    } catch { alert('Failed to update customer'); }
    finally { setSaving(false); }
  };

  const handleArchive = async () => {
    if (!confirm('Archive this customer? They will be hidden from active lists.')) return;
    setStatusChanging(true);
    try {
      const updated = await customersApi.updateCustomer(customer.id, businessId, { status: 'archived' });
      onUpdate(updated);
      setStatusChanging(false);
    } catch { alert('Failed to archive'); setStatusChanging(false); }
  };

  const handleReactivate = async () => {
    setStatusChanging(true);
    try {
      const updated = await customersApi.updateCustomer(customer.id, businessId, { status: 'active' });
      onUpdate(updated);
      setStatusChanging(false);
    } catch { alert('Failed to reactivate'); setStatusChanging(false); }
  };

  const handleAnonymize = async () => {
    const confirmed = confirm(
      '⚠️ GDPR Data Anonymization\n\n' +
      'This will PERMANENTLY and IRREVERSIBLY anonymize all personal data for this customer including:\n' +
      '• Name, email, phone, date of birth\n' +
      '• Notes and activity history\n' +
      '• All identifiable information\n\n' +
      'This action cannot be undone. Are you sure you want to proceed?'
    );
    if (!confirmed) return;
    const doubleConfirm = confirm(
      'Final confirmation: Type OK to permanently anonymize this customer\'s data.\n\n' +
      'Customer: ' + customer.first_name + ' ' + customer.last_name + '\n' +
      'This is IRREVERSIBLE.'
    );
    if (!doubleConfirm) return;
    setAnonymizing(true);
    try {
      await customersApi.anonymizeCustomer(customer.id, businessId);
      alert('Customer data has been anonymized successfully.');
      window.location.reload();
    } catch {
      alert('Failed to anonymize customer data.');
    } finally {
      setAnonymizing(false);
    }
  };

  if (editing) {
    return (
      <div style={styles.tabContent}>
        <div style={styles.fieldGrid}>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>First Name</label><input style={styles.fieldInput} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Last Name</label><input style={styles.fieldInput} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Email</label><input style={styles.fieldInput} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Phone</label><input style={styles.fieldInput} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Date of Birth</label><input style={styles.fieldInput} type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Gender</label>
            <select style={styles.fieldInput} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="non-binary">Non-binary</option><option value="other">Other</option>
            </select>
          </div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Language</label>
            <select style={styles.fieldInput} value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
              <option value="en">English</option><option value="es">Spanish</option>
            </select>
          </div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Country</label><input style={styles.fieldInput} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.fieldLabel}>Lifecycle Stage</label>
            <select style={styles.fieldInput} value={form.lifecycle_stage} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
              <option value="lead">Lead</option>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="at_risk">At Risk</option>
              <option value="churned">Churned</option>
              <option value="winback">Winback</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        {customer.status === 'active' && <Button variant="destructive" size="sm" onClick={handleArchive} loading={statusChanging}>Archive</Button>}
        {customer.status === 'archived' && <Button variant="primary" size="sm" onClick={handleReactivate} loading={statusChanging}>Reactivate</Button>}
        <Button variant="destructive" size="sm" onClick={handleAnonymize} loading={anonymizing}>GDPR Anonymize</Button>
      </div>
      <div style={styles.fieldGrid}>
        <Field label="Email" value={customer.email} />
        <Field label="Phone" value={customer.phone || '—'} />
        <Field label="Date of Birth" value={customer.date_of_birth || '—'} />
        <Field label="Gender" value={customer.gender || '—'} />
        <Field label="Language" value={customer.preferred_language || 'en'} />
        <Field label="Country" value={customer.country || '—'} />
        <Field label="Status" value={customer.status} />
        <Field label="Joined" value={new Date(customer.created_at).toLocaleDateString()} />
      </div>
      {tags.length > 0 && (
        <div style={styles.tagsSection}>
          <h3 style={styles.sectionTitle}>Tags</h3>
          <div style={styles.tagsList}>
            {tags.map((tag: any) => (
              <span key={tag.id} style={{ ...styles.tag, borderColor: tag.color }}>{tag.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotesTab({ notes, customerId, businessId, onRefresh }: { notes: any[]; customerId: string; businessId: string; onRefresh: (n: any[]) => void }) {
  const [newNote, setNewNote] = useState('');
  const [category, setCategory] = useState('general');

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    await customersApi.createNote(customerId, businessId, { category, content: newNote });
    const updated = await customersApi.getNotes(customerId, businessId);
    onRefresh(updated);
    setNewNote('');
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.noteForm}>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          style={styles.textarea}
          rows={3}
        />
        <div style={styles.noteActions}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select}>
            <option value="general">General</option>
            <option value="health">Health</option>
            <option value="preferences">Preferences</option>
          </select>
          <Button onClick={handleAddNote}>Add Note</Button>
        </div>
      </div>
      {notes.length === 0 && <p style={styles.empty}>No notes yet</p>}
      {notes.map((note: any) => (
        <div key={note.id} style={styles.noteCard}>
          <div style={styles.noteHeader}>
            <Badge variant="neutral">{note.category}</Badge>
            <span style={styles.noteDate}>{new Date(note.created_at).toLocaleDateString()}</span>
          </div>
          <p style={styles.noteContent}>{note.content_decrypted || note.content || '(encrypted)'}</p>
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ activities, customerId, businessId }: { activities: any[]; customerId: string; businessId: string }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState(activities);

  useEffect(() => { setItems(activities); }, [activities]);

  const handleFilter = async (type: string) => {
    setFilter(type);
    const result = await customersApi.getActivities(customerId, businessId, { activity_type: type || undefined });
    setItems(result.data);
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.filterRow}>
        {['', 'booking', 'payment', 'membership', 'lifecycle', 'profile_change'].map((t) => (
          <button
            key={t}
            onClick={() => handleFilter(t)}
            style={{ ...styles.filterBtn, ...(filter === t ? styles.filterBtnActive : {}) }}
          >
            {t || 'All'}
          </button>
        ))}
      </div>
      {items.length === 0 && <p style={styles.empty}>No activities</p>}
      {items.length > 0 && (
        <div style={styles.timelineGrid}>
          <span style={styles.timelineHeaderCell}>Type</span>
          <span style={styles.timelineHeaderCell}>Description</span>
          <span style={styles.timelineHeaderCell}>By</span>
          <span style={styles.timelineHeaderCell}>Date</span>
          {items.map((act: any) => (
            <div key={act.id} style={styles.timelineRow}>
              <span style={styles.timelineCell}><Badge variant="neutral">{act.activity_type}</Badge></span>
              <span style={styles.timelineDesc}>{act.description}</span>
              <span style={styles.timelineActor}>{act.actor_name || 'System'}</span>
              <span style={styles.timelineDate}>{new Date(act.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreferencesTab({ preferences, onChange }: { preferences: any; onChange: (key: string, val: boolean) => void }) {
  if (!preferences) return <p style={styles.empty}>Loading preferences...</p>;

  return (
    <div style={styles.tabContent}>
      <div style={styles.prefRow}>
        <span>Email Marketing</span>
        <Switch checked={preferences.email_marketing} onChange={(v) => onChange('email_marketing', v)} />
      </div>
      <div style={styles.prefRow}>
        <span>SMS Marketing</span>
        <Switch checked={preferences.sms_marketing} onChange={(v) => onChange('sms_marketing', v)} />
      </div>
      <div style={styles.prefRow}>
        <span>Push Notifications</span>
        <Switch checked={preferences.push_notifications} onChange={(v) => onChange('push_notifications', v)} />
      </div>
      <div style={styles.prefRow}>
        <span>Booking Reminders</span>
        <Switch checked={preferences.booking_reminders} onChange={(v) => onChange('booking_reminders', v)} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <span style={styles.fieldValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  profileHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' },
  avatar: { width: '56px', height: '56px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any },
  profileInfo: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)' },
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  refNum: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  tabContent: { padding: 'var(--space-md) 0' },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-md)' },
  field: { display: 'flex', flexDirection: 'column' as const },
  fieldLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '2px' },
  fieldValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  fieldInput: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  tagsSection: { marginTop: 'var(--space-lg)' },
  sectionTitle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-sm)' },
  tagsList: { display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' as const },
  tag: { padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '1px solid', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  noteForm: { marginBottom: 'var(--space-lg)' },
  textarea: { width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', resize: 'vertical' as const },
  noteActions: { display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  noteCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-sm)' },
  noteHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' },
  noteDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  noteContent: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', margin: 0 },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  filterRow: { display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  filterBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', textTransform: 'capitalize' as const },
  filterBtnActive: { borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  activityItem: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)' },
  activityDesc: { flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  activityActor: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const, fontStyle: 'italic' as const },
  activityDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const },
  timelineGrid: { display: 'grid', gridTemplateColumns: '120px 1fr 130px 170px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  timelineHeaderCell: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '2px solid var(--color-border)', background: 'var(--color-surface-hover)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  timelineRow: { display: 'contents' },
  timelineCell: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' },
  timelineDesc: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', wordBreak: 'break-word' as const },
  timelineActor: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' },
  timelineDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' as const },
  prefRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
