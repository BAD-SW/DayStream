# Phase 10: Payment Platform - Requirements

## Overview

This phase is the single home for ALL billing and payment processing in DayStream. It is organized as a foundation plus three billing processes that build on it:

- **Section 0 — Payment Methods & Infrastructure (Foundation):** the payment methods and rails available across every money flow (e.g. cards, bank transfer/direct debit, digital wallets), the manual-vs-processed distinction, tokenized method storage, and the provider abstraction. Defined first so the billing sections have methods to choose from and infrastructure to charge through.
- **Section A — Platform Billing (DayStream → Tenant):** what DayStream charges each tenant for use of the platform, on a flexible, per-tenant negotiated plan (flat and/or percentage of net collections, optional per-cycle cap, intro period), billed monthly in arrears.
- **Section B — Tenant Billing (Tenant → Business):** what a tenant charges each of its businesses for use of the platform, mirroring Section A one level down — a per-business negotiated plan (flat and/or percentage of what the business actually collected), billed monthly in arrears, managed by a tenant administrator.
- **Section C — Customer → Business Payments:** charging customers for bookings, memberships, products, gift cards, and vouchers, with refunds, invoicing, and dunning.

Sections A, B, and C define WHEN and HOW MUCH to charge (billing rules, dates, amounts, chosen methods); they all execute those charges through the shared methods and provider infrastructure defined in Section 0.

The Payment Platform is designed with a provider abstraction layer — no payment provider is pre-selected. The system will be evaluated against available options (Stripe, PayPal, GoCardless, Adyen, SumUp, etc.) when implementation begins. All payment provider interactions go through an abstraction interface so providers can be swapped without affecting business logic.

Keeping every billing relationship in one specification is intentional: anyone reasoning about "how money moves" should find the whole picture in one document rather than across several.

## Goals

- Implement a provider-agnostic payment abstraction layer
- **Platform billing (DayStream → tenant):** support flexible, per-tenant negotiated billing plans — flat and/or percentage of net collections, optional per-cycle cap, and an intro period — billed monthly in arrears
- Support one-time payments (service bookings, products, punch cards)
- Support subscription/recurring payments (membership billing)
- Implement secure payment method storage (tokenization)
- Build invoicing and receipt generation
- Implement refund processing (full and partial)
- **Tenant billing (tenant → business):** mirror the platform-billing model one level down, so a tenant bills each of its businesses on negotiated terms, charged automatically each month
- Implement payment retry and dunning for failed subscriptions
- Build gift cards and voucher redemption

## Glossary

- **Payment_Provider**: An external service that processes payment transactions (e.g., Stripe, PayPal, Adyen)
- **Payment_Provider**: An external service that processes payment transactions (e.g., Stripe). Starting provider is Stripe; the model supports additional providers over time.
- **Payment_Adapter**: The abstraction layer interface (Requirement 0.1) through which all three billing layers execute payment operations, normalizing Payment_Provider interactions.
- **Payment_Intent**: A pending payment request with amount, currency, and metadata, created before a Processed charge is executed (Section C).
- **Payment_Method**: A means of payment in the catalog (Section 0), classified by behavior as Processed, Manual/Record, or Internal.
- **Processed_Method**: A method whose money moves through a Payment_Provider via the adapter (Card, Bank Draw, Google Pay, Apple Pay).
- **Manual_Record_Method**: A method where payment occurs out-of-band and the system only records it (Cash, Check, manual bank push transfer, Other).
- **Internal_Method**: A method settled against an internal balance rather than an external rail (Gift Card).
- **Bank_Draw**: A Processed, pull/mandate bank instrument (e.g. ACH / SEPA Direct Debit) in which the payer pre-authorizes the biller to draw funds. Distinct from a manual, payer-initiated bank "push" transfer. Usable in Sections A, B, and C.
- **Transaction**: A completed payment record (successful charge or refund).
- **Subscription**: A recurring billing relationship between a Customer and a Membership_Plan (Section C). The recurrence lifecycle is owned by DayStream, not the processor.
- **Invoice**: A formal document detailing charges, taxes, and payment for a customer transaction (Section C). (Distinct from the auto-settled charge records in Sections A and B, which are not receivables.)
- **Refund**: A reversal of a previous charge (full or partial).
- **Dunning**: The process of retrying failed payments and communicating about payment issues.
- **Gift_Card**: A prepaid monetary value that can be redeemed at checkout (Section C).
- **Voucher**: A code representing a free or discounted service, non-monetary (Section C).

### Billing terms (Sections A and B)

> **Billing is by automatic charge, not accounts receivable.** On the billing day the system charges the payer's stored payment account directly; nothing is sent for the payer to pay from, and there is no outstanding receivable. A "charge record / statement" is kept for transparency and history, not as a payable document.

