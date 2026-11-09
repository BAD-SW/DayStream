# Phase 50: Data Migration - Design Document

**Date**: July 6, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 46, Phase 05, Phase 10, Phase 08, packages, business setup

---

## Overview

One shared import engine, a separate labelled flow per entity, extending the existing synchronous CSV customer importer. The engine is the same for every entity (upload → parse → detect/match → validate → trial → commit → record run); entities differ only in their target fields, their reference matching, and where a committed row lands. Nothing here invents a new matching/dedup mechanism — customer matching and safe repetition are the Phase 46 Identity Service doing what it already does.

The central safety line: **live state vs. history.** Memberships, account balances, and future appointments land in the real operational/financial system. Past appointments and past transactions land on the customer timeline (`cus_activities`) only — never `pay_transactions`, the GL, revenue recognition, or reporting. And **no import ever sends an email.**

---

## Table of Contents

1. [What Exists Today](#1-what-exists-today)
2. [The Shared Engine & Flow](#2-the-shared-engine--flow)
3. [File Parsing (CSV + Excel)](#3-file-parsing-csv--excel)
4. [Automatic Detection (Header + Columns)](#4-automatic-detection-header--columns)
5. [Reference Matching](#5-reference-matching)
6. [Safe Repetition & Idempotency](#6-safe-repetition--idempotency)
7. [Per-Entity Landing](#7-per-entity-landing)
8. [Migration Order](#8-migration-order)
9. [No Emails From Imports](#9-no-emails-from-imports)
10. [Database Schema](#10-database-schema)
11. [API](#11-api)
12. [Frontend: The Data Migration Page](#12-frontend-the-data-migration-page)
13. [Scale & Responsiveness](#13-scale--responsiveness)
14. [What We Deliberately Do Not Build](#14-what-we-deliberately-do-not-build)
15. [Intelligent Detection & Row Repair (Wave 4)](#15-intelligent-detection--row-repair-wave-4)
16. [Source Systems & Processor Customer Matching](#16-source-systems--processor-customer-matching)
17. [Dates, Times, Statuses & Balance Re-runs](#17-dates-times-statuses--balance-re-runs)

---

## 1. What Exists Today

The starting point, extended not replaced:

- `customer-import.service.ts` — CSV parse, per-row validation, `executeImport` routing rows through `findOrCreatePerson` (source `import`).
- `routes/customers.ts` — `POST /v1/customers/import[/validate]` (both `customers:*`).
- `CustomerImport.tsx` — the 4-step wizard at `/customers/import`.

Reusable assets confirmed: the Identity Service; the background job runner; multer memory-upload; the `storage` service; the Phase 10 instruments for the money entities — `account-credit.service.ts` / `credit-note.service.ts` (grant drawable credit), `invoice.service.ts` (issue outstanding invoice), the renewal/dunning "needs a payment method" behavior; the package model `pkg_packages`/`pkg_purchases`/`pkg_redemptions` with remaining computed as `quantity − SUM(redeemed)`.

Known constraints to work around (found during design): `issueInvoice` and `issueCreditNote` hard-code `issue_date = today` and take no already-paid amount — so account-balance import needs a small import-aware extension (§7). `purchasePackage` computes expiry from "now" — so package import inserts directly to preserve the original purchase date (§7).

---

## 2. The Shared Engine & Flow

Three visible steps, same for every entity:

```
Upload                Review / Trial                 Done
  │                     │                              │
  ├─ pick CSV/XLSX  ──►  ├─ header + column detection   ├─ imported / matched / failed
  │                     │   (confirm, don't configure)  ├─ full failure report (download)
  │                     ├─ run TRIAL (writes nothing):  └─ "run again" / proceed to next step
  │                     │   full imported/matched/failed │
  │                     │   + unmatched references       │
  │                     └─ [Commit]  ───────────────────►
```

The engine stages: parse → detect header/columns → map → resolve references → validate → (trial: report only | commit: write) → record run. Trial and commit share the exact same pipeline, differing only in whether rows are written, so a trial faithfully predicts the commit. The owner can go straight from a satisfactory trial to commit without re-uploading.

---

## 3. File Parsing (CSV + Excel)

- **Transport**: multer memory storage, size-limited (~10 MB). Optionally persist the raw file via `storage` under `imports/{tenantId}/{businessId}/{runId}` for audit/large-file reprocessing.
- **CSV**: the existing quoted-field parser (or a small library).
- **Excel (`.xlsx`)**: server-side `xlsx` (SheetJS), first worksheet read as a raw grid (do NOT assume row 1 is a header — §4 decides). Pin the version. Cells normalized to strings so validation is format-agnostic.
- Converge to one representation `{ grid: string[][] }`; §4 produces the working `{ columns, rows }`. The rest of the pipeline is format-blind.

---

## 4. Automatic Detection (Header + Columns)

Two layers; the owner confirms both.

### 4a. Header-row detection
Classify row 0's cells (value-shaped vs. label-shaped) against a sample of the rows below. Row 0 of labels over data rows → header. Row 0 that looks like the same kind of data → no header (row 0 is the first record). Surface as a confirm/override toggle using the visible sample. Pure: `detectHeaderRow(grid) → { hasHeader, confidence }`.

### 4b. Column identification
- **With a header** — match normalized header names against a synonym table per field (email, first/last name, phone, DOB, gender, language, country, notes, tags, joined date, and per-entity fields: service, staff, plan, package, amount, date, status, etc.).
- **Without a header (or an unmatched header)** — infer from the column's values: `name@domain` → email, phone-shaped → phone, parseable dates → a date field, recognised country/language token, currency-shaped → amount. Value-based detection also backstops a headered file whose header is cryptic.
- Confident → pre-filled; weak/ambiguous/none → unmapped and flagged. Never guess.
Pure: `detectColumns(columns, sampleRows, hasHeader) → { field|null, confident }[]`.

---

## 5. Reference Matching

How a row connects to existing records, auto-matching and flagging the rest (same philosophy as column detection). Runs in the trial too, so unmatched references surface before commit.

- **Customer** (every customer-associated entity): one unified rule (Requirement 11) — the **Legacy Customer ID** when the row carries it (exact match against the legacy id captured at customer import; preferred because it's unambiguous), else the Identity Service by email then unique phone. No match → row failed ("no matching customer for <legacy id / email / phone>"). An entity import never *creates* a customer — only attaches to one. A legacy system that exports a legacy id on its customer file almost always stamps the same id on its membership/appointment/transaction exports, so when present, matching is exact; when absent, email/phone is the fallback (no worse than before).
- **Service, staff** (appointments): by normalized name against `svc_services` / `usr_users`. Unmatched/ambiguous → failed with the value named.
- **Plan** (memberships): by normalized name against the business's configured membership plans. Unmatched → failed.
- **Package** (packages): by normalized name against `pkg_packages`. Unmatched → failed.
- **Payment method → customer** (payment-method import): the processor Mapping File row carries the legacy customer id; match it to the DayStream customer by the legacy id stored at customer import (fallback email). (For memberships, the customer's imported *default* method is auto-linked — §7.)

---

## 6. Safe Repetition & Idempotency

Delegated to the Identity Service for customers; a natural key per entity for the rest.

- Customers: `findOrCreatePerson` → `created` ⇒ imported, matched existing ⇒ matched (fill-empty only). No duplicates across runs; concurrent walk-ins matched too.
- Per-entity natural keys so a re-run reports `matched` rather than duplicating:
  - appointment: customer + service + start time
  - transaction: customer + date + amount + external reference
  - membership: customer + plan
  - package purchase: customer + package + purchase date
  - account credit / invoice: customer + source reference (or amount + date)
  - note: customer + note date + the note text (notes carry no external reference, so a content-based key is the honest choice; two genuinely distinct notes with the same customer, date, and identical text collapse to one — an accepted, conservative limitation)

---

## 7. Per-Entity Landing

Where each committed row goes, and the live-vs-history line.

- **Customers** → `cus_customers` via `findOrCreatePerson` (source `import`). Also capture the customer's legacy/external id when present (stored on the customer record, e.g. in an external-id field / metadata) so the payment-method Mapping File can later be joined to the right customer. Live.
- **Payment methods** → from the processor **Mapping File** (legacy customer id → migrated Stripe Customer id + payment-method token). Record the migrated Stripe Customer id into `pay_customer_refs` for the matched customer and store the token in the vault (`pay_payment_methods`), first becomes default. Stripe's migration already attached the method to a Stripe Customer on our account, so this satisfies the off-session "attach to a Customer first" requirement (migration 119) and a membership renewal can charge it. No raw card data. Live. Requires the customer's legacy id captured at customer import (§Customers) to join the Mapping File.
- **Memberships** → `mbr_enrollments` (plan, next billing date, status active). Auto-link the customer's default payment method. **No default method → active but not auto-charged**, reusing the renewal/dunning "needs a payment method" behavior (Phase 10, this session) so no import-triggered charge. Live.
- **Packages** → `pkg_purchases` inserted directly (to preserve the original purchase date and expiry window; `purchasePackage` can't, as it dates from "now"). No usage in the file. Live.
- **Appointments**:
  - *Future* → a real `apt_bookings` row via the booking path (manageable live), created WITHOUT firing notifications. No availability/capacity/staff/hours validation at import — brought in as-is, conflicts accepted; constraints apply only on later edit.
  - *Past* → a `cus_activities` timeline entry (activityType `booking`), no `apt_bookings`, no availability impact.
  - *Package fulfillment*: when a past (completed) appointment matches an imported package purchase (same customer, a service the package covers, within the validity window), insert the corresponding `pkg_redemptions` row as part of importing that appointment — this is how package usage is derived (packages are imported before appointments, per §8).
- **Account balances**:
  - *Account credit* → a drawable `pay_account_credits` balance via the credit-note/account-credit mechanism. Live, posts to the ledger (2500 Customer Deposits).
  - *Outstanding invoice* → an issued `pay_invoices` row via an **import-aware extension** of `issueInvoice` that accepts the original `issue_date` and an already-paid amount (the stock call forces today and 0 paid). Live, a real receivable.
  - Because these are live financial state, the UI makes the ledger effect explicit so a business doing opening-balance journal entries in accounting doesn't double-count.
- **Transaction history** → `cus_activities` only (activityType `payment`, `imported: true` in metadata). **NOT** `pay_transactions`, GL, revenue recognition, or reporting. History, not accounting.
- **Notes** → `cus_activities` only (activityType `note`, `imported: true`), backdated to the note's date when given. Its own file (one row per note) because notes are one-to-many — a customer may have none or hundreds — so they don't fit as fields on the customer record. Lands on the Timeline rather than the encrypted `cus_notes` store, because a migration file can't supply the per-business note category and field-level encryption `cus_notes` requires (same reasoning as the single-note path in the customer import). The customer import keeps one optional notes column for the common single-note case; this import is for the full history. No schema change — reuses `cus_activities`.

---

## 8. Migration Order

Locked sequence (documented for tenant owners):

```
Setup (configured) → Customers → Payment Methods → Memberships → Packages → Appointments → Account Balances → Transaction History → Notes
```

- **Hard dependencies**: Payment Methods before Memberships (default method to auto-link); Packages before Appointments (so appointment import derives fulfillment).
- **Everything else** is a chosen-and-locked order (memberships ahead of packages/appointments by business priority), not a technical chain.
- **Skippable**: any step nothing downstream needs. Skip Packages → appointment import simply finds no package to fulfill. Skip Payment Methods → memberships import active-but-not-auto-charged.
- Customers is always first (everything attaches to a customer).
- **Notes** depend only on Customers (a note attaches to a person), so they can run any time after customers; placed last as customer-attached history alongside Transaction History.

---

## 9. No Emails From Imports

A blanket rule (Requirement 12). Imported records are created through paths that suppress the notifications they would normally trigger:
- Imported customers do NOT fire the Phase-6 welcome email (the welcome hook must be bypassed for the import source).
- Imported future bookings do NOT fire booking confirmations.
- Imported memberships do NOT fire renewal/dunning notices at import time.
- Imported transactions/balances do NOT fire receipts.
Implementation: the import commit path calls the underlying create logic directly with notifications disabled, or sets the `import` source which the notification hooks already special-case (e.g. the welcome email explicitly skips `source === 'import'`).

---

## 10. Database Schema

One new table for run history; a small extension to invoice issuing for import. Imported history reuses `cus_activities`; no new history tables.

```sql
CREATE TABLE IF NOT EXISTS mig_import_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES sys_tenants(id)    ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  entity        VARCHAR(32) NOT NULL,   -- customers | payment_methods | memberships | packages | appointments | account_balances | transactions
  file_name     TEXT,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  imported      INTEGER NOT NULL DEFAULT 0,
  matched       INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'completed',  -- running | completed | failed
  is_trial      BOOLEAN NOT NULL DEFAULT false,
  performed_by  UUID REFERENCES usr_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mig_import_runs_business
  ON mig_import_runs(business_id, created_at DESC);
```

App-level tenant isolation (consistent with the platform — no RLS; see spec 10 Phase 7.1). `is_trial` distinguishes an assessment from a committed import. Full per-row failures are returned to the client for the downloadable report, not persisted; only counts live on the run.

**Invoice import extension**: an import-aware issue path (or added optional params on `issueInvoice`) accepting `issueDate` and `amountPaidCents`, so an imported outstanding invoice keeps its original date and correct outstanding balance. Gapless numbering is preserved.

---

## 11. API

Business-scoped, gated owner/manager-level (tighter than `customers:*` — Requirement 14.8). One shape across entities with a `:kind`:

```
POST /v1/import/:kind/analyze    (file → { hasHeader, columns, sampleRows, proposedMapping })
POST /v1/import/:kind/trial      (writes NOTHING → { runId, total, imported, matched, failed, failures[] }; records is_trial=true)
POST /v1/import/:kind/commit     (writes → { runId, total, imported, matched, failed, failures[] }; records is_trial=false)
GET  /v1/import/runs?business_id=…        (recent runs, all kinds, trial+committed each flagged)
GET  /v1/import/runs/:id?business_id=…    (one run)

:kind ∈ customers | payment_methods | memberships | packages | appointments | account_balances | transactions | notes
```

`trial` and `commit` share the pipeline (validation + reference matching + per-entity landing), differing only in writing. Reference resolution runs in `trial` so unmatched refs appear before commit. Legacy `/v1/customers/import[/validate]` aliases to `customers` (`/validate`→trial, `/import`→commit) until the page replaces them.

---

## 12. Frontend: The Data Migration Page

Occasional, setup-level — no permanent sidebar slot. Lives under Business Setup, with a matching per-business entrance for the tenant.

- **One shared component** `DataMigration.tsx`, scoped to the business in context (takes a `businessId`), reused by both entrances (modelled on the reusable `PaymentMethods` panel).
- **Business entrance** — a **"Data Migration"** tab on `/business` (add to `VALID_TABS`, a label, one conditional render). No new top-level route/module.
- **Tenant entrance** — the same component from the tenant's per-business management view (`TenantBusinesses.tsx`), passing that business's id.
- **Permission** — owner/manager-level, both entrances.
- **The page** — the entity flows laid out in the locked order with prerequisites hinted ("import customers first", "import payment methods before memberships", "packages before appointments"); each launches the shared three-step flow. Recent Import Runs below, each marked trial or committed.
- **Review/trial step** — confirmed mapping with sample values, header toggle, unsure columns flagged; runs the trial and shows the full imported/matched/failed assessment (and unmatched references) with a complete downloadable failure report before commit.
- **Remove** the People/Customers "Import CSV" button entirely; `/customers/import` redirects to the tab.
- CSS variables + design-system components; `businessId` from the hosting context, not `localStorage`.

---

## 13. Scale & Responsiveness

- **First increment**: synchronous, parsing server-side via multer; fine for typical lists (hundreds to low thousands).
- **If large files require it**: promote `commit` to the background job runner — store the file, enqueue an import job (`job-registry.ts`), process in chunks, update the `mig_import_runs` counts/status; the page polls for progress. The `status` column and job infra support this; an upgrade path, not required first.

---

## 14. What We Deliberately Do Not Build

- No setup/configuration import (services, products, plans, staff, resources, locations, taxes).
- No raw card/PAN migration — a processor operation; we accept the resulting migrated tokens only.
- No unlinked legacy-payment refunds — a Phase 10 payments capability, surfaced by migration but not built here.
- Imported transaction history never posts to the ledger/GL/reporting (timeline only).
- Imported appointments: future bookings are real but not availability-validated (conflicts accepted); past appointments are timeline only.
- No competitor API-to-API migration — file upload only.

These boundaries keep the flows simple. None may be allowed to make the core imports more complicated.

---

## 15. Intelligent Detection & Row Repair (Wave 4)

Wave 4 deepens §4's automatic detection and adds a row-alignment safeguard, driven by one idea: **profile the whole column, then judge each row against those profiles** — the way a person scans a column to recognise it and spots the row that doesn't line up. It implements Requirement 17. Everything stays a pure function of the grid (no DB/IO), so it is unit-testable, and everything inferred is pre-selected-but-confirmed, never applied silently.

Motivating real data (the sample customer file): 12 columns — `legacy_id, email, first, last, <legacy balance>, dob, gender, language, country, notes, tags, joined`. Two traps: (a) headerless files where `first`/`last`/`legacy_id` are plain text with no value shape, so §4b leaves them unmapped; and (b) rows where `country` was dropped mid-record and a trailing empty cell was appended — so the row still has 12 cells but `notes` sits in the `country` slot and the join date sits one slot early. A raw column-count check sees "12 = 12, consistent" and maps by position, silently shifting nine rows. Only profiling catches it.

### 15.1 Column profiling — the MAJORITY defines the structure

A pass over the data rows produces, per column, a profile: the distribution of value kinds (reusing `classifyCell`), plus the new signals below. A column's identity comes from its dominant profile, not any single cell.

**Profile from the majority, not from every row.** Profiling naively across *all* rows fails on a real file: in the sample, 9 of 10 rows dropped the `country` value (join date in slot 10, trailing empty), and only 1 row kept it (join date in slot 11). Profiling all 10 together poisons the `country` column into looking like free text and erases the join-date column, because the shifted rows are the majority. The fix (`canonicalProfiles`): group rows by a **shape signature** — the sequence of `(position, hard value kind)` for each row's email/phone/date/money cells (text and bare numbers are too generic to anchor, and a legitimately blank optional field like a missing DOB or gender does NOT change the signature, so sparse-but-consistent rows group together). The **largest cohort** of matching signatures defines the canonical structure, and the profiles are built from that cohort alone. In the sample the 9 "no-country" rows win, so the canonical layout has the join date in slot 10 and the 1 row with country becomes the outlier — exactly how a person reads it: the shape the records mostly follow *is* the intended structure, and the deviant records are the ones to fix.

Per-column signals layered on top of the canonical profile:

New signals added to the classifier/profiler:
- **Identifier column** — giving `legacy_customer_id` a value signal so an id column can map without a header. The reliability depends entirely on what the id looks like, and the engine must not overstate it:
  - *Patterned id* (a consistent prefix-separator-number shape such as `LEG-10001`, `L-1`, `CUST000123`) — distinctive enough to propose with reasonable confidence.
  - *Bare-number id* (just `48217`, `1002`, …) — the common/probable real case, and **indistinguishable by value from any other integer column** (a legacy balance, loyalty points, a visit count, an age). Value shape alone cannot identify it. The engine instead leans on soft, profile-level signals: **uniqueness** (an id is almost always distinct on every row, whereas a balance/points/count repeats), plain-**integer shape** (no decimals, currency symbol, or negatives — which, e.g., excludes the sample file's negative-balance column), and **position** (legacy exports usually put the id first) as a weak tie-breaker. A leading, all-unique, plain-integer column is proposed as `legacy_customer_id` at **low confidence** (`likely`), pre-selected but flagged for confirmation — never asserted. Where two columns are equally id-shaped (e.g. two bare-integer columns) and nothing separates them, the engine proposes the better-fitting one and leaves the other unmapped-and-flagged rather than guess which is which.
  - The header name (`CustomerID`, `AccountNo`, `ID`, …) remains by far the most reliable id signal and is already handled by name matching (§4b); the value-based path above only matters for headerless files or unrecognised headers.
- **Given-name / surname dictionaries** — a column is scored by what fraction of its values hit a common-first-name list vs a common-surname list. The higher-scoring side wins; its neighbour is inferred as the other. Dictionaries are modest, bundled lists (not exhaustive) — enough to separate the two columns by rate, which is all the decision needs. Diverse/initial/mononym values lower the score, which is why the result is confidence-scored (below), not asserted.
- **Date role** — when two columns both profile as dates, their value *distributions* disambiguate: a birth-date column spreads across decades and skews well into the past; a join/created column clusters in recent years. Assign DOB vs joined by that skew instead of leaving both ambiguous.

### 15.2 Confidence on every proposal

`ColumnProposal` gains a confidence level (e.g. `certain` | `likely` | `unknown`). Certain = a known header name, or a decisive value shape (email, phone, id pattern, a lone date mapped by shape). Likely = an inference (first vs last by dictionary, DOB vs joined by distribution, a value-shape match under a header that didn't name-match). Unknown = left unmapped and flagged. The review UI renders `likely` distinctly (a "please confirm" affordance) from `certain` (settled), so the owner's attention goes only to what was inferred. This realises Requirement 17.5–17.6 and sharpens §4's existing `confident` boolean into a graded signal.

### 15.3 Row-alignment repair (against the canonical layout)

Each row is scored against the **canonical** column profiles (§15.1):
- A row whose values line up with the canonical columns passes unchanged (it's in the majority, or sparsely-but-consistently so).
- A row that misfits (a sentence in a shaped slot; a date one slot early; a value where the canonical column expects another shape) is a **candidate for realignment** — *including when its cell count equals the canonical width*, because a dropped value plus a trailing empty preserves the count (Requirement 17.7). The detector is profile-fit, not column-count.
- **Repair search**: the fix is almost always a **shift** (left or right), so the candidates are the small set of plausible shifts — insert an empty where a value looks dropped, drop a trailing empty, or re-join an over-split free-text field. Each candidate is scored by a **hard** fit (do shaped values land in their shaped columns) and a **soft** tiebreak (does a text value's sub-kind — a sentence vs a short country code vs a locale code vs a tag list — match the column's dominant text sub-kind). The soft tiebreak is what places a dropped value in the right free-text slot when the shaped columns alone can't tell (e.g. "Interested in recovery." reads as a *sentence* → notes, not the *shortcode* → country slot).
  - Exactly one alignment wins on hard-then-soft score → **repair** the row to it, record a before/after.
  - Zero clean fits, or a genuine tie → **do not guess**: the row is left for the owner to resolve, with a plain-language reason (Requirement 17.9).

Scoring against the *canonical* (majority) profiles is what makes "which layout is correct" well-defined: the majority is the target, and a deviant row is realigned toward it (or flagged). When the file is internally split with no clear majority, rows that don't match stay unresolved for the human — the engine never invents a structure that the data doesn't support.

### 15.4 The three-tab staging review (how the owner works the file)

The review surface for an imported file is three buckets the owner works between, entirely client-side until they choose to commit:

- **All** — every record from the file.
- **Mapped** — the records that fit the canonical structure (the majority, plus any the owner has fixed). This is the "good" bucket; **only Mapped records are ever committed**, and only when the owner initiates it.
- **Error** — records that don't line up with the canonical columns (the outliers). The owner corrects them here.

Flow: the owner opens the Error tab, where each problem row shows its values against the canonical columns with **shift controls** (nudge the row's cells left/right) so they can realign it by hand; on **accept**, the row moves Error → Mapped. They work the Error list down at their own pace. At any point they can **commit the Mapped bucket** (import the good records now) or **clear** it. Because committing imports only the accepted Mapped rows, the owner can import a batch, keep fixing the rest, and import again — a natural "do the 20 that are ready, then work the last 10" rhythm.

**No persisted partial state.** The staging lives in the browser for the session; the only thing that touches the database is the owner-initiated commit of the Mapped bucket, which is the existing `commit` path. There is no draft/resume table — leaving the page and re-uploading is the reset. This keeps the backend a plain file-in / result-out call and avoids a stateful multi-pass import protocol.

**Record-level duplicate safety (not file-level).** We do not fingerprint the file; we care whether the *data records* already exist. That is already guaranteed by each entity's natural-key idempotency (Requirement 12, built in Waves 1–3): customers by email/legacy-id via the Identity Service, memberships by customer+plan, packages by customer+package+date, and so on. So committing the Mapped bucket more than once — or re-uploading a file whose records overlap a previous import — reports the repeats as `matched`, never duplicated. The staging model relies on this rather than adding its own dedup.

Server surfacing that feeds the tabs: `analyze` (and the trial/commit result) carry the counts of canonical-fit, repaired, and unresolved rows plus before/after samples; unresolved rows also appear in the per-row failure report with a `structure` field. Nothing is written in a trial or in analyze.

### 15.5 Boundaries

- **Pre-select, never silent.** Every inferred mapping and every row repair is shown and confirmable before commit. The engine does the work; the owner keeps the final glance. This is the deliberate trade-off for operating on a business's real customer records.
- **Dictionaries are heuristics, not truth.** Name detection is a confidence-scored suggestion; an owner can override it in one click. We do not chase exhaustive name coverage — just enough to separate the columns by rate.
- **Still never guess the unknowable.** A genuinely ambiguous column stays unmapped-and-flagged; a genuinely ambiguous row fails with a reason. Wave 4 widens what the engine can confidently resolve; it does not lower the bar for what counts as confident.
- Pure and testable: profiling, confidence scoring, and the repair search are all functions of the grid, unit-tested alongside §4's existing detection tests.

### 15.6 Delivery split (A then B)

Wave 4 ships in two stages so the engine value lands before the richer UI:
- **Stage A — Engine (built).** Majority-defined canonical profiling (`canonicalProfiles`), id/name/date detection with graded confidence, and shift-based row realignment against the canonical layout classifying each row as fits / repaired / unresolved. Surfaced through `analyze` and the trial/commit result (repaired + unresolved counts, before/after samples, `structure` failures). Pure, unit-tested against the real sample (the 9-row majority is canonical; the lone country row is the outlier).
- **Stage B — Three-tab staging UI (planned).** The All / Mapped / Error tabs, the in-Error shift editor, Error → Mapped accept, owner-initiated commit of the Mapped bucket with accept/clear, and explicit verification of record-level dedup across repeated commits. Client-side staging only; no new persistence. A first-pass server-fed repair panel exists today; Stage B replaces it with the full interactive surface.

---

## 16. Source Systems & Processor Customer Matching

Implements Requirement 19.

### 16.1 Source System presets

The upload screen shows a **Source system** dropdown before the file picker, for any import with at least one known layout (today: Payment Methods). The choice is sent with the file to `POST /import/:kind/analyze` as `source` (`auto` by default); an id not valid for the import kind is rejected with 400.

The owner picks only the **system** ("Stripe"), never a file type. A system can produce several file layouts; the server recognises which one was uploaded. Systems live in `services/migration/import-sources.ts` (`SOURCE_SYSTEMS`); the client lists one option per system in `SOURCE_OPTIONS`. Adding a system means one entry on each side; adding a layout to an existing system is server-only.

```ts
type ImportSourceId = 'auto' | 'stripe';
interface SourceSystem { id: 'stripe'; kinds: string[]; layouts: SourceLayout[] }
interface SourceLayout {
  label: string;                            // shown once recognised, e.g. "Stripe account copy file"
  headers: Record<string, string | null>;   // normalised header → field, or null = leave unmapped
  positions?: Array<string | null>;         // known order, for a header-less file of exactly this width
}
```

**Recognising the layout** (`recognizeLayout`): with a header row, the layout naming the most columns wins, and it must name at least 2 (so one shared name such as `customer_id` in a custom file doesn't count). Without a header, the layout whose known width equals the file's width. Stripe's two files share no column names and differ in width (4 vs 9), so they can't be confused.

**Applying it** (`applySourcePreset`, after automatic detection): a column the layout names gets its field (`certain`) or is deliberately left unmapped; a field the layout assigns is removed from any other column; every other column keeps its automatic proposal. If no layout fits, the automatic mapping is returned unchanged.

The analyze response adds `sourceLayout` (the recognised layout's label, or null) and `sourceRecognized` (null when automatic was chosen, false when a system was chosen but no layout fit). The review screen shows "Recognized as a Stripe account copy file…" or a warning that the file was detected automatically.

| Stripe layout | File (per Stripe's guides) | Mapping |
|---|---|---|
| Account copy | `customer_id_old, source_id_old, customer_id_new, source_id_new` | old customer → previous processor id; old source → unmapped; new customer → Stripe Customer ID; new source → Payment Token |
| Import from another processor | `old_customer_id, customer_id, old_card_id, card_id, card_fingerprint, card_last4, card_exp_month, card_exp_year, card_brand` (Payment Method imports: `old_payment_method_id, payment_method_id`) | old customer → previous processor id; `customer_id` → Stripe Customer ID; `card_id` / `payment_method_id` → Payment Token; old ids and fingerprint → unmapped; last4 / expiry / brand mapped |

Without the Stripe choice, automatic detection reads `old_customer_id` as a Legacy Customer ID, which is the wrong key, and the exact processor-id match is lost.

### 16.2 Processor customer id

- **Schema** (migration 166): `cus_customers.processor_customer_id VARCHAR(255)`, indexed on `(business_id, processor_customer_id)`.
- **Customer import**: new optional field `processor_customer_id` (header synonyms such as Stripe Customer ID, Processor Customer ID; a `cus_` column is also found by value). Stored fill-empty, like the legacy id.
- **Why not `pay_customer_refs`**: that table holds the id DayStream charges through. Before the cards are copied, a legacy system's processor id belongs to the previous system's processor account, and reusing it as a charging reference would make saving a new card fail. The payment-method import writes `pay_customer_refs` itself once it imports the card.

### 16.3 Customer matching order

`matchCustomer` (import-core) tries, strongest first, and resolves only when exactly one customer matches:

1. Processor customer id: the row's previous processor id, then its Stripe Customer ID (a Stripe-to-Stripe copy keeps customer ids unchanged)
2. Legacy Customer ID
3. Email (case-insensitive)
4. Phone

A key that matches several customers (a shared email or phone) is skipped. When nothing resolves, the row fails with a reason naming every key tried. `noCustomerReason` accepts either the match input or a field-mapped row.

### 16.4 Not yet built

- Looking up a Stripe customer in the business's connected Stripe account to find its email and phone when a row has no other key.
- Name agreement as a second check on email and phone matches.
- Choosing the customer by hand in the review table for unmatched or ambiguous rows.
- JSON mapping files (Stripe offers CSV or JSON; ask for CSV).

---

## 17. Dates, Times, Statuses & Balance Re-runs

Correctness fixes found while writing the upload-screen field reference.

### 17.1 Date order

`parseDateCell(value, order)` (import-core) reads ISO dates, numeric dates with `/`, `-` or `.` and 2- or 4-digit years in the given order (`mdy` or `dmy`), then anything the JavaScript date parser understands. Two-digit years up to ten years ahead are 20xx, otherwise 19xx (birth dates).

The order is a property of the **file**, not the row (one export, one format):

1. `analyze` runs `detectDateOrder` over every cell of the file: a first part over 12 means day-first, a second part over 12 means month-first; none, or both, gives null. It returns `dateOrder`.
2. The client sends `date_order` with every `commit-rows` batch, so all batches read dates the same way.
3. When it's null, `businessDateOrder` uses the business's country: its first location's country, else its phone number's country. Month-first for the US and its territories, the Philippines and a few Pacific states; day-first elsewhere; month-first when nothing is known.

Every import uses it, including the customer import's date of birth and joined date (previously passed to the JavaScript parser as-is).

### 17.2 Appointment times

The file's date and time are the business's wall-clock time. `appointmentStart` converts them with `localToUtc` in `sys_businesses.timezone`; a blank time is local noon; a time that can't be read fails the row.

### 17.3 Appointment statuses

A future row whose status means it won't happen (cancelled, no-show, late cancel, missed, declined, void) is not a live booking: it's written to the timeline as history and never uses a package session. Statuses are normalised (case, `_`, `-`, spaces) before comparison, so "checked in", "checked-in" and "checked_in" all count as attended for past rows.

### 17.4 Account balances re-run

Migration 167 adds `import_key` to `pay_credit_notes` and `pay_invoices` (unique per business where set). `balanceImportKey` hashes kind + customer + amount + paid amount + dates + normalised description. The import checks it (and a per-file set) before issuing; a hit is reported as matched. `issueCreditNote` and `issueImportedInvoice` take an optional `importKey`; nothing else sets it, so staff-created balances are never matched. Two identical balances for one customer in one file collapse to one, an accepted limitation since balances carry no external reference.

### 17.5 Customer matching

`customerMatchInput(row)` builds the match keys for every customer-linked import, so each tries the processor customer id first (§16.3). Every import's field list offers Processor Customer ID.
