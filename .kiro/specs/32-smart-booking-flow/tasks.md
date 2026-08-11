# Implementation Plan: Smart Booking Flow

## Overview

Implementation tasks for the Smart Booking Flow enhancements: participant count field and two-level visual availability calendar. Tasks proceed backend-first (new endpoint → booking service extension) then frontend (new components → BookingCreate integration).

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

## 1. Backend — availability/days Endpoint

### 1.1 Route and handler
- [ ] Register `GET /api/v1/bookings/availability/days` in `packages/server/src/routes/bookings.ts` before the `/:id` catch-all
- [ ] Validate required query params (`service_id`, `variant_id`, `business_id`, `month` in `YYYY-MM` format); return 400 if missing or malformed
- [ ] Parse the `month` param and build the full list of calendar days for that month
- [ ] For each day, call `availabilityService.getAvailabilityCombinations()` with `dateFrom = dateTo = day`
- [ ] Map slot results to `available` / `unavailable` / `closed` status following the rules in the design (closed = all locations closed, available = ≥1 slot with sufficient capacity, unavailable = slots exist but none satisfy capacity or zero slots returned with business open)
- [ ] Extract the `isDayClosedForBusiness` logic (already present inline in the existing `BookingCreate` location-status effect) into a shared server helper
- [ ] Apply `participant_count` filter: a day is `available` only if at least one slot has `capacity_remaining ≥ participant_count`
- [ ] Return `{ timezone, days: { "YYYY-MM-DD": "available" | "unavailable" | "closed" } }`
- [ ] Protect with `requirePermission('bookings:read')`
- _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ]* 1.1.1 Write unit tests for the route handler
  - Test 400 on missing params
  - Test 400 on malformed month
  - Test correct status mapping for available / unavailable / closed days
  - Test participant_count filtering (day marked unavailable when no slot has sufficient capacity)
  - _Requirements: 3.1, 3.7, 3.8_

- [ ]* 1.1.2 Write property test — day response completeness
  - **Property 3: Day status correctly reflects slot availability**
  - **Validates: Requirements 3.1, 3.2**
  - For any valid month string, every day in that month appears in the response with one of the three valid statuses

- [ ]* 1.1.3 Write property test — participant count filters availability
  - **Property 4: Participant count filters day availability**
  - **Validates: Requirements 3.7**
  - For any participant_count and slot set, day is available iff ∃ slot with capacity_remaining ≥ participant_count

### 1.2 Add availability/days to the bookings API client
- [ ] Add `getAvailabilityDays(businessId, serviceId, variantId, month, participantCount)` function to `packages/client/src/api/bookings.ts`
- [ ] Return type: `{ timezone: string; days: Record<string, 'available' | 'unavailable' | 'closed'> }`
- _Requirements: 3.1_

## 2. Backend — participant_count Booking Validation

### 2.1 Extend booking route schema and service
- [ ] Add `participant_count: Joi.number().integer().min(1).default(1)` to `createBookingSchema` in `bookings.ts`
- [ ] Pass `participantCount` from `req.body.participant_count` into `bookingService.createBooking()`
- [ ] Add `participantCount?: number` to `CreateBookingInput` interface in `booking.service.ts`
- [ ] In `createBooking()`, after `resourceId` is resolved, query `res_resources.capacity` and count existing overlapping bookings for that resource+slot
- [ ] Calculate `remaining = capacity − bookedSpots`; throw `Error(\`Only ${remaining} spot(s) remaining for this slot\`)` if `participantCount > remaining`
- [ ] The existing 409 error-mapping in the route handler already catches messages containing `'capacity'` — verify this covers the new message
- _Requirements: 1.7, 1.8_

- [ ]* 2.1.1 Write property test — server rejects over-capacity participant counts
  - **Property 2: Server rejects over-capacity participant counts**
  - **Validates: Requirements 1.7, 1.8**
  - For any (participant_count, remaining_capacity) pair, server accepts iff participant_count ≤ remaining_capacity

