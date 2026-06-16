# Phase 13: Resource Management - Design Document

**Date**: June 16, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 06, Phase 07

---

## Overview

This document describes the technical design for the DayStream resource management module — physical rooms, equipment, and facilities CRUD, scheduling, conflict prevention, capacity tracking, maintenance windows, service linking, utilization reporting, and multi-location support. Resources are the third input (alongside staff and service rules) to the Booking Engine's availability calculation.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Resource Scheduling Algorithm](#2-resource-scheduling-algorithm)
3. [Conflict Prevention](#3-conflict-prevention)
4. [Service-to-Resource Linking](#4-service-to-resource-linking)
5. [Maintenance Windows](#5-maintenance-windows)
6. [Utilization Tracking](#6-utilization-tracking)
7. [API Endpoints](#7-api-endpoints)
8. [Frontend Views](#8-frontend-views)

---

## 1. Database Schema

### Resource Types

```sql
CREATE TABLE resource_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'equipment'
        CHECK (category IN ('room', 'equipment', 'facility')),
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);
```

### Resources

```sql
CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type_id UUID NOT NULL REFERENCES resource_types(id),
    location_id UUID,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    capacity INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'maintenance')),
    photo_path TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    buffer_minutes INTEGER NOT NULL DEFAULT 0,     -- default turnover time
    is_24_7 BOOLEAN NOT NULL DEFAULT false,        -- no hour restrictions
    custom_attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resources_tenant ON resources(tenant_id);
CREATE INDEX idx_resources_type ON resources(resource_type_id);
CREATE INDEX idx_resources_location ON resources(tenant_id, location_id);
CREATE INDEX idx_resources_status ON resources(tenant_id, status);
```

### Resource Schedules (Operating Hours)

```sql
CREATE TABLE resource_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Default',
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE resource_schedule_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES resource_schedules(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_resource_schedule_slots ON resource_schedule_slots(schedule_id);
```

### Resource Schedule Blocks (Holidays/Closures)

```sql
CREATE TABLE resource_schedule_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    block_date DATE NOT NULL,
    start_time TIME,                               -- null = whole day
    end_time TIME,
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resource_blocks_date ON resource_schedule_blocks(resource_id, block_date);
```

### Resource Bookings

```sql
CREATE TABLE resource_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    booking_type VARCHAR(20) NOT NULL DEFAULT 'service'
        CHECK (booking_type IN ('service', 'maintenance', 'hold', 'manual')),
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'cancelled', 'completed')),
    notes VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_resource_bookings_resource ON resource_bookings(resource_id);
CREATE INDEX idx_resource_bookings_time ON resource_bookings(resource_id, start_time, end_time)
    WHERE status = 'confirmed';
CREATE INDEX idx_resource_bookings_booking ON resource_bookings(booking_id);
```

### Service-Resource Links

```sql
CREATE TABLE service_resource_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    variant_id UUID,                               -- null = all variants
    resource_id UUID,                              -- specific resource (null if using type)
    resource_type_id UUID,                         -- "any of type" (null if specific)
    requirement_type VARCHAR(20) NOT NULL DEFAULT 'required'
        CHECK (requirement_type IN ('required', 'preferred')),
    buffer_minutes INTEGER,                        -- override resource default buffer
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (resource_id IS NOT NULL OR resource_type_id IS NOT NULL)
);

CREATE INDEX idx_service_resource_reqs_service ON service_resource_requirements(service_id);
CREATE INDEX idx_service_resource_reqs_resource ON service_resource_requirements(resource_id);
```

### Resource Dependencies

```sql
CREATE TABLE resource_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL DEFAULT 0,     -- time offset from primary (0 = same time)
    duration_minutes INTEGER,                      -- null = same as primary
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resource_id, depends_on_id)
);
```

### Maintenance Schedules

```sql
CREATE TABLE resource_maintenance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    maintenance_type VARCHAR(20) NOT NULL
        CHECK (maintenance_type IN ('recurring', 'one_time')),
    day_of_week INTEGER,                           -- for recurring (0-6)
    start_time TIME,
    end_time TIME,
    specific_date DATE,                            -- for one-time
    description VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resource_maintenance ON resource_maintenance(resource_id);
```

---

## 2. Resource Scheduling Algorithm

The resource availability engine resolves whether a resource is available for a given time slot:

```
isResourceAvailable(resourceId, startTime, endTime):
    1. Check resource status:
       - If status != 'active' → not available

    2. Check if resource is 24/7:
       - If is_24_7 = true → skip operating hours check

    3. Check operating hours (schedule):
       - Find active schedule for the date
       - Get slots for the day of week
       - Verify requested time falls within operating hours
       - If outside operating hours → not available

    4. Check for date blocks:
       - Query resource_schedule_blocks for the date
       - If block overlaps requested time → not available

    5. Check for maintenance windows:
       - Query resource_maintenance for recurring (day of week match)
       - Query resource_maintenance for one-time (date match)
       - If maintenance overlaps → not available

    6. Check capacity:
       - Count existing confirmed resource_bookings that overlap the time range
       - If count >= resource.capacity → not available

    7. Check buffer time:
       - Find the closest existing booking BEFORE the requested time
       - If gap < buffer_minutes → not available
       - Find the closest existing booking AFTER the requested time
       - If gap < buffer_minutes → not available

    8. Available ✓
```

### For Service Bookings — Auto-select Resource

```
findAvailableResource(serviceId, variantId, startTime, endTime, locationId):
    1. Get service_resource_requirements for the service/variant
    2. For each requirement:
       a. If specific resource_id:
          - Check isResourceAvailable(resource_id, startTime, endTime)
       b. If resource_type_id ("any of type"):
          - Get all resources of that type at the location
          - Find first available one (prefer preferred, then any)
    3. If ALL required resources are available → return selected resources
    4. If any required resource unavailable → return conflict error
    5. Also resolve dependencies for each selected resource
```

---

## 3. Conflict Prevention

Conflict prevention uses the same pattern as the Booking Engine (Phase 07):

```sql
-- Use FOR UPDATE NOWAIT to prevent race conditions
SELECT id FROM resource_bookings
WHERE resource_id = $1
  AND status = 'confirmed'
  AND start_time < $3  -- requested end
  AND end_time > $2    -- requested start
FOR UPDATE NOWAIT;

-- If any rows returned, conflict exists
-- If NOWAIT fails (locked by another transaction), retry with backoff
```

Transaction flow:
1. Begin transaction
2. Lock overlapping resource_bookings rows (FOR UPDATE NOWAIT)
3. Count overlapping bookings
4. If count >= capacity → ROLLBACK, return conflict
5. Insert new resource_booking
6. COMMIT

---

## 4. Service-to-Resource Linking

When a customer books a service:
1. Booking Engine calls `findAvailableResource(serviceId, variantId, startTime, endTime, locationId)`
2. Engine checks all "required" resources — ALL must be available
3. Engine checks "preferred" resources — uses them if available, otherwise picks alternative of same type
4. For "any of type" — picks the first available resource matching the type
5. Selected resources are reserved via `resource_bookings` INSERT
6. Dependencies are resolved and reserved in the same transaction

---

## 5. Maintenance Windows

Three types of maintenance:

| Type | Trigger | Example |
|------|---------|---------|
| Buffer (per-booking) | After each booking completes | 15 min room turnover, 30 min float tank drain |
| Recurring | Weekly schedule | Deep clean Friday 18:00–20:00 |
| One-time | Specific date | Equipment repair Tuesday 10:00–14:00 |

Buffer time is enforced during availability checks (section 2, step 7). Recurring and one-time maintenance are checked in step 5.

---

## 6. Utilization Tracking

```
calculateUtilization(resourceId, startDate, endDate):
    1. Calculate total available hours:
       - Sum operating hours across the date range (from schedule slots)
       - Subtract maintenance blocks and schedule blocks
    2. Calculate booked hours:
       - Sum duration of confirmed resource_bookings in range
    3. Utilization = (booked hours / available hours) × 100%

Peak hours:
    - Group bookings by hour of day
    - Report top 5 busiest hours

Underutilized:
    - Resources with utilization < 40% (configurable threshold)
```

---

## 7. API Endpoints

### Resource Types

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/types` | List resource types |
| POST | `/api/v1/resources/types` | Create custom type |
| PUT | `/api/v1/resources/types/:id` | Update type |
| DELETE | `/api/v1/resources/types/:id` | Delete type (if no resources) |

### Resources CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources` | List resources (filter by type, location, status) |
| POST | `/api/v1/resources` | Create resource |
| GET | `/api/v1/resources/:id` | Get resource detail |
| PUT | `/api/v1/resources/:id` | Update resource |
| PUT | `/api/v1/resources/:id/deactivate` | Deactivate resource |
| POST | `/api/v1/resources/:id/photo` | Upload resource photo |

### Resource Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/:id/schedule` | Get operating hours |
| POST | `/api/v1/resources/:id/schedule` | Set operating hours |
| PUT | `/api/v1/resources/:id/schedule/:sid` | Update schedule |
| GET | `/api/v1/resources/:id/schedule/blocks` | Get date blocks |
| POST | `/api/v1/resources/:id/schedule/blocks` | Add date block |
| DELETE | `/api/v1/resources/:id/schedule/blocks/:bid` | Remove block |

### Service-Resource Requirements

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/service-requirements/:serviceId` | Get requirements for service |
| POST | `/api/v1/resources/service-requirements` | Create requirement |
| PUT | `/api/v1/resources/service-requirements/:id` | Update requirement |
| DELETE | `/api/v1/resources/service-requirements/:id` | Delete requirement |

### Resource Bookings & Availability

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/:id/bookings` | List bookings for resource |
| POST | `/api/v1/resources/:id/bookings` | Create manual booking |
| DELETE | `/api/v1/resources/:id/bookings/:bid` | Cancel resource booking |
| GET | `/api/v1/resources/:id/availability` | Check availability (date range) |
| POST | `/api/v1/resources/find-available` | Find available resource for service |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/:id/maintenance` | List maintenance schedules |
| POST | `/api/v1/resources/:id/maintenance` | Create maintenance window |
| DELETE | `/api/v1/resources/:id/maintenance/:mid` | Delete maintenance |

### Dependencies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/:id/dependencies` | List dependencies |
| POST | `/api/v1/resources/:id/dependencies` | Add dependency |
| DELETE | `/api/v1/resources/:id/dependencies/:did` | Remove dependency |

### Calendar & Utilization

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/resources/:id/calendar` | Resource calendar (date range) |
| GET | `/api/v1/resources/calendar/timeline` | All resources timeline view |
| GET | `/api/v1/resources/utilization` | Utilization report |
| GET | `/api/v1/resources/:id/utilization` | Single resource utilization |

---

## 8. Frontend Views

### Resource List (`/resources`)
- Paginated list grouped by type
- Filter by type, location, status
- Resource cards with photo, name, type, capacity, status
- Quick actions: edit, deactivate

### Resource Detail (`/resources/:id`)
- Tabbed layout:
  - **Details** — name, type, capacity, location, photo, custom attributes
  - **Schedule** — weekly operating hours editor, date blocks
  - **Services** — linked services with requirement type
  - **Maintenance** — recurring + one-time windows
  - **Dependencies** — dependent resources
  - **Calendar** — bookings and availability view
  - **Utilization** — usage charts and metrics

### Resource Calendar (`/resources/calendar`)
- Timeline view: all resources as rows, time as columns
- Day/week view toggle
- Color-coded: booked (blue), maintenance (yellow), available (green), offline (gray)
- Click-to-book on available slots
- Filter by location, type

### Utilization Dashboard (`/resources/utilization`)
- Overview cards: average utilization, peak hours, underutilized count
- Per-resource bar chart (utilization %)
- Date range picker
- Comparison between resources of same type

---

**Last Updated**: June 16, 2026
