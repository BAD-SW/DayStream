# Implementation Plan: 10 — Payment Platform

## Overview

Tasks are grouped into build phases that follow the dependency order in design.md: the shared foundation (provider abstraction, tokenized methods) first, then the two upper billing layers (platform → tenant, tenant → business), then customer payments, then the cross-cutting concerns. Each phase ends with a manual verification checkpoint before the next builds on it — this is money-handling code, so every layer should be proven before the next.

This phase **extends existing infrastructure** rather than duplicating it (see design.md §1, Existing vs. New):
- Scheduling reuses `sys_scheduled_jobs` / `sys_job_executions` and `jobs/job-scheduler.ts`.
- The subscription record is the existing `mbr_enrollments`.
- The customer ledger is the existing `pay_transactions`.
- Accepted-methods config (migration 045) and settlement account fields (migration 033) are reused.

Do not introduce a second scheduler, subscription table, or payment ledger.

## Task Status Legend

- ✅ **Complete** · 🟡 **In Progress** · 📋 **Planned** · ⏸️ **Blocked** · ❌ **Cancelled**

---

## Tasks

The implementation tasks are organized into the build phases below, each a numbered checklist with status markers.

## Phase 1 — Foundation: Provider Abstraction & Tokenized Methods ✅ Complete

The shared infrastructure every billing layer depends on. Provider-agnostic; Stripe is the first concrete adapter.

**Every phase must deliver backend AND the UI that consumes it, so each phase is independently validatable** (no orphan endpoints; no "validate everything at the end"). Phase 1 backend is done and verified; the UI (1.7) is outstanding, so the phase stays In Progress until a user can connect a processor and add/manage a payment method through the app.

Backend verified end-to-end via a diagnostic against real Transcend Health data (mock provider): processor connect → capture session → store method (vault token + masked display, confirmed no raw PAN leak) → first-method-default + set-default → charge + idempotent re-charge (same reference, no double-charge) → refund → forced decline → webhook normalize (valid signature accepted, bad signature rejected) → catalog + availability (one-time offered card/bank_draw/cash/check/gift_card; recurring correctly narrowed to card/bank_draw). Server type-checks clean. All test rows cleaned up.

Two caveats carried forward:
- The `StripeAdapter` is currently backed by a deterministic `MockAdapter` (`provider: 'stripe'`) — the real Stripe SDK is not a dependency yet and is wired when an account/keys are available (`TODO(stripe)` in `services/payments/index.ts`). The checkpoint therefore ran against the mock, not Stripe test mode.
- The webhook route re-serializes the parsed body for signature checking because the global `express.json()` consumes the raw body; the real Stripe adapter needs `express.raw()` mounted on the webhook path.

- [x] ✅ 1.1 Migration — payment infrastructure tables
  - `pay_processor_connections` (platform/tenant/business connected accounts, provider, provider_account_ref)
  - `pay_payment_methods` (tokenized vault: owner_level platform/tenant/business/customer, provider_token, masked display, is_default, status)
  - Extend `pay_accepted_methods` (migration 045) to cover `bank_draw`, `google_pay`, `apple_pay` if missing
  - Run `npm run migrate:dev`
  - _Done: migration `115_payment_platform_foundation.sql` applied. `bank_draw` added (processed pull method, distinct from the existing manual `bank_transfer`); `google_pay`/`apple_pay` already seeded by 045. App-level tenant isolation (no Postgres RLS), per `db/pool.ts`._
  - _Requirements: 0.1, 0.2, 0.4, 0.5_

- [x] ✅ 1.2 `PaymentAdapter` interface + `StripeAdapter`
  - Define the `PaymentAdapter` interface (`charge`, `refund`, `tokenize`, `removeMethod`, `getStatus`, `listTransactions`, `parseWebhook`) operating against a `ConnectedAccount`
  - Implement `StripeAdapter` as the first provider; no `createSubscription`/`cancelSubscription` (system owns recurrence)
  - Idempotency key on every `charge`; signature-verified webhook parsing into normalized events
  - Provider API keys from server-side config/secrets only
  - _Done: `services/payments/{adapter.ts, mock-adapter.ts, index.ts}`. Interface + `getAdapter`/`getAdapterForAccount` factory. `createSubscription`/`cancelSubscription` deliberately omitted. Stripe registered but backed by `MockAdapter` for now (`TODO(stripe)`); real SDK + secrets wiring deferred until an account/keys exist._
  - _Requirements: 0.1_

- [x] ✅ 1.3 Shared tokenized-capture mechanism
  - A single capture/tokenize flow reused at all layers (tenant, business, customer instrument)
  - `pay_payment_methods` service: capture-session, store from capture result, set default, remove, masked read
  - Never store raw PAN/CVV/bank credentials
  - _Done: `services/payment-methods.service.ts` — `MethodOwner`, `resolveConnectedAccount`, `beginCaptureSession`, `storePaymentMethod` (tokenize → store vault token + masked only), `listPaymentMethods` (never returns the token), `setDefaultPaymentMethod`, `removePaymentMethod`, internal `getProviderToken`. Verified no raw PAN is persisted or returned._
  - _Requirements: 0.5_

- [x] ✅ 1.4 Method catalog & availability resolution
  - Method classification (Processed / Manual-Record / Internal) and per-flow validity
  - Section C availability resolver: accepted ∩ context (recurring excludes manual) ∩ provider/region support
  - _Done: `services/payment-catalog.service.ts` — `METHOD_CATALOG`, `RECURRING_METHOD_SET` (card/bank_draw), `CUSTOMER_METHOD_SET`, `resolveAvailableMethods`. Verified recurring context correctly excludes cash/check/gift_card/other._
  - _Requirements: 0.2, 0.3_

