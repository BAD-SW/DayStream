# Design Document

## Overview

This feature enhances the existing `BookingCalendar` page (`packages/client/src/pages/BookingCalendar.tsx`) and its backing service (`packages/server/src/services/booking-calendar.service.ts`) in place. No new routes and no schema migrations are required — `res_schedule_blocks` (Feature 13) and `pay_transactions` (Feature 10) already exist and are simply queried for the first time from the calendar endpoint.

The changes are organised in three layers:

- **Backend**: fix month-view timezone bucketing at the source; extend `getCalendar()` to return per-staff capacity timelines, resource schedule blocks, and a derived payment status per booking.
- **Frontend data layer**: derive the visible hour range from real location hours; replace the old per-booking equal-share layout in day view with a capacity-proportional one; add a week-view summary mode.
- **Frontend filtering**: collapse the checkbox/dropdown/legend trio into one `QuickFilterBar` used identically everywhere.

The availability calculation service (`availability.service.ts`) is **not touched**, and no booking creation/edit flow is touched.

## Architecture

```
Frontend (React + TypeScript)
┌──────────────────────────────────────────────────────────────────┐
│ BookingCalendar (page)                                            │
│  ├── hourRange state          — from computeHourRangeFromLocationHours()
│  ├── weekViewMode state       — 'detail' | 'summary', lifted so it │
│  │                               survives WeekView unmount on load │
│  ├── QuickFilterBar           — one control, all three views       │
│  ├── DayView (rewritten)      — capacity-proportional layout       │
│  │    ├── buildServiceSubcolumns()  — staff lanes or single lane   │
│  │    ├── layoutCapacityChannel()   — width = capacity share       │
│  │    └── ResourceBlockOverlay      — schedule-block overlay       │
│  ├── WeekView (extended)      — Detail mode (unchanged) or         │
│  │    ├── CapacityStrip             Summary mode (new)             │
│  │    └── mergeBookingRanges()      — merged per-service ranges    │
│  └── MonthView (unchanged, now fed correct per-day counts)         │
└──────────────────────┬─────────────────────────────────────────────┘
                        │  GET /api/v1/bookings/calendar
                        │  (service_id filter now accepts a CSV list)
Backend (Express + TypeScript)
┌───────────────────────▼─────────────────────────────────────────────┐
│ bookings.ts (route) — parses service_id CSV into serviceIds[]        │
│  └── booking-calendar.service.ts                                     │
│       ├── zonedDateTimeToUtc() / zonedMidnightToUtc()                │
│       │     — business-timezone-aware query windowing & bucketing    │
│       ├── getCalendar()                                              │
│       │     ├── apt_bookings ⋈ svc_services ⋈ res_resources (existing)│
│       │     ├── pay_transactions  (NEW — payment status)             │
│       │     └── res_schedule_blocks (NEW — resource blocks)          │
│       ├── computeCapacitySegments() — extended: capacity now carried │
│       │     per-booking, not one fixed number (staff mix services)   │
│       └── derivePaymentStatus()  — pure classification function      │
└────────────────────────────────────────────────────────────────────┘
```

Key constraints honoured:
- No ORM — raw SQL via `adminPool`
- No changes to `availability.service.ts`
- All frontend colours via CSS custom properties
- `res_schedule_blocks` and `pay_transactions` are read-only from the calendar's perspective

## Components and Interfaces

### Backend: Timezone-Safe Date Handling

The month-view bug had two independent causes, both fixed in `booking-calendar.service.ts`:

