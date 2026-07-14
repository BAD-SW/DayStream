# Phase 28: Products & Services - Requirements

## Overview

This phase consolidates and replaces the functionality previously defined across Phase 06 (Service Management), Phase 08 (Membership Engine), and Phase 09 (Pricing Engine) into a single unified module. Products & Services is the catalog of everything a business offers — bookable services, physical merchandise, recurring memberships, pre-paid packages/bundles, and loyalty rewards. Orders pull from this catalog as line items, and pricing rules apply across all product types.

## Goals

- Unify services, merchandise, memberships, packages, and loyalty under one module
- Support bookable services with variants, staff, resource, and location requirements
- Support merchandise (physical products) without inventory management
- Support memberships as recurring subscriptions with auto-billing
- Support packages/bundles as pre-paid groupings redeemable over time
- Support loyalty/rewards programs that grant benefits based on purchase history
- Provide flexible pricing rules that apply across all product types
- Enable orders to contain any mix of services, products, memberships, and packages
- Support walk-in/anonymous orders where customer details may not be provided

## Glossary

- **Service**: A bookable, time-based offering that requires scheduling (e.g., haircut, oil change, dental cleaning)
- **Service_Variant**: A specific configuration of a service with defined duration and price (e.g., 30-min massage vs. 60-min massage)
- **Merchandise**: A physical product sold by the business that does not require scheduling (e.g., lotion, supplements, floor mats)
- **Membership**: A recurring subscription that bills on a frequency and may grant access to services, discounts, or other benefits
- **Package**: A pre-paid bundle of items (services and/or products) sold at a fixed price, redeemed over time
- **Loyalty_Program**: A rewards system where customers earn benefits based on purchase history without upfront payment
- **Pricing_Rule**: A condition-based price modification (discount, premium, time-of-day pricing, corporate rate)
- **Order**: The financial transaction that groups line items (services, products, memberships, packages) for checkout/invoicing
- **Category**: A grouping mechanism for organizing services and merchandise within the catalog

## Requirements

### Requirement 1: Service Management

**User Story:** As a business owner, I want to define the services my business offers with their durations, prices, and requirements, so that customers can book them and staff can deliver them.

#### Acceptance Criteria

1. THE system SHALL support creating a Service with: name, description, category, status (active/inactive), and image
2. THE system SHALL support defining one or more Service_Variants per Service with: name, duration (minutes), and base price
3. THE system SHALL require at least one active variant before a Service can be activated
4. THE system SHALL support assigning services to specific locations within a business
5. THE system SHALL support assigning services to specific staff members who can perform them
6. THE system SHALL support defining resource requirements for a service (e.g., room, equipment)
7. THE system SHALL support service categories for catalog organization
8. THE system SHALL support enabling/disabling services without deleting them
9. THE system SHALL support configuring buffer time between bookings per service (setup/cleanup time)
10. THE system SHALL display services in the catalog grouped by category with pricing from the lowest variant

### Requirement 2: Merchandise Management

**User Story:** As a business owner, I want to list physical products for sale alongside my services, so that customers can purchase them during their visit or as part of an order.

#### Acceptance Criteria

1. THE system SHALL support creating Merchandise with: name, description, category, price, SKU (optional), and image
2. THE system SHALL support merchandise categories separate from service categories
3. THE system SHALL support enabling/disabling merchandise without deleting them
4. THE system SHALL support merchandise with variable pricing (e.g., sizes, colors) via variants
5. THE system SHALL NOT require inventory tracking (no stock levels, reorder points, or quantity management)
6. THE system SHALL display merchandise in the catalog alongside services
7. THE system SHALL support adding merchandise as line items to an order
8. THE system SHALL support tax rules applied to merchandise (may differ from service tax rates)

### Requirement 3: Membership Subscriptions

**User Story:** As a business owner, I want to offer recurring memberships that bill customers on a schedule and provide ongoing benefits, so that I have predictable revenue and customers have ongoing access.

#### Acceptance Criteria

1. THE system SHALL support creating Membership plans with: name, description, billing frequency (weekly, monthly, quarterly, annually), and recurring price
2. THE system SHALL support defining membership benefits: included services per period, percentage discounts on services, percentage discounts on merchandise, priority booking
3. THE system SHALL apply membership benefits automatically at checkout when the customer has an active membership
4. THE system SHALL support enrolling a customer in a membership with a start date
5. THE system SHALL generate recurring charges automatically based on the billing frequency
6. THE system SHALL support membership status: active, paused, cancelled, past_due
7. THE system SHALL support pausing a membership (halts billing and benefit access)
8. THE system SHALL support cancelling a membership with an effective end date (may honor until end of current period)
9. THE system SHALL track usage of included services per period (e.g., 2 of 4 massages used this month)
10. THE system SHALL prevent usage beyond included allotment unless the customer pays the difference
11. THE system SHALL support a trial/introductory period with different pricing before standard billing begins
12. THE system SHALL support membership signup as a line item on an order

