# Phase 50: Data Migration - Tasks

## Overview

Tasks implement the shared import engine and per-entity imports described in design.md, grouped into three independently-shippable waves that respect the locked migration order and its two hard dependencies (Payment Methods before Memberships; Packages before Appointments). The guiding constraint throughout: migration must stay simple enough that it never becomes a reason a business walks away.

Waves:
- **Wave 1 — Foundation + money**: the shared engine + Customers, Payment Methods, Account Balances, and the Data Migration page.
- **Wave 2 — Recurring + prepaid**: Memberships, Packages.
- **Wave 3 — Activity**: Appointments (future bookings + history + package-fulfillment derivation), Transaction History.
- **Wave 4 — Intelligent detection & row repair**: profile-based column detection, id-pattern + name-dictionary + date-role inference, confidence scoring in the review UI, and realignment of shifted rows (Requirement 17). A cross-cutting upgrade to the shared engine that benefits every entity.

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
- [x] ✅ Name matchers (normalized) for service, staff, plan, package (Waves 2-3)
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
- [x] ✅ Rows: customer (match), service (match by name), staff (match by name, optional), date, time (optional), duration (optional), status
- [x] ✅ Migration 162: `source` CHECK on `apt_bookings` widened to include `'import'`; applied
- [x] ✅ Future → real `apt_bookings` (status `confirmed`, source `import`) inserted directly; NO notifications and NO availability/staff/hours/lead-time/capacity validation (conflicts accepted; constraints only on later edit); variant chosen by stated duration else first active; `booking_type` from the service; reference via `generate_booking_reference`
- [x] ✅ Past → `cus_activities` timeline entry (activityType `booking`, `imported: true`), backdated to the appointment time; no `apt_bookings`, no availability impact
- [x] ✅ Unmatched/ambiguous service or staff → failed; unmatched customer → failed; idempotent per (customer + service + start time)

### 12. Package fulfillment derivation
- [x] ✅ On a past attended appointment, find a qualifying imported `pkg_purchase` (same customer, `pkg_package_items.service_id` matches, within `expires_at`, purchased on/before the appointment) and insert a `pkg_redemptions` row
- [x] ✅ Oldest qualifying purchase consumed first; remaining computed (quantity − SUM redeemed), sessions vs minutes handled (minutes draws the variant duration); never over-redeems — a used-up/expired package is skipped with a WARNING
- [x] ✅ No `source`/CHECK change needed on `pkg_redemptions` (no such column); provenance noted via `notes = 'Imported appointment'`

### 13. Transaction History Import
- [x] ✅ Rows: customer (match), date, amount (integer cents), description, method (optional), reference (optional)
- [x] ✅ Writes `cus_activities` only (activityType `payment`, `imported: true` in metadata), backdated to the transaction date; NEVER `pay_transactions`/GL/revenue/reporting
- [x] ✅ Unmatched customer → failed; invalid amount/date → failed; idempotent per (customer + date + amount + reference)

### 14. Wave 3 verification
- [x] ✅ Future appointment is a live `apt_bookings` booking (editable); past appointment is timeline-only and writes no booking row (verified live)
- [x] ✅ A past attended appointment against an imported package creates a redemption; remaining balance reflects it (60 of 180 min drawn; verified live). A no-show draws nothing
- [x] ✅ Transaction history appears on the timeline AND nothing lands in `pay_transactions` (count unchanged 96 → 96; verified live)
- [x] ✅ Trial writes nothing; re-run → matched, no duplicates (bookings, timeline, redemptions, payments); notification queue unchanged across trial/commit/re-run; server tsc clean, client tsc clean for touched files

---
## Wave 4 — Intelligent detection & row repair

Implements Requirement 17 and design.md §15. A cross-cutting upgrade to the shared engine (`import-engine.ts`); pure and unit-tested, pre-select-but-confirm, never guesses the unknowable. Calibrated against the real sample customer file (12 columns incl. an unmodelled negative-integer legacy balance; `M/D/YYYY` dates; 9 of 10 rows dropped the `country` value with a trailing empty cell, so the count stays 12 while the shaped values shift). The structure is defined by the MAJORITY row shape, so those 9 rows are canonical and the lone country-bearing row is the outlier.

Delivered in two stages: **Stage A — engine** (done), **Stage B — three-tab staging UI** (planned).

### Stage A — Engine (profiling, detection, realignment)

#### 15. Majority-based column profiling
- [x] ✅ Profile each column from the distribution of its values (reuse `classifyCell`), not single cells
- [x] ✅ `canonicalProfiles`: derive the canonical structure from the MAJORITY row shape (group rows by a shape signature of their shaped-value positions; largest cohort wins; profile from that cohort only) so a cluster of shifted rows can't distort detection. A blank optional field does not make a row an outlier
- [x] ✅ Identifier detection: patterned ids (`LEG-10001`) → certain; bare-number ids via uniqueness + plain-integer shape + leading position → LOW confidence; two equally id-shaped numeric columns → propose the better fit, leave the other unmapped. `hasForeignHeader` guard: a deliberate foreign header (e.g. "Loyalty #") suppresses value inference
- [x] ✅ Leave a column that no profile/pattern/dictionary identifies unmapped and flagged (the unmodelled legacy balance stays null)

