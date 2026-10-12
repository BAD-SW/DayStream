# Suite 09 — Bookings, Calendar & Check-in

Persona: reception unless stated. Covers spec 07 (booking engine), 15 (check-in), 32 (smart booking flow), 33 (calendar redesign), 34 (capacity-aware calendar). This is the product's core path and recent work: go slowly and record rough edges. Conventions: [README](../README.md).

**Pre for the suite:** `E2E {RUN} Massage` (individual, 60 / 90 min, therapist assigned) and `E2E {RUN} Sauna` (shared, capacity 4) from the journeys, or equivalents created here. Use dates in the next 14 days so data does not collide with seeded bookings.

---

## Availability and the booking form

### BKG-01 · Availability is the intersection of every constraint
`P0` `regression` · Spec 07 R1 · Status: Draft
1. For `E2E {RUN} Massage` on a weekday, read the slots offered.
**Expect:** slots lie inside location hours ∩ service availability rule ∩ provider pattern, exclude existing bookings, leave, overrides and resource maintenance, and each slot fits the full variant duration (the 90 min variant offers fewer slots than the 60 min one).
**Cross-check:** `GET /api/v1/bookings/availability` returns the same slots as the UI.

### BKG-02 · Create an individual booking
`P0` `regression` · Spec 07 R2, R9 · Status: Draft
1. `/bookings/new`: customer, service, variant, provider, day, slot; save.
**Expect:** booking created with the variant's price and duration; appears in `/bookings` and on the calendar immediately.
**Cross-check:** the same slot is no longer offered for that provider; the customer's Timeline has the entry.

### BKG-03 · Double booking is impossible
`P0` `negative` · Spec 07 R15 · Status: Draft
1. With two sessions (reception and manager), open the same slot for the same provider and submit both within a second. 2. Via the API, post a booking overlapping an existing one by 15 minutes.
**Expect:** exactly one succeeds; the other gets a clear conflict message (HTTP 409 or equivalent) and creates nothing.

### BKG-04 · Edit and reschedule
`P0` `regression` · Spec 07 R6 · Status: Draft
1. Open `/bookings/{id}/edit`; move the booking to another day and provider; save. 2. Try to move it onto an occupied slot.
**Expect:** the old slot is freed and the new one taken; the conflicting move is refused; the Timeline records old → new time.

### BKG-05 · Status lifecycle and illegal transitions
`P0` `regression` · Spec 07 R6 · Status: Draft
1. Take a booking through confirm → check-in → complete. 2. On other bookings try: complete without check-in, check in a cancelled booking, cancel a completed one. 3. Use **reset** on a completed booking.
**Expect:** legal transitions succeed; illegal ones are refused by the API, not just hidden in the UI; reset behaves as designed (record what it resets to).

### BKG-06 · No-show
`P1` `regression` · Specs 07 R6, 15 R5 · Status: Draft
1. Mark a past-time booking as no-show. 2. Waive it from the no-shows list.
**Expect:** it counts in the customer's no-show record and in the no-show report; waiving removes the penalty but keeps the history.

### BKG-07 · Booking rules: notice and horizon
`P1` `regression` · Spec 07 R7 · Status: Draft
1. Read the rules (`GET /api/v1/bookings/rules`). 2. Try to book inside the minimum-notice window, and beyond the maximum advance window, as a customer and as staff.
**Expect:** customers are held to the rules; staff override follows the design (record whether staff may override).

### BKG-08 · Resource-only service with no staff
`P1` `known-issue` · Spec 07 R5 · Status: Draft · **KI-1: expected to misbehave**
1. Create a resource-type service with a room and no staff assigned; open availability and try to book it.
**Expect (target behaviour):** slots follow the resource's schedule and the booking succeeds with no provider.
**Record:** exactly what happens today. This script turns into a normal regression test once KI-1 is fixed.

### BKG-09 · Recurring bookings
`P1` `regression` · Spec 07 R12 · Status: Draft
1. Create a weekly series of 4 for one customer. 2. Cancel one occurrence. 3. Cancel the rest of the series.
**Expect:** four bookings are created; an occurrence that conflicts is reported, not silently skipped; cancelling one leaves the others; cancelling the series cancels only future occurrences.

### BKG-10 · Waitlist
`P1` `regression` · Spec 07 R11 · Status: Draft
1. With the `feature.waitlist` flag on, fill a slot, then add a customer to its waitlist. 2. Free the slot. 3. Confirm the waitlist entry.
**Expect:** the waitlisted customer is promoted or offered the place in order; confirming creates a normal booking; leaving the waitlist removes the entry.

### BKG-11 · Holds expire
`P2` `regression` · Spec 07 R8 · Status: Draft
1. `POST /api/v1/bookings/hold` for a slot; check availability from another session; release the hold (or let it expire).
**Expect:** the held slot is unavailable to others while held and returns afterwards.

### BKG-12 · Time zones
`P1` `regression` · Spec 07 R14 · Status: Draft
1. Set the browser to a time zone different from the business's; create a booking at 10:00.
**Expect:** the booking is at 10:00 **business time** everywhere (list, calendar, confirmation, iCal export); it does not shift by the browser offset. A booking at 23:30 stays on the right day.

