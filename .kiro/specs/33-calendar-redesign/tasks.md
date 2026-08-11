# Implementation Plan: Calendar Redesign

## Overview

Implementation proceeded in the same order the underlying issues were reported: fix the month-view date bug first (self-contained, no schema/UI dependencies), then collapse the filter UI, then layer in business-hours awareness, per-staff capacity, the day-view capacity-proportional rewrite, resource blocks, payment status, and finally the week-view summary mode. Each wave ended with the full calendar test suite green before moving on.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4"] },
    { "wave": 5, "tasks": ["5"] },
    { "wave": 6, "tasks": ["6"] },
    { "wave": 7, "tasks": ["7"] },
    { "wave": 8, "tasks": ["8"] },
    { "wave": 9, "tasks": ["9"] }
  ]
}
```

## Tasks

- [x] 1. Fix month view date-bucketing
  - [x] 1.1 Add business-timezone-aware date helpers to `booking-calendar.service.ts`
    - Add `zonedDateTimeToUtc(dateStr, timeStr, timeZone)` and rewrite `zonedMidnightToUtc` in terms of it
    - Fetch `sys_businesses.timezone` once per `getCalendar()` call, falling back to `'UTC'`
    - Replace `getDateRange` with `getDateRangeYMD` (pure calendar-date arithmetic) + explicit UTC-instant conversion for query windows
    - _Requirements: 1.1, 1.4_
  - [x] 1.2 Fix month-view SQL to bucket by business timezone and cast to text
    - Replace hardcoded `DATE(b.start_time AT TIME ZONE 'UTC')` with `DATE(b.start_time AT TIME ZONE $timezone)::text`
    - _Requirements: 1.2, 1.3_
  - [x]* 1.3 Write integration test: a booking at 11pm business-local time (fixed-offset zone) buckets under its own local day
    - _Requirements: 1.2_

- [x] 2. Checkpoint — month-view fix verified live against real seeded data (Aug 17 booking correctly shown under the 17th)

- [x] 3. Collapse filter UI into one Quick Filter Bar
  - [x] 3.1 Remove `ServiceLegend`, `ServiceColumnFilter` (day-view checkboxes), `ServiceFilterDropdown` (week-view dropdown)
    - _Requirements: 4.1, 4.2_
  - [x] 3.2 Implement `ServiceFilterSelection`, `isServiceVisible`, `toggleServiceFilter`, `QuickFilterBar`
    - Multi-select pill buttons; toggling every service back on collapses to `'all'`
    - _Requirements: 4.2, 4.3_
  - [x] 3.3 Wire `QuickFilterBar` into day view (local state) and week view (lifted to `BookingCalendar()` state, survives unmount)
    - _Requirements: 4.2, 4.4_
  - [x] 3.4 Extend `CalendarQuery.serviceIds: string[]` (was singular `serviceId`) and the route's CSV parsing; wire month view's filter to the server
    - _Requirements: 4.5_
  - [x]* 3.5 Write property test: toggling a service off then on returns the selection to `'all'`
    - **Property 2: Toggling a service filter off then back on returns to "all"**
    - **Validates: Requirement 4.3**

- [x] 4. Business-hours-aware time axis
  - [x] 4.1 Add `HourRange`, `DEFAULT_HOUR_RANGE`, `buildHoursArray`, `computeHourRangeFromLocationHours`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 4.2 Fetch the business's primary location hours in `BookingCalendar()` and thread `hourRange` through `getTimeRangePosition`, `layoutBookings`, `CapacityStrip`, day/week grids
    - Replaces the old module-level fixed `HOURS` constant
    - _Requirements: 2.1_
  - [x]* 4.3 Verify live against real data: Transcend Health's widest hours (9am–8pm) replace the old hardcoded 7am–9pm

- [x] 5. Per-staff capacity strips with restored numeric labels
  - [x] 5.1 Extend `computeCapacitySegments` to carry `capacity` per booking instead of one fixed argument
    - Segment `capacity` = max of covering bookings' own capacity
    - _Requirements: 5.1, 5.2_
  - [x] 5.2 Add `staff_id`, `service_max_capacity` to the calendar SELECT and `CalendarBooking`; build `staffTimelines` alongside the existing `resourceTimelines`
    - _Requirements: 5.1, 5.2_
  - [x] 5.3 Widen `CapacityStrip` and add a visible `{booked}/{capacity}` label per segment (previously tooltip-only); add `entityLabel` for staff/resource name in the tooltip
    - _Requirements: 5.3, 5.4, 5.5_
  - [x] 5.4 Add `buildCapacityLanes` — one lane per distinct resource and per distinct staff member referenced by a set of bookings
    - _Requirements: 5.3_
  - [x]* 5.5 Write property test: capacity segments reflect true concurrent headcount and correct capacity ceiling
    - **Property 1: Capacity segments reflect true concurrent headcount and the correct capacity ceiling**
    - **Validates: Requirements 5.1, 5.2**
  - [x]* 5.6 Write integration tests: two staff members running the same class show independent segments; one staff member's capacity ceiling switches between services
  - [x]* 5.7 Verify live: Sport Massage's two staff members each show an independently labelled "1/1" strip

- [x] 6. Checkpoint — capacity strip tests pass; live-verified

- [x] 7. Day view capacity-proportional layout
  - [x] 7.1 Add `buildServiceSubcolumns` (staff-linked → one subcolumn per staff member; otherwise one `'all'` subcolumn) and `capacityForSubcolumn`
    - _Requirements: 6.1, 6.2_
  - [x] 7.2 Implement `layoutCapacityChannel`: overlap-cluster grouping, peak-concurrency denominator, integer unit-column bin-packing with reclaiming, available-filler derivation from the same column assignments
    - _Requirements: 6.3, 6.4, 6.5, 6.6_
  - [x] 7.3 Fall back to existing `layoutBookings` equal-share layout when a channel has no capacity concept
    - _Requirements: 6.7_
  - [x] 7.4 Rewrite `DayView` to render subcolumns via `layoutCapacityChannel`, dropping the old resource-only side-lane strips in favour of width-encoded capacity
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x]* 7.5 Write unit tests: capacity-null fallback, single booking, exact-capacity, overbooked shrink-to-fit, non-overlapping clusters
  - [x]* 7.6 Write regression test reproducing the real 4-booking Fire & Ice scenario (found via live testing) where a naive "stack right" placement squeezed a reclaiming booking to near-zero width; assert no two concurrently-active blocks overlap horizontally
    - _Requirements: 6.6_
  - [x]* 7.7 Verify live: the previously-broken 4th booking correctly reclaims a freed column instead of being squeezed to ~0% width

- [x] 8. Resource schedule blocks on the calendar
  - [x] 8.1 Query `res_schedule_blocks` for resources present in the requested view, convert to UTC via `zonedDateTimeToUtc`, return as `resourceBlocks` on the calendar response
    - _Requirements: 3.1_
  - [x] 8.2 Add `filterBlocksToDay` and `ResourceBlockOverlay` (diagonal-hatch, `color-mix()`-blended background so the label stays legible, `pointer-events: none`)
    - _Requirements: 3.2, 3.3, 3.4_
  - [x] 8.3 Render `ResourceBlockOverlay` in day view's resource-primary subcolumn and in week view's per-resource capacity-strip lane
    - _Requirements: 3.2_
  - [x]* 8.4 Write integration tests: a block is surfaced and correctly converted to UTC for a resource with bookings that day; absent for unblocked resources/days
  - [x]* 8.5 Verify live: an 8–10am block on a 9am-opening business correctly clips to the visible 9–10am portion with a "Blocked: Plumber visit" label

- [x] 9. Payment status indicator
  - [x] 9.1 Add `PaymentStatus`, `derivePaymentStatus(price, netPaid)`, and the `pay_transactions` aggregate query (completed charges minus completed refunds/credits)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  - [x] 9.2 Add `price`, `payment_status` to the calendar SELECT and `CalendarBooking`
    - _Requirements: 7.1_
  - [x] 9.3 Split `bookingBlock`'s uniform border into a neutral top/right/bottom separator and a 4px `borderLeft` driven by payment status colour, independent of the service-colour background
    - _Requirements: 7.5_
  - [x]* 9.4 Write unit tests for `derivePaymentStatus` boundary values (free booking, exact/over payment, partial, zero/negative net paid)
  - [x]* 9.5 Write integration tests: full charge → paid; partial → partial; no transactions → unpaid; full refund → unpaid again; pending-status charge excluded
  - [x]* 9.6 Verify live: green/amber/red stripes render correctly and independently of the teal/tan service fill

- [x] 10. Week view detail/summary modes
  - [x] 10.1 Add `WeekViewMode`, `WeekModeToggle`; lift `weekViewMode` to `BookingCalendar()` state alongside the existing lifted filter state
    - _Requirements: 8.1, 8.6_
  - [x] 10.2 Add `mergeBookingRanges` (interval merge, no capacity/headcount) and render Summary mode as one subcolumn per visible service per day
    - _Requirements: 8.3, 8.4_
  - [x] 10.3 Add `onDayClick` prop; Summary-mode bars navigate to day view for that date
    - _Requirements: 8.5_
  - [x] 10.4 Confirm Detail mode is unchanged (capacity strips, resource blocks, payment stripes, participant counts all still render)
    - _Requirements: 8.2_
  - [x]* 10.5 Write unit tests: `mergeBookingRanges` (single/overlapping/back-to-back/gapped/empty); `WeekModeToggle` highlighting and `onChange`; summary mode renders one subcolumn per service with no customer-name/detail text leaking through
  - [x]* 10.6 Verify live: Summary mode shows clean per-service bars; clicking navigates to day view showing full detail

- [x] 11. Final checkpoint — full calendar suite green (56 client + 41 server tests), typecheck clean, all items verified against live seeded data

## Notes

- Tasks marked with `*` are test sub-tasks; all were completed rather than skipped for this feature
- `service_max_capacity`, `staff_id`, `price`, and `payment_status` are additive fields on the existing calendar response — no breaking changes for any other consumer of `getCalendar()`
- `availability.service.ts` was not imported, called, or modified at any point
- Property tests use **fast-check**; each carries the tag `// Feature: 33-calendar-redesign, Property N: <description>`
- Three items from the originating feedback are explicitly deferred, not part of this feature: business/location-wide (non-resource) schedule blocking, a UI for recording payments from the calendar, and any change to the availability calculation service
