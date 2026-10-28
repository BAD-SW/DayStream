# Suite 06 — Business Setup, Schedule & Time Clock

Persona: owner unless stated. Covers spec 12 (staff), spec 13 (resources), locations, the Schedule module and the Time Clock. These records are the inputs to availability, so each script cross-checks into booking. Conventions: [README](../README.md).

---

## Locations

### SET-01 · Create a location with opening hours
`P0` `regression` · Design decision 2 · Status: Verified
1. `/settings/locations/new`: create `E2E {RUN} North` with address and timezone. Set hours Mon–Fri 09:00–18:00, closed weekends.
**Expect:** the location appears in the list and in `/business`.
**Cross-check:** the calendar's time axis for this location starts and ends with its business hours (spec 33 R2); it is offered when assigning services, staff and resources.

### SET-02 · Holiday override closes a day
`P1` `regression` · Status: Verified
1. Add an hours override closing the location on a specific weekday next month. 2. Remove it.
**Expect:** with the override, no slots are offered that day for services at this location (booking form and `/api/v1/bookings/availability/days`); without it they return.

### SET-03 · Deactivate a location
`P1` `regression` `guarded` · Status: Verified
**Pre:** `E2E {RUN} North` with no future bookings.
1. Deactivate.
**Expect:** it leaves active pickers; existing history remains readable. Deactivating a location that has future bookings warns or is refused.

---

## Staff

### SET-04 · Create a staff member (login + profile together)
`P0` `regression` · Spec 12 R1; design decision 1 · Status: Verified
1. `/staff/new`: create `E2E {RUN} Provider`, email `e2e-{RUN}-prov@daystream.test`, a password, role Staff.
2. Try to create a second staff member with the same email.
**Expect:** creation requires email and password; the duplicate is refused.
**Cross-check:** the new person can log in and sees the Staff sidebar (AUTH-08); they exist in both the staff list and the user list.

### SET-05 · Edit profile, reset password, deactivate
`P1` `regression` · Spec 12 R1 · Status: Verified
1. Change name and phone; upload a photo. 2. Reset their password from the staff page. 3. Deactivate.
**Expect:** edits persist; old password stops working, new one works; a deactivated staff member cannot log in and is not offered as a provider, but past bookings still show their name.

### SET-06 · Qualifications and expiry
`P2` `regression` · Spec 12 R2 · Status: Verified
1. Add a qualification expiring in 10 days and one already expired.
**Expect:** both saved; the expiring one appears in the expiring-qualifications view; the expired one is flagged.

### SET-07 · Weekly availability pattern drives bookable slots
`P0` `regression` · Spec 12 R3 · Status: Verified
1. Give `E2E {RUN} Provider` a pattern Tue and Thu 10:00–14:00. Assign them to a service and a location.
**Expect:** in the booking form with this provider selected, slots are offered only Tue / Thu between 10:00 and 14:00, and the last slot ends by 14:00 for the chosen duration.
**Cross-check:** `GET /api/v1/staff/{id}/availability` for a week returns the same windows.

### SET-08 · Availability override for a single day
`P1` `regression` · Spec 12 R4 · Status: Verified
1. Add an override making next Tuesday unavailable; add another making next Wednesday 09:00–12:00 available.
**Expect:** Tuesday offers nothing; Wednesday offers 09:00–12:00 although the pattern excludes it.

### SET-09 · Leave request and approval
`P1` `regression` · Spec 12 R5 · As: provider, then owner · Status: Verified
1. As the provider, request leave for two days. 2. As owner, at `/staff/leave` reject one request and approve another.
**Expect:** status moves pending → approved / rejected; the leave balance changes only on approval.
**Cross-check:** JNY-12 covers the effect on booking.

### SET-10 · Service and location assignment, capacity
`P1` `regression` · Spec 12 R6–R8 · Status: Verified
1. Assign and unassign a service and a location on the staff detail page. 2. Set a daily capacity of 2 bookings.
**Expect:** the staff member is offered only for assigned services at assigned locations; a third booking on the same day is refused or warned per the capacity rule.
**Cross-check:** the same assignment is visible from the service's Staff tab and the location's staff list.

### SET-11 · Staff self-service
`P2` `regression` · Spec 12 R11 · As: therapist · Status: Verified
1. Open own profile, own calendar, own metrics, notification preferences; change a preference.
**Expect:** all show only this person's data; the preference persists. They cannot open another staff member's detail page.

---

## Resources

### SET-12 · Resource type and resource
`P0` `regression` · Spec 13 R1, R2 · Status: Verified
1. Create type `E2E {RUN} Room type`; create resource `E2E {RUN} Room 1` of that type at a location with capacity 1; add its weekly schedule.
**Expect:** both appear; the resource has schedule, bookings, maintenance, dependencies and utilisation views.

