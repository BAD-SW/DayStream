# Phase 08: Membership & Subscriptions - Requirements

## Overview

This phase builds the membership and subscription system that supports various plan types including unlimited access, credit-based memberships, hybrid plans, punch cards, and introductory packages. The engine manages the complete membership lifecycle — purchase, activation, renewal, freeze, upgrade/downgrade, and cancellation — and integrates with the Booking Engine for credit deduction and access validation.

## Goals

- Support multiple membership types (unlimited, credit-based, hybrid, punch cards, intro packages)
- Implement the complete membership lifecycle with status management
- Integrate with recurring billing (Payment Platform, Phase 10) for auto-renewal
- Implement credit allocation, deduction, rollover, and expiration
- Support membership freeze/pause and resume
- Support upgrades, downgrades, and proration
- Enable membership benefits (discounts, priority booking, exclusive services)
- Provide membership reporting (active, churned, renewed)

## Glossary

- **Membership_Plan**: A configured plan template that defines the terms, credits, price, and benefits (e.g., "Unlimited Monthly", "10 Credits Pack")
- **Membership**: An active instance of a Membership_Plan held by a specific Customer
- **Credit**: A unit of access that can be consumed when booking a service
- **Credit_Balance**: The current number of available credits for a Membership
- **Billing_Cycle**: The recurring period for subscription charges (monthly, quarterly, annually)
- **Membership_Status**: The current state (active, paused, frozen, cancelled, expired, pending)
- **Proration**: Calculating a proportional charge when changing plans mid-cycle
- **Punch_Card**: A fixed number of sessions purchased upfront (no recurring billing)
- **Intro_Package**: A discounted first-time offer designed for new customers

## Requirements

### Requirement 1: Membership Plan Configuration

**User Story:** As a business owner, I want to configure different membership plans, so that I can offer options that match different customer needs and budgets.

#### Acceptance Criteria

1. THE system SHALL support creating Membership_Plans with: name, description, type (unlimited, credit-based, hybrid, punch card, intro package), billing cycle (monthly, quarterly, annually, one-time), base price (stored as cents/minor currency units), status (active, archived)
2. THE system SHALL support configuring credit allocations for credit-based plans: credits per cycle, credit validity period (days), rollover policy (none, limited rollover, unlimited rollover)
3. THE system SHALL support configuring unlimited plans with: included service categories or specific services, access frequency limits (if any, e.g., max 1 per day per service)
4. THE system SHALL support configuring hybrid plans: unlimited access for some services + credits for others
5. THE system SHALL support configuring punch cards: total sessions, valid services, expiration period
6. THE system SHALL support configuring intro packages: discounted price, limited quantity available, first-time customer restriction, included sessions/credits
7. THE system SHALL support a trial period (e.g., 7 or 14 days free before billing starts)
8. THE system SHALL support defining which services each plan grants access to
9. THE system SHALL store all Membership_Plans scoped to the current Tenant

### Requirement 2: Membership Purchase and Activation

**User Story:** As a customer, I want to purchase a membership, so that I can access services at a better rate and with guaranteed availability.

#### Acceptance Criteria

1. THE system SHALL allow Customers to browse and select available Membership_Plans
2. THE system SHALL initiate payment processing (Phase 10) upon plan selection
3. WHEN payment is successful, THE system SHALL activate the Membership immediately
4. THE system SHALL set the billing cycle start date to the activation date
5. THE system SHALL allocate initial credits (for credit-based plans) upon activation
6. THE system SHALL prevent purchasing duplicate active memberships of the same plan
7. THE system SHALL support staff-initiated membership activation (e.g., sold at reception)
8. THE system SHALL record activation in the customer's Activity_Timeline (Phase 05)
9. THE system SHALL validate intro package eligibility (first-time customer only, not already purchased)

### Requirement 3: Membership Lifecycle and Status Management

**User Story:** As a business owner, I want clear membership statuses, so that I can track which customers have active access and manage expirations.

#### Acceptance Criteria

1. THE system SHALL support the following Membership_Statuses: Pending (awaiting payment), Active (valid and usable), Paused (temporarily frozen by customer), Frozen (admin-initiated hold), Cancelled (terminated, no longer renewable), Expired (end date passed or credits exhausted with no renewal)
2. THE system SHALL enforce valid status transitions: Pending → Active, Cancelled; Active → Paused, Frozen, Cancelled, Expired; Paused → Active, Cancelled; Frozen → Active, Cancelled
3. THE system SHALL timestamp every status transition
4. THE system SHALL record who initiated each status change
5. THE system SHALL automatically transition Active → Expired when end date passes or credits are exhausted (for non-recurring plans)
6. THE system SHALL log all status transitions in the audit trail

