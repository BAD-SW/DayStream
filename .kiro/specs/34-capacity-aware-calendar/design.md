# Design Document

## Overview

Enhance the existing `BookingCalendar` page (`packages/client/src/pages/BookingCalendar.tsx`) and its backing service (`booking-calendar.service.ts`) in-place. No new routes, no new tables, and no schema migrations are required.

The changes are:

- **Backend**: Extend `getCalendar()` to JOIN `res_resources` and COUNT concurrent bookings, adding `resource_capacity`, `slot_booking_count`, and `service_id` to every booking object in day/week responses.
- **Frontend**: Replace status-colour coding with service-colour coding from a CSS-variable palette; add capacity fill badges; restructure the day view into per-service columns with a visibility toggle; add a service filter dropdown to the week view.

The availability calculation service (`availability.service.ts`) is **not touched**.

## Architecture

```
Frontend (React + TypeScript)
┌────────────────────────────────────────────────────────┐
│ BookingCalendar (page)                                  │
│  ├── useServiceColours()     — colour assignment hook   │
│  ├── ServiceLegend           — colour legend component  │
│  ├── ServiceColumnFilter     — day-view toggle panel    │
│  ├── ServiceFilterDropdown   — week-view filter         │
│  ├── DayView (refactored)    — per-service columns      │
│  ├── WeekView (refactored)   — with service filter      │
│  └── MonthView (unchanged)                              │
└──────────────────┬─────────────────────────────────────┘
                   │  GET /api/v1/bookings/calendar
                   │  (no new query params required)
Backend (Express + TypeScript)
┌──────────────────▼─────────────────────────────────────┐
│ bookings.ts (route — unchanged)                         │
│  └── booking-calendar.service.ts (extended getCalendar) │
│       ├── apt_bookings  (existing)                      │
│       ├── svc_services  (existing JOIN)                 │
│       ├── res_resources (new LEFT JOIN for capacity)    │
│       └── correlated sub-query: COUNT concurrent slots  │
└────────────────────────────────────────────────────────┘
```

Key constraints honoured:
- No ORM — raw SQL via `adminPool`
- No changes to `availability.service.ts`
- All frontend colours via CSS custom properties

## Components and Interfaces

### Backend: Extended Calendar Booking Type

```typescript
// packages/server/src/services/booking-calendar.service.ts

interface CalendarBooking {
  id: string;
  service_id: string;                 // NEW
  service_name: string;
  customer_name: string;
  staff_name: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_type: string;
  booking_reference: string;
  resource_capacity: number | null;   // NEW — from res_resources.capacity
  slot_booking_count: number | null;  // NEW — COUNT of active bookings on same resource+slot
  participants?: number;
}
```

### Backend: Extended SQL Query

The day/week query is extended with a LEFT JOIN on `res_resources` and a correlated subquery:

```sql
SELECT
  b.id,
  b.service_id,
  b.start_time,
  b.end_time,
  b.status,
  b.booking_type,
  b.booking_reference,
  s.name AS service_name,
  COALESCE(c.first_name || ' ' || c.last_name, b.walk_in_name, 'Walk-in') AS customer_name,
  COALESCE(u.first_name || ' ' || u.last_name, '') AS staff_name,
  r.capacity AS resource_capacity,
  CASE
    WHEN b.resource_id IS NULL THEN NULL
    ELSE (
      SELECT COUNT(*)::int
      FROM apt_bookings b2
      WHERE b2.resource_id  = b.resource_id
        AND b2.start_time   = b.start_time
        AND b2.business_id  = b.business_id
        AND b2.status IN ('pending', 'confirmed', 'in_progress')
    )
  END AS slot_booking_count
FROM apt_bookings b
JOIN  svc_services   s ON s.id = b.service_id
LEFT JOIN cus_customers c ON c.id = b.customer_id
LEFT JOIN usr_users     u ON u.id = b.staff_id
LEFT JOIN res_resources r ON r.id = b.resource_id
WHERE <existing conditions>
ORDER BY b.start_time
```

The correlated subquery executes once per booking row. For typical calendar windows (≤ ~100 bookings), this is acceptable. An index on `(resource_id, start_time, business_id)` already exists on `apt_bookings` from migration 011.

### Frontend: Service Colour Assignment

```typescript
// Palette of 8 CSS custom property names (added to design-system tokens)
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

/**
 * Assigns a CSS variable name to each unique service_id.
 * Services sorted alphabetically → deterministic assignment within a session.
 * Wraps (modulo 8) when there are more than 8 services.
 */
function buildServiceColorMap(
  services: Array<{ id: string; name: string }>
): Map<string, string> {
  const sorted = [...services].sort((a, b) => a.name.localeCompare(b.name));
  const map = new Map<string, string>();
  sorted.forEach((svc, i) => {
    map.set(svc.id, SERVICE_COLOR_VARS[i % SERVICE_COLOR_VARS.length]);
  });
  return map;
}
```

### Frontend: Capacity Badge

