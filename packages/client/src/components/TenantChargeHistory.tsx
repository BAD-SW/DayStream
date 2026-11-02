import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { formatCurrency } from '../utils/currency';
import * as payApi from '../api/payments';
import type { PlatformBillingCharge } from '../api/payments';

/**
 * TenantChargeHistory — the platform billing charge history for a single tenant,
 * rendered on the tenant window's "Charge History" tab. Paged so it doesn't grow
 * unbounded in the modal (a tenant accrues ~12 charges/year plus retries).
 *
 * A single tenant's charge set is small, so it's fetched once and paged
 * client-side rather than adding server pagination.
 */

interface Props {
  tenantId: string;
}

const STATUS_COLOR: Record<string, string> = {
  settled: 'var(--color-success, #17794A)',
  zero: 'var(--color-text-secondary)',
  pending: 'var(--color-warning, #B7791F)',
  retrying: 'var(--color-warning, #B7791F)',
  failed: 'var(--color-error, #C4291C)',
};

export function TenantChargeHistory({ tenantId }: Props) {
  const [charges, setCharges] = useState<PlatformBillingCharge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await payApi.getTenantCharges(tenantId);
      setCharges(data.charges);
    } catch {
      setCharges([]);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={styles.muted}>Loading charge history…</p>;
  if (charges.length === 0) return <p style={styles.muted}>No charges yet.</p>;

  // The shared table: column filters beside the sort icon, scrolls instead of paging
  // (David, 2026-11-02).
  const money = (v: any, c: PlatformBillingCharge) => formatCurrency(Number(v), c.currency);
  return (
    <div>
      <p style={styles.muted}>{charges.length} charge{charges.length === 1 ? '' : 's'}</p>
      <Table
        rowId={(c: PlatformBillingCharge) => c.id}
        data={charges}
        clientSort
        columns={[
          { key: 'reference_number', header: 'Ref', sortable: true },
          { key: 'cycle', header: 'Cycle', sortable: true, filterValue: (c: PlatformBillingCharge) => `${c.cycle_year}-${String(c.cycle_month).padStart(2, '0')}`, render: (_: any, c: PlatformBillingCharge) => `${c.cycle_year}-${String(c.cycle_month).padStart(2, '0')}` },
          { key: 'flat_component_cents', header: 'Flat', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), charges[0]?.currency), render: money },
          { key: 'percentage_component_cents', header: '%', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), charges[0]?.currency), render: money },
          { key: 'credit_applied_cents', header: 'Credit', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), charges[0]?.currency), render: money },
          { key: 'amount_charged_cents', header: 'Charged', align: 'right' as const, sortable: true, filter: 'amount' as const, filterLabel: (v: string) => formatCurrency(Number(v), charges[0]?.currency), render: money },
          { key: 'status', header: 'Status', sortable: true, render: (v: string) => <span style={{ color: STATUS_COLOR[v] }}>{v}</span> },
          { key: 'settled_at', header: 'Settled', sortable: true, filter: 'date' as const, render: (v: string) => (v ? new Date(v).toLocaleDateString() : '—') },
        ]}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
