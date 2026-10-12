# Suite 13 — Marketing

Persona: owner (Marketing needs `settings:*`). Covers spec 16: templates, campaigns, sequences, consent, funnels, analytics. Conventions: [README](../README.md).

**Sending rule:** every audience in this suite is a segment containing only E2E customers with `@daystream.test` addresses. Never send to a seeded segment or "all customers". Delivery is verified up to the provider hand-off (recipient list, queued / sent status), not in an inbox.

---

### MKT-01 · Email template with merge fields
`P1` `regression` · Spec 16 R6 · Status: Verified
1. Create template `E2E {RUN} Tpl` using first-name and business-name merge fields. Preview it for an E2E customer. Edit; delete a second throw-away template.
**Expect:** the preview shows the customer's real values, with a sensible fallback when a field is empty; no raw `{{…}}` remains.

### MKT-02 · Create a campaign for a segment and send a test
`P0` `regression` · Spec 16 R1 · Status: Verified
1. `/marketing/campaigns/new`: campaign `E2E {RUN} Camp`, the template from MKT-01, audience = the E2E segment from CUS-06. Send a test to a `.test` address.
**Expect:** the audience size shown equals the segment's member count; the test send reports success or a specific failure.

### MKT-03 · Schedule, then send a campaign
`P0` `regression` `guarded` · Spec 16 R1, R10 · Status: Verified
**Pre:** the audience is the E2E segment (re-check the count before sending).
1. Schedule the campaign for 10 minutes ahead; reschedule; then send now. 2. Try to edit or re-send it after sending.
**Expect:** status draft → scheduled (a new time can be set; a time in the past is refused) → sent; a sent campaign cannot be edited or sent twice.
**Cross-check:** the recipients list has exactly the segment's contactable members, each with a delivery status; each recipient's customer Timeline shows the campaign.

### MKT-04 · Consent and unsubscribe are honoured
`P0` `regression` · Specs 16 R8, 02 R8 · Status: Verified
1. Before MKT-03, turn marketing email off for one member of the E2E segment (CUS-15). 2. After sending, use the unsubscribe link / endpoint for another recipient. 3. Send a second campaign to the same segment.
**Expect:** the opted-out member is excluded from the first send; the unsubscribed one is excluded from the second; the unsubscribe works without logging in and updates the customer's preferences.

### MKT-05 · Automated sequence
`P1` `regression` · Spec 16 R4, R5 · Status: Blocked (the sequence builder is not built: a sequence cannot be given steps, so it cannot be switched on)
1. `/marketing/sequences/new`: from a pre-built template (for example a welcome series) or from scratch, trigger "customer created", two steps with a delay. Validate; activate. 2. Create a new E2E customer. 3. Pause the sequence.
**Expect:** validation catches an empty step or a missing template; the new customer is enrolled after step 2; pausing stops further steps without losing enrolments.
**Cross-check:** the enrolments list shows the customer and their current step.

### MKT-06 · Campaign analytics
`P2` `regression` · Spec 16 R7 · Status: Verified
1. Open the sent campaign's analytics.
**Expect:** sent equals the recipient count; rates are percentages between 0 and 100 with no division-by-zero artefacts when opens / clicks are zero.

### MKT-07 · Lead funnel creates a lead
`P1` `regression` `known-issue` (D-14) · Spec 16 R9 · Status: Verified
1. Create funnel `E2E {RUN} Funnel`. 2. Logged out, open its public page and submit the form with a `.test` email; submit invalid data; submit the same email twice.
**Expect:** a new customer is created at stage `lead` with the funnel as source; invalid input is refused; the repeat submission does not create a duplicate customer.
**Cross-check:** funnel analytics count one submission; the lead appears in `/customers` filtered by stage lead.

### MKT-08 · SMS campaign respects channel consent
`P2` `regression` `needs-config` · Spec 16 R2 · Status: Verified
**Pre:** an SMS provider is configured; otherwise verify only up to the audience step and mark sending `Blocked`.
1. Create an SMS campaign for the E2E segment.
**Expect:** only members with a phone number and SMS consent are counted; message length / segments are shown before sending. Locally no SMS provider is configured: the audience is verified, sending is not attempted.

---

## Leads and audiences (spec 48)

Written from the draft spec on 2026-10-12, before the feature exists. All are `Blocked` until the spec 48 task named on each script is done (KI-13); the spec itself is still a draft, so these scripts are revised when its requirements are confirmed. Persona: owner unless stated. When spec 48 ships, MKT-07 is replaced by MKT-13.

### MKT-09 · Leads tab shows the same leads as People
`P0` `regression` · Spec 48 R1, R11 · Status: Blocked (spec 48 task 3)
**Pre:** three E2E leads and one E2E active customer.
1. Open Marketing. 2. Read the tabs. 3. Open Leads; use the New, Contacted, Mine and Unassigned filters; search by phone.
**Expect:** tabs are Leads, Campaigns, Sequences, Forms, Templates, with Leads first; the three leads are listed with status, source, owner, created date and next follow-up; the active customer is not listed.
**Cross-check:** People → Leads view (CUS-17) lists the same people for the same filters; opening a lead opens the same profile as from People.

### MKT-10 · Add a lead by hand
`P0` `regression` · Spec 48 R5 · As: manager · Status: Blocked (spec 48 task 3)
1. "Add lead": first name `E2E {RUN} Lead`, phone only, source "Walk-in", a note. 2. Add again with the same phone. 3. Add one with the consent box ticked and a reason.
**Expect:** a lead is created at status New in seconds, with no email required; step 2 opens the existing person; step 3 records email consent with method "staff entry" and the reason.

