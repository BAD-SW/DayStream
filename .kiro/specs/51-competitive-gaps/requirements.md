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

**Current state**: Not started. Notes are free text with an optional category.

##### Acceptance Criteria

1. THE system SHALL let a business define chart templates (for example SOAP or a treatment record) built from the same field types as forms.
2. THE system SHALL let staff complete a chart against a booking, and SHALL show the customer's previous charts at the next visit.
3. THE system SHALL restrict charts to roles allowed to see clinical information, and SHALL log every view and change.
4. THE system SHALL lock a chart once signed off, with later corrections recorded as amendments.

#### Requirement 3: Virtual Waiting Room

**User Story**: As a customer, I want to tell the business I have arrived from my phone and be told when to come in, so that I don't queue at the desk.

**Current state**: Partial. Kiosk, QR and reception check-in, walk-ins and no-show handling are built (Phase 15). There is no "I'm here" from the customer's own phone and no "we're ready for you" message.

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

---

## Dependencies

- Phase 47 (Inbox): the conversation model that SMS, WhatsApp, book-and-pay links and phone build on
- Phase 15 (Check-in): the check-in records the virtual waiting room extends
- Phase 14 (Events) and Phase 08 (Memberships): the building blocks for class depth
- Phase 28 (Products and Services): products and variants for inventory
- Phase 19 (Mobile App): the app foundation for the staff app
- Phase 22 (Community): on-demand video and courses
- Phase 12 (Staff Management): pay runs for payout
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
