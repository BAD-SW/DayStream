import { useState, useEffect, useCallback } from 'react';
import { Table, applyTableFilters } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { useParams, useNavigate } from 'react-router-dom';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, fieldMark, checkMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Dropdown } from '../design-system/components/actions/Dropdown';
import { IconButton } from '../design-system/components/actions/IconButton';
import { apiClient } from '../api/client';
import * as customersApi from '../api/customers';
import type { Customer } from '../api/customers';
import { PaymentMethods } from '../components/PaymentMethods';
import { TakePaymentModal } from '../components/TakePaymentModal';
import { RefundOrderModal } from '../components/RefundOrderModal';
import { Modal } from '../design-system/components/feedback/Modal';
import { CurrencyInput } from '../components/CurrencyInput';
import * as payApi from '../api/payments';
import type { PayTransaction, Invoice, PaymentMethod } from '../api/payments';
import { formatCurrency } from '../utils/currency';
import { formatDateOnly } from '../utils/date';
import { lifecycleStageLabel, personSourceLabel } from '@daystream/shared';
import {
  ProfilePhoto, VisitsCreditsCard, CommunicationCard, ReferralsCard, ReviewsCard,
  MessagesTab, TasksTab, DocumentsTab, AssignStaffDialog, PasswordResetDialog, PersonalDataDialog,
} from './CustomerProfileParts';

const LIFECYCLE_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  lead: 'neutral', trial: 'info', active: 'success', at_risk: 'warning', churned: 'error', winback: 'info',
};

const PROFILE_TABS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'messages', label: 'Messages' }, { key: 'timeline', label: 'Timeline' },
  { key: 'billing', label: 'Billing' }, { key: 'notes', label: 'Notes' }, { key: 'tasks', label: 'Tasks' },
  { key: 'documents', label: 'Documents' }, { key: 'preferences', label: 'Consent' },
];

// Stage and source names come from one shared map ('trial' is shown as "New customer").
const formatStage = lifecycleStageLabel;

