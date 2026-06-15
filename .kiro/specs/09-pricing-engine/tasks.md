# Phase 09: Pricing Engine - Tasks

## Overview

Implementation tasks for the pricing engine — database schema, rule management, price calculation API, discount codes, promotions, tax calculation, bundles, corporate pricing, price history, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `pricing_rules` table (all rule types, conditions, stacking)
- [x] ✅ Create migration for `discount_codes` table (codes with validity, usage limits)
- [x] ✅ Create migration for `discount_code_usage` table (tracking per customer)
- [x] ✅ Create migration for `pricing_bundles` and `bundle_items` tables
- [x] ✅ Create migration for `corporate_accounts` and `corporate_account_members` tables
- [x] ✅ Create migration for `price_history` table

### 1.2 Indexes and Constraints
- [x] ✅ Add indexes for rule evaluation (business_id, status, effective dates)
- [x] ✅ Add RLS policies on all pricing tables (business-scoped)
- [x] ✅ Grant permissions to daystream_app role

---

## 2. Price Calculation Engine

### 2.1 Core Calculator
- [x] ✅ Create pricing calculation service
- [x] ✅ Load base price from variant/plan
- [x] ✅ Load customer context (memberships, corporate, booking count)
- [x] ✅ Gather applicable rules (scope + schedule + conditions)
- [x] ✅ Sort by priority, evaluate stacking mode
- [x] ✅ Enforce max discount percentage and min price floor
- [x] ✅ Calculate tax based on service tax category
- [x] ✅ Return PriceBreakdown (base, discounts, subtotal, tax, total)

### 2.2 Calculation API
- [x] ✅ Create `POST /api/v1/pricing/calculate` endpoint
- [x] ✅ Accept: items, customer_id, discount_code, booking datetime
- [x] ✅ Return PriceBreakdown within 200ms
- [x] ✅ Write unit tests (multiple rule scenarios)

---

## 3. Pricing Rules

### 3.1 Rules CRUD
- [x] ✅ Create `GET /api/v1/pricing/rules` endpoint
- [x] ✅ Create `POST /api/v1/pricing/rules` endpoint
- [x] ✅ Create `PUT /api/v1/pricing/rules/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/pricing/rules/:id` endpoint
- [x] ✅ Support all rule types (membership, promotion, seasonal, first_time, corporate, volume, time_of_day, day_of_week)
- [x] ✅ Validate rule conditions per type
- [x] ✅ Write unit tests

### 3.2 Rule Evaluation
- [x] ✅ Implement membership rule evaluation
- [x] ✅ Implement first-time customer detection
- [x] ✅ Implement time/day-based rules
- [x] ✅ Implement seasonal rules (date range)
- [x] ✅ Implement volume rules (item count threshold)
- [x] ✅ Write unit tests for each rule type

---

## 4. Discount Codes

### 4.1 Code CRUD
- [x] ✅ Create `GET /api/v1/pricing/codes` endpoint
- [x] ✅ Create `POST /api/v1/pricing/codes` endpoint
- [x] ✅ Create `POST /api/v1/pricing/codes/validate` endpoint
- [x] ✅ Create `POST /api/v1/pricing/codes/bulk` endpoint (generate N unique codes)
- [x] ✅ Create `PUT /api/v1/pricing/codes/:id` endpoint (update/deactivate)

### 4.2 Code Validation & Redemption
- [x] ✅ Validate code exists and is active
- [x] ✅ Check date range validity
- [x] ✅ Check total uses < max
- [x] ✅ Check per-customer uses < max
- [x] ✅ Check min purchase amount
- [x] ✅ Check service/category scope
- [x] ✅ Record usage on redemption
- [x] ✅ Write unit tests

---

## 5. Promotions

### 5.1 Promotion Management
- [x] ✅ Promotions are pricing_rules with rule_type = 'promotion'
- [x] ✅ Auto-activate on start date, auto-expire on end date (scheduled job)
- [x] ✅ Track redemption count, stop at max
- [x] ✅ Display active promotions in catalog (configurable)
- [x] ✅ Write unit tests

