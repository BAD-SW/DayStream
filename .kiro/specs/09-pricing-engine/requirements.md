# Phase 09: Pricing Engine - Requirements

## Overview

This phase builds the flexible pricing system that determines the final amount to be charged for any service, membership, or product. The Pricing Engine is the source of truth for "how much does this cost" — it evaluates rules, promotions, membership discounts, and contextual factors to produce a final price. The Payment Platform (Phase 10) then processes whatever amount the Pricing Engine determines. The Pricing Engine is provider-agnostic; it produces amounts, not payment instructions.

## Goals

- Calculate final prices for services, memberships, and products based on configurable rules
- Support multiple pricing strategies (fixed, membership, promotional, seasonal, first-time, corporate)
- Implement a rule priority/precedence system for when multiple pricing rules apply
- Support multi-currency with correct formatting and minor-unit storage
- Implement coupon/discount code system
- Support tax calculation and display (inclusive vs. exclusive)
- Provide pricing history and audit trail

## Glossary

- **Pricing_Rule**: A configurable rule that modifies the base price of a service or plan (e.g., "10% off for Gold members", "€5 off on Tuesdays")
- **Base_Price**: The default price defined on a Service_Variant or Membership_Plan
- **Final_Price**: The calculated price after all applicable Pricing_Rules are evaluated
- **Discount_Code**: A reusable alphanumeric code that applies a specific discount when entered at checkout
- **Promotion**: A time-limited pricing adjustment (e.g., "Summer Sale: 20% off all massages, June 1–30")
- **Price_Calculation**: The process of evaluating all applicable rules to determine the Final_Price
- **Tax_Rate**: A percentage applied to the price based on jurisdiction and service category
- **Price_Breakdown**: A detailed structure showing base price, discounts applied, tax, and total

## Requirements

### Requirement 1: Base Price Management

**User Story:** As a business owner, I want to set and update base prices for my services and memberships, so that my pricing reflects my business model.

#### Acceptance Criteria

1. THE system SHALL store base prices on Service_Variants (Phase 06) and Membership_Plans (Phase 08)
2. THE system SHALL store all monetary values as integers in minor currency units (cents)
3. THE system SHALL support the tenant's configured currency (ISO 4217)
4. THE system SHALL support updating base prices without affecting existing confirmed bookings
5. THE system SHALL maintain a price history log (old price, new price, changed by, timestamp)
6. THE system SHALL support effective dates for price changes (e.g., "new price takes effect January 1")
7. THE system SHALL display prices formatted according to the tenant's locale and currency

### Requirement 2: Pricing Rule Engine

**User Story:** As a business owner, I want to create pricing rules that automatically adjust prices based on conditions, so that I can run promotions and reward loyal customers without manual intervention.

#### Acceptance Criteria

1. THE system SHALL support defining Pricing_Rules with: name, description, rule type, conditions, discount type (percentage or fixed amount), discount value, priority (order of evaluation), status (active/inactive), effective date range (start/end)
2. THE system SHALL support the following rule types: Membership discount (price for members of a specific plan), Promotional/sale (time-limited reduction), Seasonal (peak/off-peak pricing), First-time customer, Corporate/B2B rate, Volume discount (buy X get Y% off), Time-of-day (e.g., off-peak hours cheaper), Day-of-week (e.g., Tuesday specials)
3. THE system SHALL evaluate applicable rules during Price_Calculation
4. THE system SHALL support rules scoped to: all services, specific categories, specific services, specific variants
5. THE system SHALL support rules scoped to: all customers, specific segments, specific membership holders, specific corporate accounts
6. THE system SHALL store all Pricing_Rules scoped to the current Tenant

### Requirement 3: Rule Priority and Stacking

**User Story:** As a business owner, I want control over how multiple discounts interact, so that I don't accidentally give away services below cost.

#### Acceptance Criteria

