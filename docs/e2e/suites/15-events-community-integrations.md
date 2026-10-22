# Suite 15 — Events, Community & Integrations

Covers spec 14 (events and workshops), spec 22 (community), spec 20 (integrations). Events and Community are feature-flagged (`feature.events`, `feature.community`). Conventions: [README](../README.md).

**Pre for EVT and COM scripts:** the flag is on for the demo business (SYS-08). If the flag key does not exist or cannot be turned on, mark the scripts `Blocked` with that reason: the modules are then unreachable for real users too, which is itself a finding.

---

## Events and workshops

### EVT-01 · Create, ticket and publish an event
`P0` `regression` · Spec 14 R1, R4 · As: owner · Status: Verified
1. `/events/new`: event `E2E {RUN} Workshop` next week, capacity 3, location, a facilitator. Add ticket tiers: Standard 40.00, Early bird 30.00 (limited to 1). 2. Publish.
**Expect:** a draft event is not public; after publishing it appears in the public event calendar (`GET /api/v1/events/calendar`) with its tiers; an event cannot be published without a date or a ticket tier.

### EVT-02 · Registration, capacity and waitlist
`P0` `regression` · Spec 14 R5, R6 · As: reception, customer · Status: Verified
1. Register three E2E customers (one as the customer themself). Try to give two of them the Early bird tier. 2. Register a fourth. 3. Cancel one registration; confirm the waitlist entry.
**Expect:** the limited tier sells once only; a paid ticket is "pending" until it is paid (online, or at reception through checkout: EVT-08, EVT-09) or staff confirm it (`PUT /api/v1/events/registrations/{id}/confirm`), a free one is confirmed at once; places are counted by group size; the fourth is answered 202 and put on the waitlist; cancelling a registration offers the place to the first person waiting, and confirming the offer registers them; a customer login can register itself only.
**Cross-check:** registrations appear on each customer's Timeline; ticket revenue appears in the events report.

### EVT-03 · Event check-in and attendee export
`P1` `regression` · Spec 14 R8 · As: reception · Status: Verified
1. Check in two attendees (one by QR). 2. Export the attendee list.
**Expect:** attendance shows 2 of 3; the export lists all registrations with status and ticket tier; a cancelled registration cannot be checked in.

### EVT-04 · Cancel an event
`P0` `regression` `guarded` · Spec 14 R7 · As: owner · Status: Verified
1. Send a communication to attendees (E2E `.test` addresses only). 2. Cancel the event.
**Expect:** all registrations become cancelled; refunds follow the event's policy for paid tickets; the event leaves the public calendar; the cancellation notice is queued for attendees.

### EVT-05 · Recurring events and series
`P2` `regression` · Spec 14 R2, R3 · As: owner · Status: Verified
1. Create a weekly recurring event for 3 occurrences and generate them. Create a series (program) containing two events. Cancel the recurrence.
**Expect:** with "end after 3" exactly three dated events are generated, once (generating again adds none); cancelling the recurrence leaves existing occurrences intact.

### EVT-06 · Customers see the organisation's events
`P0` `regression` · THE-20 R1–R3 (David, 2026-10-22) · As: owner, customer · Status: Verified
1. As the owner, create an event "Hosted at" a location of the business, ticket tax 10%, capacity 6, with three tickets: Standard 25.00, Members 20.00 ("Members only"), First timers 15.00 (`first_time`); publish it. 2. As the customer, open Events (Upcoming events) and the event page.
**Expect:** the list shows the event with its date block, type, time and location in the business's time zone, "From €25.00" (the lowest ticket open to this customer, as in the approved canvas) and "6 spots left"; the event page offers Standard and shows Members as "Members only" and First timers as "First-time customers only" (not selectable) for a customer who has had a visit or purchase at the business; "custom" tickets are never offered to customers (David, 2026-10-22); the Register panel shows Tickets, Tax (10%) and Total, both ways to pay, and the cancellation policy as the hosting business set it; the staff event list (`GET /api/v1/events`) stays closed to a customer; a tax category of no business of the organisation is refused.

### EVT-07 · Members-only tickets
`P0` `regression` · THE-20 R11–R12 · As: customer · Status: Verified
1. Without a membership, choose the Members ticket; as a customer who has been before, try a First timers ticket. 2. With an active membership at the hosting business, choose the Members ticket, paying at reception.
**Expect:** without a membership the Members ticket is refused ("members only"); the First timers ticket is refused ("first-time customers only": a first-time customer has no earlier completed visit and no earlier purchase at the hosting business); with an active membership it is accepted, held until the event starts, takes a place and shows as "Awaiting payment".

### EVT-08 · Pay a ticket online
`P0` `regression` · THE-20 R5, R7–R10 · As: customer · Status: Verified (test processor; the Stripe card form is not exercised by the runner)
1. Choose Standard for 2 people, "Pay online now by card", Continue to payment. 2. Pay.
**Expect:** the places are held for 10 minutes and an open order is made in the hosting business (one Event ticket line, quantity 2, ticket tax); after paying, the registration is confirmed, the card charge is on the customer with a processor reference, the sale posts to 4700 Event Revenue (and tax to 2300), and it shows in Sales by Item and as Event Revenue in the Revenue report; nobody else can finish the payment.

### EVT-09 · Pay a ticket at reception
`P0` `regression` · THE-20 R6 · As: reception · Status: Verified
1. On the event's Registrations tab, a place shows "Pay at reception": Take payment. 2. Pay in checkout (cash).
**Expect:** the ticket opens as an order of the hosting business with one Event ticket line and the ticket tax; paying it confirms the place and records the amount paid; a paid place cannot be paid again; reception can still cancel an unpaid place.