- [x] ✅ 1.5 Processor connection + methods API
  - `GET/POST /pay/processors*`, `GET /pay/methods`, capture-session, store, set-default, remove
  - Webhook ingestion endpoint `POST /pay/webhooks/:provider`
  - _Done: `routes/payment-platform.ts` mounted at `/v1/pay` (catalog, available-methods, processors/connect, methods CRUD + capture-session, public webhook endpoint); registered in `routes/index.ts`. Webhook re-serializes the body for the mock HMAC check (real Stripe needs `express.raw()` on this path)._
  - _Requirements: 0.1, 0.4, 0.5_

- [x] ✅ 1.6 Checkpoint — verify foundation
  - Capture a test instrument end-to-end against Stripe test mode; confirm only a token + masked data are stored (no raw credentials)
  - Run a one-off `charge` and `refund` against a test connected account; confirm webhook normalization and idempotency (replayed charge does not double-charge)
  - _Done (backend): ran against real Transcend Health data via the mock provider (not Stripe test mode — Stripe not yet wired). Confirmed token + masked data stored (no raw PAN), charge/idempotent re-charge/refund/forced-decline, webhook normalization + bad-signature rejection, and availability narrowing. Found & fixed a `uuid = text` comparison bug (added `::uuid` casts across the method-service queries). Server `tsc` clean; diagnostic removed._
  - _Follow-up (later phase): businesses created after migration 045 have no default `pay_accepted_methods` rows — needs default-seeding on business creation._

- [x] ✅ 1.7 UI — processor connection + payment-method management (no orphan endpoints)
  - Shared, reusable **PaymentMethods** component (add via capture session, list masked, set default, remove) consuming the 1.3/1.5 endpoints — the single component reused later for tenant (Phase 2), business (Phase 3), and customer (Phase 4) instruments
  - **Processor connection** admin UI (platform level) — connect/select a provider, as a tab in AdminConfig
  - Client API wrappers in `packages/client/src/api/`; design-system components; CSS variables only
  - _Done: `api/payments.ts` (processor + method + catalog wrappers); `components/PaymentMethods.tsx` (reusable, owner-parameterized — add/list/default/remove, masked display); `pages/settings/PaymentProcessorsPanel.tsx` (platform connect + the platform's own PaymentMethods); wired as a "Payment Processors" tab in AdminConfig. Client tsc adds zero new errors (baseline 31; the lone AdminConfig Badge error is pre-existing in QueryHistoryPanel, untouched). CSS variables + design-system Button throughout._
  - _Checkpoint: a user can connect a processor and add/list/default/remove a payment method entirely through the app, with masked display and no raw credentials_
  - _Requirements: 0.1, 0.4, 0.5; design §12 Frontend Views_

- [x] ✅ 1.8 Provider configuration (credentials) — per level, schema-driven, encrypted
  - Validation feedback flagged the original processor UI as incomplete: real providers need credential configuration (API keys, webhook secret), each entity (platform/tenant/business) configures its OWN provider account (funds settle to their own bank), and the account reference is system-populated — not a free-text field that silently cleared on save
  - Server-side **provider registry** (`services/payments/provider-registry.ts`) declares each provider's config schema (field key/label/type/`required`/`secret`); Stripe fields: mode, publishable key, secret key, webhook signing secret, account id
  - Secret fields **encrypted at rest** (AES-256-GCM via the existing `utils/encryption.ts`, `ENCRYPTION_KEY`), **masked on read**, and preserved when re-saving without retyping
  - `processor-config.service.ts` + API `GET /pay/providers`, `GET`/`PUT /pay/processors/config` (per owner, `settings:*`)
  - Client: reusable schema-driven `ProcessorConfigForm` (required `*` markers, masked secret inputs, "leave blank to keep"), reused at every level; `PaymentProcessorsPanel` rewritten to use it — this also fixes the field-clearing bug (saved values now load/display)
  - Migration `116_processor_connection_config.sql` (config_json + secrets_encrypted)
  - _Verified via diagnostic: encrypt round-trip, no plaintext in DB or read view, masked display, secret preserved on blank re-save, required-field validation. Server tsc 0 errors._
  - _Requirements: 0.1, 0.4; design §2 (provider abstraction), §13 (secrets never in DB/client)_

- [x] ✅ 1.9 Real Stripe integration — Card capture (test mode)
  - Replaces the mock-only capture with a real Stripe round-trip for the **Card** method (Bank Draw, Google Pay, Apple Pay to follow one at a time)
  - Server: `stripe` SDK + real `StripeAdapter` (built per-connection from the decrypted secret key) — `createSetupIntent`, `tokenize` (reads back brand/last4/exp from the confirmed PaymentMethod), `charge`/`refund`/`getStatus`/`listTransactions`, real webhook `constructEvent`. `getConfiguredAdapter` resolves a live StripeAdapter when a secret key is present, mock otherwise
  - Capture-session endpoint now returns `{ clientSecret, publishableKey }` for Stripe; `storePaymentMethod` accepts the Stripe `payment_method` id and stores the real token + masked display
  - Client: `@stripe/stripe-js` + `@stripe/react-stripe-js`; `StripeCardCapture` renders Stripe's hosted Card Element and confirms the SetupIntent (card data stays in Stripe's iframe, never our form); `PaymentMethods` uses it for the card flow
  - Platform screen reworked: a DayStream admin picks a **tenant** and stores that tenant's card (`owner_level='tenant'`) — the card Phase 2 charges for platform billing — plus the platform's own provider config
  - tsc: server 0 errors; client at pre-existing baseline (new files clean)
  - _Pending live validation by the user against their Stripe test account (keys + a 4242 test card through the browser); I can't run the dev server or handle keys. Webhook raw-body (`express.raw`) deferred until we process Stripe events — not needed for capture._
  - _Requirements: 0.1, 0.5; design §2, §3, §13_
  - _Correction (per validation feedback): credential config is per-level and self-defined — the SYSTEM Payment Processors tab now holds ONLY the DayStream platform provider (what DayStream uses to charge tenants). The card DayStream charges a tenant lives on the **tenant definition**: the Edit Tenant dialog's "Payment Source" section now embeds the reusable `PaymentMethods` component (owner_level='tenant'), giving add/remove/list/default + Stripe card capture, replacing the old static last-4/brand/expiry placeholder. Fixed browser autofill leaking the admin email into credential fields (autoComplete/new-password + ignore attrs). Tenant- and business-level provider config remain for Phases 3/4._
  - _"Charging party owns the vault" model confirmed and wired: a method is captured/charged against the CHARGING party's provider connection, not the owner's own — a tenant's card vaults/charges under the **platform (DayStream)** Stripe account; a business's card under its **tenant**; a customer's card under its **business**. `resolveConnectedAccount` and secret resolution both route through `chargingConfigOwnerFor`. Payment rails for tenant→DayStream: card (red, via DayStream Stripe) or bank transfer (yellow tenant bank → Platform Receiving Account bank on the Platform Billing tab); green Receiving Account is the separate business→tenant rail._
  - _Added "Test connection" to processor config: `testConnection()` on the adapter interface (StripeAdapter does an authenticated read-only `balance.retrieve()` and reports test/live mode; mock returns ok), `POST /pay/processors/test` tests TYPED/unsaved values (secret falls back to saved when blank) with a mode-vs-key-prefix mismatch guard, and a "Test connection" button on the reusable `ProcessorConfigForm` (tests current form values before saving). Verifies reachability + credential validity without persisting._
  - _Card vaulting validated live by the user: two Visa test cards captured end-to-end against their Stripe test account; stored `provider_token`s matched the real `pm_...` ids in Stripe's request log (confirmed via diagnostic, since standalone PaymentMethods without a Customer don't appear under Dashboard → Customers/Payments)._
  - _Also hardened "Test connection" to verify the publishable key end-to-end (`POST /pay/processors/test-probe`): the server creates a throwaway SetupIntent with the secret key and the browser confirms the publishable key against it with Stripe.js (`retrieveSetupIntent`), catching bogus/corrupted/wrong-mode publishable keys that a server-only check can't. Stripe's echoed-key suffix is stripped from error messages._