```typescript
// 1. Query windows and month buckets now use the business's own timezone, not a
//    hardcoded 'UTC' — computed once per request from sys_businesses.timezone.
function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}Z`);
  const inTz = new Date(guess.toLocaleString('en-US', { timeZone }));
  const inUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = inUtc.getTime() - inTz.getTime();
  return new Date(guess.getTime() + offsetMs);
}
function zonedMidnightToUtc(dateStr: string, timeZone: string): Date {
  return zonedDateTimeToUtc(dateStr, '00:00:00', timeZone);
}
```

```sql
-- 2. The month-view SELECT casts the bucketed date to text in SQL, so node-postgres
--    never constructs a `date`-typed JS Date object (which it would otherwise build
--    using the *server host's own* local timezone, silently re-shifting the day a
--    second time on JSON serialization).
SELECT DATE(b.start_time AT TIME ZONE $timezone)::text AS day, COUNT(*)::int AS count, ...
FROM apt_bookings b
WHERE ...
GROUP BY DATE(b.start_time AT TIME ZONE $timezone)
```

### Backend: Capacity Segments With Per-Booking Capacity

`computeCapacitySegments` (introduced in Feature 31) is extended so capacity travels with each booking instead of being one fixed argument — required because a staff member's timeline can mix bookings from different services with different `max_capacity` values:

```typescript
export interface CapacitySegment { start_time: string; end_time: string; booked: number; capacity: number; }

export function computeCapacitySegments(
  bookings: Array<{ start_time: string; end_time: string; participant_count: number; capacity: number }>,
): CapacitySegment[]
```

For each breakpoint interval, `booked` is the sum of `participant_count` of bookings active at that interval's midpoint, and `capacity` is the **max** of those same bookings' own `capacity` values — a resource has one consistent capacity so this is a no-op there, but a staff member running a 1:1 service then a 4-person class produces two segments with different capacities from the same timeline.

`getCalendar()` builds one timeline per resource (`resource_capacity`) and one per staff member (`service_max_capacity` of whichever booking is active):

```typescript
const resourceTimelines: Record<string, CapacitySegment[]> = {};
const staffTimelines: Record<string, CapacitySegment[]> = {};
```

### Backend: Resource Schedule Blocks

```typescript
const resourceBlocks: Record<string, Array<{ start_time: string; end_time: string; reason: string | null }>> = {};
```

Populated from `res_schedule_blocks` filtered to the resource IDs actually present in the requested view's bookings, and to the view's date range. A block's `block_date` + `start_time`/`end_time` (nullable — a null pair means an all-day block, defaulted to `00:00:00`–`23:59:59`) is converted to UTC via `zonedDateTimeToUtc`, exactly as bookings are.

### Backend: Payment Status

```typescript
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

export function derivePaymentStatus(price: number, netPaid: number): PaymentStatus {
  if (price <= 0) return 'paid';
  if (netPaid >= price) return 'paid';
  if (netPaid > 0) return 'partial';
  return 'unpaid';
}
```

`netPaid` per booking is computed with one aggregate query against `pay_transactions`, scoped to the booking IDs in the current response:

```sql
SELECT booking_id,
       SUM(CASE WHEN type = 'charge' AND status = 'completed' THEN amount ELSE 0 END)
     - SUM(CASE WHEN type IN ('refund', 'credit') AND status = 'completed' THEN amount ELSE 0 END) AS net_paid
FROM pay_transactions
WHERE booking_id = ANY($1::uuid[])
GROUP BY booking_id
```

A booking absent from the result set (no transactions at all) defaults to `netPaid = 0`, which `derivePaymentStatus` classifies as `unpaid`.

### Backend: Multi-Service Filter

`serviceIds?: string[]` replaces the old singular `serviceId?: string` on `CalendarQuery`, applied via `b.service_id = ANY($n::uuid[])`. The route parses a comma-separated `service_id` query parameter into the array — used by month view's `QuickFilterBar` to re-scope server-side day counts.

### Frontend: Business-Hours Time Axis

```typescript
export interface HourRange { start: number; end: number } // end exclusive
export const DEFAULT_HOUR_RANGE: HourRange = { start: 7, end: 21 };

