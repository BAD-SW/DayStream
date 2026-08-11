# Implementation Plan: Capacity-Aware Calendar

## Overview

Implementation follows a backend-first approach: extend the calendar API to return capacity data, then refactor the frontend calendar in layers — service colours and legend, capacity badges, day-view columns with toggle, then week-view service filter.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4", "5"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7"] },
    { "wave": 6, "tasks": ["8"] },
    { "wave": 7, "tasks": ["9", "10"] },
    { "wave": 8, "tasks": ["11"] }
  ]
}
```

## Tasks

- [ ] 1. Extend the calendar service with capacity data
  - [ ] 1.1 Update `getCalendar()` in `packages/server/src/services/booking-calendar.service.ts`
    - Add `service_id` to the SELECT clause in the day/week query
    - Add `LEFT JOIN res_resources r ON r.id = b.resource_id`
    - Add `r.capacity AS resource_capacity` to SELECT
    - Add the correlated subquery for `slot_booking_count` (NULL when `resource_id IS NULL`)
    - Update the `CalendarBooking` interface with `service_id: string`, `resource_capacity: number | null`, `slot_booking_count: number | null`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 1.2 Write integration tests for the extended calendar endpoint
    - Test day-view response includes `service_id`, `resource_capacity`, `slot_booking_count` on each booking
    - Test booking with a resource: `resource_capacity` matches DB value
    - Test booking without a resource: both capacity fields are `null`
    - Test multiple bookings on same resource+slot: `slot_booking_count` is correct
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 1.3 Write property test for `slot_booking_count` correctness (fast-check, 100+ iterations)
    - **Property 11: slot_booking_count matches active concurrent booking count**
    - **Validates: Requirement 5.3**
    - _Requirements: 5.3_

- [ ] 2. Checkpoint — backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Add service colour palette tokens to the design system
  - [ ] 3.1 Add `--cal-service-color-1` through `--cal-service-color-8` to `packages/client/src/design-system/tokens/colors.css`
    - Add to `:root` block using the 8 palette values from the design document
    - Add matching entries to any light-mode override block if one exists
    - _Requirements: 1.1, 1.5_

- [ ] 4. Implement service colour assignment and legend
  - [ ] 4.1 Create `buildServiceColorMap()` utility function in `BookingCalendar.tsx`
    - Accept `Array<{ id: string; name: string }>`, sort by name, assign `SERVICE_COLOR_VARS[i % 8]`
    - _Requirements: 1.1, 1.2_

  - [ ]* 4.2 Write property test for `buildServiceColorMap` (fast-check, 100+ iterations)
    - **Property 1: Service colour assignment is deterministic and complete**
    - **Validates: Requirements 1.1, 1.2**

  - [ ] 4.3 Create `ServiceLegend` component alongside `BookingCalendar.tsx`
    - Accept `colorMap: Map<string, string>` and `services: Array<{ id: string; name: string }>`
    - Render a colour swatch (CSS var background) and service name per entry
    - All colours via CSS custom properties only
    - _Requirements: 1.3, 1.5_

  - [ ]* 4.4 Write property test for `ServiceLegend` (fast-check, 100+ iterations)
    - **Property 2: Service legend contains every service**
    - **Validates: Requirement 1.3**

- [ ] 5. Implement capacity badge
  - [ ] 5.1 Create `getFillState(count, capacity)` pure function
    - Returns `'available' | 'almost-full' | 'full'` per design document rules
    - _Requirements: 2.2, 2.3, 2.4_

  - [ ]* 5.2 Write property test for `getFillState` (fast-check, 100+ iterations)
    - **Property 4: Fill state classification is complete and mutually exclusive**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ] 5.3 Create `CapacityBadge` component
    - Accept `count: number | null` and `capacity: number | null`
    - Render `{count}/{capacity}` span with fill-state CSS variable background
    - Render nothing when either prop is null
    - _Requirements: 2.1, 2.5_

  - [ ]* 5.4 Write unit tests for `CapacityBadge`
    - Test: correct text for available, almost-full, full states
    - Test: renders nothing when capacity is null; renders nothing when count is null
    - _Requirements: 2.1, 2.5_

- [ ] 6. Refactor DayView to per-service columns
  - [ ] 6.1 Update `DayView` to accept `serviceColorMap: Map<string, string>` prop and render per-service columns
    - Derive `serviceColumns` = distinct service_ids from bookings, sorted alphabetically by service name
    - Replace single `dayColumnOverlay` with a CSS grid: `[60px time axis] [repeat(N, 1fr)]`
    - Render each column only for its service's bookings; apply `background: var(--cal-service-color-N)` instead of `STATUS_COLORS`
    - Integrate `CapacityBadge` in each booking block corner
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 6.2 Write property test for DayView column count (fast-check, 100+ iterations)
    - **Property 5: Day view column count equals distinct services with bookings**
    - **Validates: Requirements 3.1, 3.5**

  - [ ]* 6.3 Write property test for booking block placement (fast-check, 100+ iterations)
    - **Property 6: Booking blocks are placed only in their matching service column**
    - **Validates: Requirement 3.3**

  - [ ] 6.4 Implement `ServiceColumnFilter` toggle panel in `DayView`
    - Local state: `visibleServices: Set<string>` (initially all services)
    - Renders a checkbox per service with colour swatch and name
    - On toggle: updates local state only — no API call
    - Day view renders only columns for services in `visibleServices`
    - _Requirements: 3.6, 3.7_

  - [ ]* 6.5 Write property test for service column toggle (fast-check, 100+ iterations)
    - **Property 7: Service column toggle produces correct visible column set**
    - **Validates: Requirement 3.6**

- [ ] 7. Checkpoint — day view tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Refactor WeekView with service filter
  - [ ] 8.1 Update `WeekView` to accept `serviceColorMap: Map<string, string>` prop and replace STATUS_COLORS usage
    - Apply `var(--cal-service-color-N)` to booking block backgrounds using service colour map
    - Integrate `CapacityBadge` in each booking block
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 8.2 Add `ServiceFilterDropdown` above the week grid
    - Local state: `selectedServices: 'all' | Set<string>` (initially `'all'`)
    - Derive service list from bookings in the current week
    - "All Services" option + per-service checkboxes
    - `visibleBookings` = filter applied before passing to day columns
    - Filter persists across week navigation (stored in WeekView state)
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [ ]* 8.3 Write property test: week view service filter limits visible bookings (fast-check, 100+ iterations)
    - **Property 9: Week view service filter limits visible bookings to selected services**
    - **Validates: Requirement 4.3**

  - [ ]* 8.4 Write property test: "All Services" renders all bookings (fast-check, 100+ iterations)
    - **Property 10: Week view "All Services" renders all bookings**
    - **Validates: Requirement 4.2**

  - [ ] 8.5 Verify the 7-column invariant: week view always renders 7 day header columns regardless of filter
    - _Requirements: 4.4, 4.5_

  - [ ]* 8.6 Write property test: 7-column invariant (fast-check, 100+ iterations)
    - **Property 8: Week view always renders exactly 7 day columns**
    - **Validates: Requirements 4.4, 4.5**

- [ ] 9. Wire service colours and legend into `BookingCalendar` page
  - [ ] 9.1 Add `useServiceColours` hook
    - Extract distinct `{ id, name }` pairs from `calendarData.bookings`
    - Call `buildServiceColorMap()` to produce the colour map
    - Pass `serviceColorMap` down to `DayView`, `WeekView`, and `ServiceLegend`
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 9.2 Write property test: booking block colour uses service colour map (fast-check, 100+ iterations)
    - **Property 3: Booking block background uses service colour, not status colour**
    - **Validates: Requirement 1.4**

  - [ ] 9.3 Render `ServiceLegend` above the calendar grid
    - Visible in day and week views; hidden in month view
    - _Requirements: 1.3_

- [ ] 10. Update `packages/client/src/api/bookings.ts` response typing
  - Update the calendar response type to include `service_id`, `resource_capacity`, `slot_booking_count`
  - No new query parameters required
  - _Requirements: 5.1_

- [ ] 11. Final checkpoint — all tests pass
  - Ensure all tests pass (unit, property, integration), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP
- Backend changes are additive and non-breaking — existing clients that ignore the new fields continue to work
- `adminPool` continues to be used in `booking-calendar.service.ts` — no change to pool selection
- `availability.service.ts` is not imported, called, or modified at any point
- Property tests use **fast-check** library — add as a dev dependency (`npm install --save-dev fast-check`) if not already present
- Each property test must carry the tag comment: `// Feature: 34-capacity-aware-calendar, Property N: <description>`
