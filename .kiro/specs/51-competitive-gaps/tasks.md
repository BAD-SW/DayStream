# Phase 51: Competitive Gaps - Tasks

## Overview

One section per gap, in the order of requirements.md. Each gap follows the same steps: confirm its current state in the code, agree its requirements with the owner and write its design, build it, then verify it live and have the owner close it. Gaps finished in another spec (11 and 12) are tracked here only.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 0. Phase setup

### 0.1 Gap register
- [x] ✅ Gaps collected from the competitive comparison and checked against the current code (state recorded per requirement)
- [x] ✅ Order of work: top to bottom through this document, one gap at a time
- [x] ✅ Inventory confirmed as planned long term (Phase 28 left it out short term only)
- [x] ✅ Gap 14 (tips), gap 15 (service and product add-ons), gap 16 (customer self-service) and gap 17 (starter templates) added by the owner; state confirmed in the code

## 1. Forms, waivers and e-signature (Requirement 1)
- [x] ✅ Confirm current state (no forms; S3 backend unimplemented; anonymisation incomplete)
- [x] ✅ Agree requirements (criteria 1-11, from the owner's answers)
- [x] ✅ Design (design.md §1, agreed with the owner)
- [x] ✅ Build
  - [x] ✅ Storage: local and S3 chosen from Configuration > Storage, secret encrypted
  - [x] ✅ Path helper (`storagePaths`) and every file writer switched to it
  - [x] ✅ One-time move of existing files to the new layout
  - [x] ✅ Migration 168 and the shared form definition with its validator
  - [x] ✅ Form builder on the Templates tab and the `/v1/forms` routes
  - [x] ✅ Requests (device and email link) and the public form page
  - [x] ✅ Signed PDF stored in the customer's folder
  - [x] ✅ Missing and out-of-date status on profile, booking and check-in
  - [x] ✅ View, print and email a copy
  - [x] ✅ Anonymise and delete remove forms, files and folders; cleanup retry job
- [x] ✅ Verify live and close with the owner (form completed at the kiosk, stored in the customer's folder, anonymise removes it)

## 2. Treatment charting (Requirement 2)
- [x] ✅ Confirm current state and agree requirements (criteria 1-11, from the owner's answers)
- [x] ✅ Design (design.md section 2)
- [x] ✅ Build
  - [x] ✅ Migration 171: clinical permissions, `frm_forms.kind`, `svc_services.default_chart_group_id`, `chr_charts`, `chr_amendments`
  - [x] ✅ Clinical access helper (owner, manager and technician; not reception) and client permission mapping
  - [x] ✅ Shared validator: charts reject agree and signature items
  - [x] ✅ Chart service and routes with strict audit (view, create, update, sign, amend, delete, PDF)
  - [x] ✅ Charts type on the Templates tab and default chart on the service
  - [x] ✅ Customer Charts tab and booking Chart panel, with the previous chart shown
  - [x] ✅ Sign-off PDF stored in the customer's charts folder
  - [x] ✅ Anonymise, delete, merge and export hooks
  - [x] ✅ Staff roles made generic: Owner, Manager, Reception and Technician replace Staff, Therapist and Trainer (migrations 172 and 173); role dropdown on the staff profile saved with the profile; Role column on the Staff list
  - [x] ✅ Checked with live scripts (service and HTTP): reception refused, locking, amendments, audit rows, anonymise removes charts and files
- [x] ✅ Verify live and close with the owner

## 3. Virtual waiting room (Requirement 3)
- [x] ✅ Confirm current state (criteria 1, 4 and 6-13 built; staff waiting list, ready-for-you message and arrival alerts missing; customer SMS waits for gap 4)
- [x] ✅ Agree requirements (criteria 14-19, from the owner's answers)
- [x] ✅ Design (design.md section 3)
- Self check-in with forms (design.md §1.11a)
  - [x] ✅ Kiosk identifies by phone, email or QR code (never name), refuses when ambiguous
  - [x] ✅ Server: self check-in service, kiosk session, kiosk and phone routes, long personal check-in code
  - [x] ✅ Kiosk screen `/kiosk` with forms list; kiosk setup in Settings > Check-In Kiosk (fixes device registration); the separate Check-In page, menu entry and dashboard tile removed
  - [x] ✅ Kiosk lists the customer's other upcoming appointments when nothing is scheduled today
  - [x] ✅ Phone page `/check-in/:code`; link in reminder emails; staff can copy the link
  - [x] ✅ Form page returns the customer to the kiosk or phone page afterwards
  - [x] ✅ First-visit forms stay outstanding until the first visit is completed (a checked-in visit is not yet completed)
  - [x] ✅ Verified live with the owner: kiosk registered, appointment made for today, checked in at the kiosk and a pending form completed
  - [x] ✅ Phone link check-in tried live with the owner
- Build the waiting room
  - [x] ✅ Migration 174, start session and ready-for-you, reset clears them
  - [x] ✅ Staff Check-in button goes through the check-in service, with override
  - [x] ✅ Waiting list route and customer-arrived alert (Settings > Inbox event)
  - [x] ✅ Bookings page: Waiting list panel and Appointments pane with date range
  - [x] ✅ Phone page and kiosk: Please come in, started, polling; ready email
  - [x] ✅ No cut-off for late check-in (early still prompts); a reset cancels the check-in so the customer can be checked in again
  - [x] ✅ Forms completed in a window over the current page (waiting list, check-in prompt, booking, new appointment), with no redirect
  - [x] ✅ No-show button turns red when a confirmed customer is more than 15 minutes late
  - [x] ✅ Checkout: Done button returns to the Bookings screen after payment
  - [x] ✅ Check-in link and Add to Calendar (links and attached invite) in the confirmation email; reminders scheduled every 15 minutes with the link; lead times read from the business, tenant or system setting
  - [x] ✅ Words on the check-in screens (phone page, kiosk, forms list) held per language and editable per business under Templates > Check-In; the ready-for-you email uses the same wording (no separate template)
  - [x] ✅ Appointment Reminder template (own entry in the Document Type list, with a Time Until Appointment placeholder); plain reminder until the business writes one
  - [x] ✅ Any wording on the check-in screens and in the ready-for-you email can include the customer's first name, service, appointment time and business name (chips in the editor stay visible while scrolling); the entry screen of the kiosk takes the business name only
  - [x] ✅ Moved to open items (section 21): a screen for the business to set its reminder times
  - [x] ✅ Bookings opens on the calendar or the list with the Waiting list, chosen by the business (Settings > System) and, if they wish, by each staff member on their profile (migration 177)
  - [ ] Verify live with the owner: business setting, staff profile choice, Calendar | List switch
  - [x] ✅ Manage link in the appointment emails: moved to gap 16 (it needs a customer self-service page first)
- [x] ✅ Verify live and close with the owner

## 4. Two-way SMS and WhatsApp (Requirement 4)
- [ ] Write up what the Inbox does today for the owner, and bring Phase 47 documents up to date (with David)
- [ ] Choose the messaging provider(s) with the owner
- [ ] Design (in Phase 47)
- [ ] Build
- [ ] Verify live and close with the owner

## 5. Book-and-pay links (Requirement 5)
- [x] ✅ Confirm current state (widget payment simulated; Stripe one-time payments from staff screens only; no card can be linked to an appointment; Pay later chooses the card only at Checkout)
- [ ] Link for a customer who is not present (send the link to give a card or pay)
- [ ] Agree the rest of the requirements, one step at a time
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 6. Class scheduling depth (Requirement 6)
- [ ] Confirm what classes already do (timetable, roster, waitlist promotion, late-cancel rules, pass credits)
- [ ] Agree requirements and design
- [ ] Build
- [ ] Verify live and close with the owner

## 7. Retail inventory (Requirement 7)
- [x] ✅ Confirm current state (products and flat variants with SKU and price only; no stock, cost, supplier, reorder level or location; sales and refunds change no stock; AP not linked to products; no stock reports; COGS account unused)
- [x] ✅ Requirements agreed with the owner (15 Nov 2026): everything missing, plus quantity on hand while an order is put together; in-person sales only, no online orders or shipping
- [x] ✅ Design written (design 7)
- [x] ✅ Owner decided: never more than is on hand; a larger quantity is limited to what is on hand, the rest of the order is unaffected
- Build (design 7.6)
  - [x] ✅ Migration 180, stock service (movements, average cost), product fields and Stock tab, opening stock by count
  - [x] ✅ Sale and refund movements; quantity on hand and warnings at Checkout; order location; stock checked before a walk-in card is charged
  - [x] ✅ Adjust, count and transfer on the product's Stock card (migration 181 for transfers; owner, 18 Nov 2026: no separate Inventory page)
  - [x] ✅ Purchase orders, receiving, vendor bills (migration 182, account 1300 Inventory; Accounting > Purchase Orders and the order page; email to vendor or mark as sent; receive in parts; bill what was received)
    - [x] ✅ A purchase order line's quantity starts at the reorder quantity of the product (or variant) at the delivery location, else 1 (owner, 19 Nov 2026)
    - [x] ✅ A purchase order's bill is approved when it is created, ready to pay (owner, 19 Nov 2026)
    - [x] ✅ Purchase Order document type in Settings > Templates (owner, 18 Nov 2026); the vendor email uses it, with a built-in layout when there is no template; replies go to the business
  - [x] ✅ Low-stock notification (owner, 19 Nov 2026: an automated process sends a low_stock notification; the list itself is a report, below); accounting postings (migration 183: 5100 Inventory Adjustments, 3900 Opening Balance Equity; cost of sales with the order journal, returns, counts, adjustments, opening stock)
  - [x] ✅ Inventory reports (owner, 18 Nov 2026), a new Inventory category in Reports (owner, 19 Nov 2026) with the usual filters and export
    - [x] ✅ Stock on Hand & Value: as of today; grouped by location; product, variant, on hand, reorder at, cost price, average cost, stock value, retail price, retail value, margin and margin % (owner, 19 Nov 2026: no SKU, barcode, supplier, status or category)
    - [x] ✅ Low Stock: as of today; grouped by location; every item at or below its reorder level, with on hand, reorder level, reorder quantity, on order, cost price and reorder cost (owner, 19 Nov 2026)
    - [x] ✅ Stock Movements: From and To; grouped by location; every stock change with date, movement, reason, change, unit cost, value, on hand after and who (owner, 19 Nov 2026)
    - [x] ✅ Report screen: a report can be as of a date (shown, not chosen), always grouped (no Group by options), with hidden columns; headers top-aligned with their icons beside them; the column filter window is solid
  - [x] ✅ Requirement 7 brought in line with what was built (criteria 5 to 10; owner, 19 Nov 2026)
- [x] ✅ Verify live and close with the owner (Checkout stock limit, Stock card, purchase orders to bills, accounting entries, low stock and the inventory reports; closed 19 Nov 2026)

## 8. Staff mobile app (Requirement 8)
- [x] ✅ Confirm current state (19 Nov 2026: customer app is an unreleased Expo scaffold without push; web app not installable; the server already has schedule, customers, notes, forms, QR check-in, time clock, Inbox and notifications)
- ⏸️ On hold (owner, 19 Nov 2026): set aside for now. When resumed, decide a native app (staff mode in the Expo app; testable in Expo Go, push needs a store build) or the web app made installable (testable over Wi-Fi; camera and push need an https tunnel)
- [ ] Agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 9. Video hosting and livestream (Requirement 9)
- ⏸️ On hold (owner, 19 Nov 2026): skipped for now. Matters most to class studios selling online memberships (Momence, Mindbody, Arketa); needs an outside video service (for example Mux, Cloudflare Stream or Vimeo) with usage-based cost
- [ ] Confirm current state (course authoring, paid access) and choose a video provider
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 10. Payroll payout (Requirement 10)
- [ ] Confirm whether payout or filing exists, and choose build vs payroll provider
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 11. Multi-language (Requirement 11)
- [ ] Tracked: finished in Phase 44

## 12. AI assistant and receptionist (Requirement 12)
- [ ] Tracked: finished in Phase 21

## 13. Integrated phone (Requirement 13)
- [ ] Choose a telephony provider and agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 14. Tips (Requirement 14)
- [x] ✅ Confirm current state (no tip support; order total, charge, receipt, ledger, commission, payroll and refunds recorded in requirements.md)
- [x] ✅ Requirements agreed with the owner (19 Nov 2026): off by default; offered at Checkout; one payment; cash tips a setting; Tips Payable; split by service value or evenly, as the business chooses, changeable before payment; Tips report; card and other electronic tips included in the pay run of their period (owner, 19 Nov 2026), cash tips handed over at the time; refunds
- [x] ✅ Design written (design 14)
- Build (design 14.8)
  - [x] ✅ Migration 185, settings, tips service, Checkout tip panel and payment, receipt
  - [x] ✅ Journal, refunds, payroll, Tips report
  - [x] ✅ Suggested tips before tax (default) or including tax, a setting (migration 186); receipt items before tax with Tax and Tip lines, matching Checkout (owner, 22 Nov 2026)
  - [x] ✅ Tip pool for tips with no staff member on the order (migration 187): Accounting > Payroll > Tip Pool, shared by hand, by hours clocked in or evenly among staff clocked in; cash journal on sharing; Tip pool section in the Tips report (owner, 22 Nov 2026)
  - [x] ✅ The tip follows the order before payment (migration 188): a percentage tip is worked out again when lines, promo or credits change; a typed tip is kept; no lines, no tip; a split by hand is dropped when the staff change (owner, 23 Nov 2026)
  - [x] ✅ Tip slider at Checkout from no tip to the highest percentage, starting at the business's default; settings for the default and the highest (migration 189) (owner, 23 Nov 2026)
  - [x] ✅ A service paid at reservation shown at the visit, read only: tipped on, shared with its staff, not charged or posted again, on the visit's receipt with the earlier payment taken off (owner, 23 Nov 2026)
- [x] ✅ Verified and closed with the owner (23 Nov 2026)

## 15. Service and product add-ons (Requirement 15)
- [x] ✅ Confirm current state (no add-on support; extras are sold only as separate checkout lines)
- [ ] Agree requirements with the owner (an add-on that uses a product depends on gap 7, inventory)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 16. Customer self-service (Requirement 16)
- [x] ✅ Confirm current state (booking widget with simulated payment, My Bookings with cancel, events, personal links for forms and check-in; profile routes with no page; no account page, change password, reschedule, manage link, order or membership views)
- [ ] Agree requirements with the owner (which actions customers get, whether customers sign in or use personal links, how sign-in finds the business, rescheduling rules, real payment in the widget)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 17. Starter templates (Requirement 17)
- [x] ✅ Confirm current state (no template is created for a new business; a missing template gives a bare email)
- [ ] Agree requirements with the owner (which types, wording and languages, existing businesses, how a starter is marked)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 18. Appointment history (Requirement 18)
- [x] ✅ Confirm current state (status history recorded in most places but not shown; other edits not recorded; no source of a change; the automatic no-show records no person)
- [ ] Agree requirements with the owner (where the history is shown, who may see it, what customers see, older appointments)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 19. Paying with a membership or package (Requirement 19)
- [x] ✅ Confirm current state (memberships read from the old mem_* tables, so not recognised; one package only, on the "Charged at reservation" step; nothing at Checkout; no usage counted; nothing given back on cancel)
- [x] ✅ Requirements and design written from the owner's description (15 Nov 2026)
- [x] ✅ Owner agreed the requirements and design, with tips on what a membership or package paid (criteria 10 and 11) (23 Nov 2026)
- Build (design 19.7)
  - [x] ✅ Migration 190 and benefits service (what covers; held, used, released), replacing the mem_* pricing reads
  - [x] ✅ Benefits endpoint; booking create and update hold the chosen benefit; cancel releases it
  - [x] ✅ New Appointment: Pay with membership or package, preselected; price box, payment step and quote follow it
  - [x] ✅ Checkout: benefit per line, change, used on completion; refund releases; receipt; tips on the normal price; Paid at reservation shows what paid
  - [x] ✅ Found in testing (23 Nov 2026): packages sold at Checkout given to the customer (migration 191); customer Packages tab; no payment step or card when a membership or package pays; default order (membership, then earliest-expiring package); only usable ones listed; allowances counted on the appointment's day; appointment's service line kept at Checkout and services addable
- [x] ✅ Verified and closed with the owner, including tips on what a membership or package paid (23 Nov 2026)

## 20. Features per business, set by the tenant (Requirement 20)
- [x] ✅ Confirm current state (flags set for the whole platform on Configuration > Feature Flags; a tenant override table and API exist with no screen; no business level; most server routes do not check flags)
- [ ] Agree requirements with the owner (which features, defaults, what happens to data when a feature is switched off, link to the tenant's pricing)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 21. Open items raised along the way
- [ ] Decide: add a minimum-notice field to the service edit screen (today it can only be set when the service is created)
- [ ] Decide: should the chart feature be renamed for other industries (for example Service records or Job cards)?
- [ ] Decide: should technicians see the Inbox?
- [ ] Decide: add a screen for the business to set its reminder times (today the times come from the business, tenant or system setting, default 24 hours and 2 hours before)
- [x] ✅ Removed the hidden 08:00-20:00 hours of a service without an availability rule; such a service now follows the location hours, staff availability and resources. Opening hours now also apply to services without staff (they were only checked with the staff)
- [x] ✅ Availability checks aligned (14 Nov): when a time can be booked, location hours, the service's own availability rules, staff availability and resource schedules are all checked, both in the booking times offered and when a booking is saved; nothing set up for a location, staff member, resource or service means no limit; a resource marked Available 24/7 ignores its schedule (closures still apply); a closing time of 23:59 counts as the end of the day
- [x] ✅ The server test of the automatic no-show was limited to its own business (it had marked bookings of the real business as No-Show; four were restored)
- [ ] Fix: the server tests run against the development database and leave about 24 test businesses and their data behind; give the tests their own database, or have them clean up
- [ ] Decide: should late appointments be marked No-Show automatically (a business setting, off by default)? Today nothing runs it; staff mark No-Show, helped by the red button after 15 minutes
- [x] ✅ Two orders were created when Checkout opened (the page loaded twice in development, and two orders made at once got the same number): Checkout reuses an order being created, and the server numbers orders and opens a booking's checkout one at a time
- [x] ✅ Reports page: each person puts the report categories in their own order by dragging a category by its handle (or with the keyboard), saved on their profile and used every time; Reset order goes back to the standard order (owner, 19 Nov 2026; migration 184, usr_preferences)
- [x] ✅ Reports category order verified live with the owner (19 Nov 2026)
- [x] ✅ Bills could not be paid: every bill starts as draft and payment needs it approved, but the Bills tab had no Approve. Bills now have Approve (draft, pending, or overdue and never approved), then Record Payment; an approved bill past its due date (overdue) can still be paid. A form's error on the Accounting page shows on its own line under its buttons
- [x] ✅ Considered addressed by the owner (19 Nov 2026), no clean-up: the extra open Checkout orders left by the duplicate-order bug in the development data (176 orders across all dev businesses share an order number with another, back to ORD-2026-0004; 110 are open, many with a line on them)
- [x] ✅ Duplicate purchase orders from the Save draft bug: PO-0003 to PO-0006 cancelled by the owner; PO-0001 (a copy of PO-0002) cancelled (owner, 19 Nov 2026)

## 22. Clean-up of the booking workflow (after the New Appointment and calendar changes)
Not gap work: fixes found while testing the booking workflow (owner, 14 Nov 2026).
- [x] ✅ Reservation Payment Rule on the service (Service Details: Not required / Taken but not charged / Charged at reservation; migration 178)
- [x] ✅ No card required: New Appointment skips the payment step; the button reads Save reservation
- [x] ✅ Renamed to Reservation Payment Rule
- [x] ✅ Card required (option A, owner 14 Nov 2026): card step in New Appointment (saved cards or a new one, customer agreement, nothing charged); card stored on the booking (migration 179) and checked on the server; walk-ins need no card; Checkout offers the booking's card first; a no-show fee uses it first; the calendar's quick popup sends these services on to the full window
- [x] ✅ Adding a card opens the card form at once (no Continue button), in New Appointment, Checkout and Take payment
- [x] ✅ A stored Stripe customer that does not exist in the connected Stripe account is replaced when a card is added (it came with imported test data and stopped every new card for that customer)
- [ ] Verify Reservation Payment Rule live with the owner (No card required, Card required)
- [ ] Decide: remove the imported sample cards and Stripe customer ids of Transcend Health (13 cards, 7 customers), which do not exist in the connected Stripe account and cannot be charged
- [x] ✅ Paying or holding while booking is by card or bank account (SEPA / ACH direct debit) only: the payment step offers Card on file, New card and Bank account (saved, or added through the direct-debit form); Cash, Check, Gift card, Other and Pay later are only at Checkout (refused by the server too). The old "Bank transfer" tile was a free-text reference, not a direct debit, and is gone. Card required accepts a saved bank account as well as a card
- [x] ✅ One step 4 for "Taken but not charged" and "Charged at reservation": what it costs on the left; on the right Card on file, New card and Bank account, a new card or bank account entered in place (a walk-in's new card still opens the card form after Confirm)
- [x] ✅ New Appointment shows the price (lines, tax, total, and when it is paid) as soon as a service and option are chosen, for every Reservation Payment Rule; it follows the customer (member prices), option and number of people. Add-ons (gap 15) will add lines here
- [x] ✅ A walk-in can only be booked for today: New Appointment offers only today once Walk-in is chosen, the calendar's quick popup refuses a walk-in on another day, and the server refuses it (also when a booking on another day is changed to a walk-in)
- [x] ✅ Check-out of an appointment paid at reservation: opens an order for anything else sold at the visit (no service line), noting the order that paid the service; with nothing added, Finish appointment completes it. It used to refuse ("already been checked out") and left the appointment in progress
- [x] ✅ A receipt for every payment, at the time and later: the booking payment step ends on Paid with Print and Email receipt; an appointment lists its payments with their receipts; the Payments page's payment detail has Print and Email receipt. Checkout (receipt page), Record payment (Email / Print) and the customer's Billing tab already had them
- [x] ✅ A walk-in's new card: the card field opens when New card is pressed, like everyone else's; it is charged once (never saved) on Take and confirm, and a declined card can be tried again on the same booking
- [x] ✅ The calendar has New Sale and Orders again (page header, as on the list)
- [x] ✅ One New / Edit Appointment screen, always the page (/bookings/new, /bookings/:id/edit): the calendar no longer opens it as a window; closing or saving goes back where it was opened from (the calendar on the same day, view and columns, or the list) with the saved message
- [x] ✅ Calendar and New / Edit Appointment on the design system: font sizes, weights, spacing, corner rounding, shadows and buttons from the standard tokens (they were fixed pixel values copied from the design mock); no fixed colours left
- [ ] Verify Charged at reservation and Taken but not charged live with the owner
- [ ] Decide: show and change the held card on an existing appointment (the server accepts a change; no screen yet besides Checkout)

---

**Status**: 🟡 In Progress — gaps 1, 2 and 3 complete; gaps 4 (two-way SMS and WhatsApp) and 5 (book-and-pay links) wait for the owner's talk with David about SMS and WhatsApp; gap 6 (class scheduling depth) is next
**Dependencies**: Phase 47, Phase 21, Phase 44, Phase 15, Phase 28
