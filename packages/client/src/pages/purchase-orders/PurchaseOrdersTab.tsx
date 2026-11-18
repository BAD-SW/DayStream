import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../../design-system/components/data/Table';
import { Badge } from '../../design-system/components/data/Badge';
import { Button } from '../../design-system/components/actions/Button';
import * as poApi from '../../api/purchase-orders';
import type { PoSummary } from '../../api/purchase-orders';
import { formatCurrency } from '../../utils/currency';
import { formatDateOnly } from '../../utils/date';

/** Accounting > Purchase Orders (spec 51, gap 7): every order placed with a vendor. */
export function PurchaseOrdersTab({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    poApi.getPurchaseOrders(businessId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [businessId]);

  const columns = [
    { key: 'po_number', header: 'Order', sortable: true },
    { key: 'created_at', header: 'Date', sortable: true, render: (v: string) => formatDateOnly(v) },
    { key: 'vendor_name', header: 'Vendor', sortable: true },
    { key: 'location_name', header: 'Deliver to', sortable: true },
    { key: 'expected_on', header: 'Expected', sortable: true, render: (v: string | null) => (v ? formatDateOnly(v) : '—') },
    { key: 'status', header: 'Status', sortable: true, filterLabel: (v: string) => poApi.PO_STATUS[v as poApi.PoStatus]?.label ?? v,
      render: (v: poApi.PoStatus) => <Badge variant={poApi.PO_STATUS[v].variant}>{poApi.PO_STATUS[v].label}</Badge> },
    { key: 'qty_received', header: 'Received', align: 'right' as const, render: (v: number, r: PoSummary) => `${v} of ${r.qty_ordered}` },
    { key: 'total_cents', header: 'Total', sortable: true, align: 'right' as const, filter: 'amount' as const, render: (v: number) => formatCurrency(v) },
    { key: 'to_bill_cents', header: 'To bill', sortable: true, align: 'right' as const, filter: 'amount' as const, render: (v: number) => (v > 0 ? formatCurrency(v) : '—') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Order tracked products from a vendor, receive them into stock, and turn what arrived into a bill.
        </p>
        <div style={{ flex: 1 }} />
        <Button onClick={() => navigate('/accounting/purchase-orders/new')}>New Purchase Order</Button>
      </div>
      <Table columns={columns} data={rows} loading={loading} clientSort mobileCardMode
        initialSort={{ key: 'created_at', order: 'desc' }}
        onRowClick={(r) => navigate(`/accounting/purchase-orders/${r.id}`)} emptyMessage="No purchase orders yet." />
    </div>
  );
}
