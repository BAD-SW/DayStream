# Requirements Document

## Introduction

Enhances the existing `BookingCreate` page with two improvements: a participant count selector for multi-capacity services, and a visual availability calendar that replaces the plain date input. Together these give staff a clearer, faster path to selecting a date and time while surfacing capacity constraints upfront.

## Goals

- Replace the plain `<input type="date">` with a two-level visual availability picker (month calendar → time slot grid)
- Show capacity state (available / none / closed) directly on calendar days to eliminate dead-end date selections
- Add a participant count field for services whose linked resource has `capacity > 1`
- Pass participant count to the booking creation API and validate it server-side
- Never modify or bypass the existing availability calculation logic

## Glossary

- **Availability_Calendar**: The two-level UI component that replaces the plain date input
- **Day_Picker**: Level 1 of the Availability_Calendar — a month grid where each day is colour-coded
- **Slot_Picker**: Level 2 of the Availability_Calendar — a time-slot grid for the selected day
- **Participant_Count**: The number of participants included in a single booking, applicable only when the service's linked resource has `capacity > 1`
- **Days_Availability_Endpoint**: The new `GET /api/v1/bookings/availability/days` endpoint that returns per-day availability status for a given month
- **Combinations_Endpoint**: The existing `GET /api/v1/bookings/availability/combinations` endpoint — source of truth for slot availability; must not be modified
- **Resource_Capacity**: The `capacity` column on `res_resources`; defines how many concurrent bookings a resource supports
- **Booked_Spots**: The number of confirmed/pending/in-progress bookings already occupying a resource slot
- **Remaining_Capacity**: Resource_Capacity minus Booked_Spots at a given time slot

---

## Requirements

#### Requirement 1: Participant Count Field

**User Story**: As a staff member creating a booking, I want to specify how many participants are included, so that resource capacity is correctly consumed and validated.

##### Acceptance Criteria

1. WHEN a service variant is selected AND the service's linked resource has a `capacity > 1`, THE Booking_Create_Page SHALL display a "Number of participants" number input below the variant selector.
2. WHEN the participant count field is displayed, THE Booking_Create_Page SHALL default the field value to 1.
3. WHEN the participant count field is displayed, THE Booking_Create_Page SHALL set the maximum allowed value to the Remaining_Capacity for the currently selected slot, or to the Resource_Capacity if no slot is yet selected.
4. WHEN a user changes the participant count, THE Availability_Calendar SHALL refresh slot availability to reflect the new participant count requirement.
5. WHEN the service's linked resource has `capacity = 1` or the service has no linked resource, THE Booking_Create_Page SHALL NOT display the participant count field.
6. WHEN a booking is submitted, THE Booking_Create_Page SHALL include the participant count in the booking creation request.
7. WHEN a booking creation request is received with a participant count, THE Server SHALL validate that the participant count does not exceed the Remaining_Capacity of the resource for the requested slot.
8. IF the participant count exceeds Remaining_Capacity at booking creation time, THEN THE Server SHALL return a 409 conflict error with a descriptive message.

---

#### Requirement 2: Month Calendar Day Picker

**User Story**: As a staff member creating a booking, I want to see a month calendar that colour-codes each day by availability, so that I can immediately identify bookable dates without trial and error.

##### Acceptance Criteria

1. WHEN a service variant is selected, THE Availability_Calendar SHALL display a month calendar grid in place of the plain date input.
2. THE Day_Picker SHALL display days in a 7-column grid with day-of-week header labels.
3. WHEN availability data for a day is loaded, THE Day_Picker SHALL colour each day cell using CSS variables: green (`--color-success`) for days with at least one available slot, grey (`--color-border`) for days with no available slots for the selected parameters, and red (`--color-error`) for days the business is closed or all staff are unavailable.
4. THE Day_Picker SHALL display navigation controls to move to the previous and next month.
5. WHEN the current month is displayed, THE Day_Picker SHALL disable the previous-month navigation if it would navigate to a month before the current month.
6. WHEN a day is displayed, THE Day_Picker SHALL disable interaction for days in the past.
7. WHEN a green day is clicked, THE Availability_Calendar SHALL transition to the Slot_Picker view for that day.
8. WHEN day availability data is loading, THE Day_Picker SHALL display a loading indicator and prevent interaction.
9. THE Days_Availability_Endpoint SHALL be called with `service_id`, `variant_id`, `business_id`, `month` (YYYY-MM), and `participant_count` parameters whenever the viewed month or any of those parameters changes.
10. IF the Days_Availability_Endpoint returns an error, THEN THE Day_Picker SHALL display an error message and allow the user to retry.

---

#### Requirement 3: Days Availability Endpoint

**User Story**: As a developer, I want a lightweight endpoint that returns per-day availability for a given month, so that the Day_Picker can colour-code days without loading all slot combinations.

##### Acceptance Criteria

