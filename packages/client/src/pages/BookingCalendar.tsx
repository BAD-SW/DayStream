import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import i18n, { currentLocale } from '../i18n';
import { formatDay } from '../utils/format';
import { useLocation, useNavigate } from 'react-router-dom';
import { newAppointmentPath, editAppointmentPath } from './AppointmentPage';
import * as bookingsApi from '../api/bookings';
import { CustomerPicker, ServicePicker, OptionChips, ParticipantsField, useBookableServices, useCombos } from '../components/booking/AppointmentWindow';
import type { AppointmentPrefill, SvcItem } from '../components/booking/AppointmentWindow';
import { initials } from '../utils/zonedTime';
import '../components/booking/AppointmentWindow.css';
import '../components/booking/Calendar.css';

// ============================================================
// Time axis — reflects the business's real operating hours (item 1: a business open 9am-10pm
// should show 9am-10pm on the grid, not a hardcoded window that clips early/late bookings or
// wastes space on hours the business is never open). Falls back to a sane default when hours
// aren't configured yet.
// ============================================================

export interface HourRange { start: number; end: number } // end is exclusive (e.g. 21 = up to but not including 9pm)

export const DEFAULT_HOUR_RANGE: HourRange = { start: 7, end: 21 };

export function buildHoursArray(range: HourRange): number[] {
  return Array.from({ length: Math.max(range.end - range.start, 0) }, (_, i) => range.start + i);
}

function floorHour(time: string): number {
  return parseInt(time.split(':')[0], 10);
}

function ceilHour(time: string): number {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  return m > 0 ? h + 1 : h;
}

/** Widest open span across a location's week, floored/ceiled to whole hours. Falls back to the
 *  default range if the location has no open days configured. */
export function computeHourRangeFromLocationHours(hours: Array<{ is_closed: boolean; open_time: string | null; close_time: string | null }>): HourRange {
  const openDays = hours.filter((h) => !h.is_closed && h.open_time && h.close_time);
  if (openDays.length === 0) return DEFAULT_HOUR_RANGE;
  const start = Math.min(...openDays.map((h) => floorHour(h.open_time!)));
  const end = Math.max(...openDays.map((h) => ceilHour(h.close_time!)));
  return start < end ? { start, end } : DEFAULT_HOUR_RANGE;
}

// ============================================================
// Service Colour Palette & Legend (feature 31: capacity-aware-calendar)
// ============================================================

const SERVICE_COLOR_VARS = [
  '--cal-service-color-1',
  '--cal-service-color-2',
  '--cal-service-color-3',
  '--cal-service-color-4',
  '--cal-service-color-5',
  '--cal-service-color-6',
  '--cal-service-color-7',
  '--cal-service-color-8',
] as const;

interface ServiceRef {
  id: string;
  name: string;
}

/**
 * Assigns a CSS custom property name to each unique service.
 * Services are sorted alphabetically by name so assignment is deterministic
 * within a session; wraps (modulo 8) when there are more than 8 services.
 */
/** A colour-map value as CSS: a palette variable name (--cal-service-color-N) or a colour the owner chose (#rrggbb, CAL-11). */
export const cv = (v: string) => (v.startsWith('--') ? `var(${v})` : v);

export function buildServiceColorMap(services: ServiceRef[]): Map<string, string> {
  const sorted = [...services].sort((a, b) => a.name.localeCompare(b.name));
  const map = new Map<string, string>();
  sorted.forEach((svc, i) => {
    map.set(svc.id, SERVICE_COLOR_VARS[i % SERVICE_COLOR_VARS.length]);
  });
  return map;
}

