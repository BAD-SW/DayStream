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

## Wave 1 — Foundation + Money ✅ Complete

> Shared engine + Customers, Payment Methods, Account Balances, and the Data Migration page (Business Setup tab + tenant entrance) built and verified. Two small follow-ups left unchecked: optional raw-file stash (deferred to async processing) and a dedicated per-balance-import ledger-effect warning in the UI.

### 1. Shared Import Engine

#### 1.1 File parsing (CSV + Excel)
- [x] ✅ Server-side `.xlsx` parser (SheetJS `xlsx@0.20.3` from the official CDN tarball — the npm-registry build is stale/insecure), first worksheet as a raw grid (no header assumption)
- [x] ✅ Keep/confirm the CSV parser; converge both to `{ grid: string[][] }`, cells as strings
- [x] ✅ Upload via multer memory storage with a 10 MB limit
- [ ] Optional stash of the raw file via `storage` under `imports/{tenantId}/{businessId}/{runId}` — deferred (not needed for the synchronous first increment; revisit with async/large-file processing in §10)

#### 1.2 Automatic detection
- [x] ✅ `detectHeaderRow(grid)` — classify row 0 vs rows below → `{ hasHeader, confidence }`; confirm/override toggle in the UI
- [x] ✅ `detectColumns(grid, hasHeader, fields)` — name-based (synonym table) and value-based (shape inference) identification; value-based backstops unmatched headers; pure + unit-tested
- [x] ✅ Leave ambiguous/unknown columns unmapped and flagged

#### 1.3 Reference matching
- [x] ✅ Unified customer matching (shared by all customer-associated imports): Legacy Customer ID when present (exact, preferred), else Identity Service (email, then unique phone); unmatched → failed (never create a customer)
- [ ] Name matchers (normalized): plan and package done (Wave 2); service and staff pending (Wave 3)
- [x] ✅ Reference resolution runs in the trial so unmatched refs surface pre-commit

#### 1.4 Forgiving pipeline + trial/commit
- [x] ✅ Per-row outcome classifier: imported / matched / failed with reason
- [x] ✅ Partial success: import all valid rows regardless of invalid rows
- [x] ✅ `trial` runs the full pipeline and writes NOTHING; returns the COMPLETE failure list; records `is_trial=true`
- [x] ✅ `commit` writes; records `is_trial=false`; trial and commit share one pipeline
- [x] ✅ Failed-rows download (client builds a CSV of row + field + reason)

#### 1.5 Run history
- [x] ✅ Migration 157: `mig_import_runs` (tenant/business, entity, file name, counts, status, `is_trial`, performed_by, timestamps) + index; applied
- [x] ✅ Record a run on both trial and commit; endpoints to list recent runs (flagged) and read one

#### 1.6 No emails from imports
- [x] ✅ Customers: `findOrCreatePerson` source `import` already skips the welcome email (verified: 0 queued). Wave-1 entities (payment methods, account balances) send no notifications on their create paths. Per-entity suppression for booking confirmation / renewal / dunning is enforced as those entities land in Wave 2/3.

### 2. Customer Import
- [x] ✅ Customer rows via `findOrCreatePerson` (source `import`): first/last name, email, phone, DOB, gender, language, country; tags (find-or-create + assign); notes → timeline activity; joined → `created_at`
- [x] ✅ Capture + store each customer's legacy id (migration 157 added `cus_customers.legacy_customer_id`); fill-empty, never overwrite
- [x] ✅ `created` → imported; matched existing → matched (fill-empty only); idempotent re-run (verified: no duplicate)

### 3. Payment Method Import (processor Mapping File)
- [x] ✅ Consume the Mapping File (legacy customer id → migrated Stripe Customer id + payment-method token)
- [x] ✅ Match each row to a customer by legacy id (fallback email/phone); unmatched → failed
- [x] ✅ Record the migrated Stripe Customer id into `pay_customer_refs`; store the token in `pay_payment_methods`; first → default; idempotent on token
- [x] ✅ No raw card data. (Mapping/recording verified via smoke test with a synthetic token; a real Stripe migrated token proves the off-session charge end-to-end during live validation.)

### 4. Account Balance Import
- [x] ✅ Account credit → drawable `pay_account_credits` via `issueCreditNote` (live; posts to ledger). Verified: €25.00 → 2500 cents available.
- [x] ✅ Outstanding invoice → issued `pay_invoices` via new `issueImportedInvoice` (accepts original `issue_date` + already-paid amount; status derived)
- [x] ✅ Unmatched customer → failed; row kind (credit/invoice) from a `type` field with a sensible fallback
- [ ] Surface the ledger effect in the UI (avoid double-counting with accounting opening balances) — page intro notes it; a dedicated per-balance-import warning is a small follow-up

