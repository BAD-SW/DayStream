# Phase 51: Competitive Gaps - Requirements

## Overview

DayStream was compared feature by feature with MangoMint (front-desk and clinical depth for salons, spas and med-spas) and Momence (class-centric booking, marketing and content for studios) in `docs/COMPETITIVE_COMPARISON_MANGOMINT_MOMENCE.md`. This phase specifies the capabilities DayStream lacks or has only in part. Each requirement records the gap's current state (checked against the code when this phase was opened) so work starts from what exists, not from the snapshot.

The acceptance criteria below set the capability each gap must reach. They are refined, and a design is written, when a gap is started; the owner decides when a gap is closed.

## Goals

- Close the gaps that cost DayStream deals against MangoMint and Momence
- Build each gap on what DayStream already has rather than alongside it
- Keep one record of every gap, its state and where it is being finished
- Keep DayStream's advantages (flat all-in pricing, franchise layer, CMS) intact while doing so

## Requirements

### Front desk and clinical

#### Requirement 1: Forms, Waivers and E-Signature

**User Story**: As a business owner, I want customers to complete intake forms, health questionnaires and waivers online and sign them before their first visit, so that I have their consent and history on file without paper.

**Current state**: Scaffolding only. Customers can have uploaded files (`cus_documents`, no type or signature), free-text notes, and the website has a contact form (`web_form_submissions`). No form builder, no form definitions, no signatures. Files go through one storage service whose S3 backend is not implemented, so all files are on local disk. Anonymisation clears name, email and notes but leaves uploaded documents and their files, the photo, personal-data export files and activity text.

**Agreed with the owner**: forms are each business's own (no franchise-level forms); what a form contains and when it is used depend on the business (information gathering, liability release and so on); a missing form never blocks a booking or check-in, collecting it is staff's responsibility; any staff member may see completed forms for now; businesses write their own language versions; the stored PDF is the record (answers are not kept as data); both local and S3 storage must work, chosen on Configuration > Storage; existing files are moved once into the new folder structure (a real deployment starts with new files only).

##### Acceptance Criteria

1. THE system SHALL let a business build forms on Business Setup > Templates, as a Form template type alongside the existing document templates, with headings and text plus the fields: short and long text, single and multiple choice, date, yes/no, an "I agree" checkbox and a signature line.
2. THE system SHALL let a business keep several forms, mark each active or inactive, duplicate them, and create language versions of a form, with the customer shown the version in their language where one exists.
3. THE system SHALL let a business say when a form applies (for example for certain services, before a first visit, or again after a period) and SHALL show staff, on the customer's profile, booking and check-in, which applicable forms are missing or out of date. THE system SHALL NOT block a booking or a check-in because a form is missing.
4. THE system SHALL let a form be completed on a tablet or other device in the business (staff open the form for the customer and hand the device over), from a secure link sent to the customer's phone or email before a visit, or by staff on the customer's behalf.
5. THE system SHALL, where a form has an "I agree" checkbox and signature line, require both before the form can be submitted, and SHALL record the date and time, device and network address, and the form version signed.
6. THE system SHALL store each completed form as a PDF of exactly what was completed and signed (questions, answers, signature, date, form version) in the platform's file storage, in a folder structure separated by tenant, business and customer, and SHALL keep in the database only a reference to it and its status, not the answers. (Keeping answers as structured data as well is a possible later addition, not part of this gap.)
7. THE system SHALL show completed forms on the customer's profile, read-only, and SHALL let staff print a completed form or email a copy to the customer on request.
8. THE system SHALL, when a customer is anonymised, delete their completed forms and stored form documents, together with their uploaded documents and files, photo, personal-data export files and the personal details in their activity history; and SHALL, when a customer is deleted, delete all their stored files. In both cases THE system SHALL remove the customer's folders as well as the files, and SHALL never leave an empty folder behind when a file is deleted.
9. THE system SHALL store files where the platform's Storage configuration (Configuration > Storage) says: on the local file system or in an AWS S3 bucket, both fully working, so features can be tested locally before deploying to AWS. Changing the setting SHALL take effect without restarting the server, and Test Connection SHALL prove the location can be written to, read from and deleted from.
10. THE system SHALL keep the S3 secret key encrypted and SHALL NOT send it back to the browser once saved.
11. THE system SHALL lay out every stored file in a folder structure separated by tenant and business (and customer, for customer files), and SHALL move existing files into that structure once, updating the references to them, so no file is lost.

