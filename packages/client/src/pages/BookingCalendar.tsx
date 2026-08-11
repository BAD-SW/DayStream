import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as bookingsApi from '../api/bookings';
import * as servicesApi from '../api/services';
import * as locationsApi from '../api/locations';
import { apiClient } from '../api/client';

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

/** Toggling the last remaining deselected service back on collapses the selection back to 'all'. */
export function toggleServiceFilter(selection: ServiceFilterSelection, allServices: ServiceRef[], serviceId: string): ServiceFilterSelection {
  if (selection === 'all') {
    const next = new Set(allServices.map((s) => s.id));
    next.delete(serviceId);
    return next;
  }
  const next = new Set(selection);
  if (next.has(serviceId)) next.delete(serviceId); else next.add(serviceId);
  if (next.size === allServices.length) return 'all';
  return next;
}

export function QuickFilterBar({
  services, selected, onChange, colorMap,
}: {
  services: ServiceRef[];
  selected: ServiceFilterSelection;
  onChange: (next: ServiceFilterSelection) => void;
  colorMap: Map<string, string>;
}) {
  if (services.length === 0) return null;
  return (
    <div style={styles.quickFilterBar} role="group" aria-label="Filter by service">
      <button
        type="button"
        style={{ ...styles.quickFilterChip, ...(selected === 'all' ? styles.quickFilterChipActive : {}) }}
        onClick={() => onChange('all')}
      >
        All Services
      </button>
      {services.map((svc) => {
        const active = isServiceVisible(selected, svc.id);
        const colorVar = colorMap.get(svc.id) || SERVICE_COLOR_VARS[0];
        return (
          <button
            key={svc.id}
            type="button"
            style={{ ...styles.quickFilterChip, ...(active ? { ...styles.quickFilterChipActive, borderColor: `var(${colorVar})` } : {}) }}
            onClick={() => onChange(toggleServiceFilter(selected, services, svc.id))}
            aria-pressed={active}
          >
            <span style={{ ...styles.legendSwatch, background: `var(${colorVar})` }} />
            {svc.name}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Capacity Badge (feature 31: capacity-aware-calendar)
// ============================================================

export type FillState = 'available' | 'almost-full' | 'full' | 'over-capacity';

/**
 * count > capacity       → over-capacity (admin override pushed a resource past its limit)
 * count === capacity     → full
 * count === capacity - 1 → almost-full
 * count < capacity - 1   → available
 */
export function getFillState(count: number, capacity: number): FillState {
  if (count > capacity) return 'over-capacity';
  if (count === capacity) return 'full';
  if (count === capacity - 1) return 'almost-full';
  return 'available';
}

const FILL_STATE_COLOR_VAR: Record<FillState, string> = {
  available: 'var(--color-success)',
  'almost-full': 'var(--color-warning)',
  full: 'var(--color-error)',
  'over-capacity': 'var(--color-capacity-override)',
};

/** Shows a booking's own participant count — never a shared/aggregate resource figure. Only
 *  rendered for bookings on a multi-capacity resource, where "how many of this booking" is
 *  actually informative (a plain 1-person booking doesn't need a badge saying "1"). */
export function ParticipantCountBadge({ count, capacity }: { count: number | null | undefined; capacity: number | null | undefined }) {
  if (count == null || capacity == null || capacity <= 1) return null;
  return <span style={styles.participantBadge}>{count} {count === 1 ? 'person' : 'people'}</span>;
}

// ============================================================
// Payment Status (item 3c-b): a left border stripe on the booking block — the service colour
// (fill) and payment status (border) are two independent signals, not competing for the same
// colour channel. No payment records at all reads the same as an explicit unpaid balance.
// ============================================================

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

const PAYMENT_STATUS_COLOR_VAR: Record<PaymentStatus, string> = {
  paid: 'var(--color-success)',
  partial: 'var(--color-warning)',
  unpaid: 'var(--color-error)',
};

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  partial: 'Partially paid',
  unpaid: 'Unpaid',
};

// ============================================================
// Capacity Timeline Strip (fixes: per-booking capacity badges are ambiguous once bookings
// overlap non-uniformly — a resource's true utilization is a property of TIME, not of any one
// booking. Segments come from the server's checkpoint-sweep computation, already correct.)
// ============================================================

interface CapacitySegment {
  start_time: string;
  end_time: string;
  booked: number;
  capacity: number;
}

interface ResourceBlock {
  start_time: string;
  end_time: string;
  reason: string | null;
}

/** Segments whose start falls on the given calendar day, in the given timezone. */
export function filterSegmentsToDay(segments: CapacitySegment[], dateStr: string, timezone: string): CapacitySegment[] {
  return segments.filter((seg) => {
    const segDate = new Date(seg.start_time).toLocaleDateString('sv-SE', { timeZone: timezone });
    return segDate === dateStr;
  });
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
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((b, i) => {
        const pos = getTimeRangePosition(b.start_time, b.end_time, timezone, hourRange);
        if (!pos) return null;
        const label = b.reason ? `Blocked: ${b.reason}` : 'Blocked';
        return (
          <div key={i} data-testid="resource-block" style={{ ...styles.resourceBlockOverlay, top: `${pos.top}%`, height: `${pos.height}%` }} title={label}>
            <span style={styles.resourceBlockLabel}>{label}</span>
          </div>
        );
      })}
    </>
  );
}

export interface CapacityLane { id: string; kind: 'resource' | 'staff'; label?: string }

/** One capacity lane per distinct resource AND per distinct staff member referenced by a set of
 *  bookings — a service can be linked to a resource, a staff member, or both, and each needs its
 *  own strip: two staff members running the same service at the same time have independent
 *  capacity, not a shared one. */
export function buildCapacityLanes(bookings: Array<{ resource_id?: string | null; staff_id?: string | null; staff_name?: string }>): CapacityLane[] {
  const resourceIds = [...new Set(bookings.map((bk) => bk.resource_id).filter(Boolean))] as string[];
  const staffIds = [...new Set(bookings.map((bk) => bk.staff_id).filter(Boolean))] as string[];
  const staffNameById = new Map<string, string>();
  for (const bk of bookings) {
    if (bk.staff_id && bk.staff_name && !staffNameById.has(bk.staff_id)) staffNameById.set(bk.staff_id, bk.staff_name);
  }
  return [
    ...resourceIds.map((id) => ({ id, kind: 'resource' as const })),
    ...staffIds.map((id) => ({ id, kind: 'staff' as const, label: staffNameById.get(id) })),
  ];
}

const CAPACITY_STRIP_WIDTH = 30; // px, reserved lane width per resource/staff member — wide enough for a "2/3" label

/** entityLabel names whose strip this is (a resource or staff member's name) — prefixed onto the
 *  hover tooltip so multiple side-by-side lanes are distinguishable, per the reported ambiguity
 *  ("two red lines on the left" with no way to tell whose capacity each one represented). */
export function CapacityStrip({ segments, timezone, hourRange = DEFAULT_HOUR_RANGE, entityLabel }: { segments: CapacitySegment[]; timezone: string; hourRange?: HourRange; entityLabel?: string }) {
  if (segments.length === 0) return null;
  return (
    <div style={styles.capacityStripLane}>
      {segments.map((seg) => {
        const pos = getTimeRangePosition(seg.start_time, seg.end_time, timezone, hourRange);
        if (!pos) return null;
        const state = getFillState(seg.booked, seg.capacity);
        const over = seg.booked > seg.capacity;
        const filledPct = over ? 100 : Math.min((seg.booked / seg.capacity) * 100, 100);
        const prefix = entityLabel ? `${entityLabel}: ` : '';
        const title = `${prefix}${formatTime(seg.start_time, timezone)}–${formatTime(seg.end_time, timezone)}: ${seg.booked}/${seg.capacity} booked`;
        return (
          <div key={seg.start_time} style={{ ...styles.capacitySegment, top: `${pos.top}%`, height: `${pos.height}%` }} title={title}>
            {/* Width (not height) encodes booked-vs-available — this row's height already encodes
                its own time duration, so re-using height here would conflate the two dimensions. */}
            <div style={{ ...styles.capacitySegmentFill, width: `${filledPct}%`, background: FILL_STATE_COLOR_VAR[state] }} />
            {!over && <div style={{ ...styles.capacitySegmentAvailable, width: `${100 - filledPct}%` }} />}
            {/* The colour alone isn't enough of a first-glance signal — the raw booked/capacity
                numbers (1/3, 3/3, 4/3 when overbooked) must be readable directly on the strip. */}
            <span style={styles.capacitySegmentLabel}>{seg.booked}/{seg.capacity}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BookingCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarData, setCalendarData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');

  const businessId = localStorage.getItem('business_id') || '';

  // Distinct services referenced by the currently loaded bookings, and their assigned colours.
  const calendarServices = useMemo<ServiceRef[]>(() => deriveServiceColumns(calendarData?.bookings || []), [calendarData]);
  const serviceColorMap = useMemo(() => buildServiceColorMap(calendarServices), [calendarServices]);

  // Week view's service filter and detail/summary mode are lifted up here (rather than local
  // WeekView state) because the page unmounts WeekView during every `loading` flicker on
  // navigation — local state would be lost on each week change, silently breaking the "persists
  // across week navigation" requirement.
  const [weekSelectedServices, setWeekSelectedServices] = useState<ServiceFilterSelection>('all');
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>('detail');

  // Month view has no bookings of its own to derive a service list from (the server only returns
  // per-day counts there), so its quick filter is backed by the business's full active service
  // list instead, fetched once, and the selection is sent to the server to re-scope the counts.
  const [allServices, setAllServices] = useState<ServiceRef[]>([]);
  const [monthSelectedServices, setMonthSelectedServices] = useState<ServiceFilterSelection>('all');
  const allServicesColorMap = useMemo(() => buildServiceColorMap(allServices), [allServices]);

  // The visible time axis reflects the business's real operating hours (item 1) rather than a
  // fixed window — e.g. a business open 9am-10pm shows 9am-10pm, not a hardcoded 7am-9pm that
  // clips early/late bookings. Falls back to the default range until hours are loaded/configured.
  const [hourRange, setHourRange] = useState<HourRange>(DEFAULT_HOUR_RANGE);

  // Load business timezone
  useEffect(() => {
    if (!businessId) return;
    apiClient.get('/v1/admin/businesses').then((res) => {
      const biz = res.data.data?.find((b: any) => b.id === businessId);
      if (biz?.timezone) setBusinessTimezone(biz.timezone);
    }).catch(() => {});
  }, [businessId]);

  // Load the primary location's operating hours to size the calendar's time axis
  useEffect(() => {
    if (!businessId) return;
    locationsApi.getLocations(businessId).then(async (locations) => {
      const primary = locations.find((l) => l.is_primary) || locations[0];
      if (!primary) return;
      const hours = await locationsApi.getLocationHours(primary.id);
      setHourRange(computeHourRangeFromLocationHours(hours));
    }).catch(() => {});
  }, [businessId]);

  // Load full service list (for the month view's quick filter)
  useEffect(() => {
    if (!businessId) return;
    servicesApi.getServices(businessId, { status: 'active' }).then((res: any) => {
      const list = res.data || res;
      setAllServices(Array.isArray(list) ? list.map((s: any) => ({ id: s.id, name: s.name })) : []);
    }).catch(() => {});
  }, [businessId]);

  // Fetch calendar data
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const serviceIds = view === 'month' && monthSelectedServices !== 'all' ? [...monthSelectedServices] : undefined;
    bookingsApi.getCalendar(businessId, view, date, serviceIds ? { service_ids: serviceIds } : undefined)
      .then(setCalendarData)
      .catch(() => setCalendarData(null))
      .finally(() => setLoading(false));
  }, [businessId, view, date, monthSelectedServices]);

  const navigateDate = (direction: number) => {
    const d = new Date(date + 'T12:00:00Z');
    if (view === 'day') d.setUTCDate(d.getUTCDate() + direction);
    else if (view === 'week') d.setUTCDate(d.getUTCDate() + 7 * direction);
    else d.setUTCMonth(d.getUTCMonth() + direction);
    setDate(d.toISOString().slice(0, 10));
  };

  const dateLabel = useMemo(() => {
    const d = new Date(date + 'T12:00:00Z');
    if (view === 'day') return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (view === 'week') {
      const start = getWeekStart(date);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
    }
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [date, view]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/bookings')}>← Booking List</button>
        <h1 style={styles.title}>Calendar</h1>
      </div>

      <div style={styles.controls}>
        <div style={styles.viewToggle}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} style={{ ...styles.viewBtn, ...(view === v ? styles.viewBtnActive : {}) }} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div style={styles.dateNav}>
          <button style={styles.navBtn} onClick={() => navigateDate(-1)}>←</button>
          <span style={styles.dateLabel}>{dateLabel}</span>
          <button style={styles.navBtn} onClick={() => navigateDate(1)}>→</button>
          <button style={styles.todayBtn} onClick={() => setDate(new Date().toISOString().slice(0, 10))}>Today</button>
        </div>
      </div>

      {loading && <p style={styles.empty}>Loading...</p>}

      {!loading && view === 'day' && (
        <DayView
          bookings={calendarData?.bookings || []}
          resourceTimelines={calendarData?.resourceTimelines || {}}
          staffTimelines={calendarData?.staffTimelines || {}}
          resourceBlocks={calendarData?.resourceBlocks || {}}
          date={date}
          timezone={businessTimezone}
          onBookingClick={(id) => navigate(`/bookings/${id}/edit`)}
          serviceColorMap={serviceColorMap}
          hourRange={hourRange}
        />
      )}

      {!loading && view === 'week' && (
        <WeekView
          bookings={calendarData?.bookings || []}
          resourceTimelines={calendarData?.resourceTimelines || {}}
          staffTimelines={calendarData?.staffTimelines || {}}
          resourceBlocks={calendarData?.resourceBlocks || {}}
          date={date}
          timezone={businessTimezone}
          hourRange={hourRange}
          onBookingClick={(id) => navigate(`/bookings/${id}/edit`)}
          serviceColorMap={serviceColorMap}
          selectedServices={weekSelectedServices}
          onSelectedServicesChange={setWeekSelectedServices}
          mode={weekViewMode}
          onModeChange={setWeekViewMode}
          onDayClick={(d) => { setDate(d); setView('day'); }}
        />
      )}

      {!loading && view === 'month' && (
        <>
          <QuickFilterBar services={allServices} selected={monthSelectedServices} onChange={setMonthSelectedServices} colorMap={allServicesColorMap} />
          <MonthView days={calendarData?.days || []} date={date} onDayClick={(d) => { setDate(d); setView('day'); }} />
        </>
      )}
    </div>
  );
}

// ============================================================
// Day View — per-service columns with a visibility toggle
// ============================================================

// Day view lays out capacity by booking WIDTH (item 3c-c) rather than the side-lane strips used
// elsewhere — resourceTimelines/staffTimelines aren't needed here, but stay in the prop type so
// the parent can pass the same calendar data to every view uniformly.
export function DayView({ bookings, resourceBlocks = {}, date, timezone, onBookingClick, serviceColorMap, hourRange = DEFAULT_HOUR_RANGE }: { bookings: any[]; resourceTimelines?: Record<string, CapacitySegment[]>; staffTimelines?: Record<string, CapacitySegment[]>; resourceBlocks?: Record<string, ResourceBlock[]>; date: string; timezone: string; onBookingClick: (id: string) => void; serviceColorMap: Map<string, string>; hourRange?: HourRange }) {
  const serviceColumns = useMemo(() => deriveServiceColumns(bookings), [bookings]);
  const [selectedServices, setSelectedServices] = useState<ServiceFilterSelection>('all');
  const hours = useMemo(() => buildHoursArray(hourRange), [hourRange]);

  const visibleColumns = getVisibleServiceColumns(serviceColumns, selectedServices);
  const bookingsByService = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const bk of bookings) {
      if (!map.has(bk.service_id)) map.set(bk.service_id, []);
      map.get(bk.service_id)!.push(bk);
    }
    return map;
  }, [bookings]);

  return (
    <div>
      <QuickFilterBar services={serviceColumns} selected={selectedServices} onChange={setSelectedServices} colorMap={serviceColorMap} />
      <div style={{ ...styles.dayGridContainer, gridTemplateColumns: `60px repeat(${Math.max(visibleColumns.length, 1)}, 1fr)` }}>
        {/* Time axis */}
        <div style={styles.dayTimeAxis}>
          <div style={styles.dayColHeaderSpacer} />
          {hours.map((h) => (
            <div key={h} style={styles.dayTimeAxisLabel}>{formatHour(h)}</div>
          ))}
        </div>

        {visibleColumns.length === 0 && (
          <div style={styles.empty}>No services with bookings on this day</div>
        )}

        {visibleColumns.map((col) => {
          const colorVar = serviceColorMap.get(col.id) || SERVICE_COLOR_VARS[0];
          const colBookings = bookingsByService.get(col.id) || [];
          const subcolumns = buildServiceSubcolumns(colBookings);
          const subWidth = 100 / subcolumns.length;
          return (
            <div key={col.id} data-testid="service-column" data-service-id={col.id} style={styles.dayServiceCol}>
              <div style={{ ...styles.dayColHeader, borderTopColor: `var(${colorVar})` }}>
                <span style={{ ...styles.legendSwatch, background: `var(${colorVar})` }} />
                {col.name}
              </div>
              <div style={{ ...styles.dayColBody, minHeight: `${hours.length * 60}px` }}>
                {hours.map((h) => <div key={h} style={styles.hourRow} />)}
                {subcolumns.map((sub, i) => {
                  const capacity = capacityForSubcolumn(sub);
                  const { blocks, availableBlocks } = layoutCapacityChannel(sub.bookings, capacity, timezone, hourRange);
                  return (
                    <div
                      key={sub.key}
                      data-testid="service-subcolumn"
                      data-subcolumn-key={sub.key}
                      style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: `${i * subWidth}%`, width: `${subWidth}%`,
                        ...(i > 0 ? styles.daySubcolumnDivider : {}),
                      }}
                    >
                      {subcolumns.length > 1 && sub.label && (
                        <span style={styles.daySubcolumnLabel} title={sub.label}>{sub.label}</span>
                      )}
                      {sub.key === 'all' && sub.bookings[0]?.resource_id && (
                        <ResourceBlockOverlay blocks={resourceBlocks[sub.bookings[0].resource_id] || []} timezone={timezone} hourRange={hourRange} />
                      )}
                      {availableBlocks.map((ab, j) => (
                        <div key={j} style={{ ...styles.availableCapacityBlock, top: `${ab.top}%`, height: `${ab.height}%`, left: `${ab.left}%`, width: `${ab.width}%` }} />
                      ))}
                      {blocks.map(({ booking: bk, top, height, left, width }) => (
                        <div
                          key={bk.id}
                          data-service-id={bk.service_id}
                          style={{
                            ...styles.bookingBlock,
                            top: `${top}%`,
                            height: `${height}%`,
                            left: `${left}%`,
                            width: `${width}%`,
                            background: `var(${colorVar})`,
                            borderLeftColor: PAYMENT_STATUS_COLOR_VAR[bk.payment_status as PaymentStatus] || PAYMENT_STATUS_COLOR_VAR.unpaid,
                            cursor: 'pointer',
                          }}
                          onClick={() => onBookingClick(bk.id)}
                          title={`${bk.service_name} — ${bk.customer_name} (${bk.staff_name || 'unassigned'}) — ${PAYMENT_STATUS_LABEL[bk.payment_status as PaymentStatus] || PAYMENT_STATUS_LABEL.unpaid}`}
                        >
                          <span style={styles.blockTime}>{formatTime(bk.start_time, timezone)}</span>
                          <span style={styles.blockTitle}>{bk.service_name}</span>
                          <span style={styles.blockSub}>{bk.customer_name}</span>
                          {bk.staff_name && <span style={styles.blockSub}>{bk.staff_name}</span>}
                          <ParticipantCountBadge count={bk.participant_count} capacity={capacity} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Week View — 7 columns with time grid + service filter
// ============================================================

export type WeekViewMode = 'detail' | 'summary';

/** Detail (today's full per-booking view) vs Summary (one subcolumn per service, just the
 *  booked hour-ranges, no staff/headcount/time-of-day detail — see it in Day view instead). */
export function WeekModeToggle({ mode, onChange }: { mode: WeekViewMode; onChange: (next: WeekViewMode) => void }) {
  return (
    <div style={styles.viewToggle}>
      {(['detail', 'summary'] as const).map((m) => (
        <button
          key={m}
          type="button"
          style={{ ...styles.viewBtn, ...(mode === m ? styles.viewBtnActive : {}) }}
          onClick={() => onChange(m)}
        >
          {m.charAt(0).toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function WeekView({
  bookings, resourceTimelines, staffTimelines = {}, resourceBlocks = {}, date, timezone, onBookingClick, serviceColorMap, selectedServices, onSelectedServicesChange, hourRange = DEFAULT_HOUR_RANGE,
  mode = 'detail', onModeChange, onDayClick,
}: {
  bookings: any[];
  resourceTimelines: Record<string, CapacitySegment[]>;
  staffTimelines?: Record<string, CapacitySegment[]>;
  resourceBlocks?: Record<string, ResourceBlock[]>;
  date: string;
  timezone: string;
  onBookingClick: (id: string) => void;
  serviceColorMap: Map<string, string>;
  selectedServices: ServiceFilterSelection;
  onSelectedServicesChange: (next: ServiceFilterSelection) => void;
  hourRange?: HourRange;
  mode?: WeekViewMode;
  onModeChange?: (next: WeekViewMode) => void;
  onDayClick?: (date: string) => void;
}) {
  const weekStart = getWeekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const hours = useMemo(() => buildHoursArray(hourRange), [hourRange]);

  const weekServices = useMemo(() => deriveServiceColumns(bookings), [bookings]);
  const visibleServices = getVisibleServiceColumns(weekServices, selectedServices);
  const visibleBookings = selectedServices === 'all' ? bookings : bookings.filter((b) => isServiceVisible(selectedServices, b.service_id));

  // Group visible bookings by day
  const bookingsByDay = new Map<string, any[]>();
  for (const bk of visibleBookings) {
    const bkDate = new Date(bk.start_time).toLocaleDateString('sv-SE', { timeZone: timezone }); // YYYY-MM-DD format
    if (!bookingsByDay.has(bkDate)) bookingsByDay.set(bkDate, []);
    bookingsByDay.get(bkDate)!.push(bk);
  }

  return (
    <>
      <div style={styles.weekModeRow}>
        <WeekModeToggle mode={mode} onChange={(next) => onModeChange?.(next)} />
        <QuickFilterBar services={weekServices} selected={selectedServices} onChange={onSelectedServicesChange} colorMap={serviceColorMap} />
      </div>
    <div style={styles.weekContainer}>
      <div style={styles.weekBodyScroll}>
        {/* Header row (inside scroll container so columns align) */}
        <div style={{ ...styles.weekRow, height: 'auto', position: 'sticky' as const, top: 0, zIndex: 2, background: 'var(--color-background, #FFF)' }}>
          <div style={styles.weekHeaderTimeCell} />
          {days.map((d) => (
            <div key={d} data-testid="week-day-header" data-date={d} style={{ ...styles.weekDayHeader, ...(d === new Date().toISOString().slice(0, 10) ? styles.todayHeader : {}) }}>
              <span style={styles.weekDayName}>{new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
              <span style={styles.weekDayNum}>{new Date(d + 'T12:00:00Z').getUTCDate()}</span>
            </div>
          ))}
        </div>
        {/* Time rows + booking overlay wrapper */}
        <div style={{ position: 'relative' as const }}>
          {/* Time rows */}
          {hours.map((h) => (
            <div key={h} style={styles.weekRow}>
              <div style={styles.weekTimeLabel}>{formatHour(h)}</div>
              {days.map((d) => (
                <div key={d} style={styles.weekCell} />
              ))}
            </div>
          ))}
          {/* Booking overlays per day */}
          <div style={{ ...styles.weekOverlay, top: 0, height: `${hours.length * 60}px` }}>
            <div style={styles.weekOverlaySpacer} />
          {days.map((d) => {
            const dayBookings = bookingsByDay.get(d) || [];

            if (mode === 'summary') {
              const subWidth = 100 / Math.max(visibleServices.length, 1);
              return (
                <div key={d} data-testid="week-day-summary" style={styles.weekDayOverlay} onClick={() => onDayClick?.(d)}>
                  {visibleServices.map((svc, i) => {
                    const colorVar = serviceColorMap.get(svc.id) || SERVICE_COLOR_VARS[0];
                    const svcBookings = dayBookings.filter((bk) => bk.service_id === svc.id);
                    const ranges = mergeBookingRanges(svcBookings, timezone, hourRange);
                    return (
                      <div
                        key={svc.id}
                        data-testid="week-summary-subcolumn"
                        data-service-id={svc.id}
                        style={{ position: 'absolute' as const, top: 0, bottom: 0, left: `${i * subWidth}%`, width: `${subWidth}%`, ...(i > 0 ? styles.daySubcolumnDivider : {}) }}
                      >
                        {ranges.map((r, j) => (
                          <div
                            key={j}
                            style={{ ...styles.weekSummaryBar, top: `${r.top}%`, height: `${Math.max(r.height, 2)}%`, background: `var(${colorVar})` }}
                            title={`${svc.name}: ${svcBookings.length} booking${svcBookings.length === 1 ? '' : 's'}`}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            }

            const positioned = layoutBookings(dayBookings, timezone, hourRange);
            const lanes = buildCapacityLanes(dayBookings);
            const stripInset = lanes.length * CAPACITY_STRIP_WIDTH;
            return (
              <div key={d} style={styles.weekDayOverlay}>
                {lanes.map((lane, i) => (
                  <div key={`${lane.kind}-${lane.id}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${i * CAPACITY_STRIP_WIDTH}px`, width: `${CAPACITY_STRIP_WIDTH}px` }}>
                    {lane.kind === 'resource' && (
                      <ResourceBlockOverlay blocks={filterBlocksToDay(resourceBlocks[lane.id] || [], d, timezone)} timezone={timezone} hourRange={hourRange} />
                    )}
                    <CapacityStrip
                      segments={filterSegmentsToDay((lane.kind === 'resource' ? resourceTimelines : staffTimelines)[lane.id] || [], d, timezone)}
                      timezone={timezone}
                      hourRange={hourRange}
                      entityLabel={lane.label}
                    />
                  </div>
                ))}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${stripInset}px`, right: 0 }}>
                {positioned.map((bk) => {
                  const colorVar = serviceColorMap.get(bk.service_id) || SERVICE_COLOR_VARS[0];
                  return (
                    <div
                      key={bk.id}
                      data-service-id={bk.service_id}
                      style={{
                        ...styles.bookingBlock,
                        top: `${bk.top}%`,
                        height: `${Math.max(bk.height, 3)}%`,
                        left: `${bk.left}%`,
                        width: `${bk.width}%`,
                        background: `var(${colorVar})`,
                        borderLeftColor: PAYMENT_STATUS_COLOR_VAR[bk.payment_status as PaymentStatus] || PAYMENT_STATUS_COLOR_VAR.unpaid,
                        cursor: 'pointer',
                      }}
                      onClick={() => onBookingClick(bk.id)}
                      title={`${bk.service_name} — ${bk.customer_name} — ${PAYMENT_STATUS_LABEL[bk.payment_status as PaymentStatus] || PAYMENT_STATUS_LABEL.unpaid}`}
                    >
                      <span style={styles.blockTime}>{formatTime(bk.start_time, timezone)}</span>
                      <span style={styles.blockTitle}>{bk.service_name}</span>
                      <ParticipantCountBadge count={bk.participant_count} capacity={bk.resource_capacity} />
                    </div>
                  );
                })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ============================================================
// Month View — calendar grid with booking counts
// ============================================================

function MonthView({ days, date, onDayClick }: { days: any[]; date: string; onDayClick: (date: string) => void }) {
  const d = new Date(date + 'T12:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  // Build calendar grid
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const startDow = firstDay.getUTCDay(); // 0=Sun
  const totalDays = lastDay.getUTCDate();

  const dayCountMap = new Map<string, number>();
  for (const day of days) {
    const dateStr = typeof day.date === 'string' ? day.date.split('T')[0] : day.date;
    dayCountMap.set(dateStr, day.count);
  }

  const cells: Array<{ date: string | null; day: number; count: number; isToday: boolean }> = [];
  // Leading empty cells
  for (let i = 0; i < startDow; i++) cells.push({ date: null, day: 0, count: 0, isToday: false });
  // Day cells
  const todayStr = new Date().toISOString().slice(0, 10);
  for (let i = 1; i <= totalDays; i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    cells.push({ date: dateStr, day: i, count: dayCountMap.get(dateStr) || 0, isToday: dateStr === todayStr });
  }

  return (
    <div>
      <div style={styles.monthHeader}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={styles.monthHeaderCell}>{d}</div>
        ))}
      </div>
      <div style={styles.monthGrid}>
        {cells.map((cell, idx) => (
          <div
            key={idx}
            style={{ ...styles.monthCell, ...(cell.isToday ? styles.monthCellToday : {}), ...(cell.date ? { cursor: 'pointer' } : {}) }}
            onClick={cell.date ? () => onDayClick(cell.date!) : undefined}
          >
            {cell.date && (
              <>
                <span style={styles.monthCellDay}>{cell.day}</span>
                {cell.count > 0 && (
                  <span style={styles.monthCellCount}>
                    {cell.count} booking{cell.count !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Layout bookings into non-overlapping columns for the day view.
 * Returns bookings with top, height, left, width percentages.
 */
function layoutBookings(bookings: any[], timezone: string, hourRange: HourRange = DEFAULT_HOUR_RANGE): Array<any & { top: number; height: number; left: number; width: number }> {
  // Get positions and sort by start time
  const items = bookings
    .map((bk) => {
      const pos = getBookingPosition(bk, timezone, hourRange);
      if (!pos) return null;
      return { ...bk, top: pos.top, height: pos.height, startPct: pos.top, endPct: pos.top + pos.height };
    })
    .filter(Boolean) as Array<any & { top: number; height: number; startPct: number; endPct: number }>;

  items.sort((a, b) => a.startPct - b.startPct);

  // Assign columns using a greedy approach
  const columns: Array<Array<typeof items[0]>> = [];

  for (const item of items) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastInCol = columns[col][columns[col].length - 1];
      if (lastInCol.endPct <= item.startPct) {
        columns[col].push(item);
        (item as any)._col = col;
        placed = true;
        break;
      }
    }
    if (!placed) {
      (item as any)._col = columns.length;
      columns.push([item]);
    }
  }

  const totalCols = columns.length || 1;

  // Determine max columns for each overlap group
  return items.map((item) => {
    const col = (item as any)._col as number;
    // Find how many columns overlap at this item's time range
    let maxOverlap = 0;
    for (const other of items) {
      if (other.startPct < item.endPct && other.endPct > item.startPct) {
        maxOverlap++;
      }
    }
    const numCols = Math.max(maxOverlap, 1);
    const width = 100 / numCols;
    const left = col * width;

    return { ...item, left, width: width - 1 }; // -1 for small gap
  });
}

/**
 * Week view summary mode (item 3c-e): merges a service's bookings into contiguous "there's
 * something booked here" ranges — no per-booking start/end, staff, or headcount detail, just
 * which hours have any activity at all. Overlapping/back-to-back bookings collapse into one bar.
 */
export function mergeBookingRanges(bookings: Array<{ start_time: string; end_time: string }>, timezone: string, hourRange: HourRange = DEFAULT_HOUR_RANGE): Array<{ top: number; height: number }> {
  const intervals = bookings
    .map((bk) => getTimeRangePosition(bk.start_time, bk.end_time, timezone, hourRange))
    .filter(Boolean) as Array<{ top: number; height: number }>;
  if (intervals.length === 0) return [];

  const sorted = intervals.map((p) => ({ start: p.top, end: p.top + p.height })).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged.map((m) => ({ top: m.start, height: m.end - m.start }));
}

function getWeekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day); // Sunday
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

function getBookingPosition(bk: any, timezone: string, hourRange: HourRange = DEFAULT_HOUR_RANGE): { top: number; height: number } | null {
  return getTimeRangePosition(bk.start_time, bk.end_time, timezone, hourRange);
}

// ============================================================
// Capacity-width layout (day view, item 3c-c): a booking's WIDTH reflects its share of the
// channel's capacity, with the rest of the width shown as a grayed "available" filler — replacing
// the old equal-share time-overlap column packing wherever a real capacity ceiling exists.
// ============================================================

export interface CapacityPositionedBlock { booking: any; top: number; height: number; left: number; width: number }
export interface AvailableCapacityBlock { top: number; height: number; left: number; width: number }

/**
 * Lays out one channel's bookings (a resource, or a single staff member's slice of a service) by
 * capacity share rather than time-overlap count. Bookings that overlap in time are grouped into
 * clusters; within a cluster, each booking's width is participant_count/denominator, where
 * denominator is normally the channel's capacity but grows to the cluster's own peak concurrent
 * headcount when overbooked (so widths always sum to <= 100% instead of overflowing the column).
 * Falls back to the plain equal-share time-packing (`layoutBookings`) when there's no capacity
 * ceiling to encode (no resource, no staff-service capacity).
 */
export function layoutCapacityChannel(
  bookings: any[],
  capacity: number | null,
  timezone: string,
  hourRange: HourRange = DEFAULT_HOUR_RANGE,
): { blocks: CapacityPositionedBlock[]; availableBlocks: AvailableCapacityBlock[] } {
  if (capacity == null) {
    const positioned = layoutBookings(bookings, timezone, hourRange);
    return {
      blocks: positioned.map((p) => ({ booking: p, top: p.top, height: p.height, left: p.left, width: p.width })),
      availableBlocks: [],
    };
  }

  const items = bookings
    .map((bk) => {
      const pos = getBookingPosition(bk, timezone, hourRange);
      if (!pos) return null;
      return { booking: bk, top: pos.top, height: pos.height, startPct: pos.top, endPct: pos.top + pos.height, count: Math.max(1, bk.participant_count || 1) };
    })
    .filter(Boolean) as Array<{ booking: any; top: number; height: number; startPct: number; endPct: number; count: number }>;

  if (items.length === 0) return { blocks: [], availableBlocks: [] };

  items.sort((a, b) => a.startPct - b.startPct);

  // Group into overlap clusters (maximal runs of transitively-overlapping bookings) — each is
  // laid out independently since bookings outside a cluster never compete for the same space.
  const clusters: Array<typeof items> = [];
  let current: typeof items = [];
  let clusterEnd = -Infinity;
  for (const item of items) {
    if (current.length > 0 && item.startPct >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(item);
    clusterEnd = Math.max(clusterEnd, item.endPct);
  }
  if (current.length > 0) clusters.push(current);

  const blocks: CapacityPositionedBlock[] = [];
  const availableBlocks: AvailableCapacityBlock[] = [];

  for (const cluster of clusters) {
    const breakpoints = [...new Set(cluster.flatMap((it) => [it.startPct, it.endPct]))].sort((a, b) => a - b);

    let peak = 0;
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const mid = (breakpoints[i] + breakpoints[i + 1]) / 2;
      const booked = cluster.filter((it) => it.startPct <= mid && it.endPct > mid).reduce((s, it) => s + it.count, 0);
      if (booked > peak) peak = booked;
    }
    // Integer unit-columns (like a bin-packing grid) rather than a single "rightmost edge"
    // cursor — a cursor-based stack never backfills a slot freed by an earlier-ending booking,
    // which pushed later bookings off the edge at near-zero width instead of reusing the gap.
    const denom = Math.max(Math.ceil(capacity), Math.ceil(peak), 1);
    const unitWidth = 100 / denom;

    // Each unit column's occupied time-ranges, built up as bookings are placed in start order.
    const columnRanges: Array<Array<{ start: number; end: number }>> = Array.from({ length: denom }, () => []);
    const placements: Array<{ item: typeof cluster[number]; startIdx: number; need: number }> = [];

    for (const item of cluster) {
      const need = Math.min(item.count, denom);
      const isFree = (col: number) => !columnRanges[col].some((r) => r.start < item.endPct && r.end > item.startPct);

      let startIdx = -1;
      for (let i = 0; i <= denom - need; i++) {
        let ok = true;
        for (let j = 0; j < need; j++) { if (!isFree(i + j)) { ok = false; break; } }
        if (ok) { startIdx = i; break; }
      }
      if (startIdx === -1) {
        // No single contiguous run of `need` free columns (a fragmented, rare case) — take
        // whatever's free rather than drop the booking.
        startIdx = Math.max(0, [...Array(denom).keys()].find(isFree) ?? 0);
      }
      for (let j = 0; j < need && startIdx + j < denom; j++) columnRanges[startIdx + j].push({ start: item.startPct, end: item.endPct });

      placements.push({ item, startIdx, need });
      const left = startIdx * unitWidth;
      const width = Math.min(need * unitWidth, 100 - left);
      blocks.push({ booking: item.booking, top: item.top, height: item.height, left, width });
    }

    // Grayed "available" filler: for each sub-interval, whichever unit columns no placed booking
    // occupies at that moment — derived from the same column assignments as the blocks above, so
    // fillers can never land on top of (or leave a gap next to) an actual booking.
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const segStart = breakpoints[i];
      const segEnd = breakpoints[i + 1];
      if (segStart >= segEnd) continue;
      const mid = (segStart + segEnd) / 2;
      const occupied = (col: number) => placements.some((p) => p.item.startPct <= mid && p.item.endPct > mid && col >= p.startIdx && col < p.startIdx + p.need);

      let runStart = -1;
      for (let col = 0; col <= denom; col++) {
        const free = col < denom && !occupied(col);
        if (free && runStart === -1) runStart = col;
        if (!free && runStart !== -1) {
          const left = runStart * unitWidth;
          const width = (col - runStart) * unitWidth;
          const prev = availableBlocks[availableBlocks.length - 1];
          if (prev && prev.left === left && prev.width === width && prev.top + prev.height === segStart) {
            prev.height = segEnd - prev.top;
          } else {
            availableBlocks.push({ top: segStart, height: segEnd - segStart, left, width });
          }
          runStart = -1;
        }
      }
    }
  }

  return { blocks, availableBlocks };
}

export interface ServiceSubcolumn { key: string; label?: string; bookings: any[] }

/** One subcolumn per distinct staff member when a service is staff-linked (each staff member's
 *  capacity is independent — two coaches running the same class don't share one bar); otherwise a
 *  single subcolumn for the whole service (governed by its resource, if any). */
export function buildServiceSubcolumns(bookings: any[]): ServiceSubcolumn[] {
  const hasStaff = bookings.some((bk) => bk.staff_id);
  if (!hasStaff) return [{ key: 'all', bookings }];

  const byStaff = new Map<string, ServiceSubcolumn>();
  for (const bk of bookings) {
    const key = bk.staff_id || 'unassigned';
    if (!byStaff.has(key)) byStaff.set(key, { key, label: bk.staff_id ? bk.staff_name : 'Unassigned', bookings: [] });
    byStaff.get(key)!.bookings.push(bk);
  }
  return [...byStaff.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

/** The capacity ceiling for a subcolumn: a staff subcolumn uses its service's max_capacity (all
 *  bookings in one subcolumn share the same service), otherwise the linked resource's capacity —
 *  null when neither applies, signalling "no capacity concept, fall back to time-based packing". */
export function capacityForSubcolumn(sub: ServiceSubcolumn): number | null {
  const first = sub.bookings[0];
  if (!first) return null;
  return sub.key === 'all' ? (first.resource_capacity ?? null) : (first.service_max_capacity ?? null);
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function formatTime(isoStr: string, timezone: string): string {
  return new Date(isoStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { marginBottom: 'var(--space-md)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-sm)', display: 'block' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  controls: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, gap: 'var(--space-sm)' },
  viewToggle: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  viewBtn: { background: 'none', border: 'none', borderRight: '1px solid var(--color-border)', padding: '8px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  viewBtnActive: { background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A', fontWeight: 600 },
  dateNav: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  dateLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', minWidth: '180px', textAlign: 'center' as const },
  navBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  todayBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)' },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-xl)', fontSize: 'var(--font-size-sm)' },

  legendSwatch: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', flexShrink: 0 },

  // Capacity badge
  capacityBadge: { position: 'absolute' as const, top: '2px', right: '2px', fontSize: '9px', fontWeight: 700, color: '#fff', borderRadius: '3px', padding: '1px 4px', lineHeight: 1.4, zIndex: 2 },
  participantBadge: { display: 'block', fontSize: '10px', opacity: 0.85, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },

  // Capacity timeline strip — a narrow lane per resource showing real concurrent utilization
  // over time, independent of any individual booking block.
  capacityStripLane: { position: 'absolute' as const, top: 0, bottom: 0, left: 0, width: `${CAPACITY_STRIP_WIDTH}px`, zIndex: 1 },
  capacitySegment: { position: 'absolute' as const, left: '1px', right: '1px', display: 'flex', flexDirection: 'row' as const, borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--color-border)', boxSizing: 'border-box' as const },
  capacitySegmentFill: { height: '100%' },
  capacitySegmentAvailable: { height: '100%', background: 'var(--color-surface)' },
  capacitySegmentLabel: { position: 'absolute' as const, inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 700, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.9)', pointerEvents: 'none' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden' },

  // Quick filter bar — JIRA-quick-filter-style pill buttons, shared by day/week/month views.
  quickFilterBar: { display: 'flex', flexWrap: 'wrap' as const, gap: '8px', marginBottom: 'var(--space-md)' },
  weekModeRow: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 'var(--space-md)' },
  quickFilterChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '999px', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  quickFilterChipActive: { background: 'rgba(201, 169, 110, 0.15)', borderColor: 'var(--color-accent, #C9A96E)', color: 'var(--color-text)', fontWeight: 600 },

  // Day view — per-service column grid
  dayGridContainer: { display: 'grid', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  dayTimeAxis: { borderRight: '1px solid var(--color-border)' },
  dayColHeaderSpacer: { height: '36px', borderBottom: '1px solid var(--color-border)' },
  dayTimeAxisLabel: { height: '60px', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', fontSize: '11px', color: 'var(--color-text-secondary)', boxSizing: 'border-box' as const, borderTop: '1px solid var(--color-border)' },
  dayServiceCol: { borderRight: '1px solid var(--color-border)', position: 'relative' as const },
  dayColHeader: { height: '36px', boxSizing: 'border-box' as const, display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)', borderTop: '3px solid transparent', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' },
  dayColBody: { position: 'relative' as const },
  daySubcolumnDivider: { borderLeft: '1px dashed var(--color-border)' },
  // Week view summary mode — one bar per merged booked-hour-range, no per-booking detail.
  weekSummaryBar: { position: 'absolute' as const, left: '10%', width: '80%', borderRadius: '2px', cursor: 'pointer', boxSizing: 'border-box' as const },
  daySubcolumnLabel: { position: 'absolute' as const, top: '2px', left: '2px', right: '2px', fontSize: '9px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' as const, opacity: 0.8 },
  availableCapacityBlock: { position: 'absolute' as const, background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: '3px', boxSizing: 'border-box' as const, opacity: 0.6 },

  // Resource block overlay — a business-owner-carved-out sub-range within an otherwise-open day.
  // Stripe colour is pre-blended with transparent (not a parent `opacity`) so the label text
  // sitting on top stays fully legible instead of fading with the background.
  resourceBlockOverlay: {
    position: 'absolute' as const, left: 0, right: 0, boxSizing: 'border-box' as const, borderRadius: '3px',
    border: '1px solid var(--color-error)', zIndex: 0, pointerEvents: 'none' as const,
    background: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-error) 22%, transparent) 0, color-mix(in srgb, var(--color-error) 22%, transparent) 5px, transparent 5px, transparent 10px)',
  },
  resourceBlockLabel: { position: 'absolute' as const, top: '2px', left: '2px', right: '2px', fontSize: '9px', fontWeight: 700, color: 'var(--color-error)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', background: 'var(--color-background)', borderRadius: '2px', padding: '0 2px' },

  // Time grid (shared by day/week)
  timeGrid: { position: 'relative' as const, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  gridRow: { display: 'grid', gridTemplateColumns: '60px 1fr', height: '60px', borderBottom: '1px solid var(--color-border)' },
  timeLabel: { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', fontSize: '11px', color: 'var(--color-text-secondary)' },
  hourCell: { borderLeft: '1px solid var(--color-border)' },
  bookingOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, display: 'grid', gridTemplateColumns: '60px 1fr', pointerEvents: 'none' as const },
  timeLabelSpacer: {},
  dayColumnOverlay: { position: 'relative' as const, pointerEvents: 'auto' as const },
  timeLabels: { display: 'flex', flexDirection: 'column' as const },
  timeLabelsHeader: { width: '60px', flexShrink: 0 },
  dayColumn: { position: 'relative' as const, minHeight: `${(DEFAULT_HOUR_RANGE.end - DEFAULT_HOUR_RANGE.start) * 60}px` },
  hourRow: { height: '60px', borderTop: '1px solid var(--color-border)', boxSizing: 'border-box' as const },

  // Booking blocks
  // Top/right/bottom stay a thin neutral separator between adjacent blocks; left is overridden
  // per-booking with a payment-status colour (item 3c-b) so it reads as a distinct signal from
  // the block's own service-colour fill.
  bookingBlock: { position: 'absolute' as const, borderRadius: '4px', padding: '2px 4px', overflow: 'hidden', fontSize: '11px', color: '#fff', zIndex: 1, borderTop: '2px solid var(--color-background, #FFF)', borderRight: '2px solid var(--color-background, #FFF)', borderBottom: '2px solid var(--color-background, #FFF)', borderLeft: '4px solid var(--color-background, #FFF)', boxSizing: 'border-box' as const },
  blockTime: { fontWeight: 600, fontSize: '10px', display: 'block' },
  blockTitle: { display: 'block', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  blockSub: { display: 'block', fontSize: '10px', opacity: 0.8, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },

  // Week view
  weekContainer: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  weekHeaderTimeCell: { borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' },
  weekDayHeader: { padding: '8px 4px', textAlign: 'center' as const, fontSize: '12px', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' },
  todayHeader: { background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A' },
  weekDayName: { display: 'block', fontWeight: 500 },
  weekDayNum: { display: 'block', fontSize: '16px', fontWeight: 600 },
  weekBodyScroll: { position: 'relative' as const, overflow: 'auto', maxHeight: '700px' },
  weekRow: { display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', height: '60px', borderBottom: '1px solid var(--color-border)' },
  weekTimeLabel: { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: '8px', paddingTop: '2px', fontSize: '11px', color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)' },
  weekCell: { borderRight: '1px solid var(--color-border)' },
  weekOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: `${(DEFAULT_HOUR_RANGE.end - DEFAULT_HOUR_RANGE.start) * 60}px`, display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', pointerEvents: 'none' as const },
  weekOverlaySpacer: {},
  weekDayOverlay: { position: 'relative' as const, pointerEvents: 'auto' as const },

  // Month view
  monthHeader: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--color-border)', marginBottom: '4px' },
  monthHeaderCell: { textAlign: 'center' as const, padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' },
  monthCell: { minHeight: '80px', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 6px', display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  monthCellToday: { background: 'rgba(201, 169, 110, 0.1)', borderColor: 'var(--color-accent, #C9A96E)' },
  monthCellDay: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  monthCellCount: { fontSize: '11px', color: '#fff', fontWeight: 600, background: 'var(--color-accent, #C9A96E)', borderRadius: '4px', padding: '2px 6px', alignSelf: 'flex-start' },
};
