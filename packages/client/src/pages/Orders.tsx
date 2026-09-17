import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { formatCurrency } from '../utils/currency';
import * as checkoutApi from '../api/checkout';
import type { Order } from '../api/checkout';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  open: 'warning', completed: 'success', voided: 'neutral', refunded: 'error',
};

/**
 * Orders — history of checkouts/orders for the business. Lists past orders
 * (filterable by status, customer, and date) and links each row to its full
 * receipt. Lives under the Bookings/Orders module alongside Appointments; both
 * are transactional views of the same front-desk activity.
 */
export function Orders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('completed');
  const [customerFilter, setCustomerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchOrders = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await checkoutApi.getOrders(businessId, {
        status: statusFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
      });
      setOrders(result.data);
      setTotalPages(result.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, statusFilter, dateFrom, dateTo, page]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Client-side customer name filter over the current page (the list endpoint
  // filters by customer id, not free-text name, so this refines what's shown).
  const visibleOrders = customerFilter.trim()
    ? orders.filter((o) => {
        const name = `${o.customer_first_name ?? ''} ${o.customer_last_name ?? ''}`.toLowerCase();
        return name.includes(customerFilter.trim().toLowerCase());
      })
    : orders;

  const columns = [
    { key: 'order_number', header: 'Order', width: '140px', sortable: true },
    {
      key: 'completed_at', header: 'Date', sortable: true,
      render: (_: any, row: Order) => {
        const d = row.completed_at || row.created_at;
        return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
      },
    },
    {
      key: 'customer_first_name', header: 'Customer', sortable: true,
      render: (_: any, row: Order) =>
        row.customer_first_name ? `${row.customer_first_name} ${row.customer_last_name ?? ''}`.trim() : 'Walk-in',
    },
    {
      key: 'item_count', header: 'Items', align: 'center' as const,
      render: (_: any, row: Order) => String((row as any).item_count ?? 0),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
    {
      key: 'total_amount', header: 'Total', align: 'right' as const, sortable: true,
      render: (val: number) => formatCurrency(val),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Orders</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button style={styles.navBtn} onClick={() => navigate('/bookings')}>Appointments</button>
          <button style={styles.navBtn} onClick={() => navigate('/checkout?new=true')}>New Sale</button>
        </div>
      </div>

      <div style={styles.toolbar}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="open">Open</option>
          <option value="voided">Voided</option>
          <option value="refunded">Refunded</option>
        </select>
        <input type="text" style={styles.select} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} placeholder="Customer name..." title="Filter by customer" />
        <input type="date" style={styles.select} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
        <input type="date" style={styles.select} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To date" />
        {(statusFilter !== 'completed' || dateFrom || dateTo || customerFilter) && (
          <button style={styles.navBtn} onClick={() => { setStatusFilter('completed'); setDateFrom(''); setDateTo(''); setCustomerFilter(''); setPage(1); }}>Reset</button>
        )}
      </div>

      <Table
        columns={columns}
        data={visibleOrders}
        loading={loading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No orders found"
        mobileCardMode
        clientSort
        onRowClick={(row) => navigate(`/receipt/${row.id}`)}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
