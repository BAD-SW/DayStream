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

## Leads and audiences (spec 48, THE-17)

MKT-09 to MKT-11, MKT-21 and MKT-22 cover Leads as decided by David on 28 October 2026 (Linear THE-17) and built that day: Leads is the first section of Marketing, the same people data as People, with stages defined by each business under Settings → Leads. The other scripts of this section were written from the draft spec 48 on 2026-10-12 and stay `Blocked` until their part is decided and built (KI-13). Persona: owner unless stated. Runner: `rleads`.

### MKT-09 · Leads list: the six fields, filters, same people as People
`P0` `regression` · THE-17 · Status: Verified
**Pre:** E2E leads from MKT-10 and one E2E customer (not a lead).
1. Open Marketing. 2. Read the tabs. 3. On Leads, use the stage, source and assigned staff filters and the search. 4. Make one lead a customer (a booking, or stage changed in the database) and reload.
**Expect:** tabs are Leads, Campaigns, Sequences, with Leads first and open by default; each lead shows assigned staff, created at (business local time, e.g. "Oct 28, 2026"), source, messages sent, lead stage and tags ("No tags assigned" when none); the customer is not listed; messages sent counts every sent message on every channel, automatic ones included (a failed one does not count); after step 4 that person has left the list. Clicking a row opens the person's profile.
**Cross-check:** `GET /v1/leads?business_id=` total equals People → Leads (`GET /v1/customers?view=leads`) total.

### MKT-10 · Add a lead by hand
`P0` `regression` · THE-17 · Status: Verified
1. "Add lead": first name `E2E {RUN} Lead`, phone only, lead source "Missed call", assigned staff, a tag. 2. Add one with no email and no phone. 3. Add one with an unknown source (API). 4. Add a second lead with an email, then the same email again.
**Expect:** step 1 creates the lead in the first stage (New) with that source, staff and tag; steps 2 and 3 are refused ("An email address or a phone number is required"); step 4's repeat is refused and names the existing person.

### MKT-11 · Change stage and assigned staff in the row
`P0` `regression` · THE-17 · Status: Verified
1. In the lead's row, change the lead stage to Contacted and the assigned staff to Unassigned. 2. As a provider (no right to edit people), try the same through the API. 3. Open the lead's Timeline, filter Lifecycle.
**Expect:** both changes save at once from the row; the lead source can be changed in the row too (David, 2026-10-29), with "Lead source: X → Y" on the Timeline; step 2 is refused (403); the Timeline shows "Lead stage: New → Contacted" with who made it. Tags are added and removed in the row in the same way.

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

### MKT-21 · Lead stages under Settings
`P0` `regression` · THE-17 · Status: Verified
1. From Marketing → Leads follow "Lead stages (Settings)". 2. Read the stages of a new business. 3. Add `E2E {RUN} Qualified`, add it again in lower case, rename it, move it up. 4. As a provider, try to add a stage (API). 5. Put a lead in the new stage and delete the stage. 6. Delete stages until one is left.
**Expect:** on screen, stage changes wait for Settings → Save changes like every other setting (UIX-12); step 1 opens Settings on the Leads tab; a business starts with New, Contacted, Interested, Trial booked, Lost; the duplicate name is refused; rename and order are saved; step 4 is refused (403); step 5 asks which stage its leads move to and moves them there; the last stage cannot be deleted.
**Cross-check:** each lead moved in step 5 has a Timeline line naming the deleted stage.

### MKT-22 · Delete lead and restore it
`P0` `regression` · THE-17 · Status: Verified
1. In a lead's row click "Delete lead"; confirm. 2. Tick "Show deleted leads". 3. Click "Restore"; untick.
**Expect:** a confirmation is asked first; the lead leaves the list and is listed under deleted leads; after Restore it is back with its stage and source unchanged. Delete lead archives the person (`PUT /v1/customers/:id/archive`); nothing is erased.
