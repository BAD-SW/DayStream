import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { newAppointmentPath, editAppointmentPath } from './AppointmentPage';
import { useCheckInFormsPrompt } from '../components/forms/useCheckInFormsPrompt';
import { FormsToCompleteModal } from '../components/forms/FormsToCompleteModal';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { NoShowModal } from '../components/booking/NoShowFee';
import { formatCurrency } from '../utils/currency';
import { formatDateTime, formatTime } from '../utils/format';
import * as bookingsApi from '../api/bookings';
import type { Booking } from '../api/bookings';
import { useContextManager } from '../context/ContextManager';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'neutral', confirmed: 'info', checked_in: 'success', in_progress: 'warning', completed: 'success', cancelled: 'error', no_show: 'error',
};

export function Bookings() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  // The message of a booking just saved on the New / Edit Appointment screen.
  const savedMessage = (useLocation().state as { toast?: string } | null)?.toast || '';
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
  // orderId: an open order the notice offers to collect (an uncharged no-show fee).
  const [notice, setNotice] = useState<{ ok: boolean; text: string; orderId?: string } | null>(null);
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
        ? t(out.refund.to === 'credit' ? 'bookings.notice.cancelledCredit' : 'bookings.notice.cancelledCard', { amount: formatCurrency(out.refund.amount) })
        : t('bookings.notice.cancelled') });
      fetchBookings();
    } catch (e: any) { setNotice({ ok: false, text: e?.response?.data?.error || t('bookings.notice.cancelFailed') }); }
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
      label: key === 'status' ? t(`bookings.status.${v.value}`, { defaultValue: v.value.replace('_', ' ') })
        : key === 'customer_first_name' ? (v.label || t('bookings.walkIn'))
        : key === 'staff_first_name' ? (v.label || t('bookings.noStaff'))
        : v.label || v.value,
    }));
  }, [businessId, tableFilters, t]);

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
      else if (action === 'check-in-now') await bookingsApi.checkInBooking(booking.id, businessId);
      else if (action === 'check-in-anyway') await bookingsApi.checkInBooking(booking.id, businessId, { reason: overrideFor?.reason || 'Checked in by staff' /* i18n-ignore: recorded on the check-in, not shown here */ });
      else if (action === 'start') await bookingsApi.startBooking(booking.id, businessId);
      else if (action === 'ready') {
        const out = await bookingsApi.readyBooking(booking.id, businessId);
        setNotice({ ok: true, text: out.emailed ? t('bookings.notice.readyEmailed') : t('bookings.notice.readyNoEmail') });
      }
      else if (action === 'reset') await bookingsApi.resetBooking(booking.id, businessId);
      else if (action === 'checkout') { navigate(`/checkout?appointment=${booking.id}`); return; }
      fetchBookings();
      fetchWaiting();
    } catch (e: any) {
      // The check-in rules refused (too early or late): staff decide whether to check in anyway.
      if (action === 'check-in-now' && e?.response?.data?.code === 'CHECK_IN_REFUSED') {
        setOverrideFor({ booking: full, reason: e.response.data.error || t('bookings.outsideRules') });
        return;
      }
      setNotice({ ok: false, text: errorText(e, t('bookings.notice.actionFailed')) });
    }
  };

  // Past the start time by more than 15 minutes and still not here: the No-show button turns red.
  const isLate = (b: Booking) => b.status === 'confirmed' && now - new Date(b.start_time).getTime() > LATE_MINUTES * 60000;

  const waitedFor = (since: string) => {
    const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
    return mins < 1 ? t('bookings.waited.justArrived') : mins < 60 ? t('bookings.waited.minutes', { n: mins }) : t('bookings.waited.hours', { h: Math.floor(mins / 60), m: mins % 60 });
  };
  const allColumns = [
    { key: 'booking_reference', header: t('bookings.col.ref'), width: '120px', sortable: true },
    {
      key: 'customer_first_name', header: t('bookings.col.customer'), sortable: true,
      render: (_: any, row: Booking) => row.customer_first_name ? `${row.customer_first_name} ${row.customer_last_name}` : (row as any).walk_in_name || t('bookings.walkIn'),
    },
    { key: 'service_name', header: t('bookings.col.service'), sortable: true, render: (v: string, row: Booking) => (row.addon_names
      // with add-ons: a plus after the service; the add-ons show on hover and to screen readers
      ? <span title={t('bookings.addOnsTitle', { names: row.addon_names })} aria-label={t('bookings.addOnsAria', { service: v, names: row.addon_names })}>{v} +</span>
      : v) },
    {
      key: 'start_time', header: t('bookings.col.dateTime'), sortable: true, filter: 'date' as const,
      render: (val: string) => formatDateTime(val, businessTimezone, { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      key: 'status', header: t('bookings.col.status'), sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`bookings.status.${val}`, { defaultValue: val.replace('_', ' ') })}</Badge>,
    },
    {
      key: 'staff_first_name', header: t('bookings.col.staff'), sortable: true,
      render: (_: any, row: Booking) => row.staff_first_name ? `${row.staff_first_name} ${row.staff_last_name}` : '—',
    },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: Booking) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.status === 'pending' && <ActionBtn label={t('common:confirm')} onClick={() => handleAction('confirm', row)} />}
          {row.status === 'confirmed' && <ActionBtn label={t('bookings.action.checkIn')} onClick={() => handleAction('check-in', row)} />}
          {row.status === 'confirmed' && <ActionBtn label={t('common:cancel')} onClick={() => handleAction('cancel', row)} />}
          {row.status === 'confirmed' && row.customer_id && <ActionBtn label={t('bookings.action.noShow')} danger={isLate(row)} onClick={() => setPendingNoShow(row)} />}
          {row.status === 'checked_in' && <ActionBtn label={t('bookings.action.start')} onClick={() => handleAction('start', row)} />}
          {(row.status === 'checked_in' || row.status === 'in_progress') && <ActionBtn label={t('bookings.action.checkOut')} onClick={() => handleAction('checkout', row)} />}
          {row.status === 'checked_in' && <ActionBtn label={t('bookings.action.reset')} onClick={() => handleAction('reset', row)} />}
        </div>
      ),
    },
  ];
  const customerActions = {
    key: 'actions', header: '', filter: false as const,
    render: (_: any, row: Booking) => customerMayCancel(row)
      ? <ActionBtn label={t('common:cancel')} onClick={() => setToCancel(row)} />
      : null,
  };
  const columns = isCustomer
    ? [...allColumns.filter((c) => c.key !== 'customer_first_name' && c.key !== 'actions'), customerActions]
    : allColumns;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{isCustomer ? t('bookings.title.customer') : t('bookings.title.staff')}</h1>
        {savedMessage && <span role="status" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-success)' }}>{savedMessage}</span>}
        <div style={{ display: isCustomer ? 'none' : 'flex', gap: 'var(--space-sm)' }}>
          {/* Calendar | List (THE-23 4.1): the same switch as on the calendar */}
          <div role="group" aria-label={t('bookings.calendarOrList')} style={styles.seg}>
            <button type="button" aria-pressed={false} onClick={() => navigate('/bookings/calendar')} style={styles.segBtn}>{t('bookings.calendar')}</button>
            <button type="button" aria-pressed={true} style={{ ...styles.segBtn, background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', cursor: 'default' }}>{t('bookings.list')}</button>
          </div>
          <button style={styles.navBtn} onClick={() => navigate(newAppointmentPath({}, '/bookings/list'))}>{t('bookings.newAppointment')}</button>
          <button style={styles.navBtn} onClick={() => navigate('/checkout?new=true')}>{t('bookings.newSale')}</button>
          <button style={styles.navBtn} onClick={() => navigate('/orders')}>{t('bookings.orders')}</button>
        </div>
      </div>

      {isCustomer && cancelSettings && (
        <p style={styles.policy}>
          {cancelSettings.customer_cancel_enabled
            ? t('bookings.policy.enabled', { count: cancelSettings.customer_cancel_hours, where: t(cancelSettings.cancel_refund_to === 'credit' ? 'bookings.refund.credit' : 'bookings.refund.card') })
            : t('bookings.policy.disabled')}
        </p>
      )}
      {notice && (
        <p style={{ ...styles.policy, color: notice.ok ? 'var(--color-success)' : 'var(--color-error)' }} role="status">
          {notice.text}
          {notice.orderId && <> <button type="button" style={styles.actionBtn} onClick={() => navigate(`/checkout?order=${notice.orderId}`)}>{t('bookings.notice.collectNow')}</button></>}
        </p>
      )}

      {!isCustomer && (
        <section aria-labelledby="waiting-title" style={{ ...styles.pane, ...styles.waitPane }}>
          <div style={styles.paneHead}>
            <h2 id="waiting-title" style={styles.paneTitle}>{waiting.length > 0 ? t('bookings.waiting.titleCount', { n: waiting.length }) : t('bookings.waiting.title')}</h2>
            <span style={styles.paneHint}>{t('bookings.waiting.hint')}</span>
          </div>
          {waiting.length === 0 ? (
            <p style={{ ...styles.empty, paddingTop: 'var(--space-xl)' }}>{t('bookings.waiting.nobody')}</p>
          ) : (
            <ul style={styles.waitList}>
              {waiting.map((w) => (
                <li key={w.id} style={styles.waitRow} onClick={() => navigate(editAppointmentPath(w.id, '/bookings/list'))}>
                  <div style={styles.waitMain}>
                    <strong>{w.customer_name}</strong>
                    <span style={styles.waitMeta}>{w.staff_name ? t('bookings.waiting.withStaff', { service: w.service_name, staff: w.staff_name }) : w.service_name}</span>
                  </div>
                  <div style={styles.waitTags}>
                    <span style={styles.waitTime} title={t('bookings.waiting.checkedInAt', { time: formatTime(w.checked_in_at, businessTimezone, { hour: '2-digit' }) })}>
                      {t('bookings.waiting.waiting', { time: waitedFor(w.checked_in_at) })}
                    </span>
                    {w.forms_outstanding > 0 && w.customer_id && (
                      <button type="button" style={styles.formsBtn} aria-label={t('bookings.waiting.completeFormsFor', { name: w.customer_name })}
                        onClick={(e) => { e.stopPropagation(); setFormsFor(w); }}>
                        {t('bookings.waiting.forms', { count: w.forms_outstanding })}
                      </button>
                    )}
                    {w.ready_at && <Badge variant="success">{t('bookings.waiting.toldToCome')}</Badge>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <ActionBtn label={w.ready_at ? t('bookings.action.tellAgain') : t('bookings.action.readyForYou')} onClick={() => handleAction('ready', w)} />
                    <ActionBtn label={t('bookings.action.start')} onClick={() => handleAction('start', w)} />
                    <ActionBtn label={t('bookings.action.checkOut')} onClick={() => handleAction('checkout', w)} />
                    <ActionBtn label={t('bookings.action.reset')} onClick={() => handleAction('reset', w)} />
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
            <h2 id="appointments-title" style={styles.paneTitle}>{t('bookings.title.staff')}</h2>
            <div style={styles.range}>
              <label style={styles.rangeLabel}>{t('bookings.range.from')}
                <input type="date" style={styles.dateInput} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label style={styles.rangeLabel}>{t('bookings.range.to')}
                <input type="date" style={styles.dateInput} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <button type="button" style={styles.actionBtn} onClick={() => {
                const d = new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone }).format(new Date());
                setDateFrom(d); setDateTo(d);
              }}>{t('bookings.range.today')}</button>
              <button type="button" style={styles.actionBtn} onClick={() => { setDateFrom(''); setDateTo(''); }}>{t('bookings.range.allDates')}</button>
            </div>
          </div>
        )}
      <Table columns={columns} data={bookings} loading={loading} emptyMessage={t('bookings.empty')} mobileCardMode clientSort onRowClick={isCustomer ? undefined : (row) => navigate(editAppointmentPath(row.id, '/bookings/list'))}
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
        title={t('bookings.override.title')}
        message={overrideFor ? t('bookings.override.message', { reason: overrideFor.reason, name: overrideFor.booking.customer_first_name || t('bookings.override.thisCustomer') }) : ''}
        confirmLabel={t('bookings.override.confirm')}
        cancelLabel={t('bookings.override.cancel')}
        variant="primary"
        onClose={() => setOverrideFor(null)}
        onConfirm={() => { if (overrideFor) { const b = overrideFor.booking; handleAction('check-in-anyway', b); setOverrideFor(null); } }}
      />

      <NoShowModal
        booking={pendingNoShow}
        businessId={businessId}
        onClose={() => setPendingNoShow(null)}
        onDone={(r) => { setNotice(r); fetchBookings(); fetchWaiting(); }}
      />

      <ConfirmDialog
        open={!!toCancel}
        title={t('bookings.cancel.title')}
        message={toCancel ? t('bookings.cancel.message', { service: toCancel.service_name, when: formatDateTime(toCancel.start_time, businessTimezone) }) : ''}
        confirmLabel={t('bookings.cancel.confirm')}
        cancelLabel={t('bookings.cancel.keep')}
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
  const { t } = useTranslation('portal');
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={danger ? { ...styles.actionBtn, ...styles.lateBtn } : styles.actionBtn}
      title={danger ? t('bookings.lateTitle', { n: LATE_MINUTES }) : undefined}>
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
  // Toolbar buttons and the Calendar | List switch: the same sizes as on the calendar (design tokens)
  navBtn: { display: 'inline-flex', alignItems: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', height: 'var(--button-height-sm)', padding: '0 var(--space-md)', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--button-font-weight)' as any, whiteSpace: 'nowrap' },
  seg: { display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', overflow: 'hidden', background: 'var(--color-surface)' },
  segBtn: { display: 'inline-flex', alignItems: 'center', background: 'var(--color-surface)', border: 0, height: 'calc(var(--button-height-sm) - 2px)', padding: '0 var(--space-md)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--button-font-weight)' as any, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
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
