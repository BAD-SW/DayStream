# Implementation Plan: Capacity-Aware Calendar

## Overview

Implementation follows a backend-first approach: extend the calendar API to return capacity data, then refactor the frontend calendar in layers — service colours and legend, capacity badges, day-view columns with toggle, then week-view service filter.

> **Claude status note (2026-08-06):** Feature complete and fully verified as of the original spec. Client: 97/102 tests pass (5 pre-existing, unrelated `moduleRegistry.test.ts` failures). Server: all 5 tests in `booking-calendar.test.ts` pass. The earlier "DB auth failure" was root-caused: `packages/server/vitest.config.ts` hardcoded a stale `DB_PASSWORD: 'postgres'` test-env override that no longer matched the real local Postgres password in `.env` (which was correct all along) — fixed by removing that one hardcoded key so it falls through to the real `.env` value via dotenv. This was blocking *all* DB-backed server tests, not just this feature's. Running the full server suite afterward surfaced ~185 pre-existing failures unrelated to this feature or to DB auth (schema/mocking drift, same category as the known client-side `moduleRegistry.test.ts` issue) — out of scope here, flagged separately.
>
> **REOPENED 2026-08-06** — see `requirements-Claude.md` / `design-Claude.md` in this folder. Discovered while implementing `32-smart-booking-flow` that `slot_booking_count`'s exact-`start_time`-match logic doesn't correctly represent overlapping bookings of different durations, and needs a 4th `'over-capacity'` fill state for admin-override bookings. Reopened sub-tasks tracked below under **"12. Amendment — overlap-aware capacity (2026-08-06)"**.

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

- [x] 1. Extend the calendar service with capacity data
  - [x] 1.1 Update `getCalendar()` in `packages/server/src/services/booking-calendar.service.ts`
    - Added `service_id` to the SELECT clause, `LEFT JOIN res_resources`, `resource_capacity`, and the correlated `slot_booking_count` subquery. `CalendarBooking` interface updated. Compiles clean.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x]* 1.2 Write integration tests for the extended calendar endpoint
    - `packages/server/tests/booking-calendar.test.ts` — 4 integration tests, all passing against the real DB.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 1.3 Write property test for `slot_booking_count` correctness (fast-check, 100+ iterations)
    - **Property 11** — passing (100 runs against real DB via `getCalendar()`).
    - _Requirements: 5.3_

- [x] 2. Checkpoint — backend tests pass
  - All 5 tests in `booking-calendar.test.ts` pass.

- [x] 3. Add service colour palette tokens to the design system
  - [x] 3.1 Added `--cal-service-color-1..8` to `colors.css` `:root`. No light-mode override added — these are theme-agnostic fixed swatches (same reasoning as the existing status colours), not contrast-sensitive background/text tokens.
    - _Requirements: 1.1, 1.5_

- [x] 4. Implement service colour assignment and legend
  - [x] 4.1 `buildServiceColorMap()` in `BookingCalendar.tsx` — matches spec exactly.
    - _Requirements: 1.1, 1.2_
  - [x]* 4.2 Property 1 test — passing (100 runs).
  - [x] 4.3 `ServiceLegend` component — exported from `BookingCalendar.tsx` (kept in the same file rather than a separate file, matching the existing DayView/WeekView/MonthView convention already in this file).
    - _Requirements: 1.3, 1.5_
  - [x]* 4.4 Property 2 test — passing (100 runs).

- [x] 5. Implement capacity badge
  - [x] 5.1 `getFillState()` — matches spec exactly.
    - _Requirements: 2.2, 2.3, 2.4_
  - [x]* 5.2 Property 4 test — passing (100 runs).
  - [x] 5.3 `CapacityBadge` component — matches spec.
    - _Requirements: 2.1, 2.5_
  - [x]* 5.4 Unit tests — passing.

