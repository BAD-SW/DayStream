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

**Owner's direction (15 Nov 2026, to agree with David)**: reminders go by email (perhaps SMS later). The email carries links for the customer to reply by email, by WhatsApp (a click-to-chat link to the business's number with a reference filled in) or by SMS (a text link, for phones), and the reply lands in the Inbox. Because the customer starts the conversation, WhatsApp needs no approved templates for these replies (free-form within 24 hours of the customer's last message); business-initiated WhatsApp would. Needs: a provider account and number per channel (monthly and per-message costs, and registration in some countries such as US 10DLC), inbound email into the Inbox (not built), and a decision on whether DayStream holds one account or each business connects its own.

#### Requirement 5: Book-and-Pay Links

**User Story**: As front-desk staff, I want to send a customer a link that books a specific service and takes payment in one step, so that a conversation turns into a paid booking without a call.

**Current state**: Not started. Confirmed in the code:
- The booking widget (Phase 38) can only be opened on a service, needs the customer to sign in, and its payment is simulated (no money is taken, and no order is created).
- Stripe is connected per business and can take a one-time card payment, but only from staff screens (Checkout and the New Appointment payment step).
- The New Appointment payment step offers card, cash, transfer, gift card, other and Pay later; there is no option to send the customer a link.
- Personal links exist for forms (a secure, single-use link with an expiry, sent by email) and check-in, which a book-and-pay link can follow. Neither records when a link was opened.
- There are no deposits, no per-booking price change, and nothing cancels an unpaid booking that was never paid.
- SMS and WhatsApp are not connected (gap 4); only email can be sent today.

##### Acceptance Criteria

1. THE system SHALL let staff create a link for a customer with the service, and optionally the time, staff member and price, already chosen.
2. THE system SHALL send the link by SMS, WhatsApp or email from the Inbox or the customer's profile.
3. THE system SHALL let the customer confirm and pay in as few steps as the payment requires, and SHALL show staff when the link was opened, completed or expired.
4. THE system SHALL let a business set a Reservation Payment Rule on each service: Not required for reservation, Taken but not charged for reservation, or Charged at reservation (payment being a card or a bank account by direct debit). Existing and new services start as Not required.
5. WHEN a service needs no card, THE system SHALL save the reservation without a payment step.
6. WHEN a service requires a card, THE system SHALL require staff to attach one of the customer's saved cards, or add a new one, before the reservation is saved, SHALL record that the customer agreed to the card being kept and charged after the service and for a no-show or late-cancellation fee, and SHALL charge nothing at that time.
7. WHEN a service requires a card, THE system SHALL NOT ask a walk-in for one, because the customer is already at the business.
8. THE system SHALL offer the reservation's card first at Checkout, for the final total including anything added, SHALL let staff choose another card or method there, and SHALL charge a no-show fee to the reservation's card before any other saved card.
9. WHEN a customer is not present to give a card, THE system SHALL let staff send the customer a link to give it (the book-and-pay link of this requirement).
10. WHEN staff mark an appointment as a no-show and its option has a no-show fee, THE system SHALL show the fee and the card it would be charged to, or say that there is no card on file, and SHALL let staff choose to charge the fee or not charge it (the fee is at the owner's discretion; the amount is the option's).
11. WHEN a no-show fee is not charged, THE system SHALL tell staff why (waived, no card on file, or the card declined), SHALL keep an unpaid fee as an open order to collect at Checkout, and SHALL record a waived fee in the appointment history and on the no-show record.
12. THE system SHALL NOT offer No-show on a walk-in appointment (one with no customer), SHALL refuse to mark one as a no-show, and SHALL leave walk-ins out of any automatic no-show, because the customer is already at the business.
13. WHEN an appointment reserved with a membership or package is marked as a no-show and its option has a no-show fee, THE system SHALL charge the no-show to that membership or package (using the allowance held for the appointment) and SHALL NOT charge a card; WHEN staff choose not to charge it, THE system SHALL give the allowance back (owner, 23 Nov 2026).

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

**Owner's direction (15 Nov 2026)**: a class is scheduled by the business (date, time, place, instructor, capacity) and customers sign up to it; the first ones to sign up, up to the capacity, get a place. Customers do not choose a date and time themselves, as they do for a Group service in the appointment calendar today (it offers any free start time).

#### Requirement 7: Retail Inventory

**User Story**: As a business owner who sells products, I want stock levels tracked as I sell and receive goods, so that I know what to reorder.

**Current state**: ✅ Complete, closed with the owner (19 Nov 2026); the description below is what was there before. Phase 28 left inventory out as a short-term scope decision ("no stock levels, reorder points or quantity management"); it was always expected long term. Confirmed in the code (15 Nov 2026):
- Products (`prd_merchandise`) have a name, SKU, price, category, tax and status; variants (`prd_merchandise_variants`) are a flat name, SKU and price. There is no quantity, cost price, barcode, supplier, reorder level or location on either, and products have no `tenant_id` column.
- Selling a product at Checkout and refunding it change no stock. Product refunds work line by line.
- Accounts payable has vendors, bills with free-text lines, and expenses, with no link to products, purchase orders or receiving.
- No report covers stock; "Sales by item" notes there is no inventory module. Product sales post to revenue (4300); the chart of accounts has Cost of Goods Sold (5000) but nothing posts to it, and there is no inventory asset account.
- The data migration (Phase 50) does not import products or stock.

##### Acceptance Criteria

**Agreed with the owner (15 Nov 2026)**: all the missing pieces above are in scope, plus the quantity on hand shown while an order is being put together. All sales are made in person at the business: there is no online shop, no stock reserved for online orders, and no shipping.

1. THE system SHALL let a business choose, per product, whether its stock is tracked, and SHALL track stock for each tracked product (or each of its variants) at each location.
2. THE system SHALL keep, per product or variant, a cost price, a barcode, a supplier, and, per location, a reorder level and a reorder quantity.
3. WHEN an order is completed at Checkout, THE system SHALL reduce stock at the order's location by the quantity sold; WHEN a product line is refunded, THE system SHALL let staff choose whether the item goes back into stock or is written off, and SHALL record it either way.
4. WHILE products are being added to an order, THE system SHALL show the quantity on hand at the order's location for each product and variant, and SHALL NOT let more of a tracked product onto the order than is on hand: a larger quantity is limited to what is on hand (for example, 5 candles wanted, 3 in stock: 3 go on the order, and staff are told), and a product with none on hand cannot be added. The rest of the order is not affected (owner, 15 Nov 2026).
5. THE system SHALL let staff raise a purchase order to a vendor (Accounting > Purchase Orders), with each line's quantity starting at the reorder quantity of the product or variant at the delivery location, email it to the vendor using the business's Purchase Order template or mark it as sent, receive it in full or in part, and record what was received at which location and at what cost; what was received SHALL be able to become the vendor bill in Accounts Payable, approved and ready to pay (owner, 19 Nov 2026).
6. THE system SHALL let staff, on a product's Stock card, adjust its stock with a reason (damaged, lost, used in a service, found, correction), count it (each variant at a location; a counted number that differs from on hand becomes the new on hand), and move it between locations. There is no separate count of all products at once (owner, 18 Nov 2026).
7. THE system SHALL record every stock change (what, where, how many, why, the order, purchase order or transfer it came from, who and when), SHALL NOT let anyone edit or delete those records, and SHALL show a product's stock history.
8. WHEN a product's stock at a location falls to or below its reorder level, THE system SHALL show it on the Low Stock report and SHALL tell the staff who look after stock, once, by an automated check (the Inbox event "A product is at or below its reorder level", owners and managers by default); it SHALL be told about again only after it has been restocked above its reorder level (owner, 19 Nov 2026).
9. THE system SHALL value stock at average cost (updated on each receipt), and SHALL report, in an Inventory category of Reports grouped by location and product: stock on hand and value as of today, low stock as of today, and stock movements over a chosen period (owner, 19 Nov 2026).
10. THE system SHALL post the cost of products sold to Cost of Goods Sold and keep the value of stock in an inventory asset account, so the accounts show margin and stock value; counts and adjustments SHALL post to an inventory adjustments account and opening stock to opening balance equity.
11. THE system SHALL let a business set its opening stock with a count, and SHALL treat a product with no stock tracking as it does today (sold without stock checks).

### Staff tools and content

#### Requirement 8: Staff Mobile App

**User Story**: As a staff member, I want my schedule, my customers and check-in on my phone, so that I don't need a desk computer.

**Current state**: Not started. Confirmed in the code (19 Nov 2026):
- The customer app (`packages/mobile`, Phase 19) is an Expo / React Native scaffold of about 20 files: login, Home, Book, My Bookings, Events, Profile and a check-in screen that shows the customer's QR code. It has never been built for or published to the App Store or Google Play, points at a local server, and has no push notifications (nothing on the server sends them). Every staff screen is web only.
- The web app opens on a phone but is laid out for a desk: it has the mobile viewport and 12 list pages switch to cards on a small screen, but it cannot be installed on the home screen (no web app manifest) and sends no push notifications.
- What the staff app needs already exists on the server: bookings by staff member and day, customers with their notes and completed forms, check-in by a customer's QR code (`/v1/check-in/qr`, the customer's code from `/v1/check-in/qr-code/customer/:id`), the time clock (clock in, breaks, clock out; Clock and My Hours pages), the Inbox and in-app notifications (the bell), and role permissions.

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

