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
**Expect:** the limited tier sells once only; a paid ticket is "pending" until staff confirm it (`PUT /api/v1/events/registrations/{id}/confirm`), a free one is confirmed at once; the fourth is answered 202 and put on the waitlist; cancelling a registration offers the place to the first person waiting, and confirming the offer registers them; a customer login can register itself only.
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
