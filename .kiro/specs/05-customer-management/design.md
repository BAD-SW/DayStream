# Phase 05: Customer Management (CRM) - Design Document

**Date**: June 13, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04

---

## Overview

This document describes the technical design for the DayStream customer management system — the database schema, API endpoints, business-scoped data access, notes system, search/segmentation, lifecycle tracking, and frontend views.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [API Endpoints](#2-api-endpoints)
3. [Business-Scoped Access](#3-business-scoped-access)
4. [Customer Notes System](#4-customer-notes-system)
5. [Search and Filtering](#5-search-and-filtering)
6. [Segmentation Engine](#6-segmentation-engine)
7. [Tags System](#7-tags-system)
8. [Activity Timeline](#8-activity-timeline)
9. [Lifecycle Tracking](#9-lifecycle-tracking)
10. [Import/Export](#10-importexport)
11. [Duplicate Detection](#11-duplicate-detection)
12. [Frontend Views](#12-frontend-views)

---

## 1. Database Schema

### Core Customer Table

```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_id UUID NOT NULL REFERENCES businesses(id),
    reference_number VARCHAR(20) NOT NULL,        -- e.g., CUST-0001 (per business)
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(20),
    preferred_language VARCHAR(5) DEFAULT 'en',
    country VARCHAR(100),
    avatar_url TEXT,
    lifecycle_stage VARCHAR(20) NOT NULL DEFAULT 'lead'
        CHECK (lifecycle_stage IN ('lead', 'trial', 'active', 'at_risk', 'churned', 'winback')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived', 'anonymized')),
    anonymized_at TIMESTAMPTZ,
    anonymized_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, email)
);

CREATE INDEX idx_customers_business ON customers(business_id);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_name ON customers(last_name, first_name);
CREATE INDEX idx_customers_lifecycle ON customers(business_id, lifecycle_stage);
CREATE INDEX idx_customers_reference ON customers(business_id, reference_number);
```

### Customer Notes

```sql
CREATE TABLE customer_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id),
    category VARCHAR(50) NOT NULL,               -- business-defined (e.g., "health", "vehicle", "preferences")
    content_encrypted TEXT NOT NULL,             -- AES-256-GCM encrypted
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);
```

### Note Categories (per business)

```sql
CREATE TABLE note_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    customer_visible BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(business_id, name)
);
```

### Customer Tags

```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#8A8A8A',
    UNIQUE(business_id, name)
);

CREATE TABLE customer_tags (
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (customer_id, tag_id)
);
```

### Customer Custom Fields

```sql
CREATE TABLE customer_custom_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT,
    UNIQUE(customer_id, key)
);
```

### Activity Timeline

```sql
CREATE TABLE customer_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id),
    activity_type VARCHAR(50) NOT NULL,          -- 'booking', 'payment', 'membership', 'note', 'profile_change', 'lifecycle', 'communication'
    description TEXT NOT NULL,
    metadata JSONB,                              -- activity-specific data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_activities_customer ON customer_activities(customer_id);
CREATE INDEX idx_activities_type ON customer_activities(customer_id, activity_type);
CREATE INDEX idx_activities_date ON customer_activities(customer_id, created_at DESC);
```

### Segments

```sql
CREATE TABLE segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    rules JSONB NOT NULL,                       -- filter rules (evaluated dynamically)
    is_predefined BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Communication Preferences

```sql
CREATE TABLE customer_preferences (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    email_marketing BOOLEAN NOT NULL DEFAULT false,
    sms_marketing BOOLEAN NOT NULL DEFAULT false,
    push_notifications BOOLEAN NOT NULL DEFAULT false,
    booking_reminders BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 2. API Endpoints

### Customer CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/customers` | Create customer |
| GET | `/api/v1/customers` | List/search customers (paginated) |
| GET | `/api/v1/customers/:id` | Get customer detail |
| PUT | `/api/v1/customers/:id` | Update customer |
| PUT | `/api/v1/customers/:id/archive` | Archive (soft-delete) |
| POST | `/api/v1/customers/:id/anonymize` | Anonymize (GDPR erasure) |

### Notes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/customers/:id/notes` | Add note |
| GET | `/api/v1/customers/:id/notes` | List notes |

### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tags` | List business tags |
| POST | `/api/v1/tags` | Create tag |
| POST | `/api/v1/customers/:id/tags` | Assign tag |
| DELETE | `/api/v1/customers/:id/tags/:tagId` | Remove tag |

### Activity Timeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/customers/:id/activities` | Get timeline (paginated, filterable) |

### Lifecycle

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/v1/customers/:id/lifecycle` | Manual stage override |
| GET | `/api/v1/customers/lifecycle-summary` | Counts per stage |

### Segments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/segments` | List saved segments |
| POST | `/api/v1/segments` | Create segment |
| GET | `/api/v1/segments/:id/members` | Evaluate and return members |
| DELETE | `/api/v1/segments/:id` | Delete segment |

### Import/Export

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/customers/import` | Import from CSV |
| POST | `/api/v1/customers/import/validate` | Dry-run validation |
| GET | `/api/v1/customers/export` | Export to CSV |

---

## 3. Business-Scoped Access

All customer endpoints enforce business context:

```typescript
// Middleware chain for customer routes:
authenticate → tenantContext → requireBusinessContext → requirePermission('customers:read')

// Every query includes business_id:
SELECT * FROM customers WHERE business_id = $1 AND ...
```

Tenant Users do NOT have access to customer data. Only Business Users (business_owner, business_manager, business_staff) can access customers.

---

## 4. Customer Notes System

### Encryption Flow

```
1. Staff writes note in UI
2. Note content encrypted with AES-256-GCM before DB insert
3. On read: decrypt content, check role-based access
4. Audit log entry for every read of sensitive notes
```

### Category System

Businesses define their own note categories:
- Wellness: "Goals", "Injuries", "Contraindications"
- Auto: "Vehicle Info", "Service History", "Recalls"
- Vet: "Pet Details", "Medical History", "Vaccinations"
- Salon: "Hair Type", "Allergies", "Preferences"

Each category has `is_sensitive` (triggers encryption + audit logging) and `customer_visible` (shown in customer portal).

---

## 5. Search and Filtering

### Full-Text Search

```sql
-- Add search index
CREATE INDEX idx_customers_search ON customers
    USING GIN (to_tsvector('english', first_name || ' ' || last_name || ' ' || email || ' ' || COALESCE(phone, '')));
```

### Filter Parameters

```typescript
interface CustomerFilters {
  search?: string;           // Full-text across name, email, phone
  lifecycle_stage?: string;
  tag_ids?: string[];
  last_visit_before?: string;
  last_visit_after?: string;
  registered_before?: string;
  registered_after?: string;
  language?: string;
}
```

---

## 6. Segmentation Engine

### Rule Format

```typescript
interface SegmentRule {
  field: string;             // e.g., 'lifecycle_stage', 'tag', 'last_visit'
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'contains' | 'between';
  value: any;
}

interface SegmentDefinition {
  logic: 'AND' | 'OR';
  rules: SegmentRule[];
}
```

### Dynamic Evaluation

Segments are NOT pre-computed. On query:
1. Load segment rules
2. Build SQL WHERE clause from rules
3. Execute query against customers table
4. Return matching customers + count

---

## 7. Tags System

- Tags are created per Business
- Each tag has a name and color (hex)
- Tags are assigned to customers via `customer_tags` join
- Automated rules evaluated on lifecycle transitions or activity events

---

## 8. Activity Timeline

Events are written by various modules and aggregated in `customer_activities`:

```typescript
// When a booking is created:
await createActivity(customerId, businessId, 'booking', 'Booked: Swedish Massage', { bookingId, serviceId, date });

// When lifecycle changes:
await createActivity(customerId, businessId, 'lifecycle', 'Stage changed: Lead → Trial', { from: 'lead', to: 'trial' });
```

---

## 9. Lifecycle Tracking

### State Machine

```
Lead → Trial → Active → At-Risk → Churned
                  ↑                    ↓
                  └──── Winback ←──────┘
```

### Transition Rules (configurable per Business)

Stored in `business_configurations`:
- `lifecycle.trial_after_bookings`: 1 (default)
- `lifecycle.active_after_visits`: 3
- `lifecycle.at_risk_days`: 30
- `lifecycle.churned_days`: 90

### Evaluation

Lifecycle transitions can be triggered:
- On booking creation/attendance (Lead → Trial → Active)
- Via scheduled job (Active → At-Risk → Churned based on last visit date)
- On winback (any activity after Churned)

---

## 10. Import/Export

### CSV Import Flow

```
1. Upload CSV file
2. Parse headers → show column mapping UI
3. User maps CSV columns to Customer_Profile fields
4. Validate all rows (dry-run if requested)
5. Report errors with row numbers
6. On confirm: insert valid rows, skip/report invalid
7. Audit log with counts
```

### Export

- Standard CSV format with configurable columns
- Supports filter (export only a segment or search result)
- GDPR export includes all personal data in JSON

---

## 11. Duplicate Detection

On customer creation:
1. Query existing customers in the same Business with matching email OR phone
2. If matches found: return potential duplicates to the user
3. User can: create anyway (different person), or cancel and navigate to existing

On merge:
1. Select primary and secondary profiles
2. Choose which fields to keep from each
3. Reassign all activities, bookings, payments to primary
4. Delete secondary profile
5. Audit log with full details

---

## 12. Frontend Views

### Customer List Page (`/customers`)
- Table with columns: Name, Email, Phone, Lifecycle, Tags, Last Visit
- Search bar with filters panel
- Bulk actions (tag, export, archive)
- "Add Customer" button

### Customer Detail Page (`/customers/:id`)
- Profile header (avatar, name, reference, lifecycle badge)
- Tabs: Overview, Notes, Timeline, Preferences
- Overview: contact info, custom fields, tags
- Notes: categorized notes list with add button
- Timeline: paginated activity feed with type filters
- Preferences: communication opt-in/out toggles

### Segments Page (`/customers/segments`)
- List of saved segments with member counts
- Create/edit segment with rule builder UI

### Import Page (`/customers/import`)
- File upload → column mapping → validation → confirm

---

**Last Updated**: June 13, 2026
