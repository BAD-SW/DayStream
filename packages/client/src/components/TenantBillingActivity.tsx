import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { formatCurrency } from '../utils/currency';
import * as payApi from '../api/payments';

/**
 * TenantBillingActivity — the tenant billing-run reporting: a date-ranged list of
 * this tenant's billing runs (default last 7 days), master-detail (click a run to
 * see the business charges it attempted), plus a failed-charge report. The direct
 * mirror of PlatformBillingActivity one level down. Lives on the tenant Reports page.
 */

const CHARGE_STATUS_COLOR: Record<string, string> = {
  settled: 'var(--color-success, #17794A)',
  zero: 'var(--color-text-secondary)',
  pending: 'var(--color-warning, #B7791F)',
  retrying: 'var(--color-warning, #B7791F)',
  failed: 'var(--color-error, #C4291C)',
};

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function TenantBillingActivity() {
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO(0));
  const [runs, setRuns] = useState<payApi.PlatformBillingRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runCharges, setRunCharges] = useState<payApi.BusinessRunChargeAttempt[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(false);

  const [showFailed, setShowFailed] = useState(false);
  const [failed, setFailed] = useState<payApi.BusinessWideCharge[]>([]);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setOpenRunId(null);
    try {
      setRuns(await payApi.getTenantBillingRuns(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`));
    } catch { setRuns([]); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  async function toggleRun(runId: string) {
    if (openRunId === runId) { setOpenRunId(null); return; }
    setOpenRunId(runId);
    setLoadingCharges(true);
    try { setRunCharges(await payApi.getTenantRunCharges(runId)); }
    catch { setRunCharges([]); }
    finally { setLoadingCharges(false); }
  }

  async function toggleFailedReport() {
    const next = !showFailed;
    setShowFailed(next);
    if (next) {
      try { setFailed(await payApi.getBusinessWideCharges('failed', 200)); } catch { setFailed([]); }
    }
  }

  return (
    <div>
      <h3 style={styles.title}>Billing Activity</h3>
      <p style={styles.subtext}>Runs in the selected range (default last 7 days). Click a run to see the charges it attempted.</p>

      <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={styles.group}>
          <label style={styles.label}>From</label>
          <input style={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={styles.group}>
          <label style={styles.label}>To</label>
          <input style={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={loadRuns} loading={loading}>Apply</Button>
      </div>

      {runs.length === 0 ? (
        <p style={{ ...styles.subtext, marginTop: 'var(--space-md)' }}>No runs in this range.</p>
      ) : (
        <div style={styles.masterDetail}>
          <div style={styles.masterPane}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Started</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.thRight}>New</th>
                  <th style={styles.thRight}>Set.</th>
                  <th style={styles.thRight}>Fail</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => toggleRun(r.id)}
                    style={{ cursor: 'pointer', background: openRunId === r.id ? 'var(--color-surface-sunken, rgba(0,0,0,0.04))' : undefined }}
                  >
                    <td style={styles.td}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                    <td style={{ ...styles.td, color: r.status === 'success' ? 'var(--color-success, #17794A)' : r.status === 'failed' ? 'var(--color-error, #C4291C)' : 'var(--color-text)' }}>{r.status}</td>
                    <td style={styles.tdRight}>{r.summary?.newCharges ?? '—'}</td>
                    <td style={styles.tdRight}>{r.summary?.settled ?? '—'}</td>
                    <td style={styles.tdRight}>{r.summary?.failed ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.detailPane}>
            {!openRunId ? (
              <p style={styles.subtext}>Select a run to see the charges it attempted.</p>
            ) : loadingCharges ? (
              <p style={styles.subtext}>Loading charges…</p>
            ) : runCharges.length === 0 ? (
              <p style={styles.subtext}>This run attempted no charges.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Ref</th>
                    <th style={styles.th}>Business</th>
                    <th style={styles.th}>Cycle</th>
                    <th style={styles.thRight}>Amount</th>
                    <th style={styles.th}>Outcome</th>
                    <th style={styles.th}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {runCharges.map((a) => (
                    <tr key={a.id}>
                      <td style={styles.td}>{a.reference_number ?? '—'}</td>
                      <td style={styles.td}>{a.business_name}</td>
                      <td style={styles.td}>{a.cycle_year}-{String(a.cycle_month).padStart(2, '0')}</td>
                      <td style={styles.tdRight}>{formatCurrency(a.amount_cents, a.currency)}</td>
                      <td style={{ ...styles.td, color: CHARGE_STATUS_COLOR[a.outcome] }}>{a.outcome}</td>
                      <td style={styles.td}>{a.failure_reason || a.provider_reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-lg)' }}>
        <h4 style={styles.label}>Failed-charge report</h4>
        <Button variant="outline" size="sm" onClick={toggleFailedReport}>{showFailed ? 'Hide' : 'Show'}</Button>
      </div>
      {showFailed && (
        failed.length === 0 ? (
          <p style={styles.subtext}>No outstanding failed charges.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Ref</th>
                <th style={styles.th}>Business</th>
                <th style={styles.th}>Cycle</th>
                <th style={styles.thRight}>Amount</th>
                <th style={styles.thRight}>Attempts</th>
                <th style={styles.th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((c) => (
                <tr key={c.id}>
                  <td style={styles.td}>{c.reference_number}</td>
                  <td style={styles.td}>{c.business_name}</td>
                  <td style={styles.td}>{c.cycle_year}-{String(c.cycle_month).padStart(2, '0')}</td>
                  <td style={styles.tdRight}>{formatCurrency(c.amount_charged_cents, c.currency)}</td>
                  <td style={styles.tdRight}>{c.attempts}</td>
                  <td style={styles.td}>{c.failure_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any, margin: '0 0 var(--space-xs)', color: 'var(--color-text)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-sm)' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  masterDetail: { display: 'flex', gap: 'var(--space-lg)', marginTop: 'var(--space-md)', alignItems: 'flex-start' },
  masterPane: { flex: '0 0 420px', maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  detailPane: { flex: 1, minWidth: 0, maxHeight: '420px', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-xs)' },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  thRight: { textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
  tdRight: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', textAlign: 'right' },
};
