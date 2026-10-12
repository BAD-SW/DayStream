# Suite 01 — Cross-Module Journeys

Each journey follows one piece of business through every module it touches, and checks the same fact from several places. If a change anywhere breaks the chain, a journey fails even when every module still works alone. Conventions: [README](../README.md).

Journeys create their own data, named `E2E {RUN} …`. Run them in order: later journeys reuse records from earlier ones. JNY-99 cleans up.

---

### JNY-01 · Onboard a new tenant and business, from platform to first login
`P0` `journey` `guarded` · Specs 03 R2, 12 R1, 29 · As: system → tenant → owner · Status: Draft
1. As system, at `/admin/tenants` create tenant `E2E {RUN} Tenant` with owner `e2e-{RUN}-tenant@daystream.test`, currency EUR, contract dates set.
2. Log in as that new tenant owner. At `/admin/businesses` create business `E2E {RUN} Studio` with owner `e2e-{RUN}-owner@daystream.test`.
3. Log in as that new business owner.
**Expect:** tenant appears in the system list as active; the tenant owner sees only their own (empty) portfolio; the business owner lands on a business dashboard for `E2E {RUN} Studio`.
**Cross-check:**
- The new business owner also exists as a staff member in `/business` (owner is always staff: design decision 8).
- As system, the Audit Log shows the tenant creation; the tenant window's Audit Trail tab shows it too.
- As the seeded `tenant@daystream.test`, the new tenant's business is **not** visible (isolation).
- The new business has accepted payment methods configured in Settings → Payment Methods (KI-6: report if empty).

### JNY-02 · Take a service from nothing to bookable everywhere
`P0` `journey` · Specs 06 R1–R6, R10, 12 R6, 07 R1, 38 R4 · As: owner · Status: Draft
1. Create category `E2E {RUN} Cat`. Create service `E2E {RUN} Massage` in it.
2. Try to activate it with no variant.
3. Add variant "60 min" at 80.00 and "90 min" at 110.00. Activate.
4. Assign the therapist. Assign a location. Add an availability rule (weekdays 09:00–18:00).
**Expect:** step 2 is refused with a message that a variant is required; after step 4 the service is active.
**Cross-check:**
- `/bookings/new`: the service is selectable, both variants appear with the right price, and the therapist is offered.
- `/book/{serviceSlug}`: the day picker shows weekdays as available and weekend days as unavailable.
- `/booking-widget` (logged out): the service is listed with both variants.
- The therapist's staff detail → Services tab lists the service.
- Pause the service: it disappears from the booking form and the widget, and reappears on re-activation.

### JNY-03 · A front-desk day: walk-in to revenue
`P0` `journey` · Specs 05 R1, R6, 07 R2, R6, 15 R2, 28 R8, 10 C1, 17 R2 · As: reception, then owner · Status: Draft
1. As reception, create customer `E2E {RUN} Walker` (email `e2e-{RUN}-walker@daystream.test`).
2. Book them into `E2E {RUN} Massage` 60 min with the therapist, today, next free slot.
3. Confirm the booking. Check the customer in at `/check-in`. Mark the booking complete.
4. Open checkout for the booking, take payment by cash for the full amount, complete the order.
**Expect:** each status change shows immediately (pending → confirmed → checked in → completed); the order completes and a receipt opens at `/receipt/{id}` showing 80.00, the method, and the business details.
**Cross-check:**
- Calendar (`/bookings/calendar`): the booking sits in the therapist's column at the right time and shows as paid (spec 33 R7).
- Customer detail: Timeline shows created, booked, checked in, completed, paid, each with the acting user; the Billing tab lists the 80.00 transaction.
- `/orders` lists the order as completed; `/payments` lists the payment.
- As owner, the revenue report for today includes exactly +80.00 from this order compared with a reading taken before step 4.
- As owner, `/accounting` journal shows a balanced entry for the payment (Debit Cash 1100 / Credit Service Revenue 4100) if the chart of accounts is seeded.
- The slot is no longer offered to another customer in the booking form.

