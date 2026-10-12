# Suite 05 — Billing Layers A & B (platform → tenant, tenant → business)

Covers spec 10 Section 0 (provider abstraction, tokenised methods), Section A (platform billing) and Section B (tenant billing). This is money-handling code that Bill delivered in the pull synced on 2026-10-12; Section B's own checkpoint (task 3.6) is still open, so findings are likely. Conventions: [README](../README.md).

**Every script here is `guarded`.** PRE-07 must have passed. Act only on the E2E tenant and E2E business created by JNY-01 / SYS-01 / TEN-01. Amounts are entered as currency and stored as integer cents.

Charging model to keep in mind: a method is vaulted and charged on the **charging party's** processor account. A tenant's card lives under the platform's connection; a business's card under its tenant's; a customer's card under its business's.

---

## Section 0 — processors and stored methods

### BILL-01 · Configure a processor at platform level
`P0` `needs-config` · Spec 10 R0.1, R0.4; tasks 1.8, 1.9 · As: system · Status: Verified
1. `/admin/config` → Payment Processors. Choose the provider; fill mode `test`, publishable key, secret key, webhook secret. Press **Test connection**, then save. Reload.
**Expect:** required fields are marked and enforced; Test connection reports success and the mode; after reload secret fields are masked; saving again with blank secrets keeps them.
**Cross-check:** `GET /api/v1/pay/processors/config` never returns a secret in clear; the browser did not autofill the admin's email or password into a credential field.
**Without Stripe test keys:** verify the form, validation and masking with the mock provider and mark the live connection part `Blocked`.

### BILL-02 · Test connection catches wrong credentials
`P1` `negative` `needs-config` · Task 1.9 · As: system · Status: Verified
1. Enter a live-prefixed key with mode `test`; a malformed secret key; a wrong publishable key. Press **Test connection** each time without saving.
**Expect:** a specific error each time (mode / key mismatch, invalid key, publishable key rejected); nothing is saved.

### BILL-03 · Add, default and remove a stored card
`P0` `needs-config` · Spec 10 R0.5; tasks 1.3, 1.7 · As: system · Status: Verified
1. E2E tenant → Settings → Payment Source: add test card 4242…; add a second test card; set the second as default; remove the first.
**Expect:** the card fields are the processor's hosted fields (card data is typed into the processor's frame, not a DayStream input); each card shows brand, last 4 and expiry only; the first card added becomes default automatically; exactly one default at any time.
**Cross-check:** `GET /api/v1/pay/methods` for the tenant returns masked data and no token; a read-only query on `pay_payment_methods` shows a provider token and no card number.

### BILL-04 · Bank draw scheme follows the billing currency
`P1` `needs-config` · Tasks 1.10, 1.11 · As: system · Status: Verified
1. For a EUR tenant choose bank draw: the SEPA form (IBAN, account holder, mandate text to accept). Add the test IBAN.
2. For a USD tenant choose bank draw: the ACH form (routing, account, holder type, mandate).
3. For a tenant in a currency with no implemented scheme (GBP → Bacs).
**Expect:** the form matches the currency in steps 1–2 and cannot be confirmed without accepting the mandate; step 3 shows a clear "not supported" message (HTTP 422), not a SEPA form.

---

## Section A — platform bills tenants

### BILL-05 · Save a platform billing plan and version it
`P0` · Spec 10 A1 · As: system · Status: Verified
1. E2E tenant → Billing tab. Save: flat 100.00, percentage 2.5 %, cap 500.00 applying to percentage, intro period 2 months at flat 10.00, billing day 15, plan start date today.
2. Change the flat amount to 120.00 and save again.
**Expect:** both saves succeed; amounts display as currency; invalid input is refused (negative amounts, percentage above 100, billing day outside 1–31).
**Cross-check:** `GET /api/v1/pay/platform-billing/{tenantId}/plan-history` shows two versions, the first ended; the Audit Trail shows the flat amount 100.00 → 120.00.
**Note (KI-3):** percentage of net collections computes on zero until the feed is built; this script asserts the flat and intro parts only.

### BILL-06 · Intro period, credits and "Charge now" arithmetic
`P0` · Spec 10 A1, A3, A4 · As: system · Status: Verified
**Pre:** BILL-03 (a default method) and BILL-05.
1. Issue a credit of 4.00 (reason required: try without one first).
2. **Charge now** for a cycle inside the intro period.
3. Issue a credit of 500.00. **Charge now** for the next cycle.
**Expect:** credit without a reason is refused; step 2 charges 6.00 (intro flat 10.00 − 4.00); step 3 records a zero-amount charge, attempts no card transaction, and the unused credit carries forward (remaining balance shown).
**Cross-check:** Charge History itemises flat, credit applied, amount charged for each cycle; credits are drawn oldest first; no charge is ever negative.