### Requirement 4: Packages and Bundles

**User Story:** As a business owner, I want to sell pre-paid packages that combine services and/or products at a discounted rate, so that customers commit upfront and I secure revenue.

#### Acceptance Criteria

1. THE system SHALL support creating a Package with: name, description, fixed price, and expiration policy (days/months from purchase, or no expiry)
2. THE system SHALL support defining package contents: a list of services and/or merchandise with quantities (e.g., 5 massages + 2 facials)
3. THE system SHALL track redemption against a purchased package (e.g., 3 of 5 massages used)
4. THE system SHALL prevent redemption beyond the package contents
5. THE system SHALL support package expiration (unused portions expire after the defined period)
6. THE system SHALL display remaining balance/items on a customer's purchased packages
7. THE system SHALL support purchasing a package as a line item on an order
8. THE system SHALL support applying package redemption at booking time (customer selects "use package" instead of paying)
9. THE system SHALL support multiple active packages per customer

### Requirement 5: Loyalty and Rewards

**User Story:** As a business owner, I want to reward repeat customers with benefits they earn through their purchase history, so that I encourage retention without requiring upfront payment.

#### Acceptance Criteria

1. THE system SHALL support creating a Loyalty_Program with: name, description, and earning rules
2. THE system SHALL support earning mechanisms: points per dollar spent, points per visit, points per specific service purchased
3. THE system SHALL support reward tiers based on cumulative points or spend thresholds (e.g., Silver at 500 points, Gold at 1000 points)
4. THE system SHALL support defining rewards per tier: percentage discount, free service, free product, priority booking
5. THE system SHALL automatically track customer points/progress based on completed orders
6. THE system SHALL display a customer's loyalty status, points balance, and tier on their profile
7. THE system SHALL support redeeming points for specific rewards at checkout
8. THE system SHALL support points expiration policy (configurable: never expire, expire after X months of inactivity)
9. THE system SHALL support multiple loyalty programs per business (e.g., separate programs for services vs. retail)
10. THE system SHALL be configurable as enabled/disabled at the business level

### Requirement 6: Promotions

**User Story:** As a business owner, I want to create time-limited promotions and price adjustments for marketing purposes, so that I can drive traffic during slow periods and reward customers with special offers.

#### Acceptance Criteria

1. THE system SHALL support creating promotions that apply to: specific services, specific merchandise, categories, or all items
2. THE system SHALL support discount types: percentage off, fixed amount off, fixed override price
3. THE system SHALL support premium types: percentage markup, fixed markup (e.g., peak hours surcharge)
4. THE system SHALL support time-based conditions: day of week, time of day, date range (seasonal promotions)
5. THE system SHALL support promotional codes that a customer or staff enters at checkout to activate a discount
6. THE system SHALL support stacking rules: define whether promotions combine or only the best discount applies
7. THE system SHALL evaluate applicable promotions at order time and display the applied adjustment to the customer/staff
8. THE system SHALL support enabling/disabling promotions without deleting them
9. THE system SHALL support promotion priority/precedence when multiple promotions match
10. THE system SHALL support limiting promotion usage (e.g., max redemptions total, max per customer)

### Requirement 7: Product Catalog Display

**User Story:** As a staff member, I want a unified view of everything the business offers, so that I can quickly find and add items to an order or recommend options to a customer.

#### Acceptance Criteria

1. THE system SHALL display a unified catalog view showing services, merchandise, memberships, and packages
2. THE system SHALL support filtering the catalog by type (service, merchandise, membership, package)
3. THE system SHALL support filtering by category
4. THE system SHALL support searching by name or description
5. THE system SHALL display pricing (base price or "from $X" for variants)
6. THE system SHALL indicate which items are bookable vs. direct-purchase
7. THE system SHALL indicate active promotions or applicable discounts on catalog items

### Requirement 8: Orders

**User Story:** As a receptionist, I want to create orders that combine any mix of services, products, and memberships into a single transaction, so that the customer has one checkout experience.

#### Acceptance Criteria

