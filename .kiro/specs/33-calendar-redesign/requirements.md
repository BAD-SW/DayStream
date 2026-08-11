# Requirements Document

## Introduction

Following hands-on use of the capacity-aware calendar (Feature 31) and smart booking flow (Feature 32), several navigation, filtering, and capacity-visualization gaps were identified in the `BookingCalendar` page. Month view bucketed bookings under the wrong calendar day. The service filter used inconsistent controls (checkboxes in day view, a dropdown in week view) alongside a redundant colour legend. The time axis was a hardcoded 7am–9pm window regardless of the business's real operating hours, and business-owner schedule blocks on a resource (e.g. a plumber visit) were invisible on the calendar. The per-resource capacity indicator introduced in Feature 31 had no per-staff equivalent and had lost its numeric labels. Day view packed bookings into equal-width time-overlap columns with no sense of how much of a resource's or staff member's capacity was actually consumed. There was no way to see at a glance whether a booking had been paid for. Week view showed either full per-booking detail or nothing in between.

This feature addresses all of the above without touching the availability calculation logic (`availability.service.ts`) or the booking creation/edit flows.

## Glossary

- **Calendar_UI**: The `BookingCalendar` page and its `DayView`/`WeekView`/`MonthView` subcomponents (`packages/client/src/pages/BookingCalendar.tsx`)
- **Calendar_API**: The `getCalendar()` service function and its route (`packages/server/src/services/booking-calendar.service.ts`, `GET /api/v1/bookings/calendar`)
- **Quick_Filter_Bar**: A multi-select pill-button control for filtering the calendar by service, used identically across all three views
- **Capacity Strip**: A narrow lane rendered per resource or per staff member showing concurrent-headcount fill over time, independent of any single booking block
- **Capacity Segment**: A contiguous time window during which a resource's or staff member's concurrent booked headcount and capacity ceiling stayed constant
- **Service Subcolumn**: In day view, a vertical sub-division of a service's column — one per distinct staff member when the service is staff-linked, otherwise a single subcolumn for the whole service
- **Capacity Channel**: The unit of capacity-proportional layout in day view — one resource, or one staff member's slice of a service
- **Resource Block**: A business-owner-defined blocked sub-range on a resource's schedule (`res_schedule_blocks`), e.g. "Plumber visit, 8–10am"
- **Payment Status**: A derived (not stored) classification of a booking as `paid`, `partial`, or `unpaid`, based on its payment transaction history
- **Detail Mode / Summary Mode**: The two week-view display modes — full per-booking detail, or a condensed one-subcolumn-per-service overview
- **HourRange**: The `{ start, end }` visible hour window used to size the day/week time-axis grid

## Requirements

### Requirement 1: Month View Date Accuracy

**User Story:** As a business owner, I want bookings to appear under the correct calendar day in month view, so that I can trust the monthly overview when planning.

#### Acceptance Criteria

1. THE Calendar_API SHALL bucket month-view booking counts by the business's own timezone, not a fixed UTC day boundary.
2. WHEN a booking's start time falls within a given local calendar day in the business's timezone, THE Calendar_API SHALL report that booking under that local day regardless of which UTC calendar day the same instant falls on.
3. THE Calendar_API SHALL return month-view day dates as plain date strings, not as a value that node-postgres or JSON serialization can silently reinterpret using the server host's own timezone.
4. THE Calendar_API SHALL apply the same business-timezone-aware windowing to day and week view query ranges, so bookings near local midnight are neither dropped nor double-counted.

### Requirement 2: Business-Hours-Aware Time Axis

**User Story:** As a business owner whose location is open 9am–10pm, I want the calendar's time axis to reflect those hours instead of a generic fixed window, so the grid isn't wasting space or clipping bookings.

#### Acceptance Criteria

1. THE Calendar_UI SHALL derive the visible hour range for day and week views from the business's actual location operating hours (`sys_location_hours`) rather than a fixed range.
2. THE Calendar_UI SHALL compute the visible hour range as the widest open span (earliest open time to latest close time) across the location's configured days.
3. IF no location hours are configured for the business, THEN THE Calendar_UI SHALL fall back to a default hour range (7am–9pm).
4. THE Calendar_UI SHALL floor the opening hour and ceil the closing hour to whole-hour boundaries when computing the visible range.

### Requirement 3: Resource Schedule Blocks on the Calendar

**User Story:** As a business owner, I want to see when I've blocked out part of a day for a specific resource (e.g. a plumber visiting a pool), so that a blank time slot isn't mistaken for simply "nothing booked yet."

#### Acceptance Criteria