---

## 6. Tax Calculation

### 6.1 Tax Service
- [x] ✅ Load tax category for service/plan (from Phase 06 tax_categories)
- [x] ✅ Support tax-inclusive and tax-exclusive modes (per tenant config)
- [x] ✅ Calculate tax on final discounted amount
- [x] ✅ Include tax breakdown in PriceBreakdown
- [x] ✅ Write unit tests (inclusive and exclusive modes)

---

## 7. Bundles

### 7.1 Bundle CRUD
- [x] ✅ Create `GET /api/v1/pricing/bundles` endpoint
- [x] ✅ Create `POST /api/v1/pricing/bundles` endpoint
- [x] ✅ Create `PUT /api/v1/pricing/bundles/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/pricing/bundles/:id` endpoint (archive)
- [x] ✅ Support fixed_price and percentage_off bundle types
- [x] ✅ Calculate savings vs individual purchase
- [x] ✅ Write unit tests

---

## 8. Corporate Pricing

### 8.1 Corporate Accounts
- [x] ✅ Create `GET /api/v1/pricing/corporate` endpoint
- [x] ✅ Create `POST /api/v1/pricing/corporate` endpoint
- [x] ✅ Create `POST /api/v1/pricing/corporate/:id/members` endpoint
- [x] ✅ Create `DELETE /api/v1/pricing/corporate/:id/members/:customerId` endpoint
- [x] ✅ Apply corporate discount during price calculation
- [x] ✅ Write unit tests

---

## 9. Price History

### 9.1 History Tracking
- [x] ✅ Record price changes (old/new price, changed by, effective date)
- [x] ✅ Create `GET /api/v1/pricing/history` endpoint
- [x] ✅ Support effective date pricing (scheduled future price changes)
- [x] ✅ Write unit tests

---

## 10. Frontend

### 10.1 Pricing Rules Page
- [x] ✅ Create `/pricing/rules` page
- [x] ✅ List rules with status, type, discount, priority
- [x] ✅ Create/edit rule form with condition builder
- [x] ✅ Toggle active/inactive

### 10.2 Discount Codes Page
- [x] ✅ Create `/pricing/codes` page
- [x] ✅ List codes with usage tracking
- [x] ✅ Create single code form
- [x] ✅ Bulk generate interface
- [x] ✅ Deactivate codes

### 10.3 Bundles Page
- [x] ✅ Create `/pricing/bundles` page
- [x] ✅ Card grid of bundles with savings display
- [x] ✅ Create bundle form (select services, set pricing)

### 10.4 Price Calculator Widget
- [x] ✅ Embed in booking flow (Phase 07)
- [x] ✅ Show breakdown: base price → discounts → tax → total
- [x] ✅ Display discount code input field

---

## 11. Testing

### 11.1 Unit Tests
- [x] ✅ Test price calculation (single item, no discounts)
- [x] ✅ Test percentage discount rule
- [x] ✅ Test fixed amount discount rule
- [x] ✅ Test exclusive vs stackable rules
- [x] ✅ Test priority ordering
- [x] ✅ Test max discount cap and min price floor
- [x] ✅ Test discount code validation (valid, expired, over limit)
- [x] ✅ Test membership discount auto-application
- [x] ✅ Test first-time customer pricing
- [x] ✅ Test time-of-day and day-of-week rules
- [x] ✅ Test bundle pricing (fixed and percentage)
- [x] ✅ Test tax calculation (inclusive and exclusive)
- [x] ✅ Test corporate discount

### 11.2 Integration Tests
- [x] ✅ Test full calculation with multiple overlapping rules
- [x] ✅ Test discount code + membership discount stacking
- [x] ✅ Test promotion with redemption limit reached
- [x] ✅ Test bundle pricing end-to-end
- [x] ✅ Test business scoping (cannot use other business rules/codes)
