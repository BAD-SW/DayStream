import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { LanguageSelect } from '../components/LanguageSelect';
import { useBusinessLanguages } from '../context/useBusinessLanguages';
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
import { stageText, sourceText } from '../utils/peopleColumns';
import { formatDate as fmtDate, formatDateTime as fmtDateTime, formatNumber } from '../utils/format';
import {
  ProfilePhoto, VisitsCreditsCard, CommunicationCard, ReferralsCard, ReviewsCard,
  MessagesTab, TasksTab, DocumentsTab, AssignStaffDialog, PasswordResetDialog, PersonalDataDialog,
} from './CustomerProfileParts';
import { CustomerFormsTab } from './CustomerFormsTab';
import { CustomerPackagesTab } from './CustomerPackagesTab';
import { FormsNeededNotice } from '../components/forms/FormsNeededNotice';
import { ChartsPanel } from '../components/charts/ChartsPanel';
import { useClinicalAccess } from '../utils/useClinicalAccess';

const LIFECYCLE_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  lead: 'neutral', trial: 'info', active: 'success', at_risk: 'warning', churned: 'error', winback: 'info',
};

// The tab's words are detail.tab.<key> in the translation file.
const PROFILE_TABS: { key: string }[] = [
  { key: 'overview' }, { key: 'messages' }, { key: 'timeline' },
  { key: 'billing' }, { key: 'packages' }, { key: 'notes' }, { key: 'tasks' },
  { key: 'documents' }, { key: 'forms' }, { key: 'charts' }, { key: 'preferences' },
];

// Stage and source names come from the translation file (stage.*, source.*; 'trial' is shown as "New customer").
const formatStage = stageText;

