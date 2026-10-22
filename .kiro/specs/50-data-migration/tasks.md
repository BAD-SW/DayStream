# Phase 50: Data Migration - Tasks

## Overview

Tasks implement the shared import engine and per-entity imports described in design.md, grouped into three independently-shippable waves that respect the locked migration order and its two hard dependencies (Payment Methods before Memberships; Packages before Appointments). The guiding constraint throughout: migration must stay simple enough that it never becomes a reason a business walks away.

Waves:
- **Wave 1 — Foundation + money**: the shared engine + Customers, Payment Methods, Account Balances, and the Data Migration page.
- **Wave 2 — Recurring + prepaid**: Memberships, Packages.
- **Wave 3 — Activity**: Appointments (future bookings + history + package-fulfillment derivation), Transaction History.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## Wave 1 — Foundation + Money

### 1. Shared Import Engine

#### 1.1 File parsing (CSV + Excel)
- [ ] Server-side `.xlsx` parser (SheetJS), first worksheet as a raw grid (no header assumption)
- [ ] Keep/confirm the CSV parser; converge both to `{ grid: string[][] }`, cells as strings
- [ ] Upload via multer memory storage with a size limit; optional stash via `storage` under `imports/{tenantId}/{businessId}/{runId}`

#### 1.2 Automatic detection
- [ ] `detectHeaderRow(grid)` — classify row 0 vs rows below → `{ hasHeader, confidence }`; confirm/override in the UI
- [ ] `detectColumns(columns, sampleRows, hasHeader)` — name-based (synonym table) and value-based (shape inference) identification; value-based backstops unmatched headers; pure + unit-testable
- [ ] Leave ambiguous/unknown columns unmapped and flagged

#### 1.3 Reference matching
- [ ] Unified customer matching (shared by all customer-associated imports): Legacy Customer ID when present (exact, preferred), else Identity Service (email, then unique phone); unmatched → failed (never create a customer)
- [ ] Name matchers (normalized) for service, staff, plan, package — used by later waves; unmatched → failed with the value named
- [ ] Reference resolution runs in the trial so unmatched refs surface pre-commit

#### 1.4 Forgiving pipeline + trial/commit
- [ ] Per-row outcome classifier: imported / matched / failed with reason
- [ ] Partial success: import all valid rows regardless of invalid rows
- [ ] `trial` runs the full pipeline and writes NOTHING; returns the COMPLETE failure list; records `is_trial=true`
- [ ] `commit` writes; records `is_trial=false`; trial and commit share one pipeline
- [ ] Failed-rows download (original row + `__reason`)

#### 1.5 Run history
- [ ] Migration: `mig_import_runs` (tenant/business, entity, file name, counts, status, `is_trial`, performed_by, timestamps) + index; `npm run migrate:dev`
- [ ] Record a run on both trial and commit; endpoints to list recent runs (flagged) and read one

#### 1.6 No emails from imports
- [ ] Ensure the import commit path suppresses notifications for every entity (welcome, booking confirmation, receipts, renewal/dunning) — via the `import` source special-case or a notifications-off create path

### 2. Customer Import
- [ ] Customer rows via `findOrCreatePerson` (source `import`): first/last name, email, phone, DOB, gender, language, country, notes, tags, join date
- [ ] Capture + store each customer's legacy/external id (for joining the payment-method Mapping File later); add storage if no field exists
- [ ] `created` → imported; matched existing → matched (fill-empty only, never overwrite); idempotent re-run

### 3. Payment Method Import (processor Mapping File)
- [ ] Consume the processor Mapping File (legacy customer id → migrated Stripe Customer id + payment-method token)
- [ ] Match each row to a customer by legacy id (fallback email); unmatched → failed
- [ ] Record the migrated Stripe Customer id into `pay_customer_refs`; store the token in `pay_payment_methods`; first → default
- [ ] Verify an off-session charge against an imported method succeeds (Stripe recognizes the attached Customer); no raw card data

### 4. Account Balance Import
- [ ] Account credit → drawable `pay_account_credits` via the credit-note/account-credit mechanism (live; posts to ledger)
- [ ] Outstanding invoice → issued `pay_invoices` via an import-aware issue path accepting original `issue_date` + already-paid amount
- [ ] Surface the ledger effect in the UI (avoid double-counting with accounting opening balances)
- [ ] Unmatched customer → failed