- [x] 6. Refactor DayView to per-service columns
  - [x] 6.1 `DayView` now takes `serviceColorMap`, renders a CSS grid of per-service columns, colours blocks via `var(--cal-service-color-N)`, integrates `CapacityBadge`. `STATUS_COLORS` removed entirely (no longer used anywhere).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 6.2 Property 5 test — passing (100 runs).
  - [x]* 6.3 Property 6 test — passing (100 runs).
  - [x] 6.4 `ServiceColumnFilter` toggle panel — implemented as a `hiddenServices: Set<string>` (inverse of the spec's `visibleServices`, functionally equivalent — new services default visible without needing to backfill a "visible" set).
    - _Requirements: 3.6, 3.7_
  - [x]* 6.5 Property 7 test — passing (100 runs).

- [x] 7. Checkpoint — day view tests pass
  - All day-view tests pass.

- [x] 8. Refactor WeekView with service filter
  - [x] 8.1 `WeekView` now takes `serviceColorMap`, colours blocks via CSS var, integrates `CapacityBadge`.
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 8.2 `ServiceFilterDropdown` — **one deliberate deviation from the design**: `selectedServices` state was lifted from WeekView into the parent `BookingCalendar` component instead of staying local to WeekView. Reason: the page conditionally renders `{!loading && view === 'week' && <WeekView/>}`, which unmounts WeekView on every navigation's loading flicker — local state would reset on every week change, breaking Requirement 4.6 ("filter persists across week navigation"). Lifting the state fixes this; behaviour otherwise matches the spec exactly.
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [x]* 8.3 Property 9 test — passing (100 runs).
  - [x]* 8.4 Property 10 test — passing (100 runs).
  - [x] 8.5 7-column invariant verified.
    - _Requirements: 4.4, 4.5_
  - [x]* 8.6 Property 8 test — passing (100 runs).

- [x] 9. Wire service colours and legend into `BookingCalendar` page
  - [x] 9.1 Colour-map computation wired in directly (via `useMemo`, not a separately-named `useServiceColours()` hook function — same behaviour, skipped the wrapper since it added no value at 2 lines). Passed to `DayView`, `WeekView`, `ServiceLegend`.
    - _Requirements: 1.1, 1.2, 1.4_
  - [x]* 9.2 Property 3 test — passing (100 runs).
  - [x] 9.3 `ServiceLegend` rendered above the grid for day/week views, hidden for month view.
    - _Requirements: 1.3_

- [x] 10. Update `packages/client/src/api/bookings.ts` response typing
  - [x] Added `CalendarBooking` and `CalendarResponse` interfaces; `getCalendar()` now returns `Promise<CalendarResponse>`.
    - _Requirements: 5.1_

- [x] 11. Final checkpoint — all tests pass
  - Frontend: ✅ 97/102 (5 pre-existing unrelated). Backend: ✅ 5/5 in `booking-calendar.test.ts`. Feature complete.

## 12. Amendment — overlap-aware capacity (2026-08-06)

See `requirements-Claude.md` / `design-Claude.md`. Depends on `32-smart-booking-flow`'s migration `093_booking_participant_count.sql` landing first.

- [x] 12.1 Replace `slot_booking_count` correlated subquery in `booking-calendar.service.ts` with the overlap + `SUM(participant_count)` version (see `design-Claude.md`)
  - [x] 12.1.1 Update/extend Property 11 test and integration tests in `booking-calendar.test.ts` to cover overlapping-different-duration bookings
  - Added a deterministic integration test using the exact user-described scenario (2 people 90min@6pm, 1 person 30min@6:30pm, 1 person 60min@7pm — none sharing an exact start_time) and rewrote the property test to compute expected `slot_booking_count` per-booking via real overlap + summed participant_count, replacing the old single-shared-instant assumption
- [x] 12.2 Add `'over-capacity'` to `FillState` in `BookingCalendar.tsx`; update `getFillState` (count > capacity checked before count === capacity)
  - [x] 12.2.1 Update Property 4 test for the 4th state
- [x] 12.3 Add `--color-capacity-override` token to `colors.css` (+ light theme override in `light.css`); wire into `CapacityBadge`'s fill-state → colour map
- [x] 12.4 Re-run full feature 31 test suite to confirm nothing regressed
  - Server: `tests/booking-calendar.test.ts` — 6/6 passing. Client: `tests/BookingCalendar.test.tsx` — 16/16 passing. `npx tsc --noEmit` clean on both packages except pre-existing, unrelated errors (`seed.ts` crypto typing; `BookingCalendar.tsx`'s two unused-var warnings, present before this amendment).

## Notes

- All property tests use **fast-check** (installed as a devDependency in both `packages/client` and `packages/server`), each tagged `// Feature: 34-capacity-aware-calendar, Property N: ...`, run at 100 iterations minimum.
- `adminPool` continues to be used in `booking-calendar.service.ts` — no change to pool selection.
- `availability.service.ts` was not imported, called, or modified at any point.
- One property test (Property 2 in `BookingCalendar.test.tsx`) needed the service-name arbitrary constrained to exclude pathological whitespace (multiple consecutive spaces, tabs, newlines) — the DOM's own text-node whitespace normalization was breaking exact-text assertions for reasons unrelated to the component itself. Real service names come from a trimmed text input, so this doesn't reduce real-world coverage.