#### Requirement 2: Treatment Charting

**User Story**: As a therapist or practitioner, I want structured treatment notes per session, so that I can record what was done and see the customer's history at the next visit.

**Current state**: Not started. Customer notes are encrypted free text with an optional category. They can be added and deleted but not edited, are not linked to a booking, delete permanently without an audit entry, and show "sensitive" notes only to the business owner and manager (a fixed list of role names, not a permission). Nothing in the system records a clinical session, a sign-off or an amendment. Reception, therapist and trainer share one "Staff" permission set, and there is no screen to change a role's permissions. The only read that is audited today is a sensitive note.

##### Acceptance Criteria

1. THE system SHALL let a business define chart templates (for example SOAP or a treatment record) built from the same field types as forms (headings, write-in answers, yes/no, choices, checkbox tables and dates).
2. THE system SHALL let staff complete a chart against a booking, or standalone from the customer profile, and SHALL show the customer's previous charts at the next visit.
3. THE system SHALL let a service name a default chart template, which is suggested when staff open a booking for that service.
4. THE system SHALL restrict charts to roles holding a clinical permission (business owner, manager, therapist and trainer by default, not reception), and SHALL refuse access to every other role.
5. THE system SHALL log every view, creation, sign-off and amendment of a chart, and SHALL refuse the action if the log entry cannot be written.
6. THE system SHALL store a chart's answers encrypted so they can be shown in the app, and SHALL produce a PDF when the chart is signed off.
7. THE system SHALL let the practitioner sign off a chart with one action that records their name and the time, and SHALL lock the chart from then on.
8. THE system SHALL let any user with chart access add a dated amendment to a signed-off chart, keeping the original visible and unchanged.
9. THE system SHALL keep charts out of the customer's own view.
10. THE system SHALL remove a customer's charts when the customer is anonymised or deleted, as it does for forms.
11. THE system SHALL leave existing customer notes unchanged by this requirement.

#### Requirement 3: Virtual Waiting Room

**User Story**: As a customer, I want to tell the business I have arrived from my phone and be told when to come in, so that I don't queue at the desk.

**Current state**: Partial. Kiosk, QR and phone-link check-in (with forms), reception check-in, walk-ins and no-show handling are built. Missing: a waiting list for staff (the Bookings page shows only a status badge), a "ready for you" message, an alert to the practitioner and front desk when someone arrives, and a way to mark a session as started (the "in progress" status exists but nothing sets it). The staff Check-in button on the Bookings page skips the check-in window rules and writes no check-in record, so it differs from the kiosk and the phone link. The Bookings page lists every appointment with no date range.

##### Acceptance Criteria

