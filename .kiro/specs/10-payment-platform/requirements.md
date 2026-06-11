# Phase 10: Payment Platform - Requirements

## Overview

This phase builds the payment processing layer that charges customers the amounts determined by the Pricing Engine (Phase 09). The Payment Platform is designed with a provider abstraction layer — no payment provider is pre-selected. The system will be evaluated against available options (Stripe, PayPal, GoCardless, Adyen, SumUp, etc.) when implementation begins. The platform handles one-time charges, subscription billing, refunds, invoicing, and multi-tenant payout scenarios. All payment provider interactions go through an abstraction interface so providers can be swapped without affecting business logic.

## Goals

- Implement a provider-agnostic payment abstraction layer
- Support one-time payments (service bookings, products, punch cards)
- Support subscription/recurring payments (membership billing)
- Implement secure payment method storage (tokenization)
- Build invoicing and receipt generation
- Implement refund processing (full and partial)
- Support multi-tenant payment flows (platform fee collection, per-tenant payouts)
- Implement payment retry and dunning for failed subscriptions
- Build gift cards and voucher redemption

## Glossary

- **Payment_Provider**: An external service that processes payment transactions (e.g., Stripe, PayPal, Adyen)
- **Payment_Adapter**: The abstraction layer interface that normalizes Payment_Provider interactions
- **Payment_Intent**: A pending payment request with amount, currency, and metadata before processing
- **Transaction**: A completed payment record (successful charge, refund, or payout)
- **Payment_Method**: A stored, tokenized means of payment (credit card, bank account, digital wallet)
- **Subscription**: A recurring billing relationship between a Customer and a Membership_Plan
- **Invoice**: A formal document detailing charges, taxes, and payment for a transaction
- **Refund**: A reversal of a previous charge (full or partial)
- **Dunning**: The process of retrying failed payments and communicating with customers about payment issues
- **Platform_Fee**: A percentage or fixed amount retained by the platform from each tenant's transactions
- **Payout**: Transfer of collected funds to a Tenant's bank account
- **Gift_Card**: A prepaid monetary value that can be redeemed at checkout
- **Voucher**: A code representing a free or discounted service (non-monetary)

## Requirements

### Requirement 1: Payment Provider Abstraction Layer

**User Story:** As a platform operator, I want payment processing abstracted behind an interface, so that we can evaluate and switch providers without rewriting business logic.

#### Acceptance Criteria

1. THE system SHALL define a `PaymentAdapter` interface with standardized methods: createPaymentIntent, confirmPayment, createSubscription, cancelSubscription, refundPayment, storePaymentMethod, removePaymentMethod, getPaymentStatus, listTransactions
2. THE system SHALL support multiple Payment_Adapter implementations (one per provider)
3. THE system SHALL allow configuring which Payment_Provider a Tenant uses (stored in configuration engine)
4. THE system SHALL route all payment operations through the configured adapter — no direct provider calls from business logic
5. THE system SHALL normalize provider-specific responses into a common response format
6. THE system SHALL normalize provider-specific webhooks into common event types
7. THE system SHALL support running multiple providers simultaneously (e.g., one tenant on Stripe, another on PayPal)
8. THE system SHALL log all payment operations through the audit trail regardless of provider

### Requirement 2: One-Time Payments

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

### Requirement 3: Subscription Billing

**User Story:** As a customer with a recurring membership, I want my payments processed automatically each billing cycle, so that my membership remains active without manual action.

#### Acceptance Criteria

1. THE system SHALL create a Subscription when a customer purchases a recurring Membership_Plan
2. THE system SHALL charge the configured amount on each billing cycle date
3. THE system SHALL support billing cycles: monthly, quarterly, annually
4. THE system SHALL support trial periods (delay first charge by X days)
5. THE system SHALL notify the customer before each charge (configurable: 3 or 7 days before)
6. THE system SHALL update the Membership status based on payment outcomes (Phase 08 integration)
7. THE system SHALL support plan changes (upgrade/downgrade) with proration calculated by the Pricing Engine
8. THE system SHALL support customer-initiated subscription cancellation (effective at period end)
9. THE system SHALL support immediate cancellation with prorated refund (if tenant allows)

### Requirement 4: Payment Method Management

**User Story:** As a customer, I want to save my payment methods securely, so that future checkouts are faster.

#### Acceptance Criteria

1. THE system SHALL support storing tokenized payment methods (credit/debit cards)
2. THE system SHALL NEVER store raw card numbers, CVVs, or full card details
3. THE system SHALL display stored methods with masked information (last 4 digits, expiry, card brand)
4. THE system SHALL support a default payment method per customer
5. THE system SHALL allow customers to add, remove, and set default payment methods
6. THE system SHALL support multiple stored methods per customer
7. THE system SHALL notify customers when a stored card is approaching expiration
8. THE system SHALL use the stored default method for subscription renewals
9. THE system SHALL comply with PCI DSS requirements through tokenization (no card data touches our servers)

### Requirement 5: Refund Processing

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

