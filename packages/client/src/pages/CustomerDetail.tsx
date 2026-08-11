import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
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
        <div style={styles.headerActions}>
          <Badge variant={customer.status === 'active' ? 'success' : 'neutral'}>{customer.status}</Badge>
          <span style={styles.joinedDate}>Customer since {new Date(customer.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        items={[
          { id: 'overview', label: 'Overview', content: <OverviewTab customer={customer} tags={tags} onUpdate={setCustomer} /> },
          { id: 'notes', label: 'Notes', content: <NotesTab notes={notes} customerId={customer.id} businessId={businessId} onRefresh={(n) => setNotes(n)} /> },
          { id: 'preferences', label: 'Preferences', content: <PreferencesTab preferences={preferences} onChange={handlePreferenceChange} /> },
          { id: 'timeline', label: 'Timeline', content: <TimelineTab activities={activities} customerId={customer.id} businessId={businessId} /> },
        ]}
      />
    </div>
  );
}

// --- Sub-components for tabs ---

function OverviewTab({ customer, tags, onUpdate }: { customer: Customer; tags: any[]; onUpdate: (c: Customer) => void }) {
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

  // Detect if form has unsaved changes
  const isDirty = form.first_name !== customer.first_name ||
    form.last_name !== customer.last_name ||
    form.email !== customer.email ||
    form.phone !== (customer.phone || '') ||
    form.date_of_birth !== (customer.date_of_birth || '') ||
    form.gender !== (customer.gender || '') ||
    form.preferred_language !== (customer.preferred_language || 'en') ||
    form.country !== (customer.country || '') ||
    form.lifecycle_stage !== (customer.lifecycle_stage || 'lead');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await customersApi.updateCustomer(customer.id, businessId, form);
      onUpdate(updated);
    } catch { alert('Failed to update customer'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
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

  return (
    <div style={styles.tabContent}>
      {/* Quick Actions Bar */}
      <div style={styles.quickActionsBar}>
        <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: open payment modal pre-filled with customer */ }}>Record Payment</Button>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: open order flow pre-filled with customer */ }}>Place Order</Button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {customer.status === 'active' && <Button variant="destructive" size="sm" onClick={handleArchive} loading={statusChanging}>Archive</Button>}
          {customer.status === 'archived' && <Button variant="primary" size="sm" onClick={handleReactivate} loading={statusChanging}>Reactivate</Button>}
          <Button variant="destructive" size="sm" onClick={handleAnonymize} loading={anonymizing}>GDPR Anonymize</Button>
        </div>
      </div>

      {/* Unsaved changes bar */}
      {isDirty && (
        <div style={styles.saveBar}>
          <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>You have unsaved changes</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </div>
      )}

      {/* Cards layout */}
      <div style={styles.overviewGrid}>
        {/* Contact Information Card — always editable */}
        <div style={{ ...styles.card, gridColumn: '1 / -1' }}>
          <h3 style={styles.cardTitle}>Contact Information</h3>
          <div style={styles.contactGrid}>
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
        </div>

        {/* Financial Summary Card */}
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <h3 style={{ ...styles.cardTitle, margin: 0 }}>Financial Summary</h3>
            <Button size="sm" variant="secondary" onClick={() => { /* TODO: open invoices modal */ }}>View Invoices</Button>
          </div>
          <div style={styles.financialGrid}>
            <div style={styles.financialItem}>
              <span style={styles.financialLabel}>Balance</span>
              <span style={styles.financialValue}>$0.00</span>
            </div>
            <div style={styles.financialItem}>
              <span style={styles.financialLabel}>Lifetime Value</span>
              <span style={styles.financialValue}>$0.00</span>
            </div>
            <div style={styles.financialItem}>
              <span style={styles.financialLabel}>Credit Status</span>
              <span style={styles.financialValue}>Good</span>
            </div>
          </div>
        </div>

        {/* Membership Card */}
        <MembershipCard customerId={customer.id} businessId={businessId} />

        {/* Payment Methods on File Card */}
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <h3 style={{ ...styles.cardTitle, margin: 0 }}>Payment Methods on File</h3>
            <Button size="sm" variant="secondary" onClick={() => { /* TODO: open add payment method flow */ }}>Add Method</Button>
          </div>
          <p style={styles.cardMuted}>No payment methods on file</p>
        </div>

        {/* Tags Card */}
        {tags.length > 0 && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Tags</h3>
            <div style={styles.tagsList}>
              {tags.map((tag: any) => (
                <span key={tag.id} style={{ ...styles.tag, borderColor: tag.color }}>{tag.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotesTab({ notes: _initialNotes, customerId, businessId }: { notes: any[]; customerId: string; businessId: string; onRefresh: (n: any[]) => void }) {
  const [newNote, setNewNote] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [notesList, setNotesList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const LIMIT = 10;

  // Fetch categories
  useEffect(() => {
    apiClient.get(`/v1/customers/note-categories/list?business_id=${businessId}`)
      .then((res) => {
        const cats = res.data.data || [];
        setCategories(cats);
        if (cats.length > 0 && !category) setCategory(cats[0].name);
      })
      .catch(() => setCategories([]));
  }, [businessId]);

  // Fetch notes with filters and pagination
  const fetchNotes = useCallback(async (newOffset = 0) => {
    const result = await customersApi.getNotes(customerId, businessId, {
      category: filterCategory || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      limit: LIMIT,
      offset: newOffset,
    });
    setNotesList(result.data || []);
    setTotal(result.meta?.total || 0);
    setOffset(newOffset);
  }, [customerId, businessId, filterCategory, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchNotes(0); }, [fetchNotes]);

  const handleAddNote = async () => {
    if (!newNote.trim() || !category) return;
    await customersApi.createNote(customerId, businessId, { category, content: newNote });
    setNewNote('');
    fetchNotes(0);
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    await customersApi.deleteNote(customerId, noteId, businessId);
    fetchNotes(offset);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div style={styles.tabContent}>
      {/* Add note form */}
      <div style={styles.noteForm}>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          style={styles.textarea}
          rows={3}
        />
        <div style={styles.noteActions}>
          {categories.length > 0 ? (
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select}>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>No categories defined. Add them in Settings.</span>
          )}
          <Button onClick={handleAddNote} disabled={categories.length === 0}>Add Note</Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.select}>
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.name}>{cat.name}</option>
          ))}
        </select>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ ...styles.select, minWidth: '130px' }} title="From" />
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ ...styles.select, minWidth: '130px' }} title="To" />
        {(filterCategory || filterDateFrom || filterDateTo) && (
          <button onClick={() => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); }} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>Clear</button>
        )}
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>{total} note{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Notes list */}
      {notesList.length === 0 && <p style={styles.empty}>No notes found</p>}
      {notesList.map((note: any) => (
        <div key={note.id} style={styles.noteCard}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Badge variant="neutral">{note.category}</Badge>
              {note.is_sensitive && <Badge variant="error">Sensitive</Badge>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={styles.noteDate}>{new Date(note.created_at).toLocaleDateString()}</span>
              <button onClick={() => handleDelete(note.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 }} title="Delete note">×</button>
            </div>
          </div>
          <p style={styles.noteContent}>{note.content || '(encrypted)'}</p>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: 'var(--space-md)' }}>
          <button disabled={offset === 0} onClick={() => fetchNotes(offset - LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: '12px', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}>Previous</button>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}>Page {currentPage} of {totalPages}</span>
          <button disabled={offset + LIMIT >= total} onClick={() => fetchNotes(offset + LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: '12px', cursor: offset + LIMIT >= total ? 'default' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1 }}>Next</button>
        </div>
      )}
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
        <input type="checkbox" checked={preferences.email_marketing} onChange={(e) => onChange('email_marketing', e.target.checked)} style={styles.checkbox} />
      </div>
      <div style={styles.prefRow}>
        <span>SMS Marketing</span>
        <input type="checkbox" checked={preferences.sms_marketing} onChange={(e) => onChange('sms_marketing', e.target.checked)} style={styles.checkbox} />
      </div>
      <div style={styles.prefRow}>
        <span>Push Notifications</span>
        <input type="checkbox" checked={preferences.push_notifications} onChange={(e) => onChange('push_notifications', e.target.checked)} style={styles.checkbox} />
      </div>
      <div style={styles.prefRow}>
        <span>Booking Reminders</span>
        <input type="checkbox" checked={preferences.booking_reminders} onChange={(e) => onChange('booking_reminders', e.target.checked)} style={styles.checkbox} />
      </div>
    </div>
  );
}