### Requirement 4: Auto-Renewal and Recurring Billing

**User Story:** As a customer, I want my membership to renew automatically, so that I don't lose access because I forgot to renew manually.

#### Acceptance Criteria

1. THE system SHALL support auto-renewal for monthly, quarterly, and annual memberships
2. THE system SHALL attempt payment renewal on the billing cycle date via the Payment Platform (Phase 10)
3. WHEN renewal payment succeeds, THE system SHALL extend the membership period and allocate new credits (if applicable)
4. WHEN renewal payment fails, THE system SHALL retry according to a configurable dunning schedule (e.g., retry at day 1, 3, 7)
5. IF all retry attempts fail, THE system SHALL transition the membership to Expired
6. THE system SHALL notify the customer before renewal (configurable: 3 days, 7 days before)
7. THE system SHALL notify the customer on failed payment with instructions to update payment method
8. THE system SHALL allow customers to disable auto-renewal (membership expires at end of current period)

### Requirement 5: Credit Management

**User Story:** As a customer, I want to see my credit balance and understand how credits are consumed, so that I can plan my usage.

#### Acceptance Criteria

1. THE system SHALL track Credit_Balance per Membership
2. THE system SHALL deduct credits when a booking is confirmed (one credit per booking, or configurable per service)
3. THE system SHALL restore credits when a booking is cancelled within the free cancellation window
4. THE system SHALL NOT restore credits for no-shows or late cancellations
5. THE system SHALL support different credit costs per service (e.g., massage = 2 credits, sauna = 1 credit)
6. THE system SHALL display current Credit_Balance to the customer in their dashboard
7. THE system SHALL display credit transaction history (earned, spent, expired, restored)
8. THE system SHALL prevent booking if insufficient credits remain (unless the service allows pay-per-use top-up)
9. THE system SHALL handle credit rollover according to plan configuration: no rollover (unused credits expire at cycle end), limited rollover (carry over up to X credits), unlimited rollover

### Requirement 6: Credit Expiration

**User Story:** As a business owner, I want credits to expire according to plan rules, so that unused credits don't accumulate indefinitely.

#### Acceptance Criteria

1. THE system SHALL support credit expiration based on plan configuration (e.g., credits expire 30 days after allocation)
2. THE system SHALL consume oldest credits first (FIFO — first in, first out)
3. THE system SHALL notify customers when credits are approaching expiration (configurable: 7 days before)
4. THE system SHALL log expired credits in the credit transaction history
5. THE system SHALL support a grace period after expiration before credits are permanently removed (configurable)
6. THE system SHALL recalculate credit expiration correctly when a membership is paused (pause extends expiration)

### Requirement 7: Membership Freeze/Pause

**User Story:** As a customer, I want to pause my membership temporarily (e.g., vacation, injury), so that I don't pay for time I can't use.

#### Acceptance Criteria

1. THE system SHALL allow customers to pause their membership for a configurable duration (minimum/maximum days per plan)
2. THE system SHALL stop billing during the pause period
3. THE system SHALL extend the membership end date by the pause duration
4. THE system SHALL pause credit expiration timers during the freeze
5. THE system SHALL prevent booking with a paused membership
6. THE system SHALL limit pause frequency per plan (e.g., max 1 pause per 6 months, max 30 days per year)
7. THE system SHALL automatically resume the membership when the pause period ends
8. THE system SHALL allow early resume by customer request
9. THE system SHALL allow admin-initiated freeze (e.g., medical reasons, with override on limits)

### Requirement 8: Upgrade and Downgrade

**User Story:** As a customer, I want to change my membership plan, so that I can adjust my commitment as my needs change.

#### Acceptance Criteria

1. THE system SHALL allow customers to upgrade to a higher-tier plan
2. THE system SHALL allow customers to downgrade to a lower-tier plan
3. THE system SHALL define upgrade/downgrade paths per plan (which plans can transition to which)
4. WHEN upgrading, THE system SHALL apply the change immediately and prorate the price difference for the remaining billing cycle
5. WHEN downgrading, THE system SHALL apply the change at the end of the current billing cycle (no refund)
6. THE system SHALL transfer remaining credits when changing plans (if applicable and plan allows)
7. THE system SHALL notify the customer of the financial impact before confirming the change
8. THE system SHALL log all plan changes in the audit trail and customer Activity_Timeline

### Requirement 9: Membership Benefits

**User Story:** As a business owner, I want to attach benefits to memberships, so that members feel valued and are incentivized to maintain their subscription.

#### Acceptance Criteria