**Current state**: ✅ Complete, closed with the owner (23 Nov 2026); the description below is what was there before. Nothing in the system knows about tips. An order's total is the sum of its item lines, with no order-level amount, and that total is what the card is charged, what the receipt prints, what the ledger books as cash received and what the payments report sums. Commission is worked out from the item lines only, so it would be unaffected by a tip. Payroll has no pay component for tips and no liability account for tips owed. Refunds work line by line and say nothing about a tip. Staff checkout (card, cash, transfer, check, gift card) is the only path that takes payment through orders; the booking widget's payment step is a simulation, and there is no card-terminal or kiosk payment.

##### Acceptance Criteria

**Agreed with the owner (19 Nov 2026).**

1. THE system SHALL let a business switch tipping on or off (off by default), and SHALL let it choose a default tip percentage (15% by default) and the highest percentage offered (30% by default).
2. WHEN tipping is on, THE system SHALL offer a tip at Checkout just before payment on a slider from no tip up to the highest percentage, starting at the business's default, or as a typed amount (owner, 23 Nov 2026); a choice of no tip SHALL be kept; a percentage SHALL be worked out on the sale total after discounts, before tax or including tax as the business chooses (before tax by default; owner, 22 Nov 2026), and the tip itself SHALL carry no tax. WHEN the order changes before payment (a line added, changed or removed, a promo, or who a line or the order is credited to), THE system SHALL work a percentage tip out again on the new total, SHALL keep a typed tip amount as typed, SHALL remove the tip when no lines are left, and SHALL drop a split by hand so the tip is shared among the staff now on the order (owner, 23 Nov 2026).
3. THE system SHALL charge the sale and the tip together in one payment, including a walk-in's card, and SHALL show the tip as its own line on the receipt; the receipt SHALL show each item before tax, then the tax and the tip as their own lines, as Checkout does (owner, 22 Nov 2026).
4. THE system SHALL let a business decide whether a tip may be added to cash and other manual payments (allowed by default) or to card payments only.
5. THE system SHALL record a tip as money owed to staff (a Tips Payable liability), separate from revenue, tax and commission, and SHALL keep it out of sales and profit reports.
6. THE system SHALL give each tip to the staff who served the customer, as the business chooses: split by the value of each staff member's services on the order (the default), or split evenly between every staff member on the order's services. An order credited to one staff member only gives them the whole tip. Staff SHALL be able to change who gets the tip, or split it by hand, before the order is paid.
7. THE system SHALL include each staff member's card and other electronic tips in the payroll calculation of the pay period they were collected in, as their own line of gross pay on the payslip, and SHALL clear them from what is owed once that pay run is finalised (owner, 19 Nov 2026). A tip added to a cash or other manual payment SHALL be recorded as handed to the staff member at the time and SHALL NOT be added to pay. THE system SHALL show each business the tips collected, paid and owed to each staff member for a period. Paying the staff member's bank account is Requirement 10.
8. WHEN an order is refunded, THE system SHALL leave its tip unchanged unless the tip is refunded as its own line; refunding a tip SHALL take it off what each staff member is owed, in the same shares.
9. WHEN a tip is paid on an order with no staff member on it, THE system SHALL put the tip in the business's tip pool, and SHALL let the owner or a manager share the pool for a range of dates in one of three ways: by hand (amounts per staff member that add up to the pool for those dates), by the hours each staff member was clocked in on the day of each tip, or evenly among the staff clocked in on the day of each tip (owner, 22 Nov 2026). A tip from a day when nobody was clocked in SHALL stay in the pool until it is shared by hand. Once shared, each part SHALL be treated as that staff member's own tip (electronic parts paid in payroll, cash parts handed over from the till), and THE system SHALL show what is waiting in the pool.
10. WHEN an appointment whose service was paid at reservation is checked out, THE system SHALL show the service lines and their payment at Checkout as already paid, SHALL base a suggested tip and the staff it goes to on them as well as on anything else sold at the visit, and SHALL charge only what is sold at the visit and the tip (owner, 23 Nov 2026). THE system SHALL NOT let those lines or their payment be changed or removed at the visit, SHALL NOT post their revenue or payment again, and SHALL show them on the visit's receipt with the earlier payment taken off.
11. WHEN a line is paid with a membership or package, THE system SHALL base the tip on its normal price as Requirement 19, criterion 10, says.
#### Requirement 15: Service Add-Ons

