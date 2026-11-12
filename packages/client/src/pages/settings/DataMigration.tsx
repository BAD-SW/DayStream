import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Alert } from '../../design-system/components/feedback/Alert';
import { Badge } from '../../design-system/components/data/Badge';
import * as api from '../../api/dataMigration';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, DEFAULT_LANGUAGE, supportedLanguagesText } from '@daystream/shared';

/**
 * Data Migration (spec 50, Waves 1-2) — one shared component scoped to a business,
 * reused by the Business Setup "Data Migration" tab (business owner) and the
 * tenant's per-business view. Offers the imports in the recommended order, each a
 * flow: upload → confirm mapping → three-tab staging (All / Mapped / Error) → import.
 * The majority-fit rows land in Mapped; outliers land in Error where the owner shifts their
 * cells into alignment and accepts them into Mapped; only the Mapped set is imported, and only
 * when the owner initiates it (Stage B, spec 50 §15.4). Shows recent import runs below.
 *
 * Full locked order (spec 50, Waves 1-3): Customers, Payment Methods, Memberships,
 * Packages, Appointments, Account Balances, Transaction History.
 */

type Step = 'pick' | 'upload' | 'review';

interface KindInfo {
  kind: api.ImportKind;
  label: string;
  blurb: string;
  prereq?: string;
}

const KINDS: KindInfo[] = [
  { kind: 'customers', label: 'Customers', blurb: 'Your customer list — names, contact details, tags, notes.' },
  { kind: 'payment_methods', label: 'Payment Methods', blurb: 'Migrated cards from your processor (Stripe Mapping File).', prereq: 'Import customers first.' },
  { kind: 'memberships', label: 'Memberships', blurb: 'Current member enrollments, matched to the membership plans you have set up.', prereq: 'Import customers and payment methods first, and create your membership plans.' },
  { kind: 'packages', label: 'Packages', blurb: 'Prepaid packages customers have purchased, keeping their original purchase date.', prereq: 'Import customers first, and create your packages.' },
  { kind: 'appointments', label: 'Appointments', blurb: 'Appointment history and upcoming bookings. Future dates become live bookings; past dates go on the customer timeline.', prereq: 'Import customers and packages first, and set up your services and staff.' },
  { kind: 'account_balances', label: 'Account Balances', blurb: 'Account credits and outstanding invoices.', prereq: 'Import customers first.' },
  { kind: 'transactions', label: 'Transaction History', blurb: 'Past payments shown on the customer timeline only — never added to your books or reports.', prereq: 'Import customers first.' },
  { kind: 'notes', label: 'Notes', blurb: 'Customer notes as their own file — each row is one note, added to the customer timeline. A customer can have as many as you have.', prereq: 'Import customers first.' },
];

// Source systems offered per import, chosen before the file is picked (server presets:
// services/migration/import-sources.ts). Add an entry as each system's layout is coded.
// The dropdown only shows when an import has more than the automatic option.
const SOURCE_OPTIONS: Partial<Record<api.ImportKind, Array<{ id: api.ImportSource; label: string; help: string }>>> = {
  payment_methods: [
    { id: 'auto', label: 'Other / custom file', help: 'Columns are detected automatically. You can change any column before importing.' },
    { id: 'stripe', label: 'Stripe', help: "The mapping file Stripe gives you after moving your customers' saved cards and bank accounts. Upload it exactly as Stripe provides it (CSV)." },
  ],
};

/**
 * The field reference shown on the upload screen, so owners know what a file can contain before
 * they pick one. Each entry must describe what the import actually does (server:
 * services/migration/*-import.ts). Imports without an entry show no table yet.
 */
interface FieldGuideRow { field: string; required: string; notes: string }
interface FieldGuide { rows: FieldGuideRow[]; notes: string[] }

// How every customer-linked import finds the customer (import-core matchCustomer).
const FIND_CUSTOMER_ROWS: FieldGuideRow[] = [
  { field: 'Processor Customer ID', required: 'At least one', notes: 'The customer\u2019s ID at your old payment processor (such as a Stripe ID starting with cus_), if the Customers import captured it.' },
  { field: 'Legacy Customer ID', required: 'At least one', notes: 'Best choice: the same customer number you used in the Customers import.' },
  { field: 'Email', required: 'At least one', notes: '' },
  { field: 'Phone', required: 'At least one', notes: '' },
];
// Shared closing points for the customer-linked imports.
const FIND_CUSTOMER_NOTE = 'Each row must match exactly one customer already in DayStream, so import customers first. Include as many of the four customer columns as you have: every one is checked, and if they point to different customers (say the legacy ID is Ana\u2019s but the email is Maria\u2019s) the row is not imported and the reason names both, so you can fix it. An email or phone shared by several customers is not used.';
const DATES_NOTE = 'Dates can be written as 2026-03-15, 15/03/2026 or 3/15/2026 (also with - or . between the parts). Whether the day or the month comes first is worked out from the file; if every date could be read either way, your business\u2019s country decides.';
const NO_EMAIL_NOTE = 'No emails or messages are sent to your customers.';