### 5. API
- [ ] `POST /v1/import/:kind/analyze|trial|commit` and `GET /v1/import/runs[/:id]`, `:kind` across all entities
- [ ] Gate owner/manager-level; business-scoped
- [ ] Legacy `/v1/customers/import[/validate]` aliases to kind=customers (`/validate`→trial, `/import`→commit)

### 6. Data Migration Page
- [ ] `DataMigration.tsx` — one component scoped to `businessId`; entity flows in locked order with prerequisites hinted; recent runs (trial vs committed) below
- [ ] Shared three-step flow (upload → review/trial → done) reworked from `CustomerImport.tsx`
- [ ] Business entrance: "Data Migration" tab on `/business` (VALID_TABS + label + render), owner/manager-gated, no new sidebar module
- [ ] Tenant entrance: same component from `TenantBusinesses.tsx` per-business view
- [ ] Remove the People "Import CSV" button; redirect `/customers/import` to the tab
- [ ] Design-system + CSS variables; businessId from hosting context

### 7. Wave 1 verification
- [ ] Customers: CSV + `.xlsx`, headered + headerless; clean rows import, messy rows reported; re-run → no duplicates
- [ ] Trial writes nothing, returns full report, records a flagged run
- [ ] Payment methods: Mapping File joins by legacy id, `pay_customer_refs` recorded, a default set, and an off-session test charge against an imported method succeeds
- [ ] Account credit shows a drawable balance; outstanding invoice shows correct outstanding with original date
- [ ] No emails sent; server + client type-check clean; tests for `detectHeaderRow`, `detectColumns`, the outcome classifier

---

## Wave 2 — Recurring + Prepaid

### 8. Membership Import
- [ ] Rows: customer (match), plan/level (match by name), next billing date, status (default active)
- [ ] Write `mbr_enrollments`; auto-link the customer's default payment method
- [ ] No default method → active but NOT auto-charged (reuse the renewal/dunning "needs a payment method" behavior)
- [ ] Unmatched customer/plan → failed; idempotent per (customer + plan); no renewal/dunning email at import

### 9. Package Import
- [ ] Rows: customer (match), package (match by name), original purchase date
- [ ] Insert `pkg_purchases` directly to preserve purchase date + expiry window (not via `purchasePackage`, which dates from now)
- [ ] No utilization in the file (fulfillment derived in Wave 3)
- [ ] Unmatched customer/package → failed; idempotent per (customer + package + purchase date)

### 10. Wave 2 verification
- [ ] Membership with a payment method bills normally going forward; without one is active but never auto-charged by the import
- [ ] Package purchase imported with correct original date/expiry; re-run → no duplicate
- [ ] No emails; type-check clean

---

## Wave 3 — Activity

### 11. Appointment Import
- [ ] Rows: customer (match), service (match), staff (match, optional), date/time, status
- [ ] Future → real `apt_bookings` via the booking path, created WITHOUT notifications; NO availability/staff/hours/capacity validation at import (conflicts accepted; constraints only on later edit)
- [ ] Past → `cus_activities` timeline entry (activityType `booking`), no `apt_bookings`, no availability impact
- [ ] Unmatched customer/service → failed; idempotent per (customer + service + start time)

### 12. Package fulfillment derivation
- [ ] When importing a past/completed appointment, check for a qualifying imported package purchase (same customer, service the package covers, within validity window) and insert the corresponding `pkg_redemptions` row
- [ ] Define the selection rule when multiple packages qualify (e.g. oldest active covering package first); never over-redeem

### 13. Transaction History Import
- [ ] Rows: customer (match), date, amount (integer cents), description, method (optional), reference (optional)
- [ ] Write `cus_activities` only (activityType `payment`, `imported: true`); NEVER `pay_transactions`/GL/revenue/reporting (the key safety property)
- [ ] Unmatched customer → failed; idempotent per (customer + date + amount + reference)

### 14. Wave 3 verification
- [ ] Future appointment is an editable live booking; past appointment is timeline-only and doesn't affect availability/capacity
- [ ] A past completed appointment against an imported package creates a redemption; remaining balance reflects it
- [ ] Transaction history appears on the timeline AND nothing lands in `pay_transactions`/GL/reporting
- [ ] No emails; full locked-order run-through for a sample business; type-check clean

---

**Status**: 📋 Planned
**Dependencies**: Phase 46, Phase 05, Phase 10, Phase 08, packages, business setup
