# Phase 46: People Foundation - Tasks

## Overview

Tasks follow the rollout order in design.md section 10. Each numbered section leaves the application working and can be verified on its own before the next begins. Requirement numbers refer to requirements.md.

## Status (2026-10-12)

Sections 1 to 5, 7 and 8 are built and tested; section 6 is deferred to spec 48. 63 tasks done, 15 open. Each open task says what is missing.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Schema and Backfill

### 1.1 Migration `136_people_foundation.sql`
- [x] Relax `email`, `first_name`, `last_name` to nullable; add the contact-point check (R2)
- [x] Add `phone_e164`, `source`, `source_detail`, `owner_user_id`, `user_id`, `last_activity_at`, `last_visit_at`, `lifecycle_changed_at`, deliverability columns, `merged_into_id`, `merged_at` (R4, R5, R6, R10, R12)
- [x] Extend the `status` check with `merged`
- [x] Replace `UNIQUE(business_id, email)` with the case-insensitive partial unique index; stop with a clear message if case-only duplicates exist (R2) — *Note:* the old constraint was kept as well, because existing code relies on it in `ON CONFLICT`
- [x] Rebuild the full-text search index for nullable name and email
- [x] Add `usr_users.last_login_at` (R6)
- [x] Create `cus_consent_events`, `cus_segment_members`, `cus_duplicate_flags` with RLS and grants (R9, R11, R3)
- [x] Extend `cus_segments` (`kind`, `description`, `tenant_id`) and `mkt_communication_preferences` (channels, categories, `updated_at`) (R9, R11)
- [x] Add the new indexes

### 1.2 Backfill
- [x] Link People to login accounts by email (`user_id`) (R6)
- [x] Compute `last_activity_at`, `last_visit_at`, `lifecycle_changed_at` (R6)
- [x] Write `scripts/backfill-phone-e164.ts` and run it (R2) — *Note:* run locally on 2026-10-12; must also be run once on each deployed database
- [x] Run `npm run migrate:dev`; confirm existing Phase 05 tests still pass

## 2. Identity Service

### 2.1 Service
- [x] Create `person-identity.service.ts` with `findOrCreatePerson`, `findPersonByContactPoint`, `normaliseEmail`, `normalisePhone` (R3)
- [x] Add `libphonenumber-js`; default region from the business country (R2)
- [x] Write duplicate flags on ambiguous phone matches (R3)
- [x] Unit tests: matching order, fill-not-overwrite, no cross-business match, name never matches, unique-index race

### 2.2 Switch callers
- [x] `customer.service.createCustomer` (R1, R4)
- [x] `customer-import.service` (R4)
- [x] `widget-booking.service.findOrCreateCustomer`, with the initial stage from lifecycle rules (R7)
- [x] Customer self-registration in `auth` (R4, R6)
- [x] `marketing-funnels.submitForm` minimal fix: business, reference number, source (R4)
- [x] Confirm no other code inserts into `cus_customers`

### 2.3 Activity signals
- [x] `touchActivity` / `touchVisit` in `customer-activity.service`; call from booking creation, check-in, order completion (R6)
- [x] Set `last_login_at` on login and touch the linked People (R6)
- [x] Set `lifecycle_changed_at` in `transitionLifecycle` (R6)

## 3. Consent and Contactability

### 3.1 Unified consent
- [x] Migrate `cus_preferences` into the unified store, most restrictive wins, with `migration` events (R9)
- [ ] Create `consent.service.ts`; retire `marketing-consent.service.ts` (R9) — **Open:** the new service exists and is the only store; the old file remains as a thin wrapper still imported by `routes/marketing.ts`
- [x] Point `GET/PUT /customers/:id/preferences` and the customer portal at the unified store (R9)
- [x] New consent endpoints: state, change, history (R9)
- [x] Stop writing `cus_preferences`

### 3.2 Contactability
- [x] Create `contactability.service.ts`: `canContact`, `filterAudience`, `summariseAudience` (R10)
- [ ] Use it at send time in `marketing-campaigns.service` and `sequence-engine.service` (R10) — **Open:** done for campaigns; the sequence engine is not switched yet
- [ ] Use it in booking notifications for the reminders setting (R10) — **Open:** not started
- [x] `GET /segments/:id/audience-summary` (R10)
- [x] Tests: one per refusal reason; transactional allowed without marketing consent

