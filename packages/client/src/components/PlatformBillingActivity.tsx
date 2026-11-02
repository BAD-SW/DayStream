import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Table, applyTableFilters } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { formatCurrency } from '../utils/currency';
import * as payApi from '../api/payments';

/**
 * PlatformBillingActivity — the billing-run reporting: a date-ranged list of
 * platform billing runs (default last 7 days), master-detail (click a run to see
 * the charges it attempted), plus a failed-charge report. This is REPORTING, so
 * it lives on the system Reports page.
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

const cycleOf = (r: { cycle_year: number; cycle_month: number }) => `${r.cycle_year}-${String(r.cycle_month).padStart(2, '0')}`;

// The runs table's non-date columns, filtered on screen (Started is filtered by the server).
const RUN_FILTER_COLUMNS = [
  { key: 'status', kind: 'values' as const, value: (r: payApi.PlatformBillingRun) => r.status },
  { key: 'newCharges', kind: 'values' as const, value: (r: payApi.PlatformBillingRun) => r.summary?.newCharges ?? '' },
  { key: 'settled', kind: 'values' as const, value: (r: payApi.PlatformBillingRun) => r.summary?.settled ?? '' },
  { key: 'failed', kind: 'values' as const, value: (r: payApi.PlatformBillingRun) => r.summary?.failed ?? '' },
];

export function PlatformBillingActivity() {
  // Column filters beside the sort icon (David, 2026-11-02). The Started filter asks the server
  // for that range (default last 7 days); the other columns filter the runs on screen.
  const [runFilters, setRunFilters] = useState<TableFilters>(() => ({ startedAt: { from: todayISO(-7), to: todayISO(0) } }));
  const from = runFilters.startedAt?.from || '2000-01-01';
  const to = runFilters.startedAt?.to || runFilters.startedAt?.from || todayISO(0);
  const [runs, setRuns] = useState<payApi.PlatformBillingRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runCharges, setRunCharges] = useState<payApi.RunChargeAttempt[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(false);

  const [showFailed, setShowFailed] = useState(false);
  const [failed, setFailed] = useState<payApi.PlatformWideCharge[]>([]);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setOpenRunId(null);
    try {
      setRuns(await payApi.getPlatformBillingRuns(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`));
    } catch { setRuns([]); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  async function toggleRun(runId: string) {
    if (openRunId === runId) { setOpenRunId(null); return; }
    setOpenRunId(runId);
    setLoadingCharges(true);
    try { setRunCharges(await payApi.getRunCharges(runId)); }
    catch { setRunCharges([]); }
    finally { setLoadingCharges(false); }
  }

  async function toggleFailedReport() {
    const next = !showFailed;
    setShowFailed(next);
    if (next) {
      try { setFailed(await payApi.getPlatformWideCharges('failed', 200)); } catch { setFailed([]); }
    }
  }

  return (
    <div>
      <h3 style={styles.title}>Billing Activity</h3>
      <p style={styles.subtext}>Runs in the selected range (default last 7 days). Click a run to see the charges it attempted.</p>


      {(

        <div style={styles.masterDetail}>
          <div style={styles.masterPane}>
            <Table
              rowId={(r: payApi.PlatformBillingRun) => r.id}
              data={applyTableFilters(runs, RUN_FILTER_COLUMNS, { ...runFilters, startedAt: {} })}
              filterSource={runs}
              filters={runFilters}
              onFiltersChange={setRunFilters}
              loading={loading}
              emptyMessage="No runs in this range."
              onRowClick={(r) => toggleRun(r.id)}
              activeRowId={openRunId}
              clientSort
              columns={[
                { key: 'startedAt', header: 'Started', sortable: true, filter: 'date' as const, render: (v: string) => (v ? new Date(v).toLocaleString() : '—') },
                { key: 'status', header: 'Status', sortable: true, render: (v: string) => <span style={{ color: v === 'success' ? 'var(--color-success, #17794A)' : v === 'failed' ? 'var(--color-error, #C4291C)' : 'var(--color-text)' }}>{v}</span> },
                { key: 'newCharges', header: 'New', align: 'right' as const, sortable: true, filterValue: (r: payApi.PlatformBillingRun) => r.summary?.newCharges ?? '', render: (_: any, r: payApi.PlatformBillingRun) => r.summary?.newCharges ?? '—' },
                { key: 'settled', header: 'Set.', align: 'right' as const, sortable: true, filterValue: (r: payApi.PlatformBillingRun) => r.summary?.settled ?? '', render: (_: any, r: payApi.PlatformBillingRun) => r.summary?.settled ?? '—' },
                { key: 'failed', header: 'Fail', align: 'right' as const, sortable: true, filterValue: (r: payApi.PlatformBillingRun) => r.summary?.failed ?? '', render: (_: any, r: payApi.PlatformBillingRun) => r.summary?.failed ?? '—' },
              ]}
            />
          </div>

          <div style={styles.detailPane}>
            {!openRunId ? (
              <p style={styles.subtext}>Select a run to see the charges it attempted.</p>
            ) : loadingCharges ? (
              <p style={styles.subtext}>Loading charges…</p>
            ) : runCharges.length === 0 ? (
              <p style={styles.subtext}>This run attempted no charges.</p>
            ) : (
              <Table
                rowId={(a: payApi.RunChargeAttempt) => a.id}
                data={runCharges}
                clientSort
                columns={[
                  { key: 'reference_number', header: 'Ref', sortable: true, render: (v: string) => v ?? '—' },
                  { key: 'tenant_name', header: 'Tenant', sortable: true },
                  { key: 'cycle', header: 'Cycle', sortable: true, filterValue: cycleOf, render: (_: any, a: payApi.RunChargeAttempt) => cycleOf(a) },
                  { key: 'amount_cents', header: 'Amount', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), runCharges[0]?.currency), render: (v: number, a: payApi.RunChargeAttempt) => formatCurrency(v, a.currency) },
                  { key: 'outcome', header: 'Outcome', sortable: true, render: (v: string) => <span style={{ color: CHARGE_STATUS_COLOR[v] }}>{v}</span> },
                  { key: 'detail', header: 'Detail', filterValue: (a: payApi.RunChargeAttempt) => a.failure_reason || a.provider_reference || '', render: (_: any, a: payApi.RunChargeAttempt) => a.failure_reason || a.provider_reference || '—' },
                ]}
              />
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
          <Table
            rowId={(f: payApi.PlatformWideCharge) => f.id}
            data={failed}
            clientSort
            columns={[
              { key: 'reference_number', header: 'Ref', sortable: true },
              { key: 'tenant_name', header: 'Tenant', sortable: true },
              { key: 'cycle', header: 'Cycle', sortable: true, filterValue: cycleOf, render: (_: any, f: payApi.PlatformWideCharge) => cycleOf(f) },
              { key: 'amount_charged_cents', header: 'Amount', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), failed[0]?.currency), render: (v: number, f: payApi.PlatformWideCharge) => formatCurrency(v, f.currency) },
              { key: 'attempts', header: 'Attempts', align: 'right' as const, sortable: true },
              { key: 'failure_reason', header: 'Reason', sortable: true, render: (v: string) => v || '—' },
            ]}
          />
        )
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any, margin: '0 0 var(--space-xs)', color: 'var(--color-text)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-sm)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  masterDetail: { display: 'flex', gap: 'var(--space-lg)', marginTop: 'var(--space-md)', alignItems: 'flex-start' },
  masterPane: { flex: '0 0 560px', maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  detailPane: { flex: 1, minWidth: 0, maxHeight: '420px', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' },
};
