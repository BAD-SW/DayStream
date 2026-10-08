# Phase 10: Payment Platform - Design Document

**Date**: October 8, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 09

---

## Overview

This document describes the technical design for the DayStream Payment Platform — the single home for all billing and payment processing. It is organized as a foundation (payment methods, provider abstraction, tokenized capture) plus three billing relationships that build on it:

- **Section 0 — Foundation:** the `PaymentAdapter` abstraction, the payment-method catalog, and a shared tokenized-capture mechanism reused at every layer.
- **Section A — Platform Billing (DayStream → Tenant):** automatic monthly, in-arrears charges on a per-tenant negotiated plan.
- **Section B — Tenant Billing (Tenant → Business):** the same model one level down (tenant charges business).
- **Section C — Customer → Business Payments:** businesses collect directly from customers into their own connected accounts.

Core principles carried from requirements:

- **No pass-through.** Money never flows through DayStream. Businesses collect directly into their own accounts; tenants carry their own accounts so DayStream can bill them; nothing flows "down" (no payouts) except out-of-system termination handling.
- **Automatic charge, not accounts receivable** (Sections A and B). On the billing day the system charges a stored, tokenized instrument. There is no receivable and no document to pay from; a charge record is kept for transparency only.
- **"Bill what it's told."** The system owns scheduling, recurrence, proration, and dunning; the provider only executes `charge` / `refund` / `tokenize`.
- **Actuals, not contracted.** Percentage billing is based on amounts actually collected.
- **Per-level scheduling.** Each level (DayStream, each tenant, each business) configures its own daily billing run time, in its own timezone, managed by its own admin.
- **Provider-agnostic.** All provider interaction goes through the `PaymentAdapter`. Stripe is the first adapter; others can be added without changing billing logic.
- **Build on what exists, don't duplicate.** Significant infrastructure already exists (the job scheduler, membership plans and enrollments, the payment-transaction ledger, accepted-methods config). This phase extends and completes that infrastructure rather than creating parallel systems. See Section 1 (Existing vs. New).

---

## Table of Contents

