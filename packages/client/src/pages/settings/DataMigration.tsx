import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Alert } from '../../design-system/components/feedback/Alert';
import { Badge } from '../../design-system/components/data/Badge';
import { Tabs } from '../../design-system/components/navigation/Tabs';
import * as api from '../../api/dataMigration';

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

type Step = 'pick' | 'upload' | 'review' | 'stage' | 'done';

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
    setMapping({}); setErr(null); setHasHeader(true);
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
          {analysis.proposedMapping.some((p) => p.confidence === 'likely' && (mapping[p.index] || '') === (p.field || '')) && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              We filled in the mappings we were sure of. Columns outlined and marked
              <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}> "Guessed — please confirm" </span>
              are our best guess — check them before importing, and change any that are wrong.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-size-sm)' }}>
              <thead>
                <tr>
                  {analysis.columns.map((c, i) => {
                    const proposal = analysis.proposedMapping.find((p) => p.index === i);
                    // A "likely" auto-mapping is a guess worth a glance: pre-selected, but flagged
                    // for confirmation while the user hasn't changed it away from the proposal.
                    const needsConfirm = proposal?.confidence === 'likely'
                      && (mapping[i] || '') === (proposal.field || '');
                    return (
                    <th key={i} style={th}>
                      <div style={{ marginBottom: 4 }}>{hasHeader ? c : `Column ${i + 1}`}</div>
                      <select
                        value={mapping[i] || ''}
                        onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}
                        style={needsConfirm ? { ...sel, borderColor: 'var(--color-warning)', borderWidth: 2 } : sel}
                      >
                        {fieldsForKind().map((f) => <option key={f} value={f}>{f ? (FIELD_LABELS[f] || f) : '— Skip —'}</option>)}
                      </select>
                      {needsConfirm && (
                        <div style={{ marginTop: 2, fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
                          Guessed — please confirm
                        </div>
                      )}
                    </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {analysis.sampleRows.map((row, ri) => (
                  <tr key={ri}>{analysis.columns.map((_, ci) => <td key={ci} style={td}>{row[ci] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          {analysis.repair && <RepairPanel repair={analysis.repair} />}

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
            <Button size="sm" onClick={() => setStep('stage')}>Continue to records →</Button>
          </div>
        </div>
      )}

      {/* Step: three-tab staging (All / Mapped / Error) */}
      {step === 'stage' && kind && analysis && (
        <StagingTabs
          kind={kind}
          businessId={businessId}
          fileName={file?.name ?? null}
          analysis={analysis}
          mapping={mapping}
          onBack={() => setStep('review')}
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

/**
 * Rows the engine realigned (and any it couldn't). Pre-select-but-confirm: the repairs are
 * applied for the import, but shown here as before/after so the owner can eyeball them first.
 */
function RepairPanel({ repair }: { repair: api.RepairInfo }) {
  if (repair.repaired === 0 && repair.unresolved === 0) return null;
  return (
    <Alert variant={repair.unresolved > 0 ? 'warning' : 'info'}>
      {repair.repaired > 0 && (
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {repair.repaired} row{repair.repaired === 1 ? '' : 's'} looked misaligned and {repair.repaired === 1 ? 'was' : 'were'} auto-corrected — please review
        </div>
      )}
      {repair.unresolved > 0 && (
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {repair.unresolved} row{repair.unresolved === 1 ? '' : 's'} could not be lined up and {repair.unresolved === 1 ? 'was' : 'were'} skipped — fix {repair.unresolved === 1 ? 'it' : 'them'} in your file and re-import
        </div>
      )}
      {repair.samples.slice(0, 5).map((s) => (
        <div key={s.row} style={{ fontSize: 'var(--font-size-xs)', marginTop: 6 }}>
          <div style={{ fontWeight: 600 }}>Row {s.row}</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>before: {s.before.join(' | ')}</div>
          <div style={{ color: 'var(--color-text)' }}>after:&nbsp; {s.after.join(' | ')}</div>
        </div>
      ))}
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

// ---------------------------------------------------------------------------
// Stage B — three-tab staging (All / Mapped / Error)
// ---------------------------------------------------------------------------

type Bucket = 'mapped' | 'error';

interface StageRow {
  row: number;            // 1-based source row number
  cells: string[];        // current (possibly user-shifted) cells
  bucket: Bucket;
  reason?: string;        // why it's in Error (from the engine, or after a manual shift)
  autoMapped: boolean;    // true if the engine placed it in Mapped (ok/repaired); false if hand-accepted
}

/** Field label for a mapped column index, for the aligned preview. */
function labelForColumn(mapping: Record<number, string>, idx: number): string | null {
  const field = mapping[idx];
  if (!field) return null;
  return FIELD_LABELS[field] || field;
}

/**
 * The three-tab staging surface. Owns the working set in browser state only — nothing is
 * persisted until the owner commits the Mapped bucket. Committing imports ONLY the Mapped rows
 * (record-level dedup keeps repeated commits safe), after which committed rows leave the set and
 * the owner can keep working the Error tab.
 */
function StagingTabs({
  kind, businessId, fileName, analysis, mapping, onBack, onDone,
}: {
  kind: api.ImportKind;
  businessId: string;
  fileName: string | null;
  analysis: api.AnalyzeResult;
  mapping: Record<number, string>;
  onBack: () => void;
  onDone: () => void;
}) {
  const width = analysis.width;
  const [rows, setRows] = useState<StageRow[]>(() => analysis.rows.map((r) => ({
    row: r.row,
    cells: padTo(r.cells, width),
    bucket: r.alignment === 'unresolved' ? 'error' : 'mapped',
    reason: r.reason,
    autoMapped: r.alignment !== 'unresolved',
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<api.ImportResult | null>(null);

  const mapped = rows.filter((r) => r.bucket === 'mapped');
  const errored = rows.filter((r) => r.bucket === 'error');

  // The mapped column indexes in order, for a readable aligned preview.
  const mappedCols = Object.keys(mapping).map(Number).filter((i) => mapping[i]).sort((a, b) => a - b);

  const shift = (rowNum: number, dir: -1 | 1) => {
    setRows((prev) => prev.map((r) => {
      if (r.row !== rowNum) return r;
      const cells = r.cells.slice();
      if (dir === 1) { cells.unshift(''); cells.pop(); }           // shift right: prepend a blank
      else { cells.shift(); cells.push(''); }                      // shift left: drop the leading cell
      return { ...r, cells };
    }));
  };

  const acceptToMapped = (rowNum: number) => {
    setRows((prev) => prev.map((r) => (r.row === rowNum ? { ...r, bucket: 'mapped', reason: undefined } : r)));
  };
  const sendToError = (rowNum: number) => {
    setRows((prev) => prev.map((r) => (r.row === rowNum ? { ...r, bucket: 'error', reason: 'Moved back for correction' } : r)));
  };

  const commitMapped = async () => {
    if (mapped.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.commitRows(kind, businessId, mapping, mapped.map((r) => r.cells), fileName);
      setResult(res);
      // Committed rows leave the working set; any Error rows stay so the owner can keep going.
      const committedRowNums = new Set(mapped.map((r) => r.row));
      setRows((prev) => prev.filter((r) => !committedRowNums.has(r.row)));
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Import failed.');
    } finally { setBusy(false); }
  };

  const clearMapped = () => {
    // Only clears the AUTO-mapped rows that haven't been committed; hand-accepted rows stay put
    // unless explicitly sent back. Simplest honest behaviour: drop everything currently in Mapped.
    const mappedRowNums = new Set(mapped.map((r) => r.row));
    setRows((prev) => prev.filter((r) => !mappedRowNums.has(r.row)));
  };

  const renderRow = (r: StageRow) => (
    <div key={r.row} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Row {r.row}</span>
        {r.bucket === 'error' && <Badge variant="warning">needs fixing</Badge>}
        {r.bucket === 'mapped' && !r.autoMapped && <Badge variant="success">fixed</Badge>}
      </div>
      {r.reason && r.bucket === 'error' && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', marginBottom: 6 }}>{r.reason}</div>
      )}
      {/* Aligned preview: the mapped columns and the value currently landing in each. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {mappedCols.map((ci) => (
          <span key={ci} style={{ fontSize: 'var(--font-size-xs)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{labelForColumn(mapping, ci)}:</span>{' '}
            <span style={{ color: 'var(--color-text)' }}>{r.cells[ci] || <em style={{ color: 'var(--color-text-muted)' }}>(blank)</em>}</span>
          </span>
        ))}
      </div>
      {r.bucket === 'error' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="outline" size="sm" onClick={() => shift(r.row, -1)}>← shift left</Button>
          <Button variant="outline" size="sm" onClick={() => shift(r.row, 1)}>shift right →</Button>
          <Button size="sm" onClick={() => acceptToMapped(r.row)}>Accept into Mapped</Button>
        </div>
      )}
      {r.bucket === 'mapped' && !r.autoMapped && (
        <div><Button variant="ghost" size="sm" onClick={() => sendToError(r.row)}>Send back to fix</Button></div>
      )}
    </div>
  );

  const tabs = [
    {
      id: 'all', label: `All (${rows.length})`,
      content: <div>{rows.length === 0 ? <Empty /> : rows.map(renderRow)}</div>,
    },
    {
      id: 'mapped', label: `Mapped (${mapped.length})`,
      content: (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Button size="sm" loading={busy} disabled={mapped.length === 0} onClick={commitMapped}>
              Import {mapped.length} mapped record{mapped.length === 1 ? '' : 's'}
            </Button>
            <Button variant="outline" size="sm" disabled={mapped.length === 0} onClick={clearMapped}>Clear mapped</Button>
          </div>
          {mapped.length === 0 ? <Empty /> : mapped.map(renderRow)}
        </div>
      ),
    },
    {
      id: 'error', label: `Error (${errored.length})`,
      content: (
        <div>
          {errored.length === 0
            ? <Alert variant="success">No problem records. Everything lines up.</Alert>
            : (<>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                  These records don&apos;t line up with the other rows. Nudge each one left or right until the values sit
                  under the right labels, then accept it — it moves to the Mapped tab.
                </div>
                {errored.map(renderRow)}
              </>)}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {err && <Alert variant="error">{err}</Alert>}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Alert variant={result.failed === 0 ? 'success' : 'warning'}>
            Imported {result.imported}, matched {result.matched} already in the system, {result.failed} failed.
            {errored.length > 0 && ` ${errored.length} record${errored.length === 1 ? '' : 's'} still need fixing on the Error tab.`}
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

      <Tabs items={tabs} defaultTab={errored.length > 0 ? 'error' : 'mapped'} />

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" size="sm" onClick={onBack}>← Back to mapping</Button>
        <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '8px 0' }}>No records here.</div>;
}

/** Pad/truncate a row to exactly `width` cells (for a stable aligned preview). */
function padTo(cells: string[], width: number): string[] {
  const c = cells.slice(0, width);
  while (c.length < width) c.push('');
  return c;
}
