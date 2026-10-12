# Suite 10 — Checkout & Customer Payments (spec 10 Section C)

Persona: owner / manager / reception as stated. Covers orders and checkout (spec 28 R8), one-time payments, stored methods, refunds, invoices, gift cards, vouchers, subscriptions, dunning and the ledger postings (spec 10 C1–C8, C6a). Delivered by Bill in the pull synced on 2026-10-12; its checkpoint (task 4.11) is open, so findings are likely. Conventions: [README](../README.md).

**Every script that moves money is `guarded`:** PRE-07 must have passed; act only on E2E customers. Take a reading of today's revenue and of the customer's balance before each script and compare after.

Method classes to keep in mind: **processed** (card, bank draw, wallets: charged through the processor), **manual-record** (cash, check, bank transfer, other: recorded only), **internal** (gift card).

---

### PAY-01 · Accepted payment methods drive what checkout offers
`P0` `regression` · Spec 10 R0.3; task 4.10 · As: owner, reception · Status: Draft
1. Settings → Payment Methods: note the accepted methods. Turn off "check"; save. 2. As reception, open the method picker at checkout and in **Record Payment**. 3. Restore.
**Expect:** the picker offers exactly the accepted methods; "check" is gone while off; processed methods appear only when the business has a processor connection and the customer has (or can add) a stored method.
**Cross-check:** `GET /api/v1/pay/available-methods` for a one-time context equals the picker; for a recurring context it contains only card and bank draw. Report KI-6 if a business has no accepted methods at all.

### PAY-02 · Build and edit an order
`P0` `regression` · Spec 28 R8 · As: reception · Status: Draft
1. At `/checkout` start an order for an E2E customer; add a service, a merchandise variant × 2, and a package; change a quantity; remove an item; change the customer.
**Expect:** subtotal, tax and total recalculate after each change and add up to the cent; an empty order cannot be completed.
**Cross-check:** `GET /api/v1/checkout/orders/{id}` holds the same lines and totals in integer cents.

### PAY-03 · Checkout from a booking
`P0` `regression` · Status: Draft
1. From a completed, unpaid booking, open checkout.
**Expect:** the order is pre-filled with the booking's service, variant and price and linked to the booking; paying it marks the booking as paid; a booking cannot be checked out twice.

### PAY-04 · Pay with a manual method
`P0` `regression` `guarded` · Spec 10 C1 · As: reception · Status: Draft
1. Complete an order by cash; another by bank transfer with a reference.
**Expect:** order completes; receipt at `/receipt/{id}` shows items, tax, total, method and a `PAY-…` reference; no processor call is made.
**Cross-check:** `/payments` and the customer's Billing tab list the transaction as not processed; the journal has Debit Cash 1100 / Credit Service Revenue 4100 for the amount.

### PAY-05 · Store a customer payment method
`P0` `guarded` `needs-config` · Spec 10 C3; task 4.5 · As: manager · Status: Draft
1. Customer detail → Overview → payment methods: add a test card; add a second; set default; remove one.
**Expect:** as BILL-03, at customer level: hosted fields, masked display, exactly one default.
**Cross-check:** the method was vaulted on the **business's** processor connection; the customer sees the same masked methods in their portal if exposed there; another business's staff cannot list them.

### PAY-06 · Pay with a stored card
`P0` `guarded` `needs-config` · Spec 10 C1 · Status: Draft
1. Complete an order choosing the customer's stored card. 2. Submit the same payment twice (double-click, then retry after reload).
**Expect:** one charge, status completed, with a processor reference; the booking is confirmed on success.
**Cross-check:** exactly one transaction row and one processor charge (idempotency); with a declining test card the order is **not** completed and the linked booking is released as designed.

### PAY-07 · Record Payment from the customer profile
`P1` `guarded` · Task 4.10 · As: reception · Status: Draft
1. Customer detail → **Record Payment**: 25.00 cash, with a note. Try 0.00 and a negative amount.
**Expect:** the payment is recorded and appears in the Billing tab; invalid amounts are refused. Reception (Staff, `bookings:update`) is allowed to take payments.

### PAY-08 · Refunds: full, partial, limits, permissions
`P0` `guarded` · Spec 10 C4 · As: manager, reception · Status: Draft
1. As reception, attempt a refund. 2. As manager: partial refund without a reason; partial with a reason; refund of more than the remainder; full refund of another payment (amount left blank).
**Expect:** reception is refused (403); a reason is required; over-refund is refused; processed charges are returned through the processor, manual ones are recorded only.
**Cross-check:** refund rows link to the original payment; the journal has reversals; a credit-note notification is queued; the audit log names the manager. JNY-07 covers the report side.

### PAY-09 · Invoices: enable, issue, number, PDF
`P0` `regression` · Spec 10 C5 · As: owner, manager · Status: Draft
1. Settings → Payment Methods: turn Invoicing on. 2. Customer Billing tab → **Issue Invoice**: two line items, due in 14 days. Issue a second invoice. 3. Open each PDF. 4. Turn Invoicing off and look for the Issue Invoice action.
**Expect:** invoices get consecutive numbers with no gap; totals = lines + tax; the PDF shows the business header and tax id, bill-to, lines, tax and total, matching the screen; with invoicing off the action is hidden and the API refuses to issue.
**Cross-check:** a failed issue attempt (for example with an empty line) does not consume a number.