#### 16. Dictionary-based name + date-role inference
- [x] ✅ Bundled common-given-name / common-surname lists; score each candidate column by hit-rate; pick the higher side and infer the neighbour (adjacency-preferred)
- [x] ✅ Date-role disambiguation: two date columns → DOB vs joined by distribution (DOB skews decades back; joined clusters recent)
- [x] ✅ Both inferences marked `likely` (suggestions, overridable), never asserted

#### 17. Confidence scoring + review flag
- [x] ✅ `ColumnProposal` carries graded `confidence` (certain | likely | unknown) across name-match, value-shape, id, dictionary, and date-role paths (plus the retained `confident` boolean)
- [x] ✅ `DataMigration.tsx` renders `likely` mappings distinctly ("Guessed — please confirm", warning border) from `certain`; pre-select but require confirmation before commit
- [x] ✅ No inferred mapping or row repair applied silently (Requirement 17.6)

#### 18. Profile-driven row-alignment repair (against the canonical layout)
- [x] ✅ Score each row against the CANONICAL profiles; flag misfits INCLUDING rows whose cell count still matches the width (dropped value + trailing empty)
- [x] ✅ Shift-based repair search scored by HARD fit (shaped columns) then SOFT tiebreak (text sub-kind: sentence vs shortcode vs locale vs taglist) — the tiebreak places a dropped value in the right free-text slot
- [x] ✅ Unique hard-then-soft winner → repaired (+ before/after); zero fit or a tie → unresolved with a plain-language reason (never guess)

#### 19. Surface through analyze + trial/commit, and tests
- [x] ✅ `analyze` and the trial/commit result carry `repair` { repaired, unresolved, samples }; unresolved rows join the failures with field `structure`; `buildRows` realigns before mapping and drops unresolved rows from the committed set
- [x] ✅ First-pass `RepairPanel` in the review/trial/commit views (counts + before/after) — to be replaced by the Stage B three-tab UI
- [x] ✅ `import-engine.test.ts` extended: id + name-dictionary + DOB-vs-joined detection; confidence grading; unmodelled balance unmapped; country-drop realignment; majority-cohort outlier. 20/20 pass

### Stage B — Three-tab staging UI (built)

#### 20. All / Mapped / Error staging + in-app correction
- [x] ✅ Server: `analyze` returns per-row aligned data + bucket (`rows[]` with alignment/cells/raw/reason) and the canonical `width`; new `POST /import/:kind/{trial-rows,commit-rows}` commit the EXACT accepted cell arrays (JSON body), not a file re-parse
- [x] ✅ Client `StagingTabs`: three tabs with live counts — ALL, MAPPED (canonical-fit "good" set), ERROR (outliers); majority → Mapped, non-conforming → Error
- [x] ✅ Error tab: per-row shift-left / shift-right controls with a live aligned preview under the mapped column labels, and "Accept into Mapped" (moves Error → Mapped); a fixed row can be sent back
- [x] ✅ Commit imports ONLY the Mapped set, owner-initiated (`commitRows`); committed rows leave the working set so the owner can keep working Error rows; "Clear mapped" and "Back to mapping" available; client-side staging only, no persisted partial state

#### 21. Stage B verification
- [x] ✅ Sample shape: majority rows land in Mapped and map correctly; the country-bearing outlier lands in Error with a plain-language reason (verified live)
- [x] ✅ Committing the Mapped set imports only those (2 created); re-committing the same set reports `matched` not duplicated (0 imported / 2 matched) — record-level dedup (Requirement 12) verified live; test rows cleaned up
- [x] ✅ No persisted partial state; server tsc 0 errors, client (touched files) tsc clean; 20/20 engine tests pass

---
**Status**: 🟡 In Progress — Waves 1-3 built and verified live (entity imports). Wave 4 **Stage A (engine)** and **Stage B (three-tab staging UI)** both built, unit-tested, and verified live against the real sample (9-row majority canonical, lone country row → Error; shift-and-accept moves it to Mapped; commit imports only the Mapped set; re-commit reports matched not duplicated). 20/20 engine tests pass; server tsc 0 errors; client touched files clean. Outstanding follow-ups from earlier waves: a renewal run against an imported membership enrolment not yet exercised; account-balance import has no idempotency (design §6); a per-balance-import ledger-double-count warning in the UI.
**Dependencies**: Phase 46, Phase 05, Phase 10, Phase 08, packages, business setup