function formatWhen(value?: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** The day only, so the facts fit on one line; the time is in the tooltip. */
function formatDay(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}

// One Save for the profile (David, 2026-11-01, as in Settings): the contact details wait for
// Save changes in the header; notes, tasks, documents, payments and the More actions act at once.
export function CustomerDetail() {
  return (
    <DraftSectionsProvider>
      <CustomerProfilePage />
    </DraftSectionsProvider>
  );
}

function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Leaving the profile from a button asks first too when something is unsaved.
  const guardedNavigate = useGuardedNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Bumped after a merge so the edit form restarts from the merged record instead of
  // showing its old values as "unsaved changes".
  const [mergeCount, setMergeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<any[]>([]);
  const [preferences, setPreferences] = useState<any>(null);
  const [tags, setTags] = useState<any[]>([]);
  // Staff members who can look after a person or be given a task.
  const [staff, setStaff] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<'payment' | 'assign' | 'reset' | 'data' | null>(null);
  // Bumped by the header's Add task button (opens the form) and after changes (reloads the Timeline).
  const [addTaskSignal, setAddTaskSignal] = useState(0);
  const [timelineVersion, setTimelineVersion] = useState(0);
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  useEffect(() => { setSaveResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);
  const saveChanges = async () => {
    const { failed } = await saveAll();
    setSaveResult(failed.length ? { ok: false, text: `Not saved: ${failed.map((f) => `${f.label} (${f.error})`).join('; ')}` } : { ok: true, text: 'All changes saved.' });
  };

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    setTab('overview');
    Promise.all([
      customersApi.getCustomer(id, businessId),
      customersApi.getNotes(id, businessId).catch(() => []),
      customersApi.getPreferences(id, businessId).catch(() => null),
    ]).then(([cust, n, prefs]) => {
      // An old link to a record that was merged: go to the person it was merged into.
      if (cust?.status === 'merged' && cust.merged_into_id) {
        navigate(`/customers/${cust.merged_into_id}`, { replace: true });
        return;
      }
      setCustomer(cust);
      setNotes(n);
      setPreferences(prefs);
      setTags((cust as any)?.tags || []);
    }).catch(() => setCustomer(null)).finally(() => setLoading(false));
  }, [id, businessId]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getOwners(businessId).then(setStaff).catch(() => setStaff([]));
  }, [businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!customer) return <div style={styles.loading}>Customer not found</div>;

  // Switching a marketing channel ON records the person's consent, so the Consent tab
  // sends how it was obtained as `evidence`.
  const displayName = customer.display_name || `${customer.first_name} ${customer.last_name}`.trim() || customer.email || customer.phone || 'Unknown';
  const initials = `${(customer.first_name || displayName)[0]?.toUpperCase() || ''}${customer.last_name?.[0]?.toUpperCase() || ''}`;
  // Reload the person (and the Timeline) after an action changed something on them.
  const refresh = () => {
    customersApi.getCustomer(customer.id, businessId).then(setCustomer).catch(() => {});
    setTimelineVersion((n) => n + 1);
  };

  const handleArchive = async () => {
    if (!confirm('Archive this customer? They will be hidden from active lists.')) return;
    try { setCustomer(await customersApi.updateCustomer(customer.id, businessId, { status: 'archived' })); setTimelineVersion((n) => n + 1); }
    catch { alert('Failed to archive'); }
  };
  const handleReactivate = async () => {
    try { setCustomer(await customersApi.updateCustomer(customer.id, businessId, { status: 'active' })); setTimelineVersion((n) => n + 1); }
    catch { alert('Failed to reactivate'); }
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
    try {
      await customersApi.anonymizeCustomer(customer.id, businessId);
      alert('Customer data has been anonymized successfully.');
      window.location.reload();
    } catch {
      alert('Failed to anonymize customer data.');
    }
  };

  // Header actions: Contact opens Messages, Add task opens the task form; the rest are in More.
  const moreItems = [
    { id: 'order', label: 'New order', onClick: () => guardedNavigate(`/checkout?new=true&customer=${customer.id}`) },
    { id: 'payment', label: 'Record payment', onClick: () => setDialog('payment') },
    { id: 'd1', label: '', divider: true },
    { id: 'assign', label: 'Assign staff member', onClick: () => { setTab('overview'); setTimeout(() => document.getElementById('f-staff')?.focus(), 50); } },
    { id: 'reset', label: 'Request password reset', disabled: !customer.has_account, onClick: () => setDialog('reset') },
    { id: 'data', label: 'Send personal data (GDPR)', disabled: !customer.email, onClick: () => setDialog('data') },
    { id: 'd2', label: '', divider: true },
    customer.status === 'archived'
      ? { id: 'reactivate', label: 'Reactivate', onClick: handleReactivate }
      : { id: 'archive', label: 'Archive', danger: true, disabled: customer.status !== 'active', onClick: handleArchive },
    { id: 'anonymize', label: 'GDPR anonymise', danger: true, onClick: handleAnonymize },
  ];

  const facts: Array<[string, string, string?]> = [
    ['Source', personSourceLabel(customer.source, customer.source_detail)],
    ['Staff member', customer.owner_name || 'Unassigned'],
    ['Home location', customer.home_location_name || '—'],
    ['Last activity', formatDay(customer.last_activity_at), formatWhen(customer.last_activity_at)],
    ['Last visit', formatDay(customer.last_visit_at), formatWhen(customer.last_visit_at)],
    ['Last login', customer.has_account ? formatDay(customer.last_login_at) : 'No account', customer.has_account ? formatWhen(customer.last_login_at) : undefined],
    ['Known since', formatDay(customer.created_at), formatWhen(customer.created_at)],
  ];

  return (
    <div style={styles.page}>
      <TakePaymentModal open={dialog === 'payment'} onClose={() => { setDialog(null); setTimelineVersion((n) => n + 1); }} businessId={businessId} customerId={customer.id} />
      <AssignStaffDialog open={dialog === 'assign'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} staff={staff} onSaved={(c) => { setCustomer(c); setTimelineVersion((n) => n + 1); }} />
      <PasswordResetDialog open={dialog === 'reset'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} onSent={() => setTimelineVersion((n) => n + 1)} />
      <PersonalDataDialog open={dialog === 'data'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} onSent={() => setTimelineVersion((n) => n + 1)} />

      <LeaveGuard when={dirty} />
      {/* Back button */}
      <button style={styles.back} onClick={() => guardedNavigate('/customers')}>← Back to People</button>

      <StickyPageTop>
      {/* Profile header: who, the actions, and the facts on one line (THE-16) */}
      <div style={styles.profileHeader}>
        <div style={styles.headerTop}>
          <ProfilePhoto customer={customer} businessId={businessId} initials={initials} onChanged={refresh} />
          <div style={styles.profileInfo}>
            <h1 style={styles.name}>{displayName}</h1>
            <div style={styles.headerBadges}>
              <span style={styles.refNum}>{customer.reference_number}</span>
              <Badge variant={LIFECYCLE_VARIANTS[customer.lifecycle_stage] || 'neutral'}>
                {formatStage(customer.lifecycle_stage)}
              </Badge>
              {/* The record's own status only when it is not the usual "active". */}
              {customer.status !== 'active' && <Badge variant="neutral">{customer.status === 'anonymized' ? 'Anonymised' : customer.status === 'archived' ? 'Archived' : customer.status}</Badge>}
              {customer.incomplete && <Badge variant="warning">Incomplete</Badge>}
              <span style={styles.refNum}>In this stage since {formatDay(customer.lifecycle_changed_at)}</span>
            </div>
          </div>
          <div style={styles.headerActions}>
            {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>You have unsaved changes.</span>
              : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
            <Button size="sm" onClick={saveChanges} loading={saving} disabled={!dirty}>Save changes</Button>
            <Button size="sm" variant="secondary" onClick={() => setTab('messages')}>Contact</Button>
            <Button size="sm" variant="secondary" onClick={() => { setTab('tasks'); setAddTaskSignal((n) => n + 1); }}>Add task</Button>
            <Dropdown trigger={<Button size="sm" variant="secondary">More ▾</Button>} items={moreItems} />
          </div>
        </div>
        <dl style={styles.factStrip}>
          {facts.map(([label, value, title]) => (
            <div key={label} style={styles.fact}><dt style={styles.factLabel}>{label}</dt><dd style={styles.factValue} title={title}>{value}</dd></div>
          ))}
        </dl>
      </div>

      <DuplicateBanner customer={customer} businessId={businessId} onMerged={(c) => {
        setCustomer(c);
        setMergeCount((n) => n + 1);
        setTimelineVersion((n) => n + 1);
      }} />

      {/* Tabs (order agreed on THE-16) */}
      <TabBar aria-label="Profile sections" tabs={PROFILE_TABS.map((t) => ({ ...t, changed: dirtySections.some((d) => d.tab === t.key) }))} active={tab} onChange={setTab} />
      </StickyPageTop>
      <div hidden={tab !== 'overview'}>
        <DraftTab tab="overview">
          <OverviewTab key={mergeCount} customer={customer} tags={tags} preferences={preferences} staff={staff} onUpdate={(c) => { setCustomer(c); setTimelineVersion((n) => n + 1); }} onOpenConsent={() => setTab('preferences')} />
        </DraftTab>
      </div>
      {tab === 'messages' && <MessagesTab customer={customer} />}
      {tab === 'timeline' && <TimelineTab key={timelineVersion} customerId={customer.id} businessId={businessId} />}
      {tab === 'billing' && <BillingTab customerId={customer.id} businessId={businessId} />}
      <div hidden={tab !== 'notes'}><DraftTab tab="notes"><NotesTab notes={notes} customerId={customer.id} businessId={businessId} onRefresh={(n) => setNotes(n)} /></DraftTab></div>
      <div hidden={tab !== 'tasks'}><DraftTab tab="tasks"><TasksTab customer={customer} businessId={businessId} staff={staff} addSignal={addTaskSignal} /></DraftTab></div>
      <div hidden={tab !== 'documents'}><DraftTab tab="documents"><DocumentsTab customerId={customer.id} businessId={businessId} /></DraftTab></div>
      <div hidden={tab !== 'preferences'}><DraftTab tab="preferences"><PreferencesTab preferences={preferences} onSaved={(prefs) => { setPreferences(prefs); setTimelineVersion((n) => n + 1); }} customerId={customer.id} businessId={businessId} /></DraftTab></div>
    </div>
  );
}

// --- Sub-components for tabs ---

/** What the person owes, what they have paid in total and their unused credit, in the business currency. */
function FinancialSummaryCard({ customerId, businessId }: { customerId: string; businessId: string }) {
  const [summary, setSummary] = useState<customersApi.FinancialSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSummary(null);
    setFailed(false);
    customersApi.getFinancialSummary(customerId, businessId).then(setSummary).catch(() => setFailed(true));
  }, [customerId, businessId]);

  const money = (cents: number) => (summary ? formatCurrency(cents, summary.currency) : '—');
  const invoiceNote = !summary || summary.open_invoices === 0
    ? 'Nothing outstanding'
    : `${summary.open_invoices} open invoice${summary.open_invoices === 1 ? '' : 's'}${summary.overdue_invoices ? `, ${summary.overdue_invoices} overdue` : ''}`;

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Financial Summary</h3>
      {failed && <p style={styles.empty}>The figures could not be loaded.</p>}
      {!failed && (
        <div style={styles.financialGrid}>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>Balance due</span>
            <span style={styles.financialValue}>{summary ? money(summary.balance_due_cents) : '…'}</span>
            {summary && <span style={styles.financialLabel}>{invoiceNote}</span>}
          </div>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>Lifetime value</span>
            <span style={styles.financialValue}>{summary ? money(summary.lifetime_value_cents) : '…'}</span>
          </div>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>Account credit</span>
            <span style={styles.financialValue}>{summary ? money(summary.account_credit_cents) : '…'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A stored date as the YYYY-MM-DD a date field needs. The API sends date columns as a
 * timestamp at the server's local midnight (e.g. "1990-04-30T22:00:00.000Z" for 1 May on a
 * server in Madrid), so the calendar day is read from noon of that day, not from the text.
 */
function dateOnly(value?: string | null): string {
  if (!value) return '';
  if (/^d{4}-d{2}-d{2}$/.test(value)) return value;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? '' : new Date(t + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

function OverviewTab({ customer, tags, preferences, staff, onUpdate, onOpenConsent }: {
  customer: Customer; tags: any[]; preferences: any; staff: Array<{ id: string; first_name: string; last_name: string }>;
  onUpdate: (c: Customer) => void; onOpenConsent: () => void;
}) {
  const fromCustomer = () => ({
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email || '',
    phone: customer.phone || '',
    date_of_birth: dateOnly(customer.date_of_birth),
    gender: customer.gender || '',
    preferred_language: customer.preferred_language || 'en',
    country: customer.country || '',
    lifecycle_stage: customer.lifecycle_stage || 'lead',
    owner_user_id: customer.owner_user_id || '',
    home_location_id: customer.home_location_id || '',
    address_line: customer.address_line || '',
    city: customer.city || '',
    postal_code: customer.postal_code || '',
    region: customer.region || '',
  });
  const businessId = localStorage.getItem('business_id') || '';
  const draft = useDraft('profile-contact', 'Contact information', fromCustomer(), async (values) => {
    const updated = await customersApi.updateCustomer(customer.id, businessId, values);
    onUpdate(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  // A change made elsewhere on the page (e.g. More › Assign staff member) becomes the new
  // stored value while nothing here is being edited.
  useEffect(() => { if (!draft.dirty) draft.load(fromCustomer()); }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = (key: keyof ReturnType<typeof fromCustomer>) => fieldMark(draft.changed((v) => v[key]));

  // The home location is one of the business's own active locations.
  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/locations?business_id=${businessId}&status=active`)
      .then((r) => setLocations((r.data.data || []).filter((l: any) => l.status === 'active' || !l.status)))
      .catch(() => setLocations([]));
  }, [businessId]);

  const text = (key: keyof typeof form, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor={`f-${key}`}>{label}</label><input id={`f-${key}`} style={{ ...styles.fieldInput, ...mark(key) }} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} /></div>
  );

  return (
    <div style={styles.tabContent}>

      {/* Cards layout */}
      <div style={styles.overviewGrid}>
        {/* Contact Information Card — always editable */}
        <div style={{ ...styles.card, gridColumn: '1 / -1', ...draftBox(draft.dirty) }}>
          <h3 style={styles.cardTitle}>Contact Information<UnsavedTag dirty={draft.dirty} /></h3>
          <div style={styles.contactGrid}>
            {text('first_name', 'First Name')}
            {text('last_name', 'Last Name')}
            {text('email', 'Email', { type: 'email' })}
            {text('phone', 'Phone')}
            {text('date_of_birth', 'Date of Birth', { type: 'date' })}
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-gender">Gender</label>
              <select id="f-gender" style={{ ...styles.fieldInput, ...mark('gender') }} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="non-binary">Non-binary</option><option value="other">Other</option>
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-lang">Language</label>
              <select id="f-lang" style={{ ...styles.fieldInput, ...mark('preferred_language') }} value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
                <option value="en">English</option><option value="es">Spanish</option>
              </select>
            </div>
            {text('country', 'Country')}
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-stage">Lifecycle Stage</label>
              <select id="f-stage" style={{ ...styles.fieldInput, ...mark('lifecycle_stage') }} value={form.lifecycle_stage} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
                <option value="lead">Lead</option>
                <option value="trial">New customer</option>
                <option value="active">Active</option>
                <option value="at_risk">At risk</option>
                <option value="churned">Former</option>
                <option value="winback">Won back</option>
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-staff">Staff member</label>
              <select id="f-staff" style={{ ...styles.fieldInput, ...mark('owner_user_id') }} value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}>
                <option value="">Unassigned</option>
                {staff.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-home">Home location</label>
              <select id="f-home" style={{ ...styles.fieldInput, ...mark('home_location_id') }} value={form.home_location_id} onChange={(e) => setForm({ ...form, home_location_id: e.target.value })}>
                <option value="">Not set</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                {form.home_location_id && !locations.some((l) => l.id === form.home_location_id) && <option value={form.home_location_id}>{customer.home_location_name || 'Current location'}</option>}
              </select>
            </div>
          </div>
          <h4 style={styles.subTitle}>Address</h4>
          <div style={styles.contactGrid}>
            <div style={{ gridColumn: 'span 2' }}>{text('address_line', 'Street address')}</div>
            {text('city', 'City')}
            {text('postal_code', 'Postal code')}
            {text('region', 'Province / region')}
          </div>
        </div>

        <FinancialSummaryCard customerId={customer.id} businessId={businessId} />
        <MembershipCard customerId={customer.id} businessId={businessId} />
        <VisitsCreditsCard customerId={customer.id} businessId={businessId} />
        <CommunicationCard preferences={preferences} onOpenConsent={onOpenConsent} />

        {/* Payment Methods on File — the customer's stored, tokenized methods
            (used for one-time charges and membership renewals). The reusable
            component handles list / add (card, direct debit) / default / remove;
            tenant scope is resolved server-side from the JWT. */}
        <div style={styles.card}>
          <PaymentMethods
            owner={{ owner_level: 'customer', customer_id: customer.id, business_id: businessId }}
            title="Payment Methods on File"
          />
        </div>

        {/* Tags Card */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Tags</h3>
          {tags.length === 0 && <p style={styles.cardMuted}>No tags.</p>}
          <div style={styles.tagsList}>
            {tags.map((tag: any) => (
              <span key={tag.id} style={{ ...styles.tag, borderColor: tag.color }}>{tag.name}</span>
            ))}
          </div>
        </div>

        <ReferralsCard customerId={customer.id} businessId={businessId} />
        <ReviewsCard customer={customer} businessId={businessId} />
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

  // New notes and deletions wait for the page's Save changes (David, 2026-11-01).
  type PendingNotes = { added: Array<{ key: string; category: string; content: string }>; removed: string[] };
  const draft = useDraft<PendingNotes>('profile-notes', 'Notes', { added: [], removed: [] }, async (d) => {
    const left: PendingNotes = { added: [...d.added], removed: [...d.removed] };
    try {
      for (const n of d.added) { await customersApi.createNote(customerId, businessId, { category: n.category, content: n.content }); left.added.shift(); }
      for (const id of d.removed) { await customersApi.deleteNote(customerId, id, businessId); left.removed.shift(); }
    } catch (err) { fetchNotes(0); draft.rebase({ added: [], removed: [] }, left); throw err; }
    fetchNotes(0);
    return { added: [], removed: [] };
  });
  const handleAddNote = () => {
    if (!newNote.trim()) return;
    draft.setValue({ ...draft.value, added: [{ key: `${Date.now()}`, category, content: newNote.trim() }, ...draft.value.added] });
    setNewNote('');
  };
  const toggleDelete = (noteId: string) => draft.setValue({
    ...draft.value,
    removed: draft.value.removed.includes(noteId) ? draft.value.removed.filter((x) => x !== noteId) : [...draft.value.removed, noteId],
  });

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div style={{ ...styles.tabContent, ...draftBox(draft.dirty) }}>
      <UnsavedTag dirty={draft.dirty} />
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
          {/* The category is optional (David, 2026-11-01). */}
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select} aria-label="Category">
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
          </select>
          <Button onClick={handleAddNote} disabled={!newNote.trim()}>Add Note</Button>
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
          <button onClick={() => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); }} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>Clear</button>
        )}
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>{total} note{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Notes list: new ones first, then the stored ones */}
      {draft.value.added.map((n) => (
        <div key={n.key} style={{ ...styles.noteCard, ...fieldMark(true) }}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {n.category && <Badge variant="neutral">{n.category}</Badge>}
              <RowTag>New</RowTag>
            </div>
            <button onClick={() => draft.setValue({ ...draft.value, added: draft.value.added.filter((x) => x.key !== n.key) })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 }} title="Remove this new note">×</button>
          </div>
          <p style={styles.noteContent}>{n.content}</p>
        </div>
      ))}
      {notesList.length === 0 && draft.value.added.length === 0 && <p style={styles.empty}>No notes found</p>}
      {notesList.map((note: any) => draft.value.removed.includes(note.id) ? (
        <div key={note.id} style={{ ...styles.noteCard, opacity: 0.6 }}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {note.category && <Badge variant="neutral">{note.category}</Badge>}
              <RowTag>Deleted when you save</RowTag>
            </div>
            <Button size="sm" variant="ghost" onClick={() => toggleDelete(note.id)}>Undo</Button>
          </div>
          <p style={{ ...styles.noteContent, textDecoration: 'line-through' }}>{note.content || '(encrypted)'}</p>
        </div>
      ) : (
        <div key={note.id} style={styles.noteCard}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {note.category && <Badge variant="neutral">{note.category}</Badge>}
              {note.is_sensitive && <Badge variant="error">Sensitive</Badge>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={styles.noteDate}>{new Date(note.created_at).toLocaleDateString()}</span>
              <button onClick={() => toggleDelete(note.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 }} title="Delete note">×</button>
            </div>
          </div>
          <p style={styles.noteContent}>{note.content || '(encrypted)'}</p>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: 'var(--space-md)' }}>
          <button disabled={offset === 0} onClick={() => fetchNotes(offset - LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}>Previous</button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}>Page {currentPage} of {totalPages}</span>
          <button disabled={offset + LIMIT >= total} onClick={() => fetchNotes(offset + LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: offset + LIMIT >= total ? 'default' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1 }}>Next</button>
        </div>
      )}
    </div>
  );
}

const TIMELINE_FILTERS: Array<[customersApi.TimelineFilter, string]> = [
  ['all', 'All'], ['booking', 'Bookings'], ['membership', 'Membership'], ['pack', 'Packs'], ['payment', 'Payments'],
  ['lifecycle', 'Lifecycle'], ['profile_change', 'Profile changes'], ['message', 'Messages'],
];
const TIMELINE_KIND_LABELS: Record<string, string> = {
  booking: 'Booking', membership: 'Membership', pack: 'Pack', payment: 'Payment', lifecycle: 'Lifecycle',
  profile_change: 'Profile change', message: 'Message', event: 'Event', campaign: 'Campaign', note: 'Note',
  tag: 'Tag', document: 'Document', widget_registration: 'Sign-up', identity_match: 'Matched',
};

/**
 * Every interaction of the person with the business in one place (THE-16): newest first,
 * with what is still to come (future bookings, the next renewal) highlighted. A payment is
 * one line; its receipt or invoice opens from the Billing tab or the link on the line.
 */
function TimelineTab({ customerId, businessId }: { customerId: string; businessId: string }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<customersApi.TimelineFilter>('all');
  const [items, setItems] = useState<customersApi.TimelineItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setItems(null); setFailed(false);
    customersApi.getTimeline(customerId, businessId, filter).then(setItems).catch(() => setFailed(true));
  }, [customerId, businessId, filter]);

  const openLink = async (link: NonNullable<customersApi.TimelineItem['link']>) => {
    if (link.type === 'order') { navigate(`/receipt/${link.id}`); return; }
    try {
      const blob = await payApi.fetchReceiptPdf(link.id, businessId);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch { alert('The receipt could not be opened.'); }
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.filterRow}>
        {TIMELINE_FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
            style={{ ...styles.filterBtn, textTransform: 'none', ...(filter === key ? styles.filterBtnActive : {}) }}>
            {label}
          </button>
        ))}
      </div>
      <p style={{ ...styles.cardMuted, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-sm)' }}>
        <span aria-hidden="true" style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'var(--color-info-bg)', border: '1px solid var(--color-info)' }} />
        Highlighted lines are still to come.
      </p>
      {failed && <p style={styles.empty}>The timeline could not be loaded.</p>}
      {!failed && items === null && <p style={styles.empty}>Loading…</p>}
      {filter === 'message' && items !== null && items.length === 0 && (
        <p style={styles.empty}>No messages sent yet. Messages received are in the Messages tab.</p>
      )}
      {filter !== 'message' && items !== null && items.length === 0 && <p style={styles.empty}>Nothing here yet.</p>}
      {items !== null && items.length > 0 && (
        <div style={styles.timelineGrid}>
          <span style={styles.timelineHeaderCell}>Type</span>
          <span style={styles.timelineHeaderCell}>Description</span>
          <span style={styles.timelineHeaderCell}>By</span>
          <span style={styles.timelineHeaderCell}>Date</span>
          {items.map((it) => {
            const tint = it.upcoming ? { background: 'var(--color-info-bg)' } : {};
            return (
              <div key={it.id} style={styles.timelineRow}>
                <span style={{ ...styles.timelineCell, ...tint, whiteSpace: 'nowrap' }}><Badge variant="neutral">{TIMELINE_KIND_LABELS[it.kind] || it.kind}</Badge></span>
                <span style={{ ...styles.timelineDesc, ...tint, gap: '8px', flexWrap: 'wrap' }}>
                  {it.description}
                  {it.link && <button type="button" onClick={() => openLink(it.link!)} style={styles.inlineLink}>Receipt</button>}
                </span>
                <span style={{ ...styles.timelineActor, ...tint }}>{it.actor_name}</span>
                <span style={{ ...styles.timelineDate, ...tint, ...(it.upcoming ? { color: 'var(--color-info-dark)', fontWeight: 700 } : {}) }}>
                  {it.upcoming ? 'Upcoming · ' : ''}{new Date(it.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Billing tab: transaction history + outstanding invoices (Section C, task 4.10) ---
function BillingTab({ customerId, businessId }: { customerId: string; businessId: string }) {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<PayTransaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [invoicingEnabled, setInvoicingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refundTxn, setRefundTxn] = useState<PayTransaction | null>(null);
  // Order-linked charges refund through the shared line-item modal (Option B).
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [showIssueInvoice, setShowIssueInvoice] = useState(false);
  const [creditBalance, setCreditBalance] = useState<payApi.AccountCreditBalance | null>(null);
  const [applyingCreditTo, setApplyingCreditTo] = useState<string | null>(null);
  // The transaction history's date range is the Date column's filter (column filters beside the
  // sort icon, David 2026-11-02); the other columns filter the loaded rows on screen. No page starts filtered (David, 2026-11-04).
  const [txFilters, setTxFilters] = useState<TableFilters>({});
  const dateFrom = txFilters.created_at?.from || '';
  const dateTo = txFilters.created_at?.to || txFilters.created_at?.from || '';
  // The history's non-date columns, filtered on screen (Date is the server range).
  const TX_FILTER_COLUMNS = [
    { key: 'purpose_label', kind: 'values' as const, value: (t: PayTransaction) => t.purpose_label },
    { key: 'payment_method', kind: 'values' as const, value: (t: PayTransaction) => t.payment_method },
    { key: 'type', kind: 'values' as const, value: (t: PayTransaction) => t.type },
    { key: 'amount', kind: 'amount' as const, value: (t: PayTransaction) => t.amount },
    { key: 'status', kind: 'values' as const, value: (t: PayTransaction) => displayStatus(t) },
  ];

  // Transactions reload whenever the date range changes; the other panels
  // (invoices, methods, credit) are range-independent and load once.
  const loadTransactions = useCallback(async () => {
    const txns = await payApi.listTransactions({
      business_id: businessId, customer_id: customerId,
      date_from: dateFrom || undefined, date_to: dateTo || undefined, limit: 200,
    });
    setTransactions(txns.transactions);
  }, [businessId, customerId, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invs, pms, invEnabled, credit] = await Promise.all([
        payApi.listInvoices(businessId, { customerId }),
        payApi.listPaymentMethods({ owner_level: 'customer', business_id: businessId, customer_id: customerId }),
        payApi.getInvoicingEnabled(businessId).catch(() => false),
        payApi.getAccountCredit(businessId, customerId).catch(() => null),
      ]);
      setInvoices(invs);
      setMethods(pms);
      setInvoicingEnabled(invEnabled);
      setCreditBalance(credit?.balance ?? null);
      await loadTransactions();
    } catch { /* leave empty on error */ }
    finally { setLoading(false); }
  }, [businessId, customerId, loadTransactions]);

  // Loads everything on mount, on customer/business change, AND whenever the
  // date range changes (loadTransactions is a dep). A date change thus refreshes
  // the whole tab — cheap enough, and keeps post-mutation refreshes correct.
  useEffect(() => { load(); }, [load]);

  // Refundable amount remaining on a charge = amount − prior refunds against it.
  const refundedByCharge = new Map<string, number>();
  for (const t of transactions) {
    if (t.type === 'refund' && t.refund_of_id && (t.status === 'completed' || t.status === 'pending')) {
      refundedByCharge.set(t.refund_of_id, (refundedByCharge.get(t.refund_of_id) ?? 0) + t.amount);
    }
  }
  const remainingRefundable = (t: PayTransaction) => t.amount - (refundedByCharge.get(t.id) ?? 0);

  // The status shown in the history list. The stored status stays 'completed'
  // (the charge itself succeeded); this is a DISPLAY label that reflects how much
  // of a completed charge has since been refunded, so a refunded/partially-
  // refunded charge is visible at a glance without opening the kebab.
  const displayStatus = (t: PayTransaction): string => {
    if (t.type === 'charge' && t.status === 'completed') {
      const refunded = refundedByCharge.get(t.id) ?? 0;
      if (refunded > 0) return refunded >= t.amount ? 'refunded' : 'partially refunded';
    }
    return t.status;
  };

  // How a charge can be refunded from here, per the business rules:
  //   'order'       → open the shared line-item order modal (products / no-show fees)
  //   'transaction' → the flat per-transaction refund (ad-hoc payments, invoice settles)
  //   null          → not refundable (membership, gift card, account credit, or fully refunded)
  const refundKindOf = (t: PayTransaction) => payApi.refundKind(t, remainingRefundable(t));

  // Open the right refund flow for a row.
  const startRefund = (t: PayTransaction) => {
    const kind = refundKindOf(t);
    if (kind === 'order') { setRefundOrderId(payApi.orderIdFor(t)); return; }
    if (kind === 'transaction') { setRefundTxn(t); }
  };

  const outstanding = invoices.filter((i) => i.status === 'issued' || i.status === 'overdue');

  const statusVariant = (s: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
    if (s === 'completed' || s === 'paid') return 'success';
    if (s === 'partially refunded') return 'warning';
    if (s === 'refunded') return 'neutral';
    if (s === 'pending' || s === 'issued') return 'info';
    if (s === 'failed' || s === 'overdue') return 'error';
    if (s === 'void' || s === 'cancelled') return 'neutral';
    return 'neutral';
  };

  const payInvoice = async (invoiceId: string) => {
    const method = methods.find((m) => m.is_default) ?? methods[0];
    if (!method) { setMessage('Add a stored payment method before settling an invoice.'); return; }
    setPayingId(invoiceId); setMessage(null);
    try {
      const res = await payApi.settleInvoice(invoiceId, businessId, method.id);
      setMessage(res.status === 'failed' ? (res.failureReason || 'Payment declined.') : `Invoice paid (ref ${res.referenceNumber}).`);
      await load();
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to settle invoice.');
    } finally { setPayingId(null); }
  };

  const openPdf = async (invoiceId: string) => {
    try {
      const blob = await payApi.fetchInvoicePdf(invoiceId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMessage('Failed to open invoice PDF.'); }
  };

  // Email the issued invoice to the customer (Outstanding Invoices card).
  const emailInvoiceDoc = async (invoiceId: string) => {
    setMessage(null);
    try {
      await payApi.emailInvoice(invoiceId, businessId);
      setMessage('Invoice emailed to the customer.');
    } catch (err: any) {
      setMessage(err?.response?.data?.message || 'Failed to email invoice.');
    }
  };

  // Email (re-send) the document that corresponds to a transaction row. The
  // server derives which document (invoice / receipt / credit note) from the row.
  const DOC_LABELS: Record<string, string> = {
    'invoice.issued': 'Adjustment', 'payment.receipt': 'Payment Receipt',
  };
  const emailTxnDoc = async (t: PayTransaction) => {
    setMessage(null);
    try {
      const res = await payApi.emailTransaction(t.id, businessId);
      const label = DOC_LABELS[res.document] ?? 'Document';
      setMessage(`${label} emailed to ${res.recipient}.`);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setMessage(code === 'NO_RECIPIENT'
        ? 'Customer has no email address on file.'
        : (err?.response?.data?.message || 'Failed to email document.'));
    }
  };

  // Whether a transaction row links to an invoice (so Print opens its PDF).
  const invoiceIdOf = (t: PayTransaction): string | null =>
    t.invoice_id || (t.purpose_link?.type === 'invoice' ? t.purpose_link.id : null);

  // Open the branded receipt PDF for a charge row (Print).
  const printReceipt = async (t: PayTransaction) => {
    try {
      const blob = await payApi.fetchReceiptPdf(t.id, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMessage('Failed to open receipt PDF.'); }
  };

  // Open the branded credit-note (Adjustment) PDF for a credit-note row.
  const printCreditNote = async (creditNoteId: string) => {
    try {
      const blob = await payApi.fetchCreditNotePdf(creditNoteId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMessage('Failed to open credit note PDF.'); }
  };

  // Open the branded debit-note (Adjustment) PDF for a debit-note row.
  const printDebitNote = async (debitNoteId: string) => {
    try {
      const blob = await payApi.fetchDebitNotePdf(debitNoteId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMessage('Failed to open debit note PDF.'); }
  };

  // Which document a charge row prints: a credit/debit-note row prints its note;
  // an invoice-linked charge prints its invoice; any other charge prints a receipt.
  // (Refund rows have no PDF yet.)
  const printForRow = (t: PayTransaction): (() => void) | null => {
    if (t.credit_note_id) return () => printCreditNote(t.credit_note_id!);
    if (t.debit_note_id) return () => printDebitNote(t.debit_note_id!);
    const invId = invoiceIdOf(t);
    if (invId) return () => openPdf(invId);
    if (t.type === 'charge') return () => printReceipt(t);
    return null;
  };

  // Open whatever a transaction is "for": invoice -> its PDF, booking -> edit page,
  // membership -> the plan page. No-op if there's no destination.
  const openPurpose = (link: payApi.PurposeLink) => {
    if (link.type === 'invoice') { openPdf(link.id); return; }
    if (link.type === 'credit_note') { printCreditNote(link.id); return; }
    if (link.type === 'debit_note') { printDebitNote(link.id); return; }
    if (link.type === 'order') { navigate(`/receipt/${link.id}`); return; }
    if (link.type === 'booking') { navigate(`/bookings/${link.id}/edit`); return; }
    if (link.type === 'membership') { navigate(`/memberships/${link.id}`); return; }
  };

  const applyCredit = async (invoiceId: string) => {
    setApplyingCreditTo(invoiceId); setMessage(null);
    try {
      const res = await payApi.applyAccountCredit(businessId, invoiceId);
      setMessage(
        `Applied ${formatCurrency(res.appliedCents, creditBalance?.currency || 'USD')} of account credit`
        + ` (ref ${res.referenceNumber}). Invoice ${res.invoiceStatus}.`,
      );
      await load();
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to apply account credit.');
    } finally { setApplyingCreditTo(null); }
  };

  const availableCredit = creditBalance?.availableCents ?? 0;

  if (loading) return <div style={styles.tabContent}><p style={styles.empty}>Loading billing…</p></div>;

  return (
    <div style={styles.tabContent}>
      {message && <p style={{ fontSize: 'var(--font-size-sm)', color: message.toLowerCase().includes('fail') || message.toLowerCase().includes('declin') ? 'var(--color-error)' : 'var(--color-success)', marginBottom: 'var(--space-md)' }}>{message}</p>}

      {/* Account credit (unapplied payments). Only shown when the customer holds
          a positive balance — a payment taken "on account" sits here as a
          liability until it's applied to an invoice. */}
      {availableCredit > 0 && (
        <div style={{ ...styles.card, borderLeft: '3px solid var(--color-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <h3 style={{ ...styles.cardTitle, margin: 0 }}>Account Credit</h3>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                Unapplied balance available to apply to an invoice
              </span>
            </div>
            <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-accent)' }}>
              {formatCurrency(availableCredit, creditBalance?.currency || 'USD')}
            </span>
          </div>
        </div>
      )}

      {/* Outstanding invoices */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Outstanding Invoices</h3>
          {invoicingEnabled && (
            <Button size="sm" variant="secondary" onClick={() => setShowIssueInvoice(true)}>New Adjustment</Button>
          )}
        </div>
        {outstanding.length === 0 ? (
          <p style={styles.cardMuted}>No outstanding invoices.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {outstanding.map((inv) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Invoice #{inv.invoice_number}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    Due {formatDateOnly(inv.due_date)} · {formatCurrency(inv.total_cents, inv.currency)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
                  <button style={membershipActionStyle} onClick={() => openPdf(inv.id)}>PDF</button>
                  <button style={membershipActionStyle} onClick={() => emailInvoiceDoc(inv.id)}>Email</button>
                  {availableCredit > 0 && (
                    <Button size="sm" variant="secondary" loading={applyingCreditTo === inv.id} onClick={() => applyCredit(inv.id)}>
                      Apply Credit
                    </Button>
                  )}
                  <Button size="sm" loading={payingId === inv.id} onClick={() => payInvoice(inv.id)}>Pay</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Transaction History</h3>
        </div>
        <Table
          rowId={(t: PayTransaction) => t.id}
          data={applyTableFilters(transactions, TX_FILTER_COLUMNS, { ...txFilters, created_at: {} })}
          filterSource={transactions}
          filters={txFilters}
          onFiltersChange={setTxFilters}
          emptyMessage={dateFrom ? 'No transactions in this date range.' : 'No transactions yet.'}
          clientSort initialSort={{ key: 'created_at', order: 'desc' }}
          columns={[
            { key: 'created_at', header: 'Date', sortable: true, filter: 'date' as const, render: (v: string) => new Date(v).toLocaleDateString() },
            { key: 'purpose_label', header: 'For', sortable: true, render: (_: any, t: PayTransaction) => (
              <>
                {t.purpose_link ? (
                  <button
                    type="button"
                    onClick={() => openPurpose(t.purpose_link!)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', textAlign: 'left', font: 'inherit', textDecoration: 'underline' }}
                    title={t.purpose_link.type === 'invoice' ? 'Open invoice PDF' : t.purpose_link.type === 'credit_note' ? 'Open credit note PDF' : t.purpose_link.type === 'debit_note' ? 'Open debit note PDF' : t.purpose_link.type === 'order' ? 'Open receipt' : 'Open details'}
                  >
                    {t.purpose_label}
                  </button>
                ) : (
                  <span>{t.purpose_label}</span>
                )}
                {t.reference_number && (
                  <span
                    style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family-mono, monospace)' }}
                    title="Payment reference (for reconciliation with the processor)"
                  >
                    {t.reference_number}
                  </span>
                )}
              </>
            ) },
            { key: 'payment_method', header: 'Method', sortable: true },
            { key: 'type', header: 'Type', sortable: true },
            { key: 'amount', header: 'Amount', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), transactions[0]?.currency), render: (v: number, t: PayTransaction) => <div style={{ textAlign: 'right' }}>{formatCurrency(v, t.currency)}</div> },
            { key: 'status', header: 'Status', sortable: true, filterValue: (t: PayTransaction) => displayStatus(t), render: (_: any, t: PayTransaction) => { const ds = displayStatus(t); return <Badge variant={statusVariant(ds)}>{ds}</Badge>; } },
            { key: 'actions', header: '', filter: false as const, render: (_: any, t: PayTransaction) => (
              <div style={{ textAlign: 'right' }}>
                <Dropdown
                  trigger={<IconButton icon={<span style={{ fontSize: '18px', lineHeight: 1 }}>⋮</span>} aria-label="Row actions" size="sm" variant="ghost" />}
                  items={(() => {
                    const print = printForRow(t);
                    return [
                      ...(refundKindOf(t) ? [{ id: 'refund', label: 'Refund', icon: '↩', onClick: () => startRefund(t) }] : []),
                      { id: 'email', label: 'Email', icon: '✉', onClick: () => emailTxnDoc(t) },
                      ...(print ? [{ id: 'print', label: 'Print', icon: '🖨', onClick: print }] : []),
                    ];
                  })()}
                />
              </div>
            ) },
          ]}
        />
      </div>

      {refundTxn && (
        <RefundModal
          transaction={refundTxn}
          businessId={businessId}
          remainingCents={remainingRefundable(refundTxn)}
          onClose={() => setRefundTxn(null)}
          onRefunded={() => { setRefundTxn(null); load(); }}
        />
      )}

      {refundOrderId && (
        <RefundOrderModal
          orderId={refundOrderId}
          businessId={businessId}
          onClose={() => setRefundOrderId(null)}
          onRefunded={() => { setRefundOrderId(null); load(); }}
        />
      )}

      {showIssueInvoice && (
        <IssueInvoiceModal
          businessId={businessId}
          customerId={customerId}
          onClose={() => setShowIssueInvoice(false)}
          onIssued={() => { setShowIssueInvoice(false); load(); }}
        />
      )}
    </div>
  );
}

// --- Refund modal: full/partial refund of a completed charge (reason required) ---
function RefundModal({ transaction, businessId, remainingCents, onClose, onRefunded }: {
  transaction: PayTransaction; businessId: string; remainingCents: number; onClose: () => void; onRefunded: () => void;
}) {
  const [amount, setAmount] = useState(remainingCents);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) { setError('A reason is required.'); return; }
    if (amount <= 0 || amount > remainingCents) { setError(`Amount must be between 0.01 and ${(remainingCents / 100).toFixed(2)}.`); return; }
    setBusy(true); setError(null);
    try {
      // Send amount only for a partial refund; omit for a full refund of the remainder.
      await payApi.refundTransaction(businessId, transaction.id, reason.trim(), amount === remainingCents ? null : amount);
      onRefunded();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setError(code === 'FORBIDDEN'
        ? 'You do not have permission to issue refunds (Manager or Owner required).'
        : err?.response?.data?.error || 'Failed to process the refund.');
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Issue Refund"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" loading={busy} onClick={submit}>Refund</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          Refunding charge {transaction.reference_number || transaction.id.slice(0, 8)} ·
          {' '}refundable {formatCurrency(remainingCents, transaction.currency)}
          {transaction.is_processed ? ' (returns to the original method)' : ' (recorded only — manual method)'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Amount</label>
          <CurrencyInput value={amount} onChange={setAmount} style={refundInputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Reason <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <input style={refundInputStyle} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. cancelled booking" />
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

interface InvoiceLineRow { description: string; quantity: number; unitPriceCents: number; taxCents: number; itemType: payApi.InvoiceItemType; }

const INVOICE_ITEM_TYPES: { value: payApi.InvoiceItemType; label: string }[] = [
  { value: 'service', label: 'Service' },
  { value: 'product', label: 'Product' },
  { value: 'membership', label: 'Membership' },
  { value: 'package', label: 'Package' },
  { value: 'no_show_fee', label: 'No-show fee' },
];

// --- Adjustment modal: a Debit (invoice) or Credit (credit note). A debit charges
//     the customer; a credit reverses revenue and grants drawable account credit. ---
function IssueInvoiceModal({ businessId, customerId, onClose, onIssued }: {
  businessId: string; customerId: string; onClose: () => void; onIssued: () => void;
}) {
  const [mode, setMode] = useState<'debit' | 'credit'>('debit');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<InvoiceLineRow[]>([{ description: '', quantity: 1, unitPriceCents: 0, taxCents: 0, itemType: 'service' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((n, l) => n + Math.round(l.unitPriceCents * (l.quantity || 1)) + (l.taxCents || 0), 0);
  // A credit note applies immediately — its date is today, shown read-only.
  const todayStr = new Date().toISOString().slice(0, 10);

  const updateLine = (i: number, patch: Partial<InvoiceLineRow>) =>
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { description: '', quantity: 1, unitPriceCents: 0, taxCents: 0, itemType: 'service' }]);
  const removeLine = (i: number) => setLines(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines);

  const submit = async () => {
    const valid = lines.filter((l) => l.description.trim() && l.unitPriceCents > 0);
    if (valid.length === 0) { setError('Add at least one line item with a description and price.'); return; }
    if (!reason.trim()) { setError('A reason is required.'); return; }
    const lineItems = valid.map((l) => ({ description: l.description.trim(), quantity: l.quantity || 1, unit_price_cents: l.unitPriceCents, tax_cents: l.taxCents || null, item_type: l.itemType }));
    setBusy(true); setError(null);
    try {
      if (mode === 'credit') {
        await payApi.issueCreditNote({ business_id: businessId, customer_id: customerId, reason: reason.trim(), line_items: lineItems });
      } else {
        await payApi.issueDebitNote({ business_id: businessId, customer_id: customerId, reason: reason.trim(), line_items: lineItems });
      }
      onIssued();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || `Failed to issue the ${mode === 'credit' ? 'credit note' : 'debit note'}.`);
    } finally { setBusy(false); }
  };

  const isCredit = mode === 'credit';

  return (
    <Modal open onClose={onClose} title="New Adjustment" size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={submit}>
          {isCredit ? `Issue credit note (${formatCurrency(total, 'USD')})` : `Issue debit note (${formatCurrency(total, 'USD')})`}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {/* Debit note vs Credit note — a debit is a credit with the opposite sign. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Adjustment type</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={() => { setMode('debit'); setError(null); }}
              style={{ ...membershipActionStyle, padding: '6px 14px', background: !isCredit ? 'var(--color-primary)' : 'transparent', color: !isCredit ? '#fff' : 'var(--color-text-secondary)' }}>
              Debit (Debit Note)
            </button>
            <button type="button" onClick={() => { setMode('credit'); setError(null); }}
              style={{ ...membershipActionStyle, padding: '6px 14px', background: isCredit ? 'var(--color-primary)' : 'transparent', color: isCredit ? '#fff' : 'var(--color-text-secondary)' }}>
              Credit (Credit Note)
            </button>
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            {isCredit
              ? 'A credit note reverses revenue and grants the customer drawable account credit. No cash is returned.'
              : 'A debit note re-recognises revenue and draws the customer\u2019s account balance down (the mirror of a credit note). No cash is collected.'}
          </span>
        </div>

        {/* Apply date — same position, read-only for both: a debit note and a
            credit note both take effect immediately (today). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '220px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Apply date</label>
          <input type="date" style={{ ...refundInputStyle, opacity: 0.7 }} value={todayStr} readOnly aria-readonly="true" />
        </div>

        {/* Reason — required for both, same position. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Reason <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <input style={refundInputStyle} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={isCredit ? 'e.g. goodwill credit for cancelled class' : 'e.g. correction of over-credited amount'} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Line items</label>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input style={{ ...refundInputStyle, flex: 1 }} placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
              <select
                style={{ ...refundInputStyle, width: '120px' }}
                value={l.itemType}
                onChange={(e) => updateLine(i, { itemType: e.target.value as payApi.InvoiceItemType })}
                aria-label="Line item type"
              >
                {INVOICE_ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input style={{ ...refundInputStyle, width: '56px' }} type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: parseInt(e.target.value, 10) || 1 })} />
              <CurrencyInput value={l.unitPriceCents} onChange={(c) => updateLine(i, { unitPriceCents: c })} style={{ ...refundInputStyle, width: '110px' }} />
              <CurrencyInput value={l.taxCents} onChange={(c) => updateLine(i, { taxCents: c })} style={{ ...refundInputStyle, width: '90px' }} />
              <button style={membershipActionStyle} onClick={() => removeLine(i)} aria-label="Remove line">×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            <span style={{ flex: 1 }}>Description</span><span style={{ width: '120px' }}>Type</span><span style={{ width: '56px' }}>Qty</span><span style={{ width: '110px' }}>Unit price</span><span style={{ width: '90px' }}>Tax</span><span style={{ width: '24px' }} />
          </div>
          <button type="button" style={{ ...membershipActionStyle, alignSelf: 'flex-start' }} onClick={addLine}>+ Add line</button>
        </div>

        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

const refundInputStyle: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)',
};

const CONSENT_METHOD_LABELS: Record<string, string> = {
  form: 'Form', portal: 'Customer portal', unsubscribe_link: 'Unsubscribe link', staff_entry: 'Recorded by staff',
  import: 'Import', keyword_reply: 'Reply keyword', merge: 'Merge', migration: 'Carried over',
};
const CONSENT_CHANNEL_LABELS: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', in_app: 'In-app', push: 'Push' };

/** Possible duplicates flagged for this person, with review-and-merge (Phase 46 R3, R12). */
function DuplicateBanner({ customer, businessId, onMerged }: { customer: Customer; businessId: string; onMerged: (c: Customer) => void }) {
  const [flags, setFlags] = useState<customersApi.DuplicateFlag[]>([]);
  const [preview, setPreview] = useState<customersApi.MergePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    customersApi.getDuplicateFlags(customer.id, businessId).then(setFlags).catch(() => setFlags([]));
  }, [customer.id, businessId]);
  useEffect(() => { load(); }, [load]);

  if (flags.length === 0) return null;

  const review = async (flag: customersApi.DuplicateFlag) => {
    try { setPreview(await customersApi.previewMerge(customer.id, flag.other_id, businessId)); }
    catch (err: any) { alert(err.response?.data?.error || 'Could not prepare the merge'); }
  };
  const merge = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const merged = await customersApi.mergeCustomers(preview.primary.id, preview.secondary.id, businessId);
      setPreview(null);
      onMerged(merged);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Merge failed'); }
    finally { setBusy(false); }
  };
  const dismiss = async (flag: customersApi.DuplicateFlag) => {
    await customersApi.dismissDuplicateFlag(customer.id, flag.id, businessId).catch(() => {});
    load();
  };

  return (
    <div style={styles.duplicateBanner} role="status">
      <strong>Possible duplicate{flags.length > 1 ? 's' : ''}</strong>
      {flags.map((f) => (
        <div key={f.id} style={styles.duplicateRow}>
          <span>{f.other_name} · {f.other_reference} · same {f.match_type === 'phone' ? 'phone number' : 'email'}</span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="secondary" onClick={() => review(f)}>Review and merge</Button>
            <Button size="sm" variant="outline" onClick={() => dismiss(f)}>Different people</Button>
          </span>
        </div>
      ))}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Merge these two records?">
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ margin: 0 }}>
              Everything on <strong>{preview.secondary.name}</strong> ({preview.secondary.reference_number}) moves to{' '}
              <strong>{preview.primary.name}</strong> ({preview.primary.reference_number}). This cannot be undone.
            </p>
            {preview.moves.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)' }}>
                {preview.moves.map((m) => <li key={m.table}>{m.label}: {m.count}</li>)}
              </ul>
            ) : <p style={{ margin: 0 }}>The other record has nothing linked to it.</p>}
            {preview.blockers.length > 0 && (
              <p style={{ margin: 0, color: 'var(--color-error)' }}>
                Cannot merge yet: both records have {preview.blockers.map((b) => b.label.toLowerCase()).join(', ')} that must be resolved first.
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
              <Button onClick={merge} loading={busy} disabled={preview.blockers.length > 0}>Merge</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const CONSENT_KEYS = ['email_marketing', 'sms_marketing', 'push_notifications', 'booking_reminders', 'transactional_emails'];
// Marketing needs the person's own agreement: switching it on asks how it was given.
const needsEvidence = (key: string) => key !== 'booking_reminders' && key !== 'transactional_emails';

function PreferencesTab({ preferences, onSaved, customerId, businessId }: {
  preferences: any; onSaved: (prefs: any) => void; customerId: string; businessId: string;
}) {
  const [history, setHistory] = useState<customersApi.ConsentEvent[] | null>(null);
  const pick = (p: any) => Object.fromEntries(CONSENT_KEYS.map((k) => [k, !!p?.[k]]));
  // The switches wait for the page's Save changes (David, 2026-11-01); each change is then
  // recorded in the consent history with its evidence.
  const draft = useDraft<{ values: Record<string, boolean>; evidence: Record<string, string> }>('profile-consent', 'Consent', { values: pick(preferences), evidence: {} }, async (d) => {
    const before = pick(preferences);
    let latest = preferences;
    for (const key of CONSENT_KEYS) {
      if (d.values[key] === before[key]) continue;
      if (d.values[key] && needsEvidence(key) && !(d.evidence[key] || '').trim()) {
        throw new Error(`say how the person gave consent for ${CONSENT_CHANNEL_LABELS[key] || key}`);
      }
      const payload: Record<string, any> = { [key]: d.values[key] };
      if (d.values[key] && needsEvidence(key)) payload.evidence = d.evidence[key].trim();
      latest = await customersApi.updatePreferences(customerId, businessId, payload);
    }
    onSaved(latest);
    return { values: pick(latest), evidence: {} };
  });
  // Stored values that change elsewhere become the new starting point while nothing is edited here.
  useEffect(() => { if (!draft.dirty && preferences) draft.load({ values: pick(preferences), evidence: {} }); }, [preferences]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string, checked: boolean) => draft.setValue({ ...draft.value, values: { ...draft.value.values, [key]: checked } });
  const channelRow = (key: string, label: string) => {
    const changed = draft.changed((v) => v.values[key]);
    const asking = changed && draft.value.values[key] && needsEvidence(key);
    return (
      <div key={key}>
        <div style={styles.prefRow}>
          <span>{label}</span>
          <input type="checkbox" aria-label={label} checked={!!draft.value.values[key]} onChange={(e) => toggle(key, e.target.checked)} style={{ ...styles.checkbox, ...checkMark(changed) }} />
        </div>
        {asking && (
          <div style={styles.consentEvidence}>
            <label htmlFor={`consent-evidence-${key}`} style={styles.fieldLabel}>How did this person give their consent? (needed to save)</label>
            <input
              id={`consent-evidence-${key}`} autoFocus style={{ ...styles.fieldInput, ...fieldMark(true) }} value={draft.value.evidence[key] || ''}
              placeholder="For example: ticked the box on the sign-up form"
              onChange={(e) => draft.setValue({ ...draft.value, evidence: { ...draft.value.evidence, [key]: e.target.value } })}
            />
          </div>
        )}
      </div>
    );
  };

  // Reload the history whenever a switch changes.
  useEffect(() => {
    customersApi.getConsentHistory(customerId, businessId).then(setHistory).catch(() => setHistory([]));
  }, [customerId, businessId, preferences]);

  if (!preferences) return <p style={styles.empty}>Loading preferences...</p>;

  return (
    <div style={{ ...styles.tabContent, ...draftBox(draft.dirty) }}>
      <UnsavedTag dirty={draft.dirty} />
      <p style={styles.empty}>
        Marketing needs the person's own agreement, channel by channel. Transactional emails (confirmations, cancellations, receipts and purchases) are on unless the person asks to stop them; when off, none are sent.
      </p>
      {channelRow('email_marketing', 'Email Marketing')}
      {channelRow('sms_marketing', 'SMS Marketing')}
      {channelRow('push_notifications', 'Push Notifications')}
      {channelRow('booking_reminders', 'Booking Reminders')}
      {channelRow('transactional_emails', 'Transactional Emails')}

      <h3 style={styles.cardTitle}>Consent history</h3>
      {history === null && <p style={styles.empty}>Loading…</p>}
      {history !== null && history.length === 0 && <p style={styles.empty}>No consent has been recorded or withdrawn yet.</p>}
      {history !== null && history.length > 0 && (
        <ul style={styles.consentHistory}>
          {history.map((e) => (
            <li key={e.id} style={styles.consentHistoryRow}>
              <span>
                <strong>{CONSENT_CHANNEL_LABELS[e.channel] || e.channel}</strong>{' '}
                {e.category === 'reminders' ? 'reminders' : e.category === 'transactional' ? 'transactional emails' : 'marketing'}: {e.new_state ? 'given' : 'withdrawn'}
                {' · '}{CONSENT_METHOD_LABELS[e.method] || e.method}{e.actor_name ? ` by ${e.actor_name}` : ''}
                {e.evidence ? ` · "${e.evidence}"` : ''}
              </span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{formatWhen(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
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
  // Renewal payment-method editing: the enrollment id being edited + the customer's stored cards.
  const [editingMethodFor, setEditingMethodFor] = useState<string | null>(null);
  const [storedMethods, setStoredMethods] = useState<PaymentMethod[]>([]);
  const [savingMethod, setSavingMethod] = useState(false);

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await apiClient.get(`/v1/memberships?business_id=${businessId}&customer_id=${customerId}`);
      // Show every live membership (a customer may hold several at once). "Live" =
      // active/paused AND not cancelled — cancellation sets cancelled_at but leaves
      // status unchanged, so status alone would wrongly show cancelled ones as active
      // (this now matches the Active Memberships report's filter).
      // Show every membership that still matters to staff: active/paused, plus
      // renewing (in dunning — PAST DUE) and expired (a win-back candidate). Only
      // truly cancelled ones are hidden. Previously renewing/expired were dropped,
      // so a membership in dunning looked like it had vanished.
      setEnrollments(
        (res.data.data || []).filter(
          (e: any) => ['active', 'paused', 'renewing', 'expired'].includes(e.status) && !e.cancelled_at,
        ),
      );
    } catch { setEnrollments([]); }
    finally { setLoading(false); }
  }, [customerId, businessId]);

  useEffect(() => { fetchEnrollments(); }, [fetchEnrollments]);

  // The customer's stored cards, for the renewal-method picker.
  useEffect(() => {
    payApi.listPaymentMethods({ owner_level: 'customer', business_id: businessId, customer_id: customerId })
      .then(setStoredMethods).catch(() => setStoredMethods([]));
  }, [businessId, customerId]);

  const setRenewalMethod = async (enrollmentId: string, paymentMethodId: string | null) => {
    setSavingMethod(true);
    try {
      await apiClient.put(`/v1/memberships/${enrollmentId}/payment-method?business_id=${businessId}`, { payment_method_id: paymentMethodId });
      await fetchEnrollments();
      setEditingMethodFor(null);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update the renewal card.');
    } finally { setSavingMethod(false); }
  };

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
      {!loading && enrollments.length === 0 && !showEnroll && <p style={styles.cardMuted}>No membership</p>}

      {enrollments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {enrollments.map((e: any) => (
            <div key={e.id} style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{e.plan_name}</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {/* Past-due (dunning) and expired need to stand out so staff can act / re-cultivate. */}
                  {e.status === 'renewing' && <Badge variant="warning">Past due</Badge>}
                  {e.status === 'expired' && <Badge variant="error">Expired</Badge>}
                  {e.billing_frequency}
                  {e.pending_plan_id && <span style={{ color: 'var(--color-info, #4A90A4)', marginLeft: '8px' }}>↓ Downgrade pending</span>}
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Since {formatDateOnly(e.start_date)}
                {e.cancelled_at ? (
                  <span style={{ color: 'var(--color-error)' }}> · Cancels {formatDateOnly(e.current_period_end)}</span>
                ) : e.status === 'renewing' ? (
                  <span style={{ color: 'var(--color-warning, #E6A817)' }}> · Payment failed — retrying</span>
                ) : e.status === 'expired' ? (
                  <span style={{ color: 'var(--color-error)' }}> · Expired after failed renewals</span>
                ) : e.status === 'paused' ? (
                  <span style={{ color: 'var(--color-warning, #E6A817)' }}> · Paused{e.resume_at ? ` · Resumes ${formatDateOnly(e.resume_at)}` : ' indefinitely'}</span>
                ) : (
                  e.next_billing_date && ` · Next billing: ${formatDateOnly(e.next_billing_date)}`
                )}
              </div>

              {/* Renewal card: the pinned method, or the customer's default as fallback. */}
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Renewal card:{' '}
                {e.payment_method_id
                  ? <strong style={{ color: 'var(--color-text)' }}>{e.renewal_method_brand || e.renewal_method_type || 'Card'}{e.renewal_method_last4 ? ` ···· ${e.renewal_method_last4}` : ''}</strong>
                  : <span>Customer default card</span>}
                {!e.cancelled_at && (
                  <button style={{ ...membershipActionStyle, marginLeft: '8px', padding: '0 4px' }} onClick={() => setEditingMethodFor(editingMethodFor === e.id ? null : e.id)}>
                    {editingMethodFor === e.id ? 'Close' : 'Change'}
                  </button>
                )}
              </div>
              {editingMethodFor === e.id && (
                <div style={{ marginTop: '6px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {storedMethods.length === 0 ? (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>No stored cards. Add one under Payment Methods on File, then pick it here.</span>
                  ) : (
                    <>
                      <select
                        style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }}
                        defaultValue={e.payment_method_id || ''}
                        disabled={savingMethod}
                        onChange={(ev) => setRenewalMethod(e.id, ev.target.value || null)}
                      >
                        <option value="">Use customer default card</option>
                        {storedMethods.filter((m) => m.method_type !== 'bank_draw' || true).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_brand || m.method_type}{m.display_last4 ? ` ···· ${m.display_last4}` : ''}{m.is_default ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Pin a card for this membership, or use the customer's default.</span>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {e.status === 'active' && !e.cancelled_at && <button style={membershipActionStyle} onClick={() => handlePause(e.id)}>Pause</button>}
                {e.status === 'paused' && <button style={membershipActionStyle} onClick={() => handleResume(e.id)}>Resume</button>}
                {!e.cancelled_at && <button style={membershipActionStyle} onClick={() => handleChangePlan(e)}>Change Plan</button>}
                {(e.status === 'active' || e.status === 'paused') && !e.cancelled_at && <button style={{ ...membershipActionStyle, color: 'var(--color-error)' }} onClick={() => handleCancel(e.id)}>Cancel</button>}
              </div>
              {pausingEnrollmentId === e.id && (
                <div style={{ marginTop: '8px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>Pause duration</p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    {[15, 30, 45].map((d) => (
                      <button key={d} type="button" onClick={() => setPauseDays(d)}
                        style={{ padding: '6px 14px', fontSize: 'var(--font-size-sm)', borderRadius: '20px', cursor: 'pointer', border: pauseDays === d ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: pauseDays === d ? 'var(--color-primary)' : 'transparent', color: pauseDays === d ? '#fff' : 'var(--color-text)' }}>
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
            <select style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }} value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              <option value="">Select a plan...</option>
              {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.billing_frequency}</option>)}
            </select>
            <Button size="sm" onClick={handleEnroll} loading={enrolling} disabled={!selectedPlanId}>Enroll</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowEnroll(false)}>Cancel</Button>
          </div>
          {plans.length === 0 && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>No active membership plans available. Create plans under Offerings → Memberships.</p>}
        </div>
      )}

      {showChangePlan && (
        <div style={{ marginTop: '8px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>Change from <strong>{showChangePlan.plan_name}</strong> to:</p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }} value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
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

const membershipActionStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' };

const styles: Record<string, React.CSSProperties> = {
  // Full width of the content area (THE-16), so the facts fit on one line.
  page: { padding: 'var(--space-lg)' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  profileHeader: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' },
  headerTop: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  avatar: { width: '56px', height: '56px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, flexShrink: 0 },
  profileInfo: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)', flex: 1, minWidth: '240px' },
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  refNum: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerActions: { display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', alignSelf: 'flex-start' },
  joinedDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  factStrip: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-md)',
    margin: 0, padding: 'var(--space-md) 0 0', borderTop: '1px solid var(--color-divider)',
  },
  fact: { display: 'flex', flexDirection: 'column' as const, gap: '2px', minWidth: 0 },
  factLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  factValue: { margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  duplicateBanner: {
    display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)',
    margin: '0 0 var(--space-lg)', padding: 'var(--space-md) var(--space-lg)',
    background: 'var(--color-surface)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-lg)',
    fontSize: 'var(--font-size-sm)', color: 'var(--color-text)',
  },
  duplicateRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  headerBadges: { display: 'flex', flexWrap: 'wrap' as const, gap: 'var(--space-xs)', alignItems: 'center' },
  consentEvidence: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', padding: 'var(--space-md) 0', borderBottom: '1px solid var(--color-border)' },
  consentHistory: { listStyle: 'none', margin: 0, padding: 0 },
  consentHistoryRow: {
    display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', flexWrap: 'wrap' as const,
    padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)',
    fontSize: 'var(--font-size-sm)', color: 'var(--color-text)',
  },
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
  fieldInput: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  tagsSection: { marginTop: 'var(--space-lg)' },
  subTitle: { margin: 'var(--space-lg) 0 var(--space-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  inlineLink: { background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--font-size-xs)', fontWeight: 700 },
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
  filterBtnActive: { border: '1px solid var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  activityItem: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)' },
  activityDesc: { flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  activityActor: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const, fontStyle: 'italic' as const },
  activityDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const },
  timelineGrid: { display: 'grid', gridTemplateColumns: 'max-content 1fr 150px 190px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  timelineHeaderCell: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '2px solid var(--color-border)', background: 'var(--color-surface-hover)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  timelineRow: { display: 'contents' },
  timelineCell: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' },
  timelineDesc: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', wordBreak: 'break-word' as const },
  timelineActor: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' },
  timelineDate: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-sm) var(--space-sm)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' as const },
  prefRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  checkbox: { width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--color-primary)' },
};
