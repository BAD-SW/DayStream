# Suite 09 — Bookings, Calendar & Check-in

Persona: reception unless stated. Covers spec 07 (booking engine), 15 (check-in), 32 (smart booking flow), 33 (calendar redesign), 34 (capacity-aware calendar). This is the product's core path and recent work: go slowly and record rough edges. Conventions: [README](../README.md).

**Pre for the suite:** `E2E {RUN} Massage` (individual, 60 / 90 min, therapist assigned) and `E2E {RUN} Sauna` (shared, capacity 4) from the journeys, or equivalents created here. Use dates in the next 14 days so data does not collide with seeded bookings.

---

## Availability and the booking form

### BKG-01 · Availability is the intersection of every constraint
`P0` `regression` · Spec 07 R1 · Status: Verified
1. For `E2E {RUN} Massage` on a weekday, read the slots offered.
**Expect:** slots lie inside location hours ∩ service availability rule ∩ provider pattern, exclude existing bookings, leave, overrides and resource maintenance, and each slot fits the full variant duration (the 90 min variant offers fewer slots than the 60 min one).
**Cross-check:** `GET /api/v1/bookings/availability` returns the same slots as the UI.

### BKG-02 · Create an individual booking
`P0` `regression` · Spec 07 R2, R9 · Status: Verified
1. `/bookings/new`: customer, service, variant, provider, day, slot; save.
**Expect:** booking created with the variant's price and duration; appears in `/bookings` and on the calendar immediately.
**Cross-check:** the same slot is no longer offered for that provider; the customer's Timeline has the entry.

### BKG-03 · Double booking is impossible
`P0` `negative` · Spec 07 R15 · Status: Verified
1. With two sessions (reception and manager), open the same slot for the same provider and submit both within a second. 2. Via the API, post a booking overlapping an existing one by 15 minutes.
**Expect:** exactly one succeeds; the other gets a clear conflict message (HTTP 409 or equivalent) and creates nothing.

### BKG-04 · Edit and reschedule
`P0` `regression` · Spec 07 R6 · Status: Verified
1. Open `/bookings/{id}/edit`; move the booking to another day and provider; save. 2. Try to move it onto an occupied slot.
**Expect:** the old slot is freed and the new one taken; the conflicting move is refused; the Timeline records old → new time.

### BKG-05 · Status lifecycle and illegal transitions
`P0` `regression` · Spec 07 R6 · Status: Verified
1. Take a booking through confirm → check-in → complete. 2. On other bookings try: complete without check-in, check in a cancelled booking, cancel a completed one. 3. Use **reset** on a checked-in booking, then on a completed one.
**Expect:** legal transitions succeed; illegal ones are refused by the API, not just hidden in the UI; reset is "undo check-in" (checked in → confirmed, check-in time cleared) and is refused for a completed booking.

### BKG-06 · No-show
`P1` `regression` · Specs 07 R6, 15 R5 · Status: Verified
1. Mark a past-time booking as no-show. 2. Waive it from the no-shows list.
**Expect:** it counts in the customer's no-show record and in the no-show report; waiving removes the penalty but keeps the history.

### BKG-07 · Booking rules: notice and horizon
`P1` `regression` · Spec 07 R7 · Status: Verified
1. Read the rules (`GET /api/v1/bookings/rules`). 2. As staff, try to book inside the minimum-notice window and beyond the maximum advance window, without and with **override rules**.
**Expect:** both are refused with the reason (HTTP 409); with override the booking is accepted. A customer login cannot use the staff booking endpoint at all (403): customers book through the widget and portal (suite 12), which never override.

### BKG-08 · Resource-only service with no staff
`P1` `known-issue` · Spec 07 R5 · Status: Draft · **KI-1: expected to misbehave**
1. Create a resource-type service with a room and no staff assigned; open availability and try to book it.
**Expect (target behaviour):** slots follow the resource's schedule and the booking succeeds with no provider.
**Record:** exactly what happens today. This script turns into a normal regression test once KI-1 is fixed.