**User Story**: As a business owner, I want to offer extras that enhance a service, such as hot stones with a massage, each with its own price, so that staff can add them when booking and I earn more per visit.

**Current state**: ✅ Complete, closed with the owner (24 Nov 2026); the description that follows is what was there before. A booking is one service and variant, and an order is a list of item lines, so an extra can only be sold today as a separate line at checkout, after the visit. Nothing links an extra to the service it goes with or offers it while booking. The only trace of the idea is an unused "free add-on" membership benefit type.

**Agreed with the owner (23 Nov 2026, changed 24 Nov 2026)**: an add-on enhances the service; it does not add time. It is kept simple: like an option, it is added on the service, with a name, a description and a price, and a service can have as many as needed. There is no shared list of add-ons and no product add-on (24 Nov 2026). An add-on has no tax category of its own. Customers choose add-ons online too. Add-ons are charged on top of a membership or package, unless a package includes them.

##### Acceptance Criteria

1. THE system SHALL let a business add, on each service, zero to many add-ons, each with a name, a description and a price, and SHALL let an add-on be edited or deleted there (a deleted add-on is no longer offered; appointments that have it keep it).
2. WHEN a service is chosen while making or changing an appointment, by staff or by a customer online, THE system SHALL show that service's add-ons with their prices, and SHALL let none, one or several be chosen.
3. THE system SHALL NOT change the appointment's length or the times offered because of an add-on.
4. THE system SHALL show each chosen add-on as its own line with its price, under the service, in the price shown while booking, and SHALL include it in the total and in what is charged at reservation.
5. THE system SHALL keep the price of each add-on as it was when it was chosen, and SHALL put each add-on on the appointment's order at Checkout as its own line, taxed like its service and credited to the service's staff member.
6. THE system SHALL charge add-ons in addition to a membership or package that pays for the service, unless the package includes that add-on; THE system SHALL let a package include add-ons, used and given back by the rules of Requirement 19.
7. THE system SHALL let staff add or remove add-ons on an existing appointment until it is checked out, and SHALL record the change in the appointment history. WHEN an add-on already paid is removed (for example it is not available on the day), THE system SHALL let staff refund it to the payment, as account credit, or not at all (an alternative being given), SHALL make the refund before taking it off, and SHALL record the choice and reason in the history (owner, 24 Nov 2026).
8. THE system SHALL show the chosen add-ons on the appointment, the calendar, the customer's appointment emails and the receipt.
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

