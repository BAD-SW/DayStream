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

---

## 8. Migration Order

Locked sequence (documented for tenant owners):

```
Setup (configured) → Customers → Payment Methods → Memberships → Packages → Appointments → Account Balances → Transaction History
```

- **Hard dependencies**: Payment Methods before Memberships (default method to auto-link); Packages before Appointments (so appointment import derives fulfillment).
- **Everything else** is a chosen-and-locked order (memberships ahead of packages/appointments by business priority), not a technical chain.
- **Skippable**: any step nothing downstream needs. Skip Packages → appointment import simply finds no package to fulfill. Skip Payment Methods → memberships import active-but-not-auto-charged.
- Customers is always first (everything attaches to a customer).

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

:kind ∈ customers | payment_methods | memberships | packages | appointments | account_balances | transactions
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
