import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../design-system/components/actions/Button';
import { Alert } from '../../design-system/components/feedback/Alert';
import { Badge } from '../../design-system/components/data/Badge';
import * as api from '../../api/dataMigration';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, DEFAULT_LANGUAGE, supportedLanguagesText } from '@daystream/shared';
import { formatDateTime, formatNumber } from '../../utils/format';

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
  /** True when the import has a "do this first" line. The words: migration.kind.<kind>.label / .blurb / .prereq. */
  hasPrereq: boolean;
}

const KINDS: KindInfo[] = [
  { kind: 'customers', hasPrereq: false },
  { kind: 'payment_methods', hasPrereq: true },
  { kind: 'memberships', hasPrereq: true },
  { kind: 'packages', hasPrereq: true },
  { kind: 'appointments', hasPrereq: true },
  { kind: 'account_balances', hasPrereq: true },
  { kind: 'transactions', hasPrereq: true },
  { kind: 'notes', hasPrereq: true },
];

// Source systems offered per import, chosen before the file is picked (server presets:
// services/migration/import-sources.ts). Add an entry as each system's layout is coded.
// The dropdown only shows when an import has more than the automatic option.
// The words: migration.source.<id>.label / .help.
const SOURCE_OPTIONS: Partial<Record<api.ImportKind, Array<{ id: api.ImportSource }>>> = {
  payment_methods: [
    { id: 'auto' },
    { id: 'stripe' },
  ],
};

/**
 * The field reference shown on the upload screen, so owners know what a file can contain before
 * they pick one. Each entry must describe what the import actually does (server:
 * services/migration/*-import.ts). Imports without an entry show no table yet.
 * The words: migration.guide.<kind>.<id>.field / .notes (shared rows: migration.guide.shared.<id>),
 * migration.required.<required>, and for the closing points migration.note.<id>.
 */
interface FieldGuideRow { id: string; required: string; hasNotes: boolean; shared?: boolean }
interface FieldGuide { rows: FieldGuideRow[]; notes: string[] }

// How every customer-linked import finds the customer (import-core matchCustomer).
const FIND_CUSTOMER_ROWS: FieldGuideRow[] = [
  { id: 'processor_customer_id', required: 'atLeastOne', hasNotes: true, shared: true },
  { id: 'legacy_customer_id', required: 'atLeastOne', hasNotes: true, shared: true },
  { id: 'email', required: 'atLeastOne', hasNotes: false, shared: true },
  { id: 'phone', required: 'atLeastOne', hasNotes: false, shared: true },
];