1. THE system SHALL assign a priority value to each Pricing_Rule (lower number = higher priority)
2. THE system SHALL support stacking modes per rule: stackable (combines with other discounts), exclusive (only this discount applies, best price wins), non-stackable (does not combine with rules of same type)
3. THE system SHALL support a "best price for customer" mode that automatically selects the single greatest discount
4. THE system SHALL support a "first applicable rule wins" mode based on priority order
5. THE system SHALL enforce a configurable maximum total discount percentage per Tenant (e.g., never more than 50% off)
6. THE system SHALL enforce a configurable minimum price floor (e.g., never below €5)
7. THE system SHALL clearly show which rules were applied in the Price_Breakdown

### Requirement 4: Promotional Pricing

**User Story:** As a business owner, I want to run time-limited promotions, so that I can attract customers during slow periods or for special events.

#### Acceptance Criteria

1. THE system SHALL support creating Promotions with: name, discount (percentage or fixed), start date, end date, applicable services/categories, maximum redemptions (optional), minimum purchase amount (optional)
2. THE system SHALL automatically activate promotions on their start date and deactivate on end date
3. THE system SHALL track redemption count per promotion
4. THE system SHALL stop applying a promotion when maximum redemptions are reached
5. THE system SHALL display active promotions to customers in the service catalog (optional per tenant config)
6. THE system SHALL support "flash sale" promotions (short duration, high discount)
7. THE system SHALL log all promotion creation and usage in the audit trail

### Requirement 5: Discount Codes

**User Story:** As a business owner, I want to create discount codes that customers can enter at checkout, so that I can run targeted campaigns and referral programs.

#### Acceptance Criteria

1. THE system SHALL support creating Discount_Codes with: code (alphanumeric, case-insensitive), discount type (percentage or fixed amount), discount value, valid date range, maximum total uses, maximum uses per customer, minimum purchase amount, applicable services/categories (or all)
2. THE system SHALL validate codes at checkout and apply the discount if all conditions are met
3. THE system SHALL return a clear error if a code is invalid, expired, or already used
4. THE system SHALL track usage count per code and per customer
5. THE system SHALL support bulk code generation (e.g., 100 unique codes for a campaign)
6. THE system SHALL support single-use codes (one redemption per code, e.g., for referrals)
7. THE system SHALL support deactivating a code before its expiration date
8. THE system SHALL log all code redemptions in the audit trail

### Requirement 6: Membership Pricing Integration

**User Story:** As a member, I want my membership discount to apply automatically when I book, so that I always get my member rate without extra steps.

#### Acceptance Criteria

1. THE system SHALL check the customer's active membership during Price_Calculation
2. THE system SHALL apply membership-specific pricing for included services automatically
3. THE system SHALL display both the regular price and the member price in the service catalog (if tenant enables this)
4. THE system SHALL support "members only" pricing (service only available to specific plan holders)
5. THE system SHALL support tiered membership discounts (higher plan = bigger discount)
6. THE system SHALL deduct credits before applying monetary charges for credit-based memberships

### Requirement 7: First-Time Customer Pricing

**User Story:** As a new customer, I want access to introductory pricing, so that I can try services at a lower commitment.

#### Acceptance Criteria

1. THE system SHALL support identifying first-time customers (no prior bookings or memberships for this tenant)
2. THE system SHALL automatically apply first-time pricing rules for eligible customers
3. THE system SHALL limit first-time pricing to a configurable number of bookings (e.g., first 3 visits)
4. THE system SHALL prevent exploitation (customer cannot re-qualify after becoming a returning customer)
5. THE system SHALL clearly display "first-time offer" labeling in the catalog

### Requirement 8: Corporate/B2B Pricing

**User Story:** As a business owner, I want to offer special rates to corporate clients, so that I can attract group business from companies.

#### Acceptance Criteria

1. THE system SHALL support creating corporate accounts linked to a Tenant
2. THE system SHALL support assigning customers to a corporate account
3. THE system SHALL apply corporate pricing rules for customers associated with a corporate account
4. THE system SHALL support different rate cards per corporate account
5. THE system SHALL support consolidated billing for corporate accounts (invoice the company, not individuals)
6. THE system SHALL track corporate account usage for reporting

### Requirement 9: Tax Calculation

**User Story:** As a business owner, I want taxes calculated correctly on every transaction, so that I comply with local regulations and my invoices are accurate.

#### Acceptance Criteria