// --- Membership Card ---

function MembershipCard({ customerId, businessId }: { customerId: string; businessId: string }) {
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [pausingEnrollmentId, setPausingEnrollmentId] = useState<string | null>(null);
  const [pauseDays, setPauseDays] = useState<number>(15);

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await apiClient.get(`/v1/memberships?business_id=${businessId}&customer_id=${customerId}`);
      setEnrollments((res.data.data || []).filter((e: any) => e.status === 'active' || e.status === 'paused'));
    } catch { setEnrollments([]); }
    finally { setLoading(false); }
  }, [customerId, businessId]);

  useEffect(() => { fetchEnrollments(); }, [fetchEnrollments]);

  const loadPlans = async () => {
    if (plans.length === 0) {
      try {
        const res = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}&status=active`);
        setPlans(res.data.data || []);
      } catch { setPlans([]); }
    }
  };

  const openEnroll = async () => { await loadPlans(); setShowEnroll(true); };

  const handleEnroll = async () => {
    if (!selectedPlanId) return;
    setEnrolling(true);
    try {
      await apiClient.post('/v1/memberships', { business_id: businessId, customer_id: customerId, plan_id: selectedPlanId, start_date: new Date().toISOString().split('T')[0] });
      await fetchEnrollments();
      setShowEnroll(false);
      setSelectedPlanId('');
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to enroll'); }
    finally { setEnrolling(false); }
  };

  const handlePause = async (enrollmentId: string) => {
    setPausingEnrollmentId(enrollmentId);
    setPauseDays(15);
  };

  const confirmPause = async () => {
    if (!pausingEnrollmentId) return;
    try {
      await apiClient.put(`/v1/memberships/${pausingEnrollmentId}/pause?business_id=${businessId}`, { max_pause_days: pauseDays });
      await fetchEnrollments();
      setPausingEnrollmentId(null);
    } catch { alert('Failed to pause'); }
  };

  const handleResume = async (enrollmentId: string) => {
    try { await apiClient.put(`/v1/memberships/${enrollmentId}/resume?business_id=${businessId}`); await fetchEnrollments(); }
    catch { alert('Failed to resume'); }
  };

  const handleCancel = async (enrollmentId: string) => {
    if (!confirm('Cancel this membership? This cannot be undone.')) return;
    try { await apiClient.put(`/v1/memberships/${enrollmentId}/cancel?business_id=${businessId}`); await fetchEnrollments(); }
    catch { alert('Failed to cancel'); }
  };

  const handleChangePlan = async (enrollment: any) => {
    await loadPlans();
    setShowChangePlan(enrollment);
    setSelectedPlanId('');
  };

  const confirmChangePlan = async () => {
    if (!selectedPlanId || !showChangePlan) return;
    setEnrolling(true);
    try {
      const res = await apiClient.put(`/v1/memberships/${showChangePlan.id}/change-plan?business_id=${businessId}`, { plan_id: selectedPlanId });
      const result = res.data.data;
      await fetchEnrollments();
      setShowChangePlan(null);
      setSelectedPlanId('');
      if (result.type === 'upgrade' && result.proratedCharge > 0) {
        alert(`Upgraded to ${result.newPlan}. Prorated charge: €${(result.proratedCharge / 100).toFixed(2)}`);
      } else if (result.type === 'downgrade') {
        alert(`Downgrade to ${result.newPlan} will take effect at the start of the next billing period.`);
      }
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to change plan'); }
    finally { setEnrolling(false); }
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Membership</h3>
        {enrollments.length === 0 && !loading && (
          <Button size="sm" variant="secondary" onClick={openEnroll}>Enroll</Button>
        )}
      </div>

      {loading && <p style={styles.cardMuted}>Loading...</p>}
      {!loading && enrollments.length === 0 && !showEnroll && <p style={styles.cardMuted}>No active membership</p>}

      {enrollments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {enrollments.map((e: any) => (
            <div key={e.id} style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{e.plan_name}</strong>
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  {e.billing_frequency}
                  {e.pending_plan_id && <span style={{ color: 'var(--color-info, #4A90A4)', marginLeft: '8px' }}>↓ Downgrade pending</span>}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Since {new Date(e.start_date).toLocaleDateString()}
                {e.cancelled_at ? (
                  <span style={{ color: 'var(--color-error)' }}> · Cancels {new Date(e.current_period_end).toLocaleDateString()}</span>
                ) : e.status === 'paused' ? (
                  <span style={{ color: 'var(--color-warning, #E6A817)' }}> · Paused{e.resume_at ? ` · Resumes ${new Date(e.resume_at).toLocaleDateString()}` : ' indefinitely'}</span>
                ) : (
                  e.next_billing_date && ` · Next billing: ${new Date(e.next_billing_date).toLocaleDateString()}`
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {e.status === 'active' && !e.cancelled_at && <button style={membershipActionStyle} onClick={() => handlePause(e.id)}>Pause</button>}
                {e.status === 'paused' && <button style={membershipActionStyle} onClick={() => handleResume(e.id)}>Resume</button>}
                {!e.cancelled_at && <button style={membershipActionStyle} onClick={() => handleChangePlan(e)}>Change Plan</button>}
                {(e.status === 'active' || e.status === 'paused') && !e.cancelled_at && <button style={{ ...membershipActionStyle, color: 'var(--color-error)' }} onClick={() => handleCancel(e.id)}>Cancel</button>}
              </div>
              {pausingEnrollmentId === e.id && (
                <div style={{ marginTop: '8px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>Pause duration</p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    {[15, 30, 45].map((d) => (
                      <button key={d} type="button" onClick={() => setPauseDays(d)}
                        style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '20px', cursor: 'pointer', border: pauseDays === d ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: pauseDays === d ? 'var(--color-primary)' : 'transparent', color: pauseDays === d ? '#fff' : 'var(--color-text)' }}>
                        {d} days
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button size="sm" onClick={confirmPause}>Confirm Pause</Button>
                    <Button size="sm" variant="secondary" onClick={() => setPausingEnrollmentId(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showEnroll && (
        <div style={{ marginTop: '8px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: '13px', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }} value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              <option value="">Select a plan...</option>
              {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.billing_frequency}</option>)}
            </select>
            <Button size="sm" onClick={handleEnroll} loading={enrolling} disabled={!selectedPlanId}>Enroll</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowEnroll(false)}>Cancel</Button>
          </div>
          {plans.length === 0 && <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>No active membership plans available. Create plans under Offerings → Memberships.</p>}
        </div>
      )}

      {showChangePlan && (
        <div style={{ marginTop: '8px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>Change from <strong>{showChangePlan.plan_name}</strong> to:</p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: '13px', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }} value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              <option value="">Select new plan...</option>
              {plans.filter((p: any) => p.id !== showChangePlan.plan_id).map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.billing_frequency}</option>)}
            </select>
            <Button size="sm" onClick={confirmChangePlan} loading={enrolling} disabled={!selectedPlanId}>Confirm</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowChangePlan(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const membershipActionStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '11px', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' };

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  profileHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' },
  avatar: { width: '56px', height: '56px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, flexShrink: 0 },
  profileInfo: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)', flex: 1 },
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  refNum: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerActions: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: 'var(--space-xs)' },
  joinedDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  tabContent: { padding: 'var(--space-md) 0' },
  quickActionsBar: { display: 'flex', gap: '8px', marginBottom: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', alignItems: 'center' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  overviewGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  cardMuted: { margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  contactGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)' },
  financialGrid: { display: 'flex', gap: 'var(--space-lg)' },
  financialItem: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  financialLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  financialValue: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
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
  checkbox: { width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--color-primary)' },
};
