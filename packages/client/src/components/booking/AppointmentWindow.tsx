import { useEffect, useMemo, useState } from 'react';
import * as bookingsApi from '../../api/bookings';
import * as servicesApi from '../../api/services';
import * as customersApi from '../../api/customers';
import type { ServiceVariant } from '../../api/services';
import { apiClient } from '../../api/client';
import { formatCurrency } from '../../utils/currency';
import { zonedParts, hhmm, toMin, addDays, dayLabel, initials } from '../../utils/zonedTime';
import './AppointmentWindow.css';
import { PaymentStep } from './PaymentStep';
// Bill's spec 51 pieces, moved here from the old New/Edit Booking pages
import { FormsNeededNotice } from '../forms/FormsNeededNotice';
import { ChartsPanel } from '../charts/ChartsPanel';
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

export interface SvcItem { id: string; name: string; category_name?: string; booking_type: string; max_capacity: number | null; default_chart_group_id?: string | null; variants: ServiceVariant[] }
export interface Combo { start_time: string; end_time: string; location_id: string | null; location_name: string | null; staff_id?: string; staff_first_name?: string; staff_last_name?: string; capacity_remaining?: number }
export interface AppointmentPrefill { date?: string; time?: string | null; serviceId?: string; variantId?: string; staffId?: string; locationId?: string; customer?: any; customerId?: string; walkIn?: boolean; walkInName?: string; participants?: number }

