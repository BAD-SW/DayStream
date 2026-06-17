# Phase 14: Events & Workshops - Design Document

**Date**: June 16, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 09, Phase 10, Phase 13

---

## Overview

This document describes the technical design for the DayStream events and workshops module — a separate entity from standard services, supporting one-off and recurring events, multi-day workshops, ticketing with tiers, event series (programs), registration flows, capacity/waitlists, check-in, communications, public calendar, and reporting. Events share resource management (Phase 13) and pricing (Phase 09) integrations but have their own lifecycle.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Recurring Event Generation](#2-recurring-event-generation)
3. [Registration Flow](#3-registration-flow)
4. [Capacity and Waitlist](#4-capacity-and-waitlist)
5. [Event Series (Programs)](#5-event-series-programs)
6. [Communications](#6-communications)
7. [Check-In](#7-check-in)
8. [API Endpoints](#8-api-endpoints)
9. [Frontend Views](#9-frontend-views)

---

## 1. Database Schema

### Event Types

```sql
CREATE TABLE event_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);
```

### Events

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type_id UUID NOT NULL REFERENCES event_types(id),
    title VARCHAR(300) NOT NULL,
    slug VARCHAR(300) NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    location_id UUID,
    location_name VARCHAR(200),              -- "online" or free-text for external venues
    capacity INTEGER NOT NULL,
    min_attendees INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    cover_image_path TEXT,
    tags TEXT[],                              -- array of tag strings
    custom_fields JSONB DEFAULT '[]',        -- additional registration fields
    cancellation_policy JSONB,               -- { free_until_days: 7, partial_refund_pct: 50, ... }
    recurrence_id UUID,                      -- links to recurring_event_templates
    series_id UUID,                          -- links to event_series
    series_order INTEGER,                    -- position in series
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_status ON events(tenant_id, status);
CREATE INDEX idx_events_start ON events(tenant_id, start_time);
CREATE INDEX idx_events_type ON events(event_type_id);
CREATE INDEX idx_events_series ON events(series_id);
CREATE INDEX idx_events_recurrence ON events(recurrence_id);
```

### Event Facilitators

```sql
CREATE TABLE event_facilitators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES staff_profiles(id),
    role VARCHAR(50) DEFAULT 'facilitator',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, staff_id)
);
```

### Recurring Event Templates

```sql
CREATE TABLE recurring_event_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type_id UUID NOT NULL REFERENCES event_types(id),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    recurrence_pattern VARCHAR(20) NOT NULL
        CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly', 'custom')),
    custom_interval_days INTEGER,
    day_of_week INTEGER,                    -- for weekly/biweekly (0-6)
    day_of_month INTEGER,                   -- for monthly
    start_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    location_id UUID,
    location_name VARCHAR(200),
    capacity INTEGER NOT NULL,
    end_type VARCHAR(20) NOT NULL DEFAULT 'ongoing'
        CHECK (end_type IN ('ongoing', 'count', 'date')),
    end_after_count INTEGER,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled')),
    template_data JSONB DEFAULT '{}',       -- carries over to instances
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Event Series

```sql
CREATE TABLE event_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    total_sessions INTEGER NOT NULL,
    pricing_model VARCHAR(20) NOT NULL DEFAULT 'per_series'
        CHECK (pricing_model IN ('per_series', 'per_session')),
    series_price INTEGER,                   -- cents, for per_series pricing
    allow_drop_in BOOLEAN NOT NULL DEFAULT false,
    require_sequential BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Ticket Tiers

```sql
CREATE TABLE event_ticket_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,        -- cents
    quantity_available INTEGER,              -- null = unlimited
    quantity_sold INTEGER NOT NULL DEFAULT 0,
    availability_start TIMESTAMPTZ,
    availability_end TIMESTAMPTZ,
    eligibility_type VARCHAR(30) DEFAULT 'all'
        CHECK (eligibility_type IN ('all', 'members_only', 'first_time', 'custom')),
    eligibility_config JSONB,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_tickets_event ON event_ticket_tiers(event_id);
```

### Registrations

```sql
CREATE TABLE event_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    ticket_tier_id UUID NOT NULL REFERENCES event_ticket_tiers(id),
    reference_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'waitlisted', 'no_show')),
    amount_paid INTEGER NOT NULL DEFAULT 0,
    attendee_info JSONB DEFAULT '{}',       -- custom field responses
    group_size INTEGER NOT NULL DEFAULT 1,
    checked_in_at TIMESTAMPTZ,
    check_in_method VARCHAR(20),            -- 'qr', 'manual'
    cancelled_at TIMESTAMPTZ,
    refund_amount INTEGER DEFAULT 0,
    hold_expires_at TIMESTAMPTZ,            -- for pending registrations
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_registrations_event ON event_registrations(event_id);
CREATE INDEX idx_event_registrations_customer ON event_registrations(customer_id);
CREATE INDEX idx_event_registrations_status ON event_registrations(event_id, status);
```

### Event Waitlist

```sql
CREATE TABLE event_waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    ticket_tier_id UUID REFERENCES event_ticket_tiers(id),
    position INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'notified', 'confirmed', 'expired', 'cancelled')),
    notified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, customer_id)
);

