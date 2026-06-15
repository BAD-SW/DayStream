# Phase 06: Service Management - Design Document

**Date**: June 14, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04

---

## Overview

This document describes the technical design for the DayStream service management engine — the database schema, API endpoints, image storage architecture, pricing model, catalog system, and frontend views.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [API Endpoints](#2-api-endpoints)
3. [Image Storage Architecture](#3-image-storage-architecture)
4. [Pricing Models](#4-pricing-models)
5. [Service Catalog](#5-service-catalog)
6. [Availability Rules](#6-availability-rules)
7. [Cancellation Policies](#7-cancellation-policies)
8. [Service Templates](#8-service-templates)
9. [Tax Configuration](#9-tax-configuration)
10. [Frontend Views](#10-frontend-views)

---

## 1. Database Schema

### Service Categories

```sql
CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    display_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name, parent_id)
);

CREATE INDEX idx_service_categories_business ON service_categories(business_id);
CREATE INDEX idx_service_categories_parent ON service_categories(parent_id);
```

### Services

```sql
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES service_categories(id),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    booking_type VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (booking_type IN ('individual', 'shared', 'group', 'resource')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    -- Configuration
    default_duration INTEGER NOT NULL DEFAULT 60,          -- minutes
    buffer_before INTEGER NOT NULL DEFAULT 0,              -- minutes
    buffer_after INTEGER NOT NULL DEFAULT 0,               -- minutes
    max_capacity INTEGER NOT NULL DEFAULT 1,
    min_advance_booking_hours INTEGER NOT NULL DEFAULT 2,
    max_advance_booking_days INTEGER NOT NULL DEFAULT 30,
    online_booking_enabled BOOLEAN NOT NULL DEFAULT true,
    preparation_notes TEXT,                                 -- staff-only
    -- Display
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Tax
    tax_category_id UUID REFERENCES tax_categories(id),
    -- Cancellation
    cancellation_policy_id UUID REFERENCES cancellation_policies(id),
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, slug)
);

CREATE INDEX idx_services_business ON services(business_id);
CREATE INDEX idx_services_category ON services(category_id);
CREATE INDEX idx_services_status ON services(business_id, status);
CREATE INDEX idx_services_slug ON services(business_id, slug);
```

### Service Variants

```sql
CREATE TABLE service_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,                             -- e.g., "30 minutes", "Monthly Unlimited"
    duration INTEGER NOT NULL,                              -- minutes
    price INTEGER NOT NULL,                                 -- cents (minor currency units)
    pricing_model VARCHAR(20) NOT NULL DEFAULT 'per_session'
        CHECK (pricing_model IN ('per_session', 'subscription')),
    -- Subscription fields (null for per_session)
    billing_interval VARCHAR(20)
        CHECK (billing_interval IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
    included_sessions INTEGER,                              -- NULL = unlimited
    sessions_rollover BOOLEAN DEFAULT false,
    -- Overrides
    capacity_override INTEGER,                              -- NULL = use service default
    -- Display
    display_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_variants_service ON service_variants(service_id);
```

### Service Images

```sql
CREATE TABLE service_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,                                -- relative path in storage
    filename VARCHAR(255) NOT NULL,
    alt_text VARCHAR(500),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,                                      -- bytes
    mime_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_images_service ON service_images(service_id);
```

### Staff Assignment

```sql
CREATE TABLE service_staff (
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES service_variants(id) ON DELETE CASCADE,  -- NULL = all variants
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service_id, user_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'))
);

CREATE INDEX idx_service_staff_service ON service_staff(service_id);
CREATE INDEX idx_service_staff_user ON service_staff(user_id);
```

### Service Resource Requirements

```sql
CREATE TABLE service_resources (
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL,                              -- references resources table (Phase 13)
    variant_id UUID REFERENCES service_variants(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (service_id, resource_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'))
);
```

### Service Location Assignment

```sql
CREATE TABLE service_locations (
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,                              -- references locations table
    PRIMARY KEY (service_id, location_id)
);
```

### Cancellation Policies

```sql
CREATE TABLE cancellation_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    free_cancellation_hours INTEGER NOT NULL DEFAULT 24,
    late_cancel_fee_type VARCHAR(10) NOT NULL DEFAULT 'percentage'
        CHECK (late_cancel_fee_type IN ('percentage', 'fixed')),
    late_cancel_fee_value INTEGER NOT NULL DEFAULT 50,       -- percentage (50%) or cents
    noshow_fee_type VARCHAR(10) NOT NULL DEFAULT 'percentage'
        CHECK (noshow_fee_type IN ('percentage', 'fixed')),
    noshow_fee_value INTEGER NOT NULL DEFAULT 100,           -- percentage (100%) or cents
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cancellation_policies_business ON cancellation_policies(business_id);
```

### Service Availability Rules

```sql
CREATE TABLE service_availability_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('recurring', 'seasonal', 'block')),
    -- Recurring: which days/hours
    days_of_week INTEGER[],                                  -- 0=Sun, 1=Mon, ..., 6=Sat
    start_time TIME,
    end_time TIME,
    -- Date range (seasonal/block)
    effective_from DATE,
    effective_to DATE,
    -- Block: specific dates
    blocked_dates DATE[],
    -- Metadata
    description VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_rules_service ON service_availability_rules(service_id);
```

### Tax Categories

```sql
CREATE TABLE tax_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,                               -- "Standard", "Reduced", "Zero-rated"
    rate INTEGER NOT NULL,                                   -- basis points (2100 = 21%)
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name)
);

CREATE INDEX idx_tax_categories_business ON tax_categories(business_id);
```

### Service Templates (system-level)

```sql
CREATE TABLE service_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_type VARCHAR(50) NOT NULL,                      -- 'recovery_center', 'yoga_studio', etc.
    name VARCHAR(200) NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    booking_type VARCHAR(20) NOT NULL DEFAULT 'individual',
    default_duration INTEGER NOT NULL DEFAULT 60,
    suggested_price INTEGER,                                 -- cents
    cancellation_hours INTEGER DEFAULT 24,
    display_order INTEGER NOT NULL DEFAULT 0
);
```

---

## 2. API Endpoints

### Service Categories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/categories` | List categories for business |
| POST | `/api/v1/services/categories` | Create category |
| PUT | `/api/v1/services/categories/:id` | Update category |
| DELETE | `/api/v1/services/categories/:id` | Archive category |

### Services CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/services` | Create service |
| GET | `/api/v1/services` | List services (paginated, filterable) |
| GET | `/api/v1/services/:id` | Get service detail |
| PUT | `/api/v1/services/:id` | Update service |
| PUT | `/api/v1/services/:id/archive` | Archive service |
| PUT | `/api/v1/services/:id/restore` | Restore archived service |
| PUT | `/api/v1/services/:id/pause` | Pause service |

### Service Variants

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/:id/variants` | List variants |
| POST | `/api/v1/services/:id/variants` | Create variant |
| PUT | `/api/v1/services/:id/variants/:variantId` | Update variant |
| DELETE | `/api/v1/services/:id/variants/:variantId` | Delete variant |

### Service Images

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/:id/images` | List images |
| POST | `/api/v1/services/:id/images` | Upload image |
| PUT | `/api/v1/services/:id/images/:imageId` | Update metadata (alt, order, primary) |
| DELETE | `/api/v1/services/:id/images/:imageId` | Delete image |

### Staff Assignment

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/:id/staff` | List assigned staff |
| POST | `/api/v1/services/:id/staff` | Assign staff |
| DELETE | `/api/v1/services/:id/staff/:userId` | Remove staff assignment |

### Cancellation Policies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/cancellation-policies` | List policies for business |
| POST | `/api/v1/services/cancellation-policies` | Create policy |
| PUT | `/api/v1/services/cancellation-policies/:id` | Update policy |
| DELETE | `/api/v1/services/cancellation-policies/:id` | Delete policy |

### Availability Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/:id/availability` | List rules |
| POST | `/api/v1/services/:id/availability` | Create rule |
| DELETE | `/api/v1/services/:id/availability/:ruleId` | Delete rule |

### Tax Categories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/tax-categories` | List tax categories |
| POST | `/api/v1/services/tax-categories` | Create tax category |
| PUT | `/api/v1/services/tax-categories/:id` | Update tax category |

### Service Catalog (Public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/catalog/:businessSlug` | Browse services (no auth) |
| GET | `/api/v1/catalog/:businessSlug/:serviceSlug` | Service detail (no auth) |

### Service Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services/templates` | List templates by business type |
| POST | `/api/v1/services/templates/apply` | Apply template to business |

---

## 3. Image Storage Architecture

```
Storage Root (local or S3)
└── {tenant_id}/
    └── {business_id}/
        └── services/
            └── {service_id}/
                ├── original/
                │   └── {uuid}.{ext}
                ├── large/          (1200px wide)
                │   └── {uuid}.webp
                ├── medium/         (600px wide)
                │   └── {uuid}.webp
                └── thumbnail/      (200px wide)
                    └── {uuid}.webp
```

### Storage Service Interface

```typescript
interface StorageService {
  upload(tenantId: string, businessId: string, serviceId: string, file: Buffer, metadata: ImageMetadata): Promise<StoredImage>;
  delete(filePath: string): Promise<void>;
  getUrl(filePath: string): string;
}

// Implementation selected by env var STORAGE_BACKEND = 'local' | 's3'
```

### Processing Pipeline

1. Validate file (format, size, dimensions)
2. Generate UUID filename
3. Save original to storage
4. Generate responsive sizes (sharp library)
5. Save resized versions
6. Store metadata in `service_images` table
7. Return image record with URLs

---

## 4. Pricing Models

### Per-Session (Default)

```
Variant: "60 minute Sports Massage"
  pricing_model: 'per_session'
  price: 7500  (€75.00)
  duration: 60

→ Customer pays €75.00 per booking
```

### Subscription

```
Variant: "Monthly Unlimited Float"
  pricing_model: 'subscription'
  price: 12900  (€129.00/month)
  duration: 60
  billing_interval: 'monthly'
  included_sessions: NULL (unlimited)
  sessions_rollover: false

→ Customer pays €129.00/month, can book unlimited 60-min float sessions
→ DayStream initiates the charge on each billing cycle date
```

```
Variant: "4x Monthly Sauna Package"
  pricing_model: 'subscription'
  price: 9900  (€99.00/month)
  duration: 45
  billing_interval: 'monthly'
  included_sessions: 4
  sessions_rollover: false

→ Customer pays €99.00/month for up to 4 sessions
→ DayStream tracks session usage and initiates billing
```

### Billing Architecture

- Service variants define the terms (price, interval, sessions)
- Customer subscriptions are created in Phase 08 (Memberships) / Phase 10 (Payments)
- DayStream's billing scheduler (Phase 10) reads subscription terms and initiates charges
- Payment processor (Stripe, etc.) is called as a passive endpoint — never drives the cycle

---

## 5. Service Catalog

### Public API (No Auth)

The catalog endpoint is the customer-facing browsable view:

```typescript
// GET /api/v1/catalog/:businessSlug
// Returns categories with nested active services
interface CatalogResponse {
  business: { name: string; slug: string; logo_url: string };
  categories: Array<{
    id: string;
    name: string;
    icon: string;
    services: Array<{
      id: string;
      name: string;
      slug: string;
      short_description: string;
      primary_image_url: string;
      starting_price: number;      // lowest active variant price
      duration_range: string;       // e.g., "30-90 min"
      booking_type: string;
    }>;
  }>;
}
```

### Filters

- `category` — filter by category ID
- `min_price` / `max_price` — price range (cents)
- `min_duration` / `max_duration` — duration range (minutes)
- `search` — full-text search on name + description

---

## 6. Availability Rules

Rules are combined (AND logic) to determine when a service is bookable:

1. **Recurring**: Service offered on specific days/times (e.g., Mon-Fri 9:00-17:00)
2. **Seasonal**: Active only between date range (e.g., Jun 1 - Sep 30)
3. **Block**: Specific dates excluded (e.g., Dec 25, Jan 1)

The Booking Engine (Phase 07) evaluates: service availability ∩ staff availability ∩ resource availability = bookable slots.

---

## 7. Cancellation Policies

### Inheritance

1. Service checks its own `cancellation_policy_id`
2. If NULL, falls back to business default policy (`is_default = true`)
3. If no default exists, no cancellation restrictions apply

### Fee Calculation

```typescript
function calculateCancellationFee(policy: CancellationPolicy, bookingPrice: number, hoursBeforeStart: number): number {
  if (hoursBeforeStart >= policy.free_cancellation_hours) return 0;
  
  const feeType = policy.late_cancel_fee_type;
  const feeValue = policy.late_cancel_fee_value;
  
  if (feeType === 'percentage') return Math.round(bookingPrice * feeValue / 100);
  return feeValue; // fixed amount in cents
}
```

---

## 8. Service Templates

Templates are system-level seed data. On "apply":

1. Load templates for the selected `business_type`
2. Create categories that don't already exist
3. Create services in draft status under those categories
4. Create default variant per service with suggested price
5. Create default cancellation policy if none exists

Templates are additive — they never modify or delete existing data.

---

## 9. Tax Configuration

### Display Modes

- **Tax-inclusive** (default for EU): prices shown include tax, tax broken out on invoice
- **Tax-exclusive** (default for US): prices shown exclude tax, tax added at checkout

Configuration stored in `business_configurations` with key `tax.display_mode`.

### Rate Storage

Rates stored in basis points (1/100th of a percent):
- 2100 = 21.00% (standard EU VAT)
- 1000 = 10.00% (reduced rate)
- 0 = zero-rated

---

## 10. Frontend Views

### Service List Page (`/services`)
- Table/card view of all services
- Filter by category, status
- Quick actions (edit, archive, pause)
- "Add Service" button

### Service Detail/Edit Page (`/services/:id`)
- Form with all configuration fields
- Tabs: Details, Variants, Images, Staff, Availability, Policy
- Inline variant management (add/edit/reorder)
- Image upload with drag-and-drop reordering
- Staff assignment picker

### Category Management (`/services/categories`)
- Nested list with drag-and-drop reordering
- Inline edit for name/icon
- Count of services per category

### Service Catalog Preview (`/services/catalog-preview`)
- Staff preview of how the public catalog will appear
- Category navigation, service cards, detail view

---

**Last Updated**: June 14, 2026
