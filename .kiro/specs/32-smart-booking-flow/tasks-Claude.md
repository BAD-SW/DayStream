# Implementation Plan: Smart Booking Flow

## Overview

Implementation tasks for the Smart Booking Flow enhancements: participant count field and two-level visual availability calendar. Tasks proceed backend-first (new endpoint → booking service extension) then frontend (new components → BookingCreate integration).

> **Amendment (2026-08-06):** see `requirements-Claude.md` / `design-Claude.md` in this folder. Capacity must be computed via real time-interval overlap + summed `participant_count`, not exact `start_time` matches — this needed a new migration (task 0 below) and changes tasks 1.1 and 2.1 from what's written below. Also adds an admin capacity-override checkbox (reusing the existing `overrideRules` field) to task 7. This also reopens part of `34-capacity-aware-calendar` (its own `tasks-Claude.md` §12) since its `slot_booking_count` has the identical flaw.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4", "5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7"] },
    { "wave": 7, "tasks": ["8"] }
  ]
}
```

## Tasks

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 0. Migration — `apt_bookings.participant_count` (Claude amendment)

- [ ] 0.1 Add migration `093_booking_participant_count.sql`: `ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 1` + `CHECK (participant_count >= 1)`
- [ ] 0.2 Run `npm run migrate:dev`

## 1. Backend — availability/days Endpoint

### 1.1 Route and handler
- [x] Register `GET /api/v1/bookings/availability/days` in `packages/server/src/routes/bookings.ts` before the `/:id` catch-all
- [x] Validate required query params (`service_id`, `variant_id`, `business_id`, `month` in `YYYY-MM` format); return 400 if missing or malformed
- [x] Parse the `month` param and build the full list of calendar days for that month
- [x] For each day, call `availabilityService.getAvailabilityCombinations()` with `dateFrom = dateTo = day`
- [x] **[Amended]** First, inside `availability.service.ts` itself: extend the resource-bookings query to select `participant_count`, change the per-slot concurrency sweep to sum `participant_count` instead of counting bookings, and attach the resulting `capacity_remaining` to each pushed `AvailableSlotCombo` (both push sites) — see `design-Claude.md`. This is additive (adds a field using data already computed internally); it does not change which slots are included for the default participant_count=1 case.
- [x] Map slot results to `available` / `unavailable` / `closed` status following the rules in the design (closed = all locations closed, available = ≥1 slot with sufficient capacity, unavailable = slots exist but none satisfy capacity or zero slots returned with business open)
- [x] Extract the `isDayClosedForBusiness` logic (already present inline in the existing `BookingCreate` location-status effect) into a shared server helper
- [x] Apply `participant_count` filter: a day is `available` only if at least one slot has `capacity_remaining ≥ participant_count`
- [x] Return `{ timezone, days: { "YYYY-MM-DD": "available" | "unavailable" | "closed" } }`
- [x] Protect with `requirePermission('bookings:read')`
- _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 1.1.1 Write unit tests for the route handler
  - Test 400 on missing params
  - Test 400 on malformed month
  - Test correct status mapping for available / unavailable / closed days
  - Test participant_count filtering (day marked unavailable when no slot has sufficient capacity)
  - _Requirements: 3.1, 3.7, 3.8_
  - Done in `tests/smart-booking-flow.test.ts`. Also extracted the day/participant-count decision into a pure exported `computeDayStatus()` helper in `routes/bookings.ts` and fixed a real bug found while writing this: an unconstrained slot's `capacity_remaining === undefined` was defaulting to `1` (wrongly gating any participantCount > 1), not `Infinity` (unconstrained).

- [x] 1.1.2 Write property test — day response completeness
  - **Property 3: Day status correctly reflects slot availability**
  - **Validates: Requirements 3.1, 3.2**
  - For any valid month string, every day in that month appears in the response with one of the three valid statuses
  - Tested against the pure `getDaysInMonth()` / `computeDayStatus()` helpers directly (no DB) for speed and determinism at 100 iterations.

- [x] 1.1.3 Write property test — participant count filters availability
  - **Property 4: Participant count filters day availability**
  - **Validates: Requirements 3.7**
  - For any participant_count and slot set, day is available iff ∃ slot with capacity_remaining ≥ participant_count

### 1.2 Add availability/days to the bookings API client
- [x] Add `getAvailabilityDays(businessId, serviceId, variantId, month, participantCount)` function to `packages/client/src/api/bookings.ts`
- [x] Return type: `{ timezone: string; days: Record<string, 'available' | 'unavailable' | 'closed'> }`
- _Requirements: 3.1_

## 2. Backend — participant_count Booking Validation

### 2.1 Extend booking route schema and service
- [x] Add `participant_count: Joi.number().integer().min(1).default(1)` to `createBookingSchema` in `bookings.ts`
- [x] Pass `participantCount` from `req.body.participant_count` into `bookingService.createBooking()`
- [x] Add `participantCount?: number` to `CreateBookingInput` interface in `booking.service.ts`
- [x] **[Amended]** In `createBooking()`, after `resourceId` is resolved, query `SUM(participant_count)` over active-status bookings on that resource whose time range **overlaps** the new booking's (`start_time < newEnd AND end_time > newStart`) — not an exact `start_time` match. See `design-Claude.md` for the exact query.
- [x] Calculate `remaining = capacity − bookedSpots`; if `participantCount > remaining`: throw `Error(\`Only ${remaining} spot(s) remaining for this slot\`)` **unless `input.overrideRules` is true**, in which case allow the booking through (still inserted with its real `participant_count`, so the over-capacity state is correctly visible to later reads — this is the admin-override path, new Requirement 6 in `requirements-Claude.md`)
- [x] Persist `participant_count` on the inserted row (new column from task 0)
- [x] The existing 409 error-mapping in the route handler already catches messages containing `'capacity'` — verify this covers the new message
- _Requirements: 1.7, 1.8 + new Requirement 6 (admin override)_

- [x] 2.1.1 Write property test — server rejects over-capacity participant counts
  - **Property 2: Server rejects over-capacity participant counts**
  - **Validates: Requirements 1.7, 1.8**
  - For any (participant_count, remaining_capacity) pair, server accepts iff participant_count ≤ remaining_capacity
  - DB-backed, 100 runs, `resource_id` passed directly in the request body to isolate the capacity gate from staff/availability-rule setup; a walk-in seed booking avoids the unrelated customer-double-booking check.

- [x] 2.1.2 Write unit tests for participant_count validation
  - Test exact capacity boundary (count = remaining → accepted)
  - Test over-capacity (count = remaining + 1 → 409)
  - Test default behaviour when participant_count absent (treated as 1)
  - Also added: admin override (Requirement 6) allows an over-capacity booking through, and the resource then correctly rejects further non-override bookings until overridden again.
  - _Requirements: 1.7, 1.8_

**Checkpoint (2026-08-06):** `npx vitest run tests/smart-booking-flow.test.ts` — 17/17 passing. Full regression (`bookings.test.ts`, `booking-conflicts.test.ts`, `booking-integration.test.ts`, `availability.test.ts`, `booking-calendar.test.ts`, `resource-management.test.ts`) re-run alongside it: the same pre-existing, unrelated `usr_users.business_id` NOT NULL fixture failures documented earlier in this file still occur (confirmed via each failing suite's `beforeAll` error, identical root cause across all four/five failing suites) — nothing newly broken by tasks 1–2. `npx tsc --noEmit` clean except the pre-existing unrelated `seed.ts` crypto typing error.

## 3. Frontend — ParticipantCountField Component

### 3.1 Implement ParticipantCountField
- [x] Create `packages/client/src/components/booking/ParticipantCountField.tsx` with props: `value`, `onChange`, `maxCapacity`, `remainingCapacity?`, `disabled?`
- [x] Render a labelled `<input type="number">` with `min=1`, `max = remainingCapacity ?? maxCapacity`
- [x] Label text: "Number of participants"
- [x] All styles via CSS variables (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`) — no hardcoded values
- [x] Create `ParticipantCountField.css` alongside the component
- [x] **[Extra]** Component self-hides (`return null`) when `maxCapacity <= 1`, in addition to BookingCreate's own gating — belt-and-suspenders, makes Property 1 directly testable on the component itself
- _Requirements: 1.1, 1.2, 1.3, 5.7_

- [x] 3.1.1 Write property test — field visibility matches resource capacity
  - **Property 1: Participant field visibility matches resource capacity**
  - **Validates: Requirements 1.1, 1.5**
  - For any resource capacity value, field visible iff capacity > 1
  - `tests/ParticipantCountField.test.tsx` — 5/5 passing

## 4. Frontend — DayPicker Component

### 4.1 Implement DayPicker
- [x] Create `packages/client/src/components/booking/DayPicker.tsx`
- [x] Props: `dayStatuses: Record<string, DayStatus>`, `viewedMonth: string`, `onMonthChange`, `onDaySelect`, `loading`, `error`, `onRetry`
- [x] Render a 7-column month grid with day-of-week header labels (Sun–Sat or locale-appropriate)
- [x] Colour each day cell using CSS variables: `--color-success` for available, `--color-border` for unavailable, `--color-error` for closed
- [x] Disable and grey out all past days (before today in the browser)
- [x] Disable navigation to months before the current month
- [x] Show loading spinner over the grid while `loading` is true; prevent day interaction during load
- [x] Show inline error message with retry button when `error` is set
- [x] Emit `onDaySelect(date)` only for available (green) days
- [x] All styles via CSS variables; create `DayPicker.css`
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10_

- [x] 4.1.1 Write property test — day status maps to correct CSS variable
  - **Property 6: Day status maps to correct CSS variable**
  - **Validates: Requirements 2.3**
  - For any DayStatus value, the rendered cell applies the correct CSS variable

- [x] 4.1.2 Write property test — past days always disabled
  - **Property 5: Past days are always non-interactive**
  - **Validates: Requirements 2.6**
  - For any date before today, the DayPicker cell is rendered as disabled regardless of status
  - `tests/DayPicker.test.tsx` — 9/9 passing (both properties + unit tests)

## 5. Frontend — SlotPicker Component

### 5.1 Implement SlotPicker
- [x] Create `packages/client/src/components/booking/SlotPicker.tsx`
- [x] Props: `slots: SlotCombo[]`, `participantCount: number`, `selectedTime: string | null`, `onSlotSelect`, `onBack`, `loading`, `businessTimezone: string`
- [x] Render a grid of time slot buttons; display time formatted in `businessTimezone`
- [x] Available slots (capacity_remaining ≥ participantCount): green border (`--color-success`), clickable
- [x] Over-capacity slots (capacity_remaining < participantCount): red border (`--color-error`), `disabled`, not clickable
- [x] Selected slot: `--color-accent` background fill (matching existing `timeBtnActive` style)
- [x] Render a "← Back to calendar" button that calls `onBack`
- [x] Show loading spinner when `loading`; show "No availability for this day" when slot list is empty
- [x] All styles via CSS variables; create `SlotPicker.css`
- _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8_

- [x] 5.1.1 Write property test — slot capacity state gates interactivity
  - **Property 8: Slot capacity state correctly gates interactivity**
  - **Validates: Requirements 4.3**
  - For any (slot.capacity_remaining, participantCount), slot is clickable iff capacity_remaining ≥ participantCount
  - `tests/SlotPicker.test.tsx` — 9/9 passing

## 6. Frontend — AvailabilityCalendar Component

### 6.1 Implement AvailabilityCalendar
- [x] Create `packages/client/src/components/booking/AvailabilityCalendar.tsx`
- [x] Props: `serviceId`, `variantId`, `businessId`, `participantCount`, `selectedDate`, `onDateSelect`, `onDateClear`
- [x] **[Extra]** Also accepts `slots`, `slotsLoading`, `selectedTime`, `onSlotSelect`, `businessTimezone` — the design's prop list didn't account for how `SlotPicker`'s own props (owned by the parent's existing combos fetch) reach it; these were added as the natural completion
- [x] Maintain internal state: `viewedMonth`, `dayStatuses`, `loading`, `error`, `view ('day-picker' | 'slot-picker')`
- [x] Fetch `/availability/days` when `serviceId`, `variantId`, `participantCount`, or `viewedMonth` changes
- [x] When `selectedDate` is null, reset `view` to `'day-picker'`
- [x] In `'day-picker'` mode: render `DayPicker`; on day click, call `onDateSelect(date)` and switch to `'slot-picker'`
- [x] In `'slot-picker'` mode: render `SlotPicker` using the `allCombos` data (passed down from BookingCreate via props)
- [x] Create `AvailabilityCalendar.css`
- _Requirements: 2.1, 2.7, 2.9, 4.1, 5.2, 5.3, 5.4_

- [x] 6.1.1 Write unit test — calendar fetches with correct params on prop changes
  - Verify `/availability/days` is called with updated `participantCount` when it changes
  - Verify reset to day-picker view when `selectedDate` becomes null
  - _Requirements: 2.9, 5.2, 5.3, 5.4_

- [x] 6.1.2 Write property test — selected slot start_time propagates to parent
  - **Property 7: Selected slot start_time propagates to parent**
  - **Validates: Requirements 4.6**
  - Interpreted as: day selection always propagates the exact clicked date string via `onDateSelect` (the design's own prose describes this callback under this property, despite the property's title language)
  - `tests/AvailabilityCalendar.test.tsx` — 6/6 passing

## 7. BookingCreate Integration

### 7.1 Wire new components into BookingCreate
- [x] Load resource capacity when `selectedService` changes (query service availability rules → fetch first linked resource capacity from `/v1/resources/:id`)
- [x] Add `participantCount` state (default 1); reset to 1 on service or variant change
- [x] Add `resourceCapacity` state (default 1)
- [x] Replace the `<input type="date">` block with `<AvailabilityCalendar>` component
- [x] Add `<ParticipantCountField>` between variant selector and calendar, shown only when `resourceCapacity > 1`
- [x] When `participantCount` changes, clear `selectedTime` if the currently selected slot no longer has sufficient capacity
- [x] Extend the `handleSubmit` call to `bookingsApi.createBooking` to include `participant_count: participantCount`
- [x] Extend the `/availability/combinations` fetch to pass `participant_count` as a query param (currently a no-op server-side since `availability.service.ts` computes `capacity_remaining` unconditionally, but wired per spec for forward-compatibility)
- [x] **[New]** Add `overrideCapacity` state (default false) and an "Override capacity limit" checkbox, shown alongside `ParticipantCountField` (same visibility condition); pass as `override_rules: overrideCapacity` in the `createBooking` call — new Requirement 6
- [x] Preserve all existing form behaviour: customer selector, service/variant selectors, location/staff filter panel (Time column removed — its job is now done by AvailabilityCalendar's SlotPicker), notes, Create Booking button
- [x] **[Extra]** Added `id`/`htmlFor` association to the Service and Duration/Option `<label>`s (were unassociated, blocking accessible querying and screen-reader users alike) — a real accessibility gap found while writing tests, fixed at the source rather than worked around
- _Requirements: 1.1, 1.2, 1.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 + new Requirement 6_

- [x] 7.1.1 Write integration tests for BookingCreate
  - Participant count field appears/disappears correctly based on resource capacity
  - Submitting with participant_count includes it in the API call body (full flow: service → variant → participant count → walk-in → day → slot → submit → asserts the exact `createBooking` payload)
  - Calendar resets on service change
  - _Requirements: 1.1, 1.5, 1.6, 5.2_
  - `tests/BookingCreate.test.tsx` — 5/5 passing

### 7.2 Update bookings API client
- [x] Add `participant_count?: number` to the `createBooking` data parameter type in `packages/client/src/api/bookings.ts`
- _Requirements: 1.6_

**Checkpoint (2026-08-06):** Full feature-32 client suite (`ParticipantCountField`, `DayPicker`, `SlotPicker`, `AvailabilityCalendar`, `BookingCreate`) plus feature-31's `BookingCalendar` re-run together: 49/49 passing. Full client suite (`npx vitest run`): 131/136 passing — the 5 failures are in `moduleRegistry.test.ts`, pre-existing and unrelated (untouched by this work, confirmed already in an earlier session). `npx tsc --noEmit` clean for every file touched in tasks 3–7 (remaining project-wide errors are pre-existing and unrelated).

## 8. Final Checkpoint

- [x] Ensure all tests pass: ran full client (`packages/client: npx vitest run`) and full server booking-area regression (`smart-booking-flow`, `booking-calendar`, `bookings`, `booking-conflicts`, `booking-integration`, `availability`, `resource-management`) in place of the workspace-wide `npm run test` — client 132/137 (5 pre-existing unrelated `moduleRegistry.test.ts` failures), server: `smart-booking-flow`/`booking-calendar` fully green, the other 5 suites fail identically to before this work (pre-existing `usr_users.business_id` NOT NULL fixture issue, confirmed via each suite's `beforeAll` error)
- [x] Confirm no hardcoded hex values or Tailwind classes in new components — all CSS uses `var(--*)` tokens
- [x] Confirm `availability.service.ts` has not been modified beyond the amended, additive `capacity_remaining` change documented in task 1.1 / `design-Claude.md` (no change to which slots are returned for the default case)
- [x] Confirm the `/availability/combinations` route handler has not been modified
- [x] All automated tests pass (module-registry exception is pre-existing/unrelated)

## Manual browser test (2026-08-06)

Full end-to-end walkthrough in Chrome against the running dev servers, using a real seeded
service ("Fire & Ice", booking_type=resource, 90 min) linked via an availability rule to a
capacity-3 resource ("Fire & Ice Room"). Covered: service/variant selection → participant count
field appears only for the multi-capacity service → day picker (past days dimmed, today correctly
"unavailable" once its business hours have elapsed, future days green) → slot picker (green
available / red over-capacity slots, exact match to the overlap-aware capacity math) → booking
submission → calendar (feature 31) capacity badges.

**Bugs found and fixed during this walkthrough:**

1. **Admin override was non-functional in the calendar flow.** Checking "Override capacity limit"
   didn't actually let staff select an over-capacity (red) slot — `SlotPicker` disabled it
   unconditionally, and `ParticipantCountField`'s `max` attribute still clamped to the slot's
   `remainingCapacity` regardless of the checkbox. Requirement 6 (admin override) was reachable
   only via direct API calls, not through the UI staff would actually use. Fixed:
   - `SlotPicker` gained an `overrideCapacity?: boolean` prop; a slot's `disabled` state is now
     `!clickable && !overrideCapacity` (still visually red/flagged, just no longer blocked).
   - `ParticipantCountField` gained the same prop; when true, `max` is relaxed to `999` instead of
     `remainingCapacity ?? maxCapacity`.
   - `BookingCreate.tsx` passes `overrideCapacity` through to both, and the "clear selectedTime if
     capacity is insufficient" effect now skips clearing while overriding.
   - Regression tests added: `tests/SlotPicker.test.tsx` ("stays clickable when overrideCapacity is
     true"), `tests/ParticipantCountField.test.tsx` ("does not clamp... when overrideCapacity is
     true" / "still clamps... when false"). Verified live in-browser after the fix: booked 3
     participants onto an 11:30 AM slot with only 1 remaining (2 already booked), producing a
     5-booked/3-capacity resource, correctly shown as the new `'over-capacity'` (purple) badge on
     the feature-31 calendar.
   - `tests/BookingCreate.test.tsx`'s existing 5 tests still pass unaffected (none exercised this
     path); full client suite re-run clean (132/137, same 5 pre-existing unrelated failures).

2. **Pre-existing, out-of-scope bug found (not fixed, not part of this feature):**
   `availability.service.ts` never generates any slots for a `resource`-type service when the
   business has zero staff members — the location/no-location slot-push fallback is nested inside
   `for (const staff of availableStaffForSlot)`, so an empty staff list means zero slots regardless
   of `needsStaff` being `false` for `booking_type: 'resource'`. Worked around for this manual test
   by seeding one staff record; not fixed since it predates and is unrelated to features 31/32 (the
   `resource` booking type and this staff-list code path both already existed). Flagged to the user.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All property tests use `fast-check` (already in the project's test dependencies); run with `vitest --run`
- The `isDayClosedForBusiness` helper extraction in task 1.1 prevents duplicating the closed-day logic that already exists in `BookingCreate.tsx`
- If a dedicated `GET /v1/resources/:id` endpoint does not exist, task 7.1 can retrieve capacity by querying the service's availability rules (which already return `resource_ids`) and making a lookup query; check the resources routes before implementing