const FIELD_GUIDE: Partial<Record<api.ImportKind, FieldGuide>> = {
  customers: {
    rows: [
      { field: 'First Name', required: 'Yes', notes: 'Rows without a first name are flagged for fixing.' },
      { field: 'Last Name', required: 'No', notes: '' },
      { field: 'Email', required: 'Email or phone', notes: 'Each row needs an email, a phone number, or both. Must be a valid address (no spaces).' },
      { field: 'Phone', required: 'Email or phone', notes: "Numbers without a country code are read using the row's Country, or your business's country if there is none." },
      { field: 'Legacy Customer ID', required: 'No', notes: "The customer's number in your old system. Recommended: later imports (memberships, packages, appointments) use it to find the right customer." },
      { field: 'Processor Customer ID', required: 'No', notes: "The customer's ID at your old payment processor, e.g. a Stripe ID starting with cus_. Lets the payment methods import match cards to customers exactly." },
      { field: 'Date of Birth', required: 'No', notes: 'Any common date format.' },
      { field: 'Gender', required: 'No', notes: 'For example Male, Female, M, F.' },
      { field: 'Language', required: 'No', notes: `${supportedLanguagesText()}, as a name or code (${SUPPORTED_LANGUAGES.join(', ')}). Other languages are left blank with a warning. Blank means ${LANGUAGE_LABELS[DEFAULT_LANGUAGE]}.` },
      { field: 'Country', required: 'No', notes: 'Country name or two-letter code (US, ES).' },
      { field: 'Tags', required: 'No', notes: 'Separate several tags with commas or semicolons. Tags that don\u2019t exist yet are created.' },
      { field: 'Notes', required: 'No', notes: "One note per customer, added to their timeline. For several notes per customer, use the Notes import." },
      { field: 'Joined Date', required: 'No', notes: 'When they became a customer. Kept as the date they were added.' },
    ],
    notes: [
      'Columns can be in any order, and a header row is optional: columns are recognised by their values and you can change any of them before importing.',
      'CSV, tab-delimited text and Excel files are accepted.',
      'A customer who already exists (same email or phone) is not duplicated. Only their empty details are filled in; nothing is overwritten. Re-importing the same file is safe.',
      'No emails or messages are sent to your customers.',
    ],
  },

  payment_methods: {
    rows: [
      { field: 'Payment Token', required: 'Yes', notes: 'The saved card or bank account at Stripe, starting with pm_ (older files: card_, src_ or ba_).' },
      { field: 'Stripe Customer ID', required: 'Yes', notes: 'The Stripe customer it belongs to, starting with cus_. Needed so renewals can charge it.' },
      { field: 'Previous Processor Customer ID', required: 'No', notes: 'The customer\u2019s ID at the old processor, found in Stripe\u2019s mapping file. Matched exactly against the Processor Customer ID from the Customers import.' },
      { field: 'Legacy Customer ID', required: 'One way to find the customer', notes: 'The processor ID, legacy ID, email and phone are all checked; if they point to different customers the row is not imported and the reason names both.' },
      { field: 'Email', required: 'One way to find the customer', notes: '' },
      { field: 'Phone', required: 'One way to find the customer', notes: '' },
      { field: 'Method Type', required: 'No', notes: 'Card, or a bank account: SEPA, ACH or Bacs. Blank means card, unless the brand says otherwise.' },
      { field: 'Card Brand', required: 'No', notes: 'For example Visa or Mastercard. Bank accounts show their scheme instead (SEPA Direct Debit).' },
      { field: 'Last 4', required: 'No', notes: 'Shown so staff can recognise the card. Masked numbers such as **** 4242 work.' },
      { field: 'Expiry (MM/YY)', required: 'No', notes: 'Month and year in one column, such as 09/28. Cards only.' },
      { field: 'Exp Month / Exp Year', required: 'No', notes: 'Or as two separate columns. Two-digit years are read as 20xx. Cards only.' },
      { field: 'Default?', required: 'No', notes: 'Yes, true or 1 makes it the customer\u2019s default. A customer\u2019s first imported method is the default anyway.' },
    ],
    notes: [
      'Choose Stripe as the source system to upload Stripe\u2019s mapping file exactly as Stripe gives it; its columns are mapped for you.',
      'Card numbers are never in this file, only the tokens your processor returns.',
      'Columns can be in any order and a header row is optional: Stripe IDs, brands, expiry dates and card endings are recognised by their values.',
      'Import customers first. A payment method already imported for that customer is not duplicated, so re-importing is safe.',
      NO_EMAIL_NOTE,
    ],
  },

  memberships: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Membership Plan', required: 'Yes', notes: 'Must match the name of an active plan already set up in DayStream (capitals and spacing don\u2019t matter). Price and billing frequency come from that plan.' },
      { field: 'Next Billing Date', required: 'Yes, if active', notes: 'When the next charge is due. The current billing period is worked out from it. A date in the past is billed at the next renewal run.' },
      { field: 'Status', required: 'No', notes: 'Active, paused or cancelled (also current, on hold, frozen, ended, expired). Blank means active.' },
      { field: 'Start Date', required: 'No', notes: 'When they first joined. If blank, the start of the current billing period is used.' },
    ],
    notes: [
      'Set up your membership plans before importing, and import payment methods first: each membership is linked to the customer\u2019s default saved card or bank account.',
      'An active paid membership with no saved payment method still imports, with a warning: its first renewal will fail until a card is added.',
      'One live membership per customer and plan: re-importing the same file is safe.',
      'Nothing is charged by the import.',
      'Columns can be in any order and a header row is optional: customer IDs and plan names are recognised by matching what\u2019s already in DayStream, the next billing date by being mostly in the future and the start date by being mostly in the past, and status by its words. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },

  packages: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Package', required: 'Yes', notes: 'Must match the name of a package already set up in DayStream (capitals and spacing don\u2019t matter). Archived packages are accepted.' },
      { field: 'Purchase Date', required: 'Yes', notes: 'The original purchase date. The expiry is counted from it using the package\u2019s own expiry rule; a package that has already expired is imported with a warning.' },
    ],
    notes: [
      'Remaining sessions are not part of this file. They are worked out when you import past appointments: each attended appointment covered by the package uses one up.',
      'Import packages before appointments so that history can be counted against them.',
      'The same customer, package and purchase date is imported once: re-importing the same file is safe.',
      'Columns can be in any order and a header row is optional: customer IDs and package names are recognised by matching what\u2019s already in DayStream. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },

  appointments: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Service', required: 'Yes', notes: 'Must match the name of a service already set up in DayStream (capitals and spacing don\u2019t matter), with at least one bookable option.' },
      { field: 'Date', required: 'Yes', notes: 'Future dates become live bookings. Past dates are added to the customer\u2019s timeline as history.' },
      { field: 'Time', required: 'No', notes: 'Start time in your business\u2019s time zone, such as 14:30, 2:30 PM or 1430. Blank means noon.' },
      { field: 'Staff Member', required: 'No', notes: 'Must match the full name of an active staff member. A name that doesn\u2019t match fails the row.' },
      { field: 'Duration (min)', required: 'No', notes: 'Picks the service option with that length. Otherwise the service\u2019s first option is used.' },
      { field: 'Status', required: 'No', notes: 'A future appointment marked cancelled or no-show is added to the timeline as history, not booked. For past appointments, completed, checked in or attended (or blank) counts as attended and uses up a package session if one covers the service.' },
    ],
    notes: [
      'Future bookings are added as confirmed, without checking availability, staff hours or conflicts, and no confirmation is sent.',
      'Dates and times are read as your business\u2019s own local time, set in Business Setup.',
      'Past appointments only appear on the timeline; they don\u2019t affect availability or reports.',
      'Import customers, then packages, before appointments.',
      'The same customer, service and start time is imported once: re-importing the same file is safe.',
      'Columns can be in any order and a header row is optional: customer IDs, services, staff and service lengths are recognised by matching your setup in DayStream, times by their format (14:30, 2:30 PM) and status by its words. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },

  account_balances: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Type (credit/invoice)', required: 'Recommended', notes: 'Credit = money the customer has on account to spend. Invoice = money the customer owes. If blank, a row with a due date is an invoice; otherwise a credit.' },
      { field: 'Amount', required: 'Yes', notes: 'A positive amount, such as 45.00 or \u20ac45,00.' },
      { field: 'Amount Paid', required: 'No', notes: 'Invoices only: how much of it is already paid.' },
      { field: 'Description', required: 'No', notes: 'Shown on the credit or invoice.' },
      { field: 'Issue Date', required: 'Yes, for invoices', notes: 'The original invoice date.' },
      { field: 'Due Date', required: 'No', notes: 'Invoices only. If blank, the issue date is used.' },
    ],
    notes: [
      'These become real credits and invoices in your accounts, so they count in your balances and reports.',
      'A credit or invoice already imported (same customer, amounts, dates and description) is not created again, so re-importing the same file is safe. Credits and invoices your staff created in DayStream are never mistaken for imported ones.',
      'Invoices need invoicing turned on for your business.',
      'Columns can be in any order and a header row is optional: customer IDs are recognised by matching customers already in DayStream, the type by its words (credit, invoice), amounts by their format (45.00, \u20ac45), and the issue date as the earlier of two dates. Use a header for the amount paid, since it looks like the amount. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },

  transactions: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Date', required: 'Yes', notes: 'When the payment was made.' },
      { field: 'Amount', required: 'Yes', notes: 'Such as 45.00 or \u20ac45,00. Negative amounts (refunds) are accepted.' },
      { field: 'Description', required: 'No', notes: 'What it was for. If blank, the amount, method and reference are shown instead.' },
      { field: 'Payment Method', required: 'No', notes: 'For example cash, card or transfer.' },
      { field: 'Reference', required: 'No', notes: 'A receipt or transaction number. Also used to tell apart two payments of the same amount on the same day.' },
    ],
    notes: [
      'History only: payments appear on the customer\u2019s timeline and are never added to your books or reports. Bring in what customers owe or hold on account with the Account Balances import.',
      'The same customer, date, amount and reference is imported once: re-importing the same file is safe.',
      'Columns can be in any order and a header row is optional: customer IDs are recognised by matching customers already in DayStream, the payment method by matching the methods you accept, amounts by their format (45.00, \u20ac45), and the reference as the column that is different on every row. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },

  notes: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { field: 'Note', required: 'Yes', notes: 'The note text. Each row is one note, so a customer can have as many as you like.' },
      { field: 'Date', required: 'No', notes: 'When the note was written; it is placed at that date on the timeline. If blank, the import date is used.' },
      { field: 'Author', required: 'No', notes: 'Who wrote it. Kept with the note.' },
      { field: 'Category', required: 'No', notes: 'For example Medical or Preferences. Kept with the note.' },
    ],
    notes: [
      'Notes are added to the customer\u2019s timeline.',
      'The same note text, on the same date, for the same customer is imported once: re-importing the same file is safe.',
      'Columns can be in any order and a header row is optional: customer IDs are recognised by matching customers already in DayStream, the author by matching your staff, the category by matching your note categories, and the note as the column of sentences. You can change any column before importing.',
      FIND_CUSTOMER_NOTE, DATES_NOTE, NO_EMAIL_NOTE,
    ],
  },
};