function formatWhen(value?: string | null): string {
  return value ? fmtDateTime(value, undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** The day only, so the facts fit on one line; the time is in the tooltip. */
function formatDay(value?: string | null): string {
  return value ? fmtDate(value, { dateStyle: 'medium' }) : '—';
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
  const { t } = useTranslation('customers');
  // Treatment charts are only for clinical roles (spec 51, gap 2); other roles don't see the tab.
  const canCharts = useClinicalAccess();
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
  // Bumped when the person's forms change, so the "forms needed" notice checks again.
  const [formsRefresh, setFormsRefresh] = useState(0);
  const [timelineVersion, setTimelineVersion] = useState(0);
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  useEffect(() => { setSaveResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);
  const saveChanges = async () => {
    const { failed } = await saveAll();
    setSaveResult(failed.length ? { ok: false, text: t('detail.notSaved', { list: failed.map((f) => `${f.label} (${f.error})`).join('; ') }) } : { ok: true, text: t('detail.allSaved') });
  };

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    // A link can open a section directly, e.g. /customers/:id?tab=forms from a booking.
    const wanted = new URLSearchParams(window.location.search).get('tab');
    setTab(PROFILE_TABS.some((tb) => tb.key === wanted) ? (wanted as string) : 'overview');
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

  if (loading) return <div style={styles.loading}>{t('common:loading')}</div>;
  if (!customer) return <div style={styles.loading}>{t('detail.notFound')}</div>;

  // Switching a marketing channel ON records the person's consent, so the Consent tab
  // sends how it was obtained as `evidence`.
  const displayName = customer.display_name || `${customer.first_name} ${customer.last_name}`.trim() || customer.email || customer.phone || t('detail.unknown');
  const initials = `${(customer.first_name || displayName)[0]?.toUpperCase() || ''}${customer.last_name?.[0]?.toUpperCase() || ''}`;
  // Reload the person (and the Timeline) after an action changed something on them.
  const refresh = () => {
    customersApi.getCustomer(customer.id, businessId).then(setCustomer).catch(() => {});
    setTimelineVersion((n) => n + 1);
  };

  const handleArchive = async () => {
    if (!(await askConfirm({ message: t('detail.archiveConfirm'), confirmLabel: t('common:action.archive'), destructive: true }))) return;
    try { setCustomer(await customersApi.updateCustomer(customer.id, businessId, { status: 'archived' })); setTimelineVersion((n) => n + 1); }
    catch { void showMessage({ message: t('detail.archiveFailed'), tone: 'error' }); }
  };
  const handleReactivate = async () => {
    try { setCustomer(await customersApi.updateCustomer(customer.id, businessId, { status: 'active' })); setTimelineVersion((n) => n + 1); }
    catch { void showMessage({ message: t('detail.reactivateFailed'), tone: 'error' }); }
  };
  const handleAnonymize = async () => {
    const confirmed = await askConfirm({ message: t('detail.anonymizeConfirm'), confirmLabel: t('common:action.anonymize'), destructive: true });
    if (!confirmed) return;
    const doubleConfirm = await askConfirm({ message: t('detail.anonymizeFinal', { name: customer.first_name + ' ' + customer.last_name }), confirmLabel: t('common:action.anonymize'), destructive: true });
    if (!doubleConfirm) return;
    try {
      await customersApi.anonymizeCustomer(customer.id, businessId);
      void showMessage({ message: t('detail.anonymizeDone'), tone: 'success' });
      window.location.reload();
    } catch {
      void showMessage({ message: t('detail.anonymizeFailed'), tone: 'error' });
    }
  };

  // Header actions: Contact opens Messages, Add task opens the task form; the rest are in More.
  const moreItems = [
    { id: 'order', label: t('detail.more.newOrder'), onClick: () => guardedNavigate(`/checkout?new=true&customer=${customer.id}`) },
    { id: 'payment', label: t('detail.more.recordPayment'), onClick: () => setDialog('payment') },
    { id: 'd1', label: '', divider: true },
    { id: 'assign', label: t('detail.more.assignStaff'), onClick: () => { setTab('overview'); setTimeout(() => document.getElementById('f-staff')?.focus(), 50); } },
    { id: 'reset', label: t('detail.more.passwordReset'), disabled: !customer.has_account, onClick: () => setDialog('reset') },
    { id: 'data', label: t('detail.more.personalData'), disabled: !customer.email, onClick: () => setDialog('data') },
    { id: 'd2', label: '', divider: true },
    customer.status === 'archived'
      ? { id: 'reactivate', label: t('detail.more.reactivate'), onClick: handleReactivate }
      : { id: 'archive', label: t('detail.more.archive'), danger: true, disabled: customer.status !== 'active', onClick: handleArchive },
    { id: 'anonymize', label: t('detail.more.anonymise'), danger: true, onClick: handleAnonymize },
  ];

  const facts: Array<[string, string, string?]> = [
    [t('detail.facts.source'), sourceText(t, customer.source, customer.source_detail)],
    [t('detail.facts.staffMember'), customer.owner_name || t('people.unassigned')],
    [t('detail.facts.homeLocation'), customer.home_location_name || '—'],
    [t('detail.facts.lastActivity'), formatDay(customer.last_activity_at), formatWhen(customer.last_activity_at)],
    [t('detail.facts.lastVisit'), formatDay(customer.last_visit_at), formatWhen(customer.last_visit_at)],
    [t('detail.facts.lastLogin'), customer.has_account ? formatDay(customer.last_login_at) : t('detail.facts.noAccount'), customer.has_account ? formatWhen(customer.last_login_at) : undefined],
    [t('detail.facts.knownSince'), formatDay(customer.created_at), formatWhen(customer.created_at)],
  ];

  return (
    <div style={styles.page}>
      <TakePaymentModal open={dialog === 'payment'} onClose={() => { setDialog(null); setTimelineVersion((n) => n + 1); }} businessId={businessId} customerId={customer.id} />
      <AssignStaffDialog open={dialog === 'assign'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} staff={staff} onSaved={(c) => { setCustomer(c); setTimelineVersion((n) => n + 1); }} />
      <PasswordResetDialog open={dialog === 'reset'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} onSent={() => setTimelineVersion((n) => n + 1)} />
      <PersonalDataDialog open={dialog === 'data'} onClose={() => setDialog(null)} customer={customer} businessId={businessId} onSent={() => setTimelineVersion((n) => n + 1)} />

      <LeaveGuard when={dirty} />
      {/* Back button */}
      <button style={styles.back} onClick={() => guardedNavigate('/customers')}>{t('segments.back')}</button>

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
                {formatStage(t, customer.lifecycle_stage)}
              </Badge>
              {/* The record's own status only when it is not the usual "active". */}
              {customer.status !== 'active' && <Badge variant="neutral">{customer.status === 'anonymized' ? t('detail.status.anonymised') : customer.status === 'archived' ? t('people.archived') : customer.status}</Badge>}
              {customer.incomplete && <Badge variant="warning">{t('people.incomplete')}</Badge>}
              <span style={styles.refNum}>{t('detail.inStageSince', { date: formatDay(customer.lifecycle_changed_at) })}</span>
            </div>
          </div>
          <div style={styles.headerActions}>
            {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>{t('detail.unsaved')}</span>
              : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
            <Button size="sm" onClick={saveChanges} loading={saving} disabled={!dirty}>{t('detail.saveChanges')}</Button>
            <Button size="sm" variant="secondary" onClick={() => setTab('messages')}>{t('detail.contact')}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setTab('tasks'); setAddTaskSignal((n) => n + 1); }}>{t('profile.tasks.add')}</Button>
            <Dropdown trigger={<Button size="sm" variant="secondary">{t('detail.more.label')}</Button>} items={moreItems} />
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
      <TabBar aria-label={t('detail.sections')} tabs={PROFILE_TABS.filter((tb) => tb.key !== 'charts' || canCharts).map((tb) => ({ key: tb.key, label: t('detail.tab.' + tb.key), changed: dirtySections.some((d) => d.tab === tb.key) }))} active={tab} onChange={setTab} />
      </StickyPageTop>
      {/* Forms still to complete: shown on every tab, so staff see it as soon as they open the person. */}
      <FormsNeededNotice customerId={customer.id} businessId={businessId} refreshKey={formsRefresh} onOpenForms={() => setTab('forms')} />
      <div hidden={tab !== 'overview'}>
        <DraftTab tab="overview">
          <OverviewTab key={mergeCount} customer={customer} tags={tags} preferences={preferences} staff={staff} onUpdate={(c) => { setCustomer(c); setTimelineVersion((n) => n + 1); }} onOpenConsent={() => setTab('preferences')} />
        </DraftTab>
      </div>
      {tab === 'messages' && <MessagesTab customer={customer} />}
      {tab === 'timeline' && <TimelineTab key={timelineVersion} customerId={customer.id} businessId={businessId} />}
      {tab === 'billing' && <BillingTab customerId={customer.id} businessId={businessId} />}
      {tab === 'packages' && <CustomerPackagesTab customerId={customer.id} businessId={businessId} />}
      <div hidden={tab !== 'notes'}><DraftTab tab="notes"><NotesTab notes={notes} customerId={customer.id} businessId={businessId} onRefresh={(n) => setNotes(n)} /></DraftTab></div>
      <div hidden={tab !== 'tasks'}><DraftTab tab="tasks"><TasksTab customer={customer} businessId={businessId} staff={staff} addSignal={addTaskSignal} /></DraftTab></div>
      <div hidden={tab !== 'documents'}><DraftTab tab="documents"><DocumentsTab customerId={customer.id} businessId={businessId} /></DraftTab></div>
      {tab === 'charts' && canCharts && <ChartsPanel customerId={customer.id} businessId={businessId} />}
      {tab === 'forms' && <CustomerFormsTab customerId={customer.id} businessId={businessId} customerEmail={customer.email} onChanged={() => setFormsRefresh((n) => n + 1)} />}
      <div hidden={tab !== 'preferences'}><DraftTab tab="preferences"><PreferencesTab preferences={preferences} onSaved={(prefs) => { setPreferences(prefs); setTimelineVersion((n) => n + 1); }} customerId={customer.id} businessId={businessId} /></DraftTab></div>
    </div>
  );
}

// --- Sub-components for tabs ---

/** What the person owes, what they have paid in total and their unused credit, in the business currency. */
function FinancialSummaryCard({ customerId, businessId }: { customerId: string; businessId: string }) {
  const { t } = useTranslation('customers');
  const [summary, setSummary] = useState<customersApi.FinancialSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSummary(null);
    setFailed(false);
    customersApi.getFinancialSummary(customerId, businessId).then(setSummary).catch(() => setFailed(true));
  }, [customerId, businessId]);

  const money = (cents: number) => (summary ? formatCurrency(cents, summary.currency) : '—');
  const invoiceNote = !summary || summary.open_invoices === 0
    ? t('detail.fin.nothing')
    : t('detail.fin.openInvoices', { count: summary.open_invoices }) + (summary.overdue_invoices ? t('detail.fin.overdueSuffix', { n: summary.overdue_invoices }) : '');

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{t('detail.fin.title')}</h3>
      {failed && <p style={styles.empty}>{t('profile.visitsCredits.failed')}</p>}
      {!failed && (
        <div style={styles.financialGrid}>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>{t('detail.fin.balanceDue')}</span>
            <span style={styles.financialValue}>{summary ? money(summary.balance_due_cents) : '…'}</span>
            {summary && <span style={styles.financialLabel}>{invoiceNote}</span>}
          </div>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>{t('detail.fin.lifetimeValue')}</span>
            <span style={styles.financialValue}>{summary ? money(summary.lifetime_value_cents) : '…'}</span>
          </div>
          <div style={styles.financialItem}>
            <span style={styles.financialLabel}>{t('detail.fin.accountCredit')}</span>
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
  const { t } = useTranslation('customers');
  const { languages: businessLanguages } = useBusinessLanguages();
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
  const draft = useDraft('profile-contact', t('detail.contact.draft'), fromCustomer(), async (values) => {
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
          <h3 style={styles.cardTitle}>{t('detail.contact.title')}<UnsavedTag dirty={draft.dirty} /></h3>
          <div style={styles.contactGrid}>
            {text('first_name', t('detail.contact.firstName'))}
            {text('last_name', t('detail.contact.lastName'))}
            {text('email', t('create.email'), { type: 'email' })}
            {text('phone', t('create.phone'))}
            {text('date_of_birth', t('create.dateOfBirth'), { type: 'date' })}
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-gender">{t('create.gender')}</label>
              <select id="f-gender" style={{ ...styles.fieldInput, ...mark('gender') }} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">{t('detail.contact.notSpecified')}</option><option value="male">{t('cond.gender.male')}</option><option value="female">{t('cond.gender.female')}</option><option value="non-binary">{t('detail.contact.nonBinary')}</option><option value="other">{t('cond.gender.other')}</option>
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-lang">{t('create.language')}</label>
              <LanguageSelect languages={businessLanguages} id="f-lang" style={{ ...styles.fieldInput, ...mark('preferred_language') }} value={form.preferred_language} onChange={(v) => setForm({ ...form, preferred_language: v })} />
            </div>
            {text('country', t('create.country'))}
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-stage">{t('detail.contact.lifecycleStage')}</label>
              <select id="f-stage" style={{ ...styles.fieldInput, ...mark('lifecycle_stage') }} value={form.lifecycle_stage} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
                <option value="lead">{t('stage.lead')}</option>
                <option value="trial">{t('stage.trial')}</option>
                <option value="active">{t('stage.active')}</option>
                <option value="at_risk">{t('stage.at_risk')}</option>
                <option value="churned">{t('stage.churned')}</option>
                <option value="winback">{t('stage.winback')}</option>
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-staff">{t('detail.facts.staffMember')}</label>
              <select id="f-staff" style={{ ...styles.fieldInput, ...mark('owner_user_id') }} value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}>
                <option value="">{t('people.unassigned')}</option>
                {staff.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
              </select>
            </div>
            <div style={styles.formGroup}><label style={styles.fieldLabel} htmlFor="f-home">{t('detail.facts.homeLocation')}</label>
              <select id="f-home" style={{ ...styles.fieldInput, ...mark('home_location_id') }} value={form.home_location_id} onChange={(e) => setForm({ ...form, home_location_id: e.target.value })}>
                <option value="">{t('detail.contact.notSet')}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                {form.home_location_id && !locations.some((l) => l.id === form.home_location_id) && <option value={form.home_location_id}>{customer.home_location_name || t('detail.contact.currentLocation')}</option>}
              </select>
            </div>
          </div>
          <h4 style={styles.subTitle}>{t('detail.contact.address')}</h4>
          <div style={styles.contactGrid}>
            <div style={{ gridColumn: 'span 2' }}>{text('address_line', t('detail.contact.streetAddress'))}</div>
            {text('city', t('cond.l.city'))}
            {text('postal_code', t('detail.contact.postalCode'))}
            {text('region', t('detail.contact.region'))}
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
            title={t('detail.contact.paymentMethods')}
          />
        </div>

        {/* Tags Card */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>{t('leads.col.tags')}</h3>
          {tags.length === 0 && <p style={styles.cardMuted}>{t('detail.contact.noTags')}</p>}
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
  const { t } = useTranslation('customers');
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
  const draft = useDraft<PendingNotes>('profile-notes', t('detail.tab.notes'), { added: [], removed: [] }, async (d) => {
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
          placeholder={t('detail.notes.placeholder')}
          style={styles.textarea}
          rows={3}
        />
        <div style={styles.noteActions}>
          {/* The category is optional (David, 2026-11-01). */}
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select} aria-label={t('detail.notes.category')}>
            <option value="">{t('detail.notes.noCategory')}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
          </select>
          <Button onClick={handleAddNote} disabled={!newNote.trim()}>{t('detail.notes.add')}</Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.select}>
          <option value="">{t('detail.notes.allCategories')}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.name}>{cat.name}</option>
          ))}
        </select>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ ...styles.select, minWidth: '130px' }} title={t('cond.l.from')} />
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ ...styles.select, minWidth: '130px' }} title={t('cond.l.to')} />
        {(filterCategory || filterDateFrom || filterDateTo) && (
          <button onClick={() => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); }} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>{t('detail.notes.clear')}</button>
        )}
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>{t('detail.notes.count', { count: total })}</span>
      </div>

      {/* Notes list: new ones first, then the stored ones */}
      {draft.value.added.map((n) => (
        <div key={n.key} style={{ ...styles.noteCard, ...fieldMark(true) }}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {n.category && <Badge variant="neutral">{n.category}</Badge>}
              <RowTag>{t('profile.new')}</RowTag>
            </div>
            <button onClick={() => draft.setValue({ ...draft.value, added: draft.value.added.filter((x) => x.key !== n.key) })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 }} title={t('detail.notes.removeNew')}>×</button>
          </div>
          <p style={styles.noteContent}>{n.content}</p>
        </div>
      ))}
      {notesList.length === 0 && draft.value.added.length === 0 && <p style={styles.empty}>{t('detail.notes.none')}</p>}
      {notesList.map((note: any) => draft.value.removed.includes(note.id) ? (
        <div key={note.id} style={{ ...styles.noteCard, opacity: 0.6 }}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {note.category && <Badge variant="neutral">{note.category}</Badge>}
              <RowTag>{t('profile.deletedOnSave')}</RowTag>
            </div>
            <Button size="sm" variant="ghost" onClick={() => toggleDelete(note.id)}>{t('profile.undo')}</Button>
          </div>
          <p style={{ ...styles.noteContent, textDecoration: 'line-through' }}>{note.content || t('detail.notes.encrypted')}</p>
        </div>
      ) : (
        <div key={note.id} style={styles.noteCard}>
          <div style={styles.noteHeader}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {note.category && <Badge variant="neutral">{note.category}</Badge>}
              {note.is_sensitive && <Badge variant="error">{t('detail.notes.sensitive')}</Badge>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={styles.noteDate}>{fmtDate(note.created_at)}</span>
              <button onClick={() => toggleDelete(note.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 }} title={t('detail.notes.delete')}>×</button>
            </div>
          </div>
          <p style={styles.noteContent}>{note.content || t('detail.notes.encrypted')}</p>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: 'var(--space-md)' }}>
          <button disabled={offset === 0} onClick={() => fetchNotes(offset - LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}>{t('detail.notes.previous')}</button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}>{t('detail.notes.pageOf', { page: currentPage, total: totalPages })}</span>
          <button disabled={offset + LIMIT >= total} onClick={() => fetchNotes(offset + LIMIT)}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: offset + LIMIT >= total ? 'default' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1 }}>{t('detail.notes.next')}</button>
        </div>
      )}
    </div>
  );
}