1. THE system SHALL let a customer check in for today's booking from a link on their phone.
2. THE system SHALL show staff who is waiting, since when, and for which booking.
3. THE system SHALL let staff send the waiting customer a "ready for you" message on the customer's channel.
4. THE system SHALL tell a customer who checks themselves in (on the kiosk, by QR code, or from their phone) which forms they still have to complete for the booking, and let them complete those forms there and then.
5. THE system SHALL NOT stop a customer from checking themselves in because a form is outstanding; staff still see the outstanding forms for that customer in the waiting list and at the desk.
6. THE system SHALL identify a customer at the front-desk kiosk by the phone number or email address on their booking, or by scanning their booking's QR code, and SHALL NOT identify anyone by name.
7. THE system SHALL refuse to guess when more than one person matches the phone number or email address, and SHALL send the customer to the front desk instead.
8. THE system SHALL show the customer a list of all the forms that apply to their visit, with a tick beside each completed form and a button beside each form still to complete.
9. THE system SHALL put a personal check-in link in each appointment reminder email, so a customer can check in and complete forms from their own phone without a login.
10. THE system SHALL let staff copy the same personal check-in link for any appointment.
11. WHEN nothing is scheduled for a customer today but they have other appointments in the next 60 days, THE system SHALL say so at the kiosk, list those appointments by service and date and time, and send the customer to the front desk, because an appointment may have been moved without the calendar being updated.
12. THE system SHALL let staff register, list, switch off, switch back on and delete kiosks from the business Settings, and show a registered kiosk's link again whenever they need it.
13. THE system SHALL keep a switched-off kiosk's key on its tablet, so the tablet works again as soon as it is switched back on.
14. THE system SHALL check a customer in from the staff Check-in button by the same rules and with the same check-in record as the kiosk and the phone link, and SHALL let staff check in before the earliest check-in time after a confirmation that records the override. THE system SHALL NOT refuse a customer for arriving late, and SHALL show how late they were; a reset SHALL cancel the check-in so the customer can be checked in again.
15. THE system SHALL show staff a Waiting list panel at the top of the Bookings page, limited in height and scrolling, listing each customer who has checked in and not yet started, with the service, the practitioner, how long they have waited, and any forms still to complete, walk-ins included.
16. THE system SHALL show the Bookings page's appointments in a second pane limited by a date range that starts as today.
17. WHEN a customer checks in, THE system SHALL alert the booked practitioner and the front desk in the app, and SHALL let the business choose which roles are alerted and whether they are also emailed.
18. WHEN staff mark a waiting customer ready, THE system SHALL change that customer's phone page and kiosk screen to "Please come in", email them, and update the phone page without the customer refreshing it.
19. THE system SHALL let staff start a session for a checked-in customer, SHALL record when it started, SHALL remove the customer from the Waiting list, and SHALL show on the customer's screen that the session has begun.
20. THE system SHALL put the customer's personal check-in link in the appointment confirmation email through a Check-in Link placeholder in the appointment template, and in each appointment reminder.
21. THE system SHALL queue appointment reminders automatically for confirmed appointments, at the lead times the business chose (24 and 2 hours by default), SHALL never queue the same reminder twice, and SHALL replace reminders for an appointment that was moved and drop those for one that was cancelled.
22. THE system SHALL fill the Add to Calendar placeholder with Google and Outlook links, and SHALL attach a calendar invite (.ics) to the email when the template uses that placeholder.
23. THE system SHALL let a business write an Appointment Reminder template, separate from its Appointment template, with a placeholder for how long is left before the appointment, and SHALL send the reminder through that template; until the business has one, THE system SHALL send a plain reminder that still carries the check-in link.
24. THE system SHALL show every word on the customer check-in screens (the phone page, the kiosk and the list of forms) in the customer's language, from wording held for each supported language and not written into the screens, and SHALL let a business replace any of that wording, per language, without affecting the rest.
25. THE system SHALL email a waiting customer the same "ready for you" wording the check-in screens show, in the customer's language, so the business keeps one set of wording for the screens and the email.
26. THE system SHALL let a business choose which screen Bookings opens on for staff (the calendar, or the list with the Waiting list), SHALL let each staff member's profile choose differently or follow the business setting, and SHALL keep the other screen one click away.

### Messaging and booking

#### Requirement 4: Two-Way SMS and WhatsApp

**User Story**: As front-desk staff, I want to text and WhatsApp customers and read their replies in the Inbox, so that I reach them where they answer.

**Current state**: Partial. The Inbox (Phase 47, designed by David) is built for email and in-app messages, with assignment, notes and notifications. SMS and WhatsApp are rejected as "not connected yet"; no messaging provider is integrated (mock adapters only). Phase 47's documents lag the code. Before this gap's design, what the Inbox does today is written up for the owner, and the design is agreed with David as the Inbox's designer.

##### Acceptance Criteria

1. THE system SHALL send and receive SMS and WhatsApp messages through a connected provider and show both directions in the customer's Inbox conversation.
2. THE system SHALL match an inbound message to the customer by phone number, and SHALL hold unmatched messages for staff to assign.
3. THE system SHALL respect each customer's channel consent and the provider's opt-out keywords.
4. THE system SHALL use the same connection for booking reminders and campaigns, not only the Inbox.

#### Requirement 5: Book-and-Pay Links

**User Story**: As front-desk staff, I want to send a customer a link that books a specific service and takes payment in one step, so that a conversation turns into a paid booking without a call.

**Current state**: Not started. The booking widget (Phase 38) and online payment exist; there is no per-customer, prefilled link.

##### Acceptance Criteria

1. THE system SHALL let staff create a link for a customer with the service, and optionally the time, staff member and price, already chosen.
2. THE system SHALL send the link by SMS, WhatsApp or email from the Inbox or the customer's profile.
3. THE system SHALL let the customer confirm and pay in as few steps as the payment requires, and SHALL show staff when the link was opened, completed or expired.

### Classes and retail

#### Requirement 6: Class Scheduling Depth