### BKG-09 · Recurring bookings
`P1` `regression` · Spec 07 R12 · Status: Verified
1. Create a weekly series of 4 for one customer (`start_time` is a clock time, `HH:MM`), with one of the four dates already taken. 2. Cancel one occurrence. 3. Cancel the rest of the series.
**Expect:** three bookings are created and the conflicting date is listed in `generation.conflicts`; every occurrence is at the stated time in the business's time zone, also across a clock change; opening hours, provider availability and capacity apply to each occurrence (only minimum notice is waived); cancelling one leaves the others; cancelling the series cancels only future occurrences.

### BKG-10 · Waitlist
`P1` `regression` · Spec 07 R11 · Status: Verified
1. Fill a shared session, then add two customers to its waitlist (`POST /api/v1/bookings/{serviceId}/waitlist`). 2. Cancel one booking of the session. 3. Confirm the first entry. 4. Remove the second.
**Expect:** positions are 1 and 2; joining twice is refused; after the cancellation the first entry is `notified` (offered the place for 24 hours) and the second still `waiting`; confirming creates a normal booking in that session; leaving removes the entry; a person can join again later. There is no waitlist screen yet (API only).

### BKG-11 · Holds expire
`P2` `regression` · Spec 07 R8 · Status: Verified
1. `POST /api/v1/bookings/hold` for a slot; check availability from another session; release the hold (or let it expire).
**Expect:** the held slot is unavailable to others while held and returns afterwards.

### BKG-12 · Time zones
`P1` `regression` · Spec 07 R14 · Status: Verified
1. Set the browser to a time zone different from the business's; create a booking at 10:00.
**Expect:** the booking is at 10:00 **business time** everywhere (list, calendar, confirmation, iCal export); it does not shift by the browser offset. A booking at 23:30 stays on the right day.

### BKG-21 · Customers cancel their own appointment
`P0` `regression` · THE-20 R15–R16 (David, 2026-10-22) · As: owner, customer · Status: Verified
1. With cancelling off (the default), cancel an appointment from My Bookings. 2. Settings → System → Customer cancellations → Appointments: customers can cancel up to 48 hours before, money as account credit. 3. Reception takes payment for the appointment in advance (cash); the customer cancels it 4 days before. 4. Cancel one starting tomorrow; try someone else's.
**Expect:** while off, My Bookings says to contact the business and cancelling is refused; in time the appointment is cancelled and the visit paid in advance becomes account credit (its order is refunded); after the limit it is refused; another person's appointment cannot be cancelled. My Bookings shows times in the business's time zone.

### BKG-22 · Cancellation email fields
`P2` `regression` · Bill `391505b` · As: owner · Status: Verified
1. Cancel a future appointment of a customer, with a reason.
**Expect:** the queued cancellation email carries the customer's name, first name and email, the service, the staff member, the time, the reference and the reason, so the Cancellation template's fields are filled. The manage link and calendar links are empty for now (not built).

---

## Smart booking flow (spec 32)

### BKG-13 · Participant count
`P0` `regression` · Spec 32 R1 · Status: Verified
1. In the booking form choose `E2E {RUN} Sauna` (capacity 4); set participants to 0, 5, then 3. Choose an individual service.
**Expect:** values outside 1..capacity are refused; for an individual service the field is fixed at 1 or hidden; the price reflects the count if pricing is per person.
**Cross-check:** the saved booking stores the headcount, and the calendar counts it against capacity.

### BKG-14 · Month day-picker shows which days have room
`P0` `regression` · Spec 32 R2, R3 · Status: Verified
1. Open the day picker for the Sauna with participants = 4, then = 1. Move to next month and back.
**Expect:** days with no slot large enough are disabled; with participants = 1 more days are available than with 4; past days are disabled; changing month loads without stale marks from the previous month.
**Cross-check:** `GET /api/v1/bookings/availability/days` for that month and count returns the same set of days.

### BKG-15 · Slot picker shows remaining places
`P0` `regression` · Spec 32 R4 · Status: Verified
1. Pick a day where one slot has 3 of 4 places taken; request 2 participants, then 1.
**Expect:** with 2 the slot is not selectable; with 1 it is and shows 1 place left; a full slot is shown as full.

---

## Calendar (specs 33, 34)