1. THE Server SHALL expose a `GET /api/v1/bookings/availability/days` endpoint that accepts `service_id`, `variant_id`, `business_id`, `month` (YYYY-MM format), and optional `participant_count` query parameters.
2. WHEN the endpoint is called with valid parameters, THE Server SHALL return a JSON object mapping each calendar day (`YYYY-MM-DD`) to one of three statuses: `"available"`, `"unavailable"`, or `"closed"`.
3. THE Server SHALL determine day status by calling the existing availability calculation logic (the same logic used by the Combinations_Endpoint) — it SHALL NOT implement its own availability rules.
4. A day SHALL be `"closed"` when location hours or overrides mark it as closed for all active locations.
5. A day SHALL be `"available"` when the existing availability logic returns at least one slot satisfying the requested participant count.
6. A day SHALL be `"unavailable"` when the existing availability logic returns zero slots for that day (but the business is not explicitly closed).
7. WHEN `participant_count` is provided and greater than 1, THE Server SHALL only mark a day as `"available"` if the slots on that day have Remaining_Capacity >= `participant_count`.
8. IF required query parameters are missing, THEN THE Server SHALL return a 400 error.
9. THE endpoint SHALL require the `bookings:read` permission.

---

#### Requirement 4: Time Slot Picker

**User Story**: As a staff member creating a booking, I want to see available time slots for the selected day as coloured buttons, so that I can select a slot without confusion about which times are bookable.

##### Acceptance Criteria

1. WHEN a green day is selected in the Day_Picker, THE Slot_Picker SHALL display all time slots for that day fetched from the Combinations_Endpoint.
2. THE Slot_Picker SHALL render each available slot as a green button showing the slot start time in the business timezone.
3. WHEN a slot has no remaining capacity for the requested participant count, THE Slot_Picker SHALL render it as a red/disabled button.
4. THE Slot_Picker SHALL display a "Back to calendar" control that returns the user to the Day_Picker.
5. WHEN a green slot button is clicked, THE Slot_Picker SHALL mark that slot as selected and apply the active style (`--color-accent`).
6. WHEN a slot is selected, THE Availability_Calendar SHALL expose the selected slot's `start_time` to the parent booking form so that the existing location/staff filter panel and booking submission logic can use it unchanged.
7. WHEN slot data is loading, THE Slot_Picker SHALL display a loading indicator.
8. WHEN no slots are available for the selected day, THE Slot_Picker SHALL display a "No availability for this day" message.

---

#### Requirement 5: Integration with Existing Booking Form

**User Story**: As a staff member, I want the new calendar and participant count to work seamlessly with the existing location, staff, and notes fields, so that the booking form remains a single coherent workflow.

##### Acceptance Criteria

1. THE Booking_Create_Page SHALL preserve all existing booking form behaviour (customer selector, service selector, variant selector, location/staff filter panel, notes field, Create Booking button).
2. WHEN the selected service changes, THE Availability_Calendar SHALL reset to the current month and clear any selected day and slot.
3. WHEN the selected variant changes, THE Availability_Calendar SHALL reset and reload day availability for the current month.
4. WHEN the participant count changes, THE Availability_Calendar SHALL reload day availability and clear any previously selected slot if it no longer has sufficient remaining capacity.
5. THE Booking_Create_Page SHALL pass the `participant_count` to the Combinations_Endpoint call so that the existing slot list reflects actual remaining capacity.
6. WHEN the booking form is submitted, THE Booking_Create_Page SHALL send `participant_count` in the request body alongside all existing fields.
7. ALL colours in the Availability_Calendar and participant count field SHALL use CSS variables only — no hardcoded hex values.

---

## Dependencies

- Existing `GET /api/v1/bookings/availability/combinations` endpoint (must not be modified)
- Existing `availability.service.ts` — reused internally by the new Days_Availability_Endpoint (must not be modified)
- Existing `booking.service.ts` — extended to accept and validate `participant_count`
- `res_resources` table — `capacity` column used to determine whether the participant count field is shown and to validate the server-side cap

## Success Criteria

- The plain `<input type="date">` is replaced by the visual availability calendar on the BookingCreate page
- Days are correctly colour-coded based on real availability returned by the new endpoint
- The participant count field appears only for services with a multi-capacity linked resource
- A booking with `participant_count` exceeding resource Remaining_Capacity is rejected by the server with a 409
- No changes are made to `availability.service.ts` or the Combinations_Endpoint handler
- All new UI uses CSS variables only

## Out of Scope

- Customer-facing booking flow — this feature only modifies the staff-side `BookingCreate` page
- Showing participant count on the booking detail or calendar views — future work
- Modifying the `MonthView` calendar component used elsewhere in the app
- Waitlist integration for over-capacity scenarios — future work

## Notes

- The `participant_count` for capacity purposes maps to the resource's `capacity` column on `res_resources`, not `svc_services.max_capacity`. The service's `max_capacity` is for group/shared booking types; `res_resources.capacity` is the physical constraint.
- The Days_Availability_Endpoint loops over each day in the requested month, calls the existing availability logic per day, and returns a status map — it must not duplicate or reimplement availability rules.
- The `capacity_remaining` field is already present in the `AvailableSlotCombo` interface but is not yet populated by the availability service for resource-type services. The implementation must ensure this field is populated for slots where a resource with `capacity > 1` is involved.

---

**Status**: 📋 Planned
**Next Phase**: Design
**Last Updated**: July 2026