**User Story**: As a studio owner, I want classes to work the way a class-based studio expects, so that I can run a timetable as easily as in a class-centric product.

**Current state**: Partial. Recurring events, capacity, waitlists, event check-in, packages, memberships with credits and punchcards exist. Not confirmed: a class timetable view, a roster, automatic waitlist promotion, late-cancel and no-show rules for class spots, and class-pass credit use.

##### Acceptance Criteria

1. THE system SHALL show a weekly class timetable for staff and customers.
2. THE system SHALL give the instructor a roster for each class with check-in.
3. THE system SHALL promote the next waitlisted customer automatically when a spot opens, and tell them.
4. THE system SHALL apply the business's late-cancel and no-show rules to class spots, including credit return or charge.
5. THE system SHALL use class passes and membership credits when a customer books a class.

#### Requirement 7: Retail Inventory

**User Story**: As a business owner who sells products, I want stock levels tracked as I sell and receive goods, so that I know what to reorder.

**Current state**: Not started. Phase 28 left inventory out as a short-term scope decision ("no stock levels, reorder points or quantity management"); it was always expected long term. Products and variants are sold at the point of sale.

##### Acceptance Criteria

1. THE system SHALL track stock per product variant and location, reduced by sales and restored by refunds.
2. THE system SHALL let staff receive stock, adjust it with a reason, and count it.
3. THE system SHALL warn when a variant falls below its reorder level.
4. THE system SHALL report stock on hand and its value.

### Staff tools and content

#### Requirement 8: Staff Mobile App

**User Story**: As a staff member, I want my schedule, my customers and check-in on my phone, so that I don't need a desk computer.

**Current state**: Not started. The customer mobile app is built (Phase 19); staff tools are web only.

##### Acceptance Criteria

1. THE system SHALL give staff a mobile app showing their schedule and bookings.
2. THE system SHALL let staff look up a customer, see their notes and forms, and check them in by scanning their QR code.
3. THE system SHALL let staff clock in and out, and receive Inbox and booking notifications.
4. THE system SHALL show each staff member only what their role allows.

#### Requirement 9: Video Hosting and Livestream

**User Story**: As a studio owner, I want to upload videos and stream live classes inside DayStream, so that online members don't need a second platform.

**Current state**: Partial. On-demand video and courses are built (Phase 22), but a video is only a link to somewhere else. No upload, no hosting, no livestream. Course authoring screens and paid access are unconfirmed.

##### Acceptance Criteria

1. THE system SHALL let a business upload videos and play them to members with access, without a third-party account.
2. THE system SHALL let a business schedule a livestream class, sell or include access, and record it for on-demand afterwards.
3. THE system SHALL restrict videos and streams to the customers whose membership or purchase includes them.

### Payroll, language, AI and phone

#### Requirement 10: Payroll Payout

**User Story**: As a business owner, I want to pay staff from DayStream after a pay run, so that payroll doesn't need a second system.

**Current state**: Partial. Time tracking, pay periods, commission, deductions and tax tables are built (Phase 12). Payout to staff bank accounts and tax filing were not found and need confirming.

##### Acceptance Criteria

1. THE system SHALL pay a finalised pay run to staff bank accounts, directly or through a payroll provider.
2. THE system SHALL produce the payslips and tax filings the business's country requires, or hand them to a provider that does.

#### Requirement 11: Multi-Language

**User Story**: As a business in a non-English market, I want DayStream and everything it sends in my customers' languages, so that I can sell to them.

**Current state**: Scaffolding only. Multiple languages were expected from the start: the top bar already has a language selector, the i18n library is installed and a few Spanish strings exist, but almost nothing is translated yet. Finished in **Phase 44**; tracked here.

##### Acceptance Criteria

1. THE system SHALL meet the requirements of Phase 44, and this gap SHALL close when Phase 44 does.

#### Requirement 12: AI Assistant and Receptionist

**User Story**: As a business owner, I want an assistant that answers customers and books for them when staff are busy, so that no enquiry goes unanswered.

**Current state**: Not started; Phase 21 has requirements only. DayStream's overview says not to claim AI. Finished in **Phase 21**; tracked here.

##### Acceptance Criteria

1. THE system SHALL meet the requirements of Phase 21, and this gap SHALL close when Phase 21 does.

#### Requirement 13: Integrated Phone

**User Story**: As front-desk staff, I want calls to and from the business inside DayStream, with the caller recognised, so that I can help them with their record open.