### BKG-26 · Bookings/Orders opens the calendar, today, Day view
`P0` `smoke` · David, 11 Nov 2026 · Status: Verified 2026-11-11
1. Log in as a business user; click **Bookings/Orders** in the sidebar. 2. Click **List** in the Calendar | List switch. 3. Log in as a customer and open Bookings/Orders.
**Expect:** step 1 opens the calendar (address `/bookings`) on today in the Day view, By Service; the title, toolbar, pills and column headers stay at the top while the hours scroll inside the grid, which fits the screen; there is no “Appointments list” link: a Calendar | List switch sits beside Day / Week / Month (also on the list); step 2 (List) opens the appointments table (`/bookings/list`), whose Calendar | List switch comes back; step 3 still shows the customer's own list. Weeks run Monday to Sunday; Month starts on Monday; times are 24 h; the grid runs at least 08:00–21:00.

### BKG-27 · New / Edit Appointment window (round 8)
`P0` `regression` · Decisions CAL-3, NA-7 to NA-10, round 8 (11 Nov 2026); THE-23 4.1 · Status: Verified 2026-11-11
1. Calendar: + New appointment. 2. In the popup, More options. 3. Click a future booking. 4. Click a no-show, cancelled or completed booking. 5. Open `/bookings/new` and `/bookings/:id/edit` directly, and New Appointment on the list.
**Expect:** the same round 8 screen every time: 1 Customer (search, Recent, New customer in place, Walk-in, customer card) and 2 Service (search, boxes in pages of 6, options as chips with price, participants for shared rooms and groups) on the left; 3 Date, staff & location on the right (only free locations / staff, Location first, search and pages when many; month coloured many / a few / none, also for the staff member chosen; times by Morning / Afternoon / Evening; With …suggested; Calendar | List with Next free times); navy confirm bar (when, customer · service · price · staff, + Add a note, Cancel, Confirm booking / Save changes). Steps 1–3 open as a window over the calendar (step 2 prefilled from the popup); step 3 keeps the booking's own time and staff and locks what the change rules lock; step 4 is View appointment with Close only; Confirm / Save closes the window, shows a confirmation and refreshes the calendar.

### BKG-28 · Customer search never matches the email domain
`P1` `regression` · Decisions NA (round 8), NA-9 · Status: Verified 2026-11-11
1. In the popup or the window search “test” (every demo email ends in @transcend.test), then a first name, a surname, the part of an email before @, and 3+ digits of a phone.
**Expect:** “test” finds only people with test in their name or before the @, never everyone at @transcend.test; the others find the person.
**Cross-check:** `GET /api/v1/customers?search=…&search_mode=booking`.

### BKG-29 · Cancel appointment and Mark as no-show in the edit window
`P0` `regression` · Decision CAL-5 (9 Nov 2026) · Status: Verified 2026-11-11
1. Open a future booking (window) → Cancel appointment. 2. Pay a future booking for a customer, then Cancel appointment. 3. Same for a walk-in. 4. Open a booking that has started → Mark as no-show.
**Expect:** no Delete anywhere; step 1 shows the reason box and the fee under the policy (or “No cancellation fee”), Keep appointment / Cancel appointment; step 2 also shows “Paid €… : refund” with To the payment / As account credit / No refund (default from Settings → cancellations) and refunds as chosen; step 3 offers no account credit (no customer); step 4 shows the no-show fee of the option (or that nothing is charged) and frees the time; each closes the window with a confirmation.
**Cross-check:** `GET /api/v1/bookings/:id/cancel-preview` (fee, paid_amount, refund_default); `PUT /api/v1/bookings/:id/cancel` with `refund_to`; a refund refused (credit for a walk-in) answers 409 with the reason and leaves the booking as it was.

### BKG-30 · A colour per service, changeable
`P2` `regression` · Decision CAL-11 (10 Nov 2026) · Status: Verified 2026-11-11
1. Offerings → a service → Calendar colour: choose a colour, Save. 2. Open the calendar. 3. Use the default.
**Expect:** the pill, column dot and booking boxes of that service use the colour in Day, Week and Month; Use the default returns it to the palette colour; an invalid value is refused by the API.