// Friendly field labels for the mapping review.
const FIELD_LABELS: Record<string, string> = {
  legacy_customer_id: 'Legacy Customer ID', email: 'Email', first_name: 'First Name', last_name: 'Last Name',
  phone: 'Phone', date_of_birth: 'Date of Birth', gender: 'Gender', preferred_language: 'Language', country: 'Country',
  notes: 'Notes', tags: 'Tags', joined: 'Joined Date',
  processor_customer_id: 'Processor Customer ID (e.g. Stripe cus_…)', previous_processor_customer_id: 'Previous Processor Customer ID',
  stripe_customer_id: 'Stripe Customer ID', payment_method_token: 'Payment Token', method_type: 'Method Type (card / SEPA / ACH)', brand: 'Card Brand', last4: 'Last 4',
  expiry: 'Expiry (MM/YY)', exp_month: 'Exp Month', exp_year: 'Exp Year', is_default: 'Default?',
  type: 'Type (credit/invoice)', amount: 'Amount', amount_paid: 'Amount Paid', description: 'Description',
  issue_date: 'Issue Date', due_date: 'Due Date',
  plan: 'Membership Plan', next_billing_date: 'Next Billing Date', status: 'Status', start_date: 'Start Date',
  package: 'Package', purchase_date: 'Purchase Date',
  service: 'Service', staff: 'Staff Member', date: 'Date', time: 'Time', duration: 'Duration (min)',
  method: 'Payment Method', reference: 'Reference',
  note: 'Note', author: 'Author', category: 'Category',
};

