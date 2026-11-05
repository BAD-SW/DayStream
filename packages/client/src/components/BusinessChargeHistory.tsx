import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { formatCurrency } from '../utils/currency';
import * as payApi from '../api/payments';
import type { BusinessBillingCharge } from '../api/payments';

/**
 * BusinessChargeHistory — the tenant billing charge history for a single business
 * (Section B), rendered on the business window's "Charge History" tab. The direct
 * mirror of TenantChargeHistory one level down. Paged so it doesn't grow unbounded
 * in the modal.
 */

interface Props {
  businessId: string;
}

const STATUS_COLOR: Record<string, string> = {
  settled: 'var(--color-success, #17794A)',
  zero: 'var(--color-text-secondary)',
  pending: 'var(--color-warning, #B7791F)',
  retrying: 'var(--color-warning, #B7791F)',
  failed: 'var(--color-error, #C4291C)',
};

export function BusinessChargeHistory({ businessId }: Props) {
  const [charges, setCharges] = useState<BusinessBillingCharge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await payApi.getBusinessCharges(businessId);
      setCharges(data.charges);
    } catch {
      setCharges([]);
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={styles.muted}>Loading charge history…</p>;
  if (charges.length === 0) return <p style={styles.muted}>No charges yet.</p>;

  // The shared table: column filters beside the sort icon, scrolls instead of paging
  // (David, 2026-11-02).
  const money = (v: any, c: BusinessBillingCharge) => formatCurrency(Number(v), c.currency);
  return (
    <div>
      <p style={styles.muted}>{charges.length} charge{charges.length === 1 ? '' : 's'}</p>
      <Table
        rowId={(c: BusinessBillingCharge) => c.id}
        data={charges}
        clientSort
        columns={[
          { key: 'reference_number', header: 'Ref', sortable: true },
          { key: 'cycle', header: 'Cycle', sortable: true, filterValue: (c: BusinessBillingCharge) => `${c.cycle_year}-${String(c.cycle_month).padStart(2, '0')}`, render: (_: any, c: BusinessBillingCharge) => `${c.cycle_year}-${String(c.cycle_month).padStart(2, '0')}` },
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