### BKG-31 · Payment step (step 4 of New Appointment)
`P0` `regression` · Decisions PAY-1 (A), PAY-2 (later), PAY-5 (later), PAY-6 (nothing preselected), 11 Nov 2026 · Status: Verified 2026-11-11
1. New appointment (or More options): choose customer, service, time; the button reads **Next: payment ›**. 2. Look at step 4. 3. Pay later. 4. Cash with an amount received. 5. A customer with a package for the service (Carmen López, 10 Float Sessions). 6. An invalid code. 7. Account credit smaller than the price.
**Expect:** step 4 shows “1 Customer ✓ · 2 Service ✓ · 3 Date, staff & location ✓ · 4 Payment”, What is paid (booking card, price, member price or included, package session, code, tax, To pay) and How it is paid (Card on file when saved, Card, Cash, Bank transfer, Gift card, Other, Pay later); nothing preselected and the button disabled until a choice; ‹ Back returns to steps 1–3 unchanged; 3 confirms unpaid (“Confirm, pay later”); 4 shows the change and records “Received …, change …”; 5 shows “1 session from 10 Float Sessions (n left after)”, To pay €0, “Confirm booking”, and the package has one session fewer; 6 says why the code is not valid; 7 warns that the rest needs split payment (PAY-2, later). The booking then shows as paid in its change rules.
**Cross-check:** `POST /api/v1/bookings/payment-quote`, `POST /api/v1/bookings/:id/pay`; the quote uses no order number.

### BKG-32 · One location at a time
`P1` `regression` · Hub design (Location select), David 11 Nov 2026 · Status: Verified 2026-11-11 (temporary second location, removed after)
1. With two active locations, open the calendar. 2. Switch the Location. 3. Book from the calendar in the second location. 4. Edit the booking and move it to the first location.
**Expect:** a Location select before Calendar | List only when there are several; bookings, opening hours, staff working and month numbers are those of the chosen location; the popup and window preselect it; the booking stores it and appears only in that location; a paid or started booking follows the move rules for a location change too.

### BKG-33 · Day and Week details (THE-23 4.2, 4.3)
`P1` `regression` · David 11 Nov 2026 · Status: Verified 2026-11-11
1. Two bookings of one service that overlap with different start times. 2. A group session booked by two customers at 14:30 and 15:00. 3. Week with one service filtered. 4. Bookings of Fire & Ice (6 places) for 1 person and of a massage. 5. Month Grid.
**Expect:** overlapping boxes side by side, never on top of each other; X/Y on every row a booking runs (1/10, 2/10, 2/10), counting staff busy with another service as not free (hover says who); the Week shows the numbers too with one service; “(1)” on the Fire & Ice box, nothing on the massage; the Grid fills the screen with full service names and larger numbers; past days in Month faded, without numbers. Grid (12 Nov): cells with nothing booked are empty (no 0, no capacity); the top row is “Total” = the sum of the service rows below (Thu 12: Guided Breathwork 3 → Total 3, hover “3 booked (2 bookings)”). Verified 2026-11-12.

### BKG-16 · Month, week and day views agree
`P0` `regression` · Specs 33 R1, 07 R10 · Status: Verified
1. For a week containing the run's bookings, count them in month, week and day views; move across a month boundary and a week that spans two months.
**Expect:** every booking appears on its correct date in all three views; the month grid's weekday columns line up with real dates (first of the month under the right weekday).

### BKG-17 · White / grey follows business hours, closing days and holidays
`P1` `regression` · Spec 33 R2, R3; decision CAL-hours (11 Nov 2026) · Status: Verified 2026-11-11 (temporary hours on the local primary location, removed after)
1. Set the primary location's weekly hours (e.g. Mon–Fri 09:00–20:00, Sat 09:00–14:00, Sunday closed) and a closed date override (holiday) on a weekday. 2. Open Week, Day and Month for that week. 3. Remove the hours (none set up) and reload.
**Expect:** the axis covers the hours; times outside them are grey and offer no +; Sunday and the holiday are grey with “closed” under the day (Week), the reason as the Day message (“Closed on Sundays.”, “Closed: <label>.”) and “closed” in Month (no +); resource schedule blocks show as blocks; with no hours set up everything is white.
**Cross-check:** `GET /api/v1/bookings/calendar` returns `hours_set_up` and `day_hours` (open / close, or closed with its reason) for every day of the range.