// The words for a filter are detail.timeline.filter.<key>, for a kind of line detail.timeline.kind.<kind>.
const TIMELINE_FILTERS: customersApi.TimelineFilter[] = [
  'all', 'booking', 'membership', 'pack', 'payment', 'lifecycle', 'profile_change', 'message',
];

/**
 * Every interaction of the person with the business in one place (THE-16): newest first,
 * with what is still to come (future bookings, the next renewal) highlighted. A payment is
 * one line; its receipt or invoice opens from the Billing tab or the link on the line.
 */
function TimelineTab({ customerId, businessId }: { customerId: string; businessId: string }) {
  const { t } = useTranslation('customers');
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
    } catch { void showMessage({ message: t('detail.timeline.receiptFailed'), tone: 'error' }); }
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.filterRow}>
        {TIMELINE_FILTERS.map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
            style={{ ...styles.filterBtn, textTransform: 'none', ...(filter === key ? styles.filterBtnActive : {}) }}>
            {t('detail.timeline.filter.' + key)}
          </button>
        ))}
      </div>
      <p style={{ ...styles.cardMuted, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-sm)' }}>
        <span aria-hidden="true" style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'var(--color-info-bg)', border: '1px solid var(--color-info)' }} />
        {t('detail.timeline.highlighted')}
      </p>
      {failed && <p style={styles.empty}>{t('detail.timeline.failed')}</p>}
      {!failed && items === null && <p style={styles.empty}>{t('profile.loading')}</p>}
      {filter === 'message' && items !== null && items.length === 0 && (
        <p style={styles.empty}>{t('detail.timeline.noMessages')}</p>
      )}
      {filter !== 'message' && items !== null && items.length === 0 && <p style={styles.empty}>{t('detail.timeline.nothing')}</p>}
      {items !== null && items.length > 0 && (
        <div style={styles.timelineGrid}>
          <span style={styles.timelineHeaderCell}>{t('detail.timeline.colType')}</span>
          <span style={styles.timelineHeaderCell}>{t('detail.timeline.colDescription')}</span>
          <span style={styles.timelineHeaderCell}>{t('detail.timeline.colBy')}</span>
          <span style={styles.timelineHeaderCell}>{t('detail.timeline.colDate')}</span>
          {items.map((it) => {
            const tint = it.upcoming ? { background: 'var(--color-info-bg)' } : {};
            return (
              <div key={it.id} style={styles.timelineRow}>
                <span style={{ ...styles.timelineCell, ...tint, whiteSpace: 'nowrap' }}><Badge variant="neutral">{t('detail.timeline.kind.' + it.kind, { defaultValue: it.kind })}</Badge></span>
                <span style={{ ...styles.timelineDesc, ...tint, gap: '8px', flexWrap: 'wrap' }}>
                  {it.description}
                  {it.link && <button type="button" onClick={() => openLink(it.link!)} style={styles.inlineLink}>{t('detail.timeline.receipt')}</button>}
                </span>
                <span style={{ ...styles.timelineActor, ...tint }}>{it.actor_name}</span>
                <span style={{ ...styles.timelineDate, ...tint, ...(it.upcoming ? { color: 'var(--color-info-dark)', fontWeight: 700 } : {}) }}>
                  {it.upcoming ? t('detail.timeline.upcoming') + ' · ' : ''}{fmtDateTime(it.at, undefined, { dateStyle: 'medium', timeStyle: 'short' })}
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
  const { t: tr } = useTranslation('customers');
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<PayTransaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [invoicingEnabled, setInvoicingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Whether the message is an error (red) or not (green); it was guessed from the English words before.
  const [badMessage, setBadMessage] = useState(false);
  const say = (text: string | null, bad = false) => { setMessage(text); setBadMessage(bad); };
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

  // A stored or displayed status is shown through detail.bill.status.<status>.
  const statusText = (s: string) => tr('detail.bill.status.' + s, { defaultValue: s });
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
    if (!method) { say(tr('detail.bill.addMethod')); return; }
    setPayingId(invoiceId); say(null);
    try {
      const res = await payApi.settleInvoice(invoiceId, businessId, method.id);
      say(res.status === 'failed' ? (res.failureReason || tr('detail.bill.declined')) : tr('detail.bill.paid', { ref: res.referenceNumber }), res.status === 'failed');
      await load();
    } catch (err: any) {
      say(err?.response?.data?.error || tr('detail.bill.settleFailed'), true);
    } finally { setPayingId(null); }
  };

  const openPdf = async (invoiceId: string) => {
    try {
      const blob = await payApi.fetchInvoicePdf(invoiceId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { say(tr('detail.bill.invoicePdfFailed'), true); }
  };

  // Email the issued invoice to the customer (Outstanding Invoices card).
  const emailInvoiceDoc = async (invoiceId: string) => {
    say(null);
    try {
      await payApi.emailInvoice(invoiceId, businessId);
      say(tr('detail.bill.invoiceEmailed'));
    } catch (err: any) {
      say(err?.response?.data?.message || tr('detail.bill.invoiceEmailFailed'), true);
    }
  };

  // Email (re-send) the document that corresponds to a transaction row. The
  // server derives which document (invoice / receipt / credit note) from the row.
  const emailTxnDoc = async (t: PayTransaction) => {
    say(null);
    try {
      const res = await payApi.emailTransaction(t.id, businessId);
      const label = tr('detail.bill.doc.' + res.document, { defaultValue: tr('detail.bill.doc.document') });
      say(tr('detail.bill.docEmailed', { label, recipient: res.recipient }));
    } catch (err: any) {
      const code = err?.response?.data?.code;
      say(code === 'NO_RECIPIENT'
        ? tr('detail.bill.noRecipient')
        : (err?.response?.data?.message || tr('detail.bill.docEmailFailed')), true);
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
    } catch { say(tr('detail.bill.receiptPdfFailed'), true); }
  };

  // Open the branded credit-note (Adjustment) PDF for a credit-note row.
  const printCreditNote = async (creditNoteId: string) => {
    try {
      const blob = await payApi.fetchCreditNotePdf(creditNoteId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { say(tr('detail.bill.creditPdfFailed'), true); }
  };

  // Open the branded debit-note (Adjustment) PDF for a debit-note row.
  const printDebitNote = async (debitNoteId: string) => {
    try {
      const blob = await payApi.fetchDebitNotePdf(debitNoteId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { say(tr('detail.bill.debitPdfFailed'), true); }
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
    setApplyingCreditTo(invoiceId); say(null);
    try {
      const res = await payApi.applyAccountCredit(businessId, invoiceId);
      say(tr('detail.bill.applied', { amount: formatCurrency(res.appliedCents, creditBalance?.currency || 'USD'), ref: res.referenceNumber, status: tr('detail.bill.status.' + res.invoiceStatus, { defaultValue: res.invoiceStatus }) }));
      await load();
    } catch (err: any) {
      say(err?.response?.data?.error || tr('detail.bill.applyFailed'), true);
    } finally { setApplyingCreditTo(null); }
  };

  const availableCredit = creditBalance?.availableCents ?? 0;

  if (loading) return <div style={styles.tabContent}><p style={styles.empty}>{tr('detail.bill.loading')}</p></div>;

  return (
    <div style={styles.tabContent}>
      {message && <p style={{ fontSize: 'var(--font-size-sm)', color: badMessage ? 'var(--color-error)' : 'var(--color-success)', marginBottom: 'var(--space-md)' }}>{message}</p>}

      {/* Account credit (unapplied payments). Only shown when the customer holds
          a positive balance — a payment taken "on account" sits here as a
          liability until it's applied to an invoice. */}
      {availableCredit > 0 && (
        <div style={{ ...styles.card, borderLeft: '3px solid var(--color-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <h3 style={{ ...styles.cardTitle, margin: 0 }}>{tr('detail.bill.accountCredit')}</h3>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                {tr('detail.bill.unapplied')}
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
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>{tr('detail.bill.outstanding')}</h3>
          {invoicingEnabled && (
            <Button size="sm" variant="secondary" onClick={() => setShowIssueInvoice(true)}>{tr('detail.bill.newAdjustment')}</Button>
          )}
        </div>
        {outstanding.length === 0 ? (
          <p style={styles.cardMuted}>{tr('detail.bill.noOutstanding')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {outstanding.map((inv) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{tr('detail.bill.invoiceNumber', { number: inv.invoice_number })}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {tr('detail.bill.due', { date: formatDateOnly(inv.due_date) })} · {formatCurrency(inv.total_cents, inv.currency)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge variant={statusVariant(inv.status)}>{statusText(inv.status)}</Badge>
                  <button style={membershipActionStyle} onClick={() => openPdf(inv.id)}>{tr('detail.bill.pdf')}</button>
                  <button style={membershipActionStyle} onClick={() => emailInvoiceDoc(inv.id)}>{tr('detail.bill.email')}</button>
                  {availableCredit > 0 && (
                    <Button size="sm" variant="secondary" loading={applyingCreditTo === inv.id} onClick={() => applyCredit(inv.id)}>
                      {tr('detail.bill.applyCredit')}
                    </Button>
                  )}
                  <Button size="sm" loading={payingId === inv.id} onClick={() => payInvoice(inv.id)}>{tr('detail.bill.pay')}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>{tr('detail.bill.history')}</h3>
        </div>
        <Table
          rowId={(t: PayTransaction) => t.id}
          data={applyTableFilters(transactions, TX_FILTER_COLUMNS, { ...txFilters, created_at: {} })}
          filterSource={transactions}
          filters={txFilters}
          onFiltersChange={setTxFilters}
          emptyMessage={dateFrom ? tr('detail.bill.noneInRange') : tr('detail.bill.none')}
          clientSort initialSort={{ key: 'created_at', order: 'desc' }}
          columns={[
            { key: 'created_at', header: tr('detail.bill.colDate'), sortable: true, filter: 'date' as const, render: (v: string) => fmtDate(v) },
            { key: 'purpose_label', header: tr('detail.bill.colFor'), sortable: true, render: (_: any, t: PayTransaction) => (
              <>
                {t.purpose_link ? (
                  <button
                    type="button"
                    onClick={() => openPurpose(t.purpose_link!)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', textAlign: 'left', font: 'inherit', textDecoration: 'underline' }}
                    title={tr('detail.bill.open.' + t.purpose_link.type, { defaultValue: tr('detail.bill.open.details') })}
                  >
                    {t.purpose_label}
                  </button>
                ) : (
                  <span>{t.purpose_label}</span>
                )}
                {t.reference_number && (
                  <span
                    style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family-mono, monospace)' }}
                    title={tr('detail.bill.referenceTitle')}
                  >
                    {t.reference_number}
                  </span>
                )}
              </>
            ) },
            { key: 'payment_method', header: tr('detail.bill.colMethod'), sortable: true, filterLabel: (v: string) => tr('detail.bill.method.' + v, { defaultValue: v }), render: (v: string) => tr('detail.bill.method.' + v, { defaultValue: v }) },
            { key: 'type', header: tr('detail.bill.colType'), sortable: true, filterLabel: (v: string) => tr('detail.bill.type.' + v, { defaultValue: v }), render: (v: string) => tr('detail.bill.type.' + v, { defaultValue: v }) },
            { key: 'amount', header: tr('detail.bill.colAmount'), align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), transactions[0]?.currency), render: (v: number, t: PayTransaction) => <div style={{ textAlign: 'right' }}>{formatCurrency(v, t.currency)}</div> },
            { key: 'status', header: tr('detail.bill.colStatus'), sortable: true, filterValue: (t: PayTransaction) => displayStatus(t), filterLabel: (v: string) => statusText(v), render: (_: any, t: PayTransaction) => { const ds = displayStatus(t); return <Badge variant={statusVariant(ds)}>{statusText(ds)}</Badge>; } },
            { key: 'actions', header: '', filter: false as const, render: (_: any, t: PayTransaction) => (
              <div style={{ textAlign: 'right' }}>
                <Dropdown
                  trigger={<IconButton icon={<span style={{ fontSize: '18px', lineHeight: 1 }}>⋮</span>} aria-label={tr('detail.bill.rowActions')} size="sm" variant="ghost" />}
                  items={(() => {
                    const print = printForRow(t);
                    return [
                      ...(refundKindOf(t) ? [{ id: 'refund', label: tr('detail.bill.refund'), icon: '↩', onClick: () => startRefund(t) }] : []),
                      { id: 'email', label: tr('detail.bill.email'), icon: '✉', onClick: () => emailTxnDoc(t) },
                      ...(print ? [{ id: 'print', label: tr('detail.bill.print'), icon: '🖨', onClick: print }] : []),
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
  const { t } = useTranslation('customers');
  const [amount, setAmount] = useState(remainingCents);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) { setError(t('detail.refund.reasonRequired')); return; }
    if (amount <= 0 || amount > remainingCents) { setError(t('detail.refund.amountRange', { max: formatNumber(remainingCents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })); return; }
    setBusy(true); setError(null);
    try {
      // Send amount only for a partial refund; omit for a full refund of the remainder.
      await payApi.refundTransaction(businessId, transaction.id, reason.trim(), amount === remainingCents ? null : amount);
      onRefunded();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setError(code === 'FORBIDDEN'
        ? t('detail.refund.forbidden')
        : err?.response?.data?.error || t('detail.refund.failed'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('detail.refund.title')}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
        <Button variant="destructive" loading={busy} onClick={submit}>{t('detail.bill.refund')}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          {t('detail.refund.help', { ref: transaction.reference_number || transaction.id.slice(0, 8), amount: formatCurrency(remainingCents, transaction.currency) })}
          {' '}{transaction.is_processed ? t('detail.refund.processed') : t('detail.refund.manual')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.refund.amount')}</label>
          <CurrencyInput value={amount} onChange={setAmount} style={refundInputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.refund.reason')} <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <input style={refundInputStyle} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('detail.refund.reasonPlaceholder')} />
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

interface InvoiceLineRow { description: string; quantity: number; unitPriceCents: number; taxCents: number; itemType: payApi.InvoiceItemType; }

// The words for a type are detail.invoiceType.<value>.
const INVOICE_ITEM_TYPES: { value: payApi.InvoiceItemType }[] = [
  { value: 'service' },
  { value: 'product' },
  { value: 'membership' },
  { value: 'package' },
  { value: 'no_show_fee' },
];

// --- Adjustment modal: a Debit (invoice) or Credit (credit note). A debit charges
//     the customer; a credit reverses revenue and grants drawable account credit. ---
function IssueInvoiceModal({ businessId, customerId, onClose, onIssued }: {
  businessId: string; customerId: string; onClose: () => void; onIssued: () => void;
}) {
  const { t } = useTranslation('customers');
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
    if (valid.length === 0) { setError(t('detail.invoice.needLine')); return; }
    if (!reason.trim()) { setError(t('detail.refund.reasonRequired')); return; }
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
      setError(err?.response?.data?.message || err?.response?.data?.error || (mode === 'credit' ? t('detail.invoice.creditFailed') : t('detail.invoice.debitFailed')));
    } finally { setBusy(false); }
  };

  const isCredit = mode === 'credit';

  return (
    <Modal open onClose={onClose} title={t('detail.bill.newAdjustment')} size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
        <Button variant="primary" loading={busy} onClick={submit}>
          {isCredit ? t('detail.invoice.issueCredit', { amount: formatCurrency(total, 'USD') }) : t('detail.invoice.issueDebit', { amount: formatCurrency(total, 'USD') })}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {/* Debit note vs Credit note — a debit is a credit with the opposite sign. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.invoice.type')}</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={() => { setMode('debit'); setError(null); }}
              style={{ ...membershipActionStyle, padding: '6px 14px', background: !isCredit ? 'var(--color-primary)' : 'transparent', color: !isCredit ? '#fff' : 'var(--color-text-secondary)' }}>
              {t('detail.invoice.debit')}
            </button>
            <button type="button" onClick={() => { setMode('credit'); setError(null); }}
              style={{ ...membershipActionStyle, padding: '6px 14px', background: isCredit ? 'var(--color-primary)' : 'transparent', color: isCredit ? '#fff' : 'var(--color-text-secondary)' }}>
              {t('detail.invoice.credit')}
            </button>
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            {isCredit
              ? t('detail.invoice.creditHelp')
              : t('detail.invoice.debitHelp')}
          </span>
        </div>

        {/* Apply date — same position, read-only for both: a debit note and a
            credit note both take effect immediately (today). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '220px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.invoice.applyDate')}</label>
          <input type="date" style={{ ...refundInputStyle, opacity: 0.7 }} value={todayStr} readOnly aria-readonly="true" />
        </div>

        {/* Reason — required for both, same position. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.refund.reason')} <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <input style={refundInputStyle} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={isCredit ? t('detail.invoice.creditReasonExample') : t('detail.invoice.debitReasonExample')} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('detail.invoice.lineItems')}</label>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input style={{ ...refundInputStyle, flex: 1 }} placeholder={t('detail.invoice.description')} value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
              <select
                style={{ ...refundInputStyle, width: '120px' }}
                value={l.itemType}
                onChange={(e) => updateLine(i, { itemType: e.target.value as payApi.InvoiceItemType })}
                aria-label={t('detail.invoice.lineType')}
              >
                {INVOICE_ITEM_TYPES.map((ty) => <option key={ty.value} value={ty.value}>{t('detail.invoiceType.' + ty.value)}</option>)}
              </select>
              <input style={{ ...refundInputStyle, width: '56px' }} type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: parseInt(e.target.value, 10) || 1 })} />
              <CurrencyInput value={l.unitPriceCents} onChange={(c) => updateLine(i, { unitPriceCents: c })} style={{ ...refundInputStyle, width: '110px' }} />
              <CurrencyInput value={l.taxCents} onChange={(c) => updateLine(i, { taxCents: c })} style={{ ...refundInputStyle, width: '90px' }} />
              <button style={membershipActionStyle} onClick={() => removeLine(i)} aria-label={t('detail.invoice.removeLine')}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            <span style={{ flex: 1 }}>{t('detail.invoice.description')}</span><span style={{ width: '120px' }}>{t('detail.timeline.colType')}</span><span style={{ width: '56px' }}>{t('detail.invoice.qty')}</span><span style={{ width: '110px' }}>{t('detail.invoice.unitPrice')}</span><span style={{ width: '90px' }}>{t('detail.invoice.tax')}</span><span style={{ width: '24px' }} />
          </div>
          <button type="button" style={{ ...membershipActionStyle, alignSelf: 'flex-start' }} onClick={addLine}>{t('detail.invoice.addLine')}</button>
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

// How consent was given (detail.consent.method.<method>) and on which channel (detail.consent.channel.<channel>)
// are shown through the translation file.

/** Possible duplicates flagged for this person, with review-and-merge (Phase 46 R3, R12). */
function DuplicateBanner({ customer, businessId, onMerged }: { customer: Customer; businessId: string; onMerged: (c: Customer) => void }) {
  const { t } = useTranslation('customers');
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
    catch (err: any) { void showMessage({ message: err.response?.data?.error || t('detail.dup.prepareFailed'), tone: 'error' }); }
  };
  const merge = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const merged = await customersApi.mergeCustomers(preview.primary.id, preview.secondary.id, businessId);
      setPreview(null);
      onMerged(merged);
      load();
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('detail.dup.mergeFailed'), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const dismiss = async (flag: customersApi.DuplicateFlag) => {
    await customersApi.dismissDuplicateFlag(customer.id, flag.id, businessId).catch(() => {});
    load();
  };

  return (
    <div style={styles.duplicateBanner} role="status">
      <strong>{t('detail.dup.title', { count: flags.length })}</strong>
      {flags.map((f) => (
        <div key={f.id} style={styles.duplicateRow}>
          <span>{t('detail.dup.row', { name: f.other_name, ref: f.other_reference, what: f.match_type === 'phone' ? t('detail.dup.samePhone') : t('detail.dup.sameEmail') })}</span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="secondary" onClick={() => review(f)}>{t('detail.dup.review')}</Button>
            <Button size="sm" variant="outline" onClick={() => dismiss(f)}>{t('detail.dup.different')}</Button>
          </span>
        </div>
      ))}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={t('detail.dup.mergeTitle')}>
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <p style={{ margin: 0 }}>
              <Trans t={t} i18nKey="detail.dup.mergeBody" values={{ secondary: preview.secondary.name, secondaryRef: preview.secondary.reference_number, primary: preview.primary.name, primaryRef: preview.primary.reference_number }} components={[<strong />, <strong />]} />
            </p>
            {preview.moves.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)' }}>
                {preview.moves.map((m) => <li key={m.table}>{m.label}: {m.count}</li>)}
              </ul>
            ) : <p style={{ margin: 0 }}>{t('detail.dup.nothingLinked')}</p>}
            {preview.blockers.length > 0 && (
              <p style={{ margin: 0, color: 'var(--color-error)' }}>
                {t('detail.dup.blocked', { list: preview.blockers.map((b) => b.label.toLocaleLowerCase()).join(', ') })}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setPreview(null)}>{t('common:cancel')}</Button>
              <Button onClick={merge} loading={busy} disabled={preview.blockers.length > 0}>{t('detail.dup.merge')}</Button>
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
  const { t } = useTranslation('customers');
  const [history, setHistory] = useState<customersApi.ConsentEvent[] | null>(null);
  const pick = (p: any) => Object.fromEntries(CONSENT_KEYS.map((k) => [k, !!p?.[k]]));
  // The channel a consent key is about, in words.
  const consentChannel = (key: string) => t('detail.consent.channel.' + (key === 'email_marketing' ? 'email' : key === 'sms_marketing' ? 'sms' : key === 'push_notifications' ? 'push' : key), { defaultValue: key });
  // The switches wait for the page's Save changes (David, 2026-11-01); each change is then
  // recorded in the consent history with its evidence.
  const draft = useDraft<{ values: Record<string, boolean>; evidence: Record<string, string> }>('profile-consent', t('detail.tab.preferences'), { values: pick(preferences), evidence: {} }, async (d) => {
    const before = pick(preferences);
    let latest = preferences;
    for (const key of CONSENT_KEYS) {
      if (d.values[key] === before[key]) continue;
      if (d.values[key] && needsEvidence(key) && !(d.evidence[key] || '').trim()) {
        throw new Error(t('detail.consent.sayHow', { channel: consentChannel(key) }));
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
            <label htmlFor={`consent-evidence-${key}`} style={styles.fieldLabel}>{t('detail.consent.howGiven')}</label>
            <input
              id={`consent-evidence-${key}`} autoFocus style={{ ...styles.fieldInput, ...fieldMark(true) }} value={draft.value.evidence[key] || ''}
              placeholder={t('detail.consent.example')}
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

  if (!preferences) return <p style={styles.empty}>{t('detail.consent.loading')}</p>;

  return (
    <div style={{ ...styles.tabContent, ...draftBox(draft.dirty) }}>
      <UnsavedTag dirty={draft.dirty} />
      <p style={styles.empty}>
        {t('detail.consent.intro')}
      </p>
      {channelRow('email_marketing', t('detail.consent.emailMarketing'))}
      {channelRow('sms_marketing', t('detail.consent.smsMarketing'))}
      {channelRow('push_notifications', t('detail.consent.push'))}
      {channelRow('booking_reminders', t('detail.consent.reminders'))}
      {channelRow('transactional_emails', t('detail.consent.transactional'))}

      <h3 style={styles.cardTitle}>{t('detail.consent.history')}</h3>
      {history === null && <p style={styles.empty}>{t('profile.loading')}</p>}
      {history !== null && history.length === 0 && <p style={styles.empty}>{t('detail.consent.noHistory')}</p>}
      {history !== null && history.length > 0 && (
        <ul style={styles.consentHistory}>
          {history.map((e) => (
            <li key={e.id} style={styles.consentHistoryRow}>
              <span>
                <strong>{t('detail.consent.channel.' + e.channel, { defaultValue: e.channel })}</strong>{' '}
                {e.category === 'reminders' ? t('detail.consent.cat.reminders') : e.category === 'transactional' ? t('detail.consent.cat.transactional') : t('detail.consent.cat.marketing')}: {e.new_state ? t('detail.consent.given') : t('detail.consent.withdrawn')}
                {' · '}{t('detail.consent.method.' + e.method, { defaultValue: e.method })}{e.actor_name ? ` ${t('detail.consent.by', { name: e.actor_name })}` : ''}
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
  const { t } = useTranslation('customers');
  // A billing frequency is shown through detail.membership.frequency.<value>.
  const frequency = (value: string) => t('detail.membership.frequency.' + value, { defaultValue: value });
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
      void showMessage({ message: err?.response?.data?.error || t('detail.membership.cardFailed'), tone: 'error' });
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
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('detail.membership.enrollFailed'), tone: 'error' }); }
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
    } catch { void showMessage({ message: t('detail.membership.pauseFailed'), tone: 'error' }); }
  };

  const handleResume = async (enrollmentId: string) => {
    try { await apiClient.put(`/v1/memberships/${enrollmentId}/resume?business_id=${businessId}`); await fetchEnrollments(); }
    catch { void showMessage({ message: t('detail.membership.resumeFailed'), tone: 'error' }); }
  };

  const handleCancel = async (enrollmentId: string) => {
    if (!(await askConfirm({ message: t('detail.membership.cancelConfirm'), confirmLabel: t('common:action.yes'), destructive: true }))) return;
    try { await apiClient.put(`/v1/memberships/${enrollmentId}/cancel?business_id=${businessId}`); await fetchEnrollments(); }
    catch { void showMessage({ message: t('detail.membership.cancelFailed'), tone: 'error' }); }
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
        void showMessage({ message: t('detail.membership.upgraded', { plan: result.newPlan, amount: formatCurrency(result.proratedCharge, 'EUR') }), tone: 'success' });
      } else if (result.type === 'downgrade') {
        void showMessage({ message: t('detail.membership.downgraded', { plan: result.newPlan }), tone: 'success' });
      }
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('detail.membership.changeFailed'), tone: 'error' }); }
    finally { setEnrolling(false); }
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>{t('detail.tab.membership', { defaultValue: 'Membership' })}</h3>
        {enrollments.length === 0 && !loading && (
          <Button size="sm" variant="secondary" onClick={openEnroll}>{t('detail.membership.enroll')}</Button>
        )}
      </div>

      {loading && <p style={styles.cardMuted}>{t('common:loading')}</p>}
      {!loading && enrollments.length === 0 && !showEnroll && <p style={styles.cardMuted}>{t('detail.membership.none')}</p>}

      {enrollments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {enrollments.map((e: any) => (
            <div key={e.id} style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{e.plan_name}</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {/* Past-due (dunning) and expired need to stand out so staff can act / re-cultivate. */}
                  {e.status === 'renewing' && <Badge variant="warning">{t('detail.membership.pastDue')}</Badge>}
                  {e.status === 'expired' && <Badge variant="error">{t('detail.membership.expired')}</Badge>}
                  {frequency(e.billing_frequency)}
                  {e.pending_plan_id && <span style={{ color: 'var(--color-info, #4A90A4)', marginLeft: '8px' }}>{t('detail.membership.downgradePending')}</span>}
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {t('detail.membership.since', { date: formatDateOnly(e.start_date) })}
                {e.cancelled_at ? (
                  <span style={{ color: 'var(--color-error)' }}>{' · '}{t('detail.membership.cancels', { date: formatDateOnly(e.current_period_end) })}</span>
                ) : e.status === 'renewing' ? (
                  <span style={{ color: 'var(--color-warning, #E6A817)' }}>{' · '}{t('detail.membership.paymentFailed')}</span>
                ) : e.status === 'expired' ? (
                  <span style={{ color: 'var(--color-error)' }}>{' · '}{t('detail.membership.expiredAfter')}</span>
                ) : e.status === 'paused' ? (
                  <span style={{ color: 'var(--color-warning, #E6A817)' }}>{' · '}{t('detail.membership.paused')}{e.resume_at ? ` · ${t('detail.membership.resumes', { date: formatDateOnly(e.resume_at) })}` : ` ${t('detail.membership.indefinitely')}`}</span>
                ) : (
                  e.next_billing_date && ` · ${t('detail.membership.nextBilling', { date: formatDateOnly(e.next_billing_date) })}`
                )}
              </div>

              {/* Renewal card: the pinned method, or the customer's default as fallback. */}
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {t('detail.membership.renewalCard')}{' '}
                {e.payment_method_id
                  ? <strong style={{ color: 'var(--color-text)' }}>{e.renewal_method_brand || e.renewal_method_type || t('detail.membership.card')}{e.renewal_method_last4 ? ` ···· ${e.renewal_method_last4}` : ''}</strong>
                  : <span>{t('detail.membership.defaultCard')}</span>}
                {!e.cancelled_at && (
                  <button style={{ ...membershipActionStyle, marginLeft: '8px', padding: '0 4px' }} onClick={() => setEditingMethodFor(editingMethodFor === e.id ? null : e.id)}>
                    {editingMethodFor === e.id ? t('detail.membership.close') : t('detail.membership.change')}
                  </button>
                )}
              </div>
              {editingMethodFor === e.id && (
                <div style={{ marginTop: '6px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {storedMethods.length === 0 ? (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('detail.membership.noCards')}</span>
                  ) : (
                    <>
                      <select
                        style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }}
                        defaultValue={e.payment_method_id || ''}
                        disabled={savingMethod}
                        onChange={(ev) => setRenewalMethod(e.id, ev.target.value || null)}
                      >
                        <option value="">{t('detail.membership.useDefault')}</option>
                        {storedMethods.filter((m) => m.method_type !== 'bank_draw' || true).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_brand || m.method_type}{m.display_last4 ? ` ···· ${m.display_last4}` : ''}{m.is_default ? ` ${t('detail.membership.default')}` : ''}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('detail.membership.pinHelp')}</span>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {e.status === 'active' && !e.cancelled_at && <button style={membershipActionStyle} onClick={() => handlePause(e.id)}>{t('detail.membership.pause')}</button>}
                {e.status === 'paused' && <button style={membershipActionStyle} onClick={() => handleResume(e.id)}>{t('detail.membership.resume')}</button>}
                {!e.cancelled_at && <button style={membershipActionStyle} onClick={() => handleChangePlan(e)}>{t('detail.membership.changePlan')}</button>}
                {(e.status === 'active' || e.status === 'paused') && !e.cancelled_at && <button style={{ ...membershipActionStyle, color: 'var(--color-error)' }} onClick={() => handleCancel(e.id)}>{t('common:cancel')}</button>}
              </div>
              {pausingEnrollmentId === e.id && (
                <div style={{ marginTop: '8px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>{t('detail.membership.pauseDuration')}</p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    {[15, 30, 45].map((d) => (
                      <button key={d} type="button" onClick={() => setPauseDays(d)}
                        style={{ padding: '6px 14px', fontSize: 'var(--font-size-sm)', borderRadius: '20px', cursor: 'pointer', border: pauseDays === d ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: pauseDays === d ? 'var(--color-primary)' : 'transparent', color: pauseDays === d ? '#fff' : 'var(--color-text)' }}>
                        {t('detail.membership.days', { count: d })}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button size="sm" onClick={confirmPause}>{t('detail.membership.confirmPause')}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setPausingEnrollmentId(null)}>{t('common:cancel')}</Button>
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
              <option value="">{t('detail.membership.selectPlan')}</option>
              {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {frequency(p.billing_frequency)}</option>)}
            </select>
            <Button size="sm" onClick={handleEnroll} loading={enrolling} disabled={!selectedPlanId}>{t('detail.membership.enroll')}</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowEnroll(false)}>{t('common:cancel')}</Button>
          </div>
          {plans.length === 0 && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>{t('detail.membership.noPlans')}</p>}
        </div>
      )}

      {showChangePlan && (
        <div style={{ marginTop: '8px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}><Trans t={t} i18nKey="detail.membership.changeFrom" values={{ plan: showChangePlan.plan_name }} components={[<strong />]} /></p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }} value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              <option value="">{t('detail.membership.selectNewPlan')}</option>
              {plans.filter((p: any) => p.id !== showChangePlan.plan_id).map((p: any) => <option key={p.id} value={p.id}>{p.name} — {frequency(p.billing_frequency)}</option>)}
            </select>
            <Button size="sm" onClick={confirmChangePlan} loading={enrolling} disabled={!selectedPlanId}>{t('common:confirm')}</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowChangePlan(null)}>{t('common:cancel')}</Button>
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
