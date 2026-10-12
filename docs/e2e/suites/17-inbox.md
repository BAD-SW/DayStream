# Suite 17 — Inbox

Persona: owner or manager unless stated (the Inbox needs `inbox:read` / `inbox:send`; reception has it through the Front Desk role, therapists and trainers do not). Channels are built in the order email, WhatsApp, SMS, in-app, so a script that needs a later channel stays `Blocked` longer. Covers spec 47. Conventions: [README](../README.md).

Written from the draft spec on 2026-10-12, before the feature exists. All scripts are `Blocked` until the spec 47 task named on each is done (KI-13); the spec itself is still a draft, so these scripts are revised when its requirements are confirmed.

**Sending rule:** every message in this suite goes through the **mock** channel adapter. Inbound messages and delivery updates are produced with the mock adapter's simulate endpoints, never with a real phone or mailbox. If a real SMS or WhatsApp provider is connected to the business, stop. Recipients are E2E people with `@daystream.test` addresses and fictitious numbers (`+34 600 000 0xx`).

---

### INB-01 · Inbox opens and lists conversations
`P0` `smoke` `regression` · Spec 47 R1 · Status: Blocked (spec 47 task 3)
**Pre:** two E2E people, each with one inbound message (simulated).
1. Open Inbox from the menu. 2. Use the Unread, Assigned to me, Unassigned, Leads only and Customers only filters. 3. Search by name, by phone and by a word from a message.
**Expect:** each row shows the person, stage badge, last message preview, channel, time and unread marker, newest first; filters and search return the right conversations; the menu entry shows the unread count; times are in the business's time zone.

### INB-02 · Reply on the channel the person used
`P0` `regression` · Spec 47 R2, R3 · Status: Blocked (spec 47 task 3)
**Pre:** an E2E person who wrote by SMS (simulated).
1. Open the conversation. 2. Reply without touching the channel choice. 3. Simulate "delivered", then "failed" on a second message; retry it.
**Expect:** the reply goes by SMS, shows the sender's name and moves queued → sent → delivered; the failed message shows its reason and can be retried; opening the conversation marks it read, and it can be marked unread again.
**Cross-check:** the same thread is on the person's profile under Messages.

### INB-03 · Start a conversation from People and from the profile
`P1` `regression` · Spec 47 R3 · Status: Blocked (spec 47 task 3)
1. From the People list, use "Message" on an E2E person with email only. 2. Look at the channel choices. 3. Send an email with a subject; try without one.
**Expect:** SMS and WhatsApp are shown as unavailable with the reason (no phone number); the email needs a subject; the message appears in the Inbox as a new conversation.

### INB-04 · Message from an unknown sender creates a lead
`P0` `regression` · Specs 47 R4, 46 R3, R4 · Status: Blocked (spec 47 task 1)
1. Simulate an inbound SMS from a number no person has. 2. Simulate a second one from the same number. 3. Simulate one from the number of an existing E2E person.
**Expect:** step 1 creates one person at stage "lead", source "Inbound message (SMS)", shown by phone number with an "Incomplete" marker, and one unread conversation; step 2 adds to the same conversation; step 3 lands on the existing person, creating nobody.
**Cross-check:** the new lead is in People → Leads and Marketing → Leads at status New (MKT-17); their last activity is now.

### INB-05 · Assign, close, reopen, snooze
`P1` `regression` · Spec 47 R5 · As: owner, manager · Status: Blocked (spec 47 task 3)
1. As owner, assign a conversation to the manager and close another. 2. Simulate an inbound message on the closed one. 3. Snooze a conversation for two minutes. 4. Open one conversation as owner and as manager at the same time.
**Expect:** the manager sees the assignment under "Assigned to me"; the closed conversation reopens unread; the snoozed one returns after two minutes; each user sees that the other is viewing; every change is recorded in the thread.

### INB-06 · Internal notes never leave the building
`P0` `regression` · Spec 47 R6 · As: owner, customer · Status: Blocked (spec 47 tasks 3, 9)
1. Add an internal note mentioning the manager in the conversation of the person behind `customer@transcend.test`. 2. Log in as that customer and open Messages.
**Expect:** the note looks different from messages and the manager is notified; the customer sees no trace of it.
**Cross-check:** the mock adapter received no send for the note.

### INB-07 · Person panel and quick actions
`P1` `regression` · Spec 47 R7 · Status: Blocked (spec 47 task 3)
**Pre:** an E2E person with an upcoming booking and a tag.
1. Open their conversation. 2. From the panel: add a tag, start a booking, open the profile. 3. Open the conversation of the incomplete lead from INB-04 and fill in the name.
**Expect:** the panel shows contact details, stage, tags, source, owner, next booking, last visit, membership and balance, matching the profile; the booking form opens with the person selected; the lead's name is saved without leaving the Inbox.

