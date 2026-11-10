import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCheckInFormsPrompt } from '../components/forms/useCheckInFormsPrompt';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { formatCurrency } from '../utils/currency';
import * as bookingsApi from '../api/bookings';
import type { Booking } from '../api/bookings';
import { useContextManager } from '../context/ContextManager';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'neutral', confirmed: 'info', checked_in: 'success', in_progress: 'warning', completed: 'success', cancelled: 'error', no_show: 'error',
};

export function Bookings() {
  const navigate = useNavigate();
  // Customers get a read-only list of their own bookings: no staff tools, filters or actions.
  const isCustomer = useContextManager().persona === 'customer';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  // Column filters from the icon beside each sort icon (David, 2026-11-02). No page starts filtered (David, 2026-11-04).
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  // No pages: more bookings load as the list scrolls.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');
  const [pendingNoShow, setPendingNoShow] = useState<Booking | null>(null);
  // Customers: the business's appointment cancellation settings (THE-20).
  const [cancelSettings, setCancelSettings] = useState<bookingsApi.CancelSettings | null>(null);
  const [toCancel, setToCancel] = useState<Booking | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const businessId = localStorage.getItem('business_id') || '';

  // Business time zone (times are shown in business-local time) plus the staff / service
  // names for the filters. One call that every business role may make — the full staff,
  // services and business endpoints are refused for front-line staff.
  useEffect(() => {
    if (!businessId || isCustomer) return;
    bookingsApi.getBookingFilters(businessId).then((f) => {
      if (f.timezone) setBusinessTimezone(f.timezone);
    }).catch(() => {});
  }, [businessId, isCustomer]);

  useEffect(() => {
    if (!businessId || !isCustomer) return;
    bookingsApi.getCancellationSettings(businessId).then((s) => {
      setCancelSettings(s.appointments);
      setBusinessTimezone(s.timezone);
    }).catch(() => {});
  }, [businessId, isCustomer]);

  const cancelUntil = (b: Booking) => cancelSettings?.customer_cancel_enabled
    ? new Date(new Date(b.start_time).getTime() - cancelSettings.customer_cancel_hours * 3600 * 1000) : null;
  const customerMayCancel = (b: Booking) => {
    const until = cancelUntil(b);
    return (b.status === 'pending' || b.status === 'confirmed') && !!until && Date.now() <= until.getTime();
  };
  const customerCancel = async (b: Booking) => {
    setNotice(null);
    try {
      const out = await bookingsApi.customerCancelBooking(b.id, businessId);
      setNotice({ ok: true, text: out.refund
        ? `Appointment cancelled. ${formatCurrency(out.refund.amount)} ${out.refund.to === 'credit' ? 'was added to your account credit' : 'will be refunded to your card'}.`
        : 'Appointment cancelled.' });
      fetchBookings();
    } catch (e: any) { setNotice({ ok: false, text: e?.response?.data?.error || 'The appointment could not be cancelled.' }); }
  };

  const fetchBookings = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await bookingsApi.getBookings(businessId, { columns: tableFilters, page: 1, limit: 50, order: isCustomer ? 'asc' : 'desc' });
      setBookings(result.data);
      setPage(1);
      setTotal(result.meta?.total || 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, tableFilters]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const loadMore = useCallback(async () => {
    if (loadingMore || bookings.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await bookingsApi.getBookings(businessId, { columns: tableFilters, page: page + 1, limit: 50, order: isCustomer ? 'asc' : 'desc' });
      setBookings((rows) => [...rows, ...result.data]);
      setPage(page + 1);
      setTotal(result.meta?.total || 0);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, tableFilters, page, loadingMore, bookings.length, total]);

  const filterOptions = useCallback(async (key: string) => {
    const values = await bookingsApi.getBookingColumnValues(businessId, key, tableFilters);
    return values.map((v) => ({
      value: v.value, count: v.count,
      label: key === 'status' ? v.value.replace('_', ' ')
        : key === 'customer_first_name' ? (v.label || 'Walk-in')
        : key === 'staff_first_name' ? (v.label || 'No staff member')
        : v.label || v.value,
    }));
  }, [businessId, tableFilters]);

  // Forms the customer still has to complete are shown before checking in; staff can always check in anyway.
  const { requestCheckIn, prompt: formsPrompt } = useCheckInFormsPrompt(businessId);

  const handleAction = async (action: string, booking: Booking) => {
    if (action === 'check-in') {
      await requestCheckIn(booking, () => handleAction('check-in-now', booking));
      return;
    }
    try {
      if (action === 'confirm') await bookingsApi.confirmBooking(booking.id, businessId);
      else if (action === 'cancel') await bookingsApi.cancelBooking(booking.id, businessId);
      else if (action === 'no-show') await bookingsApi.noShowBooking(booking.id, businessId);
      else if (action === 'check-in-now') await bookingsApi.checkInBooking(booking.id, businessId);
      else if (action === 'reset') await bookingsApi.resetBooking(booking.id, businessId);
      else if (action === 'checkout') { navigate(`/checkout?appointment=${booking.id}`); return; }
      fetchBookings();
    } catch { /* silent */ }
  };

  const allColumns = [
    { key: 'booking_reference', header: 'Ref', width: '120px', sortable: true },
    {
      key: 'customer_first_name', header: 'Customer', sortable: true,
      render: (_: any, row: Booking) => row.customer_first_name ? `${row.customer_first_name} ${row.customer_last_name}` : (row as any).walk_in_name || 'Walk-in',
    },
    { key: 'service_name', header: 'Service', sortable: true },
    {
      key: 'start_time', header: 'Date/Time', sortable: true, filter: 'date' as const,
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
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: Booking) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.status === 'pending' && <ActionBtn label="Confirm" onClick={() => handleAction('confirm', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="Check-in" onClick={() => handleAction('check-in', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="Cancel" onClick={() => handleAction('cancel', row)} />}
          {row.status === 'confirmed' && <ActionBtn label="No-show" onClick={() => setPendingNoShow(row)} />}
          {row.status === 'checked_in' && <ActionBtn label="Check-out" onClick={() => handleAction('checkout', row)} />}
          {row.status === 'checked_in' && <ActionBtn label="Reset" onClick={() => handleAction('reset', row)} />}
        </div>
      ),
    },
  ];
  const customerActions = {
    key: 'actions', header: '', filter: false as const,
    render: (_: any, row: Booking) => customerMayCancel(row)
      ? <ActionBtn label="Cancel" onClick={() => setToCancel(row)} />
      : null,
  };
  const columns = isCustomer
    ? [...allColumns.filter((c) => c.key !== 'customer_first_name' && c.key !== 'actions'), customerActions]
    : allColumns;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{isCustomer ? 'My Bookings' : 'Appointments'}</h1>
        <div style={{ display: isCustomer ? 'none' : 'flex', gap: 'var(--space-sm)' }}>
          <button style={styles.navBtn} onClick={() => navigate('/bookings/new')}>New Appointment</button>
          <button style={styles.navBtn} onClick={() => navigate('/checkout?new=true')}>New Sale</button>
          <button style={styles.navBtn} onClick={() => navigate('/orders')}>Orders</button>
          <button style={styles.navBtn} onClick={() => navigate('/bookings/calendar')}>Calendar</button>
        </div>
      </div>

      {isCustomer && cancelSettings && (
        <p style={styles.policy}>
          {cancelSettings.customer_cancel_enabled
            ? `You can cancel an appointment here up to ${cancelSettings.customer_cancel_hours} hours before it starts. A visit you paid in advance is returned ${cancelSettings.cancel_refund_to === 'credit' ? 'as account credit' : 'to your card'}.`
            : 'To cancel an appointment, please contact the business.'}
        </p>
      )}
      {notice && <p style={{ ...styles.policy, color: notice.ok ? 'var(--color-success)' : 'var(--color-error)' }} role="status">{notice.text}</p>}

      <Table columns={columns} data={bookings} loading={loading} emptyMessage="No bookings found" mobileCardMode clientSort onRowClick={isCustomer ? undefined : (row) => navigate(`/bookings/${row.id}/edit`)}
        filters={tableFilters} onFiltersChange={setTableFilters} filterOptions={filterOptions}
        onLoadMore={loadMore} hasMore={bookings.length < total} loadingMore={loadingMore} />

      {formsPrompt}

      <ConfirmDialog
        open={!!pendingNoShow}
        title="Mark as No-Show"
        message={
          pendingNoShow?.no_show_fee && pendingNoShow.no_show_fee > 0
            ? `This will cancel the appointment and charge the customer a no-show fee of ${formatCurrency(pendingNoShow.no_show_fee)} to their card on file. Proceed?`
            : 'This will mark the appointment as a no-show and free up the time. No fee is configured for this service, so the customer will not be charged. Proceed?'
        }
        confirmLabel={pendingNoShow?.no_show_fee && pendingNoShow.no_show_fee > 0 ? 'Charge & Mark No-Show' : 'Mark No-Show'}
        variant="destructive"
        onClose={() => setPendingNoShow(null)}
        onConfirm={() => { if (pendingNoShow) handleAction('no-show', pendingNoShow); }}
      />

      <ConfirmDialog
        open={!!toCancel}
        title="Cancel this appointment?"
        message={toCancel ? `${toCancel.service_name}, ${new Date(toCancel.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: businessTimezone })}.` : ''}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        variant="destructive"
        onClose={() => setToCancel(null)}
        onConfirm={() => { if (toCancel) customerCancel(toCancel); }}
      />

    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>{label}</button>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)' },
  policy: { margin: '0 0 var(--space-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  modalClose: { background: 'none', border: 'none', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' },
  modalBody: { marginBottom: 'var(--space-md)' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' },
  seriesItem: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' },
  seriesRef: { color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-xs)', marginLeft: 'auto' },
  cancelSeriesBtn: { background: 'var(--color-error-light)', border: '1px solid var(--color-error-light)', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'white', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any },
};
