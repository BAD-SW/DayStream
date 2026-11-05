import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Alert } from '../../design-system/components/feedback/Alert';
import { Badge } from '../../design-system/components/data/Badge';
import * as api from '../../api/dataMigration';

/**
 * Data Migration (spec 50, Waves 1-2) — one shared component scoped to a business,
 * reused by the Business Setup "Data Migration" tab (business owner) and the
 * tenant's per-business view. Offers the imports in the recommended order, each a
 * three-step flow: upload → review + trial → commit. Rows that import but need the
 * owner's attention are listed as warnings. Shows recent import runs below.
 *
 * Full locked order (spec 50, Waves 1-3): Customers, Payment Methods, Memberships,
 * Packages, Appointments, Account Balances, Transaction History.
 */

type Step = 'pick' | 'upload' | 'review' | 'done';

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
];

// Friendly field labels for the mapping review.
const FIELD_LABELS: Record<string, string> = {
  legacy_customer_id: 'Legacy Customer ID', email: 'Email', first_name: 'First Name', last_name: 'Last Name',
  phone: 'Phone', date_of_birth: 'Date of Birth', gender: 'Gender', preferred_language: 'Language', country: 'Country',
  notes: 'Notes', tags: 'Tags', joined: 'Joined Date',
  stripe_customer_id: 'Stripe Customer ID', payment_method_token: 'Payment Token', brand: 'Card Brand', last4: 'Last 4',
  exp_month: 'Exp Month', exp_year: 'Exp Year', is_default: 'Default?',
  type: 'Type (credit/invoice)', amount: 'Amount', amount_paid: 'Amount Paid', description: 'Description',
  issue_date: 'Issue Date', due_date: 'Due Date',
  plan: 'Membership Plan', next_billing_date: 'Next Billing Date', status: 'Status', start_date: 'Start Date',
  package: 'Package', purchase_date: 'Purchase Date',
  service: 'Service', staff: 'Staff Member', date: 'Date', time: 'Time', duration: 'Duration (min)',
  method: 'Payment Method', reference: 'Reference',
};

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
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [trialResult, setTrialResult] = useState<api.ImportResult | null>(null);
  const [commitResult, setCommitResult] = useState<api.ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<api.ImportRun[]>([]);

  const loadRuns = useCallback(() => {
    if (!businessId) return;
    api.listRuns(businessId).then(setRuns).catch(() => setRuns([]));
  }, [businessId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const fieldsForKind = (): string[] => {
    if (kind === 'customers') return ['', 'legacy_customer_id', 'email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'notes', 'tags', 'joined'];
    if (kind === 'payment_methods') return ['', 'legacy_customer_id', 'stripe_customer_id', 'payment_method_token', 'email', 'phone', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default'];
    if (kind === 'memberships') return ['', 'legacy_customer_id', 'email', 'phone', 'plan', 'next_billing_date', 'status', 'start_date'];
    if (kind === 'packages') return ['', 'legacy_customer_id', 'email', 'phone', 'package', 'purchase_date'];
    if (kind === 'appointments') return ['', 'legacy_customer_id', 'email', 'phone', 'service', 'staff', 'date', 'time', 'duration', 'status'];
    if (kind === 'transactions') return ['', 'legacy_customer_id', 'email', 'phone', 'date', 'amount', 'description', 'method', 'reference'];
    return ['', 'legacy_customer_id', 'email', 'phone', 'type', 'amount', 'amount_paid', 'description', 'issue_date', 'due_date'];
  };

  const reset = () => {
    setStep('pick'); setKind(null); setFile(null); setAnalysis(null);
    setMapping({}); setTrialResult(null); setCommitResult(null); setErr(null); setHasHeader(true);
  };

  const onFile = async (f: File) => {
    if (!kind) return;
    setFile(f); setBusy(true); setErr(null);
    try {
      const a = await api.analyze(kind, f);
      setAnalysis(a);
      setHasHeader(a.hasHeader);
      const m: Record<number, string> = {};
      for (const p of a.proposedMapping) if (p.field) m[p.index] = p.field;
      setMapping(m);
      setStep('review');
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Could not read the file.');
    } finally { setBusy(false); }
  };

  const runTrial = async () => {
    if (!kind || !file) return;
    setBusy(true); setErr(null);
    try {
      setTrialResult(await api.trial(kind, file, businessId, mapping, hasHeader));
      loadRuns();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Trial failed.');
    } finally { setBusy(false); }
  };

  const runCommit = async () => {
    if (!kind || !file) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.commit(kind, file, businessId, mapping, hasHeader);
      setCommitResult(res); setStep('done'); loadRuns();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Import failed.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
        Bring your existing data into DayStream from a CSV or Excel file. Upload, review what we found, run a trial to see
        exactly what would happen, then import. Nothing is sent to your customers.
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
            <input type="file" accept=".csv,.xlsx,.xls" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <div><Button variant="outline" size="sm" onClick={reset}>Back</Button></div>
          </div>
        </div>
      )}

      {/* Step: review + trial */}
      {step === 'review' && analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)' }}>
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            The first row contains column names (uncheck if the first row is already data)
          </label>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-size-sm)' }}>
              <thead>
                <tr>
                  {analysis.columns.map((c, i) => (
                    <th key={i} style={th}>
                      <div style={{ marginBottom: 4 }}>{hasHeader ? c : `Column ${i + 1}`}</div>
                      <select value={mapping[i] || ''} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} style={sel}>
                        {fieldsForKind().map((f) => <option key={f} value={f}>{f ? (FIELD_LABELS[f] || f) : '— Skip —'}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.sampleRows.map((row, ri) => (
                  <tr key={ri}>{analysis.columns.map((_, ci) => <td key={ci} style={td}>{row[ci] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
            <Button size="sm" loading={busy} onClick={runTrial}>Run trial</Button>
            {trialResult && <Button size="sm" loading={busy} onClick={runCommit}>Import for real</Button>}
          </div>

          {trialResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Alert variant={trialResult.failed === 0 ? 'success' : 'warning'}>
                Trial (nothing saved): {trialResult.imported} would import, {trialResult.matched} already exist,{' '}
                {trialResult.failed} would fail.
              </Alert>
              {trialResult.failures.length > 0 && (
                <>
                  <FailureList failures={trialResult.failures} />
                  <div><Button variant="outline" size="sm" onClick={() => downloadFailures(trialResult.failures)}>Download all failures</Button></div>
                </>
              )}
              {(trialResult.warnings?.length ?? 0) > 0 && <WarningList warnings={trialResult.warnings!} />}
            </div>
          )}
        </div>
      )}

      {/* Step: done */}
      {step === 'done' && commitResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Alert variant={commitResult.failed === 0 ? 'success' : 'warning'}>
            Imported {commitResult.imported}, matched {commitResult.matched} existing, {commitResult.failed} failed.
          </Alert>
          {commitResult.failures.length > 0 && (
            <>
              <FailureList failures={commitResult.failures} />
              <div><Button variant="outline" size="sm" onClick={() => downloadFailures(commitResult.failures)}>Download failures to fix &amp; re-import</Button></div>
            </>
          )}
          {(commitResult.warnings?.length ?? 0) > 0 && <WarningList warnings={commitResult.warnings!} />}
          <div><Button size="sm" onClick={reset}>Import something else</Button></div>
        </div>
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