### JNY-04 · Customer books for themselves, staff see it, customer cancels
`P0` `journey` · Specs 07 R8, R6, R7, 05 R11 · As: customer → reception → customer · Status: Draft
1. As customer, book `E2E {RUN} Massage` for tomorrow through the customer booking flow.
2. As reception, find it in `/bookings` and on the calendar.
3. As customer, cancel it from their bookings list.
**Expect:** the customer sees the booking in their list after step 1 and as cancelled after step 3; cancellation respects the service's cancellation policy (inside the notice window it is refused or a fee is stated).
**Cross-check:**
- After step 3 the calendar no longer shows it as occupying the slot, and the slot is offered again in the booking form.
- The customer's timeline (viewed as reception) shows booking and cancellation with the customer as actor.
- The customer cannot open any other customer's booking by changing the id in the URL or API call.

### JNY-05 · Membership: sell, use, renew, cancel
`P0` `journey` `guarded` `needs-config` · Specs 08 R1–R4, R9, 09 R6, 10 C2, C3 · As: owner · Status: Draft
**Pre:** PRE-07 passed.
1. Create membership plan `E2E {RUN} Monthly` at 99.00 per month with a member benefit on `E2E {RUN} Massage` (included credits or a member price).
2. On customer `E2E {RUN} Walker`, add a stored payment method (test card), then enrol them in the plan.
3. Book the customer into the massage.
4. In Settings → Payment Methods → Recurring Billing Run, press **Run Now** (after setting the enrolment's next billing date to today through the UI if available; otherwise mark steps 4–5 `Blocked` and say why).
5. Cancel the membership.
**Expect:** enrolment is active with a next billing date; the booking is priced with the member benefit, not the public price; the run produces one successful 99.00 renewal and moves the next billing date forward one period; after cancellation the benefit no longer applies to a new booking.
**Cross-check:**
- Customer Billing tab shows the 99.00 renewal linked to the membership; running **Run Now** a second time does **not** charge again (idempotency).
- `/memberships` shows the enrolment and its status at each stage.
- The journal shows the renewal credited to Deferred Revenue 2400.
- Membership report counts one more active member after step 2 and one fewer after step 5.

### JNY-06 · Package: sell, redeem until empty
`P1` `journey` · Specs 28 R4, 09 R11, 08 R10 · As: owner, reception · Status: Draft
1. Create package `E2E {RUN} 3-pack` containing 3 × `E2E {RUN} Massage` 60 min, price 200.00. Activate.
2. Sell it to `E2E {RUN} Walker` through checkout (cash).
3. Book and redeem one session from the package, three times.
4. Attempt a fourth redemption.
**Expect:** balance reads 3 → 2 → 1 → 0; redeemed bookings cost 0.00 at checkout; the fourth is refused or falls back to normal price with a clear message.
**Cross-check:** `GET /api/v1/packages/purchases/customer/{id}` agrees with the balance on the customer profile; revenue shows 200.00 once (at purchase), not per redemption.

### JNY-07 · Refund flows through every ledger
`P0` `journey` `guarded` · Specs 10 C4, 11 R9, 17 R2 · As: manager, reception · Status: Draft
**Pre:** the paid order from JNY-03.
1. As reception, try to refund the 80.00 payment.
2. As manager, from the customer's Billing tab refund 30.00 with a reason. Then refund the remaining 50.00.
3. Try to refund 1.00 more.
**Expect:** step 1 is refused (Staff lacks `bookings:*`); both refunds succeed and require a reason; step 3 is refused because nothing remains refundable.
**Cross-check:**
- Billing tab shows the original charge and two linked refund rows; net is 0.00.
- Journal shows a reversal entry for each refund; debits equal credits.
- Today's revenue report is back to its reading from before JNY-03 step 4.
- The Audit Log has `payment.refunded` entries naming the manager.
- The booking's status is unchanged by the refund (refund is not a cancellation, per spec 10 task 4.6).

### JNY-08 · Staff member: hire, schedule, clock, get paid
`P0` `journey` · Specs 12 R1, R3, 11 R1–R4 · As: owner, new staff · Status: Draft
1. Create staff `E2E {RUN} Temp` (email `e2e-{RUN}-temp@daystream.test`, role Staff) with an hourly compensation rule of 20.00.
2. Add a shift for them today in `/schedule`. Set their time-clock PIN.
3. At `/clock`, punch in with the PIN, start and end a break, punch out. (If real elapsed time is too short to be meaningful, add a manual 4-hour entry for today in `/clock/admin` instead and note it.)
4. Approve the time in Timesheets. In Payroll, run the current pay period, review, finalize.
**Expect:** the new staff member can log in with the password set at creation; the clock shows state changes after each punch; the payroll run lists the staff member with hours × 20.00 and the configured deductions; a finalized period cannot be re-run or edited.
**Cross-check:**
- Logged in as the new staff member, `/clock/mine` shows the same entries and no one else's.
- Staff-costs report (`/accounting`) includes the amount; the journal has the payroll entry.
- The finalized period appears in Payroll history with the same totals.
- The staff member appears as selectable provider only for services they are assigned to (none yet).

### JNY-09 · Platform bills a tenant: plan to audit trail
`P0` `journey` `guarded` `needs-config` · Spec 10 A1, A3, A4, A5 · As: system, then the E2E tenant owner · Status: Draft
**Pre:** PRE-07 passed; the tenant from JNY-01.
1. As system, open the E2E tenant → Billing tab. Save a plan: flat 49.00, billing day 1, plan start date today.
2. Add a payment method for the tenant (test card).
3. Issue a credit of 9.00 with a reason.
4. Press **Charge now** for last month's cycle. Press it again for the same cycle.
**Expect:** one charge of 40.00 (49.00 − 9.00 credit) with status settled, itemised (flat, credit applied, amount charged) and a sequential reference number; the second press creates no second charge.
**Cross-check:**
- Charge History tab shows exactly one row for that cycle; credit remaining is 0.00.
- Audit Trail tab shows the plan save (field from → to), the credit, and who did it.
- `/admin/system-reports` → Billing Activity shows the attempt with outcome settled.
- As the E2E tenant owner, `/admin/billing` shows the same charge and amount.
- Suspend the tenant, press **Run now** on `/admin/processes`: the suspended tenant is skipped. Re-activate.

### JNY-10 · Three-layer money roll-up ties out
`P0` `journey` `guarded` · Spec 10 A2, B2, C11 · Status: Blocked (KI-3: net-collections feed not built)
1. Take customer payments of a known total in an E2E business for one cycle, with one refund.
2. Run tenant billing for that business with a percentage plan; then platform billing for the tenant with a percentage plan.
**Expect:** business net collections = charges − refunds; the tenant's charge to the business = flat + rate × that net; the platform's charge to the tenant = flat + rate × the sum across the tenant's businesses; nothing negative.
**Cross-check:** the three figures tie out across the customer ledger, the business Charge History, and the tenant Charge History.

### JNY-11 · Shared session fills up, waitlist takes over
`P1` `journey` · Specs 07 R3, R11, 32 R1, 33 R5, 34 R2 · As: owner, reception · Status: Draft
1. Create service `E2E {RUN} Sauna` as a shared session with capacity 4, one variant, weekday availability, a resource (a room) but also a staff member assigned (avoids KI-1).
2. Book customer A with participant count 3 at 10:00 tomorrow. Book customer B with participant count 1 at the same time.
3. Try to book customer C at the same time.
4. Add customer C to the waitlist. Cancel customer B's booking.
**Expect:** after step 2 the slot shows as full (4/4); step 3 is refused or offers only the waitlist; after step 4 customer C is offered or promoted into the freed place.
**Cross-check:** the calendar capacity strip reads 3/4 then 4/4 then back to 3/4 (or 4/4 once C is confirmed); the slot picker in `/book/{slug}` shows the same remaining places; a booking overlapping 10:30–11:30 counts against the same capacity (overlap, not exact start match).

### JNY-12 · Approved leave removes a provider's availability everywhere
`P1` `journey` · Specs 12 R4, R5, 07 R1, R15 · As: therapist, manager/owner · Status: Draft
1. Note the therapist's available slots for `E2E {RUN} Massage` on a weekday next week.
2. Request leave for that day for the therapist; approve it as owner.
3. Re-check availability. Then cancel the leave and check again.
**Expect:** after approval that day offers no slots with the therapist in the booking form, the customer flow and the widget; existing bookings on that day are flagged as conflicts rather than silently deleted; after cancelling the leave the slots return.
**Cross-check:** `/staff/calendar` and `/schedule` show the leave; `GET /api/v1/bookings/availability/days` for the month marks the day unavailable.

### JNY-13 · Public widget booking reaches the back office
`P0` `journey` · Spec 38 R3–R10, R15 · As: anonymous visitor, then reception · Status: Draft
1. Logged out, open `/booking-widget` for the demo business. Choose `E2E {RUN} Massage`, a variant, a day and a slot.
2. Register as a new customer `e2e-{RUN}-web@daystream.test` when prompted (registration is mandatory).
3. Complete the emulated payment step if the business requires payment; reach the confirmation.
**Expect:** the widget never lets the visitor confirm without registering; the confirmation shows service, time, price and a reference.
**Cross-check:**
- As reception: the booking is in `/bookings` and on the calendar with the right provider; a new customer record exists with that email and source showing it came from the widget.
- The slot is no longer offered in the internal booking form.
- The audit trail records the widget booking.
- The widget for the demo business does not list any offering from the thin `business@daystream.test` business.

### JNY-14 · One booking, four roles, strict boundaries
`P0` `journey` `negative` · Specs 02 R4, R5, 29 R9 · As: reception, therapist, trainer, biz-thin · Status: Draft
**Pre:** a booking for the therapist created by reception.
1. As therapist, open their own calendar and the booking; update its status.
2. As trainer, look for the same booking.
3. As therapist, try to open `/accounting`, `/settings`, `/admin/tenants`, and call `POST /api/v1/pay/refunds`.
4. As biz-thin (a different business), request the booking and its customer by id through the API.
**Expect:** the therapist can see and update it; the trainer sees it only as far as business-wide `bookings:read` allows and cannot see it in their own schedule; step 3: pages are not shown and the API returns 403; step 4 returns 404 or 403, never the record.
**Cross-check:** none of the refused attempts changed any data; denied attempts on admin routes are visible in the Audit Log if denial auditing is implemented (record actual behaviour on first run).

### JNY-15 · From first message to paying customer: one person, one history
`P0` `journey` · Specs 46, 47, 48 · As: owner, reception, customer · Status: Blocked (specs 46, 47 and 48 not built: KI-13)
Follows one person through People, Inbox, Marketing, bookings and payments. Uses the mock message adapter only (suite 17 sending rule).
1. Simulate an inbound SMS from an unknown number: "Do you have beginner classes?".
2. As reception, open the Inbox, reply, and fill in the first name from the person panel. Set a follow-up for today.
3. The person submits the lead form `E2E {RUN} Form` with the same phone number, adding an email and ticking the consent box.
4. As reception, book and take payment for a first session for this person; complete the missing surname when asked. Check them in.
5. As owner, send a campaign to the starter segment "New customers" (containing only E2E people).
6. The person registers a login with the same email and opens the customer portal.
**Expect:** one person throughout, never two. After step 1: a lead, source "Inbound message", status New. After step 2: status Contacted, listed under "Follow-up due". After step 3: same person, now with an email, source unchanged, email consent recorded with method "form". After step 4: stage is "New customer", lead status Converted with the booking named, follow-up cleared, no "convert" button was used. After step 5: the campaign is in their thread and on their Timeline. After step 6: the portal shows their booking and their in-app messages; staff see a last login date.
**Cross-check:**
- People → Leads no longer lists them; People → Customers does; Marketing → Leads → Converted does.
- The profile Timeline tells the whole story in order: message, reply, form, booking, payment, check-in, stage change, campaign, login.
- The payment in `/payments` and the lead report's converted revenue are the same amount.
- SQL: exactly one `cus_customers` row for this phone number and email in the business.

### JNY-99 · Journey cleanup
`P2` `journey` · Status: Draft
1. Cancel open E2E bookings, void open E2E orders, cancel E2E memberships, archive E2E services, categories, packages, plans, customers and staff, deactivate E2E resources.
2. As system, suspend then leave suspended the `E2E {RUN} Tenant` (tenants are not hard-deleted).
**Expect:** no active `E2E {RUN}` record remains bookable or billable. Anything that could not be archived is listed in the run log.
