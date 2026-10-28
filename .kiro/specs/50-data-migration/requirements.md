# Phase 50: Data Migration - Requirements

## Overview

A mature business evaluating DayStream will like the functionality and the price, then hit deployment. Setup (staff, offers, templates) can be done in a few days with tenant-owner help. But most established businesses will not go live for real until their existing data is in the system — and that data is the biggest switching cost they face. If the import feels like a technical project, the perceived cost rises to the point where the business may decide to stay on their current system or choose a competitor.

This phase exists to remove that friction. Its guiding principle, which every requirement below serves:

> **Migration must never be the reason a business walks away.** The software does the hard part; the business owner drops in a file and reviews the result.

The audience is non-technical business owners, often assisted by their tenant owner (who handles sales, training, support, and onboarding across many businesses). The design must be simple enough for the owner alone, with enough visibility for the tenant helper to unblock problems without touching the database.

Migration brings across the customer and everything attached to them, each as its own simple flow: **Customers, Payment Methods, Memberships, Packages, Appointments, Account Balances, and Transaction History.** It explicitly excludes setup/configuration (services, products, membership plans, staff, resources, locations, taxes — the /business and /offers areas), which a business configures itself and which several imports match against.

A key distinction runs through these requirements: **live state vs. history.** Memberships, account balances, and future appointments are the customer's *current* position and land in the real operational/financial system. Past appointments and past transactions are *history* brought along for context and land on the customer timeline only — never the financial ledger. Conflating the two would corrupt live financials, so the line is drawn explicitly.

## Goals

- A business owner can migrate their customer world by uploading files, with no technical knowledge
- Each entity is its own simple flow; a business does only the ones it needs, in the locked order, skipping any step nothing depends on
- The system auto-detects columns (with or without a header row) and auto-matches references (customer, service, staff, plan) to what already exists; the owner confirms rather than configures
- Every valid row imports even when some rows are bad; the bad rows are reported clearly, not rejected wholesale
- A trial assessment shows the complete outcome before anything is written
- Each import is safe to run repeatedly over several days against a live business — re-running never creates duplicates
- No emails are ever sent as a result of an import
- Live state (memberships, balances, future bookings) lands in the real system; history (past appointments/transactions) lands on the timeline only
- A tenant owner can run or assist any import for a business and diagnose failures without database access
- CSV and Excel files are both accepted, because owners export whatever their old system produces

## Glossary

- **Import**: One upload-and-process operation that brings rows of one entity into a business
- **Entity / Import Kind**: One of Customers, Payment Methods, Memberships, Packages, Appointments, Account Balances, Transaction History
- **Import Run**: A single execution (trial or commit) against an uploaded file, with its own result summary and per-row outcomes
- **Source File**: The CSV or Excel file the owner uploads
- **Column Mapping**: The association between a Source File column and a DayStream field. Proposed automatically; the owner only adjusts it
- **Header Detection**: Deciding whether the first row is column labels or data, by comparing its character against the rows below
- **Reference Matching**: Resolving a value in a row to an existing record — a row's customer, an appointment's service/staff (by name), a membership's plan (by name), a package definition (by name). Auto-matched where possible; unmatched values are flagged
- **Customer Matching**: The specific way every customer-associated import resolves which customer a row belongs to — by the **Legacy Customer ID** when the file provides it (exact, preferred), else by the Identity Service (email, then unique phone). Applies uniformly to payment methods, memberships, packages, appointments, account balances, and transaction history
- **Legacy Customer ID**: The identifier a customer held in the previous system. Captured during customer import (Requirement 1.4) and used as the primary, most reliable key to match every other imported entity back to its customer
- **Row Outcome**: Per source row, one of: imported (new), matched (an existing record — updated/filled, not duplicated), or failed (with a reason)
- **Identity Service**: The existing single component (Phase 46 `findOrCreatePerson`) that finds an existing person or creates a new one, matching on email then unique phone
- **Timeline**: The customer's activity log (`cus_activities`), shown on the customer's timeline tab. Imported appointment and transaction history land here
- **Trial / Assessment**: An import run that writes nothing and returns the complete success/failure report
- **Migration Order**: The locked sequence in which entities must be imported, so dependencies resolve
- **Data Migration page**: The page (a Business Setup tab, and a tenant per-business view) where imports are started, assessed, and re-run
- **Tenant Owner**: The partner responsible for a business's sales, training, support, and onboarding, who may run or assist an import on the business's behalf