1. WHEN a resource has one or more schedule blocks (`res_schedule_blocks`) whose date falls within the calendar's visible range, THE Calendar_API SHALL include those blocks in the day/week response, converted to UTC start/end instants using the business's timezone.
2. THE Calendar_UI SHALL render a resource's schedule blocks as a visually distinct overlay — separate from booking blocks and from the business-hours background — positioned at the correct time range within the grid.
3. THE Calendar_UI SHALL display the block's reason as a label and tooltip on the overlay; WHERE no reason is provided, THE Calendar_UI SHALL display a generic "Blocked" label.
4. THE resource block overlay SHALL be non-interactive and SHALL NOT intercept clicks intended for booking blocks.

### Requirement 4: Simplified, Consistent Quick-Filter UI

**User Story:** As a business staff member, I want one consistent, easy-to-click way to filter the calendar by service across all views, so that I don't have to relearn a different control for day, week, and month.

#### Acceptance Criteria

1. THE Calendar_UI SHALL remove the standalone service-colour legend that duplicated the service filter control.
2. THE Calendar_UI SHALL replace checkbox-based (day view) and dropdown-based (week view) service filters with a single Quick_Filter_Bar component used identically across day, week, and month views.
3. THE Quick_Filter_Bar SHALL support multi-select: any combination of services can be shown or hidden, with an "All Services" option that clears the selection back to showing everything.
4. IN day and week views, THE Quick_Filter_Bar SHALL filter bookings client-side from already-fetched calendar data.
5. IN month view, THE Quick_Filter_Bar selection SHALL be sent to the Calendar_API as a service filter so the per-day counts reflect only the selected services.

### Requirement 5: Per-Entity Capacity Strips With Numeric Labels

**User Story:** As a business staff member, I want to see capacity fill separately for each staff member and each resource, with the actual numbers visible (not just a colour), so I can tell at a glance which specific coach or room is full.

#### Acceptance Criteria

1. THE Calendar_API SHALL compute a capacity timeline (a sequence of Capacity Segments) independently for each resource and for each staff member appearing in the requested view.
2. THE Calendar_API SHALL derive a staff member's capacity ceiling, for any given segment, from the `max_capacity` of whichever service(s) they are actively running during that segment.
3. THE Calendar_UI SHALL render one Capacity Strip per resource and one per staff member referenced by a service's bookings, each positioned and labelled independently.
4. THE Calendar_UI SHALL display the booked/capacity numbers (e.g. "2/3") directly on each capacity segment, not only in a hover tooltip.
5. WHEN concurrent bookings exceed a segment's capacity, THE Calendar_UI SHALL visually distinguish the over-capacity state from the available/almost-full/full states.

### Requirement 6: Day View Capacity-Proportional Layout

**User Story:** As a business staff member viewing a single day, I want a booking's width to reflect how much of the available capacity it uses, with staff-linked services broken into one lane per staff member, so I can read utilisation directly from the layout instead of doing mental math.

#### Acceptance Criteria

1. IN day view, WHEN a service is linked to one or more staff members, THE Calendar_UI SHALL render one Service Subcolumn per distinct staff member within that service's column.
2. IN day view, WHEN a service has no staff link, THE Calendar_UI SHALL treat the service's resource (if any) as a single Capacity Channel for the whole column.
3. WITHIN a Capacity Channel, THE Calendar_UI SHALL size each booking block's width proportionally to its participant count relative to the channel's capacity.
4. WITHIN a Capacity Channel, THE Calendar_UI SHALL render unused capacity as a distinct greyed "available" filler alongside the booked portion.
5. WHEN concurrent bookings in a channel exceed its capacity, THE Calendar_UI SHALL shrink booking widths proportionally so they always sum to at most 100% of the channel width, with no available filler shown.
6. THE Calendar_UI SHALL NOT render two concurrently-active bookings in the same channel at overlapping horizontal positions, including when a later booking's slot was vacated by an earlier-ending one.
7. WHEN a channel has no capacity concept (no resource, no staff-service capacity), THE Calendar_UI SHALL fall back to the pre-existing equal-share time-overlap layout.

### Requirement 7: Payment Status Indicator

**User Story:** As a business staff member, I want to see whether a booking has been paid for without opening it, so I know at a glance which customers still owe money.

#### Acceptance Criteria

1. THE Calendar_API SHALL derive a Payment Status (`paid` | `partial` | `unpaid`) for each booking from completed charge, refund, and credit transactions in `pay_transactions`, compared against the booking's own price.
2. WHEN a booking has no associated payment transactions, THE Calendar_API SHALL report its payment status as `unpaid`.
3. WHEN net paid meets or exceeds the booking's price, THE Calendar_API SHALL report the payment status as `paid`.
4. WHEN net paid is greater than zero but less than the booking's price, THE Calendar_API SHALL report the payment status as `partial`.
5. THE Calendar_UI SHALL render Payment Status as a coloured left border stripe on the booking block (green = paid, amber = partial, red = unpaid), independent of the block's service-colour fill.
6. ONLY transactions with `status = 'completed'` SHALL count toward a booking's net paid amount; pending, failed, and cancelled transactions SHALL be excluded.