```typescript
type FillState = 'available' | 'almost-full' | 'full';

function getFillState(count: number, capacity: number): FillState {
  if (count >= capacity)         return 'full';
  if (count === capacity - 1)    return 'almost-full';
  return 'available';
}

// CSS variable mapping applied as inline background:
// 'available'   → var(--color-success)
// 'almost-full' → var(--color-warning)
// 'full'        → var(--color-error)
```

The badge renders as a small `<span>` in the booking block corner: `{slot_booking_count}/{resource_capacity}`. Renders nothing when either prop is null.

### Frontend: Refactored DayView

```
DayView
├── props: bookings, date, timezone, onBookingClick, serviceColorMap
├── Derives: serviceColumns = distinct service_ids, sorted by service name
├── Local state: visibleServices: Set<string> (initially all)
├── Renders:
│   ├── ServiceColumnFilter panel (checkbox per service)
│   ├── Grid: [TimeAxis 60px] [ServiceCol-A] [ServiceCol-B] ...
│   └── Each ServiceCol renders only its service's booking blocks
│       with background: var(--cal-service-color-N)
│       and CapacityBadge in block top-right corner
```

Column order: alphabetically by service name. Time axis (hours 7–20) is a shared fixed left column. Toggle updates local state only — no API call.

### Frontend: Refactored WeekView

```
WeekView
├── props: bookings, date, timezone, onBookingClick, serviceColorMap
├── Local state: selectedServices: 'all' | Set<string> (initially 'all')
├── Renders:
│   ├── ServiceFilterDropdown above grid
│   │   ├── "All Services" option
│   │   └── One checkbox per distinct service in week's bookings
│   ├── visibleBookings = selectedServices === 'all'
│   │     ? bookings
│   │     : bookings.filter(b => selectedServices.has(b.service_id))
│   └── Standard 7 day columns (Mon–Sun) — always rendered
│       Each day column filters visibleBookings to its date
│       Booking blocks use var(--cal-service-color-N) + CapacityBadge
```

Filter state lives in WeekView component state — persists while the week view is active.

### CSS Token Additions

New tokens added to `packages/client/src/design-system/tokens/colors.css`:

```css
:root {
  /* Calendar service colour palette */
  --cal-service-color-1: #4A90A4;   /* Recovery Blue  */
  --cal-service-color-2: #C9A96E;   /* Warm Gold       */
  --cal-service-color-3: #7B9E6B;   /* Sage Green      */
  --cal-service-color-4: #A4756A;   /* Terracotta      */
  --cal-service-color-5: #7A6AA4;   /* Lavender        */
  --cal-service-color-6: #A44A7B;   /* Rose            */
  --cal-service-color-7: #4AA47B;   /* Mint            */
  --cal-service-color-8: #A4934A;   /* Olive           */
}
```

## Data Models

No database schema changes are needed. The feature reads from existing tables only.

| Table | Used Fields | Purpose |
|-------|-------------|---------|
| `apt_bookings` | `id`, `service_id`, `resource_id`, `start_time`, `end_time`, `status`, `booking_type`, `booking_reference`, `business_id`, `customer_id`, `staff_id`, `walk_in_name` | Source of calendar events |
| `svc_services` | `id`, `name` | Service name for display and colour lookup |
| `res_resources` | `id`, `capacity` | Resource total capacity for fill calculation |
| `cus_customers` | `id`, `first_name`, `last_name` | Customer name for block label |
| `usr_users` | `id`, `first_name`, `last_name` | Staff name for block label |

**API Response Shape (day/week)**

