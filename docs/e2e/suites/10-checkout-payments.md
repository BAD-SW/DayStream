# Suite 10 — Checkout & Customer Payments (spec 10 Section C)

Persona: owner / manager / reception as stated. Covers orders and checkout (spec 28 R8), one-time payments, stored methods, refunds, invoices, gift cards, vouchers, subscriptions, dunning and the ledger postings (spec 10 C1–C8, C6a). Delivered by Bill in the pull synced on 2026-10-12; its checkpoint (task 4.11) is open, so findings are likely. Conventions: [README](../README.md).

**Every script that moves money is `guarded`:** PRE-07 must have passed; act only on E2E customers. Take a reading of today's revenue and of the customer's balance before each script and compare after.

Method classes to keep in mind: **processed** (card, bank draw, wallets: charged through the processor), **manual-record** (cash, check, bank transfer, other: recorded only), **internal** (gift card).

---

### PAY-01 · Accepted payment methods drive what checkout offers
`P0` `regression` · Spec 10 R0.3; task 4.10 · As: owner, reception · Status: Verified
1. Settings → Payment Methods: note the accepted methods. Turn off "check"; save. 2. As reception, open the method picker at checkout and in **Record Payment**. 3. Restore.
**Expect:** the picker offers exactly the accepted methods; "check" is gone while off; processed methods appear only when the business has a processor connection and the customer has (or can add) a stored method.
**Cross-check:** `GET /api/v1/pay/available-methods` for a one-time context equals the picker; for a recurring context it contains only card and bank draw. Report KI-6 if a business has no accepted methods at all.

### PAY-02 · Build and edit an order
`P0` `regression` · Spec 28 R8 · As: reception · Status: Verified
1. At `/checkout` start an order for an E2E customer; add a service, a merchandise variant × 2, and a package; change a quantity; remove an item; change the customer.
**Expect:** subtotal, tax and total recalculate after each change and add up to the cent; an empty order cannot be completed.
**Cross-check:** `GET /api/v1/checkout/orders/{id}` holds the same lines and totals in integer cents.

### PAY-03 · Checkout from a booking
`P0` `regression` · Status: Verified
1. From a completed, unpaid booking, open checkout.
**Expect:** the order is pre-filled with the booking's service, variant and price and linked to the booking; paying it marks the booking as paid; a booking cannot be checked out twice.

### PAY-04 · Pay with a manual method
`P0` `regression` `guarded` · Spec 10 C1 · As: reception · Status: Verified
1. Complete an order by cash; another by bank transfer with a reference.
**Expect:** order completes; receipt at `/receipt/{id}` shows items, tax, total, method and a `PAY-…` reference (or the reference typed in, for a transfer or check); no processor call is made. A sale with no customer can be paid in cash (order and ledger only, no entry in Payments) but not by card or gift card.
**Cross-check:** `/payments` and the customer's Billing tab list the transaction as not processed; the journal has Debit Cash 1100 / Credit Service Revenue 4100 for the amount.

### PAY-05 · Store a customer payment method
`P0` `guarded` `needs-config` · Spec 10 C3; task 4.5 · As: manager · Status: Verified
1. Customer detail → Overview → payment methods: add a test card; add a second; set default; remove one.
**Expect:** as BILL-03, at customer level: hosted fields, masked display, exactly one default.
**Cross-check:** the method was vaulted on the **business's** processor connection; the customer sees the same masked methods in their portal if exposed there; another business's staff cannot list them. Adding, making default and removing are in the audit log (`payment_method.added`, `.set_default`, `.removed`) with brand and last 4 only, never the token (Bill `13618b7`).

### PAY-06 · Pay with a stored card
`P0` `guarded` `needs-config` · Spec 10 C1 · Status: Verified
1. Complete an order choosing the customer's stored card (`PUT /api/v1/checkout/orders/{id}/complete` with `payment_method_id`: the server takes the payment and closes the order in one step). 2. Submit the same payment twice (double-click, then retry after reload).
**Expect:** one charge, status completed, with a processor reference, linked to the order; the ledger has cash once and the customer gets no account credit; the booking is confirmed on success.
**Cross-check:** exactly one transaction row and one processor charge (idempotency); with a declining test card the order is **not** completed and the linked booking is released as designed.

