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
          { id: 'overview', label: 'Overview', content: <OverviewTab customer={customer} tags={tags} /> },
          { id: 'notes', label: 'Notes', content: <NotesTab notes={notes} customerId={customer.id} businessId={businessId} onRefresh={(n) => setNotes(n)} /> },
          { id: 'timeline', label: 'Timeline', content: <TimelineTab activities={activities} customerId={customer.id} businessId={businessId} /> },
          { id: 'preferences', label: 'Preferences', content: <PreferencesTab preferences={preferences} onChange={handlePreferenceChange} /> },
        ]}
      />
    </div>
  );
}

// --- Sub-components for tabs ---

function OverviewTab({ customer, tags }: { customer: Customer; tags: any[] }) {
  return (
    <div style={styles.tabContent}>
      <div style={styles.fieldGrid}>
        <Field label="Email" value={customer.email} />
        <Field label="Phone" value={customer.phone || '—'} />
        <Field label="Date of Birth" value={customer.date_of_birth || '—'} />
        <Field label="Gender" value={customer.gender || '—'} />
        <Field label="Language" value={customer.preferred_language || 'en'} />
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
      {items.map((act: any) => (
        <div key={act.id} style={styles.activityItem}>
          <Badge variant="neutral">{act.activity_type}</Badge>
          <span style={styles.activityDesc}>{act.description}</span>
          <span style={styles.activityDate}>{new Date(act.created_at).toLocaleString()}</span>
        </div>
      ))}
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
  activityDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const },
  prefRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