### Requirement 8: Week View Detail and Summary Modes

**User Story:** As a business staff member viewing the week, I want an option to see a condensed overview of which services are busy on which days, without the full per-booking clutter, and a quick way to drill into a day for detail.

#### Acceptance Criteria

1. THE Calendar_UI SHALL provide a mode toggle in week view with two options: Detail and Summary.
2. IN Detail mode, THE Calendar_UI SHALL retain the existing per-booking rendering (capacity strips, resource blocks, payment status stripes, participant counts).
3. IN Summary mode, THE Calendar_UI SHALL render one Service Subcolumn per visible service per day, showing only merged booked-hour ranges with no per-booking time, staff, or headcount detail.
4. IN Summary mode, overlapping or back-to-back bookings for the same service on the same day SHALL merge into a single contiguous visual range.
5. WHEN a user clicks a summary range, THE Calendar_UI SHALL navigate to day view for that date.
6. THE week view mode and Quick_Filter_Bar selection SHALL persist across week navigation within the same session.

---

## Dependencies

- Feature 31 (Capacity-Aware Calendar): `BookingCalendar` page, service-colour palette, `getCalendar()` baseline
- Feature 32 (Smart Booking Flow): resource/staff combo generation this feature's capacity math builds on
- Feature 07 (Booking Engine): `apt_bookings` table and calendar endpoint
- Feature 09 (Service Management): `svc_services.max_capacity`
- Feature 12 (Staff Management): staff identity used for per-staff capacity strips and subcolumns
- Feature 13 (Resource Management): `res_resources.capacity`, `res_schedule_blocks`
- Feature 10 (Payment Platform): `pay_transactions` table
- Location operating hours (`sys_location_hours`, part of Feature 03 Core Platform / business setup)

## Success Criteria

- A booking made for a given local calendar day always appears under that day in month view, regardless of the business's timezone offset from UTC
- The calendar's time axis matches the business's actual configured hours instead of a fixed window
- A resource schedule block (e.g. a maintenance visit) is visible on the calendar as a distinct overlay
- Every view uses the same quick-filter button control; no checkboxes or dropdowns remain
- Two staff members running the same service at the same time show independent capacity strips with visible numbers, not one ambiguous shared indicator
- In day view, a booking's width visibly reflects its share of the resource's or staff member's capacity, with a clear grey filler for remaining capacity
- A booking's payment status is visible on the calendar without opening it
- Week view can show either full detail or a condensed per-service summary, with one click from summary into the corresponding day

## Out of Scope

- Creating, editing, or cancelling bookings from the calendar view — the calendar remains read-only
- Modifying the availability calculation service or any availability logic
- Business/location-wide (non-resource) schedule blocking — this feature covers resource-level blocks only, using the existing `res_schedule_blocks` table
- A UI for creating or editing payment transactions from the calendar — payment status is read-only here
- Real-time calendar updates (WebSocket/polling) — the calendar refreshes only on navigation

## Notes

- The month-view date bug had two independent causes: SQL bucketing on a hardcoded `'UTC'` timezone instead of the business's own, and a node-postgres driver behaviour where a `date`-typed column is parsed into a JS `Date` using the *server process's own* local timezone, silently shifting the day again on JSON serialization. Both are fixed; the fix casts the bucketed date to `text` in SQL so no `Date` object round-trip ever happens.
- A staff member's capacity ceiling is not a fixed property of the staff member — it is derived per segment from whichever service they are actively running, since one staff member may run both a 1:1 service and a small-group class on the same day.
- The day-view capacity-proportional layout uses an integer unit-column bin-packing model (not a "stack after the rightmost occupied edge" model) specifically so that a later booking can reclaim a column freed by an earlier-ending one — an initial "stack right" implementation was found, via live testing against real data, to squeeze a reclaiming booking to near-zero width instead.
- Payment status is intentionally derived at read time rather than stored, since `pay_transactions` already supports multiple charges/refunds/credits per booking (deposit + balance, partial refund, etc.) and a stored status would need to be kept in sync with that ledger.

---

**Status**: ✅ Complete
**Dependencies**: Feature 31, Feature 32, Feature 07, Feature 09, Feature 10, Feature 12, Feature 13
**Next Phase**: None — implemented, tested, and verified against live data
