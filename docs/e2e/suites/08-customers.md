# Suite 08 — Customers (CRM)

Persona: owner or manager unless stated. Covers spec 05. Customers are the hub that bookings, payments, memberships and marketing all attach to, so scripts cross-check into those. Conventions: [README](../README.md).

---

### CUS-01 · Create a customer
`P0` `regression` · Spec 05 R1 · As: reception · Status: Verified
1. `/customers/new`: create `E2E {RUN} Anna Test`, email `e2e-{RUN}-anna@daystream.test`, phone, date of birth. 2. Submit the form empty. 3. Enter a malformed email.
**Expect:** created and opened on the detail page with lifecycle stage `lead`; required fields and email format are enforced with inline messages.
**Cross-check:** the customer is selectable in the booking form and at checkout.

### CUS-02 · Edit a customer; every field change is logged
`P1` `regression` · Spec 05 R1, R6 · Status: Verified
1. Change phone and address; save.
**Expect:** the Timeline shows an entry per changed field with old → new value and the acting user.

### CUS-03 · Search, filter, sort, page
`P0` `regression` · Spec 05 R3 · Status: Verified
1. Search by part of the name, by email, by phone. 2. Filter by lifecycle stage and by tag; combine with search. 3. Sort by name and by created date; change page size; go to page 2.
**Expect:** results match every active criterion; the count is right; search is not case-sensitive and handles accented letters (García).

### CUS-04 · Notes and note categories
`P1` `regression` · Spec 05 R2 · Status: Verified
1. Create a note category; add a note in it; add a second note; delete the first.
**Expect:** notes show author and time, newest first; deletion asks for confirmation.
**Cross-check:** as the customer themselves, internal staff notes are not exposed in the portal unless marked as shared (record actual behaviour of `GET /api/v1/profile/customer/notes`).

### CUS-05 · Tags
`P1` `regression` · Spec 05 R5 · Status: Verified
1. Create tag `E2E {RUN} VIP`; add it to two customers; rename it; remove it from one; delete the tag.
**Expect:** the tag filter in the list follows each change; deleting the tag removes it from all customers.

### CUS-06 · Segments
`P1` `regression` · Spec 05 R4 · Status: Verified
1. At `/customers/segments` create a segment "stage = lead AND tag = E2E {RUN} VIP". 2. Change a member so they no longer match.
**Expect:** membership reflects the rules after each change; the member count equals the filtered list count for the same criteria.
**Cross-check:** the segment is offered as an audience when creating a marketing campaign (MKT-01).

### CUS-07 · Lifecycle: manual change
`P1` `regression` · Spec 05 R7 · Status: Verified
1. Move `E2E {RUN} Anna Test` lead → trial → active by hand.
**Expect:** each change is on the Timeline; the lifecycle summary counts move accordingly.

### CUS-08 · Lifecycle: automatic transitions
`P1` `regression` · Spec 05 R7 · Status: Verified
1. Read the lifecycle configuration (thresholds). 2. Give a `lead` customer a first completed, paid booking. 3. Run the lifecycle job from the scheduled-jobs panel (**run now**).
**Expect:** the customer moves to the stage the configuration prescribes (trial or active); the job history records the run and how many customers changed.

### CUS-09 · Customer 360 overview
`P0` `regression` · Spec 05 R12, Linear THE-16 · Status: Draft
**Pre:** `E2E {RUN} Walker` after JNY-03 and JNY-05.
1. Open the profile. Read the header and visit every tab, in the order Overview, Messages, Timeline, Billing, Notes, Tasks, Documents, Consent.
**Expect:** the header shows photo (or initials), name, reference, the lifecycle stage and "In this stage since"; the record status only when it is not active; and one line of facts: Source, Staff member, Home location, Last activity, Last visit, Last login, Known since (dates only; the time on hover). There is no button bar above Contact Information. Overview has Contact Information (with Home location and Address), Financial Summary, Membership, Visits & Credits, Communication, Payment Methods, Tags, Referrals and Reviews. Each tab opens with no failed request and no console error.
**Cross-check:** Visits & Credits and Financial Summary agree with the bookings list, memberships list and payments list for this customer (CUS-30).