### BKG-18 · Day by Service: capacity left, stripes, column pages
`P0` `regression` · Specs 33 R5, R6, 34 R1–R3; decisions CAL-7 b, CAL-20, CAL-21 (11 Nov 2026) · Status: Verified 2026-11-11
1. Day view, By Service: one column per service (all active services, in the filter), at most 6 per page and as many as fit; ‹ Services 1–6 of N › sits on the pills line. 2. Book a staff service at 11:00 for a day with several staff free. 3. Look at a group session with 1 of 10 places booked, a float tank that is booked, and an empty time nobody can take.
**Expect:** a number only where there is a booking and room left: step 2 shows 1/(1 + staff still free) at 11:00 (hover lists who is free); the group shows 1/10; the booked float tank shows nothing (never 1/1) and has no +; free times show nothing and a + on hover; empty times nobody can take have light stripes and no +; a red line marks now (today only).
**Cross-check:** `GET /api/v1/bookings/calendar?view=day` returns `day_services`, `slot_capacity` (per service and 30-minute cell: booked, left, free staff) and `day_staff`; left comes from the same availability as New Appointment.

### BKG-19 · Filters (service pills)
`P1` `regression` · Specs 33 R4, R8, 34 R4; decisions CAL-14, CAL-23 (11 Nov 2026) · Status: Verified 2026-11-11
1. Day, Week and Month: the service filter is one line of pills; **All** stays at the left. With more services than fit, ‹ 1/2 › follows All and pages the rest. 2. With All on, click a service. 3. Click a second service, then both again. 4. Narrow the window.
**Expect:** in Day, the column pages (‹ Services 1–6 of N ›) sit on the same line, at the right; step 2 shows only that service; step 3 adds it, and removing the last goes back to All; services ticked on another page show “+N selected on other pages”; no pill is cut off at the right (pages are re-split); week view has no Detail / Summary switch any more (Summary dropped, CAL-14).

