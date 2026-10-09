import { useState, useEffect, useCallback } from 'react';
import { Pagination } from '../design-system/components/navigation/Pagination';
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await payApi.getTenantCharges(tenantId);
      setCharges(data.charges);
      setPage(1);
    } catch {
      setCharges([]);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={styles.muted}>Loading charge history…</p>;
  if (charges.length === 0) return <p style={styles.muted}>No charges yet.</p>;

  const totalPages = Math.max(1, Math.ceil(charges.length / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;
  const pageRows = charges.slice(start, start + perPage);

  return (
    <div>
      <p style={styles.muted}>{charges.length} charge{charges.length === 1 ? '' : 's'}</p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Ref</th>
            <th style={styles.th}>Cycle</th>
            <th style={styles.thRight}>Flat</th>
            <th style={styles.thRight}>%</th>
            <th style={styles.thRight}>Credit</th>
            <th style={styles.thRight}>Charged</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Settled</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => (
            <tr key={c.id}>
              <td style={styles.td}>{c.reference_number}</td>
              <td style={styles.td}>{c.cycle_year}-{String(c.cycle_month).padStart(2, '0')}</td>
              <td style={styles.tdRight}>{formatCurrency(c.flat_component_cents, c.currency)}</td>
              <td style={styles.tdRight}>{formatCurrency(c.percentage_component_cents, c.currency)}</td>
              <td style={styles.tdRight}>{formatCurrency(c.credit_applied_cents, c.currency)}</td>
              <td style={styles.tdRight}>{formatCurrency(c.amount_charged_cents, c.currency)}</td>
              <td style={{ ...styles.td, color: STATUS_COLOR[c.status] }}>{c.status}</td>
              <td style={styles.td}>{c.settled_at ? new Date(c.settled_at).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={styles.pager}>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          itemsPerPage={perPage}
          itemsPerPageOptions={[10, 25, 50]}
          onItemsPerPageChange={(n) => { setPerPage(n); setPage(1); }}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  thRight: { textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
  tdRight: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', textAlign: 'right' },
  pager: { marginTop: 'var(--space-md)', display: 'flex', justifyContent: 'flex-end' },
};