CREATE INDEX idx_event_waitlist_event ON event_waitlist(event_id, position);
```

### Event Communications Log

```sql
CREATE TABLE event_communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    communication_type VARCHAR(30) NOT NULL
        CHECK (communication_type IN ('confirmation', 'reminder', 'preparation', 'follow_up', 'cancellation', 'ad_hoc')),
    recipient_type VARCHAR(20) NOT NULL DEFAULT 'all'
        CHECK (recipient_type IN ('all', 'individual', 'waitlisted')),
    recipient_id UUID,                       -- specific customer if individual
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    subject VARCHAR(300),
    content TEXT
);
```

---

## 2. Recurring Event Generation

```
When a recurring template is created/updated:
  1. Determine the next N occurrence dates based on pattern
  2. For each date where no event instance exists:
     - Create an Event with recurrence_id = template.id
     - Copy settings from template (capacity, pricing, facilitator)
     - Create default ticket tiers from template_data
  3. Schedule a job to generate future instances (rolling 90-day window)

Modifying a single occurrence:
  - Update the specific event (detach from template if needed)
  - Mark as "modified" in metadata

Cancelling a single occurrence:
  - Set event status = 'cancelled'
  - Notify registered attendees for that occurrence only

Cancelling the series:
  - Set template status = 'cancelled'
  - Cancel all future events (status != 'completed')
  - Notify all affected registrants
```

---

## 3. Registration Flow

```
Customer selects event → views tiers → selects tier → provides info → pays → confirmed

1. Customer visits event detail page
2. Selects a ticket tier (validates eligibility, availability window, quantity)
3. Enters attendee info (including custom fields if configured)
4. For group registration: enters count + additional attendee details
5. System creates registration with status = 'pending', hold_expires_at = NOW() + 10min
6. Customer completes payment (Phase 10):
   - Success → status = 'confirmed', increment quantity_sold
   - Failure/timeout → status = 'cancelled', release hold
7. Send confirmation email with details + QR code for check-in
8. For free events: skip payment step, immediately confirm
```

---

## 4. Capacity and Waitlist

```
On registration attempt:
  1. Count confirmed registrations (sum of group_size)
  2. If count < capacity:
     - Proceed with registration
  3. If count >= capacity:
     - Add to waitlist (next position)
     - Notify customer of waitlist position

On cancellation:
  1. Cancel registration
  2. Process refund per policy
  3. Check waitlist:
     - Get next entry with status = 'waiting'
     - Send notification with claim link
     - Set status = 'notified', expires_at = NOW() + 4 hours
  4. If notified customer doesn't confirm within window:
     - Set status = 'expired'
     - Move to next waitlist entry
```

---

## 5. Event Series (Programs)

- Series groups multiple events into a structured program
- Customer registers for the series (one payment for all sessions) OR per-session (drop-in)
- Attendance tracked per session: `event_registrations` per event in the series
- If `require_sequential = true`, system checks customer attended prior session before allowing registration for next
- Progress displayed: sessions attended / total_sessions

---

## 6. Communications

| Trigger | Type | When |
|---------|------|------|
| Registration confirmed | confirmation | Immediately |
| Event approaching | reminder | 1 day / 3 days / 7 days before (configurable) |
| Pre-event prep | preparation | X days before (per event config) |
| Event completed | follow_up | 1 day after |
| Cancellation | cancellation | Immediately |
| Manual message | ad_hoc | When sent by admin |

Communications use the existing email service (Phase 03). Templates are configurable per event or per event type.

---

## 7. Check-In

- Each registration gets a unique QR code (encoding: registration reference_number)
- Facilitator/reception scans QR → system marks `checked_in_at` and `check_in_method = 'qr'`
- Manual check-in: facilitator selects attendee from list → marks checked in
- Late arrival: same as check-in but system notes the time difference
- No-show: after event ends, unchecked registrations marked as `no_show`

---

## 8. API Endpoints

### Event Types

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/types` | List event types |
| POST | `/api/v1/events/types` | Create event type |
| PUT | `/api/v1/events/types/:id` | Update event type |