### CUS-10 · Actions from the profile header
`P1` `regression` · Spec 05 R13, Linear THE-16 · Status: Draft
1. **Contact**. 2. **Add task**. 3. **More**: read the menu; **New order**; back, **Record payment**; **Assign staff member**; on a person without an account, look at **Request password reset**; **Archive**, then **Reactivate**.
**Expect:** Contact opens the Messages tab inside the profile; Add task opens the Tasks tab with the form open; More lists New order, Record payment, Assign staff member, Request password reset, Send personal data (GDPR), Archive (or Reactivate) and GDPR anonymise, each on one line, the last two in red; New order opens the checkout with this person already chosen; Request password reset is disabled without an account; each change shows on the Timeline.

### CUS-11 · Import customers from CSV
`P1` `regression` · Spec 05 R8, R14 · Status: Retired (2026-10-28): Bill `0921f79` removed the import from People; customer import is now Business Setup → Data Migration, covered by SET-17 and SET-18
1. At `/customers/import` upload a CSV of 5 rows: 3 valid, 1 with a bad email, 1 duplicating an existing email. Validate, then import.
**Expect:** validation lists the two problem rows with reasons before anything is written; the import creates exactly the valid rows and reports created / skipped counts.
**Cross-check:** imported customers appear in search with the right fields (including accented characters).

### CUS-12 · Export customers
`P2` `regression` · Spec 05 R8 · Status: Verified
1. Filter the list to the E2E tag and export.
**Expect:** the CSV holds exactly the filtered customers and opens correctly with accented characters.
**Cross-check:** reception (Staff, `customers:read`) can or cannot export: record and compare with the intended permission.

### CUS-13 · Duplicate detection and merge
`P1` `regression` `guarded` `known-issue` (D-15) · Spec 05 R9 · Status: Verified
**Pre:** two E2E customers, each with one booking.
1. Create a customer with the same email as an existing one. 2. Merge the two E2E customers.
**Expect:** the duplicate is flagged at creation; after the merge one profile remains holding both bookings, notes, tags and transactions; the merge is on the Timeline.

### CUS-14 · Archive, re-activate, and GDPR anonymise
`P0` `regression` `guarded` · Specs 05 R1, 02 R8 · Status: Verified
**Pre:** a disposable E2E customer with one paid booking. Never a seeded customer.
1. Archive; confirm they leave default lists and cannot be booked; re-activate.
2. Anonymise.
**Expect:** after anonymising, name, email, phone and notes are irreversibly replaced; the customer cannot log in; the action requires confirmation and is owner / manager only.
**Cross-check:** financial records survive: the payment still appears in `/payments` and reports with the same amount, linked to an anonymous customer; the audit log records who anonymised and when.

### CUS-15 · Communication preferences and consent
`P1` `regression` · Spec 05 R10 · As: owner, customer · Status: Verified
1. As owner, turn off marketing email for a customer. 2. As that customer, change preferences in the portal.
**Expect:** both sides see the latest values; a customer with marketing email off is excluded from campaign audiences (MKT-04) but still receives transactional messages such as booking confirmations.

### CUS-16 · Customer portal: own data, export, deletion request
`P1` `regression` · Specs 05 R11, 02 R8 · As: customer · Status: Verified
1. View and edit own profile. 2. Request a data export. 3. Look at (do not confirm) the account deletion request.
**Expect:** edits persist and appear on the staff side Timeline with the customer as actor; the export contains only this customer's data.

---

## People Foundation (spec 46)

Written from the spec on 2026-10-12, before the feature exists. All are `Blocked` until the spec 46 task named on each script is done (KI-13); then they become `Draft` and are calibrated on the first run. When spec 46 ships, the navigation label is "People" (the address stays `/customers`), and CUS-01, CUS-13 and CUS-15 above are revised: CUS-01 for the optional email and the Source field, CUS-13 is replaced by CUS-23, CUS-15 by CUS-21.