/** Distinct services referenced by a bookings array, sorted alphabetically by name. */
export function deriveServiceColumns(bookings: Array<{ service_id: string; service_name: string }>): ServiceRef[] {
  const byId = new Map<string, ServiceRef>();
  for (const bk of bookings) {
    if (!byId.has(bk.service_id)) byId.set(bk.service_id, { id: bk.service_id, name: bk.service_name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Services with bookings, minus any deselected via the quick filter. */
export function getVisibleServiceColumns(serviceColumns: ServiceRef[], selected: ServiceFilterSelection): ServiceRef[] {
  return serviceColumns.filter((s) => isServiceVisible(selected, s.id));
}

// ============================================================
// Quick Filter Bar — JIRA-quick-filter-style service toggle buttons.
// Replaces the old checkbox list (day view) and dropdown (week view) with one consistent,
// multi-select control shared by all three views. A selected/highlighted chip means that
// service's bookings are shown; 'all' (the default) means nothing is filtered out. Also serves
// as the service legend — no separate swatch list needed above it.
// ============================================================

export type ServiceFilterSelection = 'all' | Set<string>;

export function isServiceVisible(selection: ServiceFilterSelection, serviceId: string): boolean {
  return selection === 'all' || selection.has(serviceId);
}

/**
 * Pills (CAL-23, 11 Nov 2026): while All is on, clicking a service shows only that service; further
 * clicks add or remove services; removing the last one, or selecting every one, goes back to All.
 */
export function toggleServiceFilter(selection: ServiceFilterSelection, allServices: ServiceRef[], serviceId: string): ServiceFilterSelection {
  if (selection === 'all') return allServices.length <= 1 ? 'all' : new Set([serviceId]);
  const next = new Set(selection);
  if (next.has(serviceId)) next.delete(serviceId); else next.add(serviceId);
  if (next.size === 0 || next.size === allServices.length) return 'all';
  return next;
}

/** Estimated pill width from its name (swatch, padding, ~7 px per character). */
export const pillWidth = (name: string) => 48 + Math.ceil(name.length * 7.6);

/**
 * Pages of pills that fit on one line: All, then (when there is more than one page) the arrows,
 * then as many pills as fit, filled greedily so long names don't get cut off.
 */
export function pillPages(width: number, names: string[]): number[][] {
  const idx = names.map((_, i) => i);
  if (!width || names.length === 0) return [idx];
  const gap = 8, all = 60 + gap;
  if (all + names.reduce((x, n) => x + pillWidth(n) + gap, 0) <= width) return [idx];
  const room = width - all - 110;
  const pages: number[][] = []; let cur: number[] = []; let used = 0;
  for (const i of idx) {
    const w = pillWidth(names[i]) + gap;
    if (cur.length && used + w > room) { pages.push(cur); cur = []; used = 0; }
    cur.push(i); used += w;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function QuickFilterBar({
  services, selected, onChange, colorMap,
}: {
  services: ServiceRef[];
  selected: ServiceFilterSelection;
  onChange: (next: ServiceFilterSelection) => void;
  colorMap: Map<string, string>;
}) {
  const { t } = useTranslation('calendar');
  // One line of pills: All always at the left, then as many services as fit, paged with ‹ › (CAL-23)
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [services.length > 0]); // the bar only exists once there are services
  if (services.length === 0) return null;
  const chunks = pillPages(width, services.map((s) => s.name));
  const pages = chunks.length;
  const pg = Math.min(page, pages - 1);
  const shown = chunks[pg].map((i) => services[i]);
  const hiddenSelected = selected === 'all' ? 0 : [...selected].filter((id) => !shown.some((s) => s.id === id)).length;
  return (
    <div ref={ref} className="spills" role="group" aria-label={t('cal.filterByService')}>
      <button type="button" className="spill" onClick={() => onChange('all')} aria-pressed={selected === 'all'}>{t('cal.all')}</button>
      {pages > 1 && (
        <span className="spg">
          <button type="button" className="nav" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label={t('appt.previousServices')}>‹</button>
          <small>{pg + 1}/{pages}</small>
          <button type="button" className="nav" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label={t('appt.nextServices')}>›</button>
        </span>
      )}
      {shown.map((svc) => (
        <button key={svc.id} type="button" className="spill" onClick={() => onChange(toggleServiceFilter(selected, services, svc.id))} aria-pressed={selected !== 'all' && selected.has(svc.id)}>
          <span className="sdot" style={{ ['--sc' as any]: cv(colorMap.get(svc.id) || SERVICE_COLOR_VARS[0]) }} />{svc.name}
        </button>
      ))}
      {hiddenSelected > 0 && <small className="mk-hint">{t('cal.hiddenSelected', { count: hiddenSelected })}</small>}
    </div>
  );
}

/** Shows a booking's own participant count — never a shared/aggregate resource figure. Only
 *  rendered for bookings on a multi-capacity resource, where "how many of this booking" is
 *  actually informative (a plain 1-person booking doesn't need a badge saying "1"). */
export function ParticipantCountBadge({ count, capacity }: { count: number | null | undefined; capacity: number | null | undefined }) {
  const { t } = useTranslation('calendar');
  if (count == null || capacity == null || capacity <= 1) return null;
  return <span style={styles.participantBadge}>{t('cal.peopleCount', { count })}</span>;
}

// ============================================================
// Payment Status (item 3c-b): a left border stripe on the booking block — the service colour
// (fill) and payment status (border) are two independent signals, not competing for the same
// colour channel. No payment records at all reads the same as an explicit unpaid balance.
// ============================================================

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

/** A date shown in the language's own day and month names (the business's calendar day). */
const dayLabel = (date: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => formatDay(date, o);

/** A payment status, shown through calendar:cal.payment.<value>; anything else reads as unpaid. */
const paymentStatusLabel = (s: string | undefined) => i18n.t(`calendar:cal.payment.${s === 'paid' || s === 'partial' ? s : 'unpaid'}`) as string;

interface ResourceBlock {
  start_time: string;
  end_time: string;
  reason: string | null;
}

/** Resource blocks whose start falls on the given calendar day, in the given timezone. */
export function filterBlocksToDay(blocks: ResourceBlock[], dateStr: string, timezone: string): ResourceBlock[] {
  return blocks.filter((b) => new Date(b.start_time).toLocaleDateString('sv-SE', { timeZone: timezone }) === dateStr);
}

// ============================================================
// Resource Block Overlay (item 1: a business owner can carve out part of an otherwise-open day —
// e.g. a plumber visiting a specific pool 8-10am — via the resource's own schedule. The business
// hours axis stays the full open range; this overlay marks the carved-out sub-range on top of it.)
// ============================================================

export function ResourceBlockOverlay({ blocks, timezone, hourRange = DEFAULT_HOUR_RANGE }: { blocks: ResourceBlock[]; timezone: string; hourRange?: HourRange }) {
  const { t } = useTranslation('calendar');
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((b, i) => {
        const pos = getTimeRangePosition(b.start_time, b.end_time, timezone, hourRange);
        if (!pos) return null;
        const label = b.reason ? t('cal.blockedReason', { reason: b.reason }) : t('cal.blocked');
        return (
          <div key={i} data-testid="resource-block" style={{ ...styles.resourceBlockOverlay, top: `${pos.top}%`, height: `${pos.height}%` }} title={label}>
            <span style={styles.resourceBlockLabel}>{label}</span>
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// Calendar page (11 Nov 2026 design, DayStream Hub → Designs → Calendar)
// - One toolbar: Today ‹ › date · Day/Week/Month · By Service/Staff (Day) · Calendar/Grid (Month) · + New appointment
// - Second line: the service pills (shared by every view, CAL-12 / CAL-23) and, in Day, the column pages (CAL-20)
// - White / grey follows the business hours, closing days and holidays; all white when not set up (CAL-hours)
// - Day by Service: booked / what that time can take now, only where there is a booking and room left (CAL-7 b);
//   light stripes where nobody can take an empty time (CAL-21)
// - + in any free time (Day, Week) or day (Month) opens the same New booking popup, prefilled (CAL-book, CAL-4a)
// ============================================================

const ROWH = 30; // px per 30 minutes (hub)
const COL_MIN = 170; // px, narrowest Day column
const COL_MAX = 6; // Day columns per page (CAL-20)

type DayHoursEntry = { open: string; close: string } | { closed: true; reason: string };
type SlotCap = { booked: number; left: number; free_staff?: string[]; busy_other?: string[] };
type DaySvc = { id: string; name: string; booking_type: string; max_capacity: number | null; variant_id: string | null; staff_count: number };

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Local date and minutes of an instant in a timezone. */
export function zonedParts(d: Date, timezone: string): { date: string; minutes: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
}

/** UTC ISO instant of a local wall-clock date + "HH:MM" in a timezone. */
export function zonedToIso(date: string, time: string, timezone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const inTz = new Date(guess.toLocaleString('en-US', { timeZone: timezone }));
  const inUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (inUtc.getTime() - inTz.getTime())).toISOString();
}

/** Is a 30-minute cell outside the business hours of that day? Not set up (no entry): never. */
export function isOffHours(entry: DayHoursEntry | undefined, minutes: number): boolean {
  if (!entry) return false;
  if ('closed' in entry) return true;
  return minutes < toMin(entry.open) || minutes >= toMin(entry.close);
}

/**
 * What a Day-by-Service cell shows (CAL-7 b, 11 Nov 2026): the number only where there is a booking
 * and room for more (booked / booked + left); "full" when nothing more fits; "none" when nobody can
 * take an empty time (light stripes, CAL-21). A service for one at a time never shows 1/1: full.
 */
export function slotView(cap: SlotCap | undefined): { label: string | null; full: boolean; none: boolean } {
  const booked = cap?.booked || 0; const left = cap?.left || 0;
  if (booked > 0 && left > 0) return { label: `${booked}/${booked + left}`, full: false, none: false };
  if (booked > 0) return { label: null, full: true, none: false };
  return { label: null, full: false, none: left <= 0 };
}

/** Day columns per page: as many as fit at COL_MIN px, at most COL_MAX (CAL-20). */
export const columnsPerPage = (width: number) => Math.max(1, Math.min(COL_MAX, Math.floor(((width || 1100) - 60) / COL_MIN)));

interface NewBookingDraft { date: string; time: string | null; serviceId?: string; staffId?: string; colKey?: string; x: number; y: number; left?: number }

export function BookingCalendar() {
  const { t } = useTranslation('calendar');
  const navigate = useNavigate();
  const location = useLocation();
  // Coming back from the New / Edit Appointment screen: the same day, view and columns (in the address).
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [view, setView] = useState<'day' | 'week' | 'month'>(() => { const v = initial.get('view'); return v === 'week' || v === 'month' ? v : 'day'; }); // opens on today's Day view
  const [by, setBy] = useState<'service' | 'staff'>(() => (initial.get('by') === 'staff' ? 'staff' : 'service'));
  const [date, setDate] = useState(() => { const d = initial.get('date'); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10); });
  const [calendarData, setCalendarData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');
  const [reload, setReload] = useState(0);
  // The message of a booking just saved on the New / Edit Appointment screen.
  const [toast, setToast] = useState(() => (location.state as { toast?: string } | null)?.toast || '');

  const businessId = localStorage.getItem('business_id') || '';

  // One services filter for every view (CAL-12), backed by the business's active services.
  const [allServices, setAllServices] = useState<ServiceRef[]>([]);
  const [selected, setSelected] = useState<ServiceFilterSelection>('all');
  const [monthLayout, setMonthLayout] = useState<'calendar' | 'grid'>('calendar');
  // A colour per service by default; the owner's own colour when set (CAL-11)
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const colorMap = useMemo(() => { const m = buildServiceColorMap(allServices); for (const [id, col] of Object.entries(customColors)) if (m.has(id)) m.set(id, col); return m; }, [allServices, customColors]);
  // The grid runs at least 08:00–21:00 so hours outside the opening hours show grey (hub design)
  const [hourRange, setHourRange] = useState<HourRange>({ start: 8, end: 21 });
  // One location at a time when there are several (hub: LOCATION select in the toolbar)
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loc, setLoc] = useState('');

  // Day columns: pages that fit the width (CAL-20)
  const pageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [colPage, setColPage] = useState(0);
  useEffect(() => {
    const el = pageRef.current; if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [draft, setDraft] = useState<NewBookingDraft | null>(null);
  const [ghostLen, setGhostLen] = useState(30);
  const [ghostLabel, setGhostLabel] = useState('');
  // + New appointment, More options and a booking clicked open the one New / Edit Appointment screen,
  // which comes back here on the same day, view and columns.
  const here = `/bookings/calendar?date=${date}&view=${view}&by=${by}`;
  const openNew = (p: AppointmentPrefill) => navigate(newAppointmentPath({ ...p, customerId: p.customerId || p.customer?.id }, here));
  const openEdit = (id: string) => navigate(editAppointmentPath(id, here));
  const bookable = useBookableServices(businessId);

  useEffect(() => {
    if (!businessId) return;
    bookingsApi.getBookingFilters(businessId).then((f) => {
      if (f.timezone) setBusinessTimezone(f.timezone);
      if (f.location_hours && f.location_hours.length > 0) { const r = computeHourRangeFromLocationHours(f.location_hours); setHourRange({ start: Math.min(8, r.start), end: Math.max(21, r.end) }); }
      setAllServices((f.services || []).filter((s) => !s.status || s.status === 'active').map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)));
      const ls = f.locations || []; setLocations(ls); setLoc((cur) => cur || ls[0]?.id || '');
      setCustomColors(Object.fromEntries((f.services || []).filter((s) => s.calendar_color).map((s) => [s.id, s.calendar_color as string])));
    }).catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    // Month: counts for the services filtered; Week with one service: its numbers per 30 minutes (THE-23 4.3)
    const serviceIds = view === 'month' && selected !== 'all' ? [...selected] : view === 'week' && selected !== 'all' && selected.size === 1 ? [...selected] : undefined;
    bookingsApi.getCalendar(businessId, view, date, { ...(serviceIds ? { service_ids: serviceIds } : {}), ...(locations.length > 1 && loc ? { location_id: loc } : {}) })
      .then(setCalendarData)
      .catch(() => setCalendarData(null))
      .finally(() => setLoading(false));
  }, [businessId, view, date, selected, reload, loc, locations.length]);

  useEffect(() => { setColPage(0); }, [view, by, date, selected]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const navigateDate = (direction: number) => {
    setDraft(null);
    const d = new Date(date + 'T12:00:00Z');
    if (view === 'day') d.setUTCDate(d.getUTCDate() + direction);
    else if (view === 'week') d.setUTCDate(d.getUTCDate() + 7 * direction);
    else d.setUTCMonth(d.getUTCMonth() + direction);
    setDate(d.toISOString().slice(0, 10));
  };

  const dateLabel = useMemo(() => {
    const d = new Date(date + 'T12:00:00Z');
    const fmt = (x: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(currentLocale(), { ...o, timeZone: 'UTC' }).format(x);
    if (view === 'day') return `${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${date === new Date().toISOString().slice(0, 10) ? ` · ${t('cal.today')}` : ''}`;
    if (view === 'week') {
      const start = getWeekStart(date);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return fmt(d, { month: 'long', year: 'numeric' });
  }, [date, view, t]);

  const dayHours: Record<string, DayHoursEntry> = calendarData?.day_hours || {};
  const bookings: any[] = calendarData?.bookings || [];
  const visibleBookings = selected === 'all' ? bookings : bookings.filter((b) => isServiceVisible(selected, b.service_id));
  const singleService = selected !== 'all' && selected.size === 1 ? [...selected][0] : undefined;

  // Day columns
  const daySvcs: DaySvc[] = calendarData?.day_services || [];
  type DayCol = { key: string; label: string; sub?: string; serviceId?: string; staffId?: string };
  const allDayCols = useMemo<DayCol[]>(() => {
    if (view !== 'day') return [];
    if (by === 'staff') {
      const staff: Array<{ id: string; name: string }> = calendarData?.day_staff || [];
      return staff.map((s) => ({ key: 'st:' + s.id, label: s.name, staffId: s.id }));
    }
    const list = daySvcs.length ? daySvcs : allServices.map((s) => ({ ...s, booking_type: '', max_capacity: null, variant_id: null, staff_count: 0 }));
    return list.filter((s) => isServiceVisible(selected, s.id)).map((s) => ({
      key: 'sv:' + s.id, label: s.name, serviceId: s.id,
      sub: s.booking_type === 'shared' ? t('cal.sharedPlaces', { count: s.max_capacity ?? 0 }) : s.booking_type === 'group' ? t('cal.groupPlaces', { count: s.max_capacity ?? 0 }) : s.booking_type === 'resource' ? t('cal.roomOrDevice') : (s as any).staff_working != null ? t('cal.staffWorking', { count: (s as any).staff_working }) : s.staff_count ? t('cal.staffCount', { count: s.staff_count }) : undefined,
    }));
  }, [view, by, calendarData, daySvcs, allServices, selected, t]);
  const per = columnsPerPage(width);
  const colPages = Math.max(1, Math.ceil(allDayCols.length / per));
  const cp = Math.min(colPage, colPages - 1);
  const dayCols = allDayCols.slice(cp * per, cp * per + per);

  // The popup opens beside what was clicked (its column or day), so the dashed preview stays visible
  const openDraft = (d: Omit<NewBookingDraft, 'x' | 'y' | 'left'>, e?: React.MouseEvent) => {
    setGhostLen(30);
    const el = (e?.currentTarget as HTMLElement | undefined)?.closest('[data-col], .dsc-mday, td') as HTMLElement | null;
    const r = el ? el.getBoundingClientRect() : null;
    setDraft({ ...d, serviceId: d.serviceId || singleService, x: r ? r.right : e?.clientX ?? window.innerWidth / 2, left: r ? r.left : undefined, y: e?.clientY ?? 160 });
  };

  // (n) people on the box when the service takes more than one, also (1) (THE-23 4.3); never for one-person services
  const people = (bk: any) => ((bk.service_max_capacity ?? bk.resource_capacity ?? 1) > 1 ? ` (${bk.participant_count || 1})` : '');

  const seg = (_key: string, value: string, opts: Array<[string, string]>, onPick: (v: string) => void, aria: string) => (
    <div className="seg" role="group" aria-label={aria}>
      {opts.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>)}
    </div>
  );
  /** What a time cell's number means, for the tooltip. */
  const slotTip = (name: string, cap: SlotCap | undefined, v: ReturnType<typeof slotView>, m: number, short: boolean) => {
    const left = cap?.left || 0; const booked = cap?.booked || 0;
    if (v.label) {
      if (cap?.free_staff) {
        return cap.busy_other?.length
          ? t('cal.tipStaffBusy', { name, booked, left, free: cap.free_staff.join(', '), busy: cap.busy_other.join(', ') })
          : t('cal.tipStaff', { name, booked, left, free: cap.free_staff.join(', ') });
      }
      return t('cal.tipPlaces', { name, booked, total: booked + left, left });
    }
    return v.none ? t(short ? 'cal.tipNoneShort' : 'cal.tipNone', { name, time: hhmm(m) }) : '';
  };
  const ghost = draft && draft.time ? { colKey: draft.colKey || '', date: draft.date, start: toMin(draft.time), len: ghostLen, label: ghostLabel } : null;

  return (
    <div className="dsa dsc" style={styles.page} ref={pageRef}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('cal.title')}</h1>
      </div>

      <div className="ctb">
        <div className="ctb-l">
          <button type="button" className="nav" onClick={() => { setDraft(null); setDate(zonedParts(new Date(), businessTimezone).date); }}>{t('cal.todayButton')}</button>
          <button type="button" className="nav" onClick={() => navigateDate(-1)} aria-label={t('appt.previous')}>‹</button>
          <button type="button" className="nav" onClick={() => navigateDate(1)} aria-label={t('appt.next')}>›</button>
          <b>{dateLabel}</b>
        </div>
        <div className="ctb-r">
          {locations.length > 1 && (
            <label className="lab">{t('appt.location')} <select value={loc} onChange={(e) => { setDraft(null); setLoc(e.target.value); }} aria-label={t('appt.location')}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          )}
          {seg('mode', 'calendar', [['calendar', t('cal.calendar')], ['list', t('cal.list')]], (v) => { if (v === 'list') navigate('/bookings/list'); }, t('cal.calendarOrList'))}
          {seg('view', view, [['day', t('cal.day')], ['week', t('cal.week')], ['month', t('cal.month')]], (v) => { setDraft(null); setView(v as any); }, t('appt.view'))}
          {view === 'day' && <><span className="lab">{t('cal.by')}</span>{seg('by', by, [['service', t('appt.service')], ['staff', t('appt.staff')]], (v) => { setDraft(null); setBy(v as any); }, t('cal.columns'))}</>}
          {view === 'month' && seg('mo', monthLayout, [['calendar', t('cal.calendar')], ['grid', t('cal.grid')]], (v) => setMonthLayout(v as any), t('cal.monthLayout'))}
          <button type="button" className="nav" onClick={() => { setDraft(null); openNew({ date: date < zonedParts(new Date(), businessTimezone).date ? undefined : date, serviceId: singleService, locationId: locations.length > 1 ? loc : undefined }); }}>{t('cal.newAppointment')}</button>
          {/* As on the list: sell without an appointment, and look up past sales */}
          <button type="button" className="nav" onClick={() => navigate('/checkout?new=true')}>{t('cal.newSale')}</button>
          <button type="button" className="nav" onClick={() => navigate('/orders')}>{t('cal.orders')}</button>
        </div>
      </div>

      <div className="ctb2">
        <QuickFilterBar services={allServices} selected={selected} onChange={(s) => { setDraft(null); setSelected(s); }} colorMap={colorMap} />
        {view === 'day' && allDayCols.length > per && (
          <div className="cpg">
            <button type="button" className="nav" disabled={cp === 0} onClick={() => setColPage(cp - 1)} aria-label={by === 'service' ? t('appt.previousServices') : t('cal.previousStaff')}>‹</button>
            <span><Trans t={t} i18nKey={by === 'service' ? 'cal.servicesRange' : 'cal.staffRange'} values={{ from: cp * per + 1, to: Math.min(allDayCols.length, cp * per + per), total: allDayCols.length }} components={[<b key="b" />]} /></span>
            <span className="cpg-dots">{Array.from({ length: colPages }, (_, i) => <button key={i} type="button" aria-label={t('cal.page', { n: i + 1 })} aria-pressed={i === cp} onClick={() => setColPage(i)} />)}</span>
            <button type="button" className="nav" disabled={cp >= colPages - 1} onClick={() => setColPage(cp + 1)} aria-label={by === 'service' ? t('appt.nextServices') : t('cal.nextStaff')}>›</button>
          </div>
        )}
      </div>

      {loading && <p style={styles.empty}>{t('cal.loading')}</p>}

      {!loading && view === 'day' && (() => {
        const h = dayHours[date];
        if (h && 'closed' in h) return <p className="q-empty">{h.reason}.</p>;
        if (dayCols.length === 0) return <p className="q-empty">{by === 'staff' ? t('cal.noStaffWorking') : t('cal.noServiceChosen')}</p>;
        return (
          <TimeGrid
            hourRange={hourRange}
            timezone={businessTimezone}
            columns={dayCols.map((c) => {
              const colBks = visibleBookings.filter((b) => (c.serviceId ? b.service_id === c.serviceId : b.staff_id === c.staffId));
              const caps: Record<string, SlotCap> | undefined = c.serviceId ? calendarData?.slot_capacity?.[c.serviceId] : undefined;
              const svcName = c.label;
              return {
                key: c.key, date,
                header: (
                  <>
                    {c.serviceId ? <span className="sdot" style={{ ['--sc' as any]: cv(colorMap.get(c.serviceId) || SERVICE_COLOR_VARS[0]) }} /> : <span className="hav">{initials(c.label)}</span>}
                    {c.label}
                    {c.sub && <small>{c.sub}</small>}
                  </>
                ),
                bookings: colBks,
                slot: caps ? (m: number) => {
                  const cap = caps[hhmm(m)]; const v = slotView(cap);
                  const tip = slotTip(svcName, cap, v, m, false);
                  return { label: v.label, full: v.full, none: v.none, tip };
                } : undefined,
                onNew: (m: number, e: React.MouseEvent) => openDraft({ date, time: hhmm(m), serviceId: c.serviceId, staffId: c.staffId, colKey: c.key }, e),
                label: (bk: any) => (c.serviceId ? `${bk.customer_name}${people(bk)}${bk.staff_name ? ' · ' + bk.staff_name : ''}` : `${bk.customer_name} · ${bk.service_name}${bk.addon_names ? ' +' : ''}`),
              };
            })}
            dayHours={dayHours}
            colorMap={colorMap}
            onBookingClick={(id) => { setDraft(null); openEdit(id); }}
            ghost={ghost}
          />
        );
      })()}

      {!loading && view === 'week' && (() => {
        const ws = getWeekStart(date);
        const days = Array.from({ length: 7 }, (_, i) => new Date(ws.getTime() + i * 864e5).toISOString().slice(0, 10));
        return (
          <TimeGrid
            hourRange={hourRange}
            timezone={businessTimezone}
            columns={days.map((d) => {
              const h = dayHours[d]; const closed = !!h && 'closed' in h;
              return {
                key: 'd:' + d, date: d, closed,
                header: <span data-testid="week-day-header" data-date={d}>{dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}{closed && <small>{t('cal.closed')}</small>}</span>,
                bookings: visibleBookings.filter((b) => zonedParts(new Date(b.start_time), businessTimezone).date === d),
                slot: singleService && calendarData?.week_slot_capacity?.[d] ? (m: number) => {
                  const cap: SlotCap | undefined = calendarData.week_slot_capacity[d][hhmm(m)]; const v = slotView(cap);
                  const nm = allServices.find((x) => x.id === singleService)?.name || '';
                  const tip = slotTip(nm, cap, v, m, true);
                  return { label: v.label, full: v.full, none: v.none, tip };
                } : undefined,
                onNew: (m: number, e: React.MouseEvent) => openDraft({ date: d, time: hhmm(m), colKey: 'd:' + d }, e),
                label: (bk: any) => `${bk.service_name}${bk.addon_names ? ' +' : ''}${people(bk)}${bk.staff_name ? ' · ' + bk.staff_name.split(' ')[0] : ''}`,
              };
            })}
            dayHours={dayHours}
            colorMap={colorMap}
            onBookingClick={(id) => { setDraft(null); openEdit(id); }}
            ghost={ghost}
            maxPerTime={3}
            onMore={(d) => { setDraft(null); setDate(d); setView('day'); }}
          />
        );
      })()}

      {!loading && view === 'month' && <div style={styles.fitBody}>{monthLayout === 'calendar'
        ? <MonthView days={calendarData?.days || []} capacityDays={calendarData?.capacity_days || {}} services={calendarData?.services || []} colorMap={colorMap} date={date} dayHours={dayHours} timezone={businessTimezone} onDayClick={(d) => { setDraft(null); setDate(d); setView('day'); }} onNew={(d, e) => openDraft({ date: d, time: null }, e)} picked={draft && !draft.time ? draft.date : null} />
        : <MonthGrid capacityDays={calendarData?.capacity_days || {}} services={calendarData?.services || []} days={calendarData?.days || []} colorMap={colorMap} date={date} dayHours={dayHours} timezone={businessTimezone} onDayClick={(d) => { setDraft(null); setDate(d); setView('day'); }} onNew={(d, sid, e) => openDraft({ date: d, time: null, serviceId: sid }, e)} />}</div>}

      {draft && (
        <NewBookingPopup
          key={`${draft.date}|${draft.time}|${draft.serviceId}|${draft.staffId}`}
          businessId={businessId}
          timezone={businessTimezone}
          draft={draft}
          services={bookable}
          locationId={locations.length > 1 ? loc : ''}
          staffServices={draft.staffId ? (calendarData?.day_staff || []).find((x: any) => x.id === draft.staffId) : null}
          onLength={setGhostLen}
          onLabel={setGhostLabel}
          onClose={() => setDraft(null)}
          onCreated={(msg) => { setDraft(null); setToast(msg); setReload((n) => n + 1); }}
          onMore={(p) => { setDraft(null); openNew(p); }}
        />
      )}
      {toast && <div role="status" style={styles.toast}>{toast}</div>}
    </div>
  );
}

interface GridColumn {
  key: string;
  date: string;
  header: React.ReactNode;
  closed?: boolean;
  bookings: any[];
  slot?: (m: number) => { label: string | null; full: boolean; none: boolean; tip: string };
  onNew: (m: number, e: React.MouseEvent) => void;
  label: (bk: any) => string;
  newLabel?: string;
}

/**
 * Boxes side by side wherever bookings overlap in time (THE-23 4.2): each booking gets a place in its group of
 * overlapping bookings; the group is as wide as its most crowded moment. More than `max` places: the last place
 * shows "+N" (CAL-9), the rest are counted there.
 */
export function sideBySide(bookings: any[], date: string, local: (iso: string) => { date: string; minutes: number }, startMin: number, endMin: number, max: number) {
  const items = bookings.map((bk) => { const p = local(bk.start_time); const q = local(bk.end_time); return { bk, st: p.date < date ? startMin : p.minutes, en: q.date > date ? endMin : Math.max(q.minutes, (p.date < date ? startMin : p.minutes) + 1), col: 0, n: 1 }; })
    .sort((a, b) => a.st - b.st || a.bk.start_time.localeCompare(b.bk.start_time) || String(a.bk.id).localeCompare(String(b.bk.id)));
  const groups: Array<typeof items> = []; let cur: typeof items = []; let curEnd = -1;
  for (const it of items) { if (cur.length && it.st >= curEnd) { groups.push(cur); cur = []; curEnd = -1; } cur.push(it); curEnd = Math.max(curEnd, it.en); }
  if (cur.length) groups.push(cur);
  const shown: typeof items = []; const more: Array<{ st: number; col: number; n: number; count: number }> = [];
  for (const g of groups) {
    const colEnd: number[] = [];
    for (const it of g) { let c = colEnd.findIndex((e) => e <= it.st); if (c < 0) { c = colEnd.length; colEnd.push(0); } colEnd[c] = it.en; it.col = c; }
    const n = colEnd.length;
    if (n <= max) { for (const it of g) { it.n = n; shown.push(it); } continue; }
    const hidden = new Map<number, number>();
    for (const it of g) { it.n = max; if (it.col < max - 1) shown.push(it); else hidden.set(it.st, (hidden.get(it.st) || 0) + 1); }
    for (const [st, count] of hidden) more.push({ st, col: max - 1, n: max, count });
  }
  return { shown, more };
}

/**
 * Day and Week body, as in the hub (calTimeGrid): one grid, a 50 px time column, one 30-minute cell per
 * column and time. A booking is a box in the cell where it starts, as tall as it lasts, its text at the top;
 * boxes leave the right edge free for the number and the blue + (cnew). At most `max` boxes at one time:
 * then "+N" opens the day (CAL-9). Grey = outside business hours; stripes = nobody can take it (CAL-21).
 */
export function TimeGrid({ columns, hourRange, timezone, dayHours, colorMap, onBookingClick, ghost, maxPerTime = 6, onMore }: {
  columns: GridColumn[]; hourRange: HourRange; timezone: string; dayHours: Record<string, DayHoursEntry>; colorMap: Map<string, string>;
  onBookingClick: (id: string) => void; ghost: { colKey: string; date: string; start: number; len: number; label: string } | null;
  maxPerTime?: number; onMore?: (date: string) => void;
}) {
  const { t } = useTranslation('calendar');
  const startMin = hourRange.start * 60; const endMin = hourRange.end * 60;
  const cells = Array.from({ length: Math.max(0, (endMin - startMin) / 30) }, (_, i) => startMin + i * 30);
  const now = zonedParts(new Date(), timezone);
  const isPast = (d: string, m: number) => d < now.date || (d === now.date && m + 30 <= now.minutes);
  const local = (iso: string) => zonedParts(new Date(iso), timezone);
  const layouts = new Map<string, ReturnType<typeof sideBySide>>();
  return (
    <div className="cal2-wrap">
      <div className="cal2" style={{ gridTemplateColumns: `50px repeat(${columns.length}, minmax(0, 1fr))` }}>
        <div className="hd" />
        {columns.map((c) => <div key={c.key} className={`hd${c.closed ? ' closed' : ''}`} data-testid="service-column-header">{c.header}</div>)}
        {(() => { layouts.clear(); for (const c of columns) layouts.set(c.key, sideBySide(c.bookings, c.date, local, startMin, endMin, maxPerTime)); return null; })()}
        {cells.map((m) => (
          <Fragment key={m}>
            <div className="tm">{m % 60 ? '' : hhmm(m)}</div>
            {columns.map((c) => {
              const off = c.closed || isOffHours(dayHours[c.date], m);
              const past = isPast(c.date, m);
              const s = !off && !past && c.slot ? c.slot(m) : null;
              const lay = layouts.get(c.key)!;
              const startsHere = lay.shown.filter((x) => x.st >= m && x.st < m + 30 || (m === startMin && x.st < startMin));
              const moreHere = lay.more.filter((x) => x.st >= m && x.st < m + 30 || (m === startMin && x.st < startMin));
              const running = c.bookings.some((b) => { const p = local(b.start_time); const q = local(b.end_time); return (p.date < c.date || p.minutes <= m) && (q.date > c.date || q.minutes > m); });
              const none = !!s && s.none && !running;
              const canNew = !off && !past && !(s && s.full);
              const pos = (j: number, n: number): React.CSSProperties => ({ left: `calc(2px + (100% - 36px) * ${j} / ${n})`, width: `calc((100% - 36px) / ${n} - 3px)` });
              const g = ghost && ghost.colKey === c.key && ghost.date === c.date && ghost.start >= m && ghost.start < m + 30 ? ghost : null;
              const nowHere = c.date === now.date && now.minutes >= m && now.minutes < m + 30;
              return (
                <div key={c.key} className={`c2${off ? ' off' : ''}${none ? ' nocap' : ''}`} title={none ? s!.tip : off ? t('cal.outsideHours') : undefined} data-col={c.key} data-m={m}>
                  {nowHere && <span className="nowl" style={{ top: ((now.minutes - m) / 30) * ROWH - 1 }} title={t('cal.now')} />}
                  {canNew && !none && <button type="button" className="cnew" aria-label={t('cal.newBookingAt', { date: c.date, time: hhmm(m) })} onClick={(e) => c.onNew(m, e)}><span>+</span></button>}
                  {s && s.label && <span className="capn cp-ok" title={s.tip}>{s.label}</span>}
                  {startsHere.map(({ bk, st, en, col, n }) => {
                    const top = 2 + ((Math.max(st, m) - m) / 30) * ROWH;
                    const height = Math.max(ROWH - 4, ((Math.min(en, endMin) - Math.max(st, startMin)) / 30) * ROWH - 4);
                    const label = c.label(bk);
                    return (
                      <button key={bk.id} type="button" className="bk2 sc" data-service-id={bk.service_id}
                        style={{ ['--sc' as any]: cv(colorMap.get(bk.service_id) || SERVICE_COLOR_VARS[0]), top, height, ...pos(col, n) }}
                        onClick={() => onBookingClick(bk.id)}
                        title={t('cal.bookingTitle', { details: `${bk.customer_name} · ${bk.service_name}${bk.addon_names ? ' + ' + bk.addon_names : ''}${bk.participant_count > 1 ? ` (${t('cal.peopleCount', { count: bk.participant_count })})` : ''}${bk.staff_name ? ' · ' + bk.staff_name : ''}`, time: `${hhmm(st)}–${hhmm(en)}`, payment: paymentStatusLabel(bk.payment_status) })}>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                  {moreHere.map((mo) => <button key={'more' + mo.st} type="button" className="bk2 more" style={{ top: 2 + ((mo.st - m) / 30) * ROWH, height: ROWH - 4, ...pos(mo.col, mo.n) }} onClick={() => onMore?.(c.date)} title={t('cal.moreAt', { count: mo.count, time: hhmm(mo.st) })}>+{mo.count}</button>)}
                  {g && <div className="gh" style={{ top: 2 + ((g.start - m) / 30) * ROWH, height: Math.ceil(g.len / 30) * ROWH - 4 }}>{g.label ? t('cal.ghostNew', { label: g.label }) : t('cal.newBooking')}<br />{hhmm(g.start)}–{hhmm(g.start + g.len)}</div>}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// New booking popup (CAL-book; NA-8, NA-10; round 8 parts, 11 Nov 2026): the same small window from Day,
// Week and Month, next to what was clicked, prefilled with the day, time, service or staff column and the
// filter (one service filtered = that service). Customer search and service boxes as in New Appointment
// round 8; only what is free at that time is listed, Location before Staff (buttons up to 6, a dropdown
// above). More options opens the full New Appointment window over the calendar, prefilled.
// ============================================================

function NewBookingPopup({ businessId, timezone, draft, services, locationId: calLoc, staffServices, onLength, onLabel, onClose, onCreated, onMore }: {
  businessId: string; timezone: string; draft: NewBookingDraft; services: SvcItem[]; locationId: string; staffServices: { name: string; service_ids: string[] } | null;
  onLength: (min: number) => void; onLabel: (label: string) => void; onClose: () => void; onCreated: (msg: string) => void; onMore: (p: AppointmentPrefill) => void;
}) {
  const { t } = useTranslation('calendar');
  const [serviceId, setServiceId] = useState(draft.serviceId || '');
  const [variantId, setVariantId] = useState('');
  const [parts, setParts] = useState(1);
  const [ovr, setOvr] = useState(false);
  const [time, setTime] = useState<string | null>(draft.time);
  // the calendar's location is chosen (hub: loc = calendar location)
  const [locationId, setLocationId] = useState<string | null>(calLoc || null);
  const [staffId, setStaffId] = useState<string>(draft.staffId || 'any');
  const [walk, setWalk] = useState(false);
  const [walkName, setWalkName] = useState('');
  const [customer, setCustomer] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const svc = services.find((s) => s.id === serviceId);
  const variant = svc?.variants.find((v) => v.id === variantId);
  useEffect(() => { if (svc && !svc.variants.some((v) => v.id === variantId)) setVariantId(svc.variants[0]?.id || ''); }, [svc, variantId]);
  useEffect(() => { onLength(variant?.duration || 30); onLabel(svc && variant ? `${svc.name} ${variant.name}` : ''); }, [svc, variant, onLength, onLabel]);
  const { combos: raw, loaded } = useCombos(businessId, serviceId, variantId, draft.date, draft.date, ovr ? 1 : parts);
  const combos = raw.filter((c) => zonedParts(new Date(c.start_time), timezone).date === draft.date);

  const lhm = (iso: string) => hhmm(zonedParts(new Date(iso), timezone).minutes);
  const times = [...new Set(combos.map((c) => lhm(c.start_time)))].sort();
  const atTime = time ? combos.filter((c) => lhm(c.start_time) === time) : [];
  const allLocs = [...new Map(combos.filter((c) => c.location_id).map((c) => [c.location_id!, c.location_name || ''])).entries()];
  const multiLoc = allLocs.length > 1;
  // NA-10: only what is free at that time; NA-8: Location first, staff once a location is chosen
  const locFree = [...new Map(atTime.filter((c) => c.location_id && (staffId === 'any' || c.staff_id === staffId)).map((c) => [c.location_id!, c.location_name || ''])).entries()];
  const loc = multiLoc ? (locationId && locFree.some(([id]) => id === locationId) ? locationId : null) : allLocs[0]?.[0] ?? null;
  const staffFree = [...new Map(atTime.filter((c) => c.staff_id && (!multiLoc || c.location_id === loc)).map((c) => [c.staff_id!, `${c.staff_first_name || ''} ${c.staff_last_name || ''}`.trim()])).entries()];
  const hasStaff = !!svc && svc.booking_type !== 'resource' && combos.some((c) => c.staff_id);
  const pickedStaff = staffId !== 'any' && staffFree.some(([id]) => id === staffId) ? staffId : 'any';
  const chosen = atTime.find((c) => (!multiLoc || c.location_id === loc) && (pickedStaff === 'any' || c.staff_id === pickedStaff)) || null;
  const colStaffBusy = !!draft.staffId && staffId === draft.staffId && !!time && atTime.length > 0 && !staffFree.some(([id]) => id === draft.staffId);
  // A walk-in is already here: booked for today only (the server refuses another day too).
  const walkNotToday = walk && draft.date !== zonedParts(new Date(), timezone).date;
  const canCreate = !!chosen && (walk || !!customer) && !(multiLoc && !loc) && !saving && !walkNotToday;
  // Reservation Payment Rule (spec 51, gap 5): a service that needs a card or a payment goes on in the
  // full window (its card or payment step), with everything chosen here carried over.
  const needsMore = !!svc && svc.payment_rule !== 'no_card' && !(svc.payment_rule === 'card_required' && walk);
  const more = () => onMore({ date: draft.date, time, serviceId: serviceId || undefined, variantId: variantId || undefined, staffId: pickedStaff !== 'any' ? pickedStaff : draft.staffId, locationId: loc || undefined, customer, walkIn: walk, walkInName: walkName, participants: parts });

  const W = 380;
  const left = draft.x + 8 + W <= window.innerWidth - 12 ? draft.x + 8 : Math.max(12, (draft.left ?? draft.x) - W - 8);
  const top = Math.max(12, Math.min(draft.y - 60, window.innerHeight - 640));

  const create = async () => {
    if (!chosen || !svc) return;
    setSaving(true); setError('');
    try {
      await bookingsApi.createBooking({
        business_id: businessId, customer_id: walk ? undefined : customer.id, walk_in_name: walk ? (walkName || 'Walk-in') : undefined,
        service_id: serviceId, variant_id: variantId, staff_id: chosen.staff_id || undefined, start_time: chosen.start_time, participant_count: parts, override_rules: ovr,
        location_id: chosen.location_id || undefined,
      });
      onCreated(t('cal.created', { service: svc.name, date: dayLabel(draft.date), time }));
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || t('cal.createFailed'));
    } finally { setSaving(false); }
  };

  const pickRow = (kind: 'loc' | 'staff', list: Array<[string, string]>, cur: string | null, set: (v: string) => void) => {
    const label = kind === 'loc' ? t('cal.locationRequired') : t('appt.staff');
    if (list.length > 6) {
      return (
        <div className="mk-f"><div className="mk-l">{label}</div>
          <select value={cur || (kind === 'staff' ? 'any' : '')} onChange={(e) => set(e.target.value)} aria-label={kind === 'loc' ? t('appt.location') : t('appt.staff')}>
            {kind === 'staff' ? <option value="any">{t('appt.anyStaff')}</option> : <option value="" disabled>{t('cal.chooseLocation')}</option>}
            {list.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div className="mk-f"><div className="mk-l">{label}</div>
        <div className="chips">
          {kind === 'staff' && <button type="button" className="ch" aria-pressed={cur === 'any'} onClick={() => set('any')}>{t('cal.any')}</button>}
          {list.map(([id, name]) => <button key={id} type="button" className="ch" aria-pressed={cur === id} onClick={() => set(id)}>{kind === 'staff' && <span className="av">{initials(name)}</span>}{name}</button>)}
        </div>
      </div>
    );
  };

  return (
    <div className="dsa pop2" style={{ left, top, width: W, maxHeight: `calc(100vh - ${top}px - 12px)` }} role="dialog" aria-label={t('cal.newBooking')}>
      <h4><span>{t('cal.newBooking')}</span><small>{dayLabel(draft.date)} · {time ? `${time}${variant ? '–' + hhmm(toMin(time) + variant.duration) : ''}` : t('cal.chooseTime')}</small></h4>
      <CustomerPicker businessId={businessId} customer={customer} onCustomer={setCustomer} walk={walk} onWalk={setWalk} walkName={walkName} onWalkName={setWalkName} compact startOpen />
      <ServicePicker services={services} serviceId={serviceId} onService={(id) => { setServiceId(id); setStaffId(draft.staffId || 'any'); setLocationId(calLoc || null); }} compact onlyFor={staffServices ? { name: staffServices.name, ids: staffServices.service_ids } : null} />
      <OptionChips svc={svc} variantId={variantId} onVariant={setVariantId} />
      <ParticipantsField svc={svc} parts={parts} onParts={setParts} ovr={ovr} onOvr={setOvr} />
      {svc && loaded && (!time || (time && atTime.length === 0)) && (
        <div className="mk-f">
          <div className="mk-l">{t('cal.timeRequired')}</div>
          {time && <p className="mk-warn">{t('cal.timeNotFree', { time, service: svc.name, option: variant?.name })}</p>}
          {times.length ? <div className="chips" style={{ maxHeight: '104px', overflowY: 'auto' }}>{times.map((tm) => <button key={tm} type="button" className="ch" aria-pressed={tm === time} onClick={() => { setTime(tm); setLocationId(calLoc || null); }}>{tm}</button>)}</div>
            : <p className="mk-warn">{t('cal.nothingFreeService')}</p>}
        </div>
      )}
      {svc && time && atTime.length > 0 && multiLoc && (locFree.length ? pickRow('loc', locFree, loc, setLocationId) : <div className="mk-f"><div className="mk-l">{t('cal.locationRequired')}</div><p className="mk-warn">{t('cal.noLocationFree')}</p></div>)}
      {svc && time && atTime.length > 0 && hasStaff && (multiLoc && !loc
        ? <div className="mk-f"><div className="mk-l">{t('appt.staff')}</div><p className="mk-hint">{t('appt.chooseLocationFirst')}</p></div>
        : staffFree.length ? pickRow('staff', staffFree, pickedStaff, setStaffId) : <div className="mk-f"><div className="mk-l">{t('appt.staff')}</div><p className="mk-warn">{t('cal.nobodyFreeNow')}</p></div>)}
      {colStaffBusy && <p className="mk-warn">{t('cal.columnStaffBusy')}</p>}
      {walkNotToday && <p className="mk-warn">{t('cal.walkInTodayOnly', { date: dayLabel(draft.date) })}</p>}
      {multiLoc && time && atTime.length > 0 && !loc && <p className="mk-hint">{t('cal.chooseALocation')}</p>}
      {error && <p className="mk-warn" role="alert">{error}</p>}
      <div className="pop-act">
        <button type="button" className="more" onClick={more}>{t('cal.moreOptions')}</button>
        <span>
          <button type="button" className="btn sec" onClick={onClose}>{t('common:cancel')}</button>
          {needsMore
            ? <button type="button" className="btn" disabled={!canCreate} onClick={more}>{t('appt.nextPayment')}</button>
            : <button type="button" className="btn" disabled={!canCreate} onClick={create}>{saving ? t('cal.creating') : t('cal.create')}</button>}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Month, as in the hub (calMonth, CAL-15 / CAL-16): Calendar = every day the same size, the three fullest
// services then "+N more" (all, with Open the day); + (top right) books on that day; a click on the day opens
// it in the Day view. Grid = one row per service, one column per day, fitting the width.
// ============================================================

type MonthCap = { service_id: string; booked: number; capacity: number | null };
type MonthSvc = { id: string; name: string; unit: string };
const capCls = (u: number, c: number | null) => (!c ? 'cp-none' : u >= c ? 'cp-full' : u / c >= 0.5 ? 'cp-low' : 'cp-ok');
/** The fullest first: share of capacity, then the number booked. */
export function topServices(list: MonthCap[]): MonthCap[] {
  return [...list].filter((c) => c.booked > 0).sort((a, b) => ((b.capacity ? b.booked / b.capacity : 0) - (a.capacity ? a.booked / a.capacity : 0)) || b.booked - a.booked);
}

function MonthView({ days, capacityDays = {}, services = [], colorMap, date, dayHours = {}, timezone = 'UTC', onDayClick, onNew, picked }: {
  days: any[]; capacityDays?: Record<string, MonthCap[]>; services?: MonthSvc[]; colorMap?: Map<string, string>; date: string;
  dayHours?: Record<string, DayHoursEntry>; timezone?: string; onDayClick: (date: string) => void; onNew?: (date: string, e: React.MouseEvent) => void; picked?: string | null;
}) {
  const { t } = useTranslation('calendar');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const svcName = (id: string) => services.find((s) => s.id === id)?.name || '';
  const d = new Date(date + 'T12:00:00Z');
  const year = d.getUTCFullYear(); const month = d.getUTCMonth();
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDay = new Map<string, any>();
  for (const x of days) byDay.set(typeof x.date === 'string' ? x.date.split('T')[0] : x.date, x);
  const todayStr = zonedParts(new Date(), timezone).date;
  const line = (c: MonthCap) => (
    <span key={c.service_id} className="ln svl" title={c.capacity !== null ? t('cal.bookedOf', { name: svcName(c.service_id), booked: c.booked, capacity: c.capacity }) : t('cal.booked', { name: svcName(c.service_id), booked: c.booked })}>
      <span className="sdot" style={{ ['--sc' as any]: cv(colorMap?.get(c.service_id) || SERVICE_COLOR_VARS[0]) }} />
      <span className="nm">{svcName(c.service_id)}</span>
      <b className={capCls(c.booked, c.capacity)}>{c.capacity ? `${c.booked}/${c.capacity}` : c.booked || '–'}</b>
    </span>
  );
  return (
    <div className="mon">
      {Array.from({ length: 7 }, (_, i) => <span key={i} className="dow">{dayLabel(`2024-01-0${i + 1}`, { weekday: 'short' })}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
      {Array.from({ length: total }, (_, i) => {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        const h = dayHours[ds]; const closed = !!h && 'closed' in h;
        const info = byDay.get(ds); const count = info?.count || 0; const people = info?.people || count;
        const all = capacityDays[ds] || []; const top = topServices(all).slice(0, 3); const more = all.length - top.length;
        const col = (lead + i) % 7;
        const canAdd = !closed && ds >= todayStr && !!onNew;
        const dim = ds < todayStr; // past days faded, as in the hub (David, 11 Nov 2026)
        return (
          <div key={ds} className={`mday${ds === todayStr ? ' today' : ''}${dim ? ' dim' : ''}${openDay === ds ? ' up' : ''}${picked === ds ? ' pick' : ''}${closed ? ' shut' : ''}`} onClick={dim ? undefined : () => onDayClick(ds)} title={closed ? (h as any).reason : undefined}>
            <button type="button" className="mnum" disabled={dim} aria-label={t('cal.openInDay', { date: ds })} onClick={(e) => { e.stopPropagation(); onDayClick(ds); }}>{i + 1}{ds === todayStr ? ' · today' : ''}</button>
            {canAdd && <button type="button" className="mplus" aria-label={t('cal.newBookingOn', { date: ds })} title={t('cal.newBookingOn', { date: ds })} onClick={(e) => { e.stopPropagation(); onNew!(ds, e); }}>+</button>}
            {dim ? null : closed ? <span className="ln">{t('cal.closed')}</span> : (
              <>
                <span className="cnt">{t('cal.bookingCount', { count })}{people > count ? ` · ${t('cal.peopleCount', { count: people })}` : ''}</span>
                {top.map(line)}
                {more > 0 && <button type="button" className="mmore" aria-expanded={openDay === ds} onClick={(e) => { e.stopPropagation(); setOpenDay(openDay === ds ? null : ds); }}>{t('cal.moreCount', { count: more })}</button>}
                {openDay === ds && (
                  <div className={`mpop${col >= 4 ? ' r' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('cal.allServicesOn', { date: ds })}>
                    <b>{dayLabel(ds, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
                    {all.map(line)}
                    <span className="mpop-f"><button type="button" className="btn sec" onClick={() => setOpenDay(null)}>{t('common:modal.close')}</button><button type="button" className="btn" onClick={() => onDayClick(ds)}>{t('cal.openTheDay')}</button></span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({ capacityDays, services, days = [], colorMap, date, dayHours = {}, timezone = 'UTC', onDayClick, onNew }: {
  capacityDays: Record<string, MonthCap[]>; services: MonthSvc[]; days?: any[]; colorMap: Map<string, string>; date: string;
  dayHours?: Record<string, DayHoursEntry>; timezone?: string; onDayClick: (date: string) => void; onNew?: (date: string, serviceId: string, e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation('calendar');
  const d = new Date(date + 'T12:00:00Z');
  const year = d.getUTCFullYear(); const month = d.getUTCMonth();
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ds = Array.from({ length: total }, (_, i) => `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  const todayStr = zonedParts(new Date(), timezone).date;
  const closed = (x: string) => { const h = dayHours[x]; return (!!h && 'closed' in h) || x < todayStr; };
  const count = (x: string) => days.find((y: any) => String(y.date).slice(0, 10) === x)?.count || 0;
  const ids = new Set(services.map((s) => s.id));
  const people = (x: string) => (capacityDays[x] || []).filter((y) => ids.has(y.service_id)).reduce((a, y) => a + (y.booked || 0), 0);
  if (services.length === 0) return <p className="q-empty">{t('cal.noServices')}</p>;
  return (
    <div className="mx">
      <table className="mxt">
        <colgroup><col className="mxcol" />{ds.map((x) => <col key={x} />)}</colgroup>
        <thead>
          <tr>
            <th className="mxs">{t('appt.service')}</th>
            {ds.map((x, i) => (
              <th key={x} className={x === todayStr ? 'today' : ''}>
                <button type="button" className="mxd" onClick={() => onDayClick(x)} title={t('cal.openInDay', { date: dayLabel(x) })}><span>{dayLabel(x, { weekday: 'short' }).slice(0, 2)}</span>{i + 1}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="mxs">{t('cal.total')}</th>
            {ds.map((x) => { if (closed(x)) return <td key={x} className="off">–</td>; const n = people(x); const b = count(x); return <td key={x}><button type="button" className="mxc" onClick={() => onDayClick(x)} title={n ? t('cal.openDayBooked', { date: dayLabel(x), n, bookings: t('cal.bookingCount', { count: b }) }) : t('cal.openDay', { date: dayLabel(x) })}>{n ? <b>{n}</b> : null}</button></td>; })}
          </tr>
          {services.map((s) => (
            <tr key={s.id}>
              <th className="mxs" title={s.name}><span className="sdot" style={{ ['--sc' as any]: cv(colorMap.get(s.id) || SERVICE_COLOR_VARS[0]) }} />{s.name} <small>{s.unit}</small></th>
              {ds.map((x) => {
                if (closed(x)) return <td key={x} className="off">–</td>;
                const c = (capacityDays[x] || []).find((y) => y.service_id === s.id);
                const u = c?.booked || 0; const k = c?.capacity ?? null;
                const canBook = x >= todayStr && !!onNew;
                return (
                  <td key={x}>
                    <button type="button" className={`mxc ${capCls(u, k)}`} onClick={(e) => (canBook ? onNew!(x, s.id, e) : onDayClick(x))}
                      title={[k !== null ? t('cal.cellBookedOf', { date: dayLabel(x), name: s.name, booked: u, capacity: k, unit: s.unit }) : t('cal.cellBooked', { date: dayLabel(x), name: s.name, booked: u }), canBook ? t('cal.clickToBook', { name: s.name }) : ''].filter(Boolean).join(' ')}>
                      {u ? (k ? <><b>{u}</b><small>{k}</small></> : <b>{u}</b>) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function getWeekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day); // Monday (weeks run Monday to Sunday)
  return d;
}

/** Converts a UTC ISO start/end pair into top%/height% within the visible hour range, in business timezone. */
function getTimeRangePosition(startISO: string, endISO: string, timezone: string, hourRange: HourRange = DEFAULT_HOUR_RANGE): { top: number; height: number } | null {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const startParts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: timezone }).formatToParts(start);
  const endParts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: timezone }).formatToParts(end);

  const startHour = parseInt(startParts.find(p => p.type === 'hour')?.value || '0');
  const startMin = parseInt(startParts.find(p => p.type === 'minute')?.value || '0');
  const endHour = parseInt(endParts.find(p => p.type === 'hour')?.value || '0');
  const endMin = parseInt(endParts.find(p => p.type === 'minute')?.value || '0');

  const gridStart = hourRange.start;
  const gridEnd = hourRange.end;
  const gridRange = gridEnd - gridStart;

  const startOffset = (startHour - gridStart) + startMin / 60;
  const endOffset = (endHour - gridStart) + endMin / 60;

  if (endOffset <= 0 || startOffset >= gridRange) return null;

  const top = (Math.max(0, startOffset) / gridRange) * 100;
  const height = ((Math.min(gridRange, endOffset) - Math.max(0, startOffset)) / gridRange) * 100;

  return { top, height };
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1400px', margin: '0 auto', position: 'relative' as const, height: 'calc(100vh - 76px - var(--space-sm) - var(--space-2xl) - 22px)', display: 'flex', flexDirection: 'column' as const, minHeight: '420px' },
  header: { marginBottom: 'var(--space-sm)', flexShrink: 0 },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  controls: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' as const, gap: 'var(--space-sm)', flexShrink: 0 },
  viewToggle: { display: 'flex', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' },
  viewBtn: { background: 'none', border: 'none', padding: '0 var(--space-md)', height: '36px', fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  viewBtnActive: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' },
  dateNav: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  dateLabel: { fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-text)', marginLeft: 'var(--space-sm)' },
  navBtn: { background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', width: '36px', height: '36px', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-base)', fontWeight: 700 },
  todayBtn: { background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: '0 var(--space-md)', height: '36px', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-body)', fontWeight: 600 },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)', fontSize: 'var(--font-size-sm)' },

  fitBody: { flex: 1, minHeight: 0, overflowY: 'auto' as const },
  dot: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 },
  quickFilterAllOn: { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', fontWeight: 600 },
  quickFilterChipOn: { borderColor: 'var(--color-primary)', boxShadow: 'inset 0 0 0 1px var(--color-primary)', fontWeight: 600 },
  colPagerText: { fontSize: 'var(--font-size-body)', color: 'var(--color-text)', whiteSpace: 'nowrap' as const },
  colDots: { display: 'inline-flex', gap: 'var(--space-xs)' },
  colDot: { width: '9px', height: '9px', borderRadius: '50%', border: 0, padding: 0, background: 'var(--color-divider)', cursor: 'pointer' },
  colDotOn: { background: 'var(--color-primary)' },
  legendSwatch: { display: 'inline-block', width: '10px', height: '10px', borderRadius: 'var(--radius-sm)', flexShrink: 0 },

  // Capacity badge
  participantBadge: { display: 'block', fontSize: 'var(--font-size-xs)', opacity: 0.85, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },

  // Capacity timeline strip — a narrow lane per resource showing real concurrent utilization
  // over time, independent of any individual booking block.

  // Quick filter bar — JIRA-quick-filter-style pill buttons, shared by day/week/month views.
  quickFilterBar: { display: 'flex', flexWrap: 'nowrap' as const, alignItems: 'center', gap: 'var(--space-sm)', overflow: 'hidden', minWidth: 0, flex: 1 },
  row2: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)', minHeight: '36px', flexShrink: 0 },
  colPager: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', flexShrink: 0 },
  byLabel: { fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: '.06em', color: 'var(--color-text-secondary)' },
  newBtn: { background: 'var(--color-primary-hover)', color: 'var(--color-primary-contrast)', border: 0, borderRadius: 'var(--radius-md)', padding: '0 var(--space-md)', height: '38px', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-body)', fontWeight: 700 },
  gridWrap: { border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-surface)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const },
  gridHead: { display: 'grid', borderBottom: '1px solid var(--color-divider)', background: 'var(--color-background)', position: 'sticky' as const, top: 0, zIndex: 6 },
  gridScroll: { position: 'relative' as const, flex: 1, minHeight: 0, overflowY: 'auto' as const },
  gridCol: { position: 'relative' as const, borderLeft: '1px solid var(--color-divider)' },
  colHead: { padding: 'var(--space-sm) var(--space-sm)', display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', justifyContent: 'center', gap: '2px var(--space-sm)', minWidth: 0, fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--color-text)', textAlign: 'center' as const },
  colHeadName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 },
  colHeadSub: { flexBasis: '100%', fontSize: 'var(--font-size-small)', fontWeight: 400, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' as const },
  weekHeadBtn: { width: '100%', background: 'none', border: 0, padding: '2px', cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 700, borderRadius: 'var(--radius-md)', textAlign: 'center' as const },
  timeLab: { position: 'absolute' as const, left: 0, right: '8px', textAlign: 'right' as const, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', paddingTop: 'var(--space-sm)', lineHeight: 1 },
  ghost: { position: 'absolute' as const, left: '3px', right: '3px', border: '2px dashed var(--color-primary)', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)', color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)', fontWeight: 700, padding: '2px var(--space-sm)', zIndex: 3, pointerEvents: 'none' as const, boxSizing: 'border-box' as const },
  nowLine: { position: 'absolute' as const, left: 0, right: 0, height: 0, borderTop: '2px solid var(--color-error)', zIndex: 4, pointerEvents: 'none' as const },
  toast: { position: 'fixed' as const, bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-text)', color: 'var(--color-background)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-lg)', fontSize: 'var(--font-size-sm)', zIndex: 60, boxShadow: '0 8px 30px rgba(0,0,0,.25)' },
  pop: { position: 'fixed' as const, zIndex: 50, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(10,20,50,.25)', padding: 'var(--space-md)', display: 'grid', gap: 'var(--space-sm)', maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' as const, boxSizing: 'border-box' as const },
  popHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-sm)' },
  popSub: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 400 },
  popField: { display: 'grid', gap: 'var(--space-xs)' },
  popLabelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  popLabel: { fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text)' },
  popCheck: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer' },
  popInput: { width: '100%', boxSizing: 'border-box' as const, padding: 'var(--space-sm) var(--space-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  popPicked: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' },
  popX: { background: 'none', border: 0, fontSize: 'var(--font-size-lg)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
  popResults: { position: 'absolute' as const, top: '100%', left: 0, right: 0, zIndex: 2, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(10,20,50,.18)', display: 'grid', maxHeight: '200px', overflowY: 'auto' as const },
  popResult: { textAlign: 'left' as const, background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: 'var(--space-sm) var(--space-sm)', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  popChips: { display: 'flex', flexWrap: 'wrap' as const, gap: 'var(--space-sm)' },
  popChip: { border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text)', borderRadius: 'var(--radius-full)', padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--font-size-xs)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  popChipOn: { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', fontWeight: 600 },
  popWarn: { margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-warning-text)' },
  popHint: { margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  popActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginTop: '2px' },
  popLink: { background: 'none', border: 0, padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', textDecoration: 'underline' },
  pillPager: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', flexShrink: 0 },
  pillPagerBtn: { border: '1px solid var(--color-divider)', background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-md)', width: '28px', height: '28px', padding: 0, fontSize: 'var(--font-size-body)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-family)' },
  pillPagerText: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  quickFilterChip: { flexShrink: 0, whiteSpace: 'nowrap' as const, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', height: '32px', padding: '0 var(--space-md)', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-divider)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-family)' },
  quickFilterChipActive: { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', fontWeight: 600 },

  // Day view — per-service column grid
  // Week view summary mode — one bar per merged booked-hour-range, no per-booking detail.

  // Resource block overlay — a business-owner-carved-out sub-range within an otherwise-open day.
  // Stripe colour is pre-blended with transparent (not a parent `opacity`) so the label text
  // sitting on top stays fully legible instead of fading with the background.
  resourceBlockOverlay: {
    position: 'absolute' as const, left: 0, right: 0, boxSizing: 'border-box' as const, borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-error)', zIndex: 0, pointerEvents: 'none' as const,
    background: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-error) 22%, transparent) 0, color-mix(in srgb, var(--color-error) 22%, transparent) 5px, transparent 5px, transparent 10px)',
  },
  resourceBlockLabel: { position: 'absolute' as const, top: '2px', left: '2px', right: '2px', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-error)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', padding: '0 2px' },

  // Time grid (shared by day/week)

  // Booking blocks
  // Top/right/bottom stay a thin neutral separator between adjacent blocks; left is overridden
  // per-booking with a payment-status colour (item 3c-b) so it reads as a distinct signal from
  // the block's own service-colour fill.
  // Booking box (hub design): light tint of the service colour, service-colour left edge, dark text; a small dot = payment status
  bookingBlock: { position: 'absolute' as const, borderRadius: 'var(--radius-md)', padding: 'var(--space-xs) var(--space-sm)', overflow: 'hidden', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', zIndex: 1, border: '2px solid var(--color-surface)', borderLeft: '3px solid', boxSizing: 'border-box' as const, display: 'flex', alignItems: 'center', lineHeight: 1.25 },
  blockLabel: { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 },
  moreBox: { position: 'absolute' as const, height: '22px', zIndex: 2, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 'var(--font-size-xs)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-family)' },
  blockTime: { fontWeight: 600, fontSize: 'var(--font-size-xs)', display: 'block' },
  blockTitle: { display: 'block', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  blockSub: { display: 'block', fontSize: 'var(--font-size-xs)', opacity: 0.8, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },

  // Week view
  todayHeader: { color: 'var(--color-primary-hover)', textDecoration: 'underline', textUnderlineOffset: '4px' },
  weekDayName: { display: 'block', fontWeight: 500 },
  weekDayNum: { display: 'block', fontSize: 'var(--font-size-base)', fontWeight: 600 },

  // Month view
  monthHeader: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-xs)' },
  monthHeaderCell: { textAlign: 'center' as const, padding: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' },
  monthSvcLine: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--font-size-xs)', minWidth: 0 },
  monthSvcName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1, minWidth: 0, color: 'var(--color-text-secondary)' },
  monthMore: { background: 'none', border: 0, padding: 0, color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', alignSelf: 'flex-start' as const },
  monthPop: { position: 'absolute' as const, top: '4px', left: '4px', zIndex: 5, width: '240px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 12px 40px rgba(10,20,50,.22)', padding: 'var(--space-sm)', display: 'grid', gap: 'var(--space-xs)', cursor: 'default' },
  mgTable: { width: '100%', tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0, fontSize: 'var(--font-size-xs)' },
  mgName: { position: 'sticky' as const, left: 0, background: 'var(--color-surface)', textAlign: 'left' as const, padding: 'var(--space-xs) var(--space-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, borderBottom: '1px solid var(--color-border)' },
  mgHead: { fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', padding: '2px 0' },
  mgDay: { background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' },
  mgCell: { textAlign: 'center' as const, borderBottom: '1px solid var(--color-border)', padding: '2px 0' },
  mgBtn: { background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 'var(--font-size-xs)', width: '100%', lineHeight: 1.1 },
  monthCell: { position: 'relative' as const, minHeight: '80px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-xs) var(--space-sm)', display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  monthCellClosed: { background: 'var(--color-surface-muted, rgba(120,130,150,.16))' },
  monthCellPicked: { outline: '2px dashed var(--color-primary)', outlineOffset: '-2px' },
  monthClosed: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  mgOff: { background: 'var(--color-surface-muted, rgba(120,130,150,.16))', color: 'var(--color-text-secondary)' },
  monthCellToday: { background: 'rgba(201, 169, 110, 0.1)', borderColor: 'var(--color-accent)' },
  monthCellDay: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  monthCellCount: { fontSize: 'var(--font-size-xs)', color: 'var(--color-accent-contrast)', fontWeight: 600, background: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '2px var(--space-sm)', alignSelf: 'flex-start' },
};