1. THE system SHALL support configuring benefits per Membership_Plan: percentage discount on services, priority booking (earlier access to new slots), exclusive access to specific services, guest passes (number per cycle), free add-ons (e.g., towel rental, locker)
2. THE system SHALL apply membership discounts automatically during booking checkout
3. THE system SHALL enforce exclusive service access (only members with specific plans can book)
4. THE system SHALL track guest pass usage per cycle
5. THE system SHALL reset cycle-based benefits at each billing renewal
6. THE system SHALL display active benefits to the customer in their membership dashboard

### Requirement 10: Punch Cards and Intro Packages

**User Story:** As a customer, I want to buy a pack of sessions without committing to a recurring membership, so that I can try services at a discount.

#### Acceptance Criteria

1. THE system SHALL support one-time purchase punch cards (e.g., 5 sessions for €X, 10 sessions for €Y)
2. THE system SHALL deduct one session from the punch card per booking
3. THE system SHALL support expiration on punch cards (e.g., valid for 90 days from purchase)
4. THE system SHALL allow a customer to hold multiple active punch cards simultaneously
5. THE system SHALL support intro packages restricted to first-time customers only
6. THE system SHALL validate intro package eligibility at purchase time
7. THE system SHALL prevent re-purchase of an intro package by the same customer
8. THE system SHALL support converting a punch card customer to a recurring membership (migration path)

### Requirement 11: Family/Group Memberships

**User Story:** As a customer, I want to share my membership with family members, so that we can all access the business under one plan.

#### Acceptance Criteria

1. THE system SHALL support linking multiple Customers to a single Membership (primary + additional members)
2. THE system SHALL define maximum additional members per plan (configurable)
3. THE system SHALL allow shared credit pools (all members draw from the same balance) or individual allocations
4. THE system SHALL bill the primary member for the full group
5. THE system SHALL allow adding and removing members from the group
6. THE system SHALL support different access levels for primary vs. additional members (if configured)
7. THE system SHALL deactivate additional members' access if the primary membership is cancelled

### Requirement 12: Membership Reporting

**User Story:** As a business owner, I want to see membership metrics, so that I can understand retention and revenue from memberships.

#### Acceptance Criteria

1. THE system SHALL report active membership count by plan type
2. THE system SHALL report new memberships per period (day, week, month)
3. THE system SHALL report cancellations (churn) per period with reasons
4. THE system SHALL report renewal rate (percentage of memberships that auto-renewed vs. cancelled)
5. THE system SHALL report membership revenue per period
6. THE system SHALL report average membership duration before cancellation
7. THE system SHALL report credit utilization rate (credits used vs. allocated)
8. THE system SHALL support filtering reports by plan type, date range, and lifecycle stage
9. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17) to build dashboards

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - Authentication, RBAC, audit logging
- Phase 03: Core Platform - Tenant context, API infrastructure, i18n, configuration engine
- Phase 05: Customer Management - Customer profiles (membership is linked to a customer)
- Phase 06: Service Management - Services (plans reference which services are included)
- Phase 07: Booking Engine - Credit deduction on booking confirmation, access validation
- Phase 10: Payment Platform - Subscription billing, renewal payments, proration

## Success Criteria

- Multiple plan types (unlimited, credit, hybrid, punch card, intro) can be configured and purchased
- Auto-renewal processes payments on schedule and handles failures with dunning
- Credits are allocated, deducted, rolled over, and expired correctly
- Membership pause/freeze stops billing and extends validity
- Upgrades apply immediately with proration; downgrades apply at cycle end
- Benefits (discounts, priority booking, exclusive access) are enforced during booking
- Punch cards and intro packages work independently of recurring plans
- Family memberships allow shared access with correct billing
- Reporting provides accurate retention and revenue metrics
- All membership data is strictly tenant-scoped

## Out of Scope

- Payment processing mechanics - Phase 10 (this phase defines what needs to be charged, Phase 10 handles how)
- Gift memberships - Phase 10 (gift cards/vouchers)
- Promotional pricing - Phase 09 (Pricing Engine applies discounts to plans)
- Membership sales UI/upsell prompts - Phase 18 (Website & CMS) and Phase 16 (Marketing)
- Mobile membership card/QR - Phase 19 (Mobile App)

## Notes

- Monetary values are always stored as integers (cents) per ADR-003 and Phase 03 multi-currency foundation
- Credit deduction happens at booking confirmation; restoration happens at free cancellation; no restoration for no-shows
- The Membership entity sits between Customer and Booking; it gates access to services
- Intro packages are a key acquisition tool for Transcend — Fire & Ice Intro Pack, Float Tank Intro Pack, etc.
- Family memberships add complexity; can be deferred to a later iteration if needed for MVP
- The Pricing Engine (Phase 09) may override base plan prices with promotions; this phase defines the base

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 06, Phase 07, Phase 10
**Next Phase**: Phase 09 (Pricing Engine)
