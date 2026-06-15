# Phase 07: Booking Engine - Design Document

**Date**: June 14, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06

---

## Overview

This document describes the technical design for the DayStream booking engine — the availability calculation algorithm, database schema, booking lifecycle, slot holding mechanism, waitlist system, recurring bookings, calendar APIs, notification dispatch, and conflict detection strategy.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Availability Engine](#2-availability-engine)
3. [Booking Lifecycle](#3-booking-lifecycle)
4. [Slot Holding (Reservation)](#4-slot-holding)
5. [Booking Types](#5-booking-types)
6. [Waitlist System](#6-waitlist-system)
7. [Recurring Bookings](#7-recurring-bookings)
8. [Conflict Detection](#8-conflict-detection)
9. [Notifications](#9-notifications)
10. [Calendar APIs](#10-calendar-apis)
11. [Time Zone Handling](#11-time-zone-handling)
12. [API Endpoints](#12-api-endpoints)
13. [Frontend Views](#13-frontend-views)

---

## 1. Database Schema

### Bookings

```sql
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    resource_id UUID,                                    -- references resources (Phase 13)
    -- Timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    buffer_before INTEGER NOT NULL DEFAULT 0,
    buffer_after INTEGER NOT NULL DEFAULT 0,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
    -- Details
    booking_reference VARCHAR(20) NOT NULL,               -- e.g., BK-2026-0001
    booking_type VARCHAR(20) NOT NULL,                    -- individual, shared, group, resource
    price INTEGER NOT NULL,                               -- cents at time of booking
    notes TEXT,                                           -- customer notes
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id),
    cancelled_at TIMESTAMPTZ,
    -- Recurring
    recurring_series_id UUID REFERENCES recurring_booking_series(id),
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),                 -- who created (customer or staff on behalf)
    UNIQUE(business_id, booking_reference)
);

CREATE INDEX idx_bookings_business ON bookings(business_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_staff ON bookings(staff_id);
CREATE INDEX idx_bookings_service ON bookings(service_id);
CREATE INDEX idx_bookings_status ON bookings(business_id, status);
CREATE INDEX idx_bookings_time ON bookings(business_id, start_time, end_time);
CREATE INDEX idx_bookings_staff_time ON bookings(staff_id, start_time, end_time);
CREATE INDEX idx_bookings_resource_time ON bookings(resource_id, start_time, end_time);
```

### Booking Status History

```sql
CREATE TABLE booking_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_history_booking ON booking_status_history(booking_id);
```

### Slot Holds (Temporary Reservations)

```sql
CREATE TABLE slot_holds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    resource_id UUID,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    held_by UUID NOT NULL REFERENCES users(id),           -- customer holding the slot
    expires_at TIMESTAMPTZ NOT NULL,                      -- hold expires after 5 min
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slot_holds_expiry ON slot_holds(expires_at);
CREATE INDEX idx_slot_holds_staff ON slot_holds(staff_id, start_time, end_time);
CREATE INDEX idx_slot_holds_resource ON slot_holds(resource_id, start_time, end_time);
```

### Waitlist

```sql
CREATE TABLE waitlist_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    booking_id UUID NOT NULL REFERENCES bookings(id),     -- the full session booking
    customer_id UUID NOT NULL REFERENCES customers(id),
    position INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'notified', 'confirmed', 'expired', 'removed')),
    notified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(booking_id, customer_id)
);

CREATE INDEX idx_waitlist_booking ON waitlist_entries(booking_id);
CREATE INDEX idx_waitlist_customer ON waitlist_entries(customer_id);
```

### Recurring Booking Series

```sql
CREATE TABLE recurring_booking_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    -- Pattern
    recurrence_pattern VARCHAR(20) NOT NULL
        CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly')),
    day_of_week INTEGER,                                  -- 0-6 for weekly/biweekly
    day_of_month INTEGER,                                 -- 1-31 for monthly
    start_time TIME NOT NULL,
    -- End condition
    end_type VARCHAR(20) NOT NULL DEFAULT 'ongoing'
        CHECK (end_type IN ('ongoing', 'count', 'date')),
    end_count INTEGER,
    end_date DATE,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_recurring_series_business ON recurring_booking_series(business_id);
CREATE INDEX idx_recurring_series_customer ON recurring_booking_series(customer_id);
```

### Staff Schedules (Interface — defined here, Phase 12 implements fully)

```sql
CREATE TABLE staff_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    business_id UUID NOT NULL REFERENCES businesses(id),
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    effective_from DATE,
    effective_to DATE,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_schedules_user ON staff_schedules(user_id);
CREATE INDEX idx_staff_schedules_business ON staff_schedules(business_id);
```

### Staff Time Off / Blocks

```sql
CREATE TABLE staff_time_off (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    business_id UUID NOT NULL REFERENCES businesses(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_time_off_user ON staff_time_off(user_id, start_time, end_time);
```

---

## 2. Availability Engine

### Algorithm

```
getAvailableSlots(serviceId, dateRange, options):
  1. Load service configuration (duration, buffer, capacity, booking_type)
  2. Load service availability rules (recurring, seasonal, block)
  3. Load assigned staff for service
  4. For each day in dateRange:
     a. Compute service-level available hours (intersect rules)
     b. For each assigned staff member:
        - Load staff schedule for that day
        - Load staff time off
        - Load existing bookings for staff
        - Load active slot holds for staff
        - Compute staff available windows
     c. For required resources:
        - Load resource bookings
        - Load resource availability
        - Compute resource available windows
     d. Intersect: service hours ∩ (any staff available) ∩ (resource available)
     e. Generate slots at configured intervals (e.g., every 15 min)
     f. Filter by lead time and max advance booking
  5. Return list of available slots with metadata
```

### Slot Structure

```typescript
interface AvailableSlot {
  start_time: string;       // ISO 8601 UTC
  end_time: string;
  duration: number;         // minutes
  available_staff: Array<{ id: string; name: string }>;
  capacity_remaining?: number;  // for shared/group
  resource_id?: string;
}
```

### Performance Targets

- Single service, 7 days: < 1 second
- Caching: computed availability cached for 60 seconds (invalidated on booking/cancellation)

---

## 3. Booking Lifecycle

### State Machine

```
                    ┌─────────────┐
                    │   Pending   │
                    └──────┬──────┘
                           │ confirm / pay
                    ┌──────▼──────┐
           cancel ──│  Confirmed  │── cancel
                    └──────┬──────┘
                           │ check-in
                    ┌──────▼──────┐
                    │ In Progress │
                    └──────┬──────┘
                           │ complete
                    ┌──────▼──────┐
                    │  Completed  │ (terminal)
                    └─────────────┘

         No-Show: Confirmed → No-Show (terminal, triggered by system after timeout)
         Cancel: Pending/Confirmed → Cancelled (terminal)
```

### Auto No-Show

A scheduled job checks confirmed bookings past their start_time + configurable window (default 15 min). If not checked in, transitions to no_show.

---

## 4. Slot Holding

When a customer selects a slot in the booking flow:

1. Create a `slot_hold` record with 5-minute expiry
2. The held slot is excluded from availability queries
3. If the customer completes booking → delete hold, create booking
4. If hold expires → cleanup job deletes it, slot becomes available again

Cleanup runs every 60 seconds to purge expired holds.

---

## 5. Booking Types

### Individual (1:1)
- One customer, one staff member, one time slot
- Staff and resource are exclusively blocked

### Shared (fixed-time, multi-customer)
- Fixed time slot, multiple customers up to capacity
- Staff facilitates, resource shared
- Each customer has their own booking record linked to the same time/service

### Group (class)
- Scheduled class with instructor, capacity, min threshold
- Bookings are individual records linked to the class occurrence
- If below minimum → auto-cancel all bookings and notify

### Resource-Only
- No staff required
- Resource is blocked for the duration
- Customer self-service

---

## 6. Waitlist System

1. Customer joins waitlist → position assigned (max 5 per session)
2. Cancellation occurs → next waitlist entry notified (email)
3. 2-hour confirmation window starts
4. Customer confirms → booking created, waitlist entry removed
5. Customer doesn't confirm → entry expires, next in line notified
6. Customer can self-remove from waitlist at any time

---

## 7. Recurring Bookings

1. Customer or staff creates a recurring series (pattern + end condition)
2. System generates individual booking instances for the next N occurrences
3. Each instance is a normal booking with `recurring_series_id` set
4. Availability checked per instance — conflicts are skipped and reported
5. Series management: pause, cancel future, modify single instance

Generation: system generates 4-8 weeks of instances ahead, a scheduled job generates more as time progresses.

---

## 8. Conflict Detection

### Strategy: Database-Level Locking

```sql
-- When creating a booking, lock overlapping time ranges:
SELECT id FROM bookings
WHERE staff_id = $1
  AND start_time < $3  -- proposed end
  AND end_time > $2    -- proposed start
  AND status IN ('pending', 'confirmed', 'in_progress')
FOR UPDATE NOWAIT;

-- If any rows returned → conflict
-- NOWAIT ensures immediate failure on concurrent attempts
```

### Layers of Protection

1. **API level**: Availability check before booking attempt
2. **Service level**: Re-validate at confirmation time
3. **Database level**: Unique constraint + FOR UPDATE locking
4. **Slot holds**: Prevent visual conflicts in UI

---

## 9. Notifications

### Notification Types

| Event | Channel | Timing |
|-------|---------|--------|
| Booking confirmed | Email | Immediate |
| Reminder | Email | 24h and/or 2h before |
| Cancellation | Email | Immediate (to customer + staff) |
| Reschedule | Email | Immediate (to customer + staff) |
| Waitlist promotion | Email | Immediate |
| No-show | Email | After marking |

### Email Template Data

```typescript
interface BookingNotificationData {
  customer_name: string;
  service_name: string;
  variant_name: string;
  date: string;            // localized
  time: string;            // localized with timezone
  staff_name?: string;
  location?: string;
  booking_reference: string;
  cancellation_policy: string;
  ical_attachment: Buffer;
}
```

### Notification Queue

Notifications are dispatched asynchronously via a simple queue table:

```sql
CREATE TABLE notification_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'email',
    recipient_id UUID NOT NULL REFERENCES users(id),
    data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Calendar APIs

### Admin Calendar

```typescript
// GET /api/v1/bookings/calendar?view=day&date=2026-06-15&business_id=...
interface CalendarResponse {
  date: string;
  view: 'day' | 'week' | 'month';
  bookings: Array<{
    id: string;
    service_name: string;
    customer_name: string;
    staff_name: string;
    start_time: string;
    end_time: string;
    status: string;
    booking_type: string;
    participants?: number;   // for shared/group
  }>;
}
```

### Staff Calendar

Filtered to a specific staff member's bookings.

### Resource Calendar

Filtered to a specific resource's bookings.

---

## 11. Time Zone Handling

- All times stored as `TIMESTAMPTZ` (UTC in PostgreSQL)
- Tenant has a configured time zone (e.g., `Europe/Madrid`)
- API accepts times in UTC or with timezone offset
- API returns times in UTC (frontend converts to display timezone)
- iCal exports include `VTIMEZONE` component

---

## 12. API Endpoints

### Availability

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/bookings/availability` | Get available slots for a service |

### Booking CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/bookings` | Create booking |
| GET | `/api/v1/bookings` | List bookings (filtered) |
| GET | `/api/v1/bookings/:id` | Get booking detail |
| PUT | `/api/v1/bookings/:id/confirm` | Confirm booking |
| PUT | `/api/v1/bookings/:id/cancel` | Cancel booking |
| PUT | `/api/v1/bookings/:id/reschedule` | Reschedule booking |
| PUT | `/api/v1/bookings/:id/check-in` | Check in (start) |
| PUT | `/api/v1/bookings/:id/complete` | Mark complete |
| PUT | `/api/v1/bookings/:id/no-show` | Mark no-show |

### Slot Holds

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/bookings/hold` | Hold a slot (5 min) |
| DELETE | `/api/v1/bookings/hold/:id` | Release a held slot |

### Waitlist

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/bookings/:id/waitlist` | Join waitlist |
| DELETE | `/api/v1/bookings/:id/waitlist` | Leave waitlist |
| PUT | `/api/v1/bookings/:id/waitlist/confirm` | Confirm waitlist promotion |

### Recurring

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/bookings/recurring` | Create recurring series |
| GET | `/api/v1/bookings/recurring/:seriesId` | Get series detail |
| PUT | `/api/v1/bookings/recurring/:seriesId/cancel` | Cancel future occurrences |

### Calendar

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/bookings/calendar` | Admin calendar view |
| GET | `/api/v1/bookings/:id/ical` | Download iCal file |

---

## 13. Frontend Views

### Customer Booking Flow (`/book/:serviceSlug`)
- Step 1: Select variant (duration/price)
- Step 2: Select date (calendar picker)
- Step 3: Select time slot (available slots grid)
- Step 4: Select staff (optional, if enabled)
- Step 5: Confirm and pay

### Admin Calendar (`/bookings/calendar`)
- Day/Week/Month toggle
- Filter by staff, service, status
- Click slot → create booking
- Click booking → detail panel
- Color-coded by status

### Booking List (`/bookings`)
- Table view with filters (date range, status, customer, service)
- Quick actions (confirm, cancel, no-show)
- Export to CSV

### Customer My Bookings (`/profile/bookings`)
- Upcoming bookings
- Past bookings
- Cancel/reschedule actions

---

**Last Updated**: June 14, 2026
