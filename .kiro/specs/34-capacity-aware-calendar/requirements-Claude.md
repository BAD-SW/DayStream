# Requirements Document (Claude-amended)

> ## ⚠️ Amendments to the original requirements.md (2026-08-06)
>
> Discovered while implementing `32-smart-booking-flow` (see that feature's `requirements-Claude.md`
> for the full "why" — agreed with the user in conversation, not from a KIRO spec update).
>
> **Requirement 5.3 is revised.** Original text: *"THE Calendar_API SHALL derive
> `slot_booking_count` by counting bookings with status in (pending, confirmed, in_progress) that
> share the same `resource_id`, `start_time`, and `business_id`."* That's an exact-`start_time`
> match, which misses staggered overlapping bookings of different durations — e.g. a 90min booking
> at 6:00pm and a 30min booking at 6:30pm on the same resource both occupy the resource at 6:45pm
> but don't share a `start_time`, so the old logic wouldn't count them together.
>
> **Revised 5.3:** `slot_booking_count` for a given booking is the **sum of `participant_count`**
> (new column, see `32-smart-booking-flow`'s `design-Claude.md`) across all active-status
> (`pending`/`confirmed`/`in_progress`) bookings on the same `resource_id` + `business_id` whose
> time range **overlaps** that booking's time range (`start_time < otherEnd AND end_time >
> otherStart`), not just those sharing its exact `start_time`.
>
> **New: over-capacity is a 4th, distinct fill state.** Because a business owner can now create a
> booking that intentionally exceeds a resource's capacity (feature 32's admin override), a slot
> can end up with `slot_booking_count > resource_capacity`. The original 3-state model (available /
> almost-full / full, Requirement 2.2–2.4) has no way to distinguish "exactly at capacity" from
> "deliberately over capacity by admin override" — both would show as `'full'`. A 4th state,
> `'over-capacity'` (`count > capacity`, strictly greater), is added with its own distinct visual
> treatment so staff can tell the two apart at a glance on the calendar, per the original user
> request that an override booking "should be highlighted in the calendar."
>
> Everything below this point is the original, unmodified KIRO requirements.md.

---

## Introduction

Enhance the existing `BookingCalendar` page to give business staff a richer operational view. The calendar currently colours booking blocks by status and uses a single merged column per day. This feature adds service-based colour coding, capacity fill indicators, per-service day-view columns, and a service filter for the week view. The backend calendar endpoint is extended to supply resource capacity and concurrent booking counts so the frontend can render fill indicators.

The calendar remains a **read-only view** — it shows existing bookings and does not create them. Availability calculation logic in the existing availability service is explicitly out of scope and must not be touched.

## Glossary

- **Calendar View**: The `BookingCalendar` page showing bookings in day, week, or month layout
- **Service Colour Palette**: A set of 8 CSS custom property variables (`--cal-service-color-1` through `--cal-service-color-8`) used to assign distinct colours to services
- **Capacity Badge**: A small badge rendered on a booking block displaying `booked/capacity` with a fill-state colour
- **Fill State**: One of three states — available (green), almost-full (amber), full (red) — derived from the ratio of booked slots to resource capacity
- **Slot Booking Count**: The number of active bookings (status: pending, confirmed, or in_progress) sharing the same resource, start time, and business as a given booking
- **Resource Capacity**: The integer `capacity` field on the `res_resources` table, representing the maximum simultaneous occupants of a resource
- **Service Column**: In day view, a dedicated vertical column for a single service
- **Service Filter**: In week view, a dropdown/multi-select control that limits which services' bookings are displayed

## Requirements

### Requirement 1: Service Colour Palette

**User Story:** As a business staff member, I want each service to be displayed in a distinct colour, so that I can identify services at a glance without reading the text on every block.

#### Acceptance Criteria

1. THE Calendar_UI SHALL assign each service a colour from a predefined palette of CSS custom properties (`--cal-service-color-1` through `--cal-service-color-8`).
2. WHEN a business has more services than palette slots, THE Calendar_UI SHALL cycle through the palette using modulo assignment.
3. THE Calendar_UI SHALL render a colour legend above the calendar grid showing each service name paired with its assigned colour.
4. THE Calendar_UI SHALL colour booking blocks using the assigned service colour, not the booking status colour.
5. THE Calendar_UI SHALL apply all service colours using CSS custom properties exclusively — no hardcoded hex values or Tailwind utility classes.

### Requirement 2: Capacity Fill Indicator

**User Story:** As a business staff member, I want to see how many spots are booked versus the total capacity for each time slot, so that I can quickly spot full or nearly-full resources.

#### Acceptance Criteria

1. WHEN a booking block is rendered in day or week view, THE Calendar_UI SHALL display a badge showing `booked/capacity` (e.g. `2/3`).
2. WHEN the booking count is less than capacity minus one, THE Calendar_UI SHALL render the badge with the success semantic colour (`var(--color-success)`).
3. WHEN exactly one spot remains (capacity − booked = 1), THE Calendar_UI SHALL render the badge with the warning semantic colour (`var(--color-warning)`).
4. WHEN the slot is at full capacity (booked = capacity), THE Calendar_UI SHALL render the badge with the error semantic colour (`var(--color-error)`).
5. IF a booking has no associated resource or the resource has no capacity value, THEN THE Calendar_UI SHALL omit the capacity badge for that booking block.
6. THE Calendar_API SHALL return `resource_capacity` (integer or null) and `slot_booking_count` (integer or null) for each booking in day and week view responses.

### Requirement 3: Day View — Per-Service Columns

**User Story:** As a business staff member viewing a single day, I want each service to occupy its own column, so that I can read bookings across services without blocks overlapping each other.

#### Acceptance Criteria

1. WHEN the calendar is in day view, THE Calendar_UI SHALL render one column per active service that has at least one booking on the selected day.
2. THE Calendar_UI SHALL display each service column header with the service name and its assigned service colour.
3. THE Calendar_UI SHALL place booking blocks only within the column that corresponds to the booking's service.
4. THE Calendar_UI SHALL share a single set of time-axis labels on the left side of the grid across all service columns.
5. WHEN no bookings exist for a service on the selected day, THE Calendar_UI SHALL omit that service's column from the day view grid.
6. THE Calendar_UI SHALL provide a service visibility toggle panel so staff can show or hide individual service columns.
7. WHEN a service is hidden via the toggle, THE Calendar_UI SHALL remove that service's column from the day view grid without making a new server request.

### Requirement 4: Week View — Service Filter

**User Story:** As a business staff member viewing the week, I want to filter bookings by one or more services, so that I can focus on the services relevant to my role.

#### Acceptance Criteria

1. WHEN the calendar is in week view, THE Calendar_UI SHALL display a service filter control above the calendar grid.
2. THE Service_Filter SHALL include an "All Services" option that, when selected, shows all bookings colour-coded by service.
3. WHEN one or more specific services are selected in the filter, THE Calendar_UI SHALL display only booking blocks belonging to those services.
4. THE Calendar_UI SHALL retain the standard Monday–Sunday column layout in week view regardless of the active service filter.
5. WHEN no bookings match the active service filter for a day column, THE Calendar_UI SHALL render that day column as empty rather than hiding it.
6. THE Service_Filter selection SHALL persist while the user navigates between weeks, resetting only when the user explicitly selects "All Services".

### Requirement 5: Backend — Calendar Endpoint Extension

**User Story:** As a frontend developer, I want the calendar API to return capacity and fill data per booking, so that the frontend can render fill indicators without making additional requests.

#### Acceptance Criteria

1. WHEN the `GET /api/v1/bookings/calendar` endpoint is called for day or week view, THE Calendar_API SHALL include `resource_capacity` and `slot_booking_count` fields on every booking object in the response.
2. THE Calendar_API SHALL derive `resource_capacity` from the `capacity` column of the `res_resources` table via the booking's `resource_id`.
3. THE Calendar_API SHALL derive `slot_booking_count` by counting bookings with status in (`pending`, `confirmed`, `in_progress`) that share the same `resource_id`, `start_time`, and `business_id`.
4. IF a booking has no `resource_id`, THEN THE Calendar_API SHALL return `null` for both `resource_capacity` and `slot_booking_count`.
5. THE Calendar_API SHALL include `service_id` on each booking object in day and week view responses.
6. THE Calendar_API SHALL compute all capacity data using raw SQL via the `pg` driver with no ORM.
7. THE Calendar_API SHALL NOT call or modify the availability calculation service (`availability.service.ts`).

---

## Dependencies

- Feature 07 (Booking Engine): `apt_bookings` table and `GET /api/v1/bookings/calendar` endpoint
- Feature 13 (Resource Management): `res_resources` table with the `capacity` column
- Feature 09 (Service Management): `svc_services` table with service names
- Feature 04 (Design System): CSS custom property tokens for semantic colours

## Success Criteria

- A staff member can distinguish services by colour on the calendar without reading block text
- Booking blocks show a correctly coloured fill badge reflecting available, almost-full, or full state
- Day view presents per-service columns with a working show/hide toggle
- Week view service filter correctly limits visible bookings without breaking date navigation
- The calendar API returns `resource_capacity`, `slot_booking_count`, and `service_id` on every booking object
- No changes are made to availability calculation logic

## Out of Scope

- Creating, editing, or cancelling bookings from the calendar view — the calendar is read-only
- Modifying the availability calculation service or any availability logic
- Month view enhancements — month view is not changed by this feature
- Resource-level capacity management UI — managed elsewhere
- Real-time calendar updates (WebSocket/polling) — the calendar refreshes only on navigation

## Notes

- Service colour palette CSS variables (`--cal-service-color-1` through `--cal-service-color-8`) must be added to the design system token files
- Colour assignment is deterministic: services sorted alphabetically are assigned palette slots in order, so the same service always gets the same colour within a session
- The calendar API continues to use `adminPool` consistent with the existing service — this does not change

---

**Status**: 📋 Planned
**Dependencies**: Feature 07, Feature 13, Feature 09, Feature 04
**Next Phase**: Implementation