### Events CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events` | List events (filter, paginate) |
| POST | `/api/v1/events` | Create event |
| GET | `/api/v1/events/:id` | Get event detail |
| PUT | `/api/v1/events/:id` | Update event |
| PUT | `/api/v1/events/:id/publish` | Publish event |
| PUT | `/api/v1/events/:id/cancel` | Cancel event |
| PUT | `/api/v1/events/:id/complete` | Mark completed |
| POST | `/api/v1/events/:id/facilitators` | Add facilitator |
| DELETE | `/api/v1/events/:id/facilitators/:fid` | Remove facilitator |

### Recurring Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/recurring` | List recurring templates |
| POST | `/api/v1/events/recurring` | Create recurring template |
| PUT | `/api/v1/events/recurring/:id` | Update template |
| PUT | `/api/v1/events/recurring/:id/cancel` | Cancel series |
| POST | `/api/v1/events/recurring/:id/generate` | Generate next instances |

### Event Series

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/series` | List series |
| POST | `/api/v1/events/series` | Create series |
| GET | `/api/v1/events/series/:id` | Get series detail |
| PUT | `/api/v1/events/series/:id` | Update series |

### Ticket Tiers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/:id/tickets` | List ticket tiers |
| POST | `/api/v1/events/:id/tickets` | Create tier |
| PUT | `/api/v1/events/:id/tickets/:tid` | Update tier |
| DELETE | `/api/v1/events/:id/tickets/:tid` | Delete tier |

### Registration

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/events/:id/register` | Register for event |
| GET | `/api/v1/events/:id/registrations` | List registrations (admin) |
| PUT | `/api/v1/events/registrations/:rid/cancel` | Cancel registration |
| PUT | `/api/v1/events/registrations/:rid/transfer` | Transfer to another customer |
| GET | `/api/v1/events/:id/waitlist` | Get waitlist |
| PUT | `/api/v1/events/waitlist/:wid/confirm` | Confirm waitlist spot |

### Check-In

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/v1/events/registrations/:rid/check-in` | Check in attendee |
| POST | `/api/v1/events/:id/check-in/qr` | QR code check-in |
| GET | `/api/v1/events/:id/attendees` | Attendee list with status |

### Public Calendar

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/calendar` | Public event calendar (no auth) |
| GET | `/api/v1/events/calendar/:slug` | Public event detail |

### Communications

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/events/:id/communications` | Send ad-hoc message |
| GET | `/api/v1/events/:id/communications` | Communication history |

### Reporting

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events/reports/summary` | Aggregated metrics |
| GET | `/api/v1/events/:id/reports` | Per-event metrics |
| GET | `/api/v1/events/:id/attendees/export` | Export attendee list (CSV) |

---

## 9. Frontend Views

### Event List (`/events`)
- Paginated list with filters (type, status, date range)
- Card view with cover image, title, date, capacity, facilitator
- Quick actions: publish, cancel, duplicate

### Event Detail (`/events/:id`)
- Tabbed layout:
  - **Details** — title, description, type, dates, location, facilitators
  - **Tickets** — tier management (add, edit, pricing, availability)
  - **Registrations** — attendee list, statuses, check-in actions
  - **Waitlist** — ordered list with notify/confirm actions
  - **Communications** — send messages, view history
  - **Reports** — attendance rate, revenue, tier breakdown

### Event Create/Edit (`/events/new`, `/events/:id/edit`)
- Multi-step form: basics → schedule → tickets → facilitators → publish

### Recurring Event Management (`/events/recurring`)
- List of templates with next occurrence
- Generate/pause/cancel controls

### Event Series (`/events/series`)
- Series list with progress tracking
- Link events to series

### Public Event Calendar (customer-facing)
- List/calendar/card views
- Filters by type, date, availability
- Event detail with registration CTA
- Embeddable widget

### Check-In View (`/events/:id/check-in`)
- QR scanner interface
- Attendee list with check-in buttons
- Real-time attendance counter

---

**Last Updated**: June 16, 2026
