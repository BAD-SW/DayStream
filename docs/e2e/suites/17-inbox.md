# Suite 17 — Inbox

Persona: owner unless stated. The Inbox is for owners, managers and front desk (`reception`); therapists, trainers and other staff do not have it. Covers THE-18 (built 4 Nov 2026, David's choices: option A with a collapsible person pane, notifications by role and channel, the segment builder, one column order per business) and the parts of spec 47 that it delivered. Conventions: [README](../README.md).

**Channels today:** email (replies go out with the business's email settings) and in-app (the customer writes from the portal, Messages). SMS and WhatsApp are shown as "not connected" until their providers exist (THE-19); scripts that need them stay `Blocked`. Inbound email (a reply to an email landing in the Inbox) needs the email server (spec 41) and is `Blocked` too.

**Demo data:** Transcend Mallorca has five demo conversations (`demo-seed-5`): Javier Serrano and Lucía García (unread, unassigned, in-app), Diego Morales (unread, assigned to the manager, with an automatic email before it), Carmen López (email, assigned to front desk, with an internal note) and Elena Molina (done).

---

### INB-01 · Inbox opens and lists conversations
`P0` `smoke` `regression` · THE-18 · Status: Verified
1. Open Inbox from the menu (Daily work, first after Dashboard). 2. Switch Open / Mine / Unassigned / Done; tick Unread; choose a segment; choose a channel. 3. Search by a name, then by a word from a message ("float").
**Expect:** the menu entry shows the number of unread conversations (it follows at once when one is read); each row shows the person, a channel tag, the last message, the time, an unread dot and who it is assigned to; unread first, then newest first; the view counts are right (Open 4, Unassigned 2 with the demo data); filters and search return the right conversations; SMS and WhatsApp are listed as not connected. New messages appear without a reload (within 20 s).

### INB-02 · Option A: three panes; the person pane collapses
`P0` `regression` · THE-18 (David, 2026-11-04) · Status: Verified
1. Open Diego Morales. 2. Read the right pane. 3. Press the pane button at the right of the conversation header; then again. 4. Reload. 5. Narrow the window to a phone width.
**Expect:** list on the left, the conversation in the middle, the person on the right (email, phone, source, staff member, next booking, last visit, membership, tags, Open profile, New booking). Collapsing the person pane gives its width to the conversation only: the list keeps its width (checked: list 320 px before and after, conversation +280 px). The choice is remembered after reload. On a phone the list and the conversation take the full width one at a time, with a back arrow.

### INB-03 · Reply, internal note, mention
`P0` `regression` · THE-18, spec 47 R3, R6 · As: owner, then manager · Status: Verified
1. In Diego's conversation reply in-app. 2. Switch to Internal note, mention Carlos López (manager), add the note. 3. Try Reply · Email with an empty subject. 4. As the manager open the bell.
**Expect:** the reply shows the sender, channel and time and clears unread; the note is shaded, says "only staff see notes" and is never sent; the email needs a subject (Send stays disabled); the manager's bell shows "You were mentioned about Diego Morales" and opens the conversation. Opening a conversation marks it read; "Mark unread" sets it back. An unsent reply is kept per conversation after reload.

### INB-04 · Assign, done, reopen
`P1` `regression` · THE-18, spec 47 R5 · As: owner, reception · Status: Verified (API test)
1. Assign Javier's conversation to Ana Martínez (front desk). 2. Mark it done. 3. As the customer, write again (INB-06).
**Expect:** the assignee is told (bell); assignment and done are recorded in the thread ("Assigned to …", "Marked done"); only owners, managers and front desk can be chosen; the done conversation is under Done and reopens unread when the person writes, and the new message goes to the assignee only.

### INB-05 · Automatic messages in the thread
`P1` `regression` · Spec 47 R8 · Status: Verified (demo data; API path by test)
1. Look at Diego's thread. 2. Create a booking for an E2E person with an email, so that a confirmation goes out; open their conversation.
**Expect:** what the system emailed is a one-line "Sent automatically · Email · …" entry that expands to the text; it never marks the conversation unread or reopens it.

### INB-06 · In-app messages with the customer portal
`P1` `regression` · THE-18, spec 47 R9 · As: customer, owner · Status: Draft
1. As `customer@transcend.test`, open Messages in the menu and send a message. 2. As owner, find it unread in the Inbox and reply in-app; add an internal note. 3. As the customer, reload Messages.
**Expect:** the customer's message arrives unread (owner and front desk are told); the customer sees the reply but never the note or assignment events.

### INB-07 · Who can see the Inbox
`P0` `regression` `negative` · Spec 47 R12 · As: owner, manager, reception, therapist · Status: Verified (API test)
1. As reception, open the Inbox and reply. 2. As therapist, look for Inbox in the menu, open `/inbox`, and call `GET /api/v1/inbox/conversations?business_id=…`. 3. As therapist, open a profile's Messages tab.
**Expect:** owner, manager and reception have it; the therapist has no menu entry, the page says the Inbox is for owners, managers and front desk, the API returns 403; a conversation of another business is not found.

### INB-08 · Notifications by role and channel
`P1` `regression` · THE-18 b (David approved the defaults) · As: owner, reception · Status: Verified (API test)
1. Settings → Inbox: read the table. 2. Untick "New conversation, nobody assigned" for Front desk; Save changes. 3. As the customer, write a new message. 4. As reception, check the bell. 5. Under My notifications, untick something; Save changes.
**Expect:** defaults as approved (new unassigned: owner, manager, front desk, in-app and email; unanswered after 4 hours: owner and manager by email; daily summary at 08:00: owner and manager by email; …); only owners and managers can change the table (others see it read-only); after step 2 reception is not told; My notifications lists only what the role receives; assignments and mentions cannot be switched off in-app.
**Cross-check:** every 15 minutes the `inbox_reminders` job reports conversations unanswered longer than the set hours, once each, and sends one daily summary after 08:00 business time.

### INB-09 · The person's profile shows the conversation
`P1` `regression` · Spec 47 R2.11 · Status: Verified
1. Open Diego Morales's profile → Messages (or Contact). 2. Press Open in the Inbox.
**Expect:** the same messages as in the Inbox, notes marked; the button opens the conversation in the Inbox.

### INB-10 · Message from an unknown sender creates a lead
`P0` `regression` · Specs 47 R4, 46 R3 · Status: Blocked (needs inbound email / SMS / WhatsApp)

### INB-11 · SMS and WhatsApp replies, delivery states, retry
`P1` `regression` · Spec 47 R2, R9 · Status: Blocked (THE-19: providers)

### INB-12 · Saved replies, snooze, who is viewing, one view per channel
`P2` `regression` · Spec 47 R2, R3, R5 · Status: Blocked (not part of THE-18)

### INB-13 · Direct messages to a selection, consent, quiet hours, STOP
`P1` `regression` · Spec 47 R4, R10 · Status: Blocked (needs SMS / WhatsApp)

### INB-99 · Inbox cleanup
`P2` · Status: Verified
1. Mark done the conversations of `E2E {RUN}` people. 2. Put Settings → Inbox back as it was.
**Expect:** no open E2E conversations remain; settings are as before the run. The demo conversations are removed by `demo-cleanup`.