### Records

#### Requirement 18: Appointment History

**User Story**: As a business owner, I want to see everything that happened to an appointment (who changed what, when, and why), so that I can explain any change, whether it was made by staff, by the customer or by the system.

**Current state**: ✅ Complete, closed with the owner (23 Nov 2026); the description below is what was there before. Partly recorded, not shown. Confirmed in the code:
- Status changes go to `apt_booking_status_history` (from, to, who, reason, when) from most places: creation, the lifecycle changes, check-in and the automatic no-show. The automatic no-show records no person; it only has a reason. Completing a sale at Checkout and cancelling a recurring series change the status without writing a history row.
- Moving an appointment writes a history row ("Rescheduled") and an audit row with the old and new time; other edits (service, option, staff, location, notes, price, number of people) record nothing.
- Creation, status changes, "ready for you" and moves also write to the general audit log, which only system administrators can query.
- The booking API returns the status history, but no screen shows it. A customer's activity timeline gets some booking events.
- There is no way to tell whether a change came from staff, the customer, the booking widget, a personal link, the kiosk, an import, or an automatic job.
- A late appointment was marked No-Show by the automatic no-show function, run from a server test that changes every overdue booking in the database, and nothing on screen showed how it happened (found 12 Nov 2026).

##### Acceptance Criteria