### CUS-17 · People list: system views and counts
`P0` `regression` · Spec 46 R1 · Status: Verified
**Pre:** E2E people at stages lead, trial, active, at_risk and churned (set by hand, CUS-07).
1. Open People. 2. Visit each view: All, Leads, Customers, At risk, Former. 3. Search and sort inside the Leads view. 4. Leave and come back.
**Expect:** the menu and page title say "People"; each view lists only its stages (Customers = trial, active, at risk, winback) and its count matches the rows; search and sort stay inside the view; the last view used is remembered; an old `/customers` link still opens.
**Cross-check:** `GET /api/v1/customers/view-counts` equals the counts on screen; the Leads view lists the same people as Marketing → Leads (MKT-09).

### CUS-18 · Person with only a phone number
`P0` `regression` · Spec 46 R2 · As: owner · Status: Verified
1. Create a person with first name `E2E {RUN} PhoneOnly` and a phone number, no email. 2. Try to save with neither email nor phone. 3. Start a booking for this person.
**Expect:** step 1 saves and the profile shows an "Incomplete" marker; step 2 is refused with a clear message; step 3 asks for the missing email and surname before the booking can be confirmed.
**Cross-check:** the person is found by searching the phone number typed with and without the country prefix.

### CUS-19 · One person, however they arrive
`P0` `regression` · Spec 46 R3 · Status: Verified
1. Create `e2e-{RUN}-same@daystream.test` by hand. 2. Create again with the same email in capitals. 3. Import a CSV row with the same email. 4. Register the same email through the booking widget.
**Expect:** one person throughout; step 2 offers the existing person instead of an error; details that were empty are filled in, existing ones are not overwritten; the Timeline shows each later arrival.
**Cross-check:** SQL: one `cus_customers` row for that email in the business; a second business of the same tenant can still create the same email as its own person.

### CUS-20 · Ambiguous phone match is flagged, not merged
`P1` `regression` · Spec 46 R3 · Status: Verified
**Pre:** two E2E people sharing one phone number, different emails.
1. Create a third person with only that phone number.
**Expect:** a new person is created; all three show a "possible duplicate" banner with review and dismiss actions; two people with the same name but different contact details are never matched.

### CUS-21 · Consent: one record, full history
`P0` `regression` · Specs 46 R9, 02 R8 · As: owner, customer · Status: Verified
1. As owner, give email marketing consent for an E2E person without saying how it was obtained. 2. Repeat with a reason. 3. As that customer, withdraw it in the portal. 4. Open the consent history.
**Expect:** step 1 is refused; step 2 saves; step 3 shows on the staff side at once; the history lists both changes with date, who, method, old and new value; a brand-new person has no marketing consent on any channel.
**Cross-check:** the campaign audience summary (CUS-22) and the profile agree; `cus_preferences` is no longer written.

### CUS-22 · A message that must not be sent is stopped, with the reason
`P0` `regression` · Spec 46 R10 · Status: Verified
**Pre:** an E2E segment of five people: one with email consent, one without, one with no email, one archived, one whose email is marked bounced.
1. Open the audience summary for an email marketing send to this segment. 2. Send the campaign (MKT-03 rules).
**Expect:** "5 in segment, 4 excluded, 1 will receive", each exclusion with its reason in plain words; exactly one recipient is sent to.
**Cross-check:** a booking confirmation still reaches the person without marketing consent; withdrawing consent after the audience was shown but before sending excludes that person.

### CUS-23 · Merge keeps everything
`P0` `regression` `guarded` · Spec 46 R12 · As: owner · Status: Verified
**Pre:** two E2E people. A: one paid booking, a note, a tag, email consent given. B: one booking, a membership, a campaign received, email consent withdrawn.
1. Start a merge of B into A and read the preview. 2. Confirm. 3. Open B's old link.
**Expect:** the preview lists what will move; afterwards A holds both bookings, the payment, the membership, the note, the tag and the campaign history; email consent is "withdrawn" (the stricter one); B's link opens A; as manager, the merge action is not offered.
**Cross-check:** `/payments` and reports show the same totals as before; SQL: B has `status = 'merged'` and no table still points at B; the audit log names both records and the user.

### CUS-24 · Source is recorded and never overwritten
`P1` `regression` · Spec 46 R4 · Status: Verified
1. Create one person by hand choosing "Walk-in", one by import, one through the widget, one through a lead form. 2. Have the walk-in person submit the lead form afterwards.
**Expect:** sources are walk-in, import, booking widget and lead form (with the form name); the walk-in person keeps "Walk-in" after step 2; people created before spec 46 show "Unknown".
**Cross-check:** filtering the list by each source returns exactly those people.

