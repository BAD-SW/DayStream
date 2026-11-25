import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import i18n from '../../i18n';
import { formatDay, formatDate } from '../../utils/format';
import * as bookingsApi from '../../api/bookings';
import * as servicesApi from '../../api/services';
import * as customersApi from '../../api/customers';
import type { ServiceVariant } from '../../api/services';
import { apiClient } from '../../api/client';
import { formatCurrency } from '../../utils/currency';
import { zonedParts, hhmm, toMin, addDays, initials } from '../../utils/zonedTime';
import './AppointmentWindow.css';
import { PaymentStep } from './PaymentStep';
import { PriceSummary } from './PriceSummary';
import { BenefitChooser } from './BenefitChooser';
import { BookingHistory } from './BookingHistory';
import { AddonPicker } from './AddonPicker';
import type { ChosenAddon } from './AddonPicker';
import { NoShowFeeChoice, useNoShowPreview, noShowOutcomeText } from './NoShowFee';
import type { BenefitRef } from '../../api/bookings';
// Bill's spec 51 pieces, moved here from the old New/Edit Booking pages
import { FormsNeededNotice } from '../forms/FormsNeededNotice';
import { ChartsPanel } from '../charts/ChartsPanel';
import { ReceiptActions } from '../ReceiptActions';
import { useClinicalAccess } from '../../utils/useClinicalAccess';
import { getSelfCheckInLink } from '../../api/selfCheckIn';

// ============================================================
// New / Edit Appointment, round 8 (DayStream Hub → Designs → New Appointment, decided 11 Nov 2026):
// 1 Customer and 2 Service on the left; 3 Date, staff & location on the right (Calendar | List);
// a navy confirm bar at the bottom. The same screen opens from + New appointment, from More options
// in the calendar popup (as a window over the calendar) and when a booking is clicked (Edit / View).
// - Customer search: first name, surname, the email before the @ (never the domain) and the phone (NA-9).
// - Location and Staff: only what is free with the other choices is listed; Location first (NA-7, NA-8).
// - Services in pages of 6 (3 rows × 2), with search; options as chips; participants for shared rooms.
// ============================================================

export interface SvcItem { id: string; name: string; category_name?: string; booking_type: string; max_capacity: number | null; default_chart_group_id?: string | null; payment_rule: servicesApi.PaymentRule; variants: ServiceVariant[] }
export interface Combo { start_time: string; end_time: string; location_id: string | null; location_name: string | null; staff_id?: string; staff_first_name?: string; staff_last_name?: string; capacity_remaining?: number }
export interface AppointmentPrefill { date?: string; time?: string | null; serviceId?: string; variantId?: string; staffId?: string; locationId?: string; customer?: any; customerId?: string; walkIn?: boolean; walkInName?: string; participants?: number }

/** A date shown in the language's own day and month names (the business's calendar day). */
const dayLabel = (date: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => formatDay(date, o);
const custName = (c: any) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.display_name || c.email || c.phone || i18n.t('calendar:appt.noNameYet') : '');
const staffName = (c: Combo) => `${c.staff_first_name || ''} ${c.staff_last_name || ''}`.trim();
const places = (s?: SvcItem) => !!s && (s.booking_type === 'shared' || s.booking_type === 'group') && (s.max_capacity || 1) > 1;