1. THE system SHALL support configuring tax rates per Tenant (stored in database)
2. THE system SHALL support multiple tax categories: standard rate, reduced rate, zero-rated, exempt
3. THE system SHALL assign a tax category to each Service and Membership_Plan
4. THE system SHALL calculate tax based on the Final_Price (after discounts)
5. THE system SHALL support tax-inclusive display (price shown includes tax) and tax-exclusive display (tax added at checkout) per Tenant configuration
6. THE system SHALL include tax breakdown in the Price_Breakdown (subtotal, tax amount, total)
7. THE system SHALL support tax rate changes with effective dates (old bookings use old rate, new bookings use new rate)
8. THE system SHALL store applicable tax rate on each transaction for historical accuracy

### Requirement 10: Price Calculation API

**User Story:** As a developer, I want a single API that calculates the final price for any item, so that pricing logic is centralized and not duplicated across the platform.

#### Acceptance Criteria

1. THE system SHALL provide a `POST /api/v1/pricing/calculate` endpoint that accepts: items (service variant IDs, membership plan IDs), customer ID (for membership/segment-based rules), discount code (optional), booking date/time (for seasonal/time-based rules)
2. THE system SHALL return a Price_Breakdown: base price per item, discounts applied (with rule names), subtotal, tax amount, tax rate, total
3. THE system SHALL return the calculation within 200ms
4. THE system SHALL be idempotent (same inputs always produce same output for same point in time)
5. THE system SHALL be called by the Booking Engine (Phase 07) and Payment Platform (Phase 10) — not bypassed
6. THE system SHALL validate that the requesting user has access to the specified customer and items (tenant scoping)

### Requirement 11: Bundle/Package Pricing

**User Story:** As a business owner, I want to offer package deals (buy multiple services together at a discount), so that I can increase average order value.

#### Acceptance Criteria

1. THE system SHALL support defining bundles: a set of services/variants sold together at a package price
2. THE system SHALL support a fixed bundle price (e.g., "3-service recovery package: €120" vs. €150 if bought separately)
3. THE system SHALL support percentage-off bundles (e.g., "book 3, get 15% off total")
4. THE system SHALL validate that all bundle items are available before applying bundle pricing
5. THE system SHALL display the savings amount compared to individual purchase
6. THE system SHALL support expiration on purchased bundles (must use within X days)

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, multi-currency foundation, i18n
- Phase 05: Customer Management - Customer segments, lifecycle stage (for rule targeting)
- Phase 06: Service Management - Service_Variants with base prices, tax categories
- Phase 08: Membership Engine - Membership plans, credit deduction, membership benefits

## Success Criteria

- Price_Calculation correctly evaluates all applicable rules and returns accurate Final_Price
- Multiple rules stack, exclude, or resolve by priority correctly per configuration
- Discount codes validate and apply at checkout
- Membership discounts apply automatically without customer action
- Tax is calculated correctly for inclusive and exclusive display modes
- Promotions activate/deactivate on schedule and respect redemption limits
- Price history provides full audit trail of changes
- Pricing API responds within 200ms
- All pricing data is strictly tenant-scoped

## Out of Scope

- Payment processing (charging the amount) - Phase 10
- Currency conversion between tenants - Each tenant operates in a single currency
- Real-time competitor pricing analysis - Future/AI phase
- External tax calculation services (TaxJar, Avalara) - May be evaluated later per THIRD_PARTY_SERVICES.md
- Yield management / demand-based dynamic pricing - Future enhancement

## Notes

- The Pricing Engine PRODUCES amounts; the Payment Platform PROCESSES them. Clear separation of concerns.
- Payment provider is NOT finalized (per project decision). This phase is entirely provider-agnostic.
- All monetary values stored as integers (cents) per ADR-003
- The Price_Calculation API is the single source of truth — no module should calculate prices independently
- Tax rates are stored in the database per tenant; no hardcoded rates
- Corporate pricing adds B2B capability that differentiates from consumer-only competitors
- Bundle pricing is a natural fit for Transcend (recovery packages combining multiple services)

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 06, Phase 08
**Next Phase**: Phase 10 (Payment Platform)