- [x] ✅ 1.10 Real Stripe integration — Bank Draw (SEPA Direct Debit, test mode)
  - Extends the processed-method capture to **Bank Draw**, confirmed as the model: bank draw goes **through Stripe** as a direct-debit instrument (vaulted mandate, system-driven recurring pull) at the cheaper bank-debit fee tier — not a manual record, and not fee-free. `bank_draw` was already classified `processed` / recurring-capable in the catalog; `bank_transfer` remains the separate manual push.
  - **Pluggable bank-debit scheme registry** (`services/payments/bank-debit-schemes.ts`): declares each scheme's Stripe `payment_method` type, currencies, mandate requirement, and async-settlement flag. **SEPA** (`sepa_debit`, EUR) is implemented now; **ACH** (`us_bank_account`, USD) and **Bacs** (`bacs_debit`, GBP) are declared for the plumbing and pending their client element. `schemeForCurrency` resolves the scheme at capture time.
  - Server: `StripeAdapter.createSetupIntent(paymentMethodTypes)` restricts the intent to the scheme's type; `tokenize` reads back `sepa_debit`/`us_bank_account`/`bacs_debit` display (scheme + last4, no expiry); `beginCaptureSession` routes `bank_draw` through `schemeForCurrency()` and returns the `debitScheme`. `charge` is unchanged — it already confirms off_session against the stored mandate and maps SEPA's `processing` → `pending`.
  - Client: `StripeBankCapture` renders Stripe's hosted **IBAN Element** with required account-holder name + email and a **SEPA mandate authorization** the payer must accept before confirming (`confirmSepaDebitSetup`); IBAN stays in Stripe's iframe. `PaymentMethods` renders it for the `bank_draw` flow (card flow unchanged).
  - Async settlement: SEPA debits settle over days, so a charge returns `pending` and the final status arrives by webhook (`payment_intent.succeeded`/`payment_intent.payment_failed`, already normalized) — same path as cards. Webhook raw-body (`express.raw`) stays deferred until we consume Stripe events; not needed to capture/vault the mandate.
  - tsc: server 0 errors; client at pre-existing baseline (new files clean)
  - _Pending live validation by the user against their Stripe test account (test IBAN `DE89 3704 0044 0532 0130 00` through the browser)._
  - _Requirements: 0.1, 0.2, 0.5; design §2, §3_
  - _Next bank schemes: ACH (`us_bank_account`), then Bacs — each adds only its client capture element and flips `implemented` in the scheme registry._