**Current state**: Not started; no spec.

##### Acceptance Criteria

1. THE system SHALL place and receive calls through a connected provider and recognise the caller as a customer by number.
2. THE system SHALL log each call on the customer's timeline, with missed calls shown to staff.
3. THE system SHALL let a missed call be answered by text.

### Payments

#### Requirement 14: Tips

**User Story**: As a business owner whose staff are tipped, I want customers to be able to add a tip when they pay, so that the tip reaches the staff member and is kept separate from the sale.

**Current state**: Not started. Nothing in the system knows about tips. An order's total is the sum of its item lines, with no order-level amount, and that total is what the card is charged, what the receipt prints, what the ledger books as cash received and what the payments report sums. Commission is worked out from the item lines only, so it would be unaffected by a tip. Payroll has no pay component for tips and no liability account for tips owed. Refunds work line by line and say nothing about a tip. Staff checkout (card, cash, transfer, check, gift card) is the only path that takes payment through orders; the booking widget's payment step is a simulation, and there is no card-terminal or kiosk payment.

##### Acceptance Criteria

1. THE system SHALL let a tip be added to an order at checkout, as a percentage of the sale or a typed amount, and SHALL let the business choose the suggested percentages.
2. THE system SHALL charge the sale and the tip together in one payment, and SHALL show the tip as its own line on the receipt.
3. THE system SHALL record a tip as money owed to staff, separate from revenue, tax and commission, and SHALL keep it out of sales and profit reports.
4. THE system SHALL attribute each tip to the staff member who served the customer, and SHALL let staff change that attribution or split it between staff.
5. THE system SHALL show each business the tips collected and owed to each staff member for a period, and SHALL let the business record paying them out or add them to a pay run.
6. THE system SHALL let a business switch tipping off, and SHALL let it decide whether a tip may be added on cash and other manual payments.
7. THE system SHALL state what happens to a tip when an order is refunded.
#### Requirement 15: Service and Product Add-Ons

**User Story**: As a business owner, I want customers and staff to be able to add extras to a booking, such as a longer session, an upgrade or a product, so that I earn more per visit and the extra time is reserved.

**Current state**: Not started. A booking is one service and variant, and an order is a list of item lines, so an extra can only be sold today as a separate line at checkout, after the visit. Nothing links an extra to the service it goes with, adds its time to the booking, or offers it while booking. The only trace of the idea is an unused "free add-on" membership benefit type.

##### Acceptance Criteria

1. THE system SHALL let a business define add-ons, each with a name, a price, an optional extra duration and an optional product it uses, and attach them to the services they can be added to.
2. THE system SHALL offer a service's add-ons when it is booked, by staff and online, and SHALL let one or several be chosen.
3. THE system SHALL add an add-on's duration to the booking, checking staff and resource availability for the longer time.
4. THE system SHALL put each add-on on the order as its own line, with the price, tax and staff credit rules of any other line.
5. THE system SHALL let staff add or remove an add-on on an existing booking, and SHALL show the add-ons on the calendar, the booking and the receipt.
6. THE system SHALL let a membership benefit make named add-ons free.

### Customers

#### Requirement 16: Customer Self-Service

**User Story**: As a customer, I want to book, change and cancel my appointments and look after my own account without phoning or emailing the business, so that I can do it at any hour and the business's staff are not tied up with routine requests.

**Current state**: Partial and scattered. A customer can book through the embeddable booking widget (its payment step is a simulation, in euros only), cancel an appointment from "My Bookings" when the business allows it (with refunds as the business set), register for and pay for events, send messages, and open personal links for forms and check-in without signing in. The server has customer-profile routes (change email, phone, language and country; communication preferences; data export; a deletion request that only records the request), but no page uses them. Not built: an account page, changing a password, changing one's name or address, rescheduling, a page reached from an email link to view or change one appointment (the Manage Link placeholder in the appointment emails resolves to nothing for this reason), a list of past orders, receipts and invoices, a view of memberships, packages, gift card balances and account credit, managing a card on file, a list of forms, and a way to sign in or register outside the booking widget. Sign-in always asks for the business's tenant, and the web app's sign-in page has one tenant written into it, so a customer of any other business cannot sign in there. A customer's login is matched to their customer record by email address alone, so changing the email in the profile can break the link, and a person who is a customer of two businesses is matched to whichever the database returns first. The sidebar links for customers (Book, My Bookings, Account) point to pages that do not exist.