## Requirements

### Requirement 1: Customer Import

**User Story:** As a business owner, I want to bring my customers in by uploading a single file, so that switching to DayStream does not feel like a technical project.

#### Acceptance Criteria

1. THE system SHALL let a business owner import customers by uploading one Source File (CSV or `.xlsx`), without requiring any prior configuration beyond business setup.
2. THE system SHALL import, in the same pass, the customer-row fields present in the file: first name, last name, email, phone, date of birth, gender, preferred language, country, notes, tags, and a join/created date.
3. THE system SHALL create or update people through the Identity Service (source `import`), so customers are matched/filled, never duplicated (see Requirement 12).
4. THE system SHALL capture and store each imported customer's legacy/external customer identifier (the id they held in the previous system) when present in the file, so later imports — in particular the processor Payment Method Mapping File (Requirement 5) — can be joined to the right DayStream customer.
5. THE system SHALL treat the customer import as the prerequisite for every other import, since all other entities attach to a customer.

### Requirement 2: Automatic Detection (Header + Columns)

**User Story:** As a business owner, I want the system to figure out my file's structure, so that I only confirm rather than configure.

#### Acceptance Criteria

1. THE system SHALL determine whether a Source File's first row is a header row or data by comparing the first row's character against the rows below it: a first row of labels → header; a first row that looks like data of the same kind as the rows below → no header.
2. WHERE the file has a header row, THE system SHALL propose a Column Mapping by matching headers to fields by name (case-, spacing-, and punctuation-insensitive) and common synonyms (e.g. "Mobile" → phone, "Surname" → last name).
3. WHERE the file has no header row, THE system SHALL propose a Column Mapping by evaluating each column's values to infer what it contains (e.g. `name@domain` → email, phone-shaped strings → phone, parseable dates → a date field), so a headerless file is still importable.
4. THE system SHALL let the owner confirm or override the header determination and any proposed mapping, and SHALL mark columns not to import.
5. WHERE a column cannot be confidently identified by header name or by its values, THE system SHALL leave it unmapped and draw attention to it, rather than guessing.
6. THE system SHALL only require the owner's attention on what it is unsure about; confident detections are pre-filled.

### Requirement 3: Forgiving, Partial-Success Import

**User Story:** As a business owner, I want the good rows to come in even if a few rows have problems, so that one bad cell does not block my whole migration.

#### Acceptance Criteria

1. THE system SHALL import every valid row even when other rows are invalid; it SHALL NOT reject the whole file because some rows have errors.
2. THE system SHALL classify each source row as imported, matched, or failed, and report the counts.
3. THE system SHALL show, per failed row, the source row number, the field at fault, and a plain-language reason (including unmatched references such as an unknown service, staff, plan, or customer).
4. THE system SHALL let the owner download the failed rows (with their reasons) as a file they can correct and re-upload.
5. THE system SHALL let the owner assess the outcome before committing, via the Trial Import & Assessment capability (Requirement 4).

### Requirement 4: Trial Import & Assessment

**User Story:** As a business owner, I want to try an import and see exactly what would happen before anything is saved, so that I can trust the result and fix my file first.

#### Acceptance Criteria

1. THE system SHALL let the owner run any import in trial mode that writes nothing — no records created or updated, no timeline entries, no ledger entries.
2. THE system SHALL produce, from a trial, the total number of rows and how many would be imported, matched, and failed.
3. THE system SHALL produce a complete report of every failed row — not a sample — each with its source row number, field at fault, and plain-language reason, downloadable as a file.
4. THE system SHALL run, in a trial, the same validation and reference matching a real import would, so the assessment faithfully predicts the commit.
5. THE system SHALL record each trial in the Import Run history, clearly marked as a trial, with its counts and who ran it.
6. THE system SHALL allow a trial to be re-run with no side effects, and SHALL let the owner proceed from a satisfactory trial to the real import without re-uploading.