### PAY-10 · Invoices: settle, void, email
`P0` `guarded` · Spec 10 C5 · As: manager · Status: Draft
1. Pay one invoice with a stored method (or the available method). 2. Void the other. 3. Email an invoice (customer address is a `.test` address).
**Expect:** the paid invoice becomes `paid` and leaves "outstanding"; the voided one cannot be paid; a paid invoice cannot be voided; email is queued without error.
**Cross-check:** the settlement appears in the ledger linked to the invoice and in the journal.

### PAY-11 · Gift cards: issue, look up, redeem partially, void
`P0` `guarded` · Spec 10 C7 · As: manager, reception · Status: Draft
1. Create a gift card of 100.00 for recipient `e2e-{RUN}-gift@daystream.test`. 2. At checkout pay a 30.00 order with the card code. 3. Pay a 90.00 order with it. 4. Void the card; try to use it.
**Expect:** the code has the form `GC-XXXX-XXXX`; balance 100.00 → 70.00; step 3 is refused or takes only the 70.00 balance with the remainder due by another method (record which); a voided or expired card is refused.
**Cross-check:** the card's history lists each redemption; a code from one business is not found in another; gift-card redemption is **not** posted as cash revenue in the journal.

### PAY-12 · Vouchers: free, fixed, percentage, limits
`P1` `guarded` · Spec 10 C8 · As: manager · Status: Draft
1. Create three vouchers: free service, fixed 15.00, 20 %; one of them single-use and limited to `E2E {RUN} Svc`. 2. Validate each against an 80.00 order; redeem the single-use one twice; apply the scoped one to a different service.
**Expect:** discounts are 80.00, 15.00 and 16.00; fixed never exceeds the order amount; second use and out-of-scope use are refused with a reason.
**Cross-check:** `POST /api/v1/pay/vouchers/validate` returns the same discount the checkout applies; redemption count increments once.

### PAY-13 · Discount code at checkout
`P1` `regression` · Spec 09 R5 · Status: Draft
1. Apply the code from OFF-15 to an order; remove it; apply an invalid code.
**Expect:** total drops and restores exactly; invalid code refused with a reason; a code and a promotion combine according to the stacking rules.

### PAY-14 · Void an order
`P1` `regression` `guarded` · Status: Draft
1. Void an open order. 2. Try to void a completed, paid order.
**Expect:** the open order is voided and frees anything it reserved; the paid one requires a refund first (or voids and refunds together: record which).

### PAY-15 · Subscription renewals run
`P0` `guarded` `needs-config` · Spec 10 C2, C6a · As: owner · Status: Draft
1. Settings → Payment Methods → Recurring Billing Run: set time and timezone, enable, save. 2. With an E2E enrolment due today, press **Run Now** twice.
**Expect:** one renewal charge; next billing date advances one period; usage / credits roll for the new period; a zero-price plan advances with no charge.
**Cross-check:** exactly one transaction for the period; the schedule is one row for this business (`GET /api/v1/pay/billing-schedule`).

### PAY-16 · Dunning: failure, retry, recovery, expiry
`P0` `guarded` `needs-config` · Spec 10 C6 · As: owner · Status: Draft
1. Give an E2E enrolment a declining method; make it due; **Run Now**. 2. Replace the method with a good card and trigger the retry (manual retry, or Run Now on the retry date). 3. On a second enrolment, let every retry fail.
**Expect:** step 1 records a failed transaction, opens a dunning attempt and marks the membership past due without advancing the period; step 2 recovers: charge settles, period advances, status active; step 3 ends with the membership expired once the schedule (default days 1, 3, 7) is exhausted.
**Cross-check:** while a dunning attempt is open, the renewal run does not charge the enrolment again; notices escalate (friendly, warning, final) in the notification queue; all events are in the audit log.
**Note:** if retry dates cannot be reached without waiting days, verify step 1 and the manual retry, and mark the expiry path `Blocked` with that reason.

### PAY-17 · Transactions ledger and payments page reconcile
`P0` `regression` · Spec 10 C1 · As: owner · Status: Draft
1. For today, list `/payments` and `GET /api/v1/pay/transactions`; sum charges minus refunds for the run's E2E customers.
**Expect:** both sources hold the same rows and the same net; `/api/v1/payments/summary` agrees with the page totals.
**Cross-check:** the net equals today's change in the revenue report (suite 12) and the net of the day's journal entries to revenue accounts.

### PAY-18 · Payment permissions by role
`P0` `negative` · Spec 10 C4, design §13 · As: reception, therapist, customer · Status: Draft
1. As Staff: issue an invoice, void an invoice, create a gift card, create a voucher, change accepted methods, change the billing schedule.
2. As customer: list transactions, list gift cards, charge another customer's method.
**Expect:** every call refused (403). Staff can still take a payment and read invoices (`bookings:update` / `bookings:read`).