/** Active services with their active options, loaded once. */
export function useBookableServices(businessId: string) {
  const [list, setList] = useState<SvcItem[]>([]);
  useEffect(() => {
    if (!businessId) return;
    let off = false;
    servicesApi.getServices(businessId, { status: 'active', limit: 200 }).then(async (res: any) => {
      const svcs: any[] = res.data || [];
      const withV = await Promise.all(svcs.map(async (s) => {
        let vs: ServiceVariant[] = [];
        try { vs = (await servicesApi.getVariants(s.id)).filter((v) => !v.status || v.status === 'active'); } catch { vs = []; }
        return { id: s.id, name: s.name, category_name: s.category_name, booking_type: s.booking_type, max_capacity: s.max_capacity ?? null, default_chart_group_id: s.default_chart_group_id ?? null, payment_rule: (s.payment_rule ?? 'no_card') as servicesApi.PaymentRule, variants: vs };
      }));
      if (!off) setList(withV.filter((s) => s.variants.length > 0).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
    return () => { off = true; };
  }, [businessId]);
  return list;
}

// ---------- 1 Customer ----------
export function CustomerPicker({ businessId, customer, onCustomer, walk, onWalk, walkName, onWalkName, compact, disabled, startOpen }: {
  businessId: string; customer: any; onCustomer: (c: any) => void; walk: boolean; onWalk: (w: boolean) => void; walkName: string; onWalkName: (n: string) => void; compact?: boolean; disabled?: boolean;
  /** the calendar popup opens with the list (Recent) showing and the search focused, as in the hub */
  startOpen?: boolean;
}) {
  const { t } = useTranslation('calendar');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!!startOpen);
  const [list, setList] = useState<any[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [nc, setNc] = useState({ fn: '', ln: '', em: '', ph: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open || customer || walk) return;
    const timer = setTimeout(() => {
      customersApi.getCustomers(businessId, q.trim() ? { search: q.trim(), search_mode: 'booking', limit: 6 } : { limit: 4 })
        .then((r) => setList(r.data || [])).catch(() => setList([]));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, open, businessId, customer, walk]);

  const head = (
    <div className="mk-l">
      <span>{t('appt.customer')} {walk ? '' : '*'}</span>
      {!disabled && <button type="button" className="lk" onClick={() => { onWalk(!walk); onCustomer(null); setIsNew(false); }}>{walk ? t('appt.chooseCustomerInstead') : t('appt.walkIn')}</button>}
    </div>
  );
  if (walk) return <div className="mk-f">{head}<input type="text" value={walkName} onChange={(e) => onWalkName(e.target.value)} placeholder={t('appt.nameOptional')} aria-label={t('appt.walkInName')} disabled={disabled} /></div>;
  if (customer) {
    return (
      <div className="mk-f">{head}
        <div className="mk-card">
          <span className="av">{initials(custName(customer))}</span>
          <div><b>{custName(customer)}</b><small>{[customer.email, customer.phone].filter(Boolean).join(' · ')}</small>{!compact && customer.last_visit_at && <small className="last">{t('appt.lastVisit', { date: dayLabel(String(customer.last_visit_at).slice(0, 10), { day: 'numeric', month: 'short' }) })}</small>}</div>
          {!disabled && <button type="button" className="mk-x" onClick={() => { onCustomer(null); setQ(''); setOpen(true); }} aria-label={t('appt.changeCustomer')}>×</button>}
        </div>
      </div>
    );
  }
  if (isNew) {
    const ok = nc.fn.trim() && (nc.em.trim() || nc.ph.trim());
    const add = async () => {
      setMsg('');
      try {
        const c = await customersApi.createCustomer({ business_id: businessId, first_name: nc.fn.trim(), last_name: nc.ln.trim() || undefined, email: nc.em.trim() || undefined, phone: nc.ph.trim() || undefined, source: 'walk_in' });
        onCustomer(c); setIsNew(false);
      } catch (err: any) {
        const id = err?.response?.data?.details?.existing_id;
        if (id) { try { onCustomer(await customersApi.getCustomer(id, businessId)); setIsNew(false); return; } catch { /* fall through */ } }
        const e = err?.response?.data?.error; setMsg(typeof e === 'string' ? e : e?.message || t('appt.customerAddFailed'));
      }
    };
    return (
      <div className="mk-f">{head}
        <div className="mk-new">
          <b style={{ fontSize: 'var(--font-size-small)' }}>{t('appt.newCustomer')}</b>
          <div className="mk-g2">
            <input type="text" value={nc.fn} onChange={(e) => setNc({ ...nc, fn: e.target.value })} placeholder={t('appt.firstNameRequired')} aria-label={t('appt.firstName')} />
            <input type="text" value={nc.ln} onChange={(e) => setNc({ ...nc, ln: e.target.value })} placeholder={t('appt.lastName')} aria-label={t('appt.lastName')} />
            <input type="email" value={nc.em} onChange={(e) => setNc({ ...nc, em: e.target.value })} placeholder={t('appt.email')} aria-label={t('appt.email')} />
            <input type="tel" value={nc.ph} onChange={(e) => setNc({ ...nc, ph: e.target.value })} placeholder={t('appt.phone')} aria-label={t('appt.phone')} />
          </div>
          <p className="mk-hint">{t('appt.newCustomerHint')}</p>
          {msg && <p className="mk-warn">{msg}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn sec" onClick={() => setIsNew(false)}>{t('common:cancel')}</button>
            <button type="button" className="btn" disabled={!ok} onClick={add}>{t('appt.addAndSelect')}</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mk-f">{head}
      <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={t('appt.searchCustomersPlaceholder')} autoComplete="off" aria-label={t('appt.searchCustomers')} disabled={disabled} autoFocus={!!startOpen} />
      {open && (
        <div className="mk-drop" role="listbox">
          <div className="h">{q.trim() ? t('appt.found', { count: list.length }) : t('appt.recent')}</div>
          {list.map((c) => (
            <button key={c.id} type="button" role="option" onClick={() => { onCustomer(c); setOpen(false); }}>
              <span className="av">{initials(custName(c))}</span><span><b>{custName(c)}</b></span><small>{[c.email, c.phone].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
          <button type="button" className="new" onClick={() => { setIsNew(true); const parts = q.trim().split(/\s+/); setNc({ fn: parts[0] || '', ln: parts.slice(1).join(' '), em: '', ph: '' }); }}>
            <span className="av">＋</span><span>{q.trim() ? t('appt.newCustomerNamed', { name: q.trim() }) : t('appt.newCustomer')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 2 Service ----------
const SPP = 6; // services per page: 3 rows × 2 columns
export function ServicePicker({ services, serviceId, onService, compact, disabled, onlyFor }: {
  services: SvcItem[]; serviceId: string; onService: (id: string) => void; compact?: boolean; disabled?: boolean;
  /** from a staff column: only the services that person does, with Show all (hub fStaff) */
  onlyFor?: { name: string; ids: string[] } | null;
}) {
  const { t } = useTranslation('calendar');
  const [sq, setSq] = useState('');
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);
  const limit = onlyFor && !all ? onlyFor.ids : null;
  const found = services.filter((x) => (!sq.trim() || x.name.toLowerCase().includes(sq.trim().toLowerCase())) && (!limit || limit.includes(x.id)));
  const pages = Math.max(1, Math.ceil(found.length / SPP)); const pg = Math.min(page, pages - 1);
  const shown = found.slice(pg * SPP, pg * SPP + SPP);
  const sel = services.find((x) => x.id === serviceId);
  return (
    <div className="mk-f">
      <div className="mk-l">{t('appt.serviceRequired')}</div>
      {limit && <p className="mk-hint" style={{ margin: '0 0 var(--space-sm)' }}>{t('appt.servicesDoes', { name: onlyFor!.name })}{' '}<button type="button" className="lk2" onClick={() => { setAll(true); setPage(0); }}>{t('appt.showAll')}</button></p>}
      <div className="sv-top">
        <input type="text" value={sq} onChange={(e) => { setSq(e.target.value); setPage(0); }} placeholder={t('appt.searchServicesPlaceholder')} autoComplete="off" aria-label={t('appt.searchServices')} disabled={disabled} />
        <div className="sv-pager" aria-label={t('appt.servicePages')}>
          <button type="button" disabled={pg === 0 || disabled} onClick={() => setPage(pg - 1)} aria-label={t('appt.previousServices')}>‹</button>
          <span>{found.length ? `${pg + 1} / ${pages}` : '0'}</span>
          <button type="button" disabled={pg >= pages - 1 || disabled} onClick={() => setPage(pg + 1)} aria-label={t('appt.nextServices')}>›</button>
        </div>
      </div>
      <div className={`svcs${compact ? ' svcs-c' : ''}`}>
        {found.length === 0 && <p className="mk-hint">{services.length ? t('appt.noServiceMatches', { query: sq }) : t('appt.loadingServices')}</p>}
        {shown.map((x) => (
          <button key={x.id} type="button" className="svc" aria-pressed={x.id === serviceId} onClick={() => onService(x.id)} disabled={disabled}>
            {x.name}<small>{x.category_name || ''}{compact ? '' : ` · ${t('appt.fromPrice', { price: formatCurrency(Math.min(...x.variants.map((v) => v.price))) })}`}</small>
          </button>
        ))}
      </div>
      {sel && !shown.some((x) => x.id === sel.id) && <p className="mk-hint sv-picked"><Trans t={t} i18nKey="appt.selected" values={{ name: sel.name }} components={[<b key="b" />]} /></p>}
    </div>
  );
}

export function OptionChips({ svc, variantId, onVariant, disabled }: { svc?: SvcItem; variantId: string; onVariant: (id: string) => void; disabled?: boolean }) {
  const { t } = useTranslation('calendar');
  if (!svc) return null;
  return (
    <div className="mk-f">
      <div className="mk-l">{t('appt.durationOption')}</div>
      <div className="chips">
        {svc.variants.map((v) => <button key={v.id} type="button" className="ch" aria-pressed={v.id === variantId} onClick={() => onVariant(v.id)} disabled={disabled}>{v.name} <small>{formatCurrency(v.price)}</small></button>)}
      </div>
    </div>
  );
}

export function ParticipantsField({ svc, parts, onParts, ovr, onOvr, disabled }: { svc?: SvcItem; parts: number; onParts: (n: number) => void; ovr: boolean; onOvr: (b: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation('calendar');
  if (!places(svc)) return null;
  const max = Math.min(svc!.max_capacity || 1, 6);
  return (
    <div className="mk-f">
      <div className="mk-l"><span>{t('appt.participants')} <span className="mk-hint" style={{ textTransform: 'none', letterSpacing: 0 }}>{t(svc!.booking_type === 'shared' ? 'appt.sharedUpTo' : 'appt.groupUpTo', { max: svc!.max_capacity })}</span></span></div>
      <div className="chips">{Array.from({ length: max }, (_, i) => i + 1).map((n) => <button key={n} type="button" className="ch" aria-pressed={n === parts} onClick={() => onParts(n)} disabled={disabled}>{n}</button>)}</div>
      <label className="mk-hint" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}><input type="checkbox" checked={ovr} onChange={(e) => onOvr(e.target.checked)} disabled={disabled} /> {t('appt.overrideCapacity')}</label>
    </div>
  );
}

/** Combinations (time × location × staff) for a date range, in the business's time zone. */
export function useCombos(businessId: string, serviceId: string, variantId: string, from: string | null, to: string | null, parts: number) {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    if (!serviceId || !variantId || !from || !to) { setCombos([]); return; }
    let off = false;
    apiClient.get('/v1/bookings/availability/combinations', { params: { service_id: serviceId, business_id: businessId, date_from: from, date_to: to, variant_id: variantId, participant_count: parts } })
      .then((res) => { if (!off) setCombos(res.data.data?.slots || []); })
      .catch(() => { if (!off) setCombos([]); })
      .finally(() => { if (!off) setLoaded(true); });
    return () => { off = true; };
  }, [businessId, serviceId, variantId, from, to, parts]);
  return { combos, loaded };
}

// ---------- the screen ----------
// One screen, always shown as a page (/bookings/new, /bookings/:id/edit), wherever it is opened from.
export function AppointmentWindow({ businessId, timezone, mode, bookingId, prefill, onClose, onSaved }: {
  businessId: string; timezone: string; mode: 'new' | 'edit'; bookingId?: string; prefill?: AppointmentPrefill;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('calendar');
  const services = useBookableServices(businessId);
  const today = zonedParts(new Date(), timezone).date;

  const [booking, setBooking] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [customer, setCustomer] = useState<any>(prefill?.customer || null);
  const [walk, setWalk] = useState(!!prefill?.walkIn);
  const [walkName, setWalkName] = useState(prefill?.walkInName || '');
  const [serviceId, setServiceId] = useState(prefill?.serviceId || '');
  const [variantId, setVariantId] = useState(prefill?.variantId || '');
  // The add-ons chosen (spec 51, gap 15), and those the appointment has (edit), with prices as chosen.
  const [addons, setAddons] = useState<string[]>([]);
  const [keptAddons, setKeptAddons] = useState<ChosenAddon[]>([]);
  // A paid add-on being taken off (it was not available on the day): how it is refunded.
  const [removingPaid, setRemovingPaid] = useState<ChosenAddon | null>(null);
  const [paidRefundTo, setPaidRefundTo] = useState<'original' | 'account_credit' | 'none'>('original');
  const [paidReason, setPaidReason] = useState('');
  const [paidBusy, setPaidBusy] = useState(false);
  const [paidMsg, setPaidMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [parts, setParts] = useState(prefill?.participants || 1);
  const [ovr, setOvr] = useState(false);
  const [loc, setLoc] = useState<string | null>(prefill?.locationId || null);
  const [staff, setStaff] = useState<string>(prefill?.staffId || 'any');
  const [pick, setPick] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(prefill?.date || null);
  const [time, setTime] = useState<string | null>(prefill?.time || null);
  const [month, setMonth] = useState((prefill?.date || today).slice(0, 7));
  const [view, setView] = useState<'cal' | 'list'>('cal');
  const [listFrom, setListFrom] = useState(0);
  const [listDays, setListDays] = useState(4);
  const [lsq, setLsq] = useState<{ loc: string; staff: string }>({ loc: '', staff: '' });
  const [lspg, setLspg] = useState<{ loc: number; staff: number }>({ loc: 0, staff: 0 });
  const [notes, setNotes] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // New: Confirm booking becomes Next: payment, step 4 in the same window (PAY-1 A)
  // 'card': the Reservation Payment Rule "Card required" holds a saved card instead (spec 51, gap 5)
  const [step, setStep] = useState<'book' | 'pay' | 'card'>('book');
  // The membership or package that pays (spec 51, gap 19): undefined until chosen (the best one is
  // then preselected), null to pay normally. A new customer starts again.
  const [benefit, setBenefit] = useState<BenefitRef | null | undefined>(undefined);
  useEffect(() => { setBenefit(undefined); }, [customer?.id, walk]);
  // CAL-5: Cancel appointment (future) and Mark as no-show (started), in the edit window; no Delete
  const [ending, setEnding] = useState<null | 'cancel' | 'noshow'>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [preview, setPreview] = useState<{ fee: number; paid_amount: number; refund_default: 'original' | 'account_credit' } | null>(null);
  const [refundTo, setRefundTo] = useState<'none' | 'original' | 'account_credit'>('original');
  const [error, setError] = useState('');
  // spec 51: treatment chart (clinical access) and the customer's phone check-in link
  const canCharts = useClinicalAccess();
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const copyCheckInLink = async () => {
    if (!bookingId) return;
    setLinkMessage(null);
    try { await navigator.clipboard.writeText(await getSelfCheckInLink(businessId, bookingId)); setLinkMessage(t('appt.copied')); }
    catch { setLinkMessage(t('appt.copyFailed')); }
  };

  // prefilled customer by id (from the popup's More options or a link)
  useEffect(() => {
    if (prefill?.customerId && !prefill.customer) customersApi.getCustomer(prefill.customerId, businessId).then(setCustomer).catch(() => {});
  }, [prefill?.customerId, prefill?.customer, businessId]);

  // edit: load the booking and its change rules
  useEffect(() => {
    if (mode !== 'edit' || !bookingId) return;
    bookingsApi.getBooking(bookingId, businessId).then(async (bk: any) => {
      setBooking(bk);
      setServiceId(bk.service_id); setVariantId(bk.variant_id); setParts(bk.participant_count || 1);
      const had: ChosenAddon[] = (bk.addons || []).map((a: any) => ({ addon_id: a.addon_id, name: a.name, price: a.price, paid: !!a.paid, booking_addon_id: a.id }));
      setKeptAddons(had); setAddons(had.map((a) => a.addon_id));
      setNotes(bk.notes || ''); setNoteOpen(!!bk.notes);
      if (bk.staff_id) { setStaff(bk.staff_id); setPick(bk.staff_id); }
      if (bk.location_id) setLoc(bk.location_id);
      const p = zonedParts(new Date(bk.start_time), timezone);
      setDate(p.date); setTime(hhmm(p.minutes)); setMonth(p.date.slice(0, 7));
      if (bk.customer_id) { try { setCustomer(await customersApi.getCustomer(bk.customer_id, businessId)); } catch { setCustomer({ id: bk.customer_id, first_name: bk.customer_first_name, last_name: bk.customer_last_name, email: bk.customer_email }); } }
      else { setWalk(true); setWalkName(bk.walk_in_name || ''); }
    }).catch(() => setLoadError(t('appt.loadFailed')));
  }, [mode, bookingId, businessId, timezone]);

  const rules = booking?.change_rules;
  const viewOnly = mode === 'edit' && !!rules?.read_only;
  const lockCustomer = viewOnly || (mode === 'edit' && rules && !rules.can_change_customer);
  const lockOffering = viewOnly || (mode === 'edit' && rules && !rules.can_change_offering);
  const lockMove = viewOnly || (mode === 'edit' && rules && !rules.can_move);
  const lockStaff = viewOnly || (mode === 'edit' && rules && !rules.can_change_staff);

  const svc = services.find((s) => s.id === serviceId);
  const variant = svc?.variants.find((v) => v.id === variantId);
  useEffect(() => { if (svc && !svc.variants.some((v) => v.id === variantId)) setVariantId(svc.variants[0]?.id || ''); }, [svc, variantId]);

  // month colours: free times per day (for the staff member and location chosen)
  const [monthFree, setMonthFree] = useState<{ days: Record<string, string>; free: Record<string, number> } | null>(null);
  useEffect(() => {
    setMonthFree(null);
    if (!serviceId || !variantId) return;
    let off = false;
    const params: any = { business_id: businessId, service_id: serviceId, variant_id: variantId, month, participant_count: ovr ? 1 : parts };
    if (staff !== 'any') params.staff_id = staff;
    if (loc) params.location_id = loc;
    apiClient.get('/v1/bookings/availability/days', { params }).then((res) => { if (!off) setMonthFree({ days: res.data.data.days || {}, free: res.data.data.free_times || {} }); }).catch(() => {});
    return () => { off = true; };
  }, [businessId, serviceId, variantId, month, staff, loc, parts, ovr]);

  // A walk-in is already here: booked for today only (the server refuses another day too).
  const walkInToday = walk && !lockMove;
  useEffect(() => {
    if (!walkInToday || date === today) return;
    setDate(today); setMonth(today.slice(0, 7)); setTime(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkInToday, today]);

  // no day chosen yet: the first day with free times (from today)
  useEffect(() => {
    if (date || !monthFree) return;
    const first = Object.keys(monthFree.free).sort().find((d) => d >= today && (monthFree.free[d] || 0) > 0);
    if (first) setDate(first);
  }, [monthFree, date, today]);

  const { combos: dayCombosRaw, loaded: dayLoaded } = useCombos(businessId, serviceId, variantId, date, date, ovr ? 1 : parts);
  // editing: the booking's own time stays offered (its staff member is "busy" only with this booking)
  const dayCombos = useMemo(() => {
    const list = dayCombosRaw.filter((c) => zonedParts(new Date(c.start_time), timezone).date === date);
    if (booking && booking.service_id === serviceId && booking.variant_id === variantId && zonedParts(new Date(booking.start_time), timezone).date === date
      && !list.some((c) => c.start_time === new Date(booking.start_time).toISOString() && (c.staff_id || null) === (booking.staff_id || null))) {
      list.push({ start_time: new Date(booking.start_time).toISOString(), end_time: new Date(booking.end_time).toISOString(), location_id: booking.location_id ?? list[0]?.location_id ?? null, location_name: list.find((c) => c.location_id === booking.location_id)?.location_name ?? list[0]?.location_name ?? null, staff_id: booking.staff_id || undefined, staff_first_name: booking.staff_first_name, staff_last_name: booking.staff_last_name, capacity_remaining: 99 });
    }
    return list;
  }, [dayCombosRaw, booking, serviceId, variantId, date, timezone]);

  const listTo = addDays(today, listFrom + 20);
  const { combos: listCombos } = useCombos(businessId, view === 'list' ? serviceId : '', variantId, addDays(today, listFrom), listTo, ovr ? 1 : parts);

  const lhm = (iso: string) => hhmm(zonedParts(new Date(iso), timezone).minutes);
  const allLocs = new Map<string, string>();
  for (const c of [...dayCombos, ...listCombos]) if (c.location_id) allLocs.set(c.location_id, c.location_name || '');
  const multiLoc = allLocs.size > 1;
  const hasStaff = !!svc && svc.booking_type !== 'resource' && (dayCombos.some((c) => c.staff_id) || listCombos.some((c) => c.staff_id) || !!booking?.staff_id);

  // what is free with the other choices (NA-7): locations for the staff chosen, staff for the location chosen
  const forLoc = dayCombos.filter((c) => staff === 'any' || c.staff_id === staff);
  const forStaff = dayCombos.filter((c) => !multiLoc || !loc || c.location_id === loc);
  const locItems = [...allLocs.entries()].map(([id, name]) => ({ id, name, n: new Set(forLoc.filter((c) => c.location_id === id).map((c) => c.start_time)).size })).filter((x) => x.n > 0);
  const staffItems = [...new Map(forStaff.filter((c) => c.staff_id).map((c) => [c.staff_id!, staffName(c)])).entries()]
    .map(([id, name]) => ({ id, name, n: new Set(forStaff.filter((c) => c.staff_id === id).map((c) => c.start_time)).size })).sort((a, b) => a.name.localeCompare(b.name));

  // after a change, a location or staff member no longer free is dropped (only free ones are listed)
  useEffect(() => {
    if (!dayLoaded) return;
    if (staff !== 'any' && !lockStaff && !staffItems.some((x) => x.id === staff)) { setStaff('any'); setPick(null); }
    if (multiLoc && loc && !locItems.some((x) => x.id === loc)) setLoc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayLoaded, dayCombos]);

  const matches = dayCombos.filter((c) => (!multiLoc || !loc || c.location_id === loc) && (staff === 'any' || c.staff_id === staff));
  const atTime = time ? matches.filter((c) => lhm(c.start_time) === time) : [];
  const chosen = atTime.find((c) => pick && c.staff_id === pick) || atTime[0] || null;
  const needLoc = multiLoc && !loc;
  const ready = !!chosen && (walk || !!customer) && !!svc && !!variant && !needLoc && !viewOnly && (!walkInToday || date === today);

  const byTime = new Map<string, Combo[]>();
  for (const c of matches) { const k = lhm(c.start_time); byTime.set(k, [...(byTime.get(k) || []), c]); }
  const groups: Array<[string, number, number]> = [['morning', 0, 720], ['afternoon', 720, 1020], ['evening', 1020, 1440]];

  const price = variant ? variant.price * (places(svc) ? parts : 1) : 0;
  const when = chosen && variant && date ? `${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}–${hhmm(toMin(time!) + variant.duration)}` : '';
  const whoBits = chosen ? [chosen.staff_id ? staffName(chosen) : '', multiLoc ? chosen.location_name || '' : ''].filter(Boolean).join(' · ') : '';
  const cName = walk ? (walkName || t('appt.walkIn')) : custName(customer);

  const live = !!booking && ['pending', 'confirmed'].includes(booking.status);
  const startedNow = !!booking && new Date(booking.start_time).getTime() <= Date.now();
  // The no-show fee: loaded when "Mark as no-show" is opened; staff choose to charge it or not.
  const noShow = useNoShowPreview(ending === 'noshow' ? bookingId ?? null : null, businessId);
  const [noShowCharge, setNoShowCharge] = useState(true);
  const openCancel = async () => {
    setEnding('cancel'); setError('');
    try { const p = await bookingsApi.getCancelPreview(bookingId!, businessId); setPreview(p); setRefundTo(p.paid_amount > 0 ? (p.refund_default === 'account_credit' && !booking?.customer_id ? 'original' : p.refund_default) : 'none'); } catch { setPreview({ fee: 0, paid_amount: 0, refund_default: 'original' }); setRefundTo('none'); }
  };
  const endBooking = async () => {
    setSaving(true); setError('');
    try {
      if (ending === 'cancel') {
        const r = await bookingsApi.cancelBooking(bookingId!, businessId, cancelReason || undefined, preview && preview.paid_amount > 0 ? refundTo : undefined);
        onSaved([
          t('appt.cancelled'),
          r?.cancellation_fee ? t('appt.cancelFee', { fee: formatCurrency(r.cancellation_fee) }) : '',
          r?.refund ? t(r.refund.to === 'account_credit' ? 'appt.cancelRefundedCredit' : 'appt.cancelRefunded', { amount: formatCurrency(r.refund.amount) }) : '',
        ].filter(Boolean).join(' · '));
      } else {
        const r = await bookingsApi.noShowBooking(bookingId!, businessId, noShowCharge);
        onSaved(noShowOutcomeText(r.fee));
      }
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || t('appt.endFailed'));
    } finally { setSaving(false); }
  };

  // A paid add-on taken off (spec 51, gap 15): refunded now as chosen; the appointment's add-ons follow.
  const removePaidAddon = async () => {
    if (!removingPaid?.booking_addon_id || !bookingId) return;
    setPaidBusy(true); setPaidMsg(null);
    try {
      const r = await bookingsApi.removePaidAddon(bookingId, businessId, removingPaid.booking_addon_id, paidRefundTo, paidReason || undefined);
      const had: ChosenAddon[] = r.addons.map((a) => ({ addon_id: a.addon_id, name: a.name, price: a.price, paid: !!a.paid, booking_addon_id: a.id }));
      setKeptAddons(had);
      setAddons((cur) => cur.filter((id) => id !== removingPaid.addon_id));
      const amount = r.refund?.amount ? formatCurrency(r.refund.amount) : null;
      const name = removingPaid.name;
      setPaidMsg({ ok: true, text: amount
        ? t(paidRefundTo === 'account_credit' ? 'removeAddon.doneRefundedCredit' : 'removeAddon.doneRefundedPayment', { name, amount })
        : t(paidRefundTo === 'none' ? 'removeAddon.doneNotRefunded' : 'removeAddon.done', { name }) });
      setRemovingPaid(null);
    } catch (err: any) {
      const e = err?.response?.data?.error; setPaidMsg({ ok: false, text: typeof e === 'string' ? e : t('removeAddon.failed') });
    } finally { setPaidBusy(false); }
  };

  const save = async () => {
    if (!ready || !chosen) return;
    setSaving(true); setError('');
    try {
      if (mode === 'new') {
        await bookingsApi.createBooking({
          business_id: businessId, customer_id: walk ? undefined : customer.id, walk_in_name: walk ? (walkName || 'Walk-in') : undefined,
          service_id: serviceId, variant_id: variantId, staff_id: chosen.staff_id || undefined, start_time: chosen.start_time,
          notes: notes || undefined, participant_count: parts, override_rules: ovr, location_id: chosen.location_id || undefined,
          ...(!walk && benefit ? { benefit } : {}),
          ...(addons.length ? { addons } : {}),
        });
        onSaved(chosen.staff_id
          ? t('appt.reservationSavedWith', { service: svc!.name, when, staff: staffName(chosen) })
          : t('appt.reservationSaved', { service: svc!.name, when }));
      } else {
        const data: any = { notes: notes || null };
        if (!lockOffering) { data.service_id = serviceId; data.variant_id = variantId; data.participant_count = parts; }
        if (!lockMove) { data.start_time = chosen.start_time; if (chosen.location_id) data.location_id = chosen.location_id; }
        if (!lockStaff) data.staff_id = chosen.staff_id || null;
        if (!lockCustomer) { if (walk) { data.customer_id = null; data.walk_in_name = walkName || 'Walk-in'; } else data.customer_id = customer.id; }
        if (!walk && benefit !== undefined) data.benefit = benefit;
        data.addons = addons;
        const saved = await bookingsApi.updateBooking(bookingId!, businessId, data);
        if (saved?.addons_error) { setError(t('appt.addonsNotChanged', { error: saved.addons_error })); return; }
        if (saved?.benefit_error) { setError(t('appt.benefitError', { error: saved.benefit_error })); return; }
        onSaved(t('appt.appointmentSaved', { service: svc!.name, when }));
      }
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || t('appt.saveFailed'));
    } finally { setSaving(false); }
  };

  // month grid
  const first = new Date(month + '-01T12:00:00Z');
  const lead = (first.getUTCDay() + 6) % 7;
  const nDays = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const shiftMonth = (n: number) => { const d = new Date(month + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };

  const title3 = hasStaff && multiLoc ? t('appt.title3.staffLocation') : hasStaff ? t('appt.title3.staff') : multiLoc ? t('appt.title3.location') : t('appt.title3.time');
  const statusText = (s: string) => t(`status.${s}`, { defaultValue: s.replace('_', ' ') });
  const head = viewOnly ? <>{t('appt.viewAppointment')} <small>{cName} · {statusText(String(booking?.status || ''))}</small></> 
    : mode === 'edit' ? <>{t('appt.editAppointment')} <small>{cName}</small></> : <>{t('appt.newAppointment')}</>;

  // Location / Staff boxes: search and pages when there are more than fit (2 rows; 4 per row alone, 2 per row side by side)
  const lsCol = (kind: 'loc' | 'staff', all: Array<{ id: string; name: string; n: number }>) => {
    const cur = kind === 'loc' ? loc : staff;
    const perPage = multiLoc && hasStaff ? 6 : 8;
    const q = lsq[kind].trim().toLowerCase();
    const found = all.filter((x) => !q || x.name.toLowerCase().includes(q));
    const big = all.length > perPage;
    const pages = Math.max(1, Math.ceil(found.length / perPage)); const p = Math.min(lspg[kind], pages - 1);
    const items = big ? found.slice(p * perPage, p * perPage + perPage) : found;
    const selOff = cur && cur !== 'any' && !items.some((x) => x.id === cur) ? all.find((x) => x.id === cur) : null;
    return (
      <div className="lscol">
        <div className="lscol-h">
          <span className="q-lab">{kind === 'loc' ? <>{t('appt.location')} <b>*</b></> : t('appt.staff')} · {t('appt.availableCount', { count: all.length })}</span>
          {kind === 'loc' && !cur ? <span className="ls-need">{t('appt.required')}</span> : kind === 'staff' ? <button type="button" className="ch" aria-pressed={staff === 'any'} onClick={() => { setStaff('any'); setPick(null); }} disabled={lockStaff}>{t('appt.anyStaff')}</button> : null}
        </div>
        {big && (
          <div className="sv-top">
            <input type="text" value={lsq[kind]} onChange={(e) => { setLsq({ ...lsq, [kind]: e.target.value }); setLspg({ ...lspg, [kind]: 0 }); }} placeholder={kind === 'loc' ? t('appt.searchLocationsPlaceholder') : t('appt.searchStaffPlaceholder')} autoComplete="off" aria-label={kind === 'loc' ? t('appt.searchLocations') : t('appt.searchStaff')} />
            <div className="sv-pager"><button type="button" disabled={p === 0} onClick={() => setLspg({ ...lspg, [kind]: p - 1 })} aria-label={t('appt.previous')}>‹</button><span>{found.length ? `${p + 1} / ${pages}` : '0'}</span><button type="button" disabled={p >= pages - 1} onClick={() => setLspg({ ...lspg, [kind]: p + 1 })} aria-label={t('appt.next')}>›</button></div>
          </div>
        )}
        <div className="ls-grid" style={{ gridTemplateColumns: `repeat(${multiLoc && hasStaff ? 2 : 4}, minmax(0, 1fr))` }}>
          {all.length === 0 && <p className="mk-hint">{kind === 'loc' ? t('appt.noLocationFree') : t('appt.nobodyFree')}</p>}
          {all.length > 0 && found.length === 0 && <p className="mk-hint">{t('appt.nothingMatches', { query: lsq[kind] })}</p>}
          {items.map((x) => (
            <button key={x.id} type="button" className={`svc lsi${kind === 'staff' ? '' : ' noav'}`} aria-pressed={x.id === cur} disabled={kind === 'staff' ? lockStaff : lockMove}
              onClick={() => { if (kind === 'loc') setLoc(x.id); else { setStaff(x.id); setPick(x.id); } }}>
              {kind === 'staff' && <span className="av">{initials(x.name)}</span>}<b>{x.name}</b><small>{t('appt.timesCount', { count: x.n })}</small>
            </button>
          ))}
        </div>
        {selOff && <p className="mk-hint sv-picked"><Trans t={t} i18nKey="appt.selected" values={{ name: selOff.name }} components={[<b key="b" />]} /></p>}
      </div>
    );
  };

  const right = !svc ? <div className="q-empty">{t('appt.chooseService')}</div> : (
    <>
      {(multiLoc || hasStaff) && (
        <div className={`lsbox${multiLoc && hasStaff ? '' : ' one'}`}>
          {multiLoc && lsCol('loc', locItems)}
          {hasStaff && (multiLoc && !loc
            ? <div className="lscol"><div className="lscol-h"><span className="q-lab">{t('appt.staff')}</span></div><div className="q-empty">{t('appt.chooseLocationFirst')}</div></div>
            : lsCol('staff', staffItems))}
        </div>
      )}
      {needLoc ? <div className="q-empty">{t('appt.chooseLocation')}</div> : view === 'cal' ? (
        <div className="q-two">
          <div className="q-cal">
            <div className="q-calh">
              <button type="button" className="arr" disabled={month <= today.slice(0, 7) || lockMove} onClick={() => shiftMonth(-1)} aria-label={t('appt.previousMonth')}>‹</button>
              <b>{dayLabel(month + '-15', { month: 'long', year: 'numeric' })}</b>
              <button type="button" className="arr" disabled={lockMove || walkInToday} onClick={() => shiftMonth(1)} aria-label={t('appt.nextMonth')}>›</button>
            </div>
            <div className="q-grid">
              {Array.from({ length: 7 }, (_, i) => <span key={i} className="q-dow">{dayLabel(addDays('2024-01-01', i), { weekday: 'short' })}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
              {Array.from({ length: nDays }, (_, i) => {
                const d = `${month}-${String(i + 1).padStart(2, '0')}`;
                if (d < today || (walkInToday && d !== today)) return <span key={d} className="q-day past" title={walkInToday && d > today ? t('appt.walkInTodayOnlyTitle') : undefined}>{i + 1}</span>;
                const n = monthFree?.free[d] || 0; const closed = monthFree?.days[d] === 'closed';
                const lvl = !monthFree ? 'none' : closed ? 'closed' : n === 0 ? 'none' : n < 6 ? 'few' : 'many';
                return (
                  <button key={d} type="button" className={`q-day ${lvl}`} aria-pressed={date === d} disabled={lockMove && date !== d}
                    title={closed ? t('appt.closed') : n ? t('appt.freeTimes', { count: n }) : t('appt.nothingFree')} onClick={() => { if (n || date === d) { setDate(d); if (!lockMove) setTime(null); } }}>
                    {i + 1}{d === today && <i>{t('appt.today')}</i>}
                  </button>
                );
              })}
            </div>
            <div className="q-legend"><span className="q-day many">8</span> {t('appt.legendMany')} <span className="q-day few">8</span> {t('appt.legendFew')} <span className="q-day none">8</span> {t('appt.legendNone')}</div>
            {walkInToday && <p className="mk-hint">{t('appt.walkInTodayOnly')}</p>}
          </div>
          {!date ? <div className="q-empty">{t('appt.chooseDay')}<br /><span className="mk-hint">{t('appt.chooseDayHint')}</span></div> : (
            <div className="q-times">
              <div className="q-timesh">{dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              {!dayLoaded ? <p className="mk-hint">{t('appt.loadingTimes')}</p> : byTime.size ? (
                <div className="tgrp">
                  {groups.map(([g, a, b]) => {
                    const ts = [...byTime.keys()].filter((tm) => toMin(tm) >= a && toMin(tm) < b).sort();
                    if (!ts.length) return null;
                    return [<span key={g + 's'}>{t(`appt.dayPart.${g}`)}</span>, (
                      <div key={g} className="chips">
                        {ts.map((tm) => {
                          const arr = byTime.get(tm)!;
                          const sub = places(svc) ? t('appt.placesCount', { count: Math.max(...arr.map((c) => c.capacity_remaining ?? 0)) }) : hasStaff && staff === 'any' ? t('appt.staffCount', { count: new Set(arr.map((c) => c.staff_id)).size }) : '';
                          return <button key={tm} type="button" className="ch q-time" aria-pressed={time === tm} disabled={lockMove && time !== tm} onClick={() => { setTime(tm); setPick(null); }}>{tm}{sub && <small>{sub}</small>}</button>;
                        })}
                      </div>
                    )];
                  })}
                </div>
              ) : <p className="mk-warn">{t('appt.nothingFreeDay')}</p>}
              {time && dayLoaded && !atTime.length && <p className="mk-warn">{t(hasStaff ? (multiLoc ? 'appt.notFreeStaffLocation' : 'appt.notFreeStaff') : (multiLoc ? 'appt.notFreeLocation' : 'appt.notFree'), { time, service: svc.name, option: variant?.name })}</p>}
              {time && hasStaff && staff === 'any' && atTime.length > 0 && (
                <div className="q-pick">
                  <span className="q-lab">{t('appt.with')}</span>
                  <div className="chips">
                    {atTime.filter((c, i, a) => a.findIndex((x) => x.staff_id === c.staff_id) === i).map((c, i) => (
                      <button key={c.staff_id} type="button" className="ch" aria-pressed={(pick || atTime[0].staff_id) === c.staff_id} disabled={lockStaff} onClick={() => setPick(c.staff_id!)}>
                        <span className="av">{initials(staffName(c))}</span>{staffName(c)} {i === 0 && <small>{t('appt.suggested')}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="q-listh">
            <b>{t('appt.nextFreeTimes')}</b>
            <label className="q-jump">{t('appt.from')} <select value={listFrom} onChange={(e) => { setListFrom(Number(e.target.value)); setListDays(4); }}>
              {[0, 7, 14, 28, 56].map((d) => <option key={d} value={d}>{d === 0 ? t('appt.today') : dayLabel(addDays(today, d))}</option>)}
            </select></label>
          </div>
          {(() => {
            const list = listCombos.filter((c) => (!multiLoc || !loc || c.location_id === loc) && (staff === 'any' || c.staff_id === staff));
            const days = [...new Set(list.map((c) => zonedParts(new Date(c.start_time), timezone).date))].filter((d) => !walkInToday || d === today).sort().slice(0, listDays);
            if (!days.length) return <p className="mk-warn">{t('appt.nothingFreeThreeWeeks')}</p>;
            return (
              <div className="q-list">
                {days.map((d) => {
                  const rows = new Map<string, Combo[]>();
                  for (const c of list.filter((x) => zonedParts(new Date(x.start_time), timezone).date === d)) { const k = `${c.staff_id || 'res'}|${c.location_id || ''}`; rows.set(k, [...(rows.get(k) || []), c]); }
                  return (
                    <div key={d} className="q-lday">
                      <div className="q-ldh">{dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}{d === today ? ` · ${t('appt.today')}` : ''}</div>
                      {[...rows.entries()].map(([k, cs]) => (
                        <div key={k} className="q-lrow">
                          <div className="q-lwho">{cs[0].staff_id ? <><span className="av">{initials(staffName(cs[0]))}</span><b>{staffName(cs[0])}</b></> : <b>{svc.name}</b>}{multiLoc && <span className="q-loc">{cs[0].location_name}</span>}</div>
                          <div className="chips">
                            {cs.map((c) => { const tm = lhm(c.start_time); return (
                              <button key={c.start_time} type="button" className="ch q-time" aria-pressed={date === d && time === tm && (!c.staff_id || pick === c.staff_id)} disabled={lockMove}
                                onClick={() => { setDate(d); setMonth(d.slice(0, 7)); setTime(tm); if (c.staff_id) setPick(c.staff_id); if (c.location_id && multiLoc) setLoc(c.location_id); setView('cal'); }}>{tm}</button>
                            ); })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <button type="button" className="btn sec" onClick={() => setListDays(listDays + 4)}>{t('appt.showMoreDays')}</button>
              </div>
            );
          })()}
        </>
      )}
    </>
  );

  const payDraft = step !== 'book' && chosen && svc && variant && date && time ? {
    customer, walk, walkName, serviceId, serviceName: svc.name, variantId, variantName: variant.name, parts, ovr,
    startIso: chosen.start_time, staffId: chosen.staff_id, locationId: chosen.location_id, notes, whenLabel: when, whoLabel: whoBits,
    benefit: walk ? null : benefit ?? null,
    addons,
  } : null;
  const body = loadError ? <p className="mk-warn">{loadError}</p> : payDraft ? (
    <PaymentStep businessId={businessId} draft={payDraft} mode={step === 'card' ? 'hold' : 'charge'}
      onBack={() => setStep('book')} onDone={onSaved} />
  ) : (
    <div className="mk-app">
      <div className="mk-title"><span>{head}</span></div>
      {viewOnly && <p className="mk-warn"><b>{t('appt.viewOnly')}</b> {rules?.reason}</p>}
      {!viewOnly && mode === 'edit' && rules?.reason && <p className="mk-warn">{rules.reason}</p>}
      <div className="nd-cols">
        <div className="q-col">
          <div className="q-sec"><div className="q-sec-h"><b className="n">1</b> {t('appt.customer')}</div><div className="q-sec-b">
            <CustomerPicker businessId={businessId} customer={customer} onCustomer={setCustomer} walk={walk} onWalk={setWalk} walkName={walkName} onWalkName={setWalkName} disabled={!!lockCustomer} />
            {!walk && customer?.id && (mode === 'edit' && bookingId
              ? <FormsNeededNotice customerId={customer.id} businessId={businessId} bookingId={bookingId} />
              : <FormsNeededNotice customerId={customer.id} businessId={businessId} serviceId={serviceId || undefined} />)}
          </div></div>
          <div className="q-sec"><div className="q-sec-h"><b className="n">2</b> {t('appt.service')}</div><div className="q-sec-b">
            <ServicePicker services={services} serviceId={serviceId} onService={(id) => { setServiceId(id); setTime(null); setStaff(prefill?.staffId && mode === 'new' ? prefill.staffId : 'any'); setPick(null); }} disabled={!!lockOffering} />
            <OptionChips svc={svc} variantId={variantId} onVariant={setVariantId} disabled={!!lockOffering} />
            <ParticipantsField svc={svc} parts={parts} onParts={setParts} ovr={ovr} onOvr={setOvr} disabled={!!lockOffering} />
            <AddonPicker businessId={businessId} serviceId={serviceId} value={addons} onChange={setAddons}
              kept={keptAddons} pruneOnLoad={mode === 'new' || (!!booking && serviceId !== booking.service_id)} disabled={viewOnly}
              onRemovePaid={mode === 'edit' && bookingId ? (a) => { setRemovingPaid(a); setPaidRefundTo('original'); setPaidReason(''); setPaidMsg(null); } : undefined} />
            {removingPaid && (
              <div className="q-endpanel" role="group" aria-label={t('removeAddon.title', { name: removingPaid.name })}>
                <b>{t('appt.removePaidQuestion', { name: removingPaid.name, price: formatCurrency(removingPaid.price) })}</b>
                <div className="mk-f">
                  <div className="mk-l">{t('removeAddon.refund')}</div>
                  <div className="chips">
                    {([['original', 'appt.refundToPayment'], ['account_credit', 'appt.refundAsCredit'], ['none', 'removeAddon.noRefund']] as const)
                      .filter(([v]) => v !== 'account_credit' || !!booking?.customer_id)
                      .map(([v, l]) => <button key={v} type="button" className="ch" aria-pressed={paidRefundTo === v} onClick={() => setPaidRefundTo(v)}>{t(l)}</button>)}
                  </div>
                </div>
                <textarea rows={2} value={paidReason} onChange={(e) => setPaidReason(e.target.value)} placeholder={t('appt.reasonPlaceholderPaid')} aria-label={t('removeAddon.reason')} />
                <p className="mk-hint">{t('appt.paidRefundNote')}</p>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn sec" disabled={paidBusy} onClick={() => setRemovingPaid(null)}>{t('removeAddon.keep')}</button>
                  <button type="button" className="btn danger" disabled={paidBusy} onClick={removePaidAddon}>{paidBusy ? t('noShow.working') : t('removeAddon.remove')}</button>
                </div>
              </div>
            )}
            {paidMsg && <p className={paidMsg.ok ? 'mk-hint' : 'mk-warn'} role="status">{paidMsg.text}</p>}
          </div></div>
          {/* Pay with a membership or package (spec 51, gap 19): as soon as a customer and a service are chosen */}
          {!walk && customer?.id && svc && variantId && (
            <div className="q-sec"><div className="q-sec-b">
              <BenefitChooser businessId={businessId} customerId={customer.id} serviceId={serviceId} variantId={variantId}
                startTime={chosen?.start_time || null} date={date || null} participants={parts} bookingId={mode === 'edit' ? bookingId : null}
                value={benefit} onChange={setBenefit} disabled={viewOnly || !!lockOffering} />
            </div></div>
          )}
          {/* What it costs, from the first choice on (spec 51, gap 5), with its add-ons (gap 15) */}
          {mode === 'new' && svc && variantId && (
            <PriceSummary businessId={businessId} customerId={walk ? null : customer?.id || null} serviceId={serviceId} variantId={variantId}
              participants={parts} rule={walk && svc.payment_rule === 'card_required' ? 'no_card' : svc.payment_rule}
              benefit={walk ? null : benefit ?? null} startTime={chosen?.start_time || null} addons={addons} />
          )}
        </div>
        <div className="q-col">
          <div className="q-sec">
            <div className="q-sec-h nd-h3">
              <span><b className="n">3</b> {title3}</span>
              {svc && <div className="vt" role="group" aria-label={t('appt.view')}><button type="button" aria-pressed={view === 'cal'} onClick={() => setView('cal')}>{t('appt.viewCalendar')}</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('appt.viewList')}</button></div>}
            </div>
            <div className="q-sec-b">{right}</div>
          </div>
        </div>
      </div>
      {mode === 'edit' && booking?.customer_id && booking.status === 'confirmed' && (
        <p className="q-hint">{t('appt.checkInLink')}{' '}
          <button type="button" className="lnk" onClick={copyCheckInLink}>{t('appt.copyLink')}</button>
          {linkMessage && <span role="status"> {linkMessage}</span>}
        </p>
      )}
      {/* Every payment made for this appointment, with its receipt (spec 51, gap 5) */}
      {mode === 'edit' && booking?.paid_orders?.length > 0 && (
        <section className="q-sec" aria-labelledby="booking-receipts-title">
          <div className="q-sec-h" id="booking-receipts-title">{t('appt.payments')}</div>
          <div className="q-sec-b" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {booking.paid_orders.map((o: { id: string; order_number: string; status: string; total_amount: number; completed_at: string | null }) => (
              <ReceiptActions key={o.id} kind="order" id={o.id} businessId={businessId}
                label={[o.order_number, formatCurrency(o.total_amount), o.completed_at ? formatDate(o.completed_at) : '', o.status !== 'completed' ? t(`checkout:orders.status.${o.status}`, { defaultValue: o.status.replace('_', ' ') }) : ''].filter(Boolean).join(' · ')} />
            ))}
          </div>
        </section>
      )}
      {mode === 'edit' && canCharts && booking?.customer_id && bookingId && (
        <section className="q-sec" aria-labelledby="booking-charts-title">
          <div className="q-sec-h" id="booking-charts-title">{t('appt.treatmentChart')}</div>
          <div className="q-sec-b"><ChartsPanel businessId={businessId} customerId={booking.customer_id} bookingId={bookingId} defaultChartGroupId={svc?.default_chart_group_id ?? null} /></div>
        </section>
      )}
      {/* Everything that happened to the appointment (spec 51, gap 18): staff only */}
      {mode === 'edit' && bookingId && <BookingHistory bookingId={bookingId} businessId={businessId} refreshKey={booking?.updated_at} />}
      {error && <p className="mk-warn" role="alert">{error}</p>}
      {mode === 'edit' && live && !ending && (
        <div className="q-end">
          {!startedNow && <button type="button" className="btn sec danger" onClick={openCancel}>{t('appt.cancelAppointment')}</button>}
          {startedNow && !!booking?.customer_id && <button type="button" className="btn sec danger" onClick={() => { setEnding('noshow'); setNoShowCharge(true); setError(''); }}>{t('appt.markNoShow')}</button>}
        </div>
      )}
      {ending && (
        <div className="q-endpanel" role="group" aria-label={ending === 'cancel' ? t('appt.cancelAppointment') : t('appt.markNoShow')}>
          {ending === 'cancel' ? (
            <>
              <b>{t('appt.cancelQuestion')}</b>
              <textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={t('appt.reasonPlaceholderCancel')} aria-label={t('removeAddon.reason')} />
              <p className="mk-hint">{!preview ? t('appt.checkingPolicy') : preview.fee > 0 ? t('appt.policyFee', { fee: formatCurrency(preview.fee) }) : t('appt.policyNoFee')}</p>
              {preview && preview.paid_amount > 0 && (
                <div className="mk-f">
                  <div className="mk-l">{t('appt.paidRefund', { amount: formatCurrency(preview.paid_amount) })}</div>
                  <div className="chips">
                    {([['original', 'appt.refundToPayment'], ['account_credit', 'appt.refundAsCredit'], ['none', 'appt.noRefund']] as const).filter(([v]) => v !== 'account_credit' || !!booking?.customer_id).map(([v, l]) => <button key={v} type="button" className="ch" aria-pressed={refundTo === v} onClick={() => setRefundTo(v)}>{t(l)}</button>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <b>{t('appt.noShowQuestion')}</b>
              <NoShowFeeChoice preview={noShow.preview} failed={noShow.failed} charge={noShowCharge} onChange={setNoShowCharge} />
            </>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
            <button type="button" className="btn sec" onClick={() => setEnding(null)}>{t('appt.keepAppointment')}</button>
            <button type="button" className="btn danger" disabled={saving || (ending === 'cancel' && !preview) || (ending === 'noshow' && !noShow.preview && !noShow.failed)} onClick={endBooking}>{saving ? t('noShow.working') : ending === 'cancel' ? t('appt.cancelAppointment') : noShowCharge && (noShow.preview?.fee ?? 0) > 0 ? t('appt.chargeAndMarkNoShow') : t('appt.markNoShow')}</button>
          </div>
        </div>
      )}
      <div className="q-confirm">
        <div className="q-ctext">
          <b>{when || t('appt.chooseDayAndTime')}</b>
          <span>{cName ? `${cName}${svc ? ` · ${svc.name} ${variant?.name || ''} · ${formatCurrency(price)}` : ''}` : t('appt.noCustomerYet')}{whoBits ? ` · ${whoBits}` : ''}</span>
        </div>
        {viewOnly ? <span /> : noteOpen
          ? <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('appt.internalNotePlaceholder')} aria-label={t('appt.internalNote')} />
          : <button type="button" className="q-note" onClick={() => setNoteOpen(true)}>{t('appt.addNote')}</button>}
        <div className="q-cbtns">
          <button type="button" className="btn ghost" onClick={onClose}>{viewOnly ? t('common:modal.close') : t('common:cancel')}</button>
          {!viewOnly && (mode === 'new'
            // Reservation Payment Rule (spec 51, gap 5): no card → save now; card required → hold a card
            // (not for a walk-in, who is already here); card charged at reservation → the payment step.
            // Paid with a membership or package: nothing to charge or keep, so saved now (owner, 23 Nov 2026).
            ? svc?.payment_rule === 'no_card' || (svc?.payment_rule === 'card_required' && walk) || (!walk && !!benefit)
              ? <button type="button" className="btn" disabled={!ready || saving} onClick={save}>{saving ? t('appt.saving') : t('appt.saveReservation')}</button>
              : svc?.payment_rule === 'card_required'
                ? <button type="button" className="btn" disabled={!ready} onClick={() => setStep('card')}>{t('appt.nextPayment')}</button>
                : <button type="button" className="btn" disabled={!ready} onClick={() => setStep('pay')}>{t('appt.nextPayment')}</button>
            : <button type="button" className="btn" disabled={!ready || saving} onClick={save}>{saving ? t('appt.saving') : t('appt.saveChanges')}</button>)}
        </div>
      </div>
    </div>
  );

  return <div className="dsa" style={{ padding: 'var(--space-lg)', maxWidth: '1240px', margin: '0 auto' }}>{body}</div>;
}