### SET-13 · Service requires a resource; conflicts are prevented
`P0` `regression` · Spec 13 R4, R5 · Status: Verified
1. Add a service requirement linking a staffed service to `E2E {RUN} Room 1`.
2. Book the service at 11:00 with provider X. Try to book the same service at 11:00 with provider Y.
**Expect:** the second booking is refused because the room is taken, even though provider Y is free.
**Cross-check:** `/resources/calendar` shows the room occupied at 11:00; `POST /api/v1/resources/find-available` excludes it for that time.

### SET-14 · Maintenance window blocks the resource
`P1` `regression` · Spec 13 R7 · Status: Verified
1. Add maintenance for `E2E {RUN} Room 1` tomorrow 13:00–15:00. 2. Delete it.
**Expect:** no slot needing the room is offered in that window; the calendar shows a maintenance block (spec 33 R3); slots return after deletion. Adding maintenance over an existing booking warns.

---

## Schedule and time clock

### SET-15 · Shifts in the Schedule module
`P1` `regression` · As: manager · Status: Verified
1. At `/schedule` add a shift for the therapist; edit its times; delete it. Try to add a shift outside business hours and two overlapping shifts for one person.
**Expect:** create / edit / delete reflected at once; invalid shifts are refused or warned.
**Cross-check:** as reception (no `staff:read`), `/schedule` is not available.

### SET-16 · Time clock: PIN, punches, corrections
`P0` `regression` · As: owner, therapist · Status: Verified
1. As owner, in Timesheets set a PIN for the therapist. 2. At `/clock` punch in with a wrong PIN, then the right one; start break; end break; punch out.
3. As owner, correct the punch-out time in Timesheets and add a manual entry for yesterday; delete the manual entry.
**Expect:** wrong PIN refused; the clock accepts only the valid next action (cannot punch out before in, cannot start a second break); corrections are saved and marked as edited.
**Cross-check:** as therapist, `/clock/mine` shows the corrected record and nobody else's; `GET /api/v1/clock/my-hours` totals match the Timesheets total for that person; a staff member can change their own PIN but not another's.

---

## Data migration (spec 50, Wave 1)

### SET-17 · Data Migration home and who may use it
`P1` `regression` · Spec 50 R14–R16 (Bill `0921f79`) · As: owner, Staff, organisation owner · Status: Verified
1. Business Setup → **Data Migration**: the imports in their fixed order (Customers → Payment Methods → … → Account Balances), with the later waves shown as not yet available. 2. As Staff, open it and call the import. 3. Try an import kind that is not built yet (memberships). 4. As the organisation owner, open the business from Businesses → Data Migration and run a trial there.
**Expect:** the tab is under Business Setup, not in the main menu; Staff is refused (no settings permission); an unbuilt kind is refused with a plain message; the organisation owner can run imports for the business, and the run history names who ran each one. People has no "Import CSV" button any more, and `/customers/import` opens this tab.

### SET-18 · Import customers: detection, trial, import, run again
`P0` `regression` · Spec 50 R1–R4, R11–R13 · As: owner · Status: Verified
1. Upload a CSV with a header row (Customer ID, First Name, Surname, Email, Mobile, Tags, Notes, Customer Since): 2 valid rows (one with accents) and 1 with a bad email. 2. Upload a file without a header row (email, first name, last name, phone). 3. Run a trial. 4. Import. 5. Import the same file again. 6. Read the run history.
**Expect:** the header row is recognised and the columns are matched by name and common synonyms (Surname → last name, Mobile → phone, Customer ID → old id, Customer Since → join date); the headerless file is recognised as data and the email and phone columns are found from their values; the trial writes nothing and predicts 2 imported, 1 failed, naming the row, the field and the reason; the import creates the 2 people with accents intact, keeps the old system's id, applies the tags and the join date; the second import matches them (0 new); no email is sent to imported people; every run is in the history, marked trial or import, with counts and who ran it.
**Regression watch (D-57, fixed 2026-10-28):** a file whose columns are mostly text (ids, names, tags, notes) must still be read as having a header row when its first row holds known column names.

### SET-19 · Import payment methods (processor mapping file)
`P0` `regression` · Spec 50 R5, R11, R12 · As: owner · Status: Verified
1. After SET-18, upload a mapping file: two cards for one old customer id, one row with an unknown id, one row without the Stripe customer id. 2. Trial, then import, then import again. 3. Open the customer's payment methods.
**Expect:** the trial writes nothing; the import attaches the 2 cards to the customer found by the old id, the first one is the default, and the Stripe customer is recorded for off-session charges; the two bad rows fail with plain reasons and the rest go in; importing again adds nothing; the customer shows the cards masked, never the token. No card number is ever imported (the file carries only processor references).

### SET-20 · Import account balances
`P1` `regression` · Spec 50 R9, R11 · As: owner · Status: Verified
1. Upload a balances file: a 25.00 credit for one customer, an 80.00 invoice issued 40 days ago with 30.00 paid for another, an invoice without an issue date, and a row for an unknown email. 2. Trial, then import.
**Expect:** the trial changes no balance; the import adds 25.00 account credit and an issued invoice of 80.00 dated on its original issue date with 30.00 already paid; the undated invoice and the unknown customer fail with plain reasons.
