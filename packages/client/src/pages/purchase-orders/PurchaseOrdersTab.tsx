import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../../design-system/components/data/Table';
import { Badge } from '../../design-system/components/data/Badge';
import { Button } from '../../design-system/components/actions/Button';
import * as poApi from '../../api/purchase-orders';
import type { PoSummary } from '../../api/purchase-orders';
import { formatCurrency } from '../../utils/currency';
import { formatDateOnly } from '../../utils/date';
import { useTranslation } from 'react-i18next';

/** Accounting > Purchase Orders (spec 51, gap 7): every order placed with a vendor. */
export function PurchaseOrdersTab({ businessId }: { businessId: string }) {
  const { t } = useTranslation('inventory');
  const navigate = useNavigate();
  const [rows, setRows] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    poApi.getPurchaseOrders(businessId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [businessId]);

  const columns = [
    { key: 'po_number', header: t('po.list.order'), sortable: true },
    { key: 'created_at', header: t('po.list.date'), sortable: true, render: (v: string) => formatDateOnly(v) },
    { key: 'vendor_name', header: t('po.list.vendor'), sortable: true },
    { key: 'location_name', header: t('po.list.deliverTo'), sortable: true },
    { key: 'expected_on', header: t('po.list.expected'), sortable: true, render: (v: string | null) => (v ? formatDateOnly(v) : '—') },
    { key: 'status', header: t('po.list.status'), sortable: true, filterLabel: (v: string) => poApi.PO_STATUS[v as poApi.PoStatus]?.label ? t(poApi.PO_STATUS[v as poApi.PoStatus].label) : v,
      render: (v: poApi.PoStatus) => <Badge variant={poApi.PO_STATUS[v].variant}>{t(poApi.PO_STATUS[v].label)}</Badge> },
    { key: 'qty_received', header: t('po.list.received'), align: 'right' as const, render: (v: number, r: PoSummary) => t('po.receivedOf', { received: v, ordered: r.qty_ordered }) },
    { key: 'total_cents', header: t('po.list.total'), sortable: true, align: 'right' as const, filter: 'amount' as const, render: (v: number) => formatCurrency(v) },
    { key: 'to_bill_cents', header: t('po.list.toBill'), sortable: true, align: 'right' as const, filter: 'amount' as const, render: (v: number) => (v > 0 ? formatCurrency(v) : '—') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {t('po.list.intro')}
        </p>
        <div style={{ flex: 1 }} />
        <Button onClick={() => navigate('/accounting/purchase-orders/new')}>{t('po.list.new')}</Button>
      </div>
      <Table columns={columns} data={rows} loading={loading} clientSort mobileCardMode
        initialSort={{ key: 'created_at', order: 'desc' }}
        onRowClick={(r) => navigate(`/accounting/purchase-orders/${r.id}`)} emptyMessage={t('po.list.empty')} />
    </div>
  );
}