```typescript
{
  view: 'day' | 'week',
  date: string,
  start_date: string,
  end_date: string,
  bookings: Array<{
    id: string,
    service_id: string,              // NEW
    service_name: string,
    customer_name: string,
    staff_name: string,
    start_time: string,
    end_time: string,
    status: string,
    booking_type: string,
    booking_reference: string,
    resource_capacity: number | null,   // NEW
    slot_booking_count: number | null,  // NEW
    participants?: number,
  }>
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Service colour assignment is deterministic and complete

*For any* list of services, `buildServiceColorMap` assigns exactly one CSS variable name to every service. The assigned variable for the service at sorted index `i` is always `SERVICE_COLOR_VARS[i % 8]`. No two services within the same 0–7 palette cycle receive the same variable name.

**Validates: Requirements 1.1, 1.2**

### Property 2: Service legend contains every service

*For any* array of services passed to the legend renderer, the rendered legend output contains every service name exactly once.

**Validates: Requirement 1.3**

### Property 3: Booking block background uses service colour, not status colour

*For any* booking object with a known `service_id`, the CSS variable applied for the block's background is the one assigned to that service by `buildServiceColorMap` — it is never one of the hardcoded status colour values from the old `STATUS_COLORS` map.

**Validates: Requirement 1.4**

### Property 4: Fill state classification is complete and mutually exclusive

*For any* integers `count` (≥ 0) and `capacity` (≥ 1) where `count ≤ capacity`, `getFillState(count, capacity)` returns exactly one of `'available'`, `'almost-full'`, or `'full'`, with the following mapping:
- `count < capacity - 1` → `'available'`
- `count === capacity - 1` → `'almost-full'`
- `count >= capacity` → `'full'`

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 5: Day view column count equals distinct services with bookings

*For any* array of bookings, the day view renders exactly as many service columns as there are distinct `service_id` values present in the array. Services with zero bookings on that day produce no column.

**Validates: Requirements 3.1, 3.5**

### Property 6: Booking blocks are placed only in their matching service column

*For any* booking in a day view render, the column that contains the booking block has a `service_id` header equal to the booking's `service_id`.

**Validates: Requirement 3.3**

### Property 7: Service column toggle produces correct visible column set

*For any* set of services with bookings and any combination of toggle states, the set of rendered service columns equals the intersection of (services with at least one booking) and (services that are toggled on).

**Validates: Requirement 3.6**

### Property 8: Week view always renders exactly 7 day columns

*For any* filter state (including "all services", specific service subsets, or an empty result), the week view renders exactly 7 day header columns corresponding to Mon–Sun.

**Validates: Requirements 4.4, 4.5**

### Property 9: Week view service filter limits visible bookings to selected services

*For any* bookings array and any non-empty subset `S` of service IDs in the filter, every rendered booking block in the week view has a `service_id` that is a member of `S`.

**Validates: Requirement 4.3**

### Property 10: Week view "All Services" renders all bookings

*For any* bookings array, when the service filter is set to "all", the number of rendered booking blocks equals the total number of bookings in the array.

**Validates: Requirement 4.2**

### Property 11: slot_booking_count matches active concurrent booking count

*For any* set of bookings sharing the same `resource_id`, `start_time`, and `business_id`, the `slot_booking_count` value returned by the calendar API for each of those bookings equals the count of bookings in that group with status `pending`, `confirmed`, or `in_progress`.

**Validates: Requirement 5.3**

## Error Handling

| Scenario | Handling |
|----------|----------|
| Booking has `resource_capacity: null` | Frontend omits the capacity badge — no error thrown |
| Calendar API call fails | Existing catch handler sets `calendarData` to null; empty state shown |
| `service_id` not found in colour map (stale data race) | Fallback to `--cal-service-color-1`; no crash |
| `slot_booking_count > resource_capacity` (data inconsistency) | `getFillState` treats as `'full'` — no crash |
| Resource has `capacity = 0` (misconfigured data) | Badge renders `{count}/0`; `getFillState` returns `'full'` |

## Testing Strategy

### Unit Tests

- `buildServiceColorMap`: correct palette cycling for 1, 8, and 9 services
- `getFillState`: all three branches across boundary values
- `CapacityBadge` component: renders correct text; omits when capacity is null
- `ServiceLegend` component: renders all services with correct colour references
- `DayView` column generation: correct column count and booking placement
- `WeekView` filter logic: `visibleBookings` computation for "all" and specific subsets

### Property-Based Tests

Property tests use **fast-check** (TypeScript property-based testing library). Each test runs a minimum of **100 iterations**.

Tag format applied to each test: `// Feature: 34-capacity-aware-calendar, Property N: <description>`

- **P1** (Requirements 1.1, 1.2): Arbitrary service arrays (length 1–20) → map size = input length; variable = `SERVICE_COLOR_VARS[sortedIndex % 8]`; no duplicates within a palette cycle
- **P2** (Requirement 1.3): Arbitrary service arrays → legend render contains every service name
- **P3** (Requirement 1.4): Arbitrary booking objects with service_id → block CSS var is from colour map, never a STATUS_COLORS value
- **P4** (Requirements 2.2, 2.3, 2.4): Arbitrary (count, capacity) pairs where 0 ≤ count ≤ capacity ≥ 1 → returns correct category; exactly one of three values
- **P5** (Requirements 3.1, 3.5): Bookings with 1–10 distinct service_ids → column count = distinct service count
- **P6** (Requirement 3.3): Bookings across services → each block's column service_id matches the booking's service_id
- **P7** (Requirement 3.6): Service set + random toggle states → visible columns = bookings_services ∩ toggled_on
- **P8** (Requirements 4.4, 4.5): Any filter state → week view day column count = 7
- **P9** (Requirement 4.3): Bookings + random service subset filter → all rendered blocks have service_id ∈ filter set
- **P10** (Requirement 4.2): Any bookings array → "all" filter renders block count = bookings.length
- **P11** (Requirement 5.3): Groups of concurrent bookings with varying statuses → `slot_booking_count` = count of active-status bookings in group

### Integration Tests

- `GET /api/v1/bookings/calendar?view=day`: response includes `service_id`, `resource_capacity`, `slot_booking_count` on each booking
- Booking with resource: `resource_capacity` matches DB `res_resources.capacity` value
- Booking without resource: both capacity fields are `null`
- Multiple bookings on same resource+slot: `slot_booking_count` is correct on each

### Not property-tested

- The SQL query itself — covered by integration tests against a real DB
- CSS variable names being valid CSS — code review / linting
- The existing availability service — not touched