const FIELD_GUIDE: Partial<Record<api.ImportKind, FieldGuide>> = {
  customers: {
    rows: [
      { id: 'first_name', required: 'yes', hasNotes: true },
      { id: 'last_name', required: 'no', hasNotes: false },
      { id: 'email', required: 'emailOrPhone', hasNotes: true },
      { id: 'phone', required: 'emailOrPhone', hasNotes: true },
      { id: 'legacy_customer_id', required: 'no', hasNotes: true },
      { id: 'processor_customer_id', required: 'no', hasNotes: true },
      { id: 'date_of_birth', required: 'no', hasNotes: true },
      { id: 'gender', required: 'no', hasNotes: true },
      { id: 'language', required: 'no', hasNotes: true },
      { id: 'country', required: 'no', hasNotes: true },
      { id: 'tags', required: 'no', hasNotes: true },
      { id: 'notes', required: 'no', hasNotes: true },
      { id: 'joined_date', required: 'no', hasNotes: true },
    ],
    notes: ['customers.1', 'customers.2', 'customers.3', 'noEmail'],
  },
  payment_methods: {
    rows: [
      { id: 'payment_token', required: 'yes', hasNotes: true },
      { id: 'stripe_customer_id', required: 'yes', hasNotes: true },
      { id: 'previous_processor_customer_id', required: 'no', hasNotes: true },
      { id: 'legacy_customer_id', required: 'oneWay', hasNotes: true },
      { id: 'email', required: 'oneWay', hasNotes: false },
      { id: 'phone', required: 'oneWay', hasNotes: false },
      { id: 'method_type', required: 'no', hasNotes: true },
      { id: 'card_brand', required: 'no', hasNotes: true },
      { id: 'last_4', required: 'no', hasNotes: true },
      { id: 'expiry_mm_yy', required: 'no', hasNotes: true },
      { id: 'exp_month_exp_year', required: 'no', hasNotes: true },
      { id: 'default', required: 'no', hasNotes: true },
    ],
    notes: ['payment_methods.1', 'payment_methods.2', 'payment_methods.3', 'payment_methods.4', 'noEmail'],
  },
  memberships: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'membership_plan', required: 'yes', hasNotes: true },
      { id: 'next_billing_date', required: 'yesIfActive', hasNotes: true },
      { id: 'status', required: 'no', hasNotes: true },
      { id: 'start_date', required: 'no', hasNotes: true },
    ],
    notes: ['memberships.1', 'memberships.2', 'memberships.3', 'memberships.4', 'memberships.5', 'findCustomer', 'dates', 'noEmail'],
  },
  packages: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'package', required: 'yes', hasNotes: true },
      { id: 'purchase_date', required: 'yes', hasNotes: true },
    ],
    notes: ['packages.1', 'packages.2', 'packages.3', 'packages.4', 'findCustomer', 'dates', 'noEmail'],
  },
  appointments: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'service', required: 'yes', hasNotes: true },
      { id: 'date', required: 'yes', hasNotes: true },
      { id: 'time', required: 'no', hasNotes: true },
      { id: 'staff_member', required: 'no', hasNotes: true },
      { id: 'duration_min', required: 'no', hasNotes: true },
      { id: 'status', required: 'no', hasNotes: true },
    ],
    notes: ['appointments.1', 'appointments.2', 'appointments.3', 'appointments.4', 'appointments.5', 'appointments.6', 'findCustomer', 'dates', 'noEmail'],
  },
  account_balances: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'type_credit_invoice', required: 'recommended', hasNotes: true },
      { id: 'amount', required: 'yes', hasNotes: true },
      { id: 'amount_paid', required: 'no', hasNotes: true },
      { id: 'description', required: 'no', hasNotes: true },
      { id: 'issue_date', required: 'yesForInvoices', hasNotes: true },
      { id: 'due_date', required: 'no', hasNotes: true },
    ],
    notes: ['account_balances.1', 'account_balances.2', 'account_balances.3', 'account_balances.4', 'findCustomer', 'dates', 'noEmail'],
  },
  transactions: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'date', required: 'yes', hasNotes: true },
      { id: 'amount', required: 'yes', hasNotes: true },
      { id: 'description', required: 'no', hasNotes: true },
      { id: 'payment_method', required: 'no', hasNotes: true },
      { id: 'reference', required: 'no', hasNotes: true },
    ],
    notes: ['transactions.1', 'transactions.2', 'transactions.3', 'findCustomer', 'dates', 'noEmail'],
  },
  notes: {
    rows: [
      ...FIND_CUSTOMER_ROWS,
      { id: 'note', required: 'yes', hasNotes: true },
      { id: 'date', required: 'no', hasNotes: true },
      { id: 'author', required: 'no', hasNotes: true },
      { id: 'category', required: 'no', hasNotes: true },
    ],
    notes: ['notes.1', 'notes.2', 'notes.3', 'findCustomer', 'dates', 'noEmail'],
  },
};

// The words of the mapping review's field names: migration.field.<id> (the id is what the import stores).

/**
 * Customers need a first name and an email or phone (mirrors the server's validateRow). Returns a
 * plain-language problem for a row that's missing them, or null. Other kinds are validated on import.
 */
