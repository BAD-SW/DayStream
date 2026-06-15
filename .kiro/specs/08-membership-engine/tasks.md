# Phase 08: Membership & Subscriptions - Tasks

## Overview

Implementation tasks for the membership engine — database schema, plan configuration, membership lifecycle, credit management, billing integration, freeze/pause, upgrade/downgrade, benefits, punch cards, family memberships, reporting, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `membership_plans` table (all plan types, billing cycles, credit config)
- [x] ✅ Create migration for `plan_service_access` table (service/category access per plan)
- [x] ✅ Create migration for `plan_benefits` table (discount, priority, exclusive, guest pass)
- [x] ✅ Create migration for `plan_upgrade_paths` table (upgrade/downgrade relationships)
- [x] ✅ Create migration for `memberships` table (active instances with status, credits, pause tracking)
- [x] ✅ Create migration for `credit_transactions` table (allocation, deduction, restoration, expiration)
- [x] ✅ Create migration for `membership_status_history` table

### 1.2 Indexes and Constraints
- [x] ✅ Add indexes for membership queries (customer_id, plan_id, status, billing date)
- [x] ✅ Add RLS policies on all membership tables (business-scoped)
- [x] ✅ Grant permissions to daystream_app role

---

## 2. Membership Plans

### 2.1 Plan CRUD
- [x] ✅ Create `GET /api/v1/memberships/plans` endpoint (list with filters)
- [x] ✅ Create `POST /api/v1/memberships/plans` endpoint (create with full config)
- [x] ✅ Create `GET /api/v1/memberships/plans/:id` endpoint (detail with benefits, services)
- [x] ✅ Create `PUT /api/v1/memberships/plans/:id` endpoint (update)
- [x] ✅ Create `PUT /api/v1/memberships/plans/:id/archive` endpoint
- [x] ✅ Validate plan type + billing cycle consistency
- [x] ✅ Write unit tests

### 2.2 Plan Service Access
- [x] ✅ Create API to configure which services a plan includes
- [x] ✅ Support per-service credit costs
- [x] ✅ Support category-level access (all services in category)
- [x] ✅ Write unit tests

### 2.3 Plan Benefits
- [x] ✅ Create API to configure benefits per plan
- [x] ✅ Support benefit types: discount, priority_booking, exclusive_access, guest_pass, free_addon
- [x] ✅ Write unit tests

---

## 3. Membership Purchase & Activation

### 3.1 Purchase Flow
- [x] ✅ Create `POST /api/v1/memberships` endpoint (purchase/activate)
- [x] ✅ Validate plan eligibility (intro package: first-time only)
- [x] ✅ Prevent duplicate active memberships of same plan
- [x] ✅ Set billing cycle dates (start, next billing)
- [x] ✅ Allocate initial credits (for credit-based plans)
- [x] ✅ Create status history entry
- [x] ✅ Log in customer activity timeline

### 3.2 Staff-Initiated Activation
- [x] ✅ Support creating memberships on behalf of customers
- [x] ✅ Skip payment for staff-initiated (mark as confirmed directly)
- [x] ✅ Write unit tests

---

## 4. Membership Lifecycle

### 4.1 Status Transitions
- [x] ✅ Implement status transition validation (state machine)
- [x] ✅ Create `PUT /api/v1/memberships/:id/cancel` endpoint (with reason)
- [x] ✅ Implement auto-expiration (scheduled job: check end dates, exhausted credits)
- [x] ✅ Record all transitions in membership_status_history
- [x] ✅ Log in audit trail
- [x] ✅ Write unit tests (valid and invalid transitions)

---

## 5. Credit Management

### 5.1 Credit Operations
- [x] ✅ Create `GET /api/v1/memberships/:id/credits` endpoint (balance + history)
- [x] ✅ Create `POST /api/v1/memberships/:id/credits/deduct` endpoint
- [x] ✅ Create `POST /api/v1/memberships/:id/credits/restore` endpoint
- [x] ✅ Create `POST /api/v1/memberships/:id/credits/adjust` endpoint (admin)
- [x] ✅ Implement FIFO consumption (oldest credits used first)
- [x] ✅ Implement credit allocation on renewal
- [x] ✅ Implement rollover logic (none, limited, unlimited)

### 5.2 Credit Expiration
- [x] ✅ Create scheduled job to expire credits past validity period
- [x] ✅ Extend expiration during pause
- [x] ✅ Log expired credits in transaction history
- [x] ✅ Write unit tests (allocation, deduction, restore, expire, rollover)

---

## 6. Billing Integration

### 6.1 Renewal Processing
- [x] ✅ Create scheduled job to process renewals on billing date
- [x] ✅ Initiate payment via Payment Platform interface (Phase 10)
- [x] ✅ On success: extend membership, allocate credits
- [x] ✅ On failure: enter dunning flow (retry day 1, 3, 7)
- [x] ✅ After max retries: expire membership
- [x] ✅ Send renewal notifications (before, on failure)

### 6.2 Proration Calculator
- [x] ✅ Calculate prorated amount for mid-cycle upgrades
- [x] ✅ Calculate remaining days in cycle
- [x] ✅ Write unit tests

