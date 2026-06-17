# Phase 15: Check-In System - Design Document

**Date**: June 16, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 08, Phase 09, Phase 10

---

## Overview

This document describes the technical design for the DayStream check-in system — QR code generation and scanning, reception check-in, kiosk mode, session validation (membership/credits), no-show detection and enforcement, walk-in handling, late arrival policies, real-time dashboard, attendance reporting, and check-in notifications.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [QR Code Generation](#2-qr-code-generation)
3. [Session Validation Algorithm](#3-session-validation-algorithm)
4. [No-Show Detection](#4-no-show-detection)
5. [Walk-In Flow](#5-walk-in-flow)
6. [Real-Time Dashboard](#6-real-time-dashboard)
7. [API Endpoints](#7-api-endpoints)
8. [Frontend Views](#8-frontend-views)

---

## 1. Database Schema

### Check-In Records

```sql
CREATE TABLE check_in_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    check_in_method VARCHAR(20) NOT NULL
        CHECK (check_in_method IN ('qr_staff', 'qr_self', 'reception', 'kiosk', 'walk_in')),
    status VARCHAR(20) NOT NULL DEFAULT 'checked_in'
        CHECK (status IN ('checked_in', 'in_progress', 'completed', 'cancelled')),
    validated BOOLEAN NOT NULL DEFAULT true,
    validation_warnings JSONB DEFAULT '[]',
    override_reason VARCHAR(200),
    processed_by UUID REFERENCES users(id),
    location_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_in_records_tenant ON check_in_records(tenant_id);
CREATE INDEX idx_check_in_records_booking ON check_in_records(booking_id);
CREATE INDEX idx_check_in_records_customer ON check_in_records(customer_id);
CREATE INDEX idx_check_in_records_date ON check_in_records(tenant_id, check_in_time);
```

### QR Codes

```sql
CREATE TABLE check_in_qr_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL UNIQUE,
    code_type VARCHAR(20) NOT NULL
        CHECK (code_type IN ('booking', 'customer')),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_codes_code ON check_in_qr_codes(code);
CREATE INDEX idx_qr_codes_customer ON check_in_qr_codes(customer_id);
CREATE INDEX idx_qr_codes_booking ON check_in_qr_codes(booking_id);
```

### No-Show Tracking

```sql
CREATE TABLE no_show_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fee_amount INTEGER DEFAULT 0,
    fee_charged BOOLEAN NOT NULL DEFAULT false,
    waived BOOLEAN NOT NULL DEFAULT false,
    waived_by UUID REFERENCES users(id),
    waive_reason VARCHAR(200),
    notified BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_no_show_records_customer ON no_show_records(customer_id);
CREATE INDEX idx_no_show_records_tenant ON no_show_records(tenant_id);
```

### Check-In Configuration

```sql
CREATE TABLE check_in_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    grace_period_minutes INTEGER NOT NULL DEFAULT 15,
    early_arrival_minutes INTEGER NOT NULL DEFAULT 15,
    late_arrival_max_minutes INTEGER NOT NULL DEFAULT 30,
    credit_deduction_mode VARCHAR(20) NOT NULL DEFAULT 'on_booking'
        CHECK (credit_deduction_mode IN ('on_booking', 'on_checkin')),
    no_show_warning_threshold INTEGER NOT NULL DEFAULT 2,
    no_show_restrict_threshold INTEGER NOT NULL DEFAULT 4,
    no_show_ban_threshold INTEGER NOT NULL DEFAULT 6,
    walk_in_enabled BOOLEAN NOT NULL DEFAULT true,
    kiosk_enabled BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(tenant_id)
);
```

### Kiosk Sessions

```sql
CREATE TABLE kiosk_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    device_name VARCHAR(100),
    token VARCHAR(200) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. QR Code Generation

### Booking QR Code
- Generated when a booking is confirmed
- Encodes: `DSCI-{bookingId short hash}-{random}`
- Expires: end of booking day + grace period
- Included in: confirmation email, customer dashboard
- One-time use (deactivated after check-in)

### Customer QR Code (Persistent)
- Generated per customer, long-lived
- Encodes: `DSCC-{customerId short hash}-{random}`
- Used for walk-in and membership check-in
- Regeneratable if lost (old code deactivated)
- Does not expire (deactivated only on regeneration)

### QR Scan Flow
```
Staff/kiosk scans code
    ↓
System decodes → identifies booking or customer
    ↓
If booking code: validate that specific booking
If customer code: find today's booking for this customer
    ↓
Run Session Validation
    ↓
Success → create check_in_record
Failure → show error/warning with override option
```

---

## 3. Session Validation Algorithm

```
validateSession(bookingId, customerId, tenantId):
    results = { pass: true, warnings: [], errors: [] }

    1. Booking validation:
       - Booking exists and status = 'confirmed'
       - Booking is for today (within early_arrival_minutes before start)
       - Booking not already checked in (prevent double check-in)
       → If fail: error("No valid booking found for today")

    2. Membership validation (if service requires membership):
       - Customer has active membership
       - Membership covers this service type
       → If expired: error("Membership expired")
       → If expiring within 7 days: warning("Membership expiring soon")

    3. Credit validation (if credit-based):
       - If credit_deduction_mode = 'on_checkin':
         - Check customer has sufficient credits
         → If insufficient: error("Insufficient credits")
       - If credit_deduction_mode = 'on_booking':
         - Credits already deducted, skip

    4. Outstanding balance check (if configured):
       - Check for unpaid invoices > threshold
       → If found: warning("Outstanding balance") or error (configurable)

    5. No-show restriction check:
       - Count recent no-shows for customer
       - If >= restrict_threshold: error("Booking restricted due to no-shows")
       - If >= warning_threshold: warning("No-show warning")

    Return results
```

---

## 4. No-Show Detection

```
Runs as a scheduled job every 5 minutes:

1. Find bookings WHERE:
   - status = 'confirmed'
   - start_time < NOW() - grace_period
   - No check_in_record exists
   - Not already marked as no_show

2. For each:
   - Update booking status = 'no_show'
   - Create no_show_record
   - Apply no-show fee (from cancellation policy)
   - Notify customer
   - Increment customer no-show count
   - If credit_deduction_mode = 'on_booking': optionally restore credits (configurable)
   - Release any held resources
```

---

## 5. Walk-In Flow

```
Customer arrives without booking
    ↓
Identify customer (QR, name/phone lookup, or new customer)
    ↓
Check available services NOW at this location
    ↓
Customer selects service
    ↓
Validate: membership/credits/payment
    ↓
Create instant booking (start_time = NOW, end_time = NOW + duration)
    ↓
Reserve resource (if needed)
    ↓
Create check_in_record (method = 'walk_in')
    ↓
Done — customer is checked in
```

---

## 6. Real-Time Dashboard

Dashboard categorizes today's bookings into states:

| State | Condition |
|-------|-----------|
| Upcoming | start_time > NOW, no check-in |
| Awaiting | start_time ≤ NOW, within grace period, no check-in |
| Overdue | start_time + grace < NOW, no check-in, not yet no-show |
| Checked In | check_in_record exists, status = 'checked_in' |
| In Progress | session started (check-in + session offset) |
| Completed | booking status = 'completed' |
| No-Show | booking status = 'no_show' |

Auto-refreshes via polling (every 15 seconds). WebSocket upgrade possible later.

---

## 7. API Endpoints

### Check-In

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/check-in/qr` | QR code check-in (staff or self) |
| POST | `/api/v1/check-in/reception` | Reception check-in (by booking ID) |
| POST | `/api/v1/check-in/kiosk` | Kiosk check-in (QR, reference, or name) |
| POST | `/api/v1/check-in/walk-in` | Walk-in check-in (create + check-in) |
| GET | `/api/v1/check-in/validate/:bookingId` | Pre-validate (dry run) |

### QR Codes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/check-in/qr-code/booking/:bookingId` | Get/generate booking QR |
| GET | `/api/v1/check-in/qr-code/customer/:customerId` | Get/generate customer QR |
| POST | `/api/v1/check-in/qr-code/customer/:customerId/regenerate` | Regenerate customer QR |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/check-in/dashboard` | Today's check-in status (real-time) |
| GET | `/api/v1/check-in/dashboard/upcoming` | Next N upcoming bookings |

### No-Show Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/check-in/no-shows` | List no-shows (date range) |
| PUT | `/api/v1/check-in/no-shows/:id/waive` | Waive no-show (override) |
| GET | `/api/v1/check-in/no-shows/customer/:customerId` | Customer no-show history |

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/check-in/config` | Get check-in configuration |
| PUT | `/api/v1/check-in/config` | Update configuration |

### Kiosk

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/check-in/kiosk/register` | Register a kiosk device |
| GET | `/api/v1/check-in/kiosk/status` | Kiosk heartbeat/status |

### Attendance Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/check-in/reports/attendance` | Attendance rate report |
| GET | `/api/v1/check-in/reports/no-shows` | No-show rate report |
| GET | `/api/v1/check-in/reports/walk-ins` | Walk-in volume report |
| GET | `/api/v1/check-in/reports/peak-times` | Peak check-in times |
| GET | `/api/v1/check-in/reports/methods` | Check-in by method breakdown |

---

## 8. Frontend Views

### Reception Check-In (`/check-in`)
- Today's bookings list with status badges
- One-click check-in buttons
- Search by name/phone/reference
- Validation result display (pass/warning/error)
- Override button with reason input
- Real-time auto-refresh

### Kiosk Mode (`/check-in/kiosk`)
- Full-screen, minimal UI
- QR scanner (device camera)
- Booking reference input (numeric keypad)
- Name/phone lookup
- Large success/error display
- Auto-reset to welcome screen (30s inactivity)
- Tenant branding (logo, colors)

### Real-Time Dashboard (`/check-in/dashboard`)
- Today's timeline with color-coded status bands
- Upcoming / Awaiting / Checked In / In Progress / Completed / No-Show columns
- Customer photos and service names
- Filter by service, staff, resource
- Highlight overdue arrivals (red)
- Walk-in queue display

### No-Show Management (`/check-in/no-shows`)
- List of no-shows with dates and fees
- Waive button with reason
- Customer repeat-offender flags
- Fee status (charged/waived)

### Attendance Reports (`/check-in/reports`)
- Attendance rate chart (daily/weekly/monthly)
- No-show rate trend
- Walk-in volume
- Peak arrival times heatmap
- Breakdown by check-in method
- High no-show customer list

---

**Last Updated**: June 16, 2026
