# Phase 09: Pricing Engine - Design Document

**Date**: June 14, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 06, Phase 08

---

## Overview

This document describes the technical design for the DayStream pricing engine — the centralized service that calculates final prices for any bookable item. It evaluates rules, promotions, membership discounts, discount codes, tax, and bundles to produce a Price_Breakdown. All other modules call this engine rather than calculating prices independently.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Price Calculation Algorithm](#2-price-calculation-algorithm)
3. [Rule Types & Evaluation](#3-rule-types--evaluation)
4. [Priority & Stacking](#4-priority--stacking)
5. [Discount Codes](#5-discount-codes)
6. [Promotions](#6-promotions)
7. [Tax Calculation](#7-tax-calculation)
8. [Bundles](#8-bundles)
9. [Corporate Pricing](#9-corporate-pricing)
10. [Price History](#10-price-history)
11. [API Endpoints](#11-api-endpoints)
12. [Frontend Views](#12-frontend-views)

---

## 1. Database Schema

### Pricing Rules

```sql
CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    rule_type VARCHAR(30) NOT NULL
        CHECK (rule_type IN ('membership', 'promotion', 'seasonal', 'first_time', 'corporate', 'volume', 'time_of_day', 'day_of_week')),
    -- Discount
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value INTEGER NOT NULL,              -- percentage (e.g., 20) or cents
    -- Priority & stacking
    priority INTEGER NOT NULL DEFAULT 100,        -- lower = higher priority
    stacking_mode VARCHAR(20) NOT NULL DEFAULT 'stackable'
        CHECK (stacking_mode IN ('stackable', 'exclusive', 'non_stackable')),
    -- Scope: what it applies to
    applies_to_all_services BOOLEAN NOT NULL DEFAULT true,
    service_ids UUID[],                           -- specific services (if not all)
    category_ids UUID[],                          -- specific categories
    variant_ids UUID[],                           -- specific variants
    -- Scope: who it applies to
    applies_to_all_customers BOOLEAN NOT NULL DEFAULT true,
    customer_segment VARCHAR(50),                 -- lifecycle stage or segment name
    membership_plan_ids UUID[],                   -- specific membership holders
    corporate_account_id UUID,
    -- Conditions
    min_purchase_amount INTEGER,
    max_redemptions INTEGER,
    current_redemptions INTEGER NOT NULL DEFAULT 0,
    first_time_booking_limit INTEGER,             -- for first_time rules
    -- Schedule
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    time_from TIME,                               -- for time_of_day rules
    time_to TIME,
    days_of_week INTEGER[],                       -- for day_of_week rules (0-6)
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Discount Codes

```sql
CREATE TABLE discount_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value INTEGER NOT NULL,
    -- Validity
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    max_total_uses INTEGER,
    max_uses_per_customer INTEGER DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    min_purchase_amount INTEGER,
    -- Scope
    applies_to_all_services BOOLEAN NOT NULL DEFAULT true,
    service_ids UUID[],
    category_ids UUID[],
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'expired')),
    is_single_use BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, code)
);
```

### Discount Code Usage Tracking

```sql
CREATE TABLE discount_code_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_id UUID NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id),
    amount_saved INTEGER NOT NULL,                -- cents saved
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Bundles

```sql
CREATE TABLE pricing_bundles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    bundle_type VARCHAR(20) NOT NULL CHECK (bundle_type IN ('fixed_price', 'percentage_off')),
    bundle_price INTEGER,                         -- for fixed_price (cents)
    discount_percentage INTEGER,                  -- for percentage_off
    expiration_days INTEGER,                      -- must use within X days of purchase
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bundle_items (
    bundle_id UUID NOT NULL REFERENCES pricing_bundles(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES service_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (bundle_id, variant_id)
);
```

### Corporate Accounts

```sql
CREATE TABLE corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(255),
    billing_email VARCHAR(255),
    discount_percentage INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE corporate_account_members (
    account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    PRIMARY KEY (account_id, customer_id)
);
```

### Price History

```sql
CREATE TABLE price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    entity_type VARCHAR(20) NOT NULL,             -- 'service_variant' or 'membership_plan'
    entity_id UUID NOT NULL,
    old_price INTEGER NOT NULL,
    new_price INTEGER NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. Price Calculation Algorithm

```typescript
async function calculatePrice(input: PriceCalculationInput): Promise<PriceBreakdown> {
  1. Load base price from variant/plan
  2. Load customer context (memberships, corporate account, booking history)
  3. Gather applicable rules (matching scope + schedule + conditions)
  4. Sort by priority
  5. Evaluate stacking mode:
     - If any exclusive rule applies → use best exclusive rule only
     - Otherwise → stack all stackable rules
  6. Apply discount code (if provided and valid)
  7. Enforce max discount % and min price floor
  8. Calculate tax on final discounted amount
  9. Return PriceBreakdown
}
```

### PriceBreakdown Structure

```typescript
interface PriceBreakdown {
  base_price: number;
  discounts: Array<{ rule_name: string; type: string; amount: number }>;
  subtotal: number;           // base - discounts
  tax_rate: number;           // basis points
  tax_amount: number;
  total: number;              // subtotal + tax (or subtotal if tax-inclusive)
  currency: string;
  discount_code_applied?: string;
  savings: number;            // total discount amount
}
```

---

## 3. Rule Types & Evaluation

| Rule Type | Conditions Checked |
|-----------|-------------------|
| membership | Customer has active membership with matching plan |
| promotion | Current date within effective range, redemption limit |
| seasonal | Current date within range |
| first_time | Customer has fewer than N prior bookings |
| corporate | Customer belongs to corporate account |
| volume | Number of items in cart >= threshold |
| time_of_day | Booking time within time range |
| day_of_week | Booking day matches specified days |

---

## 4. Priority & Stacking

1. Sort rules by priority (ascending — lower number = higher priority)
2. If an `exclusive` rule applies: only the highest-priority exclusive rule is used
3. `non_stackable` rules: only one per rule_type applies
4. `stackable` rules: all applicable ones combine (percentage discounts multiply, fixed amounts sum)
5. After all rules: enforce max_discount_percentage and min_price_floor from tenant config

---

## 5. Discount Codes

Validation checklist:
- Code exists and is active
- Current date within valid_from/valid_to
- Total uses < max_total_uses
- Customer uses < max_uses_per_customer
- Purchase amount >= min_purchase_amount
- Service/category in scope (if restricted)

Applied AFTER pricing rules. Does not interact with stacking logic — always additive.

---

## 6. Promotions

Promotions are a specialization of pricing_rules with `rule_type = 'promotion'`. They have:
- Effective date range (auto-activate/deactivate)
- Optional max redemptions
- Visible in catalog (configurable)

A scheduled job transitions expired promotions to `status = 'expired'`.

---

## 7. Tax Calculation

```
If tax_display = 'exclusive':
  subtotal = base_price - discounts
  tax = subtotal × rate / 10000
  total = subtotal + tax

If tax_display = 'inclusive':
  total = base_price - discounts (includes tax)
  tax = total - (total × 10000 / (10000 + rate))
  subtotal = total - tax
```

Rate stored in basis points (2100 = 21.00%). Loaded from tax_categories (Phase 06).

---

## 8. Bundles

- Fixed price bundle: total = bundle_price regardless of individual prices
- Percentage off: total = sum(individual prices) × (1 - discount/100)
- Savings displayed as: sum(individual) - bundle_price
- Must validate all items available before applying

---

## 9. Corporate Pricing

- Corporate account has a default discount_percentage
- Additionally, specific pricing_rules can target the corporate account
- Members linked via corporate_account_members
- Evaluated during price calculation if customer is in a corporate account

---

## 10. Price History

Every price change (on service_variants or membership_plans) creates a price_history entry. Used for:
- Audit trail
- Effective date pricing (scheduled changes)
- Historical reporting

---

## 11. API Endpoints

### Price Calculation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/pricing/calculate` | Calculate final price |

### Pricing Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pricing/rules` | List rules |
| POST | `/api/v1/pricing/rules` | Create rule |
| PUT | `/api/v1/pricing/rules/:id` | Update rule |
| DELETE | `/api/v1/pricing/rules/:id` | Delete rule |

### Discount Codes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pricing/codes` | List codes |
| POST | `/api/v1/pricing/codes` | Create code |
| POST | `/api/v1/pricing/codes/validate` | Validate a code |
| POST | `/api/v1/pricing/codes/bulk` | Bulk generate codes |
| PUT | `/api/v1/pricing/codes/:id` | Update/deactivate code |

### Bundles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pricing/bundles` | List bundles |
| POST | `/api/v1/pricing/bundles` | Create bundle |
| PUT | `/api/v1/pricing/bundles/:id` | Update bundle |
| DELETE | `/api/v1/pricing/bundles/:id` | Archive bundle |

### Corporate Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pricing/corporate` | List accounts |
| POST | `/api/v1/pricing/corporate` | Create account |
| POST | `/api/v1/pricing/corporate/:id/members` | Add member |
| DELETE | `/api/v1/pricing/corporate/:id/members/:customerId` | Remove member |

### Price History

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pricing/history` | Get price change log |

---

## 12. Frontend Views

### Pricing Rules Page (`/pricing/rules`)
- List rules with status, type, discount, priority
- Create/edit rule with condition builder
- Toggle active/inactive

### Discount Codes Page (`/pricing/codes`)
- List codes with usage counts
- Create single or bulk codes
- Deactivate codes

### Bundles Page (`/pricing/bundles`)
- Card grid of active bundles
- Create bundle (select services, set price)
- Show savings vs. individual purchase

### Price Calculator (embedded)
- Widget used in booking flow
- Shows breakdown: base, discounts, tax, total

---

**Last Updated**: June 14, 2026