- **Tenant_Billing_Plan**: The per-tenant, uniquely negotiated rule set that determines what DayStream charges a tenant each month. Composed of an optional flat amount, an optional percentage rate, an optional per-cycle cap, an intro period, and a billing day.
- **Flat_Component**: A fixed monetary amount charged per billing cycle (may be zero).
- **Percentage_Component**: A rate applied to the tenant's Net_Collections for the cycle (may be zero).
- **Net_Collections**: The base for a Percentage_Component — the net amount ACTUALLY collected during the billing cycle (not contracted or invoiced amounts; e.g. a $1,000 agreement that collects $500 contributes $500). Its scope depends on the billing level: for Section A it is the sum of amounts collected/remitted from the tenant's businesses to the tenant, aggregated across all the tenant's businesses (recorded as a summary per business; no customer-level transaction detail required); for Section B it is the net amount a single business collected from its customers. Not retroactively restated in later cycles.
- **Tenant_Payment_Account**: The billing instrument stored on the tenant definition that DayStream charges each cycle (Section A) — either bank account details or a vaulted (tokenized) card. Managed by a DayStream administrator.
- **Business_Payment_Account**: The billing instrument stored on the business definition that the tenant charges each cycle (Section B) — either bank account details or a vaulted (tokenized) card. Managed by a tenant administrator. (Distinct from the account a business uses to COLLECT money from its customers, which is covered in Section C.)
- **Business_Billing_Plan**: The per-business, uniquely negotiated rule set that determines what a tenant charges a business each month (Section B). Same structure as a Tenant_Billing_Plan: optional flat amount, optional percentage rate, optional per-cycle cap, intro period, and billing day.
- **Tenant_Credit**: An admin-issued credit against a tenant's platform billing (e.g. for a service outage). Reduces the current charge; any excess carries forward to subsequent cycles. DayStream never pays a tenant — a credit can only reduce future charges, never produce a negative balance paid out.
- **Business_Credit**: A tenant-admin-issued credit against a business's billing (Section B). Reduces the current charge; any excess carries forward. A tenant never pays a business as a result of a credit — it can only reduce future charges.
- **Platform_Billing_Charge**: The monthly charge record DayStream raises against a tenant (Section A) and settles automatically against the Tenant_Payment_Account. Itemizes the Flat_Component, Percentage_Component (with basis and rate), cap applied, credits applied, and amount charged. Not a receivable/invoice.
- **Business_Billing_Charge**: The monthly charge record a tenant raises against a business (Section B) and settles automatically against the Business_Payment_Account. Same itemization as a Platform_Billing_Charge. Not a receivable/invoice.
- **Billing_Cycle**: A calendar month. Billing is in arrears — a cycle is billed after it closes.
- **Billing_Day**: The day of month on which the automatic charge for the just-closed cycle runs. If the month is shorter than the configured day, the last day of the month is used.
- **Per_Cycle_Cap**: An optional maximum on the Percentage_Component (or on the combined charge) for a single Billing_Cycle (e.g. 1% of collections, capped at $500/month).
- **Intro_Period**: An initial span of N months during which an alternate rule applies (e.g. $0 for the first 3 months), after which the standard plan takes effect.
- **Failed_Charge**: A charge whose automatic settlement was declined (e.g. expired card, insufficient funds). It appears on the failed-charge report and is retried on each subsequent daily billing run until it settles or the account is Suspended. Charges from different Billing_Cycles are tracked and retried independently (never merged into one amount).
- **Suspended**: A manually-set account state (set by a DayStream administrator for a tenant, or a tenant administrator for a business) that halts automatic charge retries for that account. Suspension of a tenant does NOT affect its businesses, which continue operating normally if in good standing. Downstream consequences (e.g. transferring a defaulting tenant's businesses to DayStream or a new tenant) are handled by separate business-transfer functionality, out of scope for this phase.

## Requirements

---

## Section 0 — Payment Methods & Infrastructure (Foundation)

This foundational section defines how payments are physically made and settled, and the methods available to be chosen from. It comes first because Sections A, B, and C all build on it: each billing process (DayStream → tenant, tenant → business, customer → business) defines WHEN and HOW MUCH to charge, then executes the charge through the shared infrastructure and methods defined here. In other words, Section 0 provides the building blocks; A/B/C are the processes that consume them.

This section covers: the provider abstraction (0.1), the method catalog and its behavior classes (0.2), method availability by flow (0.3), processor support and selection (0.4), and tokenized method storage with a shared capture mechanism (0.5). UI/look-and-feel per method is intentionally left to the design phase; fine details flagged inline (settlement timing, fees, per-method captured data, region/provider feature matrix) will be settled during design.

### Requirement 0.1: Payment Provider Abstraction Layer

**User Story:** As a platform operator, I want payment processing abstracted behind one interface used by all three billing layers, so that we can evaluate and switch providers without rewriting business logic, and so DayStream, tenants, and businesses can each charge their respective payers.

#### Acceptance Criteria

1. THE system SHALL define a `PaymentAdapter` interface used by all three billing layers (A, B, C) to execute payment operations
2. THE system SHALL support multiple PaymentAdapter implementations (one per provider)
3. THE system SHALL route all payment operations through the configured adapter — no direct provider calls from business logic
4. THE system SHALL operate the adapter against a connected account supplied by the calling layer: DayStream's account for Section A, the tenant's account for Section B, and the business's account for Section C — so one abstraction serves all three
5. THE system SHALL follow a "bill what it's told" model: the system (not the provider) calculates the amount to collect and selects the method, and the provider only executes the instruction
6. THE PaymentAdapter interface SHALL center on executing single operations — `charge`, `refund`, `tokenize` (store/remove a method), `getStatus`, and `listTransactions` — and SHALL NOT delegate recurring/subscription lifecycle management to the provider (no `createSubscription` / `cancelSubscription`); scheduling, recurrence, proration, and dunning are owned by the billing layers
7. THE system SHALL normalize provider-specific responses into a common response format
8. THE system SHALL normalize provider-specific webhooks into common event types
9. THE system SHALL support running multiple providers simultaneously (e.g., one connection on one provider, another on a different provider)
10. THE system SHALL log all payment operations through the audit trail regardless of provider

### Requirement 0.5: Tokenized Method Storage (All Layers)

**User Story:** As the platform, I want stored payment methods tokenized at every billing layer, so that recurring charges can run without the system ever holding raw payment credentials.

#### Acceptance Criteria

1. THE system SHALL support storing a tokenized payment credential at EACH billing layer: the Tenant_Payment_Account (Section A), the Business_Payment_Account (Section B), and a customer's stored Payment_Method (Section C)
2. THE system SHALL provide a SINGLE common mechanism for capturing and tokenizing a payment instrument (card entry, bank-detail/mandate entry, wallet) that is reused at every layer (A, B, C) — the same component/flow SHALL serve DayStream capturing a tenant's instrument, a tenant capturing a business's instrument, and a business/customer capturing a customer's instrument
3. THE system SHALL vault/tokenize card and Bank Draw credentials via the Payment_Provider — it SHALL NEVER store raw card numbers, CVVs, full card details, or raw bank credentials
4. THE system SHALL use the stored token as the instrument for recurring/automated charges at each layer (the monthly Section A and B charges, and Section C subscription renewals)
5. THE system SHALL display stored methods with masked information only (e.g. brand + last four, or masked bank reference)
6. THE system SHALL achieve PCI-DSS scope reduction through tokenization — payment credentials never touch DayStream servers

### Requirement 0.2: Payment Method Catalog and Classification

**User Story:** As the platform, I want a defined catalog of payment methods each with a known behavior class, so that every billing layer handles each method correctly.

#### Acceptance Criteria

1. THE system SHALL define a catalog of payment methods, each classified by behavior as one of: **Processed** (money moves through a Payment_Provider via the adapter), **Manual/Record** (payment occurs out-of-band and the system only records it), or **Internal** (settled against an internal balance)
2. THE catalog SHALL include at minimum: Card (Processed), Bank Draw (Processed), Google Pay (Processed), Apple Pay (Processed), Cash (Manual/Record), Check (Manual/Record), Gift Card (Internal), and Other (Manual/Record)
3. THE system SHALL treat **Bank Draw** as a pull/mandate instrument (e.g. ACH / SEPA Direct Debit) in which the payer pre-authorizes the biller to draw funds — distinct from a manual, payer-initiated bank "push" transfer
4. THE system SHALL, for each method, record its behavior class and the attributes known to the billing layers: whether it is recurring-capable (chargeable on a stored credential/mandate), whether it supports electronic refund, and which flows (Section A, B, and/or C) it is valid for
5. THE system SHALL treat the following additional per-method attributes as to be refined during design (not finalized here): settlement timing, fees, data captured per method, and region-specific mandate/compliance rules

### Requirement 0.3: Method Availability by Flow

**User Story:** As the platform, I want each billing layer to offer only the methods that make sense for it, so that recurring billing and one-off collection each use appropriate instruments.

#### Acceptance Criteria

1. THE system SHALL make a fixed, recurring-capable set available to the Platform Billing (Section A) and Tenant Billing (Section B) layers: **Card** and **Bank Draw**
2. THE system SHALL make the following methods available to the Customer → Business layer (Section C), subject to business configuration: **Card, Bank Draw, Google Pay, Apple Pay, Cash, Check, Gift Card, Other**
3. THE system SHALL allow a business to enable or disable individual methods from the Section C set it is permitted to use (as in the existing Accepted Payment Methods settings)
4. THE system SHALL constrain the methods offered for a given charge by the payment context — recurring/automated charges SHALL exclude non-recurring-capable methods (Cash, Check, Gift Card, Other)
5. THE system SHALL only offer a Processed method where the active Payment_Provider for that account supports it in the applicable region (e.g. Google Pay, Apple Pay, or Bank Draw may be unavailable with a given provider or country)

### Requirement 0.4: Processor Support and Selection

**User Story:** As a tenant or business, I want to choose the payment processor that best fits me, so that I am not locked into one provider or fee structure.

#### Acceptance Criteria

1. THE system SHALL support Stripe as the initial Payment_Provider for Processed methods
2. THE system SHALL keep provider support extensible via the PaymentAdapter (Requirement 0.1) so additional processors can be added without changing billing logic
3. THE system SHALL allow a tenant and a business to select which supported Payment_Provider they use
4. THE system SHALL confine the method and processor choice for each billing layer to what that layer and the selected provider support (per Requirements 0.2 and 0.3)

> **To refine during design:** the exact per-method captured data, settlement timing, provider feature matrix (which processors support Bank Draw / Google Pay / Apple Pay by region), and fee handling. Captured here as known requirements; details may be added or pivoted as integration work begins.

---

## Section A — Platform Billing (DayStream → Tenant)

This section covers what DayStream charges a tenant for use of the platform. Plans are uniquely negotiated per tenant (territory potential drives each deal), set by system administrators on the tenant definition, and billed monthly in arrears.

### Requirement A1: Tenant Billing Plan Definition

**User Story:** As a system administrator, I want to configure a flexible billing plan on each tenant, so that DayStream can charge uniquely negotiated terms that fit a tenant's territory and stage of growth.

#### Acceptance Criteria

1. THE system SHALL allow a system administrator to define a Tenant_Billing_Plan on the tenant definition
2. THE Tenant_Billing_Plan SHALL support a Flat_Component (fixed amount per Billing_Cycle, which MAY be zero)
3. THE Tenant_Billing_Plan SHALL support a Percentage_Component (a rate applied to Net_Collections, which MAY be zero)
4. THE Tenant_Billing_Plan SHALL support any combination of Flat_Component and Percentage_Component, including both together, flat-only, or percentage-only
5. THE Tenant_Billing_Plan SHALL support an optional Per_Cycle_Cap that limits the charge for a single Billing_Cycle
6. THE system SHALL allow configuring whether the Per_Cycle_Cap applies to the Percentage_Component alone or to the combined (flat + percentage) charge
7. THE Tenant_Billing_Plan SHALL support an Intro_Period defined in whole months (N), with its own rule (e.g. a flat amount of zero), after which the standard plan applies
8. THE Tenant_Billing_Plan SHALL support a configurable Billing_Day (day of month on which the automatic charge for the just-closed cycle runs)
9. THE system SHALL NOT enforce any minimum charge (a percentage-only plan with zero Net_Collections results in a zero charge)
10. THE system SHALL store monetary amounts as integer cents and percentage rates with sufficient precision to express values such as 1% or 2.5%
11. THE system SHALL store a Tenant_Payment_Account on the tenant definition (bank account details or a vaulted/tokenized card) as the instrument charged each Billing_Cycle
12. THE system SHALL restrict management of the Tenant_Billing_Plan and Tenant_Payment_Account to DayStream administrators
13. THE system SHALL NOT store raw card numbers or full card details — card instruments are vaulted/tokenized
14. THE system SHALL record who created or changed a Tenant_Billing_Plan or Tenant_Payment_Account and when, in the audit trail
15. THE system SHALL retain historical plan terms so that past Platform_Billing_Charges remain explainable even after a plan changes

### Requirement A2: Net Collections Calculation

**User Story:** As a system administrator, I want the percentage charge based on what the tenant's businesses actually remitted to the tenant, so that revenue-share billing reflects real collected money rather than contracted amounts.

#### Acceptance Criteria

1. THE system SHALL compute Net_Collections as the sum of the net amounts actually collected/remitted from the tenant's businesses to the tenant during the Billing_Cycle, aggregated across ALL of the tenant's businesses
2. THE system SHALL base Net_Collections on amounts ACTUALLY collected, not on contracted or invoiced amounts (e.g. a $1,000 agreement that collects $500 contributes $500)
3. THE system SHALL record a summary net amount per business for the Billing_Cycle; it SHALL NOT require individual customer-level transaction detail for this calculation
4. THE system SHALL NOT retroactively restate a prior cycle's Net_Collections or its already-settled Platform_Billing_Charge; adjustments affecting a prior period reduce or increase the current cycle's Net_Collections
5. THE system SHALL treat Net_Collections as never negative for billing purposes — the Percentage_Component SHALL never be negative (a zero or negative net figure yields a zero Percentage_Component)
6. THE system SHALL make the Net_Collections figure and its per-business components available for inspection on the Platform_Billing_Charge record

### Requirement A3: Monthly Arrears Billing Run

**User Story:** As DayStream, I want each tenant charged automatically each month for the period just completed, so that billing requires no manual effort and leaves no outstanding receivable.

#### Acceptance Criteria

1. THE system SHALL execute a single billing run once per day that selects and processes every tenant due that day — those whose Billing_Day falls on that date (new charges) and those with an outstanding Failed_Charge (retries); the number of tenants processed on any given day will vary with how Billing_Days are distributed across the tenant base
2. THE system SHALL raise a Platform_Billing_Charge for each active tenant for the just-completed Billing_Cycle (billing in arrears) and settle it automatically — it SHALL NOT produce a receivable or send a payable document for the tenant to pay from
3. THE system SHALL run the charge on the tenant's configured Billing_Day each month; when the configured day-of-month does not exist in a given month (e.g. a Billing_Day of 31 in a 30-day month, or 30/31 in February), THE system SHALL run the charge on the last day of that month instead
4. THE system SHALL compute the amount as Flat_Component + Percentage_Component, then apply the Per_Cycle_Cap if configured
5. THE system SHALL apply the Intro_Period rule for the first N Billing_Cycles after a tenant's plan start, then apply the standard plan
6. THE system SHALL apply any outstanding Tenant_Credit balance before determining the amount to charge
7. THE system SHALL floor the amount at zero and carry any remaining Tenant_Credit forward to subsequent cycles
8. THE system SHALL attempt no charge transaction for a zero amount, recording a zero Platform_Billing_Charge for history
9. THE system SHALL charge the amount to the tenant's Tenant_Payment_Account (vaulted card or bank instrument)
10. THE system SHALL record each billing run and its outcome per tenant in the audit trail
11. THE system SHALL be idempotent for a given tenant and Billing_Cycle (re-running SHALL NOT produce duplicate charges for the same cycle)

#### Failed charges and suspension

12. IF an automatic charge is declined, THE system SHALL record it as a Failed_Charge and surface it on a failed-charge report for DayStream administrators
13. THE system SHALL retry each Failed_Charge on each subsequent daily billing run until it settles or the tenant is Suspended
14. THE system SHALL track and retry charges from different Billing_Cycles independently — a cycle that rolls over while a prior cycle's charge is still failing SHALL result in two separate Platform_Billing_Charges, each retried on its own (never merged into a single increased amount)
15. THE system SHALL allow a DayStream administrator to manually set a tenant to Suspended, which halts further charge retries for that tenant
16. THE system SHALL ensure that suspending a tenant has NO effect on that tenant's businesses, which continue operating normally if in good standing
17. THE system SHALL treat any downstream re-routing of a defaulting tenant's businesses (to DayStream or a new tenant) as out of scope here — handled by separate business-transfer functionality

### Requirement A4: Tenant Credits and Adjustments

**User Story:** As a system administrator, I want to issue a credit to a tenant for a prior-period service issue (e.g. downtime), so that we can make it right without rewriting historical revenue figures.

#### Acceptance Criteria

1. THE system SHALL allow a system administrator to issue a Tenant_Credit with an amount and a required reason
2. THE system SHALL apply a Tenant_Credit against the tenant's current (and if needed, subsequent) Platform_Billing_Charge
3. THE system SHALL NOT alter the historical Net_Collections or previously settled charges when a credit is issued
4. THE system SHALL carry forward any portion of a Tenant_Credit that exceeds the current amount charged, applying it to future cycles
5. THE system SHALL NEVER produce a payout from DayStream to a tenant as a result of a credit (credits only reduce future charges)
6. THE system SHALL log all Tenant_Credit creation and application in the audit trail with the initiating administrator

### Requirement A5: Platform Billing Charge Record and Visibility

**User Story:** As a system administrator and as a tenant owner, I want a clear itemized record of each platform billing charge, so that the amount is transparent and explainable — even though there is no receivable to pay.

#### Acceptance Criteria

1. THE Platform_Billing_Charge record SHALL itemize: the Billing_Cycle, the Flat_Component, the Percentage_Component (showing the Net_Collections base with its per-business breakdown and the rate), any Per_Cycle_Cap applied, any Tenant_Credit applied, the amount charged, the settlement outcome (settled / failed / retrying), and any carried-forward credit balance
2. THE system SHALL assign a sequential reference number to each Platform_Billing_Charge per the platform's numbering scheme
3. THE system SHALL allow system administrators to view a tenant's current plan, charge records, applied credits, carry-forward balance, and any Failed_Charges
4. THE system SHALL expose platform billing data to the Reporting & Analytics phase (Phase 17)
5. THE system SHALL make a tenant's own platform billing charge history visible to that tenant's owner (read-only)

---

## Section B — Tenant Billing (Tenant → Business)

This section covers what a tenant charges each of its businesses for use of the platform. It mirrors Section A one level down: plans are uniquely negotiated per business, set by tenant administrators on the business definition, and billed monthly in arrears. All concepts carry over from Section A with the actors shifted (tenant as biller, business as payer).

### Requirement B1: Business Billing Plan Definition

**User Story:** As a tenant administrator, I want to configure a flexible billing plan on each business, so that the tenant can charge uniquely negotiated terms that fit each business's size and stage.

#### Acceptance Criteria

1. THE system SHALL allow a tenant administrator to define a Business_Billing_Plan on the business definition
2. THE Business_Billing_Plan SHALL support a Flat_Component (fixed amount per Billing_Cycle, which MAY be zero)
3. THE Business_Billing_Plan SHALL support a Percentage_Component (a rate applied to the business's Net_Collections, which MAY be zero)
4. THE Business_Billing_Plan SHALL support any combination of Flat_Component and Percentage_Component, including both together, flat-only, or percentage-only
5. THE Business_Billing_Plan SHALL support an optional Per_Cycle_Cap that limits the charge for a single Billing_Cycle
6. THE system SHALL allow configuring whether the Per_Cycle_Cap applies to the Percentage_Component alone or to the combined (flat + percentage) charge
7. THE Business_Billing_Plan SHALL support an Intro_Period defined in whole months (N), with its own rule (e.g. a flat amount of zero), after which the standard plan applies
8. THE Business_Billing_Plan SHALL support a configurable Billing_Day (day of month on which the automatic charge for the just-closed cycle runs)
9. THE system SHALL NOT enforce any minimum charge (a percentage-only plan with zero Net_Collections results in a zero charge)
10. THE system SHALL store monetary amounts as integer cents and percentage rates with sufficient precision to express values such as 1% or 2.5%
11. THE system SHALL store a Business_Payment_Account on the business definition (bank account details or a vaulted/tokenized card) as the instrument charged each Billing_Cycle
12. THE system SHALL restrict management of the Business_Billing_Plan and Business_Payment_Account to tenant administrators
13. THE system SHALL NOT store raw card numbers or full card details — card instruments are vaulted/tokenized
14. THE system SHALL record who created or changed a Business_Billing_Plan or Business_Payment_Account and when, in the audit trail
15. THE system SHALL retain historical plan terms so that past Business_Billing_Charges remain explainable even after a plan changes

### Requirement B2: Net Collections Calculation

**User Story:** As a tenant administrator, I want the percentage charge based on what a business actually collected from its customers, so that revenue-share billing reflects real collected money rather than contracted amounts.

#### Acceptance Criteria

1. THE system SHALL compute a business's Net_Collections as the net amount actually collected from that business's customers during the Billing_Cycle
2. THE system SHALL base Net_Collections on amounts ACTUALLY collected, not on contracted or invoiced amounts (e.g. a $1,000 agreement that collects $500 contributes $500)
3. THE system SHALL NOT retroactively restate a prior cycle's Net_Collections or its already-settled Business_Billing_Charge; adjustments affecting a prior period reduce or increase the current cycle's Net_Collections
4. THE system SHALL treat Net_Collections as never negative for billing purposes — the Percentage_Component SHALL never be negative (a zero or negative net figure yields a zero Percentage_Component)
5. THE system SHALL make the Net_Collections figure available for inspection on the Business_Billing_Charge record

### Requirement B3: Monthly Arrears Billing Run

**User Story:** As a tenant, I want each business charged automatically each month for the period just completed, so that billing requires no manual effort and leaves no outstanding receivable.

#### Acceptance Criteria

1. THE system SHALL execute a single billing run once per day that selects and processes every business due that day — those whose Billing_Day falls on that date (new charges) and those with an outstanding Failed_Charge (retries); the number of businesses processed on any given day will vary with how Billing_Days are distributed across the tenant's businesses
2. THE system SHALL raise a Business_Billing_Charge for each active business for the just-completed Billing_Cycle (billing in arrears) and settle it automatically — it SHALL NOT produce a receivable or send a payable document for the business to pay from
3. THE system SHALL run the charge on the business's configured Billing_Day each month; when the configured day-of-month does not exist in a given month (e.g. a Billing_Day of 31 in a 30-day month, or 30/31 in February), THE system SHALL run the charge on the last day of that month instead
4. THE system SHALL compute the amount as Flat_Component + Percentage_Component, then apply the Per_Cycle_Cap if configured
5. THE system SHALL apply the Intro_Period rule for the first N Billing_Cycles after a business's plan start, then apply the standard plan
6. THE system SHALL apply any outstanding Business_Credit balance before determining the amount to charge
7. THE system SHALL floor the amount at zero and carry any remaining Business_Credit forward to subsequent cycles
8. THE system SHALL attempt no charge transaction for a zero amount, recording a zero Business_Billing_Charge for history
9. THE system SHALL charge the amount to the business's Business_Payment_Account (vaulted card or bank instrument)
10. THE system SHALL record each billing run and its outcome per business in the audit trail
11. THE system SHALL be idempotent for a given business and Billing_Cycle (re-running SHALL NOT produce duplicate charges for the same cycle)

#### Failed charges and suspension

12. IF an automatic charge is declined, THE system SHALL record it as a Failed_Charge and surface it on a failed-charge report for tenant administrators
13. THE system SHALL retry each Failed_Charge on each subsequent daily billing run until it settles or the business is Suspended
14. THE system SHALL track and retry charges from different Billing_Cycles independently — a cycle that rolls over while a prior cycle's charge is still failing SHALL result in two separate Business_Billing_Charges, each retried on its own (never merged into a single increased amount)
15. THE system SHALL allow a tenant administrator to manually set a business to Suspended, which halts further charge retries for that business
16. THE system SHALL ensure that suspending a business for tenant-billing purposes does NOT halt that business's own ability to collect from its customers (Section C) — the two relationships are independent

### Requirement B4: Business Credits and Adjustments

**User Story:** As a tenant administrator, I want to issue a credit to a business for a prior-period service issue, so that we can make it right without rewriting historical revenue figures.

#### Acceptance Criteria

1. THE system SHALL allow a tenant administrator to issue a Business_Credit with an amount and a required reason
2. THE system SHALL apply a Business_Credit against the business's current (and if needed, subsequent) Business_Billing_Charge
3. THE system SHALL NOT alter the historical Net_Collections or previously settled charges when a credit is issued
4. THE system SHALL carry forward any portion of a Business_Credit that exceeds the current amount charged, applying it to future cycles
5. THE system SHALL NEVER produce a payout from the tenant to a business as a result of a credit (credits only reduce future charges)
6. THE system SHALL log all Business_Credit creation and application in the audit trail with the initiating administrator

### Requirement B5: Business Billing Charge Record and Visibility

**User Story:** As a tenant administrator and as a business owner, I want a clear itemized record of each billing charge, so that the amount is transparent and explainable — even though there is no receivable to pay.

#### Acceptance Criteria

1. THE Business_Billing_Charge record SHALL itemize: the Billing_Cycle, the Flat_Component, the Percentage_Component (showing the Net_Collections base and the rate), any Per_Cycle_Cap applied, any Business_Credit applied, the amount charged, the settlement outcome (settled / failed / retrying), and any carried-forward credit balance
2. THE system SHALL assign a sequential reference number to each Business_Billing_Charge per the tenant's numbering scheme
3. THE system SHALL allow tenant administrators to view a business's current plan, charge records, applied credits, carry-forward balance, and any Failed_Charges
4. THE system SHALL expose business billing data to the Reporting & Analytics phase (Phase 17)
5. THE system SHALL make a business's own billing charge history visible to that business's owner (read-only)

---

## Section C — Customer → Business Payments

This section covers charging customers for the services, memberships, and products a business offers, including refunds, invoicing, dunning, gift cards, and vouchers. Charges are executed via the shared PaymentAdapter (Section 0), operating against the business's own connected account so collected funds land directly with the business. The per-business net amount collected each cycle is what feeds the Section B Net_Collections calculation.

### Requirement C1: One-Time Payments

**User Story:** As a customer, I want to pay for a service booking or purchase at checkout, so that my booking is confirmed immediately.

#### Acceptance Criteria

1. THE system SHALL create a Payment_Intent with the Final_Price from the Pricing Engine (Phase 09)
2. THE system SHALL support payment via stored Payment_Method (card on file)
3. THE system SHALL support payment via new card entry (tokenized, never stored raw)
4. THE system SHALL confirm the booking upon successful payment
5. THE system SHALL cancel the booking reservation if payment fails
6. THE system SHALL return a clear error message to the customer on payment failure
7. THE system SHALL store the Transaction record with: amount, currency, provider reference, payment method type, status, timestamp, associated booking/membership ID
8. THE system SHALL support zero-amount bookings (free services, fully covered by credits/membership)
9. THE system SHALL generate a receipt/invoice upon successful payment

### Requirement C2: Subscription Billing

**User Story:** As a customer with a recurring membership, I want my payments processed automatically each billing cycle, so that my membership remains active without manual action.

#### Acceptance Criteria

1. THE system SHALL create a Subscription when a customer purchases a recurring Membership_Plan
2. THE system SHALL own the subscription lifecycle itself — scheduling, recurrence, proration, and dunning — and SHALL execute each renewal by instructing the PaymentAdapter (Section 0) to charge the stored method; it SHALL NOT delegate subscription management to the Payment_Provider
3. THE system SHALL charge the configured amount on each billing cycle date against the customer's stored, tokenized Payment_Method (per Requirement 0.5)
4. THE system SHALL support billing cycles: monthly, quarterly, annually
5. THE system SHALL support trial periods (delay first charge by X days)
6. THE system SHALL notify the customer before each charge (configurable: 3 or 7 days before)
7. THE system SHALL update the Membership status based on payment outcomes (Phase 08 integration)
8. THE system SHALL support plan changes (upgrade/downgrade) with proration calculated by the Pricing Engine
9. THE system SHALL support customer-initiated subscription cancellation (effective at period end)
10. THE system SHALL support immediate cancellation with prorated refund (if the business allows)

### Requirement C3: Customer Payment Method Management

**User Story:** As a customer, I want to save and manage my payment methods, so that future checkouts are faster.

> Tokenization, vaulting, masked display, and PCI handling are defined once in Requirement 0.5 (shared across all layers) and are used here via the common capture mechanism. This requirement covers only the customer-specific management on top of that foundation.

#### Acceptance Criteria

1. THE system SHALL capture and tokenize a customer's payment method using the common capture mechanism defined in Requirement 0.5
2. THE system SHALL support a default payment method per customer
3. THE system SHALL allow customers to add, remove, and set default payment methods
4. THE system SHALL support multiple stored methods per customer
5. THE system SHALL notify customers when a stored card is approaching expiration
6. THE system SHALL use the stored default method for subscription renewals (Requirement C2)

### Requirement C4: Refund Processing

**User Story:** As a receptionist, I want to process refunds for cancelled bookings or billing errors, so that customers receive their money back promptly.

#### Acceptance Criteria

1. THE system SHALL support full refunds (return entire transaction amount)
2. THE system SHALL support partial refunds (return a specified amount less than the original)
3. THE system SHALL validate that a refund does not exceed the original transaction amount
4. THE system SHALL process refunds back to the original payment method
5. THE system SHALL require appropriate role permissions to initiate refunds (Manager, Owner)
6. THE system SHALL require a reason when processing a refund
7. THE system SHALL update the associated booking/membership status accordingly
8. THE system SHALL generate a credit note/refund receipt
9. THE system SHALL log all refund operations in the audit trail with initiating user

### Requirement C5: Invoice Generation

**User Story:** As a business owner, I want the option to issue invoices customers can pay from, so that I can serve clients (e.g. corporations) who require a payable invoice — while still being able to require electronic payment at time of service for everyone else.

> Here "invoice" means a true payable document a customer settles against (distinct from the auto-settled charge records in Sections A and B, which are not receivables). Invoicing is a per-business option.

#### Acceptance Criteria

1. THE system SHALL allow each business to choose whether it supports invoice-based billing (a customer pays from an issued invoice) or requires electronic payment at time of service
2. WHERE a business enables invoicing, THE system SHALL allow issuing an Invoice to a customer with a payment due date, tracking it as outstanding until paid
3. THE Invoice SHALL include: invoice number (sequential per business), the business's own details (name, address, tax ID), customer details, line items with descriptions, quantities, and unit prices, discounts applied, tax breakdown (rate, amount), total amount, status, date of issue, and due date
4. THE system SHALL generate a receipt for payments taken electronically at time of service (no payable invoice required in that flow)
5. THE system SHALL support downloadable invoices in PDF format
6. THE system SHALL support emailing invoices to customers automatically
7. THE system SHALL support configurable invoice numbering format per business
8. THE system SHALL support full per-business invoice customization (branding, messaging, look and feel) per Requirement C12
9. THE system SHALL maintain sequential invoice numbers with no gaps per business (compliance requirement)
10. THE system SHALL support settling an outstanding invoice via any enabled Processed method (e.g. the customer pays the invoice online by card or Bank Draw)
11. THE system SHALL support credit notes for refunds

### Requirement C6: Payment Retry and Dunning

**User Story:** As a business owner, I want failed subscription payments to be retried automatically, so that I don't lose members due to temporary payment issues.

#### Acceptance Criteria

1. THE system SHALL automatically retry failed subscription payments according to a configurable dunning schedule
2. THE dunning schedule SHALL support configurable retry intervals (e.g., retry at day 1, day 3, day 7 after failure)
3. THE system SHALL notify the customer on each failed attempt with instructions to update payment method
4. THE system SHALL send escalating urgency in dunning notifications (friendly → warning → final notice)
5. IF all retry attempts fail, THE system SHALL transition the membership to Expired (Phase 08)
6. THE system SHALL pause further charges during the dunning period (no double-charges)
7. THE system SHALL log all dunning events in the audit trail
8. THE system SHALL support manual payment retry by staff (e.g., after customer updates card)

### Requirement C7: Gift Cards

**User Story:** As a customer, I want to buy a gift card for someone, so that they can use it to book services.

#### Acceptance Criteria

1. THE system SHALL support purchasing gift cards with custom or preset monetary values
2. THE system SHALL generate a unique gift card code upon purchase
3. THE system SHALL support emailing the gift card to a recipient with a personalized message, rendered with the issuing business's branding per Requirement C12
4. THE system SHALL support redeeming a gift card at checkout (reduces amount due)
5. THE system SHALL support partial redemption (use part of the balance, remainder stays available)
6. THE system SHALL track gift card balance and transaction history
7. THE system SHALL support gift card expiration (configurable per business, with legal compliance for jurisdiction)
8. THE system SHALL scope each gift card to its issuing business — a gift card SHALL be redeemable ONLY at the business that issued it, and never across businesses or tenants

### Requirement C8: Vouchers

**User Story:** As a business owner, I want to create vouchers for specific services, so that I can gift or promote free/discounted access to specific offerings.

#### Acceptance Criteria

1. THE system SHALL support creating Vouchers tied to specific services or categories
2. THE system SHALL support vouchers for: free service (full value), fixed discount off a service, percentage discount off a service
3. THE system SHALL generate a unique voucher code
4. THE system SHALL support single-use and multi-use vouchers
5. THE system SHALL support voucher expiration dates
6. THE system SHALL validate voucher eligibility at checkout (correct service, not expired, not used)
7. THE system SHALL integrate with the Pricing Engine — voucher discount appears in Price_Breakdown
8. THE system SHALL log all voucher creation and redemption in the audit trail

### Requirement C9: Payment Notifications

**User Story:** As a customer, I want to receive payment confirmations and receipts, so that I have a record of my transactions.

#### Acceptance Criteria

1. THE system SHALL send a payment confirmation email upon successful charge
2. THE system SHALL send a refund confirmation email upon successful refund
3. THE system SHALL send a payment failure notification with suggested actions
4. THE system SHALL send upcoming renewal reminders (configurable days before)
5. THE system SHALL send receipt/invoice as email attachment or link
6. THE system SHALL respect customer communication preferences (Phase 05)
7. THE system SHALL use localized notification content (i18n)
8. THE system SHALL render all notifications with the issuing business's branding and messaging per Requirement C12

### Requirement C10: Payment Reporting

**User Story:** As a business owner, I want to see payment metrics and transaction history, so that I can track revenue and reconcile with my bank.

#### Acceptance Criteria

1. THE system SHALL provide a transaction list with filtering: date range, status, type (charge, refund), payment method, customer
2. THE system SHALL report total revenue per period (day, week, month)
3. THE system SHALL report refund totals per period
4. THE system SHALL report outstanding (unpaid) invoices
5. THE system SHALL report subscription metrics: MRR (monthly recurring revenue), failed payments, dunning recovery rate
6. THE system SHALL support CSV export of transaction data
7. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)

### Requirement C11: Net Collections Feed to Tenant Billing

**User Story:** As the platform, I want each business's actual collections recorded and summarized, so that the tenant-billing layer (Section B) and, in turn, platform billing (Section A) can compute their percentage charges from real collected money.

#### Acceptance Criteria

1. THE system SHALL record every successful customer→business collection (across all methods — Processed, Manual/Record, and Internal) against the collecting business
2. THE system SHALL net refunds and chargebacks in the cycle they occur against that business's collections (not retroactively against a prior cycle)
3. THE system SHALL produce, per business and per Billing_Cycle, the net amount actually collected — the figure Section B consumes as that business's Net_Collections
4. THE system SHALL make the per-business net-collected figure available to the Section B billing run and to reporting, so the C → B → A chain reconciles
5. THE system SHALL base the figure on amounts ACTUALLY collected, consistent with the actuals-not-contracted rule in Sections A and B

### Requirement C12: Customer-Facing Document and Communication Customization

**User Story:** As a business owner, I want every document and message my customers see to reflect my brand, so that the payment experience looks and sounds like my business, not a generic platform.

#### Acceptance Criteria

1. THE system SHALL allow each business to customize ALL customer-facing payment artifacts it issues, including (but not limited to): invoices, receipts, credit notes, dunning notices, payment and refund confirmations, renewal reminders, and gift-card emails
2. THE customization SHALL cover branding (e.g. logo, colors), sender identity and messaging (e.g. subject lines, body copy, footer text), and overall look and feel, within platform-provided templates
3. THE system SHALL apply a business's customization consistently across all channels for that artifact (e.g. emailed and downloadable/PDF versions match)
4. THE system SHALL provide sensible platform defaults so artifacts render correctly before a business customizes them
5. THE system SHALL keep customization business-scoped — one business's branding/messaging SHALL NOT appear on another business's customer-facing artifacts
6. THE system SHALL honor localization (i18n) alongside customization, so a customized artifact still renders in the customer's language
7. THE customization SHALL respect accessibility requirements (e.g. sufficient contrast) so customized artifacts remain WCAG-compliant

> Note: this requirement governs the content/branding of customer-facing payment artifacts. The underlying document generation (invoices C5, notifications C9, gift-card emails C7) references this requirement for customization rather than each defining its own.

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging, encryption (payment data)
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, multi-currency
- Phase 05: Customer Management - Customer profiles (payment methods linked to customer)
- Phase 07: Booking Engine - Triggers payment on booking confirmation
- Phase 08: Membership Engine - Triggers subscription creation and renewal
- Phase 09: Pricing Engine - Provides Final_Price and Price_Breakdown for all charges
- Tenant definition / territory (Phase 31 Prospect Management context) - Section A: the Tenant_Billing_Plan is set on the tenant and reflects its uniquely negotiated, territory-based deal

## Success Criteria

- **Section A:** A Tenant_Billing_Plan can express flat-only, percentage-only, combined, capped (e.g. 1% up to $500/mo), and intro-period ($0 for N months) terms, set per tenant by a system admin
- **Section A:** Monthly arrears billing raises one automatic charge per tenant on the configured Billing_Day (last-day fallback), charging flat + min(percentage × net collections, cap) to the tenant's stored Tenant_Payment_Account (vaulted card or bank instrument), with the intro rule applied for the first N months
- **Section A:** Net_Collections is the aggregate net amount actually collected/remitted from a tenant's businesses to the tenant (actuals, not contracted — $500 collected on a $1,000 agreement counts $500), recorded as a summary per business, with no retroactive restatement; a zero-collection percentage-only plan bills $0
- **Section A:** Admin-issued Tenant_Credits reduce the current charge, floor it at zero, and carry any excess forward; DayStream never pays a tenant
- **Section A:** Billing is by automatic charge to the tenant's stored payment account (no receivable, nothing sent to pay from); failed charges are reported and retried daily until settled or the tenant is Suspended (manual, by a DayStream admin); charges from different cycles are retried independently; suspending a tenant does not affect its businesses
- **Section B:** Mirrors Section A one level down — a tenant administrator sets a Business_Billing_Plan per business (flat/percentage/cap/intro), billed monthly in arrears to the business's stored Business_Payment_Account; percentage base is the net amount a business actually collected from its customers; Business_Credits carry forward; a tenant never pays a business
- Payment_Adapter interface allows at least two provider implementations without business logic changes
- One-time payments charge correctly and confirm bookings
- Subscription billing charges on schedule and handles failures via dunning
- Payment methods are stored as tokens (no raw card data)
- Refunds (full and partial) process back to original payment method
- Invoices generate with correct line items, tax, and formatting
- Gift cards can be purchased, sent, and redeemed with balance tracking
- **Section B:** Each business is charged automatically each cycle to its stored Business_Payment_Account; failed charges are reported and retried daily until settled or the business is Suspended (manual); suspension does not stop the business collecting from its customers
- Transaction reporting provides accurate revenue and reconciliation data
- All payment data is strictly tenant-scoped

## Out of Scope

- Selecting the specific payment provider - Evaluated at implementation per THIRD_PARTY_SERVICES.md
- POS hardware integration (card readers) - Phase handled in enterprise expansion
- Cryptocurrency payments - Not planned
- Buy-now-pay-later (BNPL) - Future enhancement
- Complex multi-currency (one tenant accepting multiple currencies) - Each tenant operates in one currency

## Notes

- **CRITICAL: Payment provider is NOT finalized.** The abstraction layer is the most important deliverable of this phase. All business logic depends on the interface, not a specific provider.
- The Pricing Engine (Phase 09) determines HOW MUCH. The Payment Platform determines HOW TO CHARGE.
- PCI compliance is achieved through tokenization — card data never touches our servers
- Gift card legal requirements vary by jurisdiction (some regions prohibit expiration)
- Multi-tenant payment flow design depends on the chosen provider's marketplace/platform model
- During local development, a mock Payment_Adapter will be implemented for testing without a real provider
- **Platform billing is the first of several billing aspects to be specified.** Section A (DayStream → tenant) is being locked down first; tenant/customer billing refinements follow in later passes within this same document.
- **The old flat "Platform_Fee per transaction" concept is replaced** by the Section A Tenant_Billing_Plan. A flat-only plan reproduces a flat fee; the plan generalizes it with percentage, cap, and intro-period terms. Platform billing is charged automatically each month in arrears to the tenant's stored payment account — there is no receivable and nothing is deducted from any payout (Section B is itself a billing relationship, not a payout).
- **No minimum/floor** on platform billing by design — a percentage-only tenant with no revenue is charged $0; performance expectations are enforced contractually (right to reclaim territory), not by the billing engine.
- **Months are treated as whole calendar months** regardless of 28–31 days; the Billing_Day falls back to the last day of a short month.
- **Credits carry forward and never produce a payout** — a credit can only reduce current/future billing, never result in DayStream paying a tenant (Section A) or a tenant paying a business (Section B).
- **Billing is automatic charge, not accounts receivable** (Sections A and B). On the billing day the system charges the payer's stored payment account directly; nothing is sent for the payer to pay from and there is no outstanding receivable. A charge record/statement is kept for transparency only.
- **Failed charges are reported and retried daily** until they settle or the account is manually Suspended. Charges from different billing cycles are tracked and retried independently (two separate charges, never merged). Suspension is a manual admin action and halts retries; downstream consequences (e.g. transferring a defaulting tenant's businesses to DayStream or a new tenant owner) are handled by separate business-transfer functionality, out of scope for this phase.

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 09
**Next Phase**: Phase 11 (Accounts Payable)
