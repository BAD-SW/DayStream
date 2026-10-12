# Suite 07 — Offerings & Pricing

Persona: owner unless stated. Covers spec 06 (services), 08 (membership plans), 09 (pricing rules, discount codes, tax), 28 (merchandise, packages, promotions) under `/offers`. Each script cross-checks into the place where the offering is sold or priced. Conventions: [README](../README.md).

---

### OFF-01 · Category CRUD
`P1` `regression` · Spec 06 R2 · Status: Verified
1. At `/offers/categories` create `E2E {RUN} Cat A`; rename; reorder if supported; delete an empty category; try to delete one that has services.
**Expect:** changes reflected in the Offerings filter; deleting a non-empty category is refused or requires reassigning.

### OFF-02 · Service CRUD and lifecycle
`P0` `regression` · Spec 06 R1 · Status: Verified
1. Create `E2E {RUN} Svc` (description, category, location). 2. Edit. 3. Add a variant and activate; pause; activate; archive; restore.
**Expect:** every state is shown on the list and detail page; a paused or archived service cannot be booked (booking form, customer flow, widget) and its existing bookings are untouched.
**Cross-check:** `GET /api/v1/catalog/{businessSlug}` lists the service only while active.

### OFF-03 · A service cannot go live without a variant
`P0` `negative` · Spec 06 R4; design decision 7 · Status: Verified
1. Create a service with no variant; activate it. 2. Add a variant, activate, then delete its only variant.
**Expect:** step 1 refused with a clear message; step 2's deletion is refused, or the service drops out of the active state.

### OFF-04 · Variants: duration and price
`P0` `regression` · Spec 06 R4 · Status: Verified
1. Add variants 30 min / 45.00 and 60 min / 80.50. Edit the second to 82.00. Enter an invalid price (negative, text, three decimals).
**Expect:** prices show as currency everywhere; invalid input refused.
**Cross-check:** the API returns prices as integer cents (4500, 8200); the booking form offers slot lengths matching each duration; existing bookings keep the price they were booked at after the edit.

### OFF-05 · Service images
`P2` `regression` · Spec 06 R5 · Status: Draft
1. Upload two images, set one as primary, delete the other. Upload a non-image file.
**Expect:** primary image shows on the list card and in the widget; the non-image is refused.

### OFF-06 · Cancellation policy applies to bookings
`P1` `regression` · Spec 06 R7 · Status: Verified
1. Create a policy "24 h notice, 50 % fee"; attach it to `E2E {RUN} Svc`.
2. Book it for 3 hours from now and cancel; book it for 3 days from now and cancel.
**Expect:** the late cancellation states the 50 % fee (or is refused per the policy); the early one is free.

### OFF-07 · Service availability rules
`P1` `regression` · Spec 06 R10 · Status: Verified
1. Add a rule: only Mon–Wed 14:00–18:00. Edit it; delete it.
**Expect:** with the rule, slots exist only inside it even though the provider and location are open longer; the rule and the provider's pattern intersect (the narrower one wins).

### OFF-08 · Service templates
`P2` `regression` · Spec 06 R9 · Status: Verified
1. Apply a template to create a service.
**Expect:** the new service arrives pre-filled, in draft, editable; it still needs a variant before activation if the template has none.

### OFF-09 · Tax category flows into price calculation
`P0` `regression` · Specs 06 R11, 09 R9 · Status: Verified
1. Create tax category "E2E {RUN} VAT 21 %"; assign it to `E2E {RUN} Svc` (80.00).
2. Price the service through checkout.
**Expect:** the breakdown shows net, tax and total consistent with whether prices are tax-inclusive in this business; totals add up to the cent.
**Cross-check:** `POST /api/v1/pricing/calculate` returns the same breakdown; the receipt and the invoice PDF show the same tax line.

### OFF-10 · Merchandise with variants and stock state
`P1` `regression` · Spec 28 R2 · Status: Verified
1. At `/offers` create merchandise `E2E {RUN} Towel` with variants (size S / L, different prices); add an image; pause; activate; archive; restore.
**Expect:** the product is sellable at checkout only while active; each variant carries its own price.
**Cross-check:** adding the product to an order at `/checkout` uses the variant price.

### OFF-11 · Membership plan configuration
`P0` `regression` · Spec 08 R1, R9 · Status: Verified
1. Create plan `E2E {RUN} Plan`: monthly, 60.00, includes 4 × `E2E {RUN} Svc`. Edit the included items; pause; activate; archive.
**Expect:** the plan can be sold only while active; included items are listed with quantities.
**Cross-check:** `/memberships/plans` and the Offerings memberships tab show the same plan; JNY-05 covers selling and renewing it.

### OFF-12 · Package configuration
`P1` `regression` · Spec 28 R4 · Status: Verified
1. Create package `E2E {RUN} Pack` with two different services × 2 each, price 250.00; edit an item quantity; pause; activate; archive.
**Expect:** item list and price persist; a paused package is not purchasable. JNY-06 covers purchase and redemption.

### OFF-13 · Promotion with a validity window (used through its code at checkout)
`P1` `regression` · Specs 28 R6, 09 R4 · Status: Verified
1. Create promotion `E2E {RUN} Promo`: 20 % off `E2E {RUN} Svc`, valid from today for 7 days. Activate. Then create one that starts tomorrow.
**Expect:** today's price for the service is 20 % lower in the booking form and at checkout, with the promotion named in the breakdown; the future promotion does not apply yet; pausing the promotion restores the base price.

### OFF-14 · Pricing rules: priority and stacking
`P0` `regression` · Spec 09 R2, R3 · Status: Verified
1. At `/pricing/rules` create rule A (off-peak, −10 %, priority 1) and rule B (first-time customer, −15.00, priority 2), with stacking off. 2. Turn stacking on.
**Expect:** with stacking off only the higher-priority rule applies; with stacking on both apply in the defined order; the price never goes below zero.
**Cross-check:** `POST /api/v1/pricing/calculate` lists each applied rule and amount; `GET /api/v1/pricing/history` records the rule changes.

### OFF-15 · Discount codes: limits and validation
`P0` `regression` · Spec 09 R5 · Status: Verified
1. At `/pricing/codes` create `E2E{RUN}10` (10 %, max 1 use, expires tomorrow) and an already-expired code. Bulk-generate 5 codes.
2. Apply `E2E{RUN}10` to an order and complete it; apply it to a second order. Apply the expired code. Apply a code in different letter case.
**Expect:** first use accepted and discount shown; second use refused (limit reached); expired code refused with a reason; case handling is consistent.
**Cross-check:** the code's usage count is 1; removing the promo from an open order restores the full price.
