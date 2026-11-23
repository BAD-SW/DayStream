import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as packagesApi from '../api/packages';
import type { CustomerPackage, CustomerPackageItem, PackageUse } from '../api/packages';
import { formatDateOnly } from '../utils/date';

// ============================================================
// The customer's Packages tab (owner, 23 Nov 2026; spec 51, gap 19): every package bought, what it
// includes, how much is used and left. A row opens to show each use: the appointment it was for
// (when, what, with whom) or the upcoming appointment holding it, and the order that paid it.
// ============================================================

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', 'used up': 'neutral', expired: 'warning', cancelled: 'error', pending: 'info',
};
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "300 min" or "5 sessions" (a session item counts 1 per use). */
const amount = (unit: CustomerPackageItem['unit'], n: number) => (unit === 'minutes' ? `${n} min` : `${n} ${n === 1 ? 'session' : 'sessions'}`);
const itemName = (i: CustomerPackageItem) => (i.variant_name ? `${i.name} (${i.variant_name})` : i.name);
const useAmount = (i: CustomerPackageItem, u: PackageUse) => amount(i.unit, i.unit === 'minutes' ? (u.minutes || 0) : u.quantity);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function CustomerPackagesTab({ customerId, businessId }: { customerId: string; businessId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setLoading(true); setFailed(false);
    packagesApi.getCustomerPackages(customerId, businessId)
      .then((r) => { if (!off) setRows(r); })
      .catch(() => { if (!off) setFailed(true); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [customerId, businessId]);

  // One line per included item in the Includes, Used and Left columns.
  const perItem = (p: CustomerPackage, f: (i: CustomerPackageItem) => React.ReactNode, right = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', textAlign: right ? 'right' : 'left' }}>
      {p.items.length === 0 ? '—' : p.items.map((i) => <div key={i.item_id}>{f(i)}</div>)}
    </div>
  );
  const right = 'right' as const;

  return (
    <div style={s.wrap}>
      <Table<CustomerPackage>
        data={rows}
        loading={loading}
        rowId={(p) => p.purchase_id}
        clientSort
        emptyMessage={failed ? 'The packages could not be loaded.' : 'No packages bought yet.'}
        onRowClick={(p) => setOpen(open === p.purchase_id ? null : p.purchase_id)}
        expandedRowId={open}
        renderExpanded={(p) => <Uses p={p} onOpenOrder={(id) => navigate(`/receipt/${id}`)} />}
        columns={[
          {
            key: 'name', header: 'Package', sortable: true,
            render: (_: unknown, p: CustomerPackage) => (
              <div>
                <strong>{p.name}</strong>
                {p.order && <div style={s.sub}>Order {p.order.order_number}</div>}
              </div>
            ),
          },
          { key: 'includes', header: 'Includes', render: (_: unknown, p: CustomerPackage) => perItem(p, (i) => `${itemName(i)} · ${amount(i.unit, i.total)}`) },
          {
            key: 'used', header: 'Used', align: right,
            render: (_: unknown, p: CustomerPackage) => perItem(p, (i) => (
              <>{amount(i.unit, i.used)}{i.booked > 0 && <div style={s.sub}>{amount(i.unit, i.booked)} booked</div>}</>
            ), true),
          },
          { key: 'left', header: 'Left', align: right, render: (_: unknown, p: CustomerPackage) => perItem(p, (i) => <strong>{amount(i.unit, i.left)}</strong>, true) },
          { key: 'purchased_at', header: 'Bought', sortable: true, render: (v: string) => formatDateOnly(v.slice(0, 10)) },
          { key: 'expires_at', header: 'Expires', sortable: true, render: (v: string | null) => (v ? formatDateOnly(v.slice(0, 10)) : 'Never') },
          { key: 'status', header: 'Status', sortable: true, render: (v: string) => <Badge variant={STATUS_VARIANT[v] || 'neutral'}>{statusLabel(v)}</Badge> },
        ]}
      />
      {rows.length > 0 && <p style={s.hint}>Select a package to see when it was used.</p>}
    </div>
  );
}

/** The opened package: its description, then each item's uses with their appointments. */
function Uses({ p, onOpenOrder }: { p: CustomerPackage; onOpenOrder: (orderId: string) => void }) {
  return (
    <div style={s.uses}>
      {p.description && <p style={s.description}>{p.description}</p>}
      {p.items.map((i) => (
        <div key={i.item_id}>
          {p.items.length > 1 && <h4 style={s.itemTitle}>{itemName(i)}: {amount(i.unit, i.left)} left of {amount(i.unit, i.total)}</h4>}
          {i.uses.length === 0 ? <p style={s.hint}>Not used yet.</p> : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>Appointment</th>
                  <th style={s.th}>Staff</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Used</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Order</th>
                </tr>
              </thead>
              <tbody>
                {i.uses.map((u, n) => (
                  <tr key={n}>
                    <td style={s.td}>{when(u.at)}</td>
                    <td style={s.td}>
                      {u.booking
                        ? <>{u.booking.service_name}{u.booking.variant_name ? ` · ${u.booking.variant_name}` : ''}{u.booking.reference && <div style={s.sub}>{u.booking.reference}</div>}</>
                        : <span style={s.sub}>{u.note || 'Used without an appointment'}</span>}
                    </td>
                    <td style={s.td}>{u.booking?.staff_name || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>{useAmount(i, u)}</td>
                    <td style={s.td}>
                      <Badge variant={u.kind === 'booked' ? 'info' : 'success'}>{u.kind === 'booked' ? 'Booked' : 'Used'}</Badge>
                    </td>
                    <td style={s.td}>
                      {u.order
                        ? <button type="button" style={s.link} onClick={(e) => { e.stopPropagation(); onOpenOrder(u.order!.id); }}>{u.order.order_number}</button>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  sub: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  hint: { margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  uses: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', padding: 'var(--space-sm) 0' },
  description: { margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', whiteSpace: 'pre-line' },
  itemTitle: { margin: '0 0 var(--space-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--font-size-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' },
  td: { padding: 'var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'top' },
  link: { background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', textDecoration: 'underline' },
};