### CUS-25 · Staff member assignment (was "Owner")
`P1` `regression` · Spec 46 R5, Linear THE-16 · As: manager · Status: Verified
The field is labelled **Staff member** everywhere (profile facts, Contact Information, More → Assign staff member, the People list column, filter and bulk action); it is the same field as before.
1. Assign an E2E person to `E2E Therapist` from the profile. 2. Assign three more in bulk. 3. Filter by "Mine", "Unassigned" and the named owner.
**Expect:** each change is on the Timeline; filters return the right people; only staff of this business are offered as owners.

### CUS-26 · Last activity, last visit, last login
`P1` `regression` · Spec 46 R6 · Status: Verified
1. Note the three values for the person behind `customer@transcend.test`. 2. Log in as that customer. 3. As staff, check the person in for a booking.
**Expect:** last login and last activity move after step 2; last visit moves after step 3; a person without a login shows "No account"; all times are in the business's time zone.
**Cross-check:** sorting the list by last activity puts this person first.

### CUS-27 · Columns and bulk actions
`P1` `regression` · Spec 46 R8 · As: manager · Status: Draft
1. Hide and show columns; reload. 2. Select three E2E people and add a tag. 3. Use "select all matching" on the E2E tag filter, read the count, change stage, confirm.
**Expect:** the column choice survives a reload; the confirmation states the exact number affected; every affected person's Timeline shows the change.
**Cross-check:** reception (`customers:read`) is offered no bulk change.

### CUS-28 · Segments: edit, static list, starter set
`P1` `regression` · Spec 46 R11 · Status: Verified
1. Edit the rules of the CUS-06 segment. 2. Create a static list and add three people from the list page. 3. Open the starter segments. 4. Try to delete a segment used by a scheduled campaign.
**Expect:** the edit changes the membership at once; the static list holds exactly the three people and is labelled as a fixed list; Leads, New customers, Active, At risk, Former, New this month, No visit in 30 days and Birthday this month exist; step 4 is refused, naming the campaign.
**Cross-check:** every segment is offered both as a People view and as a campaign audience (MKT-19).

### CUS-29 · Address and home location
`P1` `regression` · Linear THE-16 · As: owner · Status: Verified
1. Contact Information: fill Street address, City, Postal code, Province / region; choose a Home location; save. 2. Through the API, set a location of another business.
**Expect:** saved and shown on reload; Home location shows in the header facts; only the business's own active locations are offered; another business's location is refused (`INVALID_LOCATION`).

### CUS-30 · Visits & Credits
`P1` `regression` · Linear THE-16 · Status: Verified
1. Open the Overview of a person with attended bookings, events and a pack.
**Expect:** Visits = Appointments + Events; Appointments counts bookings checked in or completed; Session credits are the sessions left in active packs.
**Cross-check:** `GET /customers/:id/figures` agrees with `apt_bookings`, `evt_registrations` and `pkg_redemptions`.