1. THE system SHALL record every change to an appointment: creation, every status change, and every change to its time, service, option, staff member, location, resource, number of people, price, notes and customer, with the value before and after.
2. THE system SHALL record for each change when it happened, who or what made it (a named staff member, the customer, or the system), where it came from (staff screen, booking widget, customer link, kiosk, import or automatic job), and the reason where one was given.
3. THE system SHALL show an appointment's history, newest first and in plain words, on the appointment for staff who may see the appointment.
4. THE system SHALL record changes made by automatic jobs with the job's name and the rule that caused them, for example "Marked No-Show automatically: not checked in 15 minutes after the start".
5. THE system SHALL record changes to an appointment's payment that follow from the appointment (order created, paid, refunded, no-show or late-cancellation fee charged) in the same history.
6. THE system SHALL keep the history when the appointment is cancelled or completed, and SHALL remove or anonymise it with the customer's other personal data when the customer is anonymised.
7. THE system SHALL NOT let anyone edit or delete history entries.
8. THE system SHALL show the history in a History section of the appointment, to every staff member who may see the appointment, and SHALL NOT show it to customers (owner, 23 Nov 2026).
9. FOR appointments made before the full history, THE system SHALL show the status changes and moves already recorded, and SHALL say that other changes were not recorded then (owner, 23 Nov 2026).

### Payments

#### Requirement 19: Paying with a Membership or Package

**User Story**: As front-desk staff, I want to see what a customer's memberships and packages cover when I book them, and use one to pay for the appointment, so that members and package holders are not charged for what they already paid for, and their allowance is always right.

**Current state**: ✅ Complete, closed with the owner (23 Nov 2026); the description below is what was there before. Confirmed in the code (15 Nov 2026):
- Memberships live in the `mbr_*` tables (plans, plan items with a quantity and how often it resets, enrollments), but the booking payment step and the membership pricing rules read the older `mem_*` tables, which nothing fills any more. A membership is therefore not recognised when booking.
- Packages are recognised only on the "Charged at reservation" payment step, and only one: the first package that has a session left for the service. The option chosen is ignored, minutes packages and products are not handled, and the session is used before payment, with nothing to undo it.
- Checkout applies no membership or package at all, and charges the option's list price.
- No use of a membership is counted (the usage table exists, nothing writes it), and a package session is never given back when a booking is cancelled.
- No screen shows a customer's packages or what is left of any membership or package.

##### Acceptance Criteria