export function computeHourRangeFromLocationHours(
  hours: Array<{ is_closed: boolean; open_time: string | null; close_time: string | null }>,
): HourRange {
  const openDays = hours.filter((h) => !h.is_closed && h.open_time && h.close_time);
  if (openDays.length === 0) return DEFAULT_HOUR_RANGE;
  const start = Math.min(...openDays.map((h) => floorHour(h.open_time!)));
  const end = Math.max(...openDays.map((h) => ceilHour(h.close_time!)));
  return start < end ? { start, end } : DEFAULT_HOUR_RANGE;
}
```

`hourRange` is fetched once (via `locationsApi.getLocationHours`) in `BookingCalendar()` and threaded as a prop into every position-calculating function (`getTimeRangePosition`, `layoutBookings`, `layoutCapacityChannel`, `mergeBookingRanges`, `CapacityStrip`, `ResourceBlockOverlay`), replacing the old module-level `HOURS` constant.

### Frontend: Quick Filter Bar

Replaces `ServiceLegend` (deleted), `ServiceColumnFilter` (checkboxes, deleted), and `ServiceFilterDropdown` (deleted) with one component and one selection model:

```typescript
export type ServiceFilterSelection = 'all' | Set<string>;
export function isServiceVisible(selection: ServiceFilterSelection, serviceId: string): boolean;
export function toggleServiceFilter(selection: ServiceFilterSelection, allServices: ServiceRef[], serviceId: string): ServiceFilterSelection;
export function QuickFilterBar({ services, selected, onChange, colorMap }: { ... }): JSX.Element;
```

`toggleServiceFilter` collapses back to `'all'` when every service ends up selected again, keeping the "All Services" chip in sync as the single source of truth for the fully-open state.

### Frontend: Day View Capacity-Proportional Layout

```typescript
export interface ServiceSubcolumn { key: string; label?: string; bookings: any[] }

export function buildServiceSubcolumns(bookings: any[]): ServiceSubcolumn[];
// hasStaff ? one subcolumn per distinct staff_id (labelled by name, 'unassigned' bucket for
//             staff-linked services with a staffless booking)
//           : a single { key: 'all', bookings } subcolumn

export function capacityForSubcolumn(sub: ServiceSubcolumn): number | null;
// 'all' → first booking's resource_capacity; staff subcolumn → first booking's service_max_capacity

export interface CapacityPositionedBlock { booking: any; top: number; height: number; left: number; width: number }
export interface AvailableCapacityBlock { top: number; height: number; left: number; width: number }

export function layoutCapacityChannel(
  bookings: any[],
  capacity: number | null,
  timezone: string,
  hourRange?: HourRange,
): { blocks: CapacityPositionedBlock[]; availableBlocks: AvailableCapacityBlock[] };
```

`layoutCapacityChannel` is the core new algorithm. Per overlap cluster (a maximal run of transitively-overlapping bookings):

1. Compute `denom = max(ceil(capacity), ceil(peakConcurrentBooked), 1)` — the peak is found via the same checkpoint-sweep technique as `computeCapacitySegments`, so an overbooked cluster's widths shrink to fit instead of overflowing 100%.
2. Model the channel as `denom` **integer unit-columns**, each `100/denom`% wide. Every booking needs `min(participant_count, denom)` contiguous free columns; placement scans left-to-right for the first such run, tracking each column's occupied time-ranges (not just the "last" occupant) so a column vacated by an earlier-ending booking is correctly reclaimed by a later one.
3. Available fillers are derived from the *same* column assignments, per breakpoint interval, as contiguous runs of unoccupied columns — guaranteeing a filler can never visually overlap a real booking block.

This replaced an initial "stack after the rightmost occupied edge" implementation, which — caught via live testing against real seeded data (a 4-booking Fire & Ice scenario where two bookings ended exactly when a third started) — squeezed a reclaiming booking to a near-zero width instead of reusing the freed slot.

Falls back to the pre-existing `layoutBookings` (equal-share time-overlap columns) when `capacity == null`.

### Frontend: Resource Block Overlay

```typescript
interface ResourceBlock { start_time: string; end_time: string; reason: string | null }
export function filterBlocksToDay(blocks: ResourceBlock[], dateStr: string, timezone: string): ResourceBlock[];
export function ResourceBlockOverlay({ blocks, timezone, hourRange }: { ... }): JSX.Element;
```

Renders as a diagonal-hatched (`repeating-linear-gradient`, colour pre-blended via `color-mix()` so overlaid text stays fully legible rather than fading with a parent `opacity`), `pointer-events: none` overlay positioned by the same `getTimeRangePosition` helper used everywhere else. Rendered only within a service's resource-primary (`'all'`) subcolumn in day view; per resource capacity-strip lane in week view.

### Frontend: Payment Status Stripe

```typescript
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';
const PAYMENT_STATUS_COLOR_VAR: Record<PaymentStatus, string> = {
  paid: 'var(--color-success)', partial: 'var(--color-warning)', unpaid: 'var(--color-error)',
};
```

`bookingBlock`'s single 2px `border` is split into `borderTop/Right/Bottom` (unchanged, neutral separator) and a distinct 4px `borderLeft` driven by `PAYMENT_STATUS_COLOR_VAR[bk.payment_status]`, so the payment signal is visually independent of the service-colour `background` fill.

### Frontend: Week View Summary Mode

```typescript
export type WeekViewMode = 'detail' | 'summary';
export function WeekModeToggle({ mode, onChange }: { mode: WeekViewMode; onChange: (next: WeekViewMode) => void }): JSX.Element;