### MKT-11 · Lead status: contacted, lost, reopened
`P1` `regression` · Spec 48 R2 · Status: Blocked (spec 48 task 2)
1. Send a message to a New lead from the row action. 2. Close another lead as Lost without a reason. 3. Close it with reason "Price". 4. Reopen it.
**Expect:** the first lead becomes Contacted with the date; step 2 is refused; after step 3 the lead leaves the open list and appears under Lost with the reason; after step 4 it is Contacted again; there is no way to add a custom status.
**Cross-check:** every change is on the person's Timeline; the lead stays at stage "lead" in People while Lost.

### MKT-12 · Follow-up due
`P1` `regression` · Spec 48 R4 · As: manager · Status: Blocked (spec 48 task 3)
1. Set follow-up for today on one lead (owner = me) and for next week on another. 2. Open "Follow-up due". 3. Mark it done and set the next one.
**Expect:** only today's lead is listed; the Marketing menu entry shows a count of 1 for me; after step 3 the count is 0 and the new date is shown.
**Cross-check:** "today" follows the business's time zone, not UTC.

### MKT-13 · Lead form creates a lead (hosted page)
`P0` `regression` · Spec 48 R6 · Status: Blocked (spec 48 task 4)
1. Create form `E2E {RUN} Form` with name, email and a question; set a tag and an owner. 2. Logged out, open its link and submit with `e2e-{RUN}-form@daystream.test`, consent box left unticked. 3. Submit the same email again. 4. Submit with no email and no phone. 5. Switch the form off and open the link.
**Expect:** one lead at status New, source "Lead form" with the form's name, tagged and assigned; no marketing consent recorded; the repeat creates no second person and is on the Timeline; step 4 is refused; step 5 shows the form is unavailable.
**Cross-check:** form analytics show views, two submissions and one lead; the form of another business of the same tenant cannot be reached with this business's address.

### MKT-14 · Lead form consent box
`P0` `regression` · Specs 48 R6, 46 R9 · Status: Blocked (spec 48 task 4)
1. Submit the form with the consent box ticked.
**Expect:** email marketing consent is recorded with method "form" and the form name; the box is never pre-ticked.
**Cross-check:** the lead is counted in an email marketing audience; the unticked lead from MKT-13 is excluded with reason "no consent".

### MKT-15 · Embedded lead form on an external site
`P1` `regression` · Spec 48 R6 · Status: Blocked (spec 48 task 4)
**Pre:** the local test page used for the booking widget (WEB suite), with the copied form snippet pasted in.
1. Submit the embedded form. 2. Restrict the form's allowed sites to another address and reload.
**Expect:** the form shows with the business theme and creates a lead as in MKT-13; after step 2 the form refuses to load on this page.

### MKT-16 · A lead becomes a customer by booking
`P0` `regression` `journey` · Specs 48 R3, 46 R7 · Status: Blocked (spec 48 task 2)
**Pre:** an E2E lead with a follow-up set and an active "New lead welcome" sequence.
1. Book and complete a paid booking for the lead (as reception). 2. Open Marketing → Leads.
**Expect:** no "convert" action was needed; the person's stage is no longer "lead"; they left the open list and appear under Converted with the date and the booking that caused it; the follow-up is cleared; the sequence stopped.
**Cross-check:** source, owner, notes and messages are unchanged on the profile; People → Customers view now lists them.

### MKT-17 · Leads from other entry points
`P1` `regression` · Spec 48 R7 · Status: Blocked (spec 48 task 5)
1. Register in the booking widget with a new `.test` email and stop before booking. 2. Simulate an inbound message from an unknown number (INB-04).
**Expect:** two leads at status New, sources "Booking widget" and "Inbound message"; the users chosen in Settings → Leads are notified; the owner rule is applied.

### MKT-18 · Automatic follow-up sequence by source
`P1` `regression` · Spec 48 R8 · Status: Blocked (spec 48 task 6)
1. In Settings → Leads attach "New lead welcome" to source "Lead form". 2. Submit the form twice: once with consent, once without. 3. Simulate a reply from the first lead.
**Expect:** both leads receive the first reply to their enquiry; only the lead with consent is queued for the later promotional step, the other is skipped with reason "no consent"; the reply stops the sequence; the profile shows the sequence and next step.

### MKT-19 · Campaign audience: existing customers, with exclusions shown
`P0` `regression` · Specs 48 R10, 46 R10 · Status: Blocked (spec 48 task 7)
1. New campaign: open the audience picker. 2. Choose the starter segment "Active". 3. Create a new segment from inside the picker. 4. Read the summary.
**Expect:** every segment of the business is offered, starter ones first, with no restriction to leads; the summary shows people in the audience, people excluded with reasons, and people who will receive it.
**Cross-check:** send two campaigns on the same day to the same E2E segment: the second is held back for people who already received one, and the count held back is shown.

### MKT-20 · Lead report
`P1` `regression` · Spec 48 R9 · Status: Blocked (spec 48 task 8)
**Pre:** this run's leads: known numbers created, converted (MKT-16) and lost (MKT-11), by source.
1. Open the lead report for today. 2. Break down by source. 3. Export.
**Expect:** new, converted, conversion rate, open and lost-by-reason match a hand count of this run's E2E leads; the funnel reads created → contacted → converted; revenue is shown as currency.
**Cross-check:** the converted lead's revenue equals their payments in `/payments`.