### BILL-07 · A cycle is charged once only
`P0` `negative` · Spec 10 A3 · As: system · Status: Verified
1. Press **Charge now** twice quickly for the same cycle; then once more after reload.
**Expect:** exactly one charge row for that tenant and cycle; no second transaction at the processor.

### BILL-08 · A declined charge is recorded and retried, never merged
`P0` `needs-config` · Spec 10 A3 · As: system · Status: Verified
1. Make the tenant's default method one that declines (Stripe test decline card, or the mock adapter's forced decline). **Charge now** for a new cycle.
2. Replace the default with a good card. Press **Run now** on `/admin/processes`.
**Expect:** step 1 leaves the charge `failed` with a reason; step 2 retries that same row and it becomes settled; it is not combined with another cycle's charge.
**Cross-check:** Billing Activity shows two attempts for the charge (failed, then settled), each linked to its run; the failed-charge report listed it between steps 1 and 2.

### BILL-09 · Platform billing run: schedule, run now, suspended tenants skipped
`P0` · Spec 10 A3, A6 · As: system · Status: Verified
1. On `/admin/processes` set the run time and timezone, enable, save. 2. Suspend the E2E tenant. 3. **Run now**. 4. Activate the tenant.
**Expect:** the run finishes with a summary (new, retries, settled, pending, failed, skipped); the suspended tenant gets no charge; running again the same day creates no duplicates.
**Cross-check:** the run appears in `/admin/system-reports` → Billing Activity; clicking it lists exactly the charges that run attempted.
**Caution:** "Run now" covers every active tenant whose billing day is today, including seeded ones. It is safe only in mock or Stripe test mode (PRE-07).

### BILL-10 · The tenant sees what it was charged
`P1` · Spec 10 A5 · As: the E2E tenant owner · Status: Verified
1. Open `/admin/billing`.
**Expect:** the charges from BILL-06 to BILL-08 with the same amounts, cycles and statuses the system admin sees; the tenant can update its own payment method; it cannot edit its plan or issue itself credits.
**Cross-check:** `PUT /api/v1/pay/platform-billing/{tenantId}/plan` as tenant returns 403.

---

## Section B — tenants bill businesses

### BILL-11 · Tenant configures its own processor and receiving account
`P0` `needs-config` · Spec 10 B; task 3.5 · As: tenant · Status: Verified
1. `/admin/tenant-settings` → Payment Processors: configure and **Test connection**. → Business Billing: save receiving bank details.
**Expect:** same behaviour as BILL-01, at tenant level, independent of the platform's configuration (changing one does not change the other).

### BILL-12 · Business billing plan, credit and charge
`P0` · Spec 10 B1, B3, B4, B5 · As: tenant · Status: Verified
1. `E2E {RUN} Biz` → Billing tab: save plan flat 30.00, billing day 1. Add a payment method for the business. Issue a credit of 5.00.
2. **Charge now** for last month; press again.
**Expect:** one charge of 25.00, settled, itemised; no duplicate.
**Cross-check:** the business's Charge History and Audit Trail tabs show it; the charge was made on the **tenant's** processor connection, not the platform's (check the connection reference on the attempt, or the Stripe test dashboard of the tenant account).

### BILL-13 · Tenant billing run and activity report
`P1` · Spec 10 B3, B6 · As: tenant · Status: Verified
1. `/admin/tenant-processes`: set schedule, save, **Run now**.
2. `/admin/tenant-reports` → Billing Activity: open the run.
**Expect:** the run covers only this tenant's businesses; archived businesses are skipped; the drill-down lists the attempts of that run.

### BILL-14 · The business owner sees its charges but cannot change its plan
`P1` `negative` · Spec 10 B5 · As: the E2E business owner · Status: Verified
1. Look for the tenant's charges in the business's settings / billing area. 2. `PUT /api/v1/pay/tenant-billing/{businessId}/plan` as the business owner.
**Expect:** charges visible read-only where the product exposes them (record where on first run); step 2 returns 403.

### BILL-15 · Layers do not leak into each other
`P0` `negative` · Spec 10 design §13 · As: tenant, owner · Status: Verified
1. As tenant: call the platform endpoints for another tenant (`/pay/platform-billing/{otherTenantId}/charges`, `/credits`, `/charge-now`).
2. As a business owner: call `/pay/tenant-billing/{siblingBusinessId}/charges` and `/pay/platform-billing-runs`.
**Expect:** 403 / 404 for all; no amounts or card data returned.

### BILL-16 · Webhook endpoint verifies signatures
`P0` `negative` · Spec 10 R0.1; task 2.2 · Status: Verified
1. `POST /api/v1/pay/webhooks/stripe` with a well-formed event body and (a) no signature, (b) a wrong signature.
**Expect:** both rejected (4xx); no charge row changes status.
**Cross-check:** with the mock provider, a correctly signed `charge.succeeded` for a `pending` charge flips it to settled (run only if the mock's signing secret is available locally; otherwise `Blocked`).