- [x] ✅ 1.11 Real Stripe integration — Bank Draw (ACH Direct Debit) + currency-driven scheme selection
  - Adds **ACH Direct Debit** (US dollar bank accounts, Stripe `us_bank_account`) as the second bank-draw scheme and makes the scheme **currency-driven**: the determining factor between SEPA/ACH/Bacs is the owner's billing currency (eur→SEPA, usd→ACH, gbp→Bacs), since a bank account can only be debited by the scheme that governs its currency/region.
  - Scheme is resolved **server-side and authoritatively**: `resolveOwnerCurrency` reads the billing currency from the record (tenant → `sys_tenants.currency`, business/customer → `sys_businesses.currency`, platform → `PLATFORM_CURRENCY` fallback `EUR`), never trusting a client value. `beginCaptureSession` matches the currency to a scheme and returns `debitScheme`; the client renders the matching capture form.
  - Guard replaces the old silent SEPA fallback: an unmatched currency throws `SCHEME_UNSUPPORTED` and a declared-but-unbuilt scheme throws `SCHEME_NOT_IMPLEMENTED` (both HTTP 422), surfaced in the UI as a clear message — so a USD tenant no longer sees the SEPA/IBAN form, and a currency with no scheme fails loudly instead of vaulting a mandate that can never be charged.
  - Client: `StripeAchCapture` collects routing + account number + account-holder type with required name/email and an **ACH mandate authorization** the payer accepts, confirming via `confirmUsBankAccountSetup` (ACH manual entry has no hosted Element — fields are passed directly to Stripe.js). `PaymentMethods` renders SEPA vs ACH from the server-returned `debitScheme`.
  - `bank_draw` server adapter was already scheme-agnostic (SetupIntent by `stripeType`, `tokenize` reads `us_bank_account`), so ACH needed only `implemented: true` in the scheme registry plus the client form. Bacs remains declared/not-implemented.
  - tsc: server 0 errors; client at pre-existing baseline (new files clean)
  - _Pending live validation by the user: a USD tenant, Stripe ACH test routing `110000000` / account `000123456789`, account type Individual._
  - _Requirements: 0.1, 0.2, 0.5; design §2, §3_

- [x] ✅ 1.12 Real Stripe integration — Wallets (Google Pay + Apple Pay)
  - Completes the Section 0 processed-method set. Wallets are a **presentment layer over a card**: the wallet sheet returns a card PaymentMethod, which is vaulted (with a mandate) exactly like a typed card, so a wallet-backed method **can back recurring charges** off-session. Their natural *interactive* use is customer→business checkout — so the integration is built here in Section 0, and validated during **Section C** (customer/business functionality), not on the tenant/platform billing screens.
  - Server: `beginCaptureSession` treats `google_pay`/`apple_pay` as card-backed — the SetupIntent allows `card`, and the owner's billing currency (via `resolveOwnerCurrency`) is returned so the client's Express Checkout Element can render in setup mode. `tokenize` already reads the resulting card's brand/last4, so a stored wallet method displays like a card.
  - Client: `StripeWalletCapture` uses Stripe's **Express Checkout Element** (the single element that renders whichever wallet the device/browser supports) and confirms the SetupIntent via `confirmSetup` (`redirect: 'if_required'`); if no wallet is available it shows a clear note instead of an empty button. `PaymentMethods` renders it for the wallet method types.
  - tsc: server 0 errors; client at pre-existing baseline (new files clean)
  - _Deferred validation (documented, not a gap): **Apple Pay requires HTTPS + an Apple-verified domain** (hosted association file) and cannot render on `http://localhost` — it validates once deployed. **Google Pay** renders in supported browsers in test mode. The wallet button only appears on supported devices/browsers with a wallet configured. Interactive one-time authorization is part of the Section A/B/C charge flows._
  - _Requirements: 0.1, 0.2, 0.5; design §2, §3_

---

## Phase 2 — Section A: Platform Billing (DayStream → Tenant) 🟡 In Progress

> Each phase delivers backend AND its UI together, ending with a checkpoint a user can validate in the app.