### EVT-10 · Customers cancel within the business's settings
`P0` `regression` · THE-20 R13–R16 · As: owner, customer · Status: Verified
1. With cancelling off (the default), cancel as the customer. 2. Settings → System → Customer cancellations → Events: customers can cancel, up to 24 hours, money back to the card; cancel a ticket paid online. 3. Switch to account credit; pay another ticket online and cancel it. 4. Set 100 hours; cancel a ticket of an event 3 days away.
**Expect:** while off, the customer is told to contact the business; only the business changes the settings; in time, the whole ticket is refunded to the card through the processor and the places are freed; with account credit, the money becomes credit the customer can use later and no money goes back through the processor (no row in Payments Received); after the limit, cancelling online is refused with the reason.

### EVT-11 · An unfinished online payment releases the place
`P1` `regression` · THE-20 R6 · As: customer · Status: Verified
1. Start paying online and do not finish within 10 minutes.
**Expect:** the place is released, the open order is voided, and the next person on the waitlist is offered the place.

### EVT-12 · Full events and the waitlist
`P1` `regression` · THE-20 R4, R16 · As: customer · Status: Verified
1. A free event with one place, already taken: register as the customer. 2. Open My events. 3. Leave the waitlist.
**Expect:** the event shows as Free and "Full · waitlist open"; the customer joins the waitlist, sees "Waitlist #n" in My events and can leave it (once).

### EVT-13 · An event of another business of the organisation
`P0` `regression` · THE-20 R2; hosting business (David, 2026-10-22) · As: customer, reception · Status: Verified
1. An event held at a location of a second business of the organisation, with a paid ticket. 2. As a customer of the first business, open it and register, paying at reception. 3. Reception takes the payment.
**Expect:** the customer sees it (with "Hosted by"); paying online is offered only when the hosting business has a payment processor; the registration belongs to a customer record in the hosting business, found or made by email, and the ticket is sold there; being new to that business, the customer may take its First timers ticket, and after a purchase there it is no longer offered.

### EVT-14 · Event emails
`P1` `regression` · THE-20 (David, 2026-10-22) · As: customer, reception · Status: Verified
1. Register for a free event; pay a ticket online; reserve a place to pay at reception and have reception take the payment; cancel a paid registration; leave an online payment unfinished.
**Expect:** a transactional email is queued for: registration confirmed (free, paid online, paid at reception), place reserved to pay at reception (with the amount to pay), registration cancelled (with the refund: to the card or as account credit); none for an unfinished online payment. Dates and times are written in the hosting business's time zone. The "transactional emails" switch (CUS-33) covers them; the customer's Timeline lists them under Messages.

---

## Community

### COM-01 · Feed: post, react, comment, moderate
`P1` `regression` · Spec 22 R1 · As: customer, owner · Status: Verified
1. As customer, post in the feed; react; comment. 2. As owner, delete the post.
**Expect:** the post appears for other members of the same business only; after deletion it is gone for everyone; a customer cannot delete another member's post.

### COM-02 · Challenge, points and leaderboard
`P1` `regression` · Spec 22 R2, R3, R6 · As: owner, customer · Status: Verified
1. As owner, create challenge `E2E {RUN} Challenge`. 2. As customer, join it; complete a booking that earns points. 3. Open the leaderboard; redeem a reward if points allow.
**Expect:** the customer is listed in the challenge; points increase once per qualifying action; the leaderboard order follows points; a redemption cannot exceed the balance.

### COM-03 · Reviews
`P2` `regression` · Spec 22 R10 · As: customer, owner · Status: Verified
1. As customer, review a service they completed; try to review one they never booked. 2. As owner, respond and moderate.
**Expect:** only someone with a completed or checked-in visit can review, with a rating from 1 to 5; a new review is "pending"; one set to "rejected" is not in the published list.

---

## Integrations

### INT-01 · Marketplace and connection states
`P2` `regression` · Spec 20 R10 · As: owner · Status: Verified
1. Open `/integrations`. Start connecting a provider that has no credentials configured locally.
**Expect:** the marketplace lists available integrations with connected / not connected states; an unconfigured provider fails with a clear message, not a blank page or an endless spinner.

### INT-02 · Outbound webhook
`P1` `regression` · Spec 20 R8 · As: owner · Status: Verified
1. Create a webhook for the "booking created" event pointing to a local test receiver. Press **test**. 2. Create a booking. 3. Point the webhook at an unreachable URL and create another booking. 4. Delete the webhook.
**Expect:** the test delivery and the real event are delivered with a signature header and the booking payload; the failed delivery is logged with its error and retry state; nothing is sent after deletion.
**Cross-check:** the deliveries log lists each attempt with status code and time.

### INT-03 · API keys
`P0` `regression` · Spec 20 R9 · As: owner · Status: Blocked (a key can be created and revoked, but no endpoint accepts one yet)
1. Create an API key; note it. 2. Call a read endpoint with it. 3. Revoke it; call again.
**Expect:** the full key is shown once only (masked afterwards); it reaches only this business's data and only the granted scope; a revoked key returns 401.

### INT-04 · iCal feeds
`P1` `regression` · Spec 20 R3 · As: therapist, customer · Status: Verified
1. Get the staff iCal feed URL; fetch it. Do the same for the customer feed. 2. Regenerate the token; fetch the old URL.
**Expect:** valid iCalendar text listing only that person's bookings, with times in the right time zone; the old URL stops working after regeneration.
**Cross-check:** a single booking's `GET /api/v1/bookings/{id}/ical` matches the same event in the feed.