## 4. Complete Merge

### 4.1 Server
- [x] Rewrite `mergeCustomers` as one transaction covering every table that references a Person (R12)
- [x] Explicit handlers for tables with customer-scoped unique keys (R12)
- [x] Mark the secondary as merged instead of deleting it; redirect lookups (R12)
- [x] `POST /customers/merge/preview` (R12)
- [x] Coverage test over `information_schema` so new tables cannot be missed — *Note:* the merge reads the list of referencing tables from the database catalog at run time, so a new table is covered without a code change
- [x] Integration test: merge two People with bookings, payments, a membership and campaign history

### 4.2 Duplicates
- [x] Duplicate flag endpoints: list, dismiss (R3)

## 5. Segments

### 5.1 Server
- [x] `PUT /segments/:id` (R11)
- [x] Static lists: membership table, add / remove endpoints (R11)
- [x] New rule fields and relative date operators in `evaluateRules` (R11)
- [x] Extend `seedPredefinedSegments` with the starter set; add them to existing businesses (R11)
- [x] Refuse deleting a Segment in use (R11)

## 6. Marketing Business Scope

### 6.1 Migration `137_marketing_business_scope.sql`
- [ ] Add `business_id` to the five `mkt_` tables and backfill by the rules in design.md section 3 (R14) — **Open:** section 6 deferred to spec 48 (Marketing Module)
- [ ] List rows that could not be assigned (R14) — **Open:** deferred to spec 48
- [ ] Change tenant-wide unique keys to business-wide — **Open:** deferred to spec 48

### 6.2 Server and client
- [ ] Require and filter by `business_id` in every `/marketing` route and service (R14) — **Open:** deferred to spec 48
- [ ] Refuse cross-business segment or person references (R14) — **Open:** deferred to spec 48
- [ ] Pass the active business from the Marketing pages — **Open:** deferred to spec 48
- [ ] Integration test: two businesses of one tenant cannot see each other's marketing records — **Open:** deferred to spec 48

## 7. People List

### 7.1 Server
- [x] `view`, new filters, new columns, `display_name`, `next_booking_at` in `getCustomers` (R1, R8)
- [x] `GET /customers/view-counts` (R1)
- [ ] `POST /customers/bulk` and `/bulk/preview`; background job above 5,000 (R8) — **Open:** both endpoints done; no background job, a selection is capped at 5,000 people

### 7.2 Client
- [x] Rename the module to "People" in `moduleRegistry.ts`, page titles and breadcrumbs (R1)
- [x] View tabs with counts; remember the last View (R1)
- [x] Shared stage label map; show `trial` as "New customer" everywhere (R1)
- [x] Column chooser, new columns, "Incomplete" badge (R2, R8)
- [x] Row selection, "select all matching", bulk action bar with confirmation (R8)
- [x] Segment picker as a custom View (R1, R11)
- [x] Mobile card layout (R8)

## 8. Profile and Forms

### 8.1 Create and edit
- [x] Email or phone required; Source select; "already exists" hand-off (R2, R3, R4)
- [ ] Prompt for missing details at first booking or purchase (R2) — **Open:** not started

### 8.2 Profile
- [x] Header strip: stage, Source, Owner, created, last activity, last login, Incomplete (R13)
- [x] Owner picker (R5)
- [x] Consent block with history, replacing the Preferences switches (R9, R13)
- [x] Duplicate banner and merge dialog with preview (R3, R12)
- [ ] Timeline filter chips and new entry kinds (R13) — **Open:** filter chips exist from Phase 05; the new entry kinds are written but have no chips of their own

### 8.3 Segments and campaigns
- [x] Segment editing, kind label, live count, new rule fields in `Segments.tsx` (R11)
- [x] Audience summary line on `CampaignCreate.tsx` (R10)

## 9. Verification

### 9.1 Tests and documentation
- [x] Server, client and shared unit tests pass
- [ ] Run `docs/e2e` suite 08 (CUS-17 to CUS-28), suite 13, JNY-15 and the smoke suite; set script statuses from the run — **Open:** People screens checked in the browser (runs 20261012-4 and -5); the full suite run is still to do
- [x] Update `docs/e2e/README.md` known issues (KI-13, D-14, D-15) as they are closed
- [ ] Drop `cus_preferences` in a follow-up migration once the unified store is verified — **Open:** waiting until the unified store has been in use for a while