### PAY-07 · Record Payment from the customer profile
`P1` `guarded` · Task 4.10 · As: reception · Status: Verified
1. Customer detail → **Record Payment**: 25.00 cash, with a note. Try 0.00 and a negative amount.
**Expect:** the payment is recorded and appears in the Billing tab; invalid amounts are refused. Reception (Staff, `bookings:update`) is allowed to take payments.

### PAY-08 · Refunds: from the order, line by line
`P0` `guarded` · Spec 10 C4 (rewritten 2026-10-20 for Bill's `764002c`) · As: owner, Staff · Status: Verified
1. Try to refund a sale from its payment (Billing tab, transaction row) instead of from its order.
2. From the order / receipt (**Refund**): as Staff; without a reason; the service line; one unit of a product line; the remaining units; one more unit.
3. Sell one product by card and refund it from its order.
**Expect:** a sale's payment cannot be refunded directly (`REFUND_VIA_ORDER`); Staff is refused (403); a reason is required; a service line is not refundable ("issue a discount instead"; memberships and packs are cancelled, gift cards are never refunded); the product units are refunded and a further unit is refused (`INVALID_QUANTITY`); the order becomes **partially refunded** / **refunded**; the card refund goes through the processor.
**Cross-check:** refund rows link to the original payment and add up to the refunded lines; the journal takes cash out (1100 credit); the audit log has the refunds. REP-04 checks the dashboard and the Payments Received report net them.

### PAY-09 · Invoices: enable, issue, number, PDF
`P0` `regression` · Spec 10 C5 · As: owner, manager · Status: Verified
1. Settings → Payment Methods: turn Invoicing on. 2. Customer Billing tab → **Issue Invoice**: two line items, due in 14 days. Issue a second invoice. 3. Open each PDF. 4. Turn Invoicing off and look for the Issue Invoice action.
**Expect:** invoices get consecutive numbers with no gap; totals = lines + tax; the PDF shows the business header and tax id, bill-to, lines, tax and total, matching the screen; with invoicing off the action is hidden and the API refuses to issue.
**Cross-check:** a failed issue attempt (for example with an empty line) does not consume a number.

### PAY-10 · Invoices: settle, void, email
`P0` `guarded` · Spec 10 C5 · As: manager · Status: Verified
1. Pay one invoice with a stored method (or the available method). 2. Void the other. 3. Email an invoice (customer address is a `.test` address).
**Expect:** the paid invoice becomes `paid` and leaves "outstanding"; the voided one cannot be paid; a paid invoice cannot be voided; email is queued without error.
**Cross-check:** the settlement appears in the ledger linked to the invoice and in the journal.

### PAY-11 · Gift cards: issue, look up, redeem partially, void
`P0` `guarded` · Spec 10 C7 · As: manager, reception · Status: Verified
1. Create a gift card of 100.00 for recipient `e2e-{RUN}-gift@daystream.test`. 2. At checkout pay a 30.00 order with the card code. 3. Pay a 90.00 order with it. 4. Void the card; try to use it.
**Expect:** the code has the form `GC-XXXX-XXXX`; the balance drops by the order total (price plus tax); step 3 is refused whole and the order stays open (there is no split payment); a voided or expired card is refused.
**Cross-check:** the card's history lists each redemption; a code from one business is not found in another; gift-card redemption is **not** posted as cash revenue in the journal.

### PAY-12 · Vouchers: free, fixed, percentage, limits
`P1` `guarded` · Spec 10 C8 · As: manager · Status: Verified
1. Create three vouchers: free service, fixed 15.00 (`discount_value` 1500), 20 % (`discount_value` 2000: percentages are in basis points); one of them single-use and limited to `E2E {RUN} Svc` (`applies_to.serviceIds`). 2. Validate each against an 80.00 order; redeem the single-use one twice; apply the scoped one to a different service.
**Expect:** discounts are 80.00, 15.00 and 16.00; fixed never exceeds the order amount; second use and out-of-scope use are refused with a reason.
**Cross-check:** `POST /api/v1/pay/vouchers/validate` returns the same discount the checkout applies; redemption count increments once.

### PAY-13 · Discount code at checkout
`P1` `regression` · Spec 09 R5 · Status: Verified
1. Apply the code from OFF-15 to an order; remove it; apply an invalid code.
**Expect:** total drops and restores exactly; invalid code refused with a reason; a code and a promotion combine according to the stacking rules.

### PAY-14 · Void an order
`P1` `regression` `guarded` · Status: Verified
1. Void an open order. 2. Try to void a completed, paid order.
**Expect:** the open order is voided and frees anything it reserved; the paid one requires a refund first (or voids and refunds together: record which).

### PAY-15 · Subscription renewals run
`P0` `guarded` `needs-config` · Spec 10 C2, C6a · As: owner · Status: Verified
1. Settings → Payment Methods → Recurring Billing Run: set time and timezone, enable, save. 2. With an E2E enrolment due today, press **Run Now** twice.
**Expect:** one renewal charge; next billing date advances one period; usage / credits roll for the new period; a zero-price plan advances with no charge.
**Cross-check:** exactly one transaction for the period; the schedule is one row for this business (`GET /api/v1/pay/billing-schedule`).

### PAY-16 · Dunning: failure, retry, recovery, expiry
`P0` `guarded` `needs-config` · Spec 10 C6 · As: owner · Status: Verified
1. Give an E2E enrolment a declining method; make it due; **Run Now**. 2. Replace the method with a good card and trigger the retry (manual retry, or Run Now on the retry date). 3. On a second enrolment, let every retry fail.
**Expect:** step 1 records a failed transaction and opens a retry without advancing the period (the membership stays active while retries are open; there is no "past due" status); step 2 recovers: charge settles, period advances; step 3 ends with the membership expired once the schedule (default days 1, 3, 7) is exhausted. With the mock processor, which never declines, the failure is produced by removing the saved card.
**Cross-check:** while a dunning attempt is open, the renewal run does not charge the enrolment again; notices escalate (friendly, warning, final) in the notification queue; all events are in the audit log.
4. A paid membership whose customer has no card at all: Run Now. 5. Settings → Scheduled processes → billing process, run by hand with an end date past each retry date until the retries are used up. 6. Memberships report for today.
**Expect (Bill `ec3e319`):** step 4 is a failed renewal, not a skip: the membership shows "Past due" (status `renewing`), a retry opens with the reason "No payment method on file", and the customer's Timeline says the renewal failed; step 5: each run works through the retries due by its end date (the next retry is scheduled after that date); when they are used up the membership is expired, billing stops, and the Timeline says so; the customer card shows it as Expired; step 6 counts it under Expired. A free membership still renews without a card.

### PAY-17 · Transactions ledger and payments page reconcile
`P0` `regression` · Spec 10 C1 · As: owner · Status: Verified
1. For today, list `/payments` and `GET /api/v1/pay/transactions`; sum charges minus refunds for the run's E2E customers.
**Expect:** both sources hold the same rows and the same net; `/api/v1/payments/summary` agrees with the page totals.
**Cross-check:** the net equals today's change in the revenue report (suite 12) and the net of the day's journal entries to revenue accounts.

### PAY-18 · Payment permissions by role
`P0` `negative` · Spec 10 C4, design §13 · As: reception, therapist, customer · Status: Verified
1. As Staff: issue an invoice, void an invoice, create a gift card, create a voucher, change accepted methods, change the billing schedule.
2. As customer: list transactions, list gift cards, charge another customer's method.
**Expect:** every call refused (403), except that a customer listing payments or invoices gets only their own. Staff can still take a payment and read invoices (`bookings:update` / `bookings:read`).

### PAY-19 · Credit note (Adjustment, credit side)
`P0` `guarded` · Spec 10 C4/C5 (Bill `24e89e1`) · As: owner, Staff, another organisation · Status: Verified
1. Customer → Billing → **New Adjustment** → Credit: as Staff; without a reason; with no lines; then as owner, one 20.00 line with 4.20 tax.
2. Open its PDF; list the customer's credit notes; open it as another organisation's owner.
**Expect:** Staff refused (403); reason and at least one line required (400); the credit note gets a number and the customer's account credit rises by 24.20; the PDF opens; another organisation is refused.
**Cross-check:** journal 4100 debit 20.00, 2300 debit 4.20, 2500 credit 24.20 (posted at issue).

### PAY-20 · Debit note (Adjustment, debit side)
`P0` `guarded` · Spec 10 (Bill `24e89e1`) · As: owner, Staff · Status: Verified
1. **New Adjustment** → Debit: 10.00. 2. Open its PDF. 3. As Staff, try to issue one. 4. Open the customer's transaction history.
**Expect:** account credit falls by 10.00 (it may go negative); the PDF opens; Staff refused; both notes are in the transaction history.
**Cross-check:** journal 2500 debit 10.00, 4100 credit 10.00 (mirror of the credit note).

### PAY-21 · Gift card sold through checkout
`P0` `guarded` · Spec 10 C7 (Bill `9fbd978`, `147` tax setting) · As: owner, Staff · Status: Verified
1. Settings: read the gift-card tax setting; as Staff, try to change it. 2. Checkout: add a 50.00 gift card for a recipient (`.test` email), pay cash. 3. Look the card up by its code. 4. Run the Gift Cards report.
**Expect:** gift-card tax is off by default and only the owner may change it; no tax on the line; one card issued with a code and 50.00 balance, shown after payment; the lookup shows 50.00 active; the report lists the code.
**Cross-check:** the order's journal books the 50.00 as a liability (2600), not revenue.

### PAY-22 · Receipts: PDF and email
`P1` `regression` · Spec 10 Phase 6 (Bill `ceb942d`, `2605119`) · As: owner, Staff, another organisation · Status: Verified
1. Open the receipt PDF from the order and from the payment; load its fields. 2. Email the receipt. 3. Open it as another organisation.
**Expect:** both PDFs open and use the business's receipt template; the email is queued to the customer's (`.test`) address; another organisation is refused (403).

### PAY-23 · Document templates (branding)
`P1` `regression` · Spec 10 Phase 6 task 6.3a (Bill `1de7993`, `b81e763`) · As: owner, Staff, another organisation · Status: Verified
1. Business Setup → **Templates**: the document types list. 2. Create a Payment Receipt template (colour, footer text, footer link); as Staff, try to create one; try a `javascript:` footer link. 3. Edit its footer; list templates; edit it as another organisation. 4. Open a receipt PDF. 5. Delete the template.
**Expect:** the types include Appointment, Cancellation, New Customer, Adjustment, Payment Receipt, Refund Confirmation, Failed Payment, Renewal Reminder and Gift Card (others marked Coming Soon); the owner can create, edit and delete; **Duplicate** opens the editor with a copy (Bill `566320f`); Staff refused; a non-web link refused (400); another organisation refused; receipts still render. A branded email is sent from the template's reply-to address with the business's name (Bill `05a494c`; checked up to the queue only).

### PAY-24 · Membership renewal retries and reminder
`P1` `regression` · Spec 10 (Bill `3526e98`, `3d69af7`) · As: owner, Staff · Status: Verified
1. Settings → Membership Renewals: read the retry settings. 2. Save count 0, then interval 200 days, then count 4 / every 2 days / reminder 5 days before. 3. As Staff, read them.
**Expect:** out-of-range values refused (count 1–10, interval 1–90 days); the valid values are saved; Staff refused.
**Covered by PAY-16 since Bill `ec3e319`:** a renewal that fails and is retried on the saved schedule (the manual billing run's end date now drives the retries). **Not yet scripted:** the reminder email lead time.

### PAY-25 · Gift-card expiry
`P1` `regression` · Spec 10 C7 (Bill `143ef0a`, migration 156) · As: owner, Staff · Status: Verified
1. Settings: read the gift-card expiry; as Staff try to change it; try -1. 2. Set 365 days. 3. Sell three gift cards at checkout: one with the default date, one with another date, one with no expiry. 4. Set it back to 0.
**Expect:** 0 days (no expiry) by default; only the owner may change it; negative refused; the checkout line shows sale date + 365 days and the card gets it; a date set at the point of sale, or none, wins.
**Watch:** the default date is worked out in UTC, so a sale between midnight and 01:00/02:00 Madrid time could get a date one day early (not seen in this run).

### PAY-26 · Paying again with another card after a failed card payment
`P2` `regression` `needs-config` · Bill `143ef0a` · As: reception · Status: Draft
**Pre:** the business on Stripe test mode.
1. Checkout: pay an order with the Stripe test card that is declined. 2. Pay it again with a good test card. 3. Double-click Pay on the good card.
**Expect:** the second card is charged (the retry is not refused as a repeat of the first request); a double click charges once.