export function mergeBookingRanges(
  bookings: Array<{ start_time: string; end_time: string }>,
  timezone: string,
  hourRange?: HourRange,
): Array<{ top: number; height: number }>;
```

`mergeBookingRanges` sorts a service's bookings for a day by position and merges overlapping/back-to-back intervals — a plain interval-merge, no capacity or headcount involved, matching the requirement that summary mode shows presence only. In Summary mode, `WeekView` renders one subcolumn per visible service per day (reusing `getVisibleServiceColumns`), each subcolumn showing merged bars; clicking a day's summary area calls the new `onDayClick` prop, which the page wires to `setDate` + `setView('day')`.

`weekViewMode` and `weekSelectedServices` are both lifted to `BookingCalendar()` state (not local to `WeekView`) because the page unmounts `WeekView` on every loading flicker during navigation.

## Data Models

No schema changes. The feature reads from existing tables only.

| Table | Used Fields | Purpose |
|-------|-------------|---------|
| `apt_bookings` | (existing) + `price` | Payment status needs the booking's own price |
| `svc_services` | `max_capacity` | Resource-less capacity ceiling; staff capacity ceiling |
| `res_resources` | `capacity` | Resource capacity ceiling (existing) |
| `res_schedule_blocks` | `resource_id`, `block_date`, `start_time`, `end_time`, `reason` | Resource block overlay (NEW read) |
| `pay_transactions` | `booking_id`, `type`, `status`, `amount` | Payment status derivation (NEW read) |
| `sys_location_hours` | `is_closed`, `open_time`, `close_time` | Business-hours time axis (NEW read, via existing `location-hours.service.ts`) |
| `sys_businesses` | `timezone` | Timezone-correct query windowing and month bucketing |

**API Response Shape (day/week, additions only)**

```typescript
{
  bookings: Array<{
    // ...existing fields...
    staff_id: string | null,          // NEW — needed for per-staff subcolumns/timelines
    service_max_capacity: number | null,  // NEW
    payment_status: 'paid' | 'partial' | 'unpaid',  // NEW
  }>,
  resourceTimelines: Record<string, CapacitySegment[]>,  // existing, capacity now per-booking internally
  staffTimelines: Record<string, CapacitySegment[]>,     // NEW
  resourceBlocks: Record<string, Array<{ start_time: string; end_time: string; reason: string | null }>>,  // NEW
}
```

**Month view**: `days[].date` is now a plain `YYYY-MM-DD` string (was previously a `Date`-serialized value subject to the node-postgres/host-timezone bug).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system.*

### Property 1: Capacity segments reflect true concurrent headcount and the correct capacity ceiling

*For any* set of bookings, each carrying its own `participant_count` and `capacity`, and *for any* segment returned by `computeCapacitySegments`: sampling that segment's own midpoint against a brute-force sweep of the source bookings reproduces the segment's `booked` value exactly, and the segment's `capacity` equals the maximum `capacity` among the bookings actually covering that midpoint.

**Validates: Requirements 5.1, 5.2**

### Property 2: Toggling a service filter off then back on returns to "all"

*For any* non-empty list of services and any single service within it, applying `toggleServiceFilter` to turn that service off and then applying it again to turn it back on returns the selection to the literal `'all'` value — not a `Set` that happens to contain every ID.

**Validates: Requirement 4.3**

## Error Handling

| Scenario | Handling |
|----------|----------|
| No `sys_location_hours` configured for the business | `computeHourRangeFromLocationHours` returns `DEFAULT_HOUR_RANGE` (7am–9pm) |
| A booking has no `resource_id` and no `staff_id` | It falls into the `'all'` subcolumn with `capacity = null`; `layoutCapacityChannel` falls back to equal-share layout |
| A resource block's `start_time`/`end_time` are both `null` (all-day block) | Defaulted to `00:00:00`–`23:59:59` before timezone conversion |
| A booking has zero `pay_transactions` rows | `netPaid` defaults to `0` → `derivePaymentStatus` returns `unpaid` |
| A booking's `price` is `0` or negative (comp/free booking) | `derivePaymentStatus` returns `paid` unconditionally — nothing is owed |
| `layoutCapacityChannel` cluster has no single contiguous run of free columns for a booking's required width (fragmented capacity, rare) | Falls back to the first available single column rather than dropping the booking |
| Month view timezone is missing on `sys_businesses` | Falls back to `'UTC'` |

## Testing Strategy

### Unit Tests

- `derivePaymentStatus`: boundary values for free bookings, exact/over payment, partial payment, zero/negative net paid (including an over-refund)
- `buildServiceSubcolumns` / `capacityForSubcolumn`: staff-linked vs resource-only grouping, "Unassigned" bucket, capacity source selection
- `layoutCapacityChannel`: capacity-null fallback, single booking, exactly-at-capacity, overbooked (shrink-to-fit), non-overlapping clusters, and a **named regression case** reproducing the real 4-booking Fire & Ice scenario that exposed the reclaiming bug, asserting no two concurrently-active blocks ever occupy overlapping horizontal space
- `mergeBookingRanges`: single booking, overlapping/back-to-back merge, gapped ranges stay separate, empty input
- `filterBlocksToDay` / `ResourceBlockOverlay`: day filtering, reason label vs generic "Blocked" fallback, empty-list no-render
- `WeekModeToggle`: active-mode highlighting and `onChange` wiring
- `QuickFilterBar` / `isServiceVisible`: chip toggling, empty-list no-render

### Property-Based Tests

Property tests use **fast-check**, minimum 100 iterations, tagged `// Feature: 33-calendar-redesign, Property N: <description>`.

- **P1** (Requirements 5.1, 5.2): Arbitrary bookings with random `participant_count`/`capacity` → every returned segment's `booked` matches a brute-force sweep at its own midpoint, and `capacity` equals the max capacity of covering bookings
- **P2** (Requirement 4.3): Arbitrary service lists → toggling a service off then on returns the selection to `'all'`

### Integration Tests

- Month view: a booking at 11pm business-local time (fixed-offset test timezone, no DST) buckets under its own local day, not the next UTC day
- `staffTimelines`: two staff members running a capacity-4 class at the same time show independent segments (one full, one not); a single staff member's capacity ceiling switches between segments when they move from one service to another
- `resourceBlocks`: a resource schedule block is surfaced and converted to UTC correctly for a day the resource has bookings on; absent for days/resources with no blocks
- Payment status: full charge → `paid`; partial charge → `partial`; no transactions → `unpaid`; full refund after a charge → `unpaid` again; a `pending`-status charge does not count
- Calendar response includes `service_id`, `resource_capacity`, `service_max_capacity`, `staff_id`, and `payment_status` on every day/week booking

### Not property-tested

- The SQL queries themselves — covered by integration tests against a real DB
- CSS custom property values and `color-mix()` support — code review
- The existing availability service — not touched