1. WHEN a customer is chosen on a booking, THE system SHALL show every membership and package the customer holds that covers the service and option being booked, each with how much is used and how much is left (for a membership, in its current allowance period; for a package, in total, with its expiry date).
2. THE system SHALL handle customers with several memberships, several packages, or both, and SHALL let staff choose which one pays; THE system SHALL offer "Pay with membership or package" first, preselecting the one that runs out soonest, and SHALL always let staff pay with a normal payment method instead.
3. WHEN a membership or package is chosen, THE system SHALL reduce the price of what it covers to zero, and SHALL leave anything it does not cover (other services, add-ons, products) to be paid by another method.
4. THE system SHALL count a membership's allowance per period as the plan item says (per day, week or month, or without limit), and a package's allowance per item until it expires; THE system SHALL NOT offer a membership or package whose allowance for that appointment is used up, has expired, or is not active.
5. THE system SHALL hold the allowance for the booking when it is made, so the same allowance cannot be promised twice, and SHALL count it as used when the appointment is checked out (or paid at reservation).
6. THE system SHALL show the chosen membership or package at Checkout, and SHALL let staff change it, choose another, or pay with a normal method instead, before completing the order; extras and products added at Checkout SHALL be paid as usual, or by a membership or package that covers them.
7. WHEN a booking held against a membership or package is cancelled, THE system SHALL give the allowance back; WHEN a used allowance is refunded, THE system SHALL give it back.
8. THE system SHALL record on the order and its receipt which membership or package paid for which line.
9. THE system SHALL apply the same membership and package rules wherever a booking or sale is priced (New Appointment, the payment step, Checkout and the price shown while booking), so they never disagree.
10. THE system SHALL count a line paid with a membership or package at its normal price for a tip (before tax, or including the tax it would have had, as the business's tip setting says), and SHALL share the tip between staff by those normal values; THE system SHALL take the tip itself by a normal payment method, never from the membership or package (owner, 23 Nov 2026; Requirement 14).
11. WHEN an appointment paid with a membership or package at reservation is checked out, THE system SHALL show the line under Paid at reservation as paid with that membership or package, and SHALL offer a tip on it as criterion 10 says (owner, 23 Nov 2026; Requirement 14, criterion 10).

### Platform

#### Requirement 20: Features per Business, Set by the Tenant

**User Story**: As a tenant owner, I want to switch features on or off for each of my businesses, so that a small business gets a simple product without the parts it does not need, and I can price my businesses by the features they have.

**Current state**: Confirmed in the code (15 Nov 2026):
- Features (online booking, waitlist, memberships, packages, two-way SMS, community, advanced reporting, prospects, loyalty points, events) are switched on or off on the system's Configuration > Feature Flags page, for the whole platform.
- The database already has a tenant level: a flag can be overridden for one tenant (`sys_feature_flag_overrides`, with an API route to set it), but no screen sets it, and there is no business level at all.
- The sidebar and dashboard hide a module when its flag is off, but the flags are worked out for the tenant only, and most of the server does not check them (a switched-off feature is hidden, not refused).

##### Acceptance Criteria

1. THE system SHALL let a system administrator decide which features a tenant may use at all, and which are switched on by default for its businesses.
2. THE system SHALL let a tenant owner switch each feature the tenant may use on or off for each of the tenant's businesses, and SHALL show, per business, which features are on.
3. WHEN a feature is off for a business, THE system SHALL hide it from that business's screens, menus and dashboard, and SHALL refuse its use through the server (pages, links and API), with a clear message.
4. WHEN a feature is switched off, THE system SHALL keep the business's data for it (for example memberships already sold, events already published) and SHALL say what stays in force; switching it back on SHALL restore it as it was.
5. THE system SHALL record who switched a feature on or off for a business, and when.
6. THE system SHALL make each business's features available to the tenant's own pricing and billing of its businesses (when that exists), and SHALL show the tenant a summary of features per business.
7. THE system SHALL treat features that depend on each other together (for example, packages offered through online booking), and SHALL say what else is affected when a feature is switched off.

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