### BKG-21 · Month: Calendar and Grid per service
`P1` `regression` · Decisions CAL-15, CAL-16 (11 Nov 2026) · Status: Verified 2026-11-11 (capacity part needs location hours)
1. Month view opens on **Calendar**: each day lists its three fullest services, then “+N more” (opens all, with Open the day). 2. Switch to **Grid** (next to the pills). 3. Click a date or a number. 4. Set the primary location's weekly hours and reload.
**Expect:** lines read booked/capacity per service (places for shared rooms and groups, sessions otherwise; capacity = places, 1, or the active staff who do it × sessions that fit in the day's opening hours, holidays from the date overrides); without opening hours only the booked number shows; the Grid fits the month in the width with no sideways scroll; step 3 opens that day.
**Cross-check:** `GET /api/v1/bookings/calendar?view=month` returns `services` and `capacity_days` (every day of the month) with `booked` and `capacity`.

### BKG-22 · Changing a booking: what can change when
`P0` `regression` · Decisions CAL-19, CAL-22 (11 Nov 2026); Guide page “Changing a booking” · Status: Verified 2026-11-11 (API run)
1. Future unpaid booking: change time, staff and service. 2. Reschedule it to yesterday. 3. Check it out with cash; change its time; change its service. 4. A booking from earlier today, unpaid: change the service; change the date. 5. Change notes on any booking. 6. Open a cancelled or completed booking.
**Expect:** 1 saved; 2 refused “A booking can't be moved to a time in the past.”; 3 time saved, service refused “This booking is paid: …”; 4 service allowed, date refused “This booking has started: …”; 5 always saved; 6 opens as **View appointment** with a View only line, fields locked, Close and no Save changes.
**Cross-check:** `GET /api/v1/bookings/:id` returns `change_rules` (read_only, can_move, can_change_staff, can_change_offering, can_change_customer, paid, started, reason).

### BKG-23 · Shared room: people at the same moment
`P0` `regression` · Decision CAL-17 (11 Nov 2026) · Status: Verified 2026-11-11 (API run, dummy shared service)
1. Shared-room service with 6 places, 60 min. Book 4 people at 10:00. 2. Book 3 people at 10:30. 3. Book 2 people at 10:30.
**Expect:** 1 saved; 2 refused “Only 2 place(s) left in this session”; 3 saved (4 + 2 = 6 in the room at 10:30). Group sessions still count only the bookings at the same start time.

### BKG-24 · Booking from the calendar (Day, Week, Month)
`P0` `regression` · Decisions CAL-book, CAL-4 a, NA-8, NA-10 (11 Nov 2026) · Status: Verified 2026-11-11
1. Day by Service: click + in Deep Tissue Massage at 10:00. 2. Choose 90 min. 3. Search the customer by part of the name, surname, email or phone; choose a staff member; Create. 4. Week: click + on a free time. 5. Month: click + on a future day; choose a service; pick a time. 6. Month Grid: click a number. 7. In any popup click More options. 8. Use + New appointment.
**Expect:** the same New booking popup each time, beside the column or day (not over the dashed preview); step 1 prefills the day, 10:00 and the service (one service filtered = that service; a staff column = that staff member); the dashed preview is as long as the option (60 → 90 min) and shows its end time; only staff and locations free at that time are listed, Location before Staff; Create saves, closes the popup, shows a confirmation and the booking appears with the numbers updated; steps 5–6 list that day's free times first; step 7 opens New Booking with service, option, day, time, location, staff and customer already chosen; past times, past days and closed days have no +.

### BKG-25 · Day by Staff
`P1` `regression` · Decision CAL-8 a (10 Nov 2026) · Status: Verified 2026-11-11
1. Day view, By Staff. 2. Click + in a staff member's column.
**Expect:** one column per staff member working that day (free at some time, or booked), paged like services; each booking shows customer · service; the popup opens with that staff member chosen (warns when they are not free then).

### BKG-20 · Payment status on the calendar
`P1` `regression` · Spec 33 R7 · Status: Draft
1. Compare an unpaid booking with the paid one from JNY-03.
**Expect:** the paid / unpaid indicator is right for each and updates after payment without a full reload (or after one: record which).

---

## Check-in (spec 15)

### CHK-01 · Reception check-in and live dashboard
`P0` `regression` · Spec 15 R2, R4, R8 · Status: Verified
1. At `/check-in` find today's booking by customer name; check in. 2. Try to check in the same booking again; try a booking for tomorrow.
**Expect:** status becomes checked in with the time; the dashboard's counters move (expected / arrived); the duplicate and the wrong-day attempts are refused with a reason.
**Cross-check:** the booking shows as checked in on the calendar and bookings list.

### CHK-02 · QR code check-in
`P1` `regression` · Spec 15 R1 · Status: Verified
1. Fetch the booking's QR code and the customer's QR code. 2. Submit each to the QR check-in endpoint. 3. Regenerate the customer's code and submit the old one.
**Expect:** valid codes check the customer in; the old code is refused after regeneration; a code from another business is refused.

### CHK-03 · Walk-in
`P1` `regression` · Spec 15 R6 · Status: Verified
1. Register a walk-in for a service with room now; then for one that is full; then outside opening hours.
**Expect:** the first creates a booking starting now, already checked in, with its resource; the others are refused with the reason. A walk-in goes through the normal booking rules; only minimum notice is waived.
**Cross-check:** the walk-in appears in the walk-ins report and can be taken to checkout.

### CHK-04 · Late arrival and membership validation
`P2` `regression` · Spec 15 R4, R7 · Status: Draft
1. Read the check-in configuration (grace period). Check in a booking after the grace period. 2. Check in a customer whose membership is expired for a members-only session.
**Expect:** late arrival is flagged per configuration; the invalid session is refused or warned with the reason.

### CHK-05 · Kiosk mode
`P2` `regression` · Spec 15 R3 · Status: Verified
1. Register a kiosk (the answer holds its token, shown once). 2. Without logging in, send the token as the `X-Kiosk-Token` header to `GET /api/v1/check-in/kiosk/status` and `POST /api/v1/check-in/kiosk` with a booking reference. 3. Repeat with a wrong token, no token, an unknown reference, and the same reference again.
**Expect:** step 2 checks the customer in and answers with first name, service, time and reference only; every case in step 3 is refused; the token opens no other endpoint.