### CUS-31 · Timeline: everything in one place
`P0` `regression` · Linear THE-16 · As: owner, another organisation · Status: Verified
1. Open the Timeline and use each filter: All, Bookings, Membership, Packs, Payments, Lifecycle, Profile changes, Messages. 2. Change the person's language. 3. Click **Receipt** on a payment line.
**Expect:** newest first, no separate Upcoming / History; future bookings and the next membership renewal are highlighted and marked "Upcoming"; one line per payment, refund, credit and debit with a Receipt link (order receipt, or the payment's receipt PDF); the language change shows under Profile changes; Messages lists only messages sent to the person (emails and campaigns), those of the same kind on the same day (business time) on one line, e.g. "2 emails sent: Booking confirmation"; failed or cancelled ones are not listed; messages received stay in the Messages tab; an unknown filter is refused; another organisation is refused (403).
**Cross-check:** the Payments filter has exactly the completed rows of `pay_transactions` for the person; the Messages filter has one line per kind, channel and day of the sent rows of `apt_notification_queue` and `mkt_campaign_recipients`.

### CUS-32 · Tasks
`P1` `regression` · Linear THE-16 · As: owner, Staff, another organisation · Status: Verified
1. **Add task** with no staff; as a customer login's user; as Staff. 2. As owner: title, description, due date, two staff members, Send reminder on. 3. Mark it done; reopen; delete.
**Expect:** at least one staff member is required and only staff can be assigned; Staff (`customers:read`) cannot create tasks; the task lists both staff; the reminder email to the customer is queued at once (when the task is created) and the row says "Sent"; done tasks move to Done; another organisation cannot list them.

### CUS-33 · Transactional emails switch
`P0` `regression` · Linear THE-16 (David: off means no confirmations, cancellations or receipts at all) · Status: Verified
1. Consent → switch **Transactional Emails** off. 2. Create a task with a reminder. 3. Queue a payment receipt and a booking reminder for the person. 4. Read the consent history; switch it back on.
**Expect:** no evidence is asked when switching it off or on; the task reminder is not sent and shows why; the queued receipt is not sent (status `cancelled`, "Transactional emails switched off"); the booking reminder (its own switch) is sent; the history lists the change; the Overview's Communication card shows the state.
**Not covered by the switch (David, 2026-10-20):** invoices issued, failed-payment notices and waitlist offers are still sent.

### CUS-34 · Documents
`P0` `regression` · Linear THE-16 · As: owner, Staff, another organisation · Status: Verified
1. Upload a PDF; a file renamed to .pdf that is not a PDF; an .exe; as Staff. 2. Download it as owner and as Staff; as another organisation; through `/storage/<path>`. 3. Delete it and download again.
**Expect:** only real PDF, JPG and PNG files up to 10 MB are accepted; Staff can read but not upload; the download is the same file; another organisation and the public storage address are refused (403); a deleted document leaves the list and cannot be downloaded. Each upload and deletion is on the Timeline.

### CUS-35 · Profile photo
`P1` `regression` · Linear THE-16 · As: owner, another organisation · Status: Verified
1. Click the camera on the avatar and choose a PNG; try a PDF renamed to .png. 2. Open the photo as another organisation. 3. Remove it (API).
**Expect:** the photo replaces the initials; a non-image is refused; it is served only to signed-in users of the business; removing it brings back the initials.

### CUS-36 · Request password reset
`P1` `regression` · Linear THE-16 · As: owner, Staff · Status: Verified
1. More → Request password reset on a person without an account, then on one with an account. 2. As Staff.
**Expect:** without an account the action is disabled (API: `NO_ACCOUNT`, 409); with an account a reset link (15 minutes) goes to the account's email and the Timeline records it; Staff is refused.

### CUS-37 · Send personal data (GDPR)
`P0` `guarded` · Linear THE-16 (link valid 24 h; password shown to the sender to pass on) · As: owner, Staff · Status: Verified
1. More → Send personal data → Send. 2. Copy the password. 3. Open the emailed link (`/personal-data?token=…`) without signing in; download; open the PDF with the password. 4. Try a wrong link; let the link expire; open the file through `/storage/<path>`. 5. As Staff, try to send.
**Expect:** the email goes to the person's address; the dialog shows a one-time password with Copy and says it is not shown again; the file is a password-protected PDF with the person's details, address, bookings, payments, memberships, documents and tasks; a wrong or expired link is refused (410) with a clear message; the public storage address is refused; Staff is refused.
**Cross-check:** the audit log has `customer.personal_data_sent`; the Timeline has "Personal data sent"; the database keeps only a hash of the link and never the password.

### CUS-38 · Referrals and reviews
`P2` `regression` · Linear THE-16 · As: owner, another organisation · Status: Verified
1. Open the Overview of a person with a referral code, a referred person and a review.
**Expect:** the Referrals card shows the code, who referred them and the people they referred with their stage; the Reviews card shows the reviews they wrote with stars and service; another organisation is refused.

### CUS-39 · New Customer email
`P1` `regression` · Bill `63fda1d` · As: owner · Status: Verified
1. Add a person with an email. 2. Add the same person again. 3. Add a person without an email.
**Expect:** the first gets one "New Customer" email (template Business Setup → Templates → New Customer); adding the same person again is refused as a duplicate and sends nothing; no email without an address. Imported people never get it (SET-18).