1. THE system SHALL support creating an Order with one or more line items from the catalog (services, merchandise, memberships, packages)
2. THE system SHALL support orders with a linked customer OR anonymous/walk-in orders
3. THE system SHALL calculate order totals including: line item prices, applicable pricing rules/discounts, tax, and package redemptions
4. THE system SHALL support applying a customer's loyalty points or package credits at checkout
5. THE system SHALL support applying membership benefits (included services, discounts) at checkout
6. THE system SHALL generate an invoice from the order (integrates with Phase 26)
7. THE system SHALL support order status: draft, confirmed, completed, cancelled
8. THE system SHALL support adding notes to an order
9. THE system SHALL link bookable service line items to their corresponding booking
10. THE system SHALL support splitting an order across multiple payment methods

### Requirement 9: Security and Permissions

**User Story:** As a business owner, I want to control who can manage the product catalog, pricing, and process orders, so that sensitive business operations are restricted.

#### Acceptance Criteria

1. THE system SHALL define permissions for: catalog management (create/edit/delete services and merchandise), pricing rule management, membership plan management, order creation, order cancellation, discount override (manual discount at checkout)
2. THE system SHALL support configuring which roles have access to each permission
3. THE system SHALL log all catalog changes, pricing rule changes, and order actions in the audit trail
4. THE system SHALL restrict manual discount application to authorized roles only

### Requirement 10: Multi-Language Descriptions

**User Story:** As a business owner with an online presence, I want my product and service descriptions automatically translated into the languages my business supports, so that customers browsing in their preferred language see localized content.

#### Acceptance Criteria

1. THE system SHALL support storing descriptions in multiple languages for: services, merchandise, memberships, and packages
2. THE system SHALL allow staff to enter the description in the business's primary language
3. THE system SHALL provide a "Translate" action that sends the primary description to a translation service and generates versions in all other languages the business has enabled
4. THE system SHALL store translated descriptions per item per language
5. THE system SHALL allow staff to manually edit any translated description (to correct machine translation)
6. THE system SHALL indicate which translations are machine-generated vs. manually edited
7. THE system SHALL serve the appropriate language version based on the customer's language preference on customer-facing surfaces
8. THE system SHALL fall back to the primary language description if a translation is not available
9. THE system SHALL support re-translating when the primary description is updated (with confirmation, since manual edits would be overwritten)
10. THE system SHALL support configuring which languages a business operates in (defined in business settings)

---

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging, permissions
- Phase 03: Core Platform - Tenant/business context, configuration engine, i18n
- Phase 05: Customer Management - Customer records for order linkage and loyalty tracking
- Phase 07: Booking Engine - Booking creation for scheduled services
- Phase 10: Payment Platform - Payment processing for orders
- Phase 20: Integrations - Translation service API (Google Translate, DeepL, or similar)
- Phase 26: Invoicing & AR - Invoice generation from orders

## Success Criteria

- A business can define services with variants, merchandise, memberships, packages, and loyalty programs from one module
- Orders can contain any mix of catalog items including walk-in/anonymous
- Memberships generate recurring charges on schedule
- Packages track redemption accurately
- Loyalty points accrue from purchases and can be redeemed
- Pricing rules apply correctly at checkout across all product types
- The unified catalog provides a searchable, filterable view of everything the business offers

## Out of Scope

- Inventory management (stock levels, reorder, warehouse) — future phase if needed
- E-commerce / online storefront — Phase 18 (Website/CMS)
- Appointment scheduling logic — Phase 07 (Booking Engine handles time slot availability)
- Payment processing integrations — Phase 20 (Integrations)
- Gift cards as a product type — separate consideration tied to payment methods

## Notes

- This phase supersedes Phase 06 (Service Management), Phase 08 (Membership Engine), and Phase 09 (Pricing Engine). Those specs are retained for reference but this is the authoritative definition going forward.
- Pricing responsibility is clearly separated: base price lives on the item (service variant, merchandise, membership plan); membership discounts are defined on the membership; corporate rates are defined on the corporate account; promotions are time-limited marketing-driven adjustments.
- Merchandise intentionally has no inventory management. If a product is out of stock, the business simply disables it. Full inventory is a significant system that most service businesses don't need.
- Walk-in/anonymous orders support businesses like retail-heavy environments where not every customer provides details.
- Loyalty programs are optional and toggleable per business — not every business type benefits from them.
- The Order is the bridge between this module and the financial system (invoicing, payments). An order becomes an invoice which gets paid.
- Membership auto-billing will need integration with payment processors (Phase 20) for actual card charges. Until then, it generates the charge record and the business collects manually.

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 10, Phase 26
**Supersedes**: Phase 06, Phase 08, Phase 09