- [ ]* 2.1.2 Write unit tests for participant_count validation
  - Test exact capacity boundary (count = remaining → accepted)
  - Test over-capacity (count = remaining + 1 → 409)
  - Test default behaviour when participant_count absent (treated as 1)
  - _Requirements: 1.7, 1.8_

## 3. Frontend — ParticipantCountField Component

### 3.1 Implement ParticipantCountField
- [ ] Create `packages/client/src/components/booking/ParticipantCountField.tsx` with props: `value`, `onChange`, `maxCapacity`, `remainingCapacity?`, `disabled?`
- [ ] Render a labelled `<input type="number">` with `min=1`, `max = remainingCapacity ?? maxCapacity`
- [ ] Label text: "Number of participants"
- [ ] All styles via CSS variables (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`) — no hardcoded values
- [ ] Create `ParticipantCountField.css` alongside the component
- _Requirements: 1.1, 1.2, 1.3, 5.7_

- [ ]* 3.1.1 Write property test — field visibility matches resource capacity
  - **Property 1: Participant field visibility matches resource capacity**
  - **Validates: Requirements 1.1, 1.5**
  - For any resource capacity value, field visible iff capacity > 1

## 4. Frontend — DayPicker Component

### 4.1 Implement DayPicker
- [ ] Create `packages/client/src/components/booking/DayPicker.tsx`
- [ ] Props: `dayStatuses: Record<string, DayStatus>`, `viewedMonth: string`, `onMonthChange`, `onDaySelect`, `loading`, `error`, `onRetry`
- [ ] Render a 7-column month grid with day-of-week header labels (Sun–Sat or locale-appropriate)
- [ ] Colour each day cell using CSS variables: `--color-success` for available, `--color-border` for unavailable, `--color-error` for closed
- [ ] Disable and grey out all past days (before today in the browser)
- [ ] Disable navigation to months before the current month
- [ ] Show loading spinner over the grid while `loading` is true; prevent day interaction during load
- [ ] Show inline error message with retry button when `error` is set
- [ ] Emit `onDaySelect(date)` only for available (green) days
- [ ] All styles via CSS variables; create `DayPicker.css`
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10_

- [ ]* 4.1.1 Write property test — day status maps to correct CSS variable
  - **Property 6: Day status maps to correct CSS variable**
  - **Validates: Requirements 2.3**
  - For any DayStatus value, the rendered cell applies the correct CSS variable

- [ ]* 4.1.2 Write property test — past days always disabled
  - **Property 5: Past days are always non-interactive**
  - **Validates: Requirements 2.6**
  - For any date before today, the DayPicker cell is rendered as disabled regardless of status

## 5. Frontend — SlotPicker Component

### 5.1 Implement SlotPicker
- [ ] Create `packages/client/src/components/booking/SlotPicker.tsx`
- [ ] Props: `slots: SlotCombo[]`, `participantCount: number`, `selectedTime: string | null`, `onSlotSelect`, `onBack`, `loading`, `businessTimezone: string`
- [ ] Render a grid of time slot buttons; display time formatted in `businessTimezone`
- [ ] Available slots (capacity_remaining ≥ participantCount): green border (`--color-success`), clickable
- [ ] Over-capacity slots (capacity_remaining < participantCount): red border (`--color-error`), `disabled`, not clickable
- [ ] Selected slot: `--color-accent` background fill (matching existing `timeBtnActive` style)
- [ ] Render a "← Back to calendar" button that calls `onBack`
- [ ] Show loading spinner when `loading`; show "No availability for this day" when slot list is empty
- [ ] All styles via CSS variables; create `SlotPicker.css`
- _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8_

- [ ]* 5.1.1 Write property test — slot capacity state gates interactivity
  - **Property 8: Slot capacity state correctly gates interactivity**
  - **Validates: Requirements 4.3**
  - For any (slot.capacity_remaining, participantCount), slot is clickable iff capacity_remaining ≥ participantCount

## 6. Frontend — AvailabilityCalendar Component

### 6.1 Implement AvailabilityCalendar
- [ ] Create `packages/client/src/components/booking/AvailabilityCalendar.tsx`
- [ ] Props: `serviceId`, `variantId`, `businessId`, `participantCount`, `selectedDate`, `onDateSelect`, `onDateClear`
- [ ] Maintain internal state: `viewedMonth`, `dayStatuses`, `loading`, `error`, `view ('day-picker' | 'slot-picker')`
- [ ] Fetch `/availability/days` when `serviceId`, `variantId`, `participantCount`, or `viewedMonth` changes
- [ ] When `selectedDate` is null, reset `view` to `'day-picker'`
- [ ] In `'day-picker'` mode: render `DayPicker`; on day click, call `onDateSelect(date)` and switch to `'slot-picker'`
- [ ] In `'slot-picker'` mode: render `SlotPicker` using the `allCombos` data (passed down from BookingCreate via props or via the existing combinations fetch)
- [ ] Create `AvailabilityCalendar.css`
- _Requirements: 2.1, 2.7, 2.9, 4.1, 5.2, 5.3, 5.4_

- [ ]* 6.1.1 Write unit test — calendar fetches with correct params on prop changes
  - Verify `/availability/days` is called with updated `participantCount` when it changes
  - Verify reset to day-picker view when `selectedDate` becomes null
  - _Requirements: 2.9, 5.2, 5.3, 5.4_

- [ ]* 6.1.2 Write property test — selected slot start_time propagates to parent
  - **Property 7: Selected slot start_time propagates to parent**
  - **Validates: Requirements 4.6**
  - For any slot selection, `onDateSelect` is called with the correct date string

## 7. BookingCreate Integration

### 7.1 Wire new components into BookingCreate
- [ ] Load resource capacity when `selectedService` changes (query service availability rules → fetch first linked resource capacity from `/v1/resources/:id` or equivalent)
- [ ] Add `participantCount` state (default 1); reset to 1 on service or variant change
- [ ] Add `resourceCapacity` state (default 1)
- [ ] Replace the `<input type="date">` block with `<AvailabilityCalendar>` component
- [ ] Add `<ParticipantCountField>` between variant selector and calendar, shown only when `resourceCapacity > 1`
- [ ] When `participantCount` changes, clear `selectedTime` if the currently selected slot no longer has sufficient capacity
- [ ] Extend the `handleSubmit` call to `bookingsApi.createBooking` to include `participant_count: participantCount`
- [ ] Extend the `/availability/combinations` fetch to pass `participant_count` as a query param (so `capacity_remaining` is populated on returned slots)
- [ ] Preserve all existing form behaviour: customer selector, service/variant selectors, location/staff filter panel, notes, Create Booking button
- _Requirements: 1.1, 1.2, 1.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ]* 7.1.1 Write integration tests for BookingCreate
  - Participant count field appears/disappears correctly based on resource capacity
  - Submitting with participant_count includes it in the API call body
  - Calendar resets on service change
  - _Requirements: 1.1, 1.5, 1.6, 5.2_

### 7.2 Update bookings API client
- [ ] Add `participant_count?: number` to the `createBooking` data parameter type in `packages/client/src/api/bookings.ts`
- _Requirements: 1.6_

## 8. Final Checkpoint

- [ ] Ensure all tests pass: run `npm run test` from the workspace root
- [ ] Confirm no hardcoded hex values or Tailwind classes in new components — all CSS uses `var(--*)` tokens
- [ ] Confirm `availability.service.ts` has not been modified
- [ ] Confirm the `/availability/combinations` route handler has not been modified
- [ ] Ensure all tests pass, ask the user if any questions arise

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All property tests use `fast-check` (already in the project's test dependencies); run with `vitest --run`
- The `isDayClosedForBusiness` helper extraction in task 1.1 prevents duplicating the closed-day logic that already exists in `BookingCreate.tsx`
- If a dedicated `GET /v1/resources/:id` endpoint does not exist, task 7.1 can retrieve capacity by querying the service's availability rules (which already return `resource_ids`) and making a lookup query; check the resources routes before implementing