##### Acceptance Criteria

1. THE system SHALL let a customer register, sign in, reset a forgotten password and change their password for the business they belong to, without the customer choosing a tenant.
2. THE system SHALL give a customer an account page where they can see and change their name, email address, phone number, address and language, and their communication preferences, and keep their login and their customer record in step when the email changes.
3. THE system SHALL let a customer request a copy of their data and ask for their account to be deleted, and SHALL show staff the request to act on.
4. THE system SHALL let a customer book an appointment for themselves, see the price, pay when the business requires it by a real payment, and book the same service again from a past visit.
5. THE system SHALL let a customer see their upcoming and past appointments, cancel one within the business's cancellation rules, and move one to another time within the business's rescheduling rules.
6. THE system SHALL put a Manage link in the appointment emails that opens a page for that one appointment without signing in, showing the details and offering the actions the business allows, and SHALL make the link personal, impossible to guess, and unusable once the appointment is over.
7. THE system SHALL let a customer see their orders, receipts and invoices, their memberships, packages, gift card balances and account credit, and manage the cards they have saved.
8. THE system SHALL let a customer see which forms they have completed and which they still have to complete, and complete them.
9. THE system SHALL let the business choose which of these actions customers may do, and how far ahead of an appointment each is allowed.
10. THE system SHALL show a customer only their own information for the business they are using, and SHALL keep a customer's activity out of any other customer's view.
#### Requirement 17: Starter Templates

**User Story**: As a business owner setting up DayStream, I want ready-made, well-worded templates for every email and document the system sends, so that customers get a proper message from the first day and I only change what I want to.

**Current state**: Not started. No template is created for a new business. A business that has not built a template for an appointment, receipt, invoice or other document gets a bare email with a greeting, the logo bar and a footer, and no details. The one exception is the appointment reminder, which falls back to a plain reminder with the check-in link while the business has no Appointment Reminder template. Each business has to write every template from a blank editor, in the Templates tab of Business Setup.

##### Acceptance Criteria

1. THE system SHALL give every new business a starter template for each template type it can send, written in plain, friendly wording with the placeholders already in place.
2. THE system SHALL let a business give an existing business the starter templates for the types it has no template for, without touching templates it has already written.
3. THE system SHALL keep each starter template editable and deletable like any other template, and SHALL mark it as a starter until the business changes it.
4. THE system SHALL provide the starter wording in each language the system supports, using the business's language.
5. THE system SHALL show a preview of the starter template with sample values before the business activates it.
---

## Dependencies

- Phase 47 (Inbox): the conversation model that SMS, WhatsApp, book-and-pay links and phone build on
- Phase 15 (Check-in): the check-in records the virtual waiting room extends
- Phase 14 (Events) and Phase 08 (Memberships): the building blocks for class depth
- Phase 28 (Products and Services): products and variants for inventory
- Phase 19 (Mobile App): the app foundation for the staff app
- Phase 22 (Community): on-demand video and courses
- Phase 12 (Staff Management): pay runs for payout (also tip payout)
- Checkout and payments (orders, payment transactions, the ledger): where tips are added and recorded
- Booking widget, customer portal routes, events and the cancellation settings: the customer self-service that already exists and gets joined up
- Phase 21 (AI Features) and Phase 44 (Language Support): where those gaps are finished

## Success Criteria

- Each gap is closed when the owner is satisfied, and its requirement is marked complete
- The competitive comparison can be updated to show each closed gap as built
- No gap is specified twice: gaps with their own spec are finished there

## Out of Scope

- Data migration (Phase 50): set aside for now, resumed separately
- Re-pricing DayStream: pricing stays as in the comparison unless the owner decides otherwise
- Copying competitors' interfaces: gaps are closed by capability, in DayStream's own design system

## Notes

- Gaps are worked one at a time, top to bottom in the order of tasks.md, so progress is easy to follow. How each gap is implemented is decided in its design.
- A messaging provider (Requirement 4) is needed by the virtual waiting room's "ready for you" message (Requirement 3). Until it exists, Requirement 3 can send that message by email and in-app, and add SMS when Requirement 4 is done.
- Every gap begins by confirming its current state in the code, because the comparison is a snapshot.

---

**Status**: 🟡 In Progress
**Dependencies**: Phase 47, Phase 21, Phase 44, Phase 15, Phase 28
**Next Phase**: To be decided