### INB-08 · Saved replies
`P2` `regression` · Spec 47 R3 · Status: Blocked (spec 47 task 3)
1. Create saved reply `E2E {RUN} Hello` using first name and business name. 2. Insert it in a conversation with a named person and with the nameless lead.
**Expect:** the text is filled in before sending, with a sensible fallback for the missing name; no raw `{{…}}` is sent.

### INB-09 · System messages appear in the thread without noise
`P1` `regression` · Spec 47 R8 · Status: Blocked (spec 47 task 5)
1. Create a booking for an E2E person so that a confirmation is sent. 2. Send them a campaign (MKT-03 rules). 3. Simulate their reply to the confirmation.
**Expect:** confirmation and campaign appear in the thread as collapsed one-line entries that expand to the full text; neither marks the conversation unread; the reply arrives as a normal unread inbound message.
**Cross-check:** the campaign's recipient row and the thread show the same delivery state.

### INB-10 · In-app messages with the customer portal
`P1` `regression` · Spec 47 R9 · As: customer, owner · Status: Blocked (spec 47 task 9)
1. As `customer@transcend.test`, send a message from the portal. 2. As owner, reply in-app. 3. As the customer, read it.
**Expect:** both sides see the exchange in order; the customer sees only their own conversation.

### INB-11 · Marketing by direct message respects consent
`P0` `regression` · Specs 47 R10, 46 R10 · Status: Blocked (spec 47 task 6)
**Pre:** three E2E people selected in People: one with SMS consent, one without, one archived.
1. Use "Message" on the selection and read the preview. 2. Send. 3. Try to select more people than the limit.
**Expect:** the preview says one will receive and two are excluded, with reasons; exactly one SMS reaches the mock adapter; above the limit the system refuses and points to campaigns.
**Cross-check:** a one-to-one reply to a person who wrote first is allowed even without marketing consent.

### INB-12 · Quiet hours and opt-out keyword
`P1` `regression` · Spec 47 R4, R10 · Status: Blocked (spec 47 tasks 6, 8)
1. Set quiet hours to cover the current time. 2. Send an SMS to a selection of two; then send one reply to a single person choosing "send anyway". 3. Simulate an inbound SMS "STOP" from an E2E person with SMS consent.
**Expect:** the group message is held and shown as held until the window opens; the single reply goes at once; after STOP the person's SMS marketing consent is withdrawn, with method "keyword reply" in the consent history, and a confirmation is sent.

### INB-13 · Who can see and send
`P0` `regression` `negative` · Spec 47 R12 · As: owner, manager, reception, therapist, trainer, biz-thin · Status: Blocked (spec 47 tasks 2, 4)
1. As reception, open the Inbox and send a reply. 2. As therapist and as trainer, look for Inbox in the menu, open `/inbox` directly, and call `GET /api/v1/inbox/conversations`. 3. As owner, create a new staff member choosing role "Front Desk" and another choosing "Staff"; log in as each. 4. As `business@daystream.test`, request a conversation id of the other business through the API.
**Expect:** reception (Front Desk role) and manager see the Inbox and can send; therapist and trainer (Staff role) have no menu entry, the page is refused and the API returns 403; the new Front Desk user has the Inbox, the new Staff user does not; the other business's conversation returns not found.
**Cross-check:** every sent message records the staff member who sent it; reception still cannot open Accounting, Settings or Marketing; SQL: users labelled `reception` are attached to the "Front Desk" role, therapists and trainers to "Staff".

### INB-14 · Channel settings and a broken connection
`P1` `regression` · Spec 47 R9 · As: owner · Status: Blocked (spec 47 task 6)
1. Settings → Messaging: view the channels and their state. 2. Run "test connection" on the mock SMS account. 3. Disconnect SMS and open a conversation with an SMS-only person.
**Expect:** each channel shows connected or not; the test reports success; after disconnecting, SMS is no longer offered when replying and the reason is shown.

### INB-15 · One conversation, seen whole or channel by channel
`P0` `regression` · Spec 47 R2 · Status: Blocked (spec 47 tasks 3, 5, 7)
**Pre:** an E2E person with an email exchange and a WhatsApp exchange (simulated), plus one internal note.
1. Open the conversation on "All". 2. Switch to Email, then to WhatsApp. 3. On the WhatsApp view, write a reply. 4. Simulate a new inbound email while the WhatsApp view is open. 5. Reload.
**Expect:** "All" shows every message in time order, each labelled with its channel, and the note; the Email view shows only emails and the WhatsApp view only WhatsApp messages, without the note; only channels the person has messages on are offered; the reply in step 3 can only go by WhatsApp; after step 4 the Email view shows an unread count of 1; the last view used is remembered after reload.
**Cross-check:** the profile's Messages tab offers the same views with the same contents; the message counts of the channel views add up to the "All" view (notes aside).

### INB-99 · Inbox cleanup
`P2` · Status: Blocked (spec 47 task 3)
1. Close all conversations of `E2E {RUN}` people. 2. Archive the saved reply and the E2E people created by this suite. 3. Reconnect the mock SMS account and restore quiet hours.
**Expect:** no open E2E conversations remain; settings are as before the run.