1. [Existing vs. New](#1-existing-vs-new)
2. [Database Schema](#2-database-schema)
3. [Payment Provider Abstraction](#3-payment-provider-abstraction)
4. [Payment Methods & Tokenized Capture](#4-payment-methods--tokenized-capture)
5. [Section A — Platform Billing (DayStream → Tenant)](#5-section-a--platform-billing-daystream--tenant)
6. [Section B — Tenant Billing (Tenant → Business)](#6-section-b--tenant-billing-tenant--business)
7. [Section C — Customer → Business Payments](#7-section-c--customer--business-payments)
8. [Net Collections Reconciliation (C → B → A)](#8-net-collections-reconciliation-c--b--a)
9. [Scheduled Billing Runs](#9-scheduled-billing-runs)
10. [Customer-Facing Document Customization](#10-customer-facing-document-customization)
11. [API Endpoints](#11-api-endpoints)
12. [Frontend Views](#12-frontend-views)
13. [Security & Compliance](#13-security--compliance)

---

## 1. Existing vs. New

This phase builds on infrastructure already in the codebase. The table below maps each capability to what exists and what this phase adds, so implementation extends and completes current systems rather than duplicating them.

| Capability | Status | Reuse / Build on |
|------------|--------|------------------|
| Daily, timezone-aware scheduling + Run/Schedule/History + execution audit | **Exists** | `sys_scheduled_jobs`, `sys_job_executions`, `jobs/job-scheduler.ts` (polls, claims via `FOR UPDATE SKIP LOCKED`, timezone-aware `calculateNextRun`, retries/failure tracking); control-plane routes in `routes/customers.ts`; Settings → Processes UI |
| Job handlers registry (incl. `billing_process` = "Recurring Charges") | **Exists (stub)** | `jobs/job-registry.ts`. `billing_process` today only auto-resumes paused memberships — **this phase adds the actual charge generation here** |
| Membership/recurring plan definitions | **Exists** | `mbr_plans` (billing_frequency, price, trial_days, status); routes/services/UI under Offerings → Memberships |
| Customer subscription records (the "subscription") | **Exists** | `mbr_enrollments` (status, `next_billing_date`, period dates, pause/cancel/pending-plan; billing index already present). **Reused as-is** — no new subscription table |
| Customer payment ledger | **Exists** | `pay_transactions` (migration 043) — charge/refund records. **Extended/aligned**, not re-created |
| Business accepted payment methods | **Exists** | `pay_accepted_methods` (migration 045) + Settings UI. **Reused** |
| Tenant/business settlement account fields | **Exists** | migration 033 payment account fields on tenants/businesses |
| **Tokenized "payment methods on file" vault (PSP-backed)** | **NEW** | "Add Method" is a UI placeholder today; a real tokenized store is new work (`pay_payment_methods`) |
| **PaymentAdapter / Stripe integration** | **NEW** | No provider integration exists; all real charging is new |
| **Charge generation for recurring billing** | **NEW** | `mbr_enrollments.next_billing_date` is computed but nothing charges on it today |
| **Platform billing (A) & Tenant billing (B) plans/charges/credits** | **NEW** | Existing billing is only customer→business memberships; the two upper layers are new |
| **Per-level scheduling scope (platform/tenant)** | **NEW (extension)** | `sys_scheduled_jobs` is currently `business_id NOT NULL`; scope must be widened to support platform- and tenant-level jobs |
| **Dunning, invoices, gift cards, vouchers, document branding** | **NEW** | No existing implementations |

**Guiding rule for implementation:** do not introduce a second scheduler, a second subscription table, or a second payment ledger. Extend `sys_scheduled_jobs` (scope + new job types), charge against `mbr_enrollments`, and record through `pay_transactions`.

---

## 2. Database Schema

All tables carry `tenant_id UUID NOT NULL` with an RLS policy per project convention; business-scoped tables also carry `business_id`. Monetary values are integer cents; percentage rates are stored as basis points (e.g. 1% = 100 bp) to avoid floats. Payment-platform tables use the `pay_` prefix; existing `sys_tenants`, `sys_businesses`, `usr_users`, and customer tables are referenced where they already exist.

### Processor Connections

A connected provider account, held at the layer that collects money: DayStream (platform), a tenant, or a business.

```sql
CREATE TABLE pay_processor_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- NULL = tenant- or platform-level
    owner_level VARCHAR(10) NOT NULL CHECK (owner_level IN ('platform', 'tenant', 'business')),
    provider VARCHAR(30) NOT NULL DEFAULT 'stripe',   -- extensible: 'stripe', ...
    provider_account_ref VARCHAR(255),                -- provider-side account id (never secrets)
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Billing Run Schedules — REUSE `sys_scheduled_jobs` (no new table)

Scheduling reuses the existing `sys_scheduled_jobs` / `sys_job_executions` framework (migration 034, `sys_` prefix from 036) — which is already daily/timezone-aware with Run/Schedule/History and execution auditing. This phase does NOT add a scheduling table. Two extensions are required:

1. **Widen scope.** `sys_scheduled_jobs.business_id` is currently `NOT NULL`. Make it nullable and add a scope discriminator so a job can be platform-level (DayStream), tenant-level, or business-level:

```sql
-- Extension to the existing sys_scheduled_jobs (not a new table)
ALTER TABLE sys_scheduled_jobs ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE sys_scheduled_jobs ADD COLUMN scope_level VARCHAR(10) NOT NULL DEFAULT 'business'
    CHECK (scope_level IN ('platform', 'tenant', 'business'));
-- Uniqueness becomes per (scope_level, tenant_id, business_id, job_type)
```

2. **New job types** in `job-registry.ts`: `platform_billing` (Section A) and `tenant_billing` (Section B), plus fleshing out the existing `billing_process` handler to actually generate customer charges (Section C). The timezone-aware `schedule_time` / `schedule_timezone` columns already express "run at 02:00 in the entity's timezone."

### Payment Methods (Tokenized Instruments)

One row per stored, tokenized instrument. Used as the Tenant_Payment_Account (A), Business_Payment_Account (B), and customer stored methods (C). No raw credentials are ever stored.

```sql
CREATE TABLE pay_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    owner_level VARCHAR(10) NOT NULL CHECK (owner_level IN ('platform', 'tenant', 'business', 'customer')),
    business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- set for business/customer scope
    customer_id UUID,                                 -- set when owner_level = 'customer'
    method_type VARCHAR(20) NOT NULL
        CHECK (method_type IN ('card', 'bank_draw', 'google_pay', 'apple_pay')),
    provider VARCHAR(30) NOT NULL DEFAULT 'stripe',
    provider_token VARCHAR(255) NOT NULL,             -- vault token, NOT the raw instrument
    display_brand VARCHAR(40),                        -- e.g. 'Visa', 'SEPA'
    display_last4 VARCHAR(4),
    exp_month SMALLINT,                               -- card only
    exp_year SMALLINT,                                -- card only
    is_default BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Accepted Payment Methods (per Business, Section C) — REUSE existing (migration 045)

Which methods a business accepts from customers already exists as the accepted-payment-methods config (migration 045) behind the Settings → Payment Methods screen. **Reused as-is.** The only addition is ensuring the method set covers the full catalog (`bank_draw`, `google_pay`, `apple_pay` where not already present), added via a small migration if needed. No new table.

### Billing Plans (Sections A and B)

One plan shape serves both layers via `plan_level`. The payer is a tenant (A) or a business (B).

```sql
CREATE TABLE pay_billing_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    plan_level VARCHAR(10) NOT NULL CHECK (plan_level IN ('platform', 'tenant')),  -- platform=A, tenant=B
    payer_business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,        -- set for B (plan_level='tenant')
    flat_amount INTEGER NOT NULL DEFAULT 0,            -- cents per cycle
    percentage_bp INTEGER NOT NULL DEFAULT 0,          -- basis points of net collections
    cap_amount INTEGER,                                -- cents; NULL = no cap
    cap_scope VARCHAR(12) CHECK (cap_scope IN ('percentage', 'combined')),
    intro_months SMALLINT NOT NULL DEFAULT 0,          -- N months of intro rule
    intro_flat_amount INTEGER NOT NULL DEFAULT 0,      -- intro-period flat
    intro_percentage_bp INTEGER NOT NULL DEFAULT 0,    -- intro-period percentage
    billing_day SMALLINT NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
    payment_method_id UUID REFERENCES pay_payment_methods(id),  -- instrument charged each cycle
    plan_start DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    created_by UUID REFERENCES usr_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Plan terms are versioned (see `pay_billing_plan_history`) so past charges remain explainable after a plan changes.

```sql
CREATE TABLE pay_billing_plan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES pay_billing_plans(id) ON DELETE CASCADE,
    snapshot JSONB NOT NULL,                           -- full plan terms at the time
    changed_by UUID REFERENCES usr_users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Billing Charges (Sections A and B)

The monthly charge record raised and auto-settled against a payer. Serves both layers via `charge_level`.

```sql
CREATE TABLE pay_billing_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    charge_level VARCHAR(10) NOT NULL CHECK (charge_level IN ('platform', 'tenant')),  -- A or B
    payer_business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,            -- set for B
    plan_id UUID NOT NULL REFERENCES pay_billing_plans(id),
    reference_number BIGINT NOT NULL,                  -- sequential per issuer
    cycle_start DATE NOT NULL,
    cycle_end DATE NOT NULL,
    net_collections INTEGER NOT NULL DEFAULT 0,        -- cents, basis for percentage
    flat_component INTEGER NOT NULL DEFAULT 0,
    percentage_component INTEGER NOT NULL DEFAULT 0,
    cap_applied BOOLEAN NOT NULL DEFAULT false,
    credit_applied INTEGER NOT NULL DEFAULT 0,
    amount_charged INTEGER NOT NULL DEFAULT 0,         -- after cap + credit, floored at 0
    settlement_status VARCHAR(12) NOT NULL DEFAULT 'pending'
        CHECK (settlement_status IN ('pending', 'settled', 'failed', 'retrying')),
    breakdown JSONB,                                   -- per-business net-collection detail (A)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ,
    UNIQUE(charge_level, payer_business_id, cycle_start)  -- idempotency per cycle (B)
);
```

### Billing Credits (Sections A and B)

Admin-issued credits that reduce future charges and carry forward. Never produce a payout.

```sql
CREATE TABLE pay_billing_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    credit_level VARCHAR(10) NOT NULL CHECK (credit_level IN ('platform', 'tenant')),
    payer_business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- set for B
    amount INTEGER NOT NULL,                            -- cents issued
    amount_remaining INTEGER NOT NULL,                 -- carry-forward balance
    reason TEXT NOT NULL,
    issued_by UUID NOT NULL REFERENCES usr_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Transactions (Section C — Customer Payments) — EXTEND existing `pay_transactions`

`pay_transactions` already exists (migration 043, with method metadata in 044) as the customer payment/refund ledger — currently populated by manual payment recording. This phase **reuses and extends** it rather than defining a new ledger; it is the source the net-collections feed (Section 8) is computed from. Columns that need to be present (adding any that are missing via a new migration):

```sql
-- Target shape of the existing pay_transactions after this phase's additions.
-- Columns already present from migrations 043/044 are retained; new columns noted.
--   txn_type        VARCHAR  -- 'charge' | 'refund' (existing; 'credit' also present historically)
--   method_type     VARCHAR  -- cash/card/bank_draw/check/gift_card/google_pay/apple_pay/other
--   amount          INTEGER  -- cents
--   status          VARCHAR  -- pending/succeeded/failed
--   parent_transaction_id UUID -- refund → original (existing refund linkage)
--   provider_reference VARCHAR -- NEW: PSP charge reference for processed methods
--   is_processed    BOOLEAN    -- NEW: true = via provider; false = manual/record
--   payment_method_id UUID     -- NEW: FK to pay_payment_methods (tokenized vault)
--   enrollment_id   UUID       -- NEW: FK to mbr_enrollments (recurring charge source)
--   invoice_id      UUID       -- NEW: FK to pay_invoices (invoice settlement)

ALTER TABLE pay_transactions
    ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_processed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES pay_payment_methods(id),
    ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES mbr_enrollments(id),
    ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES pay_invoices(id);
```

The widget's `simulated` transactions (migrations 109/110) are replaced by real processed-method charges once the adapter is live.

### Subscriptions (Section C) — REUSE `mbr_enrollments` (no new table)

The subscription record already exists as `mbr_enrollments` (migration 052 + follow-ups): it has `status`, `next_billing_date`, `current_period_start/end`, pause/resume/cancel, and `pending_plan` for scheduled plan changes, with a billing index on `next_billing_date WHERE status='active'`. This phase does **not** create a `pay_subscriptions` table — it adds the *charging* against existing enrollments. One extension is needed to link an enrollment to the stored method it charges:

```sql
-- Extension to the existing mbr_enrollments (not a new table)
ALTER TABLE mbr_enrollments ADD COLUMN payment_method_id UUID REFERENCES pay_payment_methods(id);
```

The recurring amount and interval come from the enrollment's `mbr_plans` row (`price`, `billing_frequency`); the Payment Platform owns the charge execution and dunning on top.

### Dunning (Section C)

Tracks failed enrollment charges and the configurable retry schedule.

```sql
CREATE TABLE pay_dunning_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES mbr_enrollments(id) ON DELETE CASCADE,
    attempt_number SMALLINT NOT NULL,
    scheduled_for DATE NOT NULL,
    outcome VARCHAR(12) CHECK (outcome IN ('settled', 'failed', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Invoices (Section C — optional per business)

A true payable document for businesses that choose invoice-based billing.

```sql
CREATE TABLE pay_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL,
    invoice_number BIGINT NOT NULL,                    -- sequential per business, no gaps
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    subtotal INTEGER NOT NULL,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'issued'
        CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void')),
    pdf_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, invoice_number)
);

CREATE TABLE pay_invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES pay_invoices(id) ON DELETE CASCADE,
    description VARCHAR(200) NOT NULL,
    quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    amount INTEGER NOT NULL
);
```

### Gift Cards & Vouchers (Section C — business-scoped)

```sql
CREATE TABLE pay_gift_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- redeemable only here
    code VARCHAR(32) NOT NULL UNIQUE,
    initial_amount INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    recipient_email VARCHAR(255),
    expires_at DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'depleted', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pay_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL UNIQUE,
    discount_type VARCHAR(12) NOT NULL CHECK (discount_type IN ('free', 'fixed', 'percentage')),
    discount_value INTEGER,                            -- cents or basis points
    applies_to JSONB,                                  -- service/category ids
    single_use BOOLEAN NOT NULL DEFAULT true,
    expires_at DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Document Branding (Customer-Facing Customization)

Per-business branding/messaging for all customer-facing artifacts.

```sql
CREATE TABLE pay_document_branding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
    artifact_type VARCHAR(24) NOT NULL,                -- 'invoice','receipt','dunning', etc.; 'default' row allowed
    logo_path TEXT,
    color_primary VARCHAR(9),
    sender_name VARCHAR(120),
    subject_template TEXT,
    body_template TEXT,
    footer_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, artifact_type)
);
```

---

## 3. Payment Provider Abstraction

A single `PaymentAdapter` interface serves all three billing layers, operating against a connected account supplied by the caller. It follows the "bill what it's told" model — the system decides amount, method, and timing; the provider only executes single operations.

```typescript
interface PaymentAdapter {
  // All operations run against a specific connected account.
  charge(input: ChargeInput): Promise<AdapterResult>;        // one-off or system-driven recurring charge
  refund(input: RefundInput): Promise<AdapterResult>;        // full or partial
  tokenize(input: CaptureInput): Promise<TokenResult>;       // store a method, return vault token
  removeMethod(token: string, account: ConnectedAccount): Promise<void>;
  getStatus(providerReference: string, account: ConnectedAccount): Promise<ChargeStatus>;
  listTransactions(account: ConnectedAccount, range: DateRange): Promise<AdapterTxn[]>;
  // Webhook ingestion normalizes provider events into common types.
  parseWebhook(payload: unknown, signature: string): NormalizedEvent;
}

interface ConnectedAccount {
  provider: 'stripe';                 // extensible
  providerAccountRef: string;         // DayStream / tenant / business account
  ownerLevel: 'platform' | 'tenant' | 'business';
}
```

Notes:
- **No** `createSubscription` / `cancelSubscription`. Recurrence lives in `mbr_enrollments` (reused) and is driven by the daily `billing_process` job.
- `StripeAdapter` is the first implementation. Provider selection is per connection (`pay_processor_connections.provider`). Adding a provider = a new adapter class; billing logic is untouched.
- Webhooks are normalized (`charge.succeeded`, `charge.failed`, `refund.succeeded`, `method.updated`) so downstream logic is provider-independent.
- Idempotency keys are passed on every `charge` so retries never double-charge.

---

## 4. Payment Methods & Tokenized Capture

### Method classification

| Method | Class | Flows | Recurring-capable |
|--------|-------|-------|-------------------|
| Card | Processed | A, B, C | Yes |
| Bank Draw (ACH/SEPA mandate) | Processed | A, B, C | Yes |
| Google Pay | Processed | C | As provider supports |
| Apple Pay | Processed | C | As provider supports |
| Cash | Manual/Record | C | No |
| Check | Manual/Record | C | No |
| Gift Card | Internal | C | No |
| Other | Manual/Record | C | No |

### Shared capture mechanism

A single capture component/flow is reused everywhere a tokenized instrument is stored:
- DayStream captures a **tenant's** instrument (Section A).
- A tenant captures a **business's** instrument (Section B).
- A business/customer captures a **customer's** instrument (Section C).

The flow: client requests a capture session → `adapter.tokenize` collects the instrument via the provider's hosted fields / mandate / wallet sheet → provider returns a vault token → stored in `pay_payment_methods` with masked display only. Raw PANs, CVVs, and raw bank credentials never touch DayStream servers.

### Availability resolution (Section C checkout)

```
offered_methods =
    pay_accepted_methods (enabled for business)
    ∩ methods valid for the payment context (recurring ⇒ exclude cash/check/gift_card/other)
    ∩ methods the active provider supports in the business's region
```

---

## 5. Section A — Platform Billing (DayStream → Tenant)

### Plan model

A `pay_billing_plans` row with `plan_level = 'platform'`, one per tenant, managed by DayStream admins. Flat and/or percentage, optional per-cycle cap, intro period, configurable billing day, charged to a stored `Tenant_Payment_Account`.

### Charge computation (per cycle, in arrears)

```
net_collections   = Σ net amount collected/remitted from the tenant's businesses to the tenant
                    (actuals, not contracted; per-business summary; never negative)
flat              = intro_flat if within intro_months else flat_amount
percentage        = (intro_percentage_bp or percentage_bp) × net_collections / 10000
raw               = flat + percentage
capped            = apply cap_amount by cap_scope (percentage-only or combined), if set
after_credit      = max(0, capped − outstanding tenant credit)   // excess credit carries forward
amount_charged    = after_credit
```

A zero amount records a zero charge (no transaction attempted). The result is written to `pay_billing_charges` and settled via `adapter.charge` against the tenant's payment method.

### Failed charges & suspension

- A declined charge becomes `settlement_status = 'failed'`, surfaced on the failed-charge report, and retried on each subsequent daily run.
- Charges from different cycles are tracked and retried **independently** (separate `pay_billing_charges` rows, never merged).
- A DayStream admin may manually set the plan `status = 'suspended'`, halting retries. Suspension has **no** effect on the tenant's businesses. Downstream business re-routing is out of scope (separate business-transfer functionality).

---

## 6. Section B — Tenant Billing (Tenant → Business)

Structurally identical to Section A, one level down, reusing the same tables via the `tenant` level discriminator:

- `pay_billing_plans.plan_level = 'tenant'`, `payer_business_id` set; managed by **tenant** admins.
- `net_collections` = the net amount a **single business** actually collected from its customers (from `pay_transactions`, see Section 7).
- Charged to the stored `Business_Payment_Account`.
- `pay_billing_charges.charge_level = 'tenant'`; credits in `pay_billing_credits` with `credit_level = 'tenant'`.
- Same daily run, failed-charge retry, and manual-suspension behavior. Suspending a business for tenant-billing does **not** stop that business collecting from its customers (Section C).

The shared schema and shared computation function (`computeBillingCharge(plan, netCollections, outstandingCredit)`) mean A and B are the same engine parameterized by level — a design that keeps them permanently in sync.

---

## 7. Section C — Customer → Business Payments

Businesses collect directly into their own connected accounts. The system never holds the funds.

### One-time payment flow

```
1. Pricing Engine (Phase 09) provides Final_Price
2. Resolve offered methods (Section 3 availability)
3. Processed method:  adapter.charge(business account, amount, method/token)
   Manual method:     record the payment (is_processed = false), no provider call
   Internal (gift):   decrement pay_gift_cards.balance, record redemption
4. On success: confirm booking (Phase 07), write pay_transactions (txn_type='charge')
   On failure: release reservation, return clear error
5. Issue receipt (or invoice if the business uses invoicing)
```

### Subscription renewal flow (system-owned)

```
billing_process job selects mbr_enrollments where next_billing_date <= today and status='active'
→ adapter.charge(business account, plan price, enrollment.payment_method_id)
→ success: write pay_transactions, advance next_billing_date, roll mbr_usage, update Membership (Phase 08)
→ failure: open dunning (pay_dunning_attempts), set enrollment past_due
          retry per configurable schedule; exhausted ⇒ Membership Expired
```

### Refunds

Full or partial via `adapter.refund` against the original transaction; validated not to exceed the original; permissioned (Manager/Owner); reason required; writes a `refund` transaction linked to the parent; emits a credit note. Manual-method payments are refunded as recorded (out-of-band) rather than via the provider.

### Invoicing (optional per business)

A business opts into invoice-based billing. Issued invoices (`pay_invoices`) are payable documents with a due date, settled online via any enabled Processed method, numbered sequentially per business with no gaps. Businesses not using invoicing simply take payment at time of service and issue receipts.

### Gift cards & vouchers

Business-scoped. Gift cards hold an internal balance redeemable only at the issuing business (partial redemption supported). Vouchers apply a discount via the Pricing Engine's `Price_Breakdown`.

---

## 8. Net Collections Reconciliation (C → B → A)

The three layers reconcile through one recorded figure:

```
Section C  pay_transactions (charge − refund, per business, per cycle)
             │  net amount a business actually collected
             ▼
Section B  net_collections for that business  →  tenant's percentage charge
             │  summed across the tenant's businesses
             ▼
Section A  net_collections for the tenant     →  DayStream's percentage charge
```

- A monthly rollup (`computeBusinessNetCollections(businessId, cycle)`) sums succeeded `charge` transactions minus same-cycle `refund` transactions for a business. Never negative; never retroactively restated — a later refund reduces the later cycle.
- Section B consumes the per-business figure directly. Section A aggregates all businesses in the tenant and stores the per-business detail in `pay_billing_charges.breakdown` for explainability.

---

## 9. Scheduled Billing Runs (Reusing `sys_scheduled_jobs`)

Billing is not one global job at a fixed server time. Each level has its own `sys_scheduled_jobs` row with `frequency='daily'`, a configurable `schedule_time`, and the entity's `schedule_timezone`, managed by that entity's own admin through the existing Processes framework:

| Level | Scheduled job | Managed by | Covers | Timezone |
|-------|---------------|------------|--------|----------|
| Platform (A) | one `platform_billing` job | DayStream admin | Section A tenant charges + retries | platform tz |
| Tenant (B) | one `tenant_billing` job per tenant | tenant admin | Section B business charges + retries | tenant tz |
| Business (C) | one `billing_process` job per business (exists) | business owner/manager | Section C enrollment renewals + dunning | business tz |

So 52 tenants means 52 `tenant_billing` rows; each business already has (or gets) a `billing_process` row. These are configured through the same Run / Schedule / History UI that exists today.

### What's reused vs. added

- **Reused:** `jobs/job-scheduler.ts` already polls (60s), claims due jobs safely (`FOR UPDATE SKIP LOCKED`), computes the next run in the entity's timezone (`calculateNextRun`), tracks `last_run_status` / `consecutive_failures`, and writes a `sys_job_executions` row per run. No new scheduler, no new history table.
- **Added:** two new handlers in `job-registry.ts` (`platform_billing`, `tenant_billing`), and the real charge logic inside the existing `billing_process` handler (which today only auto-resumes paused memberships). Scope widening (`scope_level`, nullable `business_id`) lets platform/tenant jobs exist alongside business jobs. New types are added to `getAvailableJobTypes()` so they appear in the Processes UI at the appropriate admin level.

### Handler logic

```
platform_billing (scope = platform):      // Section A
   due_tenants  = pay_billing_plans (plan_level='platform', active) whose billing_day resolves to local today
   retry_tenants = tenants with failed/retrying pay_billing_charges (active)
   for each: upsert this cycle's pay_billing_charges (idempotent per cycle),
             settle via adapter.charge against Tenant_Payment_Account

tenant_billing (scope = tenant):           // Section B
   same as above for the tenant's businesses (plan_level='tenant')

billing_process (scope = business):        // Section C — flesh out existing stub
   renew mbr_enrollments WHERE next_billing_date <= local today AND status='active'
         → adapter.charge against the enrollment's payment_method_id
         → on success: write pay_transactions, advance next_billing_date, roll mbr_usage
         → on failure: open pay_dunning_attempts, set past_due
   process due pay_dunning_attempts (retries)
   (retain existing autoResumeExpiredPauses behavior)
```

The scheduler's existing per-job `next_run_at` recomputation (timezone-aware) already guarantees one run per local day per entity, so no separate idempotency guard is needed at the schedule level; per-cycle idempotency on `pay_billing_charges` prevents duplicate charges within a run.

---

## 10. Customer-Facing Document Customization

All customer-facing artifacts (invoices, receipts, credit notes, dunning notices, payment/refund confirmations, renewal reminders, gift-card emails) render through a template layer that merges:

1. A platform-provided default template (ensures correct rendering before customization).
2. The business's `pay_document_branding` row for that artifact type (logo, colors, sender identity, subject/body/footer).
3. Localization (i18n, Phase 03) applied alongside branding.

Rendering is business-scoped — one business's branding never appears on another's artifacts — and customized output must remain WCAG-compliant (contrast). Emailed and PDF versions of the same artifact share the merged template so they match.

---

## 11. API Endpoints

### Foundation — Methods & Processor (Section 0)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pay/methods` | List stored payment methods (scoped by owner) |
| POST | `/api/v1/pay/methods/capture-session` | Begin a tokenized capture session (shared mechanism) |
| POST | `/api/v1/pay/methods` | Store a tokenized method from a capture result |
| PUT | `/api/v1/pay/methods/:id/default` | Set default method |
| DELETE | `/api/v1/pay/methods/:id` | Remove a stored method |
| GET | `/api/v1/pay/processors` | List supported providers / connections |
| POST | `/api/v1/pay/processors/connect` | Connect a provider account (tenant/business) |
| POST | `/api/v1/pay/webhooks/:provider` | Provider webhook ingestion (normalized) |

### Section A — Platform Billing (DayStream admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pay/platform-billing/plans/:tenantId` | Get a tenant's platform billing plan |
| PUT | `/api/v1/pay/platform-billing/plans/:tenantId` | Create/update plan (DayStream admin) |
| GET | `/api/v1/pay/platform-billing/charges` | List platform billing charges |
| POST | `/api/v1/pay/platform-billing/credits` | Issue a tenant credit |
| PUT | `/api/v1/pay/platform-billing/:tenantId/suspend` | Suspend a tenant's billing |
| GET | `/api/v1/pay/platform-billing/failed` | Failed-charge report |
| GET | `/api/v1/pay/platform-billing/schedule` | Get the platform billing run time |
| PUT | `/api/v1/pay/platform-billing/schedule` | Set the platform billing run time (DayStream admin) |

### Section B — Tenant Billing (tenant admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pay/tenant-billing/plans/:businessId` | Get a business's billing plan |
| PUT | `/api/v1/pay/tenant-billing/plans/:businessId` | Create/update plan (tenant admin) |
| GET | `/api/v1/pay/tenant-billing/charges` | List business billing charges |
| POST | `/api/v1/pay/tenant-billing/credits` | Issue a business credit |
| PUT | `/api/v1/pay/tenant-billing/:businessId/suspend` | Suspend a business's billing |
| GET | `/api/v1/pay/tenant-billing/failed` | Failed-charge report |
| GET | `/api/v1/pay/tenant-billing/schedule` | Get this tenant's billing run time |
| PUT | `/api/v1/pay/tenant-billing/schedule` | Set this tenant's billing run time (tenant admin) |

### Section C — Customer Payments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/pay/charges` | Take a one-time payment (business_id required) |
| POST | `/api/v1/pay/refunds` | Refund a transaction (Manager/Owner) |
| GET | `/api/v1/pay/transactions` | List transactions (filterable) |
| POST | `/api/v1/pay/subscriptions` | Create a subscription |
| PUT | `/api/v1/pay/subscriptions/:id/cancel` | Cancel (period-end or immediate) |
| GET | `/api/v1/pay/accepted-methods` | Get a business's accepted methods |
| PUT | `/api/v1/pay/accepted-methods` | Update accepted methods |
| POST | `/api/v1/pay/invoices` | Issue an invoice (if business uses invoicing) |
| PUT | `/api/v1/pay/invoices/:id/pay` | Settle an outstanding invoice online |
| GET | `/api/v1/pay/invoices` | List invoices |
| POST | `/api/v1/pay/gift-cards` | Issue a gift card |
| POST | `/api/v1/pay/gift-cards/redeem` | Redeem (full/partial) |
| POST | `/api/v1/pay/vouchers` | Create a voucher |
| GET | `/api/v1/pay/reports/*` | Payment reporting (revenue, refunds, MRR, net collections) |
| GET | `/api/v1/pay/branding` | Get document branding |
| PUT | `/api/v1/pay/branding` | Update document branding |
| GET | `/api/v1/pay/billing-schedule` | Get this business's recurring-billing run time |
| PUT | `/api/v1/pay/billing-schedule` | Set this business's recurring-billing run time (owner/manager) |

All business-scoped endpoints require `business_id`; all are RLS/tenant-scoped per project convention.

---

## 12. Frontend Views

### Platform Billing (DayStream admin) (`/admin/platform-billing`)
- Per-tenant plan editor (flat/percentage/cap/intro/billing day, payment method capture)
- Charge history, credits, carry-forward balance, failed-charge report, suspend control
- Platform billing run-time setting (time of day, platform timezone)

### Tenant Billing (tenant admin) (`/billing/businesses`)
- Per-business plan editor (mirror of platform billing)
- Charge history, credits, failed-charge report, suspend control
- Tenant billing run-time setting (time of day, tenant timezone)

### Payment Methods (shared capture) 
- Reusable "add/manage payment method" component embedded wherever an instrument is captured (tenant account, business account, customer wallet)

### Business Payment Settings (`/settings/payments`)
- Accepted Payment Methods toggles (existing screen)
- Processor connection, document branding editor
- Invoicing on/off
- Recurring customer-billing run-time setting (time of day, business timezone)

### Checkout / Take Payment (`/checkout`, staff + customer)
- Method selection constrained by availability resolution
- Processed vs manual-record vs gift-card redemption paths

### Customer Billing (`/account/billing`, customer)
- Stored methods, subscriptions, transaction history, invoices to pay

### Payments Reporting (`/reports/payments`)
- Transactions, revenue, refunds, MRR/dunning, per-business net collections

---

## 13. Security & Compliance

- **PCI-DSS scope reduction:** no raw card/bank credentials stored; only provider vault tokens and masked display. All capture via provider hosted fields/mandate/wallet.
- **No fund custody:** DayStream never holds customer or business money; businesses collect into their own connected accounts, so DayStream is not in the funds-flow path.
- **RLS everywhere:** all `pay_*` tables carry `tenant_id` (and `business_id` where business-scoped) with row-level security; customer data access requires `customer_id + business_id`.
- **Least privilege:** refunds and billing-plan management are permission-gated (Manager/Owner for refunds; DayStream admin for Section A plans; tenant admin for Section B plans).
- **Audit trail:** plan changes, credits, suspensions, charges, refunds, and payouts-never events are logged (Phase 02).
- **Webhook verification:** provider webhooks are signature-verified before processing; charges use idempotency keys to prevent double-charging on retry.
- **Secrets:** provider API keys live in server-side configuration/secrets, never in the database rows or client.

---

**Last Updated**: October 8, 2026