const custName = (c: any) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.display_name || c.email || c.phone || 'No name yet' : '');
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
        return { id: s.id, name: s.name, category_name: s.category_name, booking_type: s.booking_type, max_capacity: s.max_capacity ?? null, default_chart_group_id: s.default_chart_group_id ?? null, variants: vs };
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
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!!startOpen);
  const [list, setList] = useState<any[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [nc, setNc] = useState({ fn: '', ln: '', em: '', ph: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open || customer || walk) return;
    const t = setTimeout(() => {
      customersApi.getCustomers(businessId, q.trim() ? { search: q.trim(), search_mode: 'booking', limit: 6 } : { limit: 4 })
        .then((r) => setList(r.data || [])).catch(() => setList([]));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, open, businessId, customer, walk]);

  const head = (
    <div className="mk-l">
      <span>Customer {walk ? '' : '*'}</span>
      {!disabled && <button type="button" className="lk" onClick={() => { onWalk(!walk); onCustomer(null); setIsNew(false); }}>{walk ? 'Choose a customer instead' : 'Walk-in'}</button>}
    </div>
  );
  if (walk) return <div className="mk-f">{head}<input type="text" value={walkName} onChange={(e) => onWalkName(e.target.value)} placeholder="Name (optional)" aria-label="Walk-in name" disabled={disabled} /></div>;
  if (customer) {
    return (
      <div className="mk-f">{head}
        <div className="mk-card">
          <span className="av">{initials(custName(customer))}</span>
          <div><b>{custName(customer)}</b><small>{[customer.email, customer.phone].filter(Boolean).join(' · ')}</small>{!compact && customer.last_visit_at && <small className="last">Last visit {dayLabel(String(customer.last_visit_at).slice(0, 10), { day: 'numeric', month: 'short' })}</small>}</div>
          {!disabled && <button type="button" className="mk-x" onClick={() => { onCustomer(null); setQ(''); setOpen(true); }} aria-label="Change customer">×</button>}
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
        const e = err?.response?.data?.error; setMsg(typeof e === 'string' ? e : e?.message || 'The customer could not be added.');
      }
    };
    return (
      <div className="mk-f">{head}
        <div className="mk-new">
          <b style={{ fontSize: '13px' }}>New customer</b>
          <div className="mk-g2">
            <input type="text" value={nc.fn} onChange={(e) => setNc({ ...nc, fn: e.target.value })} placeholder="First name *" aria-label="First name" />
            <input type="text" value={nc.ln} onChange={(e) => setNc({ ...nc, ln: e.target.value })} placeholder="Last name" aria-label="Last name" />
            <input type="email" value={nc.em} onChange={(e) => setNc({ ...nc, em: e.target.value })} placeholder="Email" aria-label="Email" />
            <input type="tel" value={nc.ph} onChange={(e) => setNc({ ...nc, ph: e.target.value })} placeholder="Phone" aria-label="Phone" />
          </div>
          <p className="mk-hint">An email or a phone number is needed. If it matches someone, they are offered instead of a duplicate.</p>
          {msg && <p className="mk-warn">{msg}</p>}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn sec" onClick={() => setIsNew(false)}>Cancel</button>
            <button type="button" className="btn" disabled={!ok} onClick={add}>Add and select</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mk-f">{head}
      <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search name, surname, email (without @domain) or phone… or add a new customer" autoComplete="off" aria-label="Search customers" disabled={disabled} autoFocus={!!startOpen} />
      {open && (
        <div className="mk-drop" role="listbox">
          <div className="h">{q.trim() ? `${list.length} found` : 'Recent'}</div>
          {list.map((c) => (
            <button key={c.id} type="button" role="option" onClick={() => { onCustomer(c); setOpen(false); }}>
              <span className="av">{initials(custName(c))}</span><span><b>{custName(c)}</b></span><small>{[c.email, c.phone].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
          <button type="button" className="new" onClick={() => { setIsNew(true); const parts = q.trim().split(/\s+/); setNc({ fn: parts[0] || '', ln: parts.slice(1).join(' '), em: '', ph: '' }); }}>
            <span className="av">＋</span><span>New customer{q.trim() ? ` “${q.trim()}”` : ''}</span>
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
      <div className="mk-l">Service *</div>
      {limit && <p className="mk-hint" style={{ margin: '0 0 6px' }}>Services {onlyFor!.name} does · <button type="button" className="lk2" onClick={() => { setAll(true); setPage(0); }}>Show all</button></p>}
      <div className="sv-top">
        <input type="text" value={sq} onChange={(e) => { setSq(e.target.value); setPage(0); }} placeholder="Search services…" autoComplete="off" aria-label="Search services" disabled={disabled} />
        <div className="sv-pager" aria-label="Service pages">
          <button type="button" disabled={pg === 0 || disabled} onClick={() => setPage(pg - 1)} aria-label="Previous services">‹</button>
          <span>{found.length ? `${pg + 1} / ${pages}` : '0'}</span>
          <button type="button" disabled={pg >= pages - 1 || disabled} onClick={() => setPage(pg + 1)} aria-label="Next services">›</button>
        </div>
      </div>
      <div className={`svcs${compact ? ' svcs-c' : ''}`}>
        {found.length === 0 && <p className="mk-hint">{services.length ? `No service matches “${sq}”.` : 'Loading services…'}</p>}
        {shown.map((x) => (
          <button key={x.id} type="button" className="svc" aria-pressed={x.id === serviceId} onClick={() => onService(x.id)} disabled={disabled}>
            {x.name}<small>{x.category_name || ''}{compact ? '' : ` · from ${formatCurrency(Math.min(...x.variants.map((v) => v.price)))}`}</small>
          </button>
        ))}
      </div>
      {sel && !shown.some((x) => x.id === sel.id) && <p className="mk-hint sv-picked">Selected: <b>{sel.name}</b></p>}
    </div>
  );
}

export function OptionChips({ svc, variantId, onVariant, disabled }: { svc?: SvcItem; variantId: string; onVariant: (id: string) => void; disabled?: boolean }) {
  if (!svc) return null;
  return (
    <div className="mk-f">
      <div className="mk-l">Duration / option *</div>
      <div className="chips">
        {svc.variants.map((v) => <button key={v.id} type="button" className="ch" aria-pressed={v.id === variantId} onClick={() => onVariant(v.id)} disabled={disabled}>{v.name} <small>{formatCurrency(v.price)}</small></button>)}
      </div>
    </div>
  );
}

export function ParticipantsField({ svc, parts, onParts, ovr, onOvr, disabled }: { svc?: SvcItem; parts: number; onParts: (n: number) => void; ovr: boolean; onOvr: (b: boolean) => void; disabled?: boolean }) {
  if (!places(svc)) return null;
  const max = Math.min(svc!.max_capacity || 1, 6);
  return (
    <div className="mk-f">
      <div className="mk-l"><span>Participants <span className="mk-hint" style={{ textTransform: 'none', letterSpacing: 0 }}>{svc!.booking_type === 'shared' ? 'shared room' : 'group'}, up to {svc!.max_capacity}</span></span></div>
      <div className="chips">{Array.from({ length: max }, (_, i) => i + 1).map((n) => <button key={n} type="button" className="ch" aria-pressed={n === parts} onClick={() => onParts(n)} disabled={disabled}>{n}</button>)}</div>
      <label className="mk-hint" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={ovr} onChange={(e) => onOvr(e.target.checked)} disabled={disabled} /> Override capacity limit</label>
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
export function AppointmentWindow({ businessId, timezone, mode, bookingId, prefill, inWindow, onClose, onSaved }: {
  businessId: string; timezone: string; mode: 'new' | 'edit'; bookingId?: string; prefill?: AppointmentPrefill; inWindow?: boolean;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const services = useBookableServices(businessId);
  const today = zonedParts(new Date(), timezone).date;

  const [booking, setBooking] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [customer, setCustomer] = useState<any>(prefill?.customer || null);
  const [walk, setWalk] = useState(!!prefill?.walkIn);
  const [walkName, setWalkName] = useState(prefill?.walkInName || '');
  const [serviceId, setServiceId] = useState(prefill?.serviceId || '');
  const [variantId, setVariantId] = useState(prefill?.variantId || '');
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
  const [step, setStep] = useState<'book' | 'pay'>('book');
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
    try { await navigator.clipboard.writeText(await getSelfCheckInLink(businessId, bookingId)); setLinkMessage('Copied.'); }
    catch { setLinkMessage('The link could not be copied.'); }
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
      setNotes(bk.notes || ''); setNoteOpen(!!bk.notes);
      if (bk.staff_id) { setStaff(bk.staff_id); setPick(bk.staff_id); }
      if (bk.location_id) setLoc(bk.location_id);
      const p = zonedParts(new Date(bk.start_time), timezone);
      setDate(p.date); setTime(hhmm(p.minutes)); setMonth(p.date.slice(0, 7));
      if (bk.customer_id) { try { setCustomer(await customersApi.getCustomer(bk.customer_id, businessId)); } catch { setCustomer({ id: bk.customer_id, first_name: bk.customer_first_name, last_name: bk.customer_last_name, email: bk.customer_email }); } }
      else { setWalk(true); setWalkName(bk.walk_in_name || ''); }
    }).catch(() => setLoadError('The appointment could not be loaded.'));
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
  const ready = !!chosen && (walk || !!customer) && !!svc && !!variant && !needLoc && !viewOnly;

  const byTime = new Map<string, Combo[]>();
  for (const c of matches) { const k = lhm(c.start_time); byTime.set(k, [...(byTime.get(k) || []), c]); }
  const groups: Array<[string, number, number]> = [['Morning', 0, 720], ['Afternoon', 720, 1020], ['Evening', 1020, 1440]];

  const price = variant ? variant.price * (places(svc) ? parts : 1) : 0;
  const when = chosen && variant && date ? `${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}–${hhmm(toMin(time!) + variant.duration)}` : '';
  const whoBits = chosen ? [chosen.staff_id ? staffName(chosen) : '', multiLoc ? chosen.location_name || '' : ''].filter(Boolean).join(' · ') : '';
  const cName = walk ? (walkName || 'Walk-in') : custName(customer);

  const live = !!booking && ['pending', 'confirmed'].includes(booking.status);
  const startedNow = !!booking && new Date(booking.start_time).getTime() <= Date.now();
  const openCancel = async () => {
    setEnding('cancel'); setError('');
    try { const p = await bookingsApi.getCancelPreview(bookingId!, businessId); setPreview(p); setRefundTo(p.paid_amount > 0 ? (p.refund_default === 'account_credit' && !booking?.customer_id ? 'original' : p.refund_default) : 'none'); } catch { setPreview({ fee: 0, paid_amount: 0, refund_default: 'original' }); setRefundTo('none'); }
  };
  const endBooking = async () => {
    setSaving(true); setError('');
    try {
      if (ending === 'cancel') {
        const r = await bookingsApi.cancelBooking(bookingId!, businessId, cancelReason || undefined, preview && preview.paid_amount > 0 ? refundTo : undefined);
        onSaved(`Appointment cancelled${r?.cancellation_fee ? ' · fee ' + formatCurrency(r.cancellation_fee) : ''}${r?.refund ? ' · refunded ' + formatCurrency(r.refund.amount) + (r.refund.to === 'account_credit' ? ' as account credit' : '') : ''}`);
      } else {
        const r = await bookingsApi.noShowBooking(bookingId!, businessId);
        onSaved(`Marked as no-show${r?.no_show_fee ? ' · fee ' + formatCurrency(r.no_show_fee) : ''}`);
      }
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || 'It could not be done.');
    } finally { setSaving(false); }
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
        });
        onSaved(`Booking created: ${svc!.name}, ${when}${chosen.staff_id ? ' with ' + staffName(chosen) : ''}`);
      } else {
        const data: any = { notes: notes || null };
        if (!lockOffering) { data.service_id = serviceId; data.variant_id = variantId; data.participant_count = parts; }
        if (!lockMove) { data.start_time = chosen.start_time; if (chosen.location_id) data.location_id = chosen.location_id; }
        if (!lockStaff) data.staff_id = chosen.staff_id || null;
        if (!lockCustomer) { if (walk) { data.customer_id = null; data.walk_in_name = walkName || 'Walk-in'; } else data.customer_id = customer.id; }
        await bookingsApi.updateBooking(bookingId!, businessId, data);
        onSaved(`Appointment saved: ${svc!.name}, ${when}`);
      }
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || 'The appointment could not be saved.');
    } finally { setSaving(false); }
  };

  // month grid
  const first = new Date(month + '-01T12:00:00Z');
  const lead = (first.getUTCDay() + 6) % 7;
  const nDays = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const shiftMonth = (n: number) => { const d = new Date(month + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };

  const title3 = ['Date', ...(hasStaff ? ['staff'] : []), ...(multiLoc ? ['location'] : [])];
  const head = viewOnly ? <>View appointment <small>{cName} · {String(booking?.status || '').replace('_', ' ')}</small></>
    : mode === 'edit' ? <>Edit appointment <small>{cName}</small></> : <>New appointment{inWindow && <small>from the calendar</small>}</>;

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
          <span className="q-lab">{kind === 'loc' ? <>Location <b>*</b></> : 'Staff'} · {all.length} available</span>
          {kind === 'loc' && !cur ? <span className="ls-need">Required</span> : kind === 'staff' ? <button type="button" className="ch" aria-pressed={staff === 'any'} onClick={() => { setStaff('any'); setPick(null); }} disabled={lockStaff}>Any staff</button> : null}
        </div>
        {big && (
          <div className="sv-top">
            <input type="text" value={lsq[kind]} onChange={(e) => { setLsq({ ...lsq, [kind]: e.target.value }); setLspg({ ...lspg, [kind]: 0 }); }} placeholder={kind === 'loc' ? 'Search locations…' : 'Search staff…'} autoComplete="off" aria-label={kind === 'loc' ? 'Search locations' : 'Search staff'} />
            <div className="sv-pager"><button type="button" disabled={p === 0} onClick={() => setLspg({ ...lspg, [kind]: p - 1 })} aria-label="Previous">‹</button><span>{found.length ? `${p + 1} / ${pages}` : '0'}</span><button type="button" disabled={p >= pages - 1} onClick={() => setLspg({ ...lspg, [kind]: p + 1 })} aria-label="Next">›</button></div>
          </div>
        )}
        <div className="ls-grid" style={{ gridTemplateColumns: `repeat(${multiLoc && hasStaff ? 2 : 4}, minmax(0, 1fr))` }}>
          {all.length === 0 && <p className="mk-hint">{kind === 'loc' ? 'No location has free times with these choices.' : 'Nobody is free with these choices.'}</p>}
          {all.length > 0 && found.length === 0 && <p className="mk-hint">Nothing matches “{lsq[kind]}”.</p>}
          {items.map((x) => (
            <button key={x.id} type="button" className={`svc lsi${kind === 'staff' ? '' : ' noav'}`} aria-pressed={x.id === cur} disabled={kind === 'staff' ? lockStaff : lockMove}
              onClick={() => { if (kind === 'loc') setLoc(x.id); else { setStaff(x.id); setPick(x.id); } }}>
              {kind === 'staff' && <span className="av">{initials(x.name)}</span>}<b>{x.name}</b><small>{x.n} times</small>
            </button>
          ))}
        </div>
        {selOff && <p className="mk-hint sv-picked">Selected: <b>{selOff.name}</b></p>}
      </div>
    );
  };

  const right = !svc ? <div className="q-empty">Choose a service: the free days and times appear here.</div> : (
    <>
      {(multiLoc || hasStaff) && (
        <div className={`lsbox${multiLoc && hasStaff ? '' : ' one'}`}>
          {multiLoc && lsCol('loc', locItems)}
          {hasStaff && (multiLoc && !loc
            ? <div className="lscol"><div className="lscol-h"><span className="q-lab">Staff</span></div><div className="q-empty">Choose a location first: the staff free there appear here.</div></div>
            : lsCol('staff', staffItems))}
        </div>
      )}
      {needLoc ? <div className="q-empty">Choose a location: the free days and times appear here.</div> : view === 'cal' ? (
        <div className="q-two">
          <div className="q-cal">
            <div className="q-calh">
              <button type="button" className="arr" disabled={month <= today.slice(0, 7) || lockMove} onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
              <b>{dayLabel(month + '-15', { month: 'long', year: 'numeric' })}</b>
              <button type="button" className="arr" disabled={lockMove} onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
            </div>
            <div className="q-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="q-dow">{d}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
              {Array.from({ length: nDays }, (_, i) => {
                const d = `${month}-${String(i + 1).padStart(2, '0')}`;
                if (d < today) return <span key={d} className="q-day past">{i + 1}</span>;
                const n = monthFree?.free[d] || 0; const closed = monthFree?.days[d] === 'closed';
                const lvl = !monthFree ? 'none' : closed ? 'closed' : n === 0 ? 'none' : n < 6 ? 'few' : 'many';
                return (
                  <button key={d} type="button" className={`q-day ${lvl}`} aria-pressed={date === d} disabled={lockMove && date !== d}
                    title={closed ? 'Closed' : n ? `${n} free times` : 'Nothing free with these choices'} onClick={() => { if (n || date === d) { setDate(d); if (!lockMove) setTime(null); } }}>
                    {i + 1}{d === today && <i>today</i>}
                  </button>
                );
              })}
            </div>
            <div className="q-legend"><span className="q-day many">8</span> many free <span className="q-day few">8</span> a few <span className="q-day none">8</span> none</div>
          </div>
          {!date ? <div className="q-empty">Choose a day in the calendar.<br /><span className="mk-hint">Green days have many free times; amber a few.</span></div> : (
            <div className="q-times">
              <div className="q-timesh">{dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              {!dayLoaded ? <p className="mk-hint">Loading free times…</p> : byTime.size ? (
                <div className="tgrp">
                  {groups.map(([g, a, b]) => {
                    const ts = [...byTime.keys()].filter((t) => toMin(t) >= a && toMin(t) < b).sort();
                    if (!ts.length) return null;
                    return [<span key={g + 's'}>{g}</span>, (
                      <div key={g} className="chips">
                        {ts.map((t) => {
                          const arr = byTime.get(t)!;
                          const sub = places(svc) ? `${Math.max(...arr.map((c) => c.capacity_remaining ?? 0))} places` : hasStaff && staff === 'any' ? `${new Set(arr.map((c) => c.staff_id)).size} staff` : '';
                          return <button key={t} type="button" className="ch q-time" aria-pressed={time === t} disabled={lockMove && time !== t} onClick={() => { setTime(t); setPick(null); }}>{t}{sub && <small>{sub}</small>}</button>;
                        })}
                      </div>
                    )];
                  })}
                </div>
              ) : <p className="mk-warn">Nothing free that day with these choices.</p>}
              {time && dayLoaded && !atTime.length && <p className="mk-warn">{time} is not free for {svc.name} {variant?.name} with these choices. Choose another time{hasStaff ? ', staff member' : ''}{multiLoc ? ' or location' : ''}.</p>}
              {time && hasStaff && staff === 'any' && atTime.length > 0 && (
                <div className="q-pick">
                  <span className="q-lab">With</span>
                  <div className="chips">
                    {atTime.filter((c, i, a) => a.findIndex((x) => x.staff_id === c.staff_id) === i).map((c, i) => (
                      <button key={c.staff_id} type="button" className="ch" aria-pressed={(pick || atTime[0].staff_id) === c.staff_id} disabled={lockStaff} onClick={() => setPick(c.staff_id!)}>
                        <span className="av">{initials(staffName(c))}</span>{staffName(c)} {i === 0 && <small>suggested</small>}
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
            <b>Next free times</b>
            <label className="q-jump">From <select value={listFrom} onChange={(e) => { setListFrom(Number(e.target.value)); setListDays(4); }}>
              {[0, 7, 14, 28, 56].map((d) => <option key={d} value={d}>{d === 0 ? 'today' : dayLabel(addDays(today, d))}</option>)}
            </select></label>
          </div>
          {(() => {
            const list = listCombos.filter((c) => (!multiLoc || !loc || c.location_id === loc) && (staff === 'any' || c.staff_id === staff));
            const days = [...new Set(list.map((c) => zonedParts(new Date(c.start_time), timezone).date))].sort().slice(0, listDays);
            if (!days.length) return <p className="mk-warn">Nothing free with these choices in the next three weeks.</p>;
            return (
              <div className="q-list">
                {days.map((d) => {
                  const rows = new Map<string, Combo[]>();
                  for (const c of list.filter((x) => zonedParts(new Date(x.start_time), timezone).date === d)) { const k = `${c.staff_id || 'res'}|${c.location_id || ''}`; rows.set(k, [...(rows.get(k) || []), c]); }
                  return (
                    <div key={d} className="q-lday">
                      <div className="q-ldh">{dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}{d === today ? ' · today' : ''}</div>
                      {[...rows.entries()].map(([k, cs]) => (
                        <div key={k} className="q-lrow">
                          <div className="q-lwho">{cs[0].staff_id ? <><span className="av">{initials(staffName(cs[0]))}</span><b>{staffName(cs[0])}</b></> : <b>{svc.name}</b>}{multiLoc && <span className="q-loc">{cs[0].location_name}</span>}</div>
                          <div className="chips">
                            {cs.map((c) => { const t = lhm(c.start_time); return (
                              <button key={c.start_time} type="button" className="ch q-time" aria-pressed={date === d && time === t && (!c.staff_id || pick === c.staff_id)} disabled={lockMove}
                                onClick={() => { setDate(d); setMonth(d.slice(0, 7)); setTime(t); if (c.staff_id) setPick(c.staff_id); if (c.location_id && multiLoc) setLoc(c.location_id); setView('cal'); }}>{t}</button>
                            ); })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <button type="button" className="btn sec" onClick={() => setListDays(listDays + 4)}>Show more days</button>
              </div>
            );
          })()}
        </>
      )}
    </>
  );

  const payDraft = step === 'pay' && chosen && svc && variant && date && time ? {
    customer, walk, walkName, serviceId, serviceName: svc.name, variantId, variantName: variant.name, parts, ovr,
    startIso: chosen.start_time, staffId: chosen.staff_id, locationId: chosen.location_id, notes, whenLabel: when, whoLabel: whoBits,
  } : null;
  const body = loadError ? <p className="mk-warn">{loadError}</p> : payDraft ? (
    <PaymentStep businessId={businessId} draft={payDraft} onBack={() => setStep('book')} onClose={onClose} onDone={onSaved} />
  ) : (
    <div className="mk-app">
      <div className="mk-title"><span>{head}</span>{inWindow && <button type="button" className="mk-x" onClick={onClose} aria-label="Close">×</button>}</div>
      {viewOnly && <p className="mk-warn"><b>View only.</b> {rules?.reason}</p>}
      {!viewOnly && mode === 'edit' && rules?.reason && <p className="mk-warn">{rules.reason}</p>}
      <div className="nd-cols">
        <div className="q-col">
          <div className="q-sec"><div className="q-sec-h"><b className="n">1</b> Customer</div><div className="q-sec-b">
            <CustomerPicker businessId={businessId} customer={customer} onCustomer={setCustomer} walk={walk} onWalk={setWalk} walkName={walkName} onWalkName={setWalkName} disabled={!!lockCustomer} />
            {!walk && customer?.id && (mode === 'edit' && bookingId
              ? <FormsNeededNotice customerId={customer.id} businessId={businessId} bookingId={bookingId} />
              : <FormsNeededNotice customerId={customer.id} businessId={businessId} serviceId={serviceId || undefined} />)}
          </div></div>
          <div className="q-sec"><div className="q-sec-h"><b className="n">2</b> Service</div><div className="q-sec-b">
            <ServicePicker services={services} serviceId={serviceId} onService={(id) => { setServiceId(id); setTime(null); setStaff(prefill?.staffId && mode === 'new' ? prefill.staffId : 'any'); setPick(null); }} disabled={!!lockOffering} />
            <OptionChips svc={svc} variantId={variantId} onVariant={setVariantId} disabled={!!lockOffering} />
            <ParticipantsField svc={svc} parts={parts} onParts={setParts} ovr={ovr} onOvr={setOvr} disabled={!!lockOffering} />
          </div></div>
        </div>
        <div className="q-col">
          <div className="q-sec">
            <div className="q-sec-h nd-h3">
              <span><b className="n">3</b> {title3.length === 1 ? 'Date & time' : `${title3.slice(0, -1).join(', ')} & ${title3[title3.length - 1]}`}</span>
              {svc && <div className="vt" role="group" aria-label="View"><button type="button" aria-pressed={view === 'cal'} onClick={() => setView('cal')}>▦ Calendar</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ List</button></div>}
            </div>
            <div className="q-sec-b">{right}</div>
          </div>
        </div>
      </div>
      {mode === 'edit' && booking?.customer_id && booking.status === 'confirmed' && (
        <p className="q-hint">Customer's phone check-in link:{' '}
          <button type="button" className="lnk" onClick={copyCheckInLink}>Copy link</button>
          {linkMessage && <span role="status"> {linkMessage}</span>}
        </p>
      )}
      {mode === 'edit' && canCharts && booking?.customer_id && bookingId && (
        <section className="q-sec" aria-labelledby="booking-charts-title">
          <div className="q-sec-h" id="booking-charts-title">Treatment chart</div>
          <div className="q-sec-b"><ChartsPanel businessId={businessId} customerId={booking.customer_id} bookingId={bookingId} defaultChartGroupId={svc?.default_chart_group_id ?? null} /></div>
        </section>
      )}
      {error && <p className="mk-warn" role="alert">{error}</p>}
      {mode === 'edit' && live && !ending && (
        <div className="q-end">
          {!startedNow && <button type="button" className="btn sec danger" onClick={openCancel}>Cancel appointment</button>}
          {startedNow && <button type="button" className="btn sec danger" onClick={() => { setEnding('noshow'); setError(''); }}>Mark as no-show</button>}
        </div>
      )}
      {ending && (
        <div className="q-endpanel" role="group" aria-label={ending === 'cancel' ? 'Cancel appointment' : 'Mark as no-show'}>
          {ending === 'cancel' ? (
            <>
              <b>Cancel this appointment?</b>
              <textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (optional; the customer sees it in the cancellation email)" aria-label="Reason" />
              <p className="mk-hint">{!preview ? 'Checking the cancellation policy…' : preview.fee > 0 ? `Cancellation fee under the policy: ${formatCurrency(preview.fee)}.` : 'No cancellation fee under the policy.'}</p>
              {preview && preview.paid_amount > 0 && (
                <div className="mk-f">
                  <div className="mk-l">Paid {formatCurrency(preview.paid_amount)}: refund</div>
                  <div className="chips">
                    {([['original', 'To the payment'], ['account_credit', 'As account credit'], ['none', 'No refund']] as const).filter(([v]) => v !== 'account_credit' || !!booking?.customer_id).map(([v, l]) => <button key={v} type="button" className="ch" aria-pressed={refundTo === v} onClick={() => setRefundTo(v)}>{l}</button>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <b>Mark this appointment as a no-show?</b>
              <p className="mk-hint">{(variant as any)?.no_show_fee ? `The no-show fee of ${formatCurrency((variant as any).no_show_fee)} is charged to the card on file.` : 'No no-show fee is set for this option, so nothing is charged.'} The time is freed.</p>
            </>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn sec" onClick={() => setEnding(null)}>Keep appointment</button>
            <button type="button" className="btn danger" disabled={saving || (ending === 'cancel' && !preview)} onClick={endBooking}>{saving ? 'Working…' : ending === 'cancel' ? 'Cancel appointment' : 'Mark as no-show'}</button>
          </div>
        </div>
      )}
      <div className="q-confirm">
        <div className="q-ctext">
          <b>{when || 'Choose a day and a time'}</b>
          <span>{cName ? `${cName}${svc ? ` · ${svc.name} ${variant?.name || ''} · ${formatCurrency(price)}` : ''}` : 'No customer yet'}{whoBits ? ` · ${whoBits}` : ''}</span>
        </div>
        {viewOnly ? <span /> : noteOpen
          ? <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal note (optional)" aria-label="Internal note" />
          : <button type="button" className="q-note" onClick={() => setNoteOpen(true)}>+ Add a note</button>}
        <div className="q-cbtns">
          <button type="button" className="btn ghost" onClick={onClose}>{viewOnly ? 'Close' : 'Cancel'}</button>
          {!viewOnly && (mode === 'new'
            ? <button type="button" className="btn" disabled={!ready} onClick={() => setStep('pay')}>Next: payment ›</button>
            : <button type="button" className="btn" disabled={!ready || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>)}
        </div>
      </div>
    </div>
  );

  if (!inWindow) return <div className="dsa" style={{ padding: 'var(--space-lg)', maxWidth: '1240px', margin: '0 auto' }}>{body}</div>;
  return (
    <div className="dsa nd-bg" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Edit appointment' : 'New appointment'} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nd-modal">{body}</div>
    </div>
  );
}