/**
 * Customers need a first name and an email or phone (mirrors the server's validateRow). Returns a
 * plain-language problem for a row that's missing them, or null. Other kinds are validated on import.
 */
function missingRequired(kind: api.ImportKind, cells: string[], mapping: Record<number, string>): string | null {
  const val = (field: string): string => {
    for (const [idx, f] of Object.entries(mapping)) if (f === field) return (cells[Number(idx)] ?? '').trim();
    return '';
  };
  if (kind === 'payment_methods') {
    const gaps: string[] = [];
    if (val('payment_method_token') === '') gaps.push('a payment token');
    if (val('stripe_customer_id') === '') gaps.push('a Stripe customer ID');
    // The Stripe customer id is itself a match key (against the processor id captured by the
    // customer import), so a row with one always has something to match on; whether it matches
    // is only known on the server, which reports unmatched rows.
    return gaps.length ? `Missing ${gaps.join(' and ')}` : null;
  }
  if (kind !== 'customers') return null;
  const noName = val('first_name') === '';
  const noContact = val('email') === '' && val('phone') === '';
  if (noName && noContact) return 'Missing a first name, and an email or phone number';
  if (noName) return 'Missing a first name';
  if (noContact) return 'Missing an email or phone number';
  return null;
}

function downloadRows(rows: api.RowFailure[], fileName: string) {
  const grid = [['Row', 'Field', 'Reason'], ...rows.map((f) => [String(f.row), f.field, f.message])];
  const csv = grid.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
const downloadFailures = (failures: api.RowFailure[]) => downloadRows(failures, 'import-failures.csv');
const downloadWarnings = (warnings: api.RowFailure[]) => downloadRows(warnings, 'import-warnings.csv');

export function DataMigration({ businessId }: { businessId: string }) {
  const [step, setStep] = useState<Step>('pick');
  const [kind, setKind] = useState<api.ImportKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<api.AnalyzeResult | null>(null);
  // Chosen before the file, so the mapping can use that system's known layout.
  const [source, setSource] = useState<api.ImportSource>('auto');
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<api.ImportRun[]>([]);

  const loadRuns = useCallback(() => {
    if (!businessId) return;
    api.listRuns(businessId).then(setRuns).catch(() => setRuns([]));
  }, [businessId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const fieldsForKind = (): string[] => {
    if (kind === 'customers') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'notes', 'tags', 'joined'];
    if (kind === 'payment_methods') return ['', 'legacy_customer_id', 'previous_processor_customer_id', 'stripe_customer_id', 'payment_method_token', 'email', 'phone', 'method_type', 'brand', 'last4', 'expiry', 'exp_month', 'exp_year', 'is_default'];
    if (kind === 'memberships') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'plan', 'next_billing_date', 'status', 'start_date'];
    if (kind === 'packages') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'package', 'purchase_date'];
    if (kind === 'appointments') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'service', 'staff', 'date', 'time', 'duration', 'status'];
    if (kind === 'transactions') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'date', 'amount', 'description', 'method', 'reference'];
    if (kind === 'notes') return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'note', 'date', 'author', 'category'];
    return ['', 'legacy_customer_id', 'processor_customer_id', 'email', 'phone', 'type', 'amount', 'amount_paid', 'description', 'issue_date', 'due_date'];
  };

  const reset = () => {
    setStep('pick'); setKind(null); setFile(null); setAnalysis(null); setSource('auto');
    setMapping({}); setErr(null);
  };

  const onFile = async (f: File, opts: { firstRowIsData?: boolean } = {}) => {
    if (!kind) return;
    setFile(f); setBusy(true); setErr(null);
    try {
      const a = await api.analyze(kind, f, businessId, source, opts);
      setAnalysis(a);
      const m: Record<number, string> = {};
      for (const p of a.proposedMapping) if (p.field) m[p.index] = p.field;
      setMapping(m);
      setFileVersion((v) => v + 1); // remount the table so it re-initialises from the new file
      setStep('review');
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Could not read the file.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
        Bring your existing data into DayStream from a CSV or Excel file. Upload it, check the column mapping and the rows,
        fix any that don&apos;t line up, then import. Nothing is sent to your customers.
      </p>

      {err && <Alert variant="error">{err}</Alert>}

      {/* Step: pick an import */}
      {step === 'pick' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {KINDS.map((k) => (
            <div key={k.kind} style={card}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{k.label}</div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  {k.blurb}{k.prereq && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>{k.prereq}</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => { setKind(k.kind); setStep('upload'); setErr(null); }}>Start</Button>
            </div>
          ))}
        </div>
      )}

      {/* Step: upload */}
      {step === 'upload' && kind && (
        <div style={card}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            <div style={{ fontWeight: 600 }}>Upload your {KINDS.find((k) => k.kind === kind)!.label} file</div>
            {(SOURCE_OPTIONS[kind]?.length ?? 0) > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 480 }}>
                <label htmlFor="import-source" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Source system</label>
                <select id="import-source" value={source} disabled={busy} style={{ ...sel, fontSize: 'var(--font-size-sm)', padding: '6px 8px', alignSelf: 'flex-start', minWidth: 220 }}
                  onChange={(e) => setSource(e.target.value as api.ImportSource)}>
                  {SOURCE_OPTIONS[kind]!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {SOURCE_OPTIONS[kind]!.find((o) => o.id === source)?.help}
                </div>
              </div>
            )}
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" disabled={busy}
              aria-label={`${KINDS.find((k) => k.kind === kind)!.label} file`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <div><Button variant="outline" size="sm" onClick={reset}>Back</Button></div>
            {FIELD_GUIDE[kind] && <FieldGuideTable guide={FIELD_GUIDE[kind]!} label={KINDS.find((k) => k.kind === kind)!.label} />}
          </div>
        </div>
      )}

      {/* Step: one table — map columns in the header, correct/shift rows inline, import. */}
      {step === 'review' && kind && analysis && (
        <MappingTable
          key={fileVersion}
          onReplaceFile={onFile}
          replacing={busy}
          kind={kind}
          businessId={businessId}
          fileName={file?.name ?? null}
          analysis={analysis}
          mapping={mapping}
          setMapping={setMapping}
          onFirstRowIsData={() => { if (file) onFile(file, { firstRowIsData: true }); }}
          fieldOptions={fieldsForKind()}
          onCancel={reset}
          onDone={() => { loadRuns(); reset(); }}
        />
      )}

      {/* Recent runs */}
      {runs.length > 0 && step === 'pick' && (
        <div>
          <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 8 }}>Recent imports</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {runs.map((r) => (
              <div key={r.id} style={{ ...card, padding: '8px 12px' }}>
                <div style={{ fontSize: 'var(--font-size-sm)' }}>
                  <strong>{r.entity.replace('_', ' ')}</strong>{r.file_name ? ` · ${r.file_name}` : ''}{' '}
                  <Badge variant={r.is_trial ? 'neutral' : 'success'}>{r.is_trial ? 'trial' : 'imported'}</Badge>
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {r.imported} imported · {r.matched} matched · {r.failed} failed
                  {r.performed_by_name ? ` · ${r.performed_by_name}` : ''} · {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Rows that imported fine but need attention (e.g. a membership with no card on file). */
function WarningList({ warnings }: { warnings: api.RowFailure[] }) {
  const shown = warnings.slice(0, 20);
  return (
    <Alert variant="warning">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {warnings.length} imported row{warnings.length === 1 ? '' : 's'} worth a look
      </div>
      {shown.map((w, i) => (
        <div key={i} style={{ fontSize: 'var(--font-size-xs)' }}>Row {w.row} — {w.field}: {w.message}</div>
      ))}
      {warnings.length > shown.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', fontStyle: 'italic', marginTop: 4 }}>…and {warnings.length - shown.length} more</div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button variant="outline" size="sm" onClick={() => downloadWarnings(warnings)}>Download all warnings</Button>
      </div>
    </Alert>
  );
}

function FailureList({ failures }: { failures: api.RowFailure[] }) {
  const shown = failures.slice(0, 20);
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', maxHeight: 220, overflowY: 'auto' }}>
      {shown.map((f, i) => (
        <div key={i} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          Row {f.row} — {f.field}: {f.message}
        </div>
      ))}
      {failures.length > shown.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', fontStyle: 'italic', marginTop: 4 }}>
          …and {failures.length - shown.length} more (download for the full list)
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
};
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid var(--color-border)', verticalAlign: 'top' };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' };
const sel: React.CSSProperties = { padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm, 4px)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: 'var(--font-size-xs)' };

// Sticky header + sticky first column for the scrollable mapping table (needs an opaque bg so
// scrolled cells don't show through; the corner cell layers above both on z-index).
const stickyHead: React.CSSProperties = {
  ...th, position: 'sticky', top: 0, zIndex: 2, background: 'var(--color-background)',
};
const stickyHeadRow: React.CSSProperties = { // top-left corner: sticky both ways
  ...th, position: 'sticky', top: 0, left: 0, zIndex: 3, background: 'var(--color-background)', minWidth: 92,
};
const stickyCol: React.CSSProperties = { // the Row column: sticky on horizontal scroll
  ...td, position: 'sticky', left: 0, zIndex: 1, whiteSpace: 'nowrap', minWidth: 92,
  borderRight: '1px solid var(--color-border)',
};

// ---------------------------------------------------------------------------
// Mapping + row-correction, one table (spec 50 Wave 4, Stage B)
// ---------------------------------------------------------------------------

interface WorkRow {
  row: number;            // 1-based source row number
  cells: string[];        // current (possibly user-shifted) cells, padded to width
  aligned: boolean;       // true = lines up with the columns (importable); false = needs fixing
  fixed: boolean;         // true once the user has shifted/accepted a previously-misaligned row
  reason?: string;        // why it needs fixing (from the engine), shown on the flagged row
}

/**
 * ONE screen: the column mapping lives in the table header (a dropdown per column), and every
 * data row is shown beneath it. A row whose values don't line up with the columns is flagged and
 * gets inline ← / → controls to shift its cells into place. Only rows that line up are imported,
 * and only when the owner clicks Import. Nothing is written until then; record-level dedup
 * (Requirement 12) makes re-importing overlapping rows safe. No separate staging screen.
 */
function MappingTable({
  kind, businessId, fileName, analysis, mapping, setMapping, onFirstRowIsData, fieldOptions, onCancel, onDone, onReplaceFile, replacing,
}: {
  kind: api.ImportKind;
  businessId: string;
  fileName: string | null;
  analysis: api.AnalyzeResult;
  mapping: Record<number, string>;
  setMapping: (m: Record<number, string>) => void;
  /** Re-analyze the file reading row 1 as data (the header was detected wrongly). */
  onFirstRowIsData: () => void;
  fieldOptions: string[];
  onCancel: () => void;
  onDone: () => void;
  onReplaceFile: (f: File) => void;
  replacing: boolean;
}) {
  const width = analysis.width;
  const pad = (cells: string[]): string[] => { const c = cells.slice(0, width); while (c.length < width) c.push(''); return c; };

  const [rows, setRows] = useState<WorkRow[]>(() => analysis.rows.map((r) => ({
    row: r.row,
    cells: pad(r.cells),
    aligned: r.alignment !== 'unresolved',
    fixed: false,
    reason: r.reason,
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<api.ImportResult | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  // The cell currently being hand-edited (click a value to correct it in place).
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelEdit = useRef(false); // Escape pressed: the following blur must not save

  // Rows missing data the import requires are flagged up front (same rule the server enforces),
  // recomputed whenever the mapping or a cell changes, so nothing "ready" fails at the end.
  const effective = useMemo(() => rows.map((r) => {
    const problem = missingRequired(kind, r.cells, mapping);
    return problem ? { ...r, aligned: false, reason: problem } : r;
  }), [rows, kind, mapping]);
  const aligned = effective.filter((r) => r.aligned);
  const errored = effective.filter((r) => !r.aligned);
  const visible = onlyErrors ? errored : effective;

  // --- Row virtualization (windowing) ---
  // Rendering every row (10k × 13 cells = ~130k nodes) makes each interaction re-layout the whole
  // table and lag by seconds. Instead render only the rows in (and just around) the scroll viewport.
  const ROW_H = 56;        // fixed row height (px) — matches the two-line Row cell
  const OVERSCAN = 8;      // extra rows above/below so fast scrolling doesn't flash blank
  const VIEWPORT_H = Math.round(window.innerHeight * 0.6); // matches the 60vh container
  const [scrollTop, setScrollTop] = useState(0);
  const total = visible.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIndex = Math.min(total, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const windowRows = visible.slice(startIndex, endIndex);
  const padTop = startIndex * ROW_H;
  const padBottom = Math.max(0, (total - endIndex) * ROW_H);

  // Per-cell shift: the user asserts the value at column `index` belongs to the right (or into the
  // empty slot to its left). The server holds the columns before the shift fixed and intelligently
  // re-positions the remaining values by profile-fit; we replace the row with the result and let
  // its aligned flag recompute. The row stays flagged if it still doesn't fully line up.
  const shiftCell = async (rowNum: number, index: number, direction: 'left' | 'right') => {
    const target = rows.find((r) => r.row === rowNum);
    if (!target) return;
    try {
      const res = await api.realignRow(kind, target.cells, analysis.profiles, index, direction);
      setRows((prev) => prev.map((r) => (r.row === rowNum
        ? { ...r, cells: res.cells, aligned: res.aligned, fixed: true, reason: res.aligned ? undefined : r.reason } : r)));
    } catch { /* leave the row as-is on a transient failure; the user can retry */ }
  };

  // Hand-edit a single value (e.g. remove the stray space from an email). Nothing else moves: the
  // cell is updated immediately, then the row is re-checked on the server so its flag clears —
  // or updates its reason — once the corrected value fits the column.
  const commitEdit = async (rowNum: number, col: number, value: string) => {
    setEditing(null);
    const target = rows.find((r) => r.row === rowNum);
    if (!target || (target.cells[col] ?? '') === value) return;
    const cells = target.cells.slice();
    cells[col] = value;
    setRows((prev) => prev.map((r) => (r.row === rowNum ? { ...r, cells } : r)));
    try {
      const res = await api.realignRow(kind, cells, analysis.profiles, col, 'check');
      setRows((prev) => prev.map((r) => (r.row === rowNum
        ? { ...r, aligned: res.aligned, fixed: res.aligned || r.fixed, reason: res.aligned ? undefined : (res.reason ?? r.reason) } : r)));
    } catch { /* keep the edited value; the row's flag simply doesn't update this time */ }
  };

  const runImport = async () => {
    if (aligned.length === 0) return;
    setBusy(true); setErr(null);
    try {
      // Send in batches so the owner sees progress on big files. Re-sending is safe (idempotent),
      // and failure/warning row numbers are mapped back to the Row numbers shown in the table.
      const batch = 100;
      const toSend = aligned.slice();
      const res: api.ImportResult = { runId: null, total: toSend.length, imported: 0, matched: 0, failed: 0, failures: [], warnings: [] };
      setProgress({ done: 0, total: toSend.length });
      for (let start = 0; start < toSend.length; start += batch) {
        const slice = toSend.slice(start, start + batch);
        const part = await api.commitRowsBatch(kind, businessId, mapping, slice.map((r) => r.cells), fileName, analysis.dateOrder ?? null);
        const tableRow = (n: number) => slice[n - 1]?.row ?? n;
        res.runId = part.runId ?? res.runId;
        res.imported += part.imported; res.matched += part.matched; res.failed += part.failed;
        res.failures.push(...part.failures.map((f) => ({ ...f, row: tableRow(f.row) })));
        res.warnings!.push(...(part.warnings ?? []).map((f) => ({ ...f, row: tableRow(f.row) })));
        setProgress({ done: Math.min(start + batch, toSend.length), total: toSend.length });
      }
      await api.recordRun(kind, businessId, fileName, { total: res.total, imported: res.imported, matched: res.matched, failed: res.failed }).catch(() => {});
      setResult(res);
      const done = new Set(aligned.map((r) => r.row));
      setRows((prev) => prev.filter((r) => !done.has(r.row))); // imported rows leave; errors stay
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Import failed.');
    } finally { setBusy(false); setProgress(null); }
  };

  const mappedColCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {/* Status lines, stacked and left-aligned so they read top to bottom with the intro above. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-xs)' }}>
        {/* Shown only when row 1 was read as column names: says which, with one way out if that's
            wrong. No header found needs no control: a header misread as data shows up as a flagged row. */}
        {analysis.hasHeader && (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            Row 1 was read as column names ({headerPreview(analysis.columns)}).{' '}
            <button
              type="button"
              onClick={onFirstRowIsData}
              disabled={replacing}
              style={{ border: 'none', background: 'none', padding: 0, color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              It&apos;s data, include it
            </button>
          </div>
        )}
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Set each column&apos;s field in the header. {errored.length > 0
            ? `${errored.length} row${errored.length === 1 ? '' : 's'} need fixing — shift values with ← / →, or click a cell to type the missing value. Rows left unfixed are skipped.`
            : 'All rows line up.'}
        </div>
      </div>

      {err && <Alert variant="error">{err}</Alert>}
      {analysis.sourceRecognized === true && (
        <Alert variant="info">Recognized as a {analysis.sourceLayout}. Its columns are mapped for you.</Alert>
      )}
      {analysis.sourceRecognized === false && (
        <Alert variant="warning">
          This file doesn&apos;t match a layout we know for the chosen source system, so its columns were detected automatically. Check the mapping before importing.
        </Alert>
      )}
      {progress && (
        <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <div style={{ fontWeight: 600 }}>
            Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows…
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {progress.total > 1000
              ? `Large files take a while (roughly ${Math.max(1, Math.round(progress.total / 2700))} minute${Math.round(progress.total / 2700) <= 1 ? '' : 's'} for this one). Please keep this page open.`
              : 'This should only take a moment.'}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--color-primary)', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Alert variant={result.failed === 0 ? 'success' : 'warning'}>
            Imported {result.imported}, matched {result.matched} already in the system, {result.failed} failed.
            {errored.length > 0 && ` ${errored.length} row${errored.length === 1 ? '' : 's'} still need fixing.`}
          </Alert>
          {result.failures.length > 0 && (
            <>
              <FailureList failures={result.failures} />
              <div><Button variant="outline" size="sm" onClick={() => downloadFailures(result.failures)}>Download failures</Button></div>
            </>
          )}
          {(result.warnings?.length ?? 0) > 0 && <WarningList warnings={result.warnings!} />}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-sm)' }}>
        <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
        Show only rows that need fixing ({errored.length})
      </label>

      {/* Fixed-size viewport: header row stays put on vertical scroll, the Row column stays put on
          horizontal scroll, so the mapping dropdowns and the shift controls are always reachable. */}
      <div
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        style={{ maxHeight: '60vh', maxWidth: '100%', overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
      >
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--font-size-sm)' }}>
          <thead>
            <tr>
              <th style={stickyHeadRow}>Row</th>
              {Array.from({ length: width }).map((_, i) => (
                <th key={i} style={stickyHead}>
                  <div style={{ marginBottom: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
                    {analysis.hasHeader ? (analysis.columns[i] || `Column ${i + 1}`) : `Column ${i + 1}`}
                  </div>
                  <select value={mapping[i] || ''} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} style={sel}>
                    {fieldOptions.map((f) => <option key={f} value={f}>{f ? (FIELD_LABELS[f] || f) : '— Skip —'}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Top spacer preserves the scroll height for the rows above the window. */}
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={width + 1} style={{ padding: 0, border: 'none' }} /></tr>}
            {windowRows.map((r) => {
              const rowBg = r.aligned ? 'var(--color-surface)' : 'var(--color-warning-surface, #fff7ed)';
              return (
              <tr key={r.row} style={{ height: ROW_H }}>
                <td style={{ ...stickyCol, background: rowBg, maxWidth: 240, whiteSpace: 'normal' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{r.row}</span>
                    {!r.aligned && <Badge variant="warning">fix</Badge>}
                    {r.aligned && r.fixed && <Badge variant="success">fixed</Badge>}
                  </div>
                  {!r.aligned && r.reason && (
                    <div style={{ marginTop: 2, fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', lineHeight: 1.3 }}>
                      {r.reason}
                    </div>
                  )}
                </td>
                {Array.from({ length: width }).map((_, ci) => {
                  const value = r.cells[ci] ?? '';
                  const leftEmpty = ci === 0 || (r.cells[ci - 1] ?? '').trim() === '';
                  const hovered = hover?.row === r.row && hover.col === ci;
                  return (
                    <td
                      key={ci}
                      onMouseEnter={() => setHover({ row: r.row, col: ci })}
                      onMouseLeave={() => setHover((h) => (h?.row === r.row && h.col === ci ? null : h))}
                      style={{ ...td, background: rowBg, color: mapping[ci] ? 'var(--color-text)' : 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240, position: 'relative' }}
                    >
                      {editing?.row === r.row && editing.col === ci ? (
                        <input
                          autoFocus
                          onFocus={() => { cancelEdit.current = false; }}
                          aria-label={`Edit row ${r.row}, column ${ci + 1}`}
                          value={editing.value}
                          onChange={(e) => setEditing({ row: r.row, col: ci, value: e.target.value })}
                          onBlur={() => { if (cancelEdit.current) { cancelEdit.current = false; return; } commitEdit(r.row, ci, editing.value); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(r.row, ci, editing.value);
                            else if (e.key === 'Escape') { cancelEdit.current = true; setEditing(null); }
                          }}
                          style={{ width: '100%', minWidth: 160, boxSizing: 'border-box', padding: '2px 6px', font: 'inherit', color: 'var(--color-text)', background: 'var(--color-background)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-sm, 4px)' }}
                        />
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          title="Click to edit"
                          onClick={() => setEditing({ row: r.row, col: ci, value })}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing({ row: r.row, col: ci, value }); } }}
                          style={{ cursor: 'text', display: 'inline-block', minWidth: 24, minHeight: '1.2em' }}
                        >{value}</span>
                      )}
                      {/* Hover arrows: → always (push this value right & re-fit the rest);
                          ← only when the cell to the left is empty (pull this value left). */}
                      {hovered && !(editing?.row === r.row && editing.col === ci) && (value.trim() !== '' || !leftEmpty) && (
                        <span style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 2 }}>
                          {leftEmpty && value.trim() !== '' && (
                            <button type="button" title="move this value one column left" onClick={() => shiftCell(r.row, ci, 'left')} style={shiftBtn}>←</button>
                          )}
                          <button type="button" title="move this value one column right (and re-fit the rest)" onClick={() => shiftCell(r.row, ci, 'right')} style={shiftBtn}>→</button>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {/* Bottom spacer for the rows below the window. */}
            {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={width + 1} style={{ padding: 0, border: 'none' }} /></tr>}
          </tbody>
        </table>
      </div>
      {onlyErrors && errored.length === 0 && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          No rows need fixing. Uncheck the box above to see all rows.
        </div>
      )}
      {total > windowRows.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          Showing {total.toLocaleString()} rows (scroll to view more).
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplaceFile(f); e.target.value = ''; }}
        />
        <Button variant="outline" size="sm" loading={replacing} disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Choose different file
        </Button>
        <Button
          size="sm"
          loading={busy}
          disabled={aligned.length === 0 || mappedColCount === 0}
          onClick={runImport}
        >
          Import {aligned.length} row{aligned.length === 1 ? '' : 's'}
        </Button>
        {result && <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>}
      </div>
    </div>
  );
}

/** The first few header names, for the "Row 1 was read as column names" indicator. */
function headerPreview(columns: string[]): string {
  const names = columns.map((c) => (c || '').trim()).filter(Boolean);
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown}\u2026` : shown;
}

/** What a file for this import can contain: field, whether it's required, and how it's handled. */
function FieldGuideTable({ guide, label }: { guide: FieldGuide; label: string }) {
  return (
    <section aria-labelledby="field-guide-heading" style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h3 id="field-guide-heading" style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, margin: 0 }}>
        What your {label} file can include
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, width: '22%' }}>Field</th>
            <th scope="col" style={{ ...th, width: '14%' }}>Required</th>
            <th scope="col" style={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {guide.rows.map((r) => (
            <tr key={r.field}>
              <td style={{ ...td, color: 'var(--color-text)', fontWeight: 600 }}>{r.field}</td>
              <td style={{ ...td, color: r.required === 'No' ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>{r.required}</td>
              <td style={td}>{r.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {guide.notes.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {guide.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

const shiftBtn: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text)',
  borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer', padding: '0 6px', fontSize: 'var(--font-size-sm)', lineHeight: '1.6',
};