- [x] ✅ 2.0 Scheduler scope levels + Stripe Customer attachment (foundation corrections)
  - **Scheduler scope levels** (migration `117`): added `scope_level` (`platform`/`tenant`/`business`) to `sys_scheduled_jobs`, made `business_id`/`tenant_id` nullable with a scope-integrity check, replaced the single `(business_id, job_type)` unique with per-scope partial unique indexes, and made `sys_job_executions.business_id` nullable. `JobContext` now carries `scopeLevel`; the runner passes it. One mechanism now serves platform (A), tenant (B), and business (C) schedules.
  - **Stripe Customer attachment** (migration `119`, `pay_customer_refs`): off-session recurring charges require the vaulted method be attached to a provider Customer — Phase 1 captured with bare SetupIntents (no customer), so stored tokens could be vaulted but not charged. Now `beginCaptureSession` gets-or-creates a Stripe Customer per owner (on the charging party's account) and attaches the SetupIntent to it; `charge` passes the customer. Applies to card/SEPA/ACH/wallet.
  - _Found by validation: the first real `charge()` failed "attach to a Customer first" — only surfaced because Phase 1 validated vaulting, not charging. Existing vaulted test methods were re-added after the fix._
  - _Requirements: 0.1, 0.5, A3, A6_

- [x] ✅ 2.1 Migration — tenant billing plans, charges, credits, net-collections (migration `118`)
  - `pay_tenant_billing_plans` — **versioned** (current = `ended_at IS NULL`): `flat_amount_cents`, `percentage_rate` NUMERIC(7,4), optional `cap_amount_cents` + `cap_applies_to` (`percentage`/`combined`), intro period (`intro_period_months` + intro flat/rate), `billing_day`, `plan_start_date`, audit (`created_by`). History retained so past charges stay explainable (A1.15).
  - `pay_platform_billing_charges` — per-cycle ledger, **idempotent** via `UNIQUE(tenant_id, cycle_year, cycle_month)`; itemizes flat / net-collections basis + rate / percentage / cap / credit / amount charged / carry-forward; `status` (`zero`/`pending`/`settled`/`failed`/`retrying`); sequential `reference_number`; `provider_reference` for webhook reconciliation.
  - `pay_tenant_credits` — `amount_cents`, `remaining_cents`, required `reason`, drawn down FIFO, carries forward, never pays out.
  - `pay_tenant_net_collections` — per-business summary per cycle (A2); **stubbed until Section B** populates it (absent rows = zero).
  - _Suspension reuses `sys_tenants.status = 'suspended'` (no new column)._
  - _Requirements: A1, A2, A4, A5_

- [x] ✅ 2.2 Billing compute + settle engine (`platform-billing.service.ts`)
  - `computeChargeForCycle` — current plan version → intro rule → flat + percentage(net collections) → cap (`percentage`/`combined`) → apply active credits FIFO → floor at zero. Pure; no writes.
  - `billTenantForCycle` — idempotent per (tenant, cycle); in a transaction creates the itemized charge row and draws down real credits; zero-amount records a charge but attempts no transaction (A3.8); else settles.
  - `settleCharge` — resolves the tenant's default stored method + the owner's Stripe Customer, charges via the adapter against DayStream's platform connection; maps `succeeded`→`settled`, `pending`→`pending` (async bank), `failed`→`failed`.
  - **Async settlement webhook now wired** (closes the Stripe-vs-local reconciliation gap): a raw-body parser is mounted on `/api/v1/pay/webhooks` *before* the global `express.json()` so Stripe signature verification gets byte-exact bytes; the handler builds the Stripe adapter from the platform connection's secrets (for the webhook signing secret) and, on `charge.succeeded`/`charge.failed`, flips the matching `pay_platform_billing_charges` row (by `provider_reference`) from `pending` to `settled`/`failed`.
  - _Validated live: a flat $49 plan settled against the user's Stripe test account (real PaymentIntent). Two bugs fixed in the process: volatile charge metadata broke Stripe idempotency on retry (now stable per cycle), and a `text`/`varchar` cast on the settle update._
  - _Section A and B are intended to share this engine later via a level discriminator; built tenant-first for now._
  - _Requirements: A1, A2, A3_

- [ ] 2.3 Platform net-collections aggregation (deferred to Section B)
  - Aggregate per-business net collected to the tenant level; actuals not contracted; never negative; no retroactive restatement; per-business breakdown retained on the charge record
  - _The percentage path is wired and reads `pay_tenant_net_collections`, but that table is fed by Section B — so until B lands, net collections are zero and only flat plans bill a non-zero amount. Open design item: Section A can't accurately bill the percentage until the tenant's cycle is "closed" by Section B (cross-level ordering) — to resolve when building B._
  - _Requirements: A2_

- [x] ✅ 2.4 `platform_billing` daily run (job handler)
  - `runPlatformBilling(runDate)` in `platform-billing.service.ts`: bills the just-closed cycle (arrears) for every active, non-suspended tenant whose `billing_day` falls today (month-end clamp), then retries every open `failed`/`retrying` charge for non-suspended tenants — each cycle's charge retried on its own row, never merged (A3.14). Suspended tenants skipped entirely (A3.15). Idempotent per (tenant, cycle), so a repeat run the same day is safe. Returns a run summary (new/retries/settled/pending/failed/skipped).
  - Registered as the `platform_billing` handler in `job-registry.ts` — a **platform-scoped** job (one schedule for the whole platform, created/managed from the Section A admin UI, not the per-business job picker).
  - _The schedule row (platform scope, Billing_Run_Time in the platform timezone, A6) is created from the admin UI in 2.6; the handler and scope infrastructure (2.0) are in place._
  - _Requirements: A3, A6_

- [x] ✅ 2.5 Platform billing API (`routes/payment-platform.ts`, system-admin only)
  - `GET`/`PUT /pay/platform-billing/:tenantId/plan` (save writes a new plan version), `GET /pay/platform-billing/:tenantId/charges` (history + carry-forward credit balance), `GET`/`POST /pay/platform-billing/:tenantId/credits`, `POST /pay/platform-billing/:tenantId/charge-now` (manual bill of a cycle; idempotent).
  - Suspend/resume reuse the existing `PUT /admin/tenants/:id/suspend` + `/activate` (the billing run already skips suspended tenants), so no duplicate endpoints.
  - _Requirements: A1, A3, A4, A5, A6_

- [x] ✅ 2.6 Platform billing admin UI + tenant window redesign
  - **Tenant window redesigned**: the cramped single-column modal is now a wide modal (95vw, max 1100px) with a **tabbed layout** (keeps the easy close-back-to-list of a modal while giving far more room). Tabs: **Overview** (read summary + Suspend/Activate), **Settings** (the full editable config — identity, locale, territory, owner, and the existing Receiving Account / Payment Source bank sections), **Billing**.
  - **Billing tab** (`TenantBillingTab`): the Section A plan editor (flat / % / cap + applies-to / intro / billing day), the Tenant Payment Account via the shared `PaymentMethods` component (card + bank draw), itemized charge history, credits (issue + list + carry-forward balance), and a manual **Charge now** action for a chosen cycle.
  - Client API wrappers in `api/payments.ts`; design-system `Tabs`/`Button`/`CurrencyInput`; CSS variables only.
  - _Note: the legacy simple billing fields (frequency/amount) remain on the Settings tab for now and coexist with the real Section A plan on the Billing tab; reconcile/remove the legacy fields in a later cleanup._
  - **Plan start date** field added to the plan editor (the intro period counts from it; defaults to today).
  - **Plan versioning**: saving a plan writes a new version (history retained per A1.15); the Billing tab shows the current version number and points to the Audit Trail for change history (`GET /pay/platform-billing/:tenantId/plan-history` also exists for the raw versions).
  - **Charge History** moved to its own tenant-window tab as a **paged table** (design-system `Pagination`), and the **Credits** list now shows only credits with a remaining balance in a capped scroll box — both so the modal can't grow unbounded.
  - **Audit Trail** tab (tenant-window): every change to the tenant — billing plan (per-field from→to), credits issued, suspend/activate, and tenant settings edits — with timestamp and who made it (by login). Server-paged, reusing the existing `usr_audit_log` + `audit.service` (HMAC-chained). Write paths instrumented via `logAudit` keyed `resourceType='tenant'`, read via a new `queryResourceAudit('tenant', tenantId)` + `GET /pay/platform-billing/:tenantId/audit`. This is the durable record of tenant changes (supersedes the inline plan-history table). The redundant "Version N" text was removed from the Billing tab in favor of the Audit Trail. Status-change auditing was consolidated to a single clean entry in `updateTenantStatus` (removing a duplicate raw-JSON entry the routes were also writing); the "from" value renders without strikethrough.
  - _Known audit gaps (not yet instrumented): payment-method add/remove (goes through the shared `/pay/methods` routes), and owner first/last "from" values are approximate (not loaded in the update handler)._
  - _Deferred (known items): scheduled/effective-dated plan changes (admin updates the plan manually before the next cycle for now), and `computeChargeForCycle` selecting the plan version in effect **for the billed cycle** rather than the current version — matters more once Section B/net-collections drive precise per-cycle terms._
  - **Platform run schedule**: a single platform-scoped `platform_billing` schedule (run time + timezone + enabled), upserted into `sys_scheduled_jobs` (one row, verified non-duplicating), with a "Run now" manual trigger. API: `GET`/`PUT /pay/platform-billing-schedule`, `POST /pay/platform-billing-run-now`.
  - **System nav restructure (Configuration = settings, Processes = jobs, Reports = reporting)**: added two system-level pages — **Processes** (Administration nav group, `/admin/processes`) now hosts the Platform Billing Run schedule + "Run now"; **Reports** (Platform nav group, `/admin/system-reports`) now hosts Billing Activity (runs → attempted charges master-detail + failed-charge report). Both moved out of Configuration → Platform Billing. The **Platform Receiving Account** stays under Configuration (settings). Pages are shells intended to grow more processes/reports. The reusable components (`PlatformBillingScheduleCard`, `PlatformBillingActivity`) and the pattern will be mirrored at the **tenant layer** when Section B is built. _(Possible later consolidation: move the Platform Receiving Account onto the Payment Processors tab.)_
  - _Requirements: A1, A3, A4, A5, A6; design §12_
  - _Fixed during review: intro-period check was comparing a pg Date via string concat (Invalid Date → intro silently ignored); now normalized so the intro flat/rate applies within the window. Credits confirmed working (the test credit was simply already exhausted)._
  - **Observability (A5.3) — master-detail, built to scale to 365+ runs/yr**: a **per-attempt audit table** (`pay_billing_charge_attempts`, migration 120) records one row every time a charge is attempted (scheduled or manual), linked to the run's `sys_job_executions` id — so a charge touched by multiple runs (created failed, retried later) has a full attempt history. On the Platform Billing tab: a **date-ranged runs list** (default last 7 days) where **clicking a run drills into exactly the charges that run attempted** (tenant, cycle, amount, outcome, reason), plus a separate **Failed-charge report** (A3.12). API: `GET /pay/platform-billing-runs?from=&to=`, `GET /pay/platform-billing-runs/:runId/charges`, `GET /pay/platform-billing-charges?status=failed`.
  - _The attempts table is **scope-aware** (`scope_level` platform/tenant) and the runs list is generic by `job_type`, so **Section B (tenant → business) reuses this exact runs-and-attempts reporting** one level down._

- [x] ✅ 2.7 Checkpoint — verify platform billing (backend + UI together)
  - Validated through the app: plan configuration (flat/%/cap/intro + plan start date), "Charge now" settling live against the user's Stripe test account (real PaymentIntents, confirmed in the Stripe dashboard), intro-period and credit math, the scheduled daily run + "Run now", master-detail billing-activity reporting, and the tenant audit trail. Section A is validated for flat-plan billing; the percentage/net-collections path remains fed by Section B (task 2.3).

---

## Phase 3 — Section B: Tenant Billing (Tenant → Business) � In Progress

Mirror of Section A one level down (`platform → tenant` becomes `tenant → business`). Built as a dedicated `tenant-billing.service.ts` keyed on `business_id`, reusing the scope-aware infrastructure from Section A (`pay_billing_charge_attempts` scope_level='tenant', `pay_customer_refs` owner_level='business', scheduler scope_level='tenant', and the "charging party owns the vault" model routing a business charge through its tenant's processor connection).

- [x] ✅ 3.1 Business billing plans/charges/credits (migration `121`)
  - Direct mirror of migration 118 keyed on `business_id` (+ `tenant_id` for isolation): `pay_business_billing_plans` (versioned, current = `ended_at IS NULL`), `pay_business_billing_charges` (idempotent `UNIQUE(business_id, cycle_year, cycle_month)` + its own `pay_business_billing_charge_ref_seq`), `pay_business_credits` (FIFO carry-forward), `pay_business_net_collections` (per-business cycle summary, stubbed until Section C).
  - _Requirements: B1, B4, B5_

- [ ] 3.2 Per-business net-collections (the single business's customer collections, from Phase 4 feed)
  - _Table `pay_business_net_collections` exists and the percentage path reads it; populated by Section C. Flat plans bill non-zero now; percentage is zero until C lands._
  - _Requirements: B2_

- [x] ✅ 3.3 `tenant_billing` job handler (tenant-scoped; per-tenant schedule)
  - `runTenantBilling(tenantId, runDate, executionId)` in `tenant-billing.service.ts`: bills the just-closed cycle for every active, non-suspended business in the tenant whose `billing_day` falls today, then retries that tenant's open failed/retrying charges (per-cycle rows, never merged). Registered as the `tenant_billing` handler in `job-registry.ts` — a **tenant-scoped** job (`sys_scheduled_jobs` scope_level='tenant', one row per tenant), passing `ctx.tenantId`.
  - _Requirements: B3, B6_

- [x] ✅ 3.4 Tenant billing API (`routes/payment-platform.ts`, tenant-admin scoped)
  - `/v1/pay/tenant-billing/:businessId/{plan, plan-history, audit, charges, credits, charge-now}` + `/v1/pay/tenant-billing-{schedule, run-now, runs, runs/:runId/charges, charges, account}`. All `tenantContext` + `requirePermission('settings:*')`; every business-scoped route verifies the business belongs to the acting tenant (`requireOwnedBusiness`). Audit via `queryResourceAudit('business', businessId)`.
  - **Tenant receiving/billing account** (migration `122`, `pay_tenant_billing_accounts`): a per-tenant bank-details record (the tenant-level mirror of DayStream's Platform Receiving Account), with tenant-self `GET`/`PUT /v1/pay/tenant-billing-account`.
  - _Requirements: B1, B3, B4, B5, B6_

- [x] ✅ 3.5 Tenant billing tenant-admin UI + Business window redesign
  - **Business window redesigned**: the flat `TenantBusinesses` detail modal is now a wide tabbed window (mirror of the Tenant window), tabs: **Overview** (summary + Archive/Activate), **Settings** (the edit form), **Billing**, **Charge History**, **Audit Trail**.
  - **Billing tab** (`BusinessBillingTab`): the Section B plan editor (flat / % / cap / intro / billing day), the Business Payment Account via the shared `PaymentMethods` component (owner_level='business'), itemized charge history, credits, and manual **Charge now**. **Charge History** (`BusinessChargeHistory`) and **Audit Trail** (`BusinessAuditTrail`) mirror the Tenant* components one level down. Client API wrappers added to `api/payments.ts`.
  - **Tenant Configuration** (`TenantSettings`): added **Payment Processors** (reusable `ProcessorConfigForm` owner_level='tenant' — the provider the tenant uses to charge its businesses) and **Business Billing** (the tenant's receiving-account bank details) tabs, mirroring the system Configuration area.
  - **Tenant nav restructure (mirror of the system layer)**: a tenant **Reports** hub (`TenantReportsHub`, config-driven catalog `tenantReportCatalog`, `/admin/tenant-reports`, Billing Activity as the first report via `TenantReportRunner`) and a tenant **Processes** page (`TenantProcesses`, `/admin/tenant-processes`, hosting the business billing run schedule + "Run now"). Reusable `TenantBillingScheduleCard` + `TenantBillingActivity` components mirror the Platform* ones. Nav wired in `AdminLayout.TENANT_GROUPS` + `AppLayout`/`moduleRegistry` (so they show on `/dashboard` too).
  - _Requirements: B1, B3, B4, B5, B6; design §12_
  - _tsc: server 0 errors; client at the pre-existing 31 baseline (new files clean). Migrations 121 + 122 applied._

- [ ] 3.6 Checkpoint — verify tenant billing mirrors platform billing (backend + UI together) against a real tenant's businesses
  - _Pending live validation by the user: configure a per-business plan, "Charge now" against the tenant's Stripe connection, the scheduled run + "Run now", master-detail billing activity, and the business audit trail. (The business's card is charged through the tenant's processor connection.)_

---

## Phase 4 — Section C: Customer → Business Payments 📋 Planned

Businesses collect directly into their own connected accounts.

- [ ] 4.1 Migration — Section C additions
  - Extend `pay_transactions` (provider_reference, is_processed, payment_method_id, enrollment_id, invoice_id)
  - Add `mbr_enrollments.payment_method_id`
  - `pay_dunning_attempts`, `pay_invoices` + `pay_invoice_line_items`, `pay_gift_cards`, `pay_vouchers`
  - _Requirements: C1, C2, C5, C6, C7, C8_

- [ ] 4.2 One-time payments
  - Processed (adapter.charge against business account), manual-record, and gift-card redemption paths
  - Confirm booking on success / release on failure; write `pay_transactions`; issue receipt
  - _Requirements: C1_

- [ ] 4.3 Subscription charging (flesh out existing `billing_process` stub)
  - Charge `mbr_enrollments` due today against the enrollment's stored method; advance `next_billing_date`; roll `mbr_usage`; update Membership (Phase 08)
  - Keep existing auto-resume behavior
  - _Requirements: C2, C6a_

- [ ] 4.4 Dunning
  - On failed renewal, open `pay_dunning_attempts`, set past_due, retry per configurable schedule, escalate notices, expire on exhaustion
  - _Requirements: C6_

- [ ] 4.5 Customer payment methods (built on Phase 1 vault)
  - Add/remove/list/default on the customer; replace the "Payment Methods on File" placeholder with the real tokenized store
  - _Requirements: C3_

- [ ] 4.6 Refunds (full/partial, permissioned, reason, credit note, manual-method handling)
  - _Requirements: C4_

- [ ] 4.7 Invoicing (optional per business)
  - Issue payable invoice with due date, sequential per-business numbering, settle online via Processed method, PDF
  - _Requirements: C5_

- [ ] 4.8 Gift cards & vouchers (business-scoped; partial redemption; Pricing Engine integration)
  - _Requirements: C7, C8_

- [ ] 4.9 Section C API
  - Charges, refunds, transactions list, subscriptions, accepted-methods get/set, invoices, gift cards/vouchers, business run-time setting
  - _Requirements: C1–C8, C6a_

- [ ] 4.10 Section C UI
  - Checkout / take-payment screen (method selection via the availability resolver; processed + manual-record + gift-card paths)
  - Customer billing area (stored methods via the shared component — replaces the "Payment Methods on File" placeholder, subscriptions, transaction history, invoices to pay)
  - Business payment settings (accepted methods, invoicing on/off, run-time setting)
  - _Requirements: C1–C8, C6a; design §12_

- [ ] 4.11 Checkpoint — verify customer payments (backend + UI together)
  - Through the app: take a one-time payment (processed + manual), run a subscription renewal with real charge, trigger and recover a dunning cycle, process a refund, issue and settle an invoice, redeem a gift card

---

## Phase 5 — Reconciliation & Reporting 📋 Planned

- [ ] 5.1 Net-collections feed (C → B → A)
  - Per-business, per-cycle net collected (charges − same-cycle refunds) from `pay_transactions`; the figure Sections B and A consume
  - _Requirements: C11_

- [ ] 5.2 Payment reporting (transactions, revenue, refunds, MRR/dunning, per-business net collections; CSV; Phase 17 feed)
  - _Requirements: C10_

- [ ] 5.3 Checkpoint — reconcile a full month: C totals roll up to B's net-collections and A's aggregate; numbers tie out end to end

---

## Phase 6 — Customer-Facing Document Customization 📋 Planned

- [ ] 6.1 Migration — `pay_document_branding` (per business, per artifact type)
  - _Requirements: C12_

- [ ] 6.2 Template/branding layer for all customer-facing artifacts (invoice, receipt, credit note, dunning, confirmations, reminders, gift-card email)
  - Merge platform default + business branding + i18n; business-scoped; WCAG-compliant; email/PDF parity
  - _Requirements: C12_

- [ ] 6.3 Branding editor UI + wire into invoicing/notifications/gift-card emails
  - _Requirements: C5, C7, C9, C12_

- [ ] 6.4 Checkpoint — issue each artifact type for two different businesses; confirm correct per-business branding, localization, and no cross-business bleed

---

## Phase 7 — Hardening & Compliance 📋 Planned

- [ ] 7.1 RLS policies on all new `pay_*` tables; permission gating (refunds Manager/Owner; A plans DayStream admin; B plans tenant admin)
  - _Requirements: Security & Compliance (design §13)_

- [ ] 7.2 Audit-trail coverage (plan changes, credits, suspensions, charges, refunds, captures)
  - _Requirements: A1, A4, B1, B4, C4_

- [ ] 7.3 Idempotency & webhook-verification review across all charge paths
  - _Requirements: 0.1, A3, B3, C2_

- [ ] 7.4 Tests (unit + integration) for the billing engine, scheduler handlers, charge/refund flows, and net-collections reconciliation
  - _Requirements: all_

- [ ] 7.5 Final checkpoint — full end-to-end across all three layers against real Transcend Health data in Stripe test mode

---

## Task Dependency Graph

Phases build in dependency order (each wave depends on the ones before it); each
must be validated before the next relies on it.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["Phase 1"], "depends_on": [] },
    { "wave": 2, "tasks": ["Phase 2", "Phase 3", "Phase 4"], "depends_on": ["Phase 1"] },
    { "wave": 3, "tasks": ["Phase 5", "Phase 6"], "depends_on": ["Phase 4"] },
    { "wave": 4, "tasks": ["Phase 7"], "depends_on": ["Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6"] }
  ]
}
```

Cross-layer note: the percentage-of-net-collections component in Sections A and B
depends on the net-collections figure produced one level down (B from C, A from B).
So the percentage path for a cycle is only accurate once the lower level has closed
that cycle — tracked as task 2.3 (and its Section B equivalent) and the Phase 5 feed.

## Notes

- **Deferred within Section A** (not blockers): 2.3 net-collections aggregation (waits on Section B); `computeChargeForCycle` currently uses the *current* plan version rather than the version in effect for the billed cycle (fine at current volume with manual between-cycle plan updates); scheduled/effective-dated plan changes; the legacy tenant billing frequency/amount fields on the Settings tab (coexist with the real plan — reconcile later).
- **Known audit gaps**: payment-method add/remove is not yet audited (shared `/pay/methods` routes); owner first/last "from" values in the tenant-settings audit are approximate.
- **Clean-up backlog**: Billing Activity lives on its own AdminConfig tab (acceptable for now; may fold back later).
- **Validation to date**: card / SEPA / ACH capture and Section A flat-plan charging were validated live against the user's Stripe test account; wallets (Google/Apple Pay) are built but validate during Section C; Apple Pay needs a deployed HTTPS domain.

---

**Last Updated**: July 6, 2026