### Requirement 6: Invoice Generation

**User Story:** As a business owner, I want professional invoices generated for every payment, so that my customers have proper documentation and my books are accurate.

#### Acceptance Criteria

1. THE system SHALL generate an Invoice for every successful payment
2. THE Invoice SHALL include: invoice number (sequential per tenant), tenant business details (name, address, tax ID), customer details, line items with descriptions, quantities, and unit prices, discounts applied, tax breakdown (rate, amount), total amount, payment method and status, date of issue, due date (for unpaid invoices)
3. THE system SHALL support downloadable invoices in PDF format
4. THE system SHALL support emailing invoices to customers automatically
5. THE system SHALL support configurable invoice numbering format per tenant
6. THE system SHALL support invoice customization (logo, footer text) from tenant configuration
7. THE system SHALL maintain sequential invoice numbers with no gaps (compliance requirement)
8. THE system SHALL support credit notes for refunds

### Requirement 7: Payment Retry and Dunning

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

### Requirement 8: Multi-Tenant Payment Flow

**User Story:** As a platform operator, I want each tenant's payments to flow correctly to them while the platform retains its fee, so that revenue distribution is automated.

#### Acceptance Criteria

1. THE system SHALL support collecting payments on behalf of tenants
2. THE system SHALL support configuring a Platform_Fee per tenant (percentage and/or fixed amount)
3. THE system SHALL calculate the Platform_Fee deduction on each transaction
4. THE system SHALL support scheduled Payouts to tenant bank accounts (configurable frequency: daily, weekly, monthly)
5. THE system SHALL provide payout reporting per tenant (amounts collected, fees deducted, net payout)
6. THE system SHALL support holding payouts (e.g., for new tenants, pending verification)
7. THE system SHALL store payout history with bank details (masked) and settlement dates
8. THE system SHALL support the chosen provider's multi-party payment model (e.g., Stripe Connect, PayPal for Marketplaces)

### Requirement 9: Gift Cards

**User Story:** As a customer, I want to buy a gift card for someone, so that they can use it to book services.

#### Acceptance Criteria

1. THE system SHALL support purchasing gift cards with custom or preset monetary values
2. THE system SHALL generate a unique gift card code upon purchase
3. THE system SHALL support emailing the gift card to a recipient with a personalized message
4. THE system SHALL support redeeming a gift card at checkout (reduces amount due)
5. THE system SHALL support partial redemption (use part of the balance, remainder stays available)
6. THE system SHALL track gift card balance and transaction history
7. THE system SHALL support gift card expiration (configurable per tenant, with legal compliance for jurisdiction)
8. THE system SHALL prevent gift card use across tenants (scoped to issuing tenant)

### Requirement 10: Vouchers

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

### Requirement 11: Payment Notifications

**User Story:** As a customer, I want to receive payment confirmations and receipts, so that I have a record of my transactions.

#### Acceptance Criteria

1. THE system SHALL send a payment confirmation email upon successful charge
2. THE system SHALL send a refund confirmation email upon successful refund
3. THE system SHALL send a payment failure notification with suggested actions
4. THE system SHALL send upcoming renewal reminders (configurable days before)
5. THE system SHALL send receipt/invoice as email attachment or link
6. THE system SHALL respect customer communication preferences (Phase 05)
7. THE system SHALL use localized notification content (i18n)

### Requirement 12: Payment Reporting

**User Story:** As a business owner, I want to see payment metrics and transaction history, so that I can track revenue and reconcile with my bank.

#### Acceptance Criteria

1. THE system SHALL provide a transaction list with filtering: date range, status, type (charge, refund, payout), payment method, customer
2. THE system SHALL report total revenue per period (day, week, month)
3. THE system SHALL report refund totals per period
4. THE system SHALL report outstanding (unpaid) invoices
5. THE system SHALL report subscription metrics: MRR (monthly recurring revenue), failed payments, dunning recovery rate
6. THE system SHALL support CSV export of transaction data
7. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)
8. THE system SHALL report platform fees collected (platform admin view)

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging, encryption (payment data)
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, multi-currency
- Phase 05: Customer Management - Customer profiles (payment methods linked to customer)
- Phase 07: Booking Engine - Triggers payment on booking confirmation
- Phase 08: Membership Engine - Triggers subscription creation and renewal
- Phase 09: Pricing Engine - Provides Final_Price and Price_Breakdown for all charges

## Success Criteria

- Payment_Adapter interface allows at least two provider implementations without business logic changes
- One-time payments charge correctly and confirm bookings
- Subscription billing charges on schedule and handles failures via dunning
- Payment methods are stored as tokens (no raw card data)
- Refunds (full and partial) process back to original payment method
- Invoices generate with correct line items, tax, and formatting
- Gift cards can be purchased, sent, and redeemed with balance tracking
- Multi-tenant payment flows correctly separate platform fees from tenant revenue
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
- Platform_Fee structure (percentage, fixed, or tiered) is a business decision to be made with colleague

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 09
**Next Phase**: Phase 11 (Accounts Payable)