function missingRequired(kind: api.ImportKind, cells: string[], mapping: Record<number, string>, t: TFunction): string | null {
  const val = (field: string): string => {
    for (const [idx, f] of Object.entries(mapping)) if (f === field) return (cells[Number(idx)] ?? '').trim();
    return '';
  };
  if (kind === 'payment_methods') {
    const noToken = val('payment_method_token') === '';
    const noStripeId = val('stripe_customer_id') === '';
    // The Stripe customer id is itself a match key (against the processor id captured by the
    // customer import), so a row with one always has something to match on; whether it matches
    // is only known on the server, which reports unmatched rows.
    if (noToken && noStripeId) return t('migration.missingTokenAndStripeId');
    if (noToken) return t('migration.missingToken');
    if (noStripeId) return t('migration.missingStripeId');
    return null;
  }
  if (kind !== 'customers') return null;
  const noName = val('first_name') === '';
  const noContact = val('email') === '' && val('phone') === '';
  if (noName && noContact) return t('migration.missingNameAndContact');
  if (noName) return t('migration.missingName');
  if (noContact) return t('migration.missingContact');
  return null;
}

function downloadRows(rows: api.RowFailure[], fileName: string, t: TFunction) {
  const grid = [[t('migration.csvRow'), t('migration.csvField'), t('migration.csvReason')], ...rows.map((f) => [String(f.row), f.field, f.message])];
  const csv = grid.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
const downloadFailures = (failures: api.RowFailure[], t: TFunction) => downloadRows(failures, 'import-failures.csv', t);
const downloadWarnings = (warnings: api.RowFailure[], t: TFunction) => downloadRows(warnings, 'import-warnings.csv', t);

export function DataMigration({ businessId }: { businessId: string }) {
  const { t } = useTranslation('settings');
  const kindLabel = (k: api.ImportKind) => t(`migration.kind.${k}.label`);
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
      setErr(e?.response?.data?.message || e?.response?.data?.error || t('migration.readFailed'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
        {t('migration.intro')}
      </p>

      {err && <Alert variant="error">{err}</Alert>}

      {/* Step: pick an import */}
      {step === 'pick' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {KINDS.map((k) => (
            <div key={k.kind} style={card}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{kindLabel(k.kind)}</div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  {t(`migration.kind.${k.kind}.blurb`)}{k.hasPrereq && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>{t(`migration.kind.${k.kind}.prereq`)}</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => { setKind(k.kind); setStep('upload'); setErr(null); }}>{t('migration.start')}</Button>
            </div>
          ))}
        </div>
      )}

      {/* Step: upload */}
      {step === 'upload' && kind && (
        <div style={card}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            <div style={{ fontWeight: 600 }}>{t('migration.uploadFile', { kind: kindLabel(kind) })}</div>
            {(SOURCE_OPTIONS[kind]?.length ?? 0) > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 480 }}>
                <label htmlFor="import-source" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{t('migration.sourceSystem')}</label>
                <select id="import-source" value={source} disabled={busy} style={{ ...sel, fontSize: 'var(--font-size-sm)', padding: '6px 8px', alignSelf: 'flex-start', minWidth: 220 }}
                  onChange={(e) => setSource(e.target.value as api.ImportSource)}>
                  {SOURCE_OPTIONS[kind]!.map((o) => <option key={o.id} value={o.id}>{t(`migration.source.${o.id}.label`)}</option>)}
                </select>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {SOURCE_OPTIONS[kind]!.some((o) => o.id === source) ? t(`migration.source.${source}.help`) : undefined}
                </div>
              </div>
            )}
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" disabled={busy}
              aria-label={t('migration.fileLabel', { kind: kindLabel(kind) })}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <div><Button variant="outline" size="sm" onClick={reset}>{t('migration.back')}</Button></div>
            {FIELD_GUIDE[kind] && <FieldGuideTable guide={FIELD_GUIDE[kind]!} kind={kind} />}
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
          <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 8 }}>{t('migration.recent')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {runs.map((r) => (
              <div key={r.id} style={{ ...card, padding: '8px 12px' }}>
                <div style={{ fontSize: 'var(--font-size-sm)' }}>
                  <strong>{t(`migration.entity.${r.entity}`, { defaultValue: r.entity.replace('_', ' ') })}</strong>{r.file_name ? ` · ${r.file_name}` : ''}{' '}
                  <Badge variant={r.is_trial ? 'neutral' : 'success'}>{r.is_trial ? t('migration.trial') : t('migration.imported')}</Badge>
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {r.performed_by_name
                    ? t('migration.runLineBy', { imported: r.imported, matched: r.matched, failed: r.failed, name: r.performed_by_name, when: formatDateTime(r.created_at) })
                    : t('migration.runLine', { imported: r.imported, matched: r.matched, failed: r.failed, when: formatDateTime(r.created_at) })}
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
  const { t } = useTranslation('settings');
  const shown = warnings.slice(0, 20);
  return (
    <Alert variant="warning">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {t('migration.warningsTitle', { count: warnings.length })}
      </div>
      {shown.map((w, i) => (
        <div key={i} style={{ fontSize: 'var(--font-size-xs)' }}>{t('migration.rowProblem', { row: w.row, field: w.field, message: w.message })}</div>
      ))}
      {warnings.length > shown.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', fontStyle: 'italic', marginTop: 4 }}>{t('migration.andMore', { count: warnings.length - shown.length })}</div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button variant="outline" size="sm" onClick={() => downloadWarnings(warnings, t)}>{t('migration.downloadWarnings')}</Button>
      </div>
    </Alert>
  );
}

function FailureList({ failures }: { failures: api.RowFailure[] }) {
  const { t } = useTranslation('settings');
  const shown = failures.slice(0, 20);
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', maxHeight: 220, overflowY: 'auto' }}>
      {shown.map((f, i) => (
        <div key={i} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          {t('migration.rowProblem', { row: f.row, field: f.field, message: f.message })}
        </div>
      ))}
      {failures.length > shown.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', fontStyle: 'italic', marginTop: 4 }}>
          {t('migration.andMoreDownload', { count: failures.length - shown.length })}
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
  const { t } = useTranslation('settings');
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
    const problem = missingRequired(kind, r.cells, mapping, t);
    return problem ? { ...r, aligned: false, reason: problem } : r;
  }), [rows, kind, mapping, t]);
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
      setErr(e?.response?.data?.message || e?.response?.data?.error || t('migration.importFailed'));
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
            {t('migration.headerRead', { names: headerPreview(analysis.columns) })}{' '}
            <button
              type="button"
              onClick={onFirstRowIsData}
              disabled={replacing}
              style={{ border: 'none', background: 'none', padding: 0, color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              {t('migration.itsData')}
            </button>
          </div>
        )}
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {errored.length > 0 ? t('migration.setFieldsNeedFixing', { count: errored.length }) : t('migration.setFieldsAllAligned')}
        </div>
      </div>

      {err && <Alert variant="error">{err}</Alert>}
      {analysis.sourceRecognized === true && (
        <Alert variant="info">{t('migration.recognized', { layout: analysis.sourceLayout })}</Alert>
      )}
      {analysis.sourceRecognized === false && (
        <Alert variant="warning">
          {t('migration.notRecognized')}
        </Alert>
      )}
      {progress && (
        <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <div style={{ fontWeight: 600 }}>
            {t('migration.importing', { done: formatNumber(progress.done), total: formatNumber(progress.total) })}
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {progress.total > 1000
              ? t('migration.largeFile', { count: Math.max(1, Math.round(progress.total / 2700)) })
              : t('migration.shortWait')}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--color-primary)', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Alert variant={result.failed === 0 ? 'success' : 'warning'}>
            {t('migration.result', { imported: result.imported, matched: result.matched, failed: result.failed })}
            {errored.length > 0 && ` ${t('migration.stillNeedFixing', { count: errored.length })}`}
          </Alert>
          {result.failures.length > 0 && (
            <>
              <FailureList failures={result.failures} />
              <div><Button variant="outline" size="sm" onClick={() => downloadFailures(result.failures, t)}>{t('migration.downloadFailures')}</Button></div>
            </>
          )}
          {(result.warnings?.length ?? 0) > 0 && <WarningList warnings={result.warnings!} />}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-sm)' }}>
        <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
        {t('migration.onlyErrors', { count: errored.length })}
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
              <th style={stickyHeadRow}>{t('migration.row')}</th>
              {Array.from({ length: width }).map((_, i) => (
                <th key={i} style={stickyHead}>
                  <div style={{ marginBottom: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
                    {analysis.hasHeader ? (analysis.columns[i] || t('migration.columnN', { n: i + 1 })) : t('migration.columnN', { n: i + 1 })}
                  </div>
                  <select value={mapping[i] || ''} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} style={sel}>
                    {fieldOptions.map((f) => <option key={f} value={f}>{f ? t(`migration.field.${f}`, { defaultValue: f }) : t('migration.skip')}</option>)}
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
                    {!r.aligned && <Badge variant="warning">{t('migration.fix')}</Badge>}
                    {r.aligned && r.fixed && <Badge variant="success">{t('migration.fixed')}</Badge>}
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
                          aria-label={t('migration.editCell', { row: r.row, column: ci + 1 })}
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
                          title={t('migration.clickToEdit')}
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
                            <button type="button" title={t('migration.moveLeft')} onClick={() => shiftCell(r.row, ci, 'left')} style={shiftBtn}>←</button>
                          )}
                          <button type="button" title={t('migration.moveRight')} onClick={() => shiftCell(r.row, ci, 'right')} style={shiftBtn}>→</button>
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
          {t('migration.noneNeedFixing')}
        </div>
      )}
      {total > windowRows.length && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          {t('migration.showingRows', { total: formatNumber(total) })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button variant="outline" size="sm" onClick={onCancel}>{t('common:cancel')}</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplaceFile(f); e.target.value = ''; }}
        />
        <Button variant="outline" size="sm" loading={replacing} disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {t('migration.chooseDifferent')}
        </Button>
        <Button
          size="sm"
          loading={busy}
          disabled={aligned.length === 0 || mappedColCount === 0}
          onClick={runImport}
        >
          {t('migration.importRows', { count: aligned.length })}
        </Button>
        {result && <Button variant="ghost" size="sm" onClick={onDone}>{t('migration.done')}</Button>}
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
function FieldGuideTable({ guide, kind }: { guide: FieldGuide; kind: api.ImportKind }) {
  const { t } = useTranslation('settings');
  // The language note names the languages the import accepts; they are filled in from the shared list.
  const values = { languages: supportedLanguagesText(), codes: SUPPORTED_LANGUAGES.join(', '), default: LANGUAGE_LABELS[DEFAULT_LANGUAGE] };
  return (
    <section aria-labelledby="field-guide-heading" style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h3 id="field-guide-heading" style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, margin: 0 }}>
        {t('migration.guideTitle', { kind: t(`migration.kind.${kind}.label`) })}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, width: '22%' }}>{t('migration.guideField')}</th>
            <th scope="col" style={{ ...th, width: '14%' }}>{t('migration.guideRequired')}</th>
            <th scope="col" style={th}>{t('migration.guideNotes')}</th>
          </tr>
        </thead>
        <tbody>
          {guide.rows.map((r) => {
            const base = `migration.guide.${r.shared ? 'shared' : kind}.${r.id}`;
            return (
              <tr key={base}>
                <td style={{ ...td, color: 'var(--color-text)', fontWeight: 600 }}>{t(`${base}.field`)}</td>
                <td style={{ ...td, color: r.required === 'no' ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>{t(`migration.required.${r.required}`)}</td>
                <td style={td}>{r.hasNotes ? t(`${base}.notes`, values) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {guide.notes.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {guide.notes.map((n) => <li key={n}>{t(`migration.note.${n}`, values)}</li>)}
        </ul>
      )}
    </section>
  );
}

const shiftBtn: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text)',
  borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer', padding: '0 6px', fontSize: 'var(--font-size-sm)', lineHeight: '1.6',
};
