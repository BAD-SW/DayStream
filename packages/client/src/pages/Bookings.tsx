import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCheckInFormsPrompt } from '../components/forms/useCheckInFormsPrompt';
import { FormsToCompleteModal } from '../components/forms/FormsToCompleteModal';
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
  // Appointments pane: only the chosen days are listed, starting with today (spec 51, gap 3).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangeReady, setRangeReady] = useState(isCustomer);
  // Waiting list: customers who have checked in and not started.
  const [waiting, setWaiting] = useState<bookingsApi.WaitingEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // The check-in rules said no; staff may check in anyway.
  // Forms to complete for a waiting customer, in a window over this page.
  const [formsFor, setFormsFor] = useState<bookingsApi.WaitingEntry | null>(null);
  const [overrideFor, setOverrideFor] = useState<{ booking: Booking; reason: string } | null>(null);

  const businessId = localStorage.getItem('business_id') || '';

  // Business time zone (times are shown in business-local time) plus the staff / service
  // names for the filters. One call that every business role may make — the full staff,
  // services and business endpoints are refused for front-line staff.
  useEffect(() => {
    if (!businessId || isCustomer) return;
    const today = (tz?: string) => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined }).format(new Date()); }
      catch { return new Intl.DateTimeFormat('en-CA').format(new Date()); }
    };
    bookingsApi.getBookingFilters(businessId).then((f) => {
      if (f.timezone) setBusinessTimezone(f.timezone);
      const d = today(f.timezone);
      setDateFrom(d); setDateTo(d);
    }).catch(() => {
      const d = today();
      setDateFrom(d); setDateTo(d);
    }).finally(() => setRangeReady(true));
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
    if (!rangeReady) return;
    setLoading(true);
    try {
      const result = await bookingsApi.getBookings(businessId, { columns: tableFilters, date_from: dateFrom || undefined, date_to: dateTo || undefined, page: 1, limit: 50, order: isCustomer ? 'asc' : 'desc' });
      setBookings(result.data);
      setPage(1);
      setTotal(result.meta?.total || 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, tableFilters, dateFrom, dateTo, rangeReady]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  // The list refreshes itself, so a customer who checked in on their own phone or at the kiosk shows
  // as checked in here without anyone pressing anything. Only the first page is replaced, and only
  // when staff have not scrolled for more, so nobody loses their place in a long list.
  const pageRef = useRef(1);
  pageRef.current = page;
  const refreshQuietly = useCallback(async () => {
    if (!businessId || !rangeReady || isCustomer || pageRef.current > 1) return;
    try {
      const result = await bookingsApi.getBookings(businessId, { columns: tableFilters, date_from: dateFrom || undefined, date_to: dateTo || undefined, page: 1, limit: 50, order: 'desc' });
      if (pageRef.current > 1) return;
      setBookings(result.data);
      setTotal(result.meta?.total || 0);
    } catch { /* the list keeps what it has */ }
  }, [businessId, rangeReady, isCustomer, tableFilters, dateFrom, dateTo]);

  const loadMore = useCallback(async () => {
    if (loadingMore || bookings.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await bookingsApi.getBookings(businessId, { columns: tableFilters, date_from: dateFrom || undefined, date_to: dateTo || undefined, page: page + 1, limit: 50, order: isCustomer ? 'asc' : 'desc' });
      setBookings((rows) => [...rows, ...result.data]);
      setPage(page + 1);
      setTotal(result.meta?.total || 0);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, tableFilters, dateFrom, dateTo, page, loadingMore, bookings.length, total]);

  const fetchWaiting = useCallback(async () => {
    if (!businessId || isCustomer) return;
    try { setWaiting(await bookingsApi.getWaitingList(businessId)); } catch { /* the panel keeps its last list */ }
  }, [businessId, isCustomer]);
  useEffect(() => {
    fetchWaiting();
    const refresh = window.setInterval(() => { if (!document.hidden) { fetchWaiting(); refreshQuietly(); } }, 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [fetchWaiting, refreshQuietly]);

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

  const errorText = (e: any, fallback: string) => e?.response?.data?.error || fallback;

  const handleAction = async (action: string, booking: Booking | { id: string; customer_id?: string | null }) => {
    const full = booking as Booking;
    if (action === 'check-in') {
      await requestCheckIn(booking, () => handleAction('check-in-now', booking));
      return;
    }
    setNotice(null);
    try {
      if (action === 'confirm') await bookingsApi.confirmBooking(booking.id, businessId);
      else if (action === 'cancel') await bookingsApi.cancelBooking(booking.id, businessId);
      else if (action === 'no-show') await bookingsApi.noShowBooking(booking.id, businessId);
      else if (action === 'check-in-now') await bookingsApi.checkInBooking(booking.id, businessId);
      else if (action === 'check-in-anyway') await bookingsApi.checkInBooking(booking.id, businessId, { reason: overrideFor?.reason || 'Checked in by staff' });
      else if (action === 'start') await bookingsApi.startBooking(booking.id, businessId);
      else if (action === 'ready') {
        const out = await bookingsApi.readyBooking(booking.id, businessId);
        setNotice({ ok: true, text: out.emailed ? 'The customer has been told, on their screen and by email.' : 'The customer has been told on their screen. They have no email address on file.' });
      }
      else if (action === 'reset') await bookingsApi.resetBooking(booking.id, businessId);
      else if (action === 'checkout') { navigate(`/checkout?appointment=${booking.id}`); return; }
      fetchBookings();
      fetchWaiting();
    } catch (e: any) {
      // The check-in rules refused (too early or late): staff decide whether to check in anyway.
      if (action === 'check-in-now' && e?.response?.data?.code === 'CHECK_IN_REFUSED') {
        setOverrideFor({ booking: full, reason: e.response.data.error || 'Outside the check-in rules' });
        return;
      }
      setNotice({ ok: false, text: errorText(e, 'That did not work. Please try again.') });
    }
  };

  // Past the start time by more than 15 minutes and still not here: the No-show button turns red.
  const isLate = (b: Booking) => b.status === 'confirmed' && now - new Date(b.start_time).getTime() > LATE_MINUTES * 60000;

  const waitedFor = (since: string) => {
    const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
    return mins < 1 ? 'Just arrived' : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
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
          {row.status === 'confirmed' && <ActionBtn label="No-show" danger={isLate(row)} onClick={() => setPendingNoShow(row)} />}
          {row.status === 'checked_in' && <ActionBtn label="Start" onClick={() => handleAction('start', row)} />}
          {(row.status === 'checked_in' || row.status === 'in_progress') && <ActionBtn label="Check-out" onClick={() => handleAction('checkout', row)} />}
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
          {/* Calendar | List (THE-23 4.1): the same switch as on the calendar */}
          <div role="group" aria-label="Calendar or list" style={{ display: 'flex', border: '1px solid var(--color-divider, #E1E5EE)', borderRadius: '8px', overflow: 'hidden', background: 'var(--color-surface, #fff)' }}>
            <button type="button" aria-pressed={false} onClick={() => navigate('/bookings/calendar')} style={{ background: 'none', border: 0, padding: '0 14px', height: '36px', fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)' }}>Calendar</button>
            <button type="button" aria-pressed={true} style={{ background: 'var(--color-primary, #0F1F5C)', color: 'var(--color-primary-contrast, #fff)', border: 0, padding: '0 14px', height: '36px', fontSize: '15px', fontWeight: 600, cursor: 'default', fontFamily: 'var(--font-family)' }}>List</button>
          </div>
          <button style={styles.navBtn} onClick={() => navigate('/bookings/new')}>New Appointment</button>
          <button style={styles.navBtn} onClick={() => navigate('/checkout?new=true')}>New Sale</button>
          <button style={styles.navBtn} onClick={() => navigate('/orders')}>Orders</button>
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

      {!isCustomer && (
        <section aria-labelledby="waiting-title" style={{ ...styles.pane, ...styles.waitPane }}>
          <div style={styles.paneHead}>
            <h2 id="waiting-title" style={styles.paneTitle}>Waiting list{waiting.length > 0 ? ` (${waiting.length})` : ''}</h2>
            <span style={styles.paneHint}>Customers who have checked in and are waiting to be seen</span>
          </div>
          {waiting.length === 0 ? (
            <p style={{ ...styles.empty, paddingTop: 'var(--space-xl)' }}>Nobody is waiting.</p>
          ) : (
            <ul style={styles.waitList}>
              {waiting.map((w) => (
                <li key={w.id} style={styles.waitRow} onClick={() => navigate(`/bookings/${w.id}/edit`)}>
                  <div style={styles.waitMain}>
                    <strong>{w.customer_name}</strong>
                    <span style={styles.waitMeta}>{w.service_name}{w.staff_name ? ` with ${w.staff_name}` : ''}</span>
                  </div>
                  <div style={styles.waitTags}>
                    <span style={styles.waitTime} title={`Checked in ${new Date(w.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}`}>
                      Waiting {waitedFor(w.checked_in_at)}
                    </span>
                    {w.forms_outstanding > 0 && w.customer_id && (
                      <button type="button" style={styles.formsBtn} aria-label={`Complete forms for ${w.customer_name}`}
                        onClick={(e) => { e.stopPropagation(); setFormsFor(w); }}>
                        {`${w.forms_outstanding} form${w.forms_outstanding === 1 ? '' : 's'} to complete`}
                      </button>
                    )}
                    {w.ready_at && <Badge variant="success">Told to come in</Badge>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <ActionBtn label={w.ready_at ? 'Tell again' : 'Ready for you'} onClick={() => handleAction('ready', w)} />
                    <ActionBtn label="Start" onClick={() => handleAction('start', w)} />
                    <ActionBtn label="Check-out" onClick={() => handleAction('checkout', w)} />
                    <ActionBtn label="Reset" onClick={() => handleAction('reset', w)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="appointments-title" style={isCustomer ? undefined : { ...styles.pane, ...styles.apptPane }}>
        {!isCustomer && (
          <div style={styles.paneHead}>
            <h2 id="appointments-title" style={styles.paneTitle}>Appointments</h2>
            <div style={styles.range}>
              <label style={styles.rangeLabel}>From
                <input type="date" style={styles.dateInput} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label style={styles.rangeLabel}>To
                <input type="date" style={styles.dateInput} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <button type="button" style={styles.actionBtn} onClick={() => {
                const d = new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone }).format(new Date());
                setDateFrom(d); setDateTo(d);
              }}>Today</button>
              <button type="button" style={styles.actionBtn} onClick={() => { setDateFrom(''); setDateTo(''); }}>All dates</button>
            </div>
          </div>
        )}
      <Table columns={columns} data={bookings} loading={loading} emptyMessage="No bookings found" mobileCardMode clientSort onRowClick={isCustomer ? undefined : (row) => navigate(`/bookings/${row.id}/edit`)}
        filters={tableFilters} onFiltersChange={setTableFilters} filterOptions={filterOptions}
        onLoadMore={loadMore} hasMore={bookings.length < total} loadingMore={loadingMore} />
      </section>

      {formsPrompt}

      {formsFor && formsFor.customer_id && (
        <FormsToCompleteModal open onClose={() => setFormsFor(null)} customerId={formsFor.customer_id}
          businessId={businessId} bookingId={formsFor.id} onChanged={fetchWaiting} />
      )}

      <ConfirmDialog
        open={!!overrideFor}
        title="Check in anyway?"
        message={overrideFor ? `${overrideFor.reason}. Check ${overrideFor.booking.customer_first_name || 'this customer'} in anyway? The reason is kept on the check-in record.` : ''}
        confirmLabel="Check in anyway"
        cancelLabel="Not now"
        variant="primary"
        onClose={() => setOverrideFor(null)}
        onConfirm={() => { if (overrideFor) { const b = overrideFor.booking; handleAction('check-in-anyway', b); setOverrideFor(null); } }}
      />

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

/** A confirmed customer who is this many minutes past their start time and not checked in. */
const LATE_MINUTES = 15;

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={danger ? { ...styles.actionBtn, ...styles.lateBtn } : styles.actionBtn}
      title={danger ? `More than ${LATE_MINUTES} minutes late` : undefined}>
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)' },
  // Both panes keep a useful depth even when empty (the waiting list scrolls inside its own limit).
  waitPane: { minHeight: '260px' },
  apptPane: { minHeight: '420px' },
  // Filled red with light text, like the design system's destructive button.
  lateBtn: { background: 'var(--color-error)', color: 'var(--color-text-inverse)', borderColor: 'var(--color-error)', fontWeight: 700 },
  formsBtn: { background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-full)', padding: '2px 10px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  pane: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  paneHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' },
  paneTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  paneHint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  waitList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxHeight: 'min(45vh, 420px)', overflowY: 'auto' },
  waitRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', cursor: 'pointer' },
  waitMain: { display: 'flex', flexDirection: 'column', minWidth: '160px', color: 'var(--color-text)' },
  waitMeta: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  waitTags: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' },
  waitTime: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  range: { display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)', flexWrap: 'wrap' },
  rangeLabel: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  dateInput: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
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
  cancelSeriesBtn: { background: 'var(--color-error-solid, var(--color-error-light))', border: '1px solid var(--color-error-solid, var(--color-error-light))', borderRadius: 'var(--radius-md)', padding: '8px 16px', color: 'white', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any },
};