### 5. API
- [x] ✅ `POST /v1/import/:kind/analyze|trial|commit` and `GET /v1/import/runs[/:id]`, `:kind` = customers | payment_methods | account_balances (Wave 1 set)
- [x] ✅ Gated `settings:*` (owner/manager — reception/staff hold `customers:*` but not `settings:*`); business-scoped
- [x] ✅ Legacy `/v1/customers/import[/validate]` left intact server-side (harmless); the client `/customers/import` route redirects to the Data Migration tab (a server-side alias was unnecessary since the client flow is fully replaced)

### 6. Data Migration Page
- [x] ✅ `DataMigration.tsx` — one component scoped to `businessId`; the three Wave-1 imports with prerequisites hinted; recent runs (trial vs committed) below
- [x] ✅ Shared three-step flow (upload → review/trial → done), customer flow reworked from `CustomerImport.tsx`
- [x] ✅ Business entrance: "Data Migration" tab on `/business` (added to VALID_TABS + label + render); no new sidebar module
- [x] ✅ Tenant entrance: same component as a tab in `TenantBusinesses.tsx` per-business view
- [x] ✅ Remove the People "Import CSV" button; `/customers/import` redirects to `/business?tab=migration`
- [x] ✅ Design-system + CSS variables; businessId from hosting context

### 7. Wave 1 verification
- [x] ✅ Customers: CSV with header + value-based (headerless) detection unit-tested; clean rows import, messy rows reported; re-run → no duplicates (verified)
- [x] ✅ Trial writes nothing (verified), returns the full report, records a flagged run
- [x] ✅ Payment methods: Mapping File joins by legacy id, `pay_customer_refs` recorded, default set (verified with a synthetic token)
- [x] ✅ Account credit shows a drawable balance (verified 2500 cents); outstanding invoice path issues with original date via `issueImportedInvoice`
- [x] ✅ No emails sent (verified 0 welcome queued); server tsc 0, client tsc at baseline; 9 `import-engine` unit tests pass

---

## Wave 2 — Recurring + Prepaid

### 8. Membership Import
- [x] ✅ Rows: customer (match), plan (match by normalized name; ambiguous or non-active plan → failed), next billing date, status (blank/active, paused, cancelled; unknown → failed)
- [x] ✅ Migration 161: `source` CHECK on `mbr_enrollments` and `pkg_purchases` widened to include `'import'`; applied
- [x] ✅ Write `mbr_enrollments` directly (source `import`); period end = day before next billing date, period start = one billing frequency earlier; auto-link the customer's default payment method; seed `mbr_usage` for the current period
- [x] ✅ No default method → imported active with a WARNING (first renewal enters the existing dunning flow); next billing date in the past → WARNING
- [x] ✅ Unmatched customer/plan → failed; idempotent per (customer + plan); no renewal/dunning email at import
- [x] ✅ Optional `warnings` on the import result (rows imported but needing attention), shown in the trial and done views with a download

### 9. Package Import
- [x] ✅ Rows: customer (match), package (match by normalized name), original purchase date
- [x] ✅ Insert `pkg_purchases` directly (source `import`); purchase stored at 12:00Z; `expires_at` computed from the package policy (days / weeks / months) relative to the purchase date
- [x] ✅ Already-expired package → imported with a WARNING; archived package definitions accepted
- [x] ✅ No utilization in the file (fulfillment derived in Wave 3)
- [x] ✅ Unmatched customer/package → failed; idempotent per (customer + package + purchase date)

### 10. Wave 2 verification
- [ ] Membership with a payment method bills normally going forward (link verified; an actual renewal run against an imported enrolment not yet exercised)
- [x] ✅ Membership without a method is imported active and not charged by the import (warning raised)
- [x] ✅ Trial writes nothing (verified); commit creates active, paused and cancelled enrolments; re-run → matched, no duplicates (verified live)
- [x] ✅ Package purchase imported with correct original date/expiry (60-day window → purchase + 60 days); re-run → no duplicate (verified live)
- [x] ✅ No emails: notification queue unchanged across trial, commit and re-run
- [x] ✅ Server tsc clean; client tsc clean for the touched files; Business tab uses `activeContext.businessId`

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

**Status**: � In Progress — Wave 1 ✅ complete (foundation + money); Wave 2 (memberships, packages) built, renewal run on an imported enrolment still to verify; Wave 3 (appointments, transactions) planned
**Dependencies**: Phase 46, Phase 05, Phase 10, Phase 08, packages, business setup

