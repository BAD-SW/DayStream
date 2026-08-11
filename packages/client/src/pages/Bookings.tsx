import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as bookingsApi from '../api/bookings';
import type { Booking } from '../api/bookings';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'neutral', confirmed: 'info', checked_in: 'success', in_progress: 'warning', completed: 'success', cancelled: 'error', no_show: 'error',
};

export function Bookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0]);
  const [staffFilter, setStaffFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [serviceList, setServiceList] = useState<any[]>([]);

  const businessId = localStorage.getItem('business_id') || '';

  // Fetch business timezone and staff list for filter
  useEffect(() => {
    if (!businessId) return;
    import('../api/client').then(({ apiClient }) => {
      apiClient.get('/v1/admin/businesses').then((res) => {
        const biz = res.data.data?.find((b: any) => b.id === businessId);
        if (biz?.timezone) setBusinessTimezone(biz.timezone);
      }).catch(() => {});
    });
    import('../api/staff').then((staffApi) => {
      staffApi.getStaffList({ business_id: businessId, status: 'active' }).then((res) => setStaffList(res.data)).catch(() => {});
    });
    import('../api/services').then((svcApi) => {
      svcApi.getServices(businessId).then((res: any) => {
        const list = (res as any).data || res;
        setServiceList(Array.isArray(list) ? list : []);
      }).catch(() => {});
    });
  }, [businessId]);

  const fetchBookings = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await bookingsApi.getBookings(businessId, {
        status: statusFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        staff_id: staffFilter || undefined,
        service_id: serviceFilter || undefined,
        customer_search: customerFilter || undefined,
        page,
      });
      setBookings(result.data);
      setTotalPages(result.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, statusFilter, dateFrom, dateTo, staffFilter, serviceFilter, customerFilter, page]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const handleAction = async (action: string, booking: Booking) => {
    try {
      if (action === 'confirm') await bookingsApi.confirmBooking(booking.id, businessId);
      else if (action === 'cancel') await bookingsApi.cancelBooking(booking.id, businessId);
      else if (action === 'no-show') await bookingsApi.noShowBooking(booking.id, businessId);
      else if (action === 'check-in') await bookingsApi.checkInBooking(booking.id, businessId);
      else if (action === 'reset') await bookingsApi.resetBooking(booking.id, businessId);
      else if (action === 'checkout') { navigate(`/checkout?appointment=${booking.id}`); return; }
      fetchBookings();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'booking_reference', header: 'Ref', width: '120px', sortable: true },
    {
      key: 'customer_first_name', header: 'Customer', sortable: true,
      render: (_: any, row: Booking) => row.customer_first_name ? `${row.customer_first_name} ${row.customer_last_name}` : (row as any).walk_in_name || 'Walk-in',
    },
    { key: 'service_name', header: 'Service', sortable: true },
    {
      key: 'start_time', header: 'Date/Time', sortable: true,
      render: (val: string) => new Date(val).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short', timeZone: businessTimezone }),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val.replace('_', ' ')}</Badge>,
    },
    {
      key: 'staff_first_name', header: 'Staff', sortable: true,
      render: (_: any, row: Booking) => row.staff_first_name ? `${row.staff_first_name} ${row.staff_last_name}` : '—',
    },
    {
      key: 'actions', header: '',
      render: (_: any, row: Booking) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.status === 'pending' && <ActionBtn label="Confirm" onClick={() => handleAction('confirm', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="Check-in" onClick={() => handleAction('check-in', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="Cancel" onClick={() => handleAction('cancel', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="No-show" onClick={() => handleAction('no-show', row)} />}
          {row.status === 'checked_in' && <ActionBtn label="Check-out" onClick={() => handleAction('checkout', row)} />}
          {row.status === 'checked_in' && <ActionBtn label="Reset" onClick={() => handleAction('reset', row)} />}
        </div>
      ),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Appointments</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button style={styles.navBtn} onClick={() => navigate('/bookings/new')}>New Appointment</button>
          <button style={styles.navBtn} onClick={() => navigate('/checkout?new=true')}>New Sale</button>
          <button style={styles.navBtn} onClick={() => navigate('/bookings/calendar')}>Calendar</button>
        </div>
      </div>

      <div style={styles.toolbar}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked In</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>
        <select value={staffFilter} onChange={(e) => { setStaffFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Staff</option>
          {staffList.map((s: any) => (
            <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
          ))}
        </select>
        <select value={serviceFilter} onChange={(e) => { setServiceFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Services</option>
          {serviceList.map((s: any) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input type="text" style={styles.select} value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }} placeholder="Customer name..." title="Filter by customer" />
        <input type="date" style={styles.select} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
        <input type="date" style={styles.select} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To date" />
        {(statusFilter || staffFilter || serviceFilter || dateFrom || dateTo || customerFilter) && (
          <button style={styles.navBtn} onClick={() => { setStatusFilter(''); setStaffFilter(''); setServiceFilter(''); setDateFrom(''); setDateTo(''); setCustomerFilter(''); setPage(1); }}>Clear</button>
        )}
      </div>

      <Table columns={columns} data={bookings} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No bookings found" mobileCardMode clientSort onRowClick={(row) => navigate(`/bookings/${row.id}/edit`)} />

    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>{label}</button>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  modalClose: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' },
  modalBody: { marginBottom: 'var(--space-md)' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' },
  seriesItem: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' },
  seriesRef: { color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-xs)', marginLeft: 'auto' },
  cancelSeriesBtn: { background: 'var(--color-error-light)', border: '1px solid var(--color-error-light)', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'white', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any },
};