---

## Smart booking flow (spec 32)

### BKG-13 · Participant count
`P0` `regression` · Spec 32 R1 · Status: Draft
1. In the booking form choose `E2E {RUN} Sauna` (capacity 4); set participants to 0, 5, then 3. Choose an individual service.
**Expect:** values outside 1..capacity are refused; for an individual service the field is fixed at 1 or hidden; the price reflects the count if pricing is per person.
**Cross-check:** the saved booking stores the headcount, and the calendar counts it against capacity.

### BKG-14 · Month day-picker shows which days have room
`P0` `regression` · Spec 32 R2, R3 · Status: Draft
1. Open the day picker for the Sauna with participants = 4, then = 1. Move to next month and back.
**Expect:** days with no slot large enough are disabled; with participants = 1 more days are available than with 4; past days are disabled; changing month loads without stale marks from the previous month.
**Cross-check:** `GET /api/v1/bookings/availability/days` for that month and count returns the same set of days.

### BKG-15 · Slot picker shows remaining places
`P0` `regression` · Spec 32 R4 · Status: Draft
1. Pick a day where one slot has 3 of 4 places taken; request 2 participants, then 1.
**Expect:** with 2 the slot is not selectable; with 1 it is and shows 1 place left; a full slot is shown as full.

---

## Calendar (specs 33, 34)

### BKG-16 · Month, week and day views agree
`P0` `regression` · Specs 33 R1, 07 R10 · Status: Draft
1. For a week containing the run's bookings, count them in month, week and day views; move across a month boundary and a week that spans two months.
**Expect:** every booking appears on its correct date in all three views; the month grid's weekday columns line up with real dates (first of the month under the right weekday).

### BKG-17 · Time axis follows business hours; resource blocks show
`P1` `regression` · Spec 33 R2, R3 · Status: Draft
1. Open the day view for a location open 09:00–18:00.
**Expect:** the axis covers the business hours (not 00:00–24:00); closed periods are visibly unavailable; resource schedule blocks and maintenance windows appear as blocks.

### BKG-18 · Capacity strips and per-service columns
`P0` `regression` · Specs 33 R5, R6, 34 R2, R3 · Status: Draft
1. In day view find the Sauna at a time with 3 of 4 places booked.
**Expect:** a capacity indicator with the numeric label 3/4 and a proportional fill; each service has its own column with a consistent colour (spec 34 R1); an over-capacity state is visually distinct.
**Cross-check:** `GET /api/v1/bookings/calendar` returns booked and capacity numbers that match the labels.

### BKG-19 · Filters and week modes
`P1` `regression` · Specs 33 R4, R8, 34 R4 · Status: Draft
1. Filter by service, by provider, by location; combine; clear. Toggle week view between detail and summary.
**Expect:** only matching bookings remain; clearing restores all; summary mode totals equal the count of bookings visible in detail mode.

### BKG-20 · Payment status on the calendar
`P1` `regression` · Spec 33 R7 · Status: Draft
1. Compare an unpaid booking with the paid one from JNY-03.
**Expect:** the paid / unpaid indicator is right for each and updates after payment without a full reload (or after one: record which).

---

## Check-in (spec 15)

### CHK-01 · Reception check-in and live dashboard
`P0` `regression` · Spec 15 R2, R4, R8 · Status: Draft
1. At `/check-in` find today's booking by customer name; check in. 2. Try to check in the same booking again; try a booking for tomorrow.
**Expect:** status becomes checked in with the time; the dashboard's counters move (expected / arrived); the duplicate and the wrong-day attempts are refused with a reason.
**Cross-check:** the booking shows as checked in on the calendar and bookings list.

### CHK-02 · QR code check-in
`P1` `regression` · Spec 15 R1 · Status: Draft
1. Fetch the booking's QR code and the customer's QR code. 2. Submit each to the QR check-in endpoint. 3. Regenerate the customer's code and submit the old one.
**Expect:** valid codes check the customer in; the old code is refused after regeneration; a code from another business is refused.

### CHK-03 · Walk-in
`P1` `regression` · Spec 15 R6 · Status: Draft
1. Register a walk-in for a service with a free slot now; then for one that is full.
**Expect:** the first creates a booking already checked in; the second is refused or offered the next slot.
**Cross-check:** the walk-in appears in the walk-ins report and can be taken to checkout.

### CHK-04 · Late arrival and membership validation
`P2` `regression` · Spec 15 R4, R7 · Status: Draft
1. Read the check-in configuration (grace period). Check in a booking after the grace period. 2. Check in a customer whose membership is expired for a members-only session.
**Expect:** late arrival is flagged per configuration; the invalid session is refused or warned with the reason.

### CHK-05 · Kiosk mode
`P2` `regression` · Spec 15 R3 · Status: Draft
1. Register a kiosk; open the kiosk status; check in through the kiosk endpoint.
**Expect:** the kiosk works with its own restricted credential and exposes no customer data beyond what is needed to check in.