### Requirement 5: Payment Method Import (processor Mapping File)

**User Story:** As a business owner, I do not want to ask every customer to re-enter their card, so I want the payment methods migrated from my processor to attach to my customers and be chargeable automatically.

**Mechanism (grounded in Stripe's data-migration process):** The processor (Stripe) runs the actual card migration — moving the vaulted cards from the old account onto the business's DayStream Stripe account as proper payment-method objects **already attached to Stripe Customer objects** — and then hands back a **Mapping File** (CSV or JSON) that matches each *old customer identifier* to the *imported Stripe object IDs* (the new Stripe Customer ID and payment-method token). This import consumes that Mapping File; it does not move card data itself.

#### Acceptance Criteria

1. THE system SHALL import payment methods from the processor's Mapping File, which associates each legacy customer identifier with the migrated Stripe Customer ID and payment-method token; the Source File for this import is that Mapping File.
2. THE system SHALL NOT import, store, or transmit raw card numbers; card migration between processor accounts is a processor operation outside this system (see Out of Scope).
3. THE system SHALL match each Mapping File row to an existing DayStream customer using the unified Customer Matching rule (Requirement 11) — the Legacy Customer ID when present (which the Mapping File provides), else email/phone — and SHALL fail a row with a clear reason where no customer matches.
4. THE system SHALL record the migrated Stripe Customer ID in the provider-customer reference store (`pay_customer_refs`) for the matched customer, and store the migrated payment-method token in the vault linked to that customer — so an off-session charge (e.g. a membership renewal) is recognised by the processor against the attached Customer and succeeds. (This satisfies the pre-existing "payment method must be attached to a Stripe Customer to charge off-session" requirement.)
5. THE system SHALL set one imported method per customer as that customer's default (the first imported, unless the Mapping File marks one).
6. THE system SHALL make payment method import a prerequisite for membership import, so a default method exists to auto-link and bill.
7. THE system SHALL assume the business is migrating onto Stripe and has run Stripe's official migration producing the Mapping File; a business on a different processor, or without a Mapping File, is a separate path not covered by this release (recorded as an assumption, see Notes).

### Requirement 6: Membership Import

**User Story:** As a business owner, I want my active memberships brought across so that recurring billing continues without me re-enrolling everyone.

#### Acceptance Criteria

1. THE system SHALL let a business owner import membership enrollments as their own Source File.
2. THE system SHALL import, per membership row, at least: the customer (matched), the membership plan/level (matched by name to a configured plan), the next billing date, and a status.
3. WHERE a row has no status, THE system SHALL import the membership as active.
4. THE system SHALL auto-link the customer's default payment method to the imported membership.
5. WHERE the customer has no payment method on file, THE system SHALL import the membership as active but SHALL NOT auto-charge it until a payment method exists — using the same "needs a payment method" behavior the renewal engine already applies, so no surprise charge results from an import.
6. THE system SHALL fail a row with a clear reason where the customer or the plan cannot be matched, continuing with the rest (partial success).

### Requirement 7: Package Import

**User Story:** As a business owner, I want my customers' prepaid packages brought across so that they can keep redeeming what they already paid for.

#### Acceptance Criteria

1. THE system SHALL let a business owner import package purchases as their own Source File.
2. THE system SHALL import, per package row, at least: the customer (matched), the package (matched by name to a configured package), and the original purchase date, preserving that purchase date and the package's expiry policy relative to it.
3. THE system SHALL NOT require the owner to supply utilization/remaining data in the package file.
4. THE system SHALL derive package fulfillment from imported appointments: when an appointment is imported that qualifies as a redemption of an imported package purchase (same customer, a service the package covers, within the package's validity window), the appointment import SHALL generate the corresponding redemption record (see Requirement 8).
5. THE system SHALL fail a row with a clear reason where the customer or the package cannot be matched, continuing with the rest.

### Requirement 8: Appointment Import (future bookings and history)

**User Story:** As a business owner, I want my upcoming appointments to be real, manageable bookings and my past ones kept as history, so that nothing is lost and staff and customers can carry on.

#### Acceptance Criteria

1. THE system SHALL let a business owner import appointments as their own Source File, covering both future and past appointments.
2. THE system SHALL import, per appointment row, at least: the customer (matched), the service (matched by name), the staff member (matched by name, optional), the date/time, and a status.
3. WHERE an appointment is in the future, THE system SHALL create a real, live booking that staff and the customer can view, reschedule, or cancel.
4. WHERE an appointment is in the past, THE system SHALL record it on the customer's Timeline as history, without affecting live availability, scheduling, or capacity.
5. THE system SHALL import appointments without validating resource/staff/hours/availability/capacity constraints at import time — it SHALL bring them in as-is (a legacy system may have had no conflict management, so conflicts are accepted); constraints are enforced only when a booking is later edited.
6. THE system SHALL NOT send any notification or confirmation for imported appointments (see Requirement 12).
7. WHERE an imported past appointment qualifies as a redemption of an imported package purchase (per Requirement 7), THE system SHALL generate the package redemption record as part of importing that appointment.
8. THE system SHALL fail a row with a clear reason where the customer or the service cannot be matched, continuing with the rest.

### Requirement 9: Account Balance Import

**User Story:** As a business owner, I want my customers' account credits and outstanding invoices brought across, so that balances carry forward correctly.

#### Acceptance Criteria

1. THE system SHALL let a business owner import account balances as their own Source File, covering account credits (money the business owes the customer) and outstanding invoices (money the customer owes the business).
2. THE system SHALL import an account credit as a drawable account-credit balance for the matched customer, via the credit-note/account-credit mechanism.
3. THE system SHALL import an outstanding invoice as an issued, payable invoice for the matched customer, preserving its original issue date and (where partially paid) its already-paid amount, so the carried-forward outstanding balance is correct.
4. THE system SHALL recognise that account balances are the customer's CURRENT financial position and therefore land in the real system (account credit ledger and invoices), distinct from transaction history (Requirement 10), which does not.
5. THE system SHALL make the balance import's financial effect explicit to the owner (it posts to the ledger), so a business that also records opening balances in accounting does not double-count.
6. THE system SHALL fail a row with a clear reason where the customer cannot be matched, continuing with the rest.

### Requirement 10: Transaction History Import

**User Story:** As a business owner, I want my customers' past payment history brought across for context, so that my staff can see what a customer has spent.

#### Acceptance Criteria

1. THE system SHALL let a business owner import transaction history as its own Source File.
2. THE system SHALL import, per transaction row, at least: the customer (matched), the date, the amount (stored as integer cents), what it was for (description), and the payment method where present.
3. THE system SHALL record imported transactions on the customer's Timeline for support and future marketing.
4. THE system SHALL NOT post imported transaction history to the live financial ledger (`pay_transactions`), the General Ledger, revenue recognition, or reporting totals — it is historical record-keeping, not reconstructed accounting.
5. THE system SHALL fail a row with a clear reason where the customer cannot be matched, continuing with the rest.

### Requirement 11: Customer Matching (legacy ID preferred, Identity Service fallback)

**User Story:** As a business owner, I want every imported thing to attach to the right customer whether or not my export includes the old system's customer ID, so that memberships, appointments, balances and the rest land on the correct person.

#### Acceptance Criteria

1. THE system SHALL, for every customer-associated import (payment methods, memberships, packages, appointments, account balances, transaction history), resolve the row's customer by the Legacy Customer ID when the file provides it — an exact match against the legacy id captured during customer import (Requirement 1.4).
2. WHERE a row does not carry a Legacy Customer ID, THE system SHALL resolve the customer via the Identity Service (email, then unique phone), the same way the customer import matches.
3. THE system SHALL treat the Legacy Customer ID as the preferred key when present (it is exact and unambiguous), and SHALL use the email/phone fallback only when it is absent.
4. WHERE neither a matching Legacy Customer ID nor a matching email/phone resolves a customer, THE system SHALL fail the row with a plain-language reason naming what it looked for, and continue with the rest.
5. THE system SHALL apply this matching uniformly across all customer-associated imports, so the behavior is identical regardless of which entity is being imported.

### Requirement 12: Safe to Repeat

**User Story:** As a business owner migrating over several days on a live system, I want to run any import again without fear of duplicates, so that I can fix problems and top up as I go.

#### Acceptance Criteria

1. THE system SHALL create or update customers through the Identity Service, matching on email (case-insensitive) then on unique phone, so the same person is never duplicated across runs.
2. WHERE an imported customer row matches an existing person, THE system SHALL fill only previously-empty details, never overwriting existing values.
3. THE system SHALL make each entity import idempotent with respect to the records it creates, using a natural key per entity (e.g. appointment: customer + service + start time; transaction: customer + date + amount + reference; membership: customer + plan) so a re-run reports matched rather than creating a duplicate.
4. THE system SHALL remain safe to run against a live business whose customers are also being created through normal day-to-day use, relying on the same matching so a concurrent walk-in is matched, not duplicated.

### Requirement 13: No Emails From Imports

**User Story:** As a business owner, I do not want my customers getting a flood of emails because I imported data, so that migration is invisible to them.

#### Acceptance Criteria

1. THE system SHALL NOT send any email or notification as a result of any import — no welcome emails for imported customers, no confirmation emails for imported future bookings, no receipts for imported transactions or balances, no renewal/dunning notices triggered by imported memberships at import time.
2. THE system SHALL create imported records through paths that suppress the notifications those records would normally trigger.

### Requirement 14: Migration Order

**User Story:** As a tenant owner onboarding a business, I want a clear, fixed order to import things in, so that dependencies resolve and I can guide the business reliably.

#### Acceptance Criteria

1. THE system SHALL define and document a single locked import order: Setup (configured, not imported) → Customers → Payment Methods → Memberships → Packages → Appointments → Account Balances → Transaction History.
2. THE system SHALL enforce the two hard dependencies: Payment Methods before Memberships (so a default method can auto-link), and Packages before Appointments (so appointment import can derive package fulfillment).
3. THE system SHALL allow a business to skip any step it does not need, provided nothing later in the order depends on it (e.g. skipping Packages simply means no package fulfillment is derived during appointment import).
4. THE system SHALL make the order and the skippable rule clear in the Data Migration page and in the tenant-owner migration documentation.

### Requirement 15: The Data Migration Home (Business Setup tab + tenant per-business view)

**User Story:** As a business owner, I want data migration tucked under Business Setup rather than cluttering my everyday menu, so that it's there when I need it and out of the way when I don't.

#### Acceptance Criteria

1. THE system SHALL provide a single Data Migration page that is the home for all entity imports for a given business.
2. THE system SHALL NOT place Data Migration as a permanent item in the main navigation, since it is an occasional, setup-level operation; it SHALL be reached from Business Setup.
3. THE system SHALL present Data Migration to the business as a "Data Migration" tab on the Business Setup (/business) page, alongside the other setup tabs.
4. THE system SHALL make the same Data Migration capability available to a tenant owner for each of their businesses, from the tenant's per-business management view, operating on that business.
5. THE system SHALL implement the business-facing tab and the tenant-facing view as one shared component scoped to the business in context, so both entrances behave identically.
6. THE system SHALL show each import as a distinct, clearly-labelled flow (in the locked order with prerequisites hinted), and the history of recent Import Runs with their outcomes, each marked as a trial or a committed import.
7. THE system SHALL remove the customer-import entry point from the People/Customers page entirely; bulk data import is a privileged, setup-level operation and SHALL NOT be an everyday People-list action. The legacy `/customers/import` route redirects to the Business Setup Data Migration tab.
8. THE system SHALL gate Data Migration to owner/manager-level access rather than general customer access.
9. WHERE a file is large, THE system SHALL keep the page responsive and show import progress rather than appearing to hang.

### Requirement 16: Tenant-Owner Assisted Onboarding

**User Story:** As a tenant owner onboarding a new business, I want to run or guide any import and diagnose failures, so that I can get the business live quickly without needing database access.

#### Acceptance Criteria

1. THE system SHALL allow a tenant owner to perform any of the imports for a business they own, from that business's management view, in that business's context.
2. THE system SHALL present failure reasons in plain language sufficient for a tenant owner to tell the business owner how to fix a row (including unmatched customer/service/staff/plan/package values), without inspecting the database.
3. THE system SHALL attribute each Import Run to the user who performed it (business owner or tenant owner) in the run history.

---

## Dependencies

- Phase 46 (People Foundation): the Identity Service (`findOrCreatePerson`), partial-detail people, and the one-record-per-person matching every import relies on for customer matching and safe repetition
- Phase 05 (Customer Management): the customer record, fields, tags, notes, the timeline (`cus_activities`), and the existing CSV import this phase absorbs and extends
- Phase 10 (Payment Platform): payment methods / vault, account credits, invoices, credit/debit notes (adjustments), and the renewal/dunning "needs a payment method" behavior memberships reuse
- Phase 08 (Memberships): enrollments (`mbr_enrollments`), plans, and the renewal engine
- Packages (Phase 28 / migration 056+): `pkg_packages`, `pkg_purchases`, `pkg_redemptions` and the computed-remaining model
- Business setup (services, staff): the records appointments and memberships match against — prerequisites, not built here

## Success Criteria

- A non-technical business owner can migrate their customer list and the entities they need from exported CSV/Excel files without guidance on how the data is structured
- A file with a realistic mix of clean and messy rows imports all the clean rows and clearly reports the messy ones; a headerless file still imports via value-based detection
- A trial shows the complete outcome and writes nothing; re-running the same (or corrected) file creates no duplicates
- Imported future appointments are editable live bookings; imported past appointments and transactions appear on the timeline and never alter a financial total
- Imported memberships continue billing only once a payment method is present; none are charged as a side effect of import
- Imported packages let customers keep redeeming, with past usage reflected from imported completed appointments
- Imported account credits and outstanding invoices show the correct carried-forward balance
- No customer receives any email because of an import
- A tenant owner can complete any import for a business and resolve row failures from the plain-language reasons alone
- Full onboarding (setup plus migration) is achievable within about a week with tenant-owner assistance

## Out of Scope

- Setup/configuration data: services, products, membership plans, staff, resources, locations, taxes (the /business and /offers areas) — businesses configure these themselves
- Raw card/PAN migration between processor accounts — a processor (e.g. Stripe) operation; this phase only accepts the resulting migrated tokens
- Refunding a legacy payment that was never recorded in DayStream — a payments capability (belongs in Phase 10 as an unlinked/standalone refund), surfaced by migration but not built here
- Posting imported transaction history to the live financial ledger, GL, revenue recognition, or reporting — history is timeline-only
- Imported appointments affecting live availability/capacity — future bookings are real but conflicts are accepted and not validated at import; past appointments are timeline-only
- Automated migration directly from named competitor systems (API-to-API) — file upload only for this release

## Notes

- The existing synchronous CSV importer (Phase 05: `customer-import.service.ts`, `CustomerImport.tsx`, `/customers/import`) is the starting point for the Customer import and the shared engine. This phase extends it rather than replacing the proven identity/dedup path.
- Safe repetition and customer matching are the Phase 46 Identity Service doing what it already does.
- Account balances reuse the Phase 10 adjustment instruments (credit note for credit, invoice for outstanding), with a small import-aware extension so an imported invoice keeps its real issue date and partial-paid amount.
- The membership no-payment-method guardrail reuses the renewal/dunning behavior already built in Phase 10 — an imported membership with no method is active but not auto-charged.
- Payment method import (Requirement 5) assumes Stripe's official data migration: Stripe moves the vaulted cards onto the business's DayStream Stripe account (attached to Stripe Customer objects) and provides a Mapping File of legacy customer ID → migrated Stripe Customer ID + token. Our import records the migrated Stripe Customer ID into `pay_customer_refs` (which off-session charging already requires, per migration 119 this session) and stores the token — it does not create Customers, re-attach cards, or handle raw card data. A legacy processor that is not Stripe, or a migration without a Mapping File, is out of scope for this release.
- "Simple" is a hard requirement, not a nicety: the measure of success is that migration never tips a prospect toward staying on their old system.

---

**Status**: 📋 Planned
**Dependencies**: Phase 46, Phase 05, Phase 10, Phase 08, packages, business setup
**Next Phase**: TBD (deeper transaction history; competitor API migration; unlinked legacy refunds in Phase 10)
