# Phase 12: Staff Management - Design Document

**Date**: June 15, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 06, Phase 07

---

## Overview

This document describes the technical design for the DayStream staff management module — staff profiles, qualifications, availability patterns, overrides, leave management, service/location assignment, capacity, calendar APIs, notifications, self-service portal, and public directory. The availability system is a critical input to the Booking Engine (Phase 07) slot calculation.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Availability Algorithm](#2-availability-algorithm)
3. [Leave Workflow](#3-leave-workflow)
4. [Capacity Enforcement](#4-capacity-enforcement)
5. [Notification System](#5-notification-system)
6. [Public Directory](#6-public-directory)
7. [API Endpoints](#7-api-endpoints)
8. [Frontend Views](#8-frontend-views)

---

## 1. Database Schema

### Staff Profiles

```sql
CREATE TABLE staff_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),            -- nullable for contractors without login
    staff_ref VARCHAR(20) NOT NULL,               -- auto-generated per tenant (e.g., STF-001)
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    mobile_phone VARCHAR(50),
    date_of_birth DATE,
    hire_date DATE,
    employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contractor')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'onboarding', 'terminated')),
    bio TEXT,                                     -- public-facing description
    profile_photo_path TEXT,                      -- filesystem path (local/S3)
    languages VARCHAR(200),                       -- comma-separated
    show_on_directory BOOLEAN NOT NULL DEFAULT true,
    primary_location_id UUID,                     -- references locations table
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, staff_ref)
);

CREATE INDEX idx_staff_profiles_tenant ON staff_profiles(tenant_id);
CREATE INDEX idx_staff_profiles_user ON staff_profiles(user_id);
CREATE INDEX idx_staff_profiles_status ON staff_profiles(tenant_id, status);
```

### Qualifications

```sql
CREATE TABLE staff_qualifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    issuing_body VARCHAR(200),
    date_obtained DATE,
    expiry_date DATE,
    certification_number VARCHAR(100),
    document_path TEXT,                           -- uploaded cert file
    show_on_directory BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_qualifications_staff ON staff_qualifications(staff_id);
CREATE INDEX idx_staff_qualifications_expiry ON staff_qualifications(expiry_date)
    WHERE expiry_date IS NOT NULL;
```

### Service Qualification Requirements

```sql
CREATE TABLE service_qualification_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    qualification_name VARCHAR(200) NOT NULL,     -- must match staff_qualifications.name
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, qualification_name)
);
```

### Availability Patterns

```sql
CREATE TABLE availability_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,                   -- e.g., "Summer Schedule"
    effective_from DATE NOT NULL,
    effective_to DATE,                            -- null = ongoing
    is_default BOOLEAN NOT NULL DEFAULT false,
    location_id UUID,                             -- null = all assigned locations
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_patterns_staff ON availability_patterns(staff_id);
CREATE INDEX idx_availability_patterns_dates ON availability_patterns(staff_id, effective_from, effective_to);
```

### Availability Pattern Slots

```sql
CREATE TABLE availability_pattern_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_id UUID NOT NULL REFERENCES availability_patterns(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_availability_slots_pattern ON availability_pattern_slots(pattern_id);
```

### Availability Overrides

```sql
CREATE TABLE availability_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    override_type VARCHAR(20) NOT NULL
        CHECK (override_type IN ('add', 'remove', 'modify')),
    start_time TIME,                             -- null for 'remove' (full day block)
    end_time TIME,
    reason VARCHAR(200),
    location_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_overrides_staff_date ON availability_overrides(staff_id, override_date);
```

### Leave Requests

```sql
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL
        CHECK (leave_type IN ('holiday', 'sick', 'personal', 'training', 'other')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_staff ON leave_requests(staff_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(staff_id, start_date, end_date)
    WHERE status = 'approved';
```

### Leave Balances

```sql
CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL,
    year INTEGER NOT NULL,
    total_days NUMERIC(5,1) NOT NULL DEFAULT 0,
    used_days NUMERIC(5,1) NOT NULL DEFAULT 0,
    UNIQUE(staff_id, leave_type, year)
);
```

### Staff Service Assignments

```sql
CREATE TABLE staff_service_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    variant_id UUID,                             -- null = all variants
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id, service_id, variant_id)
);

CREATE INDEX idx_staff_service_assignments_service ON staff_service_assignments(service_id);
```

### Staff Location Assignments

```sql
CREATE TABLE staff_location_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,                   -- references locations table
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id, location_id)
);
```

### Capacity Configuration

```sql
CREATE TABLE staff_capacity_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    max_bookings_per_day INTEGER,
    max_bookings_per_week INTEGER,
    max_consecutive_hours NUMERIC(4,1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id)
);
```

### Capacity Overrides (Manager)

```sql
CREATE TABLE staff_capacity_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    max_bookings INTEGER NOT NULL,
    reason VARCHAR(200) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Notification Preferences

```sql
CREATE TABLE staff_notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,             -- 'new_booking', 'cancellation', 'leave_status', 'schedule_change', 'cert_expiry'
    channel_email BOOLEAN NOT NULL DEFAULT true,
    channel_in_app BOOLEAN NOT NULL DEFAULT true,
    channel_sms BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(staff_id, event_type)
);
```

---

## 2. Availability Algorithm

The availability engine resolves a staff member's effective availability for a given date:

```
getEffectiveAvailability(staffId, date, locationId?):
    1. Find the active pattern:
       - SELECT from availability_patterns WHERE staff_id = staffId
         AND effective_from <= date
         AND (effective_to IS NULL OR effective_to >= date)
         AND (location_id IS NULL OR location_id = locationId)
       - If multiple, pick most specific (location match > no location)
       - If none, staff has no availability that day

    2. Get base slots for the day:
       - SELECT from availability_pattern_slots
         WHERE pattern_id = active_pattern.id
         AND day_of_week = date.dayOfWeek()
       - If no slots → not available

    3. Check for overrides on this date:
       - SELECT from availability_overrides WHERE staff_id = staffId AND override_date = date
       - override_type = 'remove' → return empty (not available)
       - override_type = 'add' → merge in additional time blocks
       - override_type = 'modify' → replace base slots with override times

    4. Check for approved leave:
       - SELECT from leave_requests WHERE staff_id = staffId
         AND status = 'approved'
         AND start_date <= date AND end_date >= date
       - If leave exists → return empty (not available)

    5. Return resolved time blocks [{ start_time, end_time }]
```

This function is called by the Booking Engine's slot calculator. It replaces the simple "business hours" check with per-staff resolution.

### Caching Strategy

- Pattern + slots change infrequently — cache per staff with invalidation on edit
- Overrides and leave are date-specific — no caching needed at this scale
- For team views (multiple staff × date range), batch query and assemble in-memory

---

## 3. Leave Workflow

```
Staff submits leave request (start_date, end_date, type, notes)
    ↓
Status = 'pending'
    ↓
Manager reviews:
    - Check for conflicting bookings on those dates
    - If conflicts exist → display warning (bookings must be rescheduled first)
    ↓
Manager approves or rejects:
    - Approved → status = 'approved', deduct from leave_balances
    - Rejected → status = 'rejected' (with optional reason)
    ↓
Notify staff of decision
    ↓
Availability engine now returns empty for approved leave dates
```

Leave balance tracking is optional per tenant — some businesses track it, some don't. When disabled, the `leave_balances` table is simply not populated.

---

## 4. Capacity Enforcement

During booking slot calculation:

```
checkCapacity(staffId, date):
    1. Get capacity config for staff
    2. Count confirmed bookings for that day
    3. If max_bookings_per_day reached → staff not available for more
    4. Count confirmed bookings for that week
    5. If max_bookings_per_week reached → staff not available for more
    6. Check consecutive hours (sum duration of adjacent bookings)
    7. If max_consecutive_hours would be exceeded → block adjacent slots

    Note: Check staff_capacity_overrides for date-specific exceptions
```

Capacity is checked AFTER availability (no point checking capacity if staff isn't working that day).

---

## 5. Notification System

Events that trigger staff notifications:

| Event | Recipients | Channels |
|-------|-----------|----------|
| New booking assigned | Assigned staff | email, in-app |
| Booking cancelled/rescheduled | Assigned staff | email, in-app |
| Leave approved/rejected | Requesting staff | email, in-app |
| Schedule changed by manager | Affected staff | email, in-app |
| Certification expiring (30/60/90 days) | Staff + managers | email, in-app |

Uses existing `email.service.ts` for email delivery and a new `staff-notifications.service.ts` for routing and preferences.

---

## 6. Public Directory

The public directory endpoint requires no authentication and returns staff based on tenant configuration:

```
GET /api/v1/staff/directory?locationId=&serviceId=

Response:
{
  staff: [{
    id, firstName, lastName, bio, profilePhotoUrl,
    languages, qualifications: [{ name, issuingBody }],
    services: [{ id, name }]
  }]
}

Filters:
- Only staff with show_on_directory = true
- Only staff with status = 'active'
- Only fields marked visible in tenant config
- Filtered by location/service if provided
```

---

## 7. API Endpoints

### Staff Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff` | List staff (paginated, filterable) |
| POST | `/api/v1/staff` | Create staff profile |
| GET | `/api/v1/staff/:id` | Get staff detail |
| PUT | `/api/v1/staff/:id` | Update staff profile |
| PUT | `/api/v1/staff/:id/deactivate` | Deactivate staff |
| POST | `/api/v1/staff/:id/photo` | Upload profile photo |

### Qualifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/qualifications` | List qualifications |
| POST | `/api/v1/staff/:id/qualifications` | Add qualification |
| PUT | `/api/v1/staff/:id/qualifications/:qid` | Update qualification |
| DELETE | `/api/v1/staff/:id/qualifications/:qid` | Remove qualification |
| GET | `/api/v1/staff/qualifications/expiring` | Expiring certs report |

### Availability Patterns

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/availability/patterns` | List patterns |
| POST | `/api/v1/staff/:id/availability/patterns` | Create pattern |
| PUT | `/api/v1/staff/:id/availability/patterns/:pid` | Update pattern |
| DELETE | `/api/v1/staff/:id/availability/patterns/:pid` | Delete pattern |
| POST | `/api/v1/staff/:id/availability/patterns/:pid/copy` | Duplicate pattern |

### Availability Overrides

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/availability/overrides` | List overrides (date range) |
| POST | `/api/v1/staff/:id/availability/overrides` | Create override |
| DELETE | `/api/v1/staff/:id/availability/overrides/:oid` | Remove override |

### Leave Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/leave` | List leave requests (filterable) |
| POST | `/api/v1/staff/:id/leave` | Submit leave request |
| PUT | `/api/v1/staff/leave/:lid/approve` | Approve leave |
| PUT | `/api/v1/staff/leave/:lid/reject` | Reject leave |
| PUT | `/api/v1/staff/leave/:lid/cancel` | Cancel leave |
| GET | `/api/v1/staff/:id/leave/balance` | Get leave balances |

### Service & Location Assignment

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/services` | List service assignments |
| POST | `/api/v1/staff/:id/services` | Assign services (bulk) |
| DELETE | `/api/v1/staff/:id/services/:sid` | Remove service assignment |
| GET | `/api/v1/staff/:id/locations` | List location assignments |
| POST | `/api/v1/staff/:id/locations` | Assign locations |
| DELETE | `/api/v1/staff/:id/locations/:lid` | Remove location |

### Capacity

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/capacity` | Get capacity config |
| PUT | `/api/v1/staff/:id/capacity` | Update capacity config |
| POST | `/api/v1/staff/:id/capacity/override` | Manager capacity override |

### Calendar & Schedule

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/:id/calendar` | Get staff calendar (date range) |
| GET | `/api/v1/staff/calendar/team` | Team schedule view |
| GET | `/api/v1/staff/:id/availability` | Resolved availability for dates |

### Self-Service Portal

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/me` | Get own profile |
| PUT | `/api/v1/staff/me` | Update own profile (bio, photo, contact) |
| GET | `/api/v1/staff/me/calendar` | Get own calendar |
| GET | `/api/v1/staff/me/metrics` | Get performance metrics |

### Public Directory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/directory` | Public staff directory (no auth) |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/staff/me/notifications/preferences` | Get preferences |
| PUT | `/api/v1/staff/me/notifications/preferences` | Update preferences |

---

## 8. Frontend Views

### Staff List (`/staff`)
- Paginated list with search (name, email)
- Filter by status, employment type, location, service
- Quick actions: deactivate, view profile

### Staff Detail (`/staff/:id`)
- Profile info with photo
- Qualifications tab
- Availability tab (pattern editor + overrides calendar)
- Services & locations tab
- Calendar tab (bookings + leave view)
- Capacity settings

### Availability Pattern Editor
- Visual weekly grid (drag to select time blocks per day)
- Named patterns with effective date ranges
- Copy/paste patterns

### Leave Management (`/staff/leave`)
- Pending requests queue (manager view)
- Leave calendar (team view)
- Balance tracker per staff member
- Approve/reject actions with conflict warnings

### Team Calendar (`/staff/calendar`)
- Side-by-side day/week view of all staff
- Color-coded: bookings (blue), available (green), leave (orange), blocked (red)
- Filter by location, service

### Staff Self-Service (`/staff/me`)
- Own schedule view
- Submit leave request form
- Set overrides (within assigned hours)
- Edit bio/photo/contact
- Performance metrics (sessions, revenue)

### Public Directory (customer-facing)
- Card grid of staff with photo, name, bio
- Filter by service, location
- "Book with" CTA button

---

**Last Updated**: June 15, 2026
