# Phase 08: Membership & Subscriptions - Design Document

**Date**: June 14, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 06, Phase 07, Phase 10

---

## Overview

This document describes the technical design for the DayStream membership and subscription engine — plan configuration, membership lifecycle, credit management, billing integration, freeze/resume, upgrade/downgrade, benefits, punch cards, family memberships, and reporting.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Plan Types](#2-plan-types)
3. [Membership Lifecycle](#3-membership-lifecycle)
4. [Credit System](#4-credit-system)
5. [Billing Integration](#5-billing-integration)
6. [Freeze/Pause](#6-freezepause)
7. [Upgrade/Downgrade](#7-upgradedowngrade)
8. [Benefits System](#8-benefits-system)
9. [Punch Cards & Intro Packages](#9-punch-cards--intro-packages)
10. [Family Memberships](#10-family-memberships)
11. [Reporting](#11-reporting)
12. [API Endpoints](#12-api-endpoints)
13. [Frontend Views](#13-frontend-views)

---

## 1. Database Schema

### Membership Plans

```sql
CREATE TABLE membership_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    plan_type VARCHAR(20) NOT NULL
        CHECK (plan_type IN ('unlimited', 'credit', 'hybrid', 'punch_card', 'intro_package')),
    billing_cycle VARCHAR(20) NOT NULL
        CHECK (billing_cycle IN ('monthly', 'quarterly', 'annually', 'one_time')),
    price INTEGER NOT NULL,                                   -- cents
    -- Credit configuration
    credits_per_cycle INTEGER,                                -- NULL for unlimited
    credit_validity_days INTEGER,                             -- days before credits expire
    rollover_policy VARCHAR(20) DEFAULT 'none'
        CHECK (rollover_policy IN ('none', 'limited', 'unlimited')),
    max_rollover_credits INTEGER,                             -- for limited rollover
    -- Punch card / intro
    total_sessions INTEGER,                                   -- for punch cards
    expiration_days INTEGER,                                  -- days until punch card expires
    is_intro_only BOOLEAN NOT NULL DEFAULT false,             -- first-time customers only
    -- Limits
    max_frequency_per_day INTEGER,                            -- e.g., 1 session per day
    trial_days INTEGER DEFAULT 0,
    max_pause_days_per_year INTEGER DEFAULT 30,
    max_pauses_per_year INTEGER DEFAULT 2,
    -- Family
    max_additional_members INTEGER DEFAULT 0,
    shared_credits BOOLEAN DEFAULT false,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Plan Service Access (which services a plan includes)

```sql
CREATE TABLE plan_service_access (
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE CASCADE,
    credit_cost INTEGER NOT NULL DEFAULT 1,                   -- credits consumed per booking
    access_type VARCHAR(20) NOT NULL DEFAULT 'included'
        CHECK (access_type IN ('included', 'discounted', 'exclusive')),
    discount_percentage INTEGER,                              -- for discounted access
    PRIMARY KEY (plan_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'), COALESCE(category_id, '00000000-0000-0000-0000-000000000000'))
);
```

### Plan Benefits

```sql
CREATE TABLE plan_benefits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    benefit_type VARCHAR(30) NOT NULL
        CHECK (benefit_type IN ('discount', 'priority_booking', 'exclusive_access', 'guest_pass', 'free_addon')),
    value INTEGER,                                            -- percentage or count
    description VARCHAR(200),
    per_cycle BOOLEAN NOT NULL DEFAULT true                   -- resets each billing cycle
);
```

### Plan Upgrade Paths

```sql
CREATE TABLE plan_upgrade_paths (
    from_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    to_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('upgrade', 'downgrade')),
    PRIMARY KEY (from_plan_id, to_plan_id)
);
```

### Memberships (active instances)

```sql
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    plan_id UUID NOT NULL REFERENCES membership_plans(id),
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'paused', 'frozen', 'cancelled', 'expired')),
    -- Billing
    start_date DATE NOT NULL,
    end_date DATE,                                            -- NULL for ongoing recurring
    next_billing_date DATE,
    auto_renew BOOLEAN NOT NULL DEFAULT true,
    -- Credits
    credit_balance INTEGER NOT NULL DEFAULT 0,
    -- Pause tracking
    paused_at TIMESTAMPTZ,
    pause_end_date DATE,
    total_paused_days INTEGER NOT NULL DEFAULT 0,
    pause_count INTEGER NOT NULL DEFAULT 0,
    -- Family
    primary_membership_id UUID REFERENCES memberships(id),    -- NULL if primary
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id),
    cancellation_reason TEXT,
    created_by UUID REFERENCES users(id)
);
```

### Credit Transactions

```sql
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('allocated', 'deducted', 'restored', 'expired', 'adjusted', 'rollover')),
    amount INTEGER NOT NULL,                                  -- positive = credit, negative = debit
    balance_after INTEGER NOT NULL,
    description TEXT,
    booking_id UUID REFERENCES bookings(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Membership Status History

```sql
CREATE TABLE membership_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. Plan Types

| Type | Billing | Credits | Access | Example |
|------|---------|---------|--------|---------|
| unlimited | recurring | N/A | All included services | "Unlimited Monthly" €129/mo |
| credit | recurring | X per cycle | Deduct per booking | "20 Credits Monthly" €99/mo |
| hybrid | recurring | X credits + unlimited on some | Mixed | "Unlimited Sauna + 4 Massage Credits" |
| punch_card | one-time | Fixed total | Deduct per booking | "10 Session Pack" €450 |
| intro_package | one-time | Fixed total | First-time only | "3 Session Intro" €99 |

---

## 3. Membership Lifecycle

```
         ┌──────────┐
         │ Pending  │
         └─────┬────┘
               │ payment success
         ┌─────▼────┐
    ┌────│  Active  │────┐
    │    └─────┬────┘    │
    │ pause    │ freeze  │ cancel/expire
┌───▼───┐  ┌──▼────┐  ┌─▼──────────┐
│Paused │  │Frozen │  │Cancelled/  │
└───┬───┘  └──┬────┘  │Expired     │
    │ resume   │ resume └────────────┘
    └──────────┴────► Active
```

---

## 4. Credit System

### Allocation
- Credits allocated on activation and each renewal
- FIFO consumption (oldest credits used first)
- Configurable expiration (days from allocation)

### Deduction Flow
```
1. Customer books service
2. Check membership access: is service included in plan?
3. Check credit cost for this service (plan_service_access.credit_cost)
4. Check credit balance >= cost
5. Deduct credits (create credit_transaction)
6. Confirm booking
```

### Rollover
- **None**: Unused credits expire at cycle end
- **Limited**: Up to max_rollover_credits carry forward
- **Unlimited**: All unused credits carry forward

---

## 5. Billing Integration

DayStream initiates all billing. The membership engine:
1. Determines when payment is due (next_billing_date)
2. Calculates amount (plan price, proration if applicable)
3. Calls Payment Platform (Phase 10) to charge
4. On success: extends membership, allocates credits
5. On failure: enters dunning flow (retry day 1, 3, 7)
6. After max retries: expire membership, notify customer

---

## 6. Freeze/Pause

- Customer-initiated: subject to plan limits (max days, max pauses)
- Admin-initiated: no limits (override for medical etc.)
- During pause: no billing, no booking, credit timers paused
- End date extended by pause duration
- Auto-resume on pause_end_date

---

## 7. Upgrade/Downgrade

### Upgrade (immediate)
1. Calculate remaining days in current cycle
2. Prorate: (new_price - old_price) × (remaining_days / total_days)
3. Charge proration amount
4. Switch plan immediately
5. Transfer/adjust credits if applicable

### Downgrade (end of cycle)
1. Record pending plan change
2. At next renewal: switch to new plan
3. New credits allocated per new plan
4. No refund for current cycle

---

## 8. Benefits System

Benefits configured per plan, evaluated at:
- **Booking time**: discount applied, priority validated, exclusive access checked
- **Cycle renewal**: guest passes reset, add-on counts reset

---

## 9. Punch Cards & Intro Packages

- One-time purchase, no recurring billing
- Fixed session count, decrement on booking
- Expiration from purchase date
- Intro: validated that customer has no prior memberships/purchases
- Can coexist with a recurring membership

---

## 10. Family Memberships

- Primary member owns the membership and billing
- Additional members linked via `primary_membership_id`
- Shared credits: all draw from primary's balance
- Individual credits: each gets their own allocation
- Max additional members per plan config

---

## 11. Reporting

Queries against memberships + credit_transactions:
- Active count by plan, new/cancelled per period
- Revenue = SUM of successful billing events
- Churn = cancelled / (active + cancelled) per period
- Credit utilization = deducted / allocated per period
- Average duration = AVG(cancelled_at - start_date)

---

## 12. API Endpoints

### Plans

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/memberships/plans` | List plans |
| POST | `/api/v1/memberships/plans` | Create plan |
| GET | `/api/v1/memberships/plans/:id` | Get plan detail |
| PUT | `/api/v1/memberships/plans/:id` | Update plan |
| PUT | `/api/v1/memberships/plans/:id/archive` | Archive plan |

### Memberships

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/memberships` | Purchase/activate membership |
| GET | `/api/v1/memberships` | List memberships (filtered) |
| GET | `/api/v1/memberships/:id` | Get membership detail |
| PUT | `/api/v1/memberships/:id/pause` | Pause membership |
| PUT | `/api/v1/memberships/:id/resume` | Resume membership |
| PUT | `/api/v1/memberships/:id/cancel` | Cancel membership |
| PUT | `/api/v1/memberships/:id/upgrade` | Upgrade plan |
| PUT | `/api/v1/memberships/:id/downgrade` | Downgrade plan |

### Credits

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/memberships/:id/credits` | Get credit balance + history |
| POST | `/api/v1/memberships/:id/credits/deduct` | Deduct credits (booking) |
| POST | `/api/v1/memberships/:id/credits/restore` | Restore credits (cancel) |
| POST | `/api/v1/memberships/:id/credits/adjust` | Manual adjustment (admin) |

### Family

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/memberships/:id/members` | Add family member |
| DELETE | `/api/v1/memberships/:id/members/:customerId` | Remove family member |
| GET | `/api/v1/memberships/:id/members` | List family members |

### Reporting

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/memberships/reports/summary` | Overview metrics |
| GET | `/api/v1/memberships/reports/churn` | Churn analysis |
| GET | `/api/v1/memberships/reports/credits` | Credit utilization |

---

## 13. Frontend Views

### Plans Page (`/memberships/plans`)
- Card grid of available plans
- Plan detail: type, price, credits, benefits, included services
- Create/edit plan form
- Archive plan

### Membership List (`/memberships`)
- Table: customer, plan, status, start date, credits, next billing
- Filters: status, plan type, date range
- Quick actions: pause, resume, cancel

### Membership Detail (`/memberships/:id`)
- Status badge, plan info, billing info
- Credit balance + transaction history
- Pause/resume/cancel/upgrade actions
- Family members list

### Customer Membership View (`/profile/membership`)
- Current plan, status, next billing date
- Credit balance and usage chart
- Pause/cancel actions
- Upgrade/downgrade options

---

**Last Updated**: June 14, 2026