---

## 7. Freeze/Pause

### 7.1 Pause API
- [x] ✅ Create `PUT /api/v1/memberships/:id/pause` endpoint
- [x] ✅ Validate plan limits (max days, max pauses per year)
- [x] ✅ Stop billing, extend end date
- [x] ✅ Pause credit expiration timers
- [x] ✅ Create `PUT /api/v1/memberships/:id/resume` endpoint
- [x] ✅ Auto-resume scheduled job (when pause_end_date reached)
- [x] ✅ Support admin override (bypass limits)
- [x] ✅ Write unit tests

---

## 8. Upgrade/Downgrade

### 8.1 Plan Change API
- [x] ✅ Create `PUT /api/v1/memberships/:id/upgrade` endpoint
- [x] ✅ Create `PUT /api/v1/memberships/:id/downgrade` endpoint
- [x] ✅ Validate upgrade/downgrade paths
- [x] ✅ Upgrade: immediate switch + proration charge
- [x] ✅ Downgrade: schedule for end of cycle
- [x] ✅ Transfer/adjust credits on plan change
- [x] ✅ Write unit tests

---

## 9. Benefits System

### 9.1 Benefits Engine
- [x] ✅ Create service to evaluate benefits at booking time
- [x] ✅ Apply percentage discounts automatically
- [x] ✅ Validate exclusive access (membership required)
- [x] ✅ Track guest pass usage per cycle
- [x] ✅ Reset cycle-based benefits on renewal
- [x] ✅ Write unit tests

---

## 10. Punch Cards & Intro Packages

### 10.1 Punch Card Logic
- [x] ✅ Support one-time purchase (no recurring billing)
- [x] ✅ Deduct sessions on booking
- [x] ✅ Support expiration from purchase date
- [x] ✅ Allow multiple active punch cards per customer

### 10.2 Intro Package Logic
- [x] ✅ Validate first-time customer eligibility
- [x] ✅ Prevent re-purchase by same customer
- [x] ✅ Support conversion to recurring membership
- [x] ✅ Write unit tests

---

## 11. Family Memberships

### 11.1 Family Member Management
- [x] ✅ Create `POST /api/v1/memberships/:id/members` endpoint (add member)
- [x] ✅ Create `DELETE /api/v1/memberships/:id/members/:customerId` endpoint
- [x] ✅ Create `GET /api/v1/memberships/:id/members` endpoint
- [x] ✅ Enforce max additional members per plan
- [x] ✅ Support shared vs. individual credit pools
- [x] ✅ Deactivate additional members on primary cancellation
- [x] ✅ Write unit tests

---

## 12. Reporting

### 12.1 Membership Reports API
- [x] ✅ Create `GET /api/v1/memberships/reports/summary` endpoint
- [x] ✅ Active count by plan type
- [x] ✅ New memberships / cancellations per period
- [x] ✅ Renewal rate calculation
- [x] ✅ Create `GET /api/v1/memberships/reports/credits` endpoint
- [x] ✅ Credit utilization rate
- [x] ✅ Revenue per period
- [x] ✅ Write unit tests

---

## 13. Frontend

### 13.1 Plans Page
- [x] ✅ Create `/memberships/plans` page with card grid
- [x] ✅ Plan detail view (benefits, services, pricing)
- [x] ✅ Create/edit plan form
- [x] ✅ Archive plan

### 13.2 Membership List Page
- [x] ✅ Create `/memberships` page with table
- [x] ✅ Filters (status, plan type, date range)
- [x] ✅ Quick actions (pause, resume, cancel)

### 13.3 Membership Detail Page
- [x] ✅ Create `/memberships/:id` page
- [x] ✅ Status + plan info + billing info
- [x] ✅ Credit balance + transaction history
- [x] ✅ Pause/resume/cancel/upgrade actions
- [x] ✅ Family members section

### 13.4 Customer Membership View
- [x] ✅ Create `/profile/membership` page
- [x] ✅ Current plan, credit balance, next billing
- [x] ✅ Pause/cancel/upgrade self-service

---

## 14. Testing

### 14.1 Unit Tests
- [x] ✅ Test plan CRUD (all types)
- [x] ✅ Test membership purchase (credit allocation, status)
- [x] ✅ Test lifecycle transitions (all valid and invalid)
- [x] ✅ Test credit operations (deduct, restore, expire, rollover)
- [x] ✅ Test pause/resume (billing, credits, limits)
- [x] ✅ Test upgrade/downgrade (proration, credit transfer)
- [x] ✅ Test punch card (deduct, expire)
- [x] ✅ Test intro package (eligibility, prevention of re-purchase)
- [x] ✅ Test family membership (add/remove, shared credits)

### 14.2 Integration Tests
- [x] ✅ Test full membership flow (purchase → use credits → renew → upgrade → cancel)
- [x] ✅ Test credit lifecycle (allocate → deduct on booking → restore on cancel → expire)
- [x] ✅ Test pause flow (pause → no billing → resume → credits extended)
- [x] ✅ Test family membership (primary + additional, shared pool)
- [x] ✅ Test business scoping (cannot access other business memberships)
