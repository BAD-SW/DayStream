import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { formatCurrency } from '../utils/currency';
import * as checkoutApi from '../api/checkout';
import type { Order } from '../api/checkout';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  open: 'warning', completed: 'success', voided: 'neutral', refunded: 'error', partially_refunded: 'warning',
};

/** YYYY-MM-DD for today (local). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** YYYY-MM-DD for 7 days ago (local). */
function sevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  // Searching inside the orders' items stays a search box (it is not a column).
  const [productFilter, setProductFilter] = useState('');
  const [debouncedProduct, setDebouncedProduct] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebouncedProduct(productFilter.trim()), 300); return () => clearTimeout(t); }, [productFilter]);
  // Column filters from the icon beside each sort icon (David, 2026-11-02). The list starts on
  // the last 7 days, as before, shown as the Date filter.
  const [tableFilters, setTableFilters] = useState<TableFilters>((): TableFilters => ({ completed_at: { from: sevenDaysAgo(), to: todayStr() } }));
  // No pages: more orders load as the list scrolls.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchOrders = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await checkoutApi.getOrders(businessId, { product: debouncedProduct || undefined, columns: tableFilters, page: 1, limit: 50 });
      setOrders(result.data);
      setPage(1);
      setTotal(result.meta?.total || 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, debouncedProduct, tableFilters]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const loadMore = useCallback(async () => {
    if (loadingMore || orders.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await checkoutApi.getOrders(businessId, { product: debouncedProduct || undefined, columns: tableFilters, page: page + 1, limit: 50 });
      setOrders((rows) => [...rows, ...result.data]);
      setPage(page + 1);
      setTotal(result.meta?.total || 0);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, debouncedProduct, tableFilters, page, loadingMore, orders.length, total]);

  const filterOptions = useCallback(async (key: string) => {
    const values = await checkoutApi.getOrderColumnValues(businessId, key, tableFilters, debouncedProduct || undefined);
    return values.map((v) => ({
      value: v.value, count: v.count,
      label: key === 'total_amount' ? formatCurrency(Number(v.value))
        : key === 'customer_first_name' ? (v.label || 'Walk-in')
        : key === 'status' ? v.value.replace('_', ' ')
        : v.label || v.value,
    }));
  }, [businessId, tableFilters, debouncedProduct]);

  const columns = [
    { key: 'order_number', header: 'Order', width: '140px', sortable: true },
    {
      key: 'completed_at', header: 'Date', sortable: true, filter: 'date' as const,
      render: (_: any, row: Order) => {
        const d = row.completed_at || row.created_at;
        return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
      },
    },
    {
      key: 'customer_first_name', header: 'Customer', sortable: true,
      render: (_: any, row: Order) =>
        row.customer_first_name
          ? `${row.customer_first_name} ${row.customer_last_name ?? ''}`.trim()
          : (row.walk_in_name ? `${row.walk_in_name} (walk-in)` : 'Walk-in'),
    },
    {
      key: 'item_count', header: 'Items', align: 'center' as const, filter: 'values' as const,
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
        <input type="text" style={styles.select} value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Search items in the orders…" title="Orders that contain an item with this name" aria-label="Search items in the orders" />
      </div>

      <Table
        columns={columns}
        data={orders}
        loading={loading}
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        filterOptions={filterOptions}
        onLoadMore={loadMore}
        hasMore={orders.length < total}
        loadingMore={loadingMore}
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
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
};
