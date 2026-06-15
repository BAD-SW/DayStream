# Phase 06: Service Management - Tasks

## Overview

Implementation tasks for the service management engine — database schema, categories, CRUD, variants/pricing, images, staff assignment, cancellation policies, availability rules, tax config, catalog, templates, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `service_categories` table (business-scoped, hierarchical)
- [x] ✅ Create migration for `services` table (with booking_type, status, configuration fields)
- [x] ✅ Create migration for `service_variants` table (pricing_model, subscription fields)
- [x] ✅ Create migration for `service_images` table (metadata only, no binary)
- [x] ✅ Create migration for `service_staff` table (staff-to-service assignment)
- [x] ✅ Create migration for `service_resources` table (resource requirements)
- [x] ✅ Create migration for `service_locations` table (location assignment)
- [x] ✅ Create migration for `cancellation_policies` table
- [x] ✅ Create migration for `service_availability_rules` table
- [x] ✅ Create migration for `tax_categories` table
- [x] ✅ Create migration for `service_templates` table (system-level seed data)

### 1.2 Indexes and Constraints
- [x] ✅ Add full-text search index on services (name, description)
- [x] ✅ Add RLS policies on all service tables (business-scoped)
- [x] ✅ Grant permissions to daystream_app role

### 1.3 Seed Data
- [x] ✅ Seed default tax categories per business (Standard, Reduced, Zero-rated)
- [x] ✅ Seed service templates for common business types

---

## 2. Service Categories

### 2.1 Categories CRUD
- [x] ✅ Create `GET /api/v1/services/categories` endpoint (list with service counts)
- [x] ✅ Create `POST /api/v1/services/categories` endpoint
- [x] ✅ Create `PUT /api/v1/services/categories/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/services/categories/:id` endpoint (archive)
- [x] ✅ Support parent/child hierarchy (max 2 levels)
- [x] ✅ Validate unique name within business + parent
- [x] ✅ Write unit tests

---

## 3. Service CRUD

### 3.1 Create Service
- [x] ✅ Create `POST /api/v1/services` endpoint
- [x] ✅ Validate input (name, category, booking_type, duration, capacity)
- [x] ✅ Auto-generate slug from name (unique within business)
- [x] ✅ Validate name uniqueness within category
- [x] ✅ Default status to 'draft'
- [x] ✅ Log creation in audit trail

### 3.2 List/Search Services
- [x] ✅ Create `GET /api/v1/services` endpoint
- [x] ✅ Support filtering by: category, status, booking_type
- [x] ✅ Support full-text search on name/description
- [x] ✅ Support pagination (page, limit, sort, order)
- [x] ✅ Scope results to current business

### 3.3 Get Service Detail
- [x] ✅ Create `GET /api/v1/services/:id` endpoint
- [x] ✅ Include variants, images, staff, availability rules in response

### 3.4 Update Service
- [x] ✅ Create `PUT /api/v1/services/:id` endpoint
- [x] ✅ Validate configuration consistency (capacity > 0 for shared)
- [x] ✅ Re-generate slug if name changed (optional)

### 3.5 Status Transitions
- [x] ✅ Create `PUT /api/v1/services/:id/archive` endpoint
- [x] ✅ Create `PUT /api/v1/services/:id/restore` endpoint
- [x] ✅ Create `PUT /api/v1/services/:id/pause` endpoint
- [x] ✅ Validate at least one active variant before activating
- [x] ✅ Write unit tests

---

## 4. Service Variants

### 4.1 Variants CRUD
- [x] ✅ Create `GET /api/v1/services/:id/variants` endpoint
- [x] ✅ Create `POST /api/v1/services/:id/variants` endpoint
- [x] ✅ Create `PUT /api/v1/services/:id/variants/:variantId` endpoint
- [x] ✅ Create `DELETE /api/v1/services/:id/variants/:variantId` endpoint
- [x] ✅ Validate pricing_model and subscription fields consistency
- [x] ✅ Prevent deleting the last active variant of an active service
- [x] ✅ Support reordering via display_order

### 4.2 Subscription Variant Validation
- [x] ✅ Require billing_interval when pricing_model = 'subscription'
- [x] ✅ Validate included_sessions is positive or NULL (unlimited)
- [x] ✅ Default sessions_rollover to false
- [x] ✅ Write unit tests (per_session and subscription variants)

---

## 5. Service Images

### 5.1 Storage Service
- [x] ✅ Create storage service interface (upload, delete, getUrl)
- [x] ✅ Implement local filesystem storage backend
- [x] ✅ Implement S3-compatible storage backend
- [x] ✅ Select backend from STORAGE_BACKEND env var
- [x] ✅ Organize files: `/{tenant_id}/{business_id}/services/{service_id}/`

### 5.2 Image Processing
- [x] ✅ Integrate sharp library for image resizing
- [x] ✅ Generate thumbnail (200px), medium (600px), large (1200px) on upload
- [x] ✅ Convert resized images to WebP format
- [x] ✅ Validate uploads: format (JPEG, PNG, WebP), size (≤5MB), dimensions (≥400x300)

### 5.3 Image API
- [x] ✅ Create `POST /api/v1/services/:id/images` endpoint (multipart upload)
- [x] ✅ Create `GET /api/v1/services/:id/images` endpoint
- [x] ✅ Create `PUT /api/v1/services/:id/images/:imageId` endpoint (alt, order, primary)
- [x] ✅ Create `DELETE /api/v1/services/:id/images/:imageId` endpoint (removes files + record)
- [x] ✅ Enforce max 10 images per service
- [x] ✅ Enforce exactly one primary image per service
- [x] ✅ Write unit tests

---

## 6. Staff Assignment

### 6.1 Staff Assignment API
- [x] ✅ Create `GET /api/v1/services/:id/staff` endpoint
- [x] ✅ Create `POST /api/v1/services/:id/staff` endpoint (assign with optional variant scope)
- [x] ✅ Create `DELETE /api/v1/services/:id/staff/:userId` endpoint
- [x] ✅ Support `is_primary` designation
- [x] ✅ Support variant-specific assignment
- [x] ✅ Write unit tests

---

## 7. Cancellation Policies

### 7.1 Policy CRUD
- [x] ✅ Create `GET /api/v1/services/cancellation-policies` endpoint
- [x] ✅ Create `POST /api/v1/services/cancellation-policies` endpoint
- [x] ✅ Create `PUT /api/v1/services/cancellation-policies/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/services/cancellation-policies/:id` endpoint
- [x] ✅ Support business default policy (is_default flag)
- [x] ✅ Fee calculation helper (percentage or fixed, based on hours before)
- [x] ✅ Write unit tests

---

## 8. Availability Rules

### 8.1 Availability API
- [x] ✅ Create `GET /api/v1/services/:id/availability` endpoint
- [x] ✅ Create `POST /api/v1/services/:id/availability` endpoint (recurring, seasonal, block)
- [x] ✅ Create `DELETE /api/v1/services/:id/availability/:ruleId` endpoint
- [x] ✅ Validate rule_type fields (days_of_week for recurring, dates for seasonal/block)
- [x] ✅ Write unit tests

---

## 9. Tax Configuration

### 9.1 Tax Categories API
- [x] ✅ Create `GET /api/v1/services/tax-categories` endpoint
- [x] ✅ Create `POST /api/v1/services/tax-categories` endpoint
- [x] ✅ Create `PUT /api/v1/services/tax-categories/:id` endpoint
- [x] ✅ Support is_default flag
- [x] ✅ Store rates in basis points
- [x] ✅ Write unit tests

---

## 10. Service Catalog (Public)

### 10.1 Catalog API
- [x] ✅ Create `GET /api/v1/catalog/:businessSlug` endpoint (no auth)
- [x] ✅ Return categories with nested active services
- [x] ✅ Support filtering (category, price range, duration range, search)
- [x] ✅ Include starting price, duration range, primary image per service
- [x] ✅ Create `GET /api/v1/catalog/:businessSlug/:serviceSlug` endpoint (detail)
- [x] ✅ Include all variants, images, staff (if configured), cancellation policy
- [x] ✅ Write unit tests

---

## 11. Service Templates

### 11.1 Templates API
- [x] ✅ Create `GET /api/v1/services/templates` endpoint (list by business_type)
- [x] ✅ Create `POST /api/v1/services/templates/apply` endpoint
- [x] ✅ Create categories from template (skip existing)
- [x] ✅ Create services in draft status
- [x] ✅ Create default variant per service
- [x] ✅ Create default cancellation policy if none exists
- [x] ✅ Seed template data for: Recovery Center, Yoga Studio, Gym/Fitness, Spa, Physiotherapy
- [x] ✅ Write unit tests

---

## 12. Frontend

### 12.1 Service List Page
- [x] ✅ Create `/services` page with table/card view
- [x] ✅ Filter by category, status
- [x] ✅ Search bar
- [x] ✅ Quick actions (edit, archive, pause)
- [x] ✅ "Add Service" button → create form

### 12.2 Service Detail/Edit Page
- [x] ✅ Create `/services/:id` page
- [x] ✅ Tabs: Details, Variants, Images, Staff, Availability, Policy
- [x] ✅ Details tab: all configuration fields
- [x] ✅ Variants tab: list, add, edit, reorder, delete
- [x] ✅ Images tab: upload, drag-reorder, set primary, delete
- [x] ✅ Staff tab: assign/remove staff, set primary
- [x] ✅ Availability tab: list rules, add recurring/seasonal/block
- [x] ✅ Policy tab: select or create cancellation policy

### 12.3 Category Management Page
- [x] ✅ Create `/services/categories` page
- [x] ✅ Nested list with parent/child hierarchy
- [x] ✅ Drag-and-drop reordering
- [x] ✅ Inline edit (name, icon)
- [x] ✅ Service counts per category

### 12.4 Catalog Preview
- [x] ✅ Create `/services/catalog-preview` page
- [x] ✅ Preview of public catalog view
- [x] ✅ Category navigation
- [x] ✅ Service cards → detail view

---

## 13. Testing

### 13.1 Unit Tests
- [x] ✅ Test service CRUD (create, update, archive, restore, pause)
- [x] ✅ Test category hierarchy (create, nest, move service)
- [x] ✅ Test variant creation (per_session and subscription)
- [x] ✅ Test subscription variant validation (required fields)
- [x] ✅ Test image upload (valid, invalid format, too large)
- [x] ✅ Test staff assignment (assign, remove, variant-specific)
- [x] ✅ Test cancellation policy (CRUD, fee calculation)
- [x] ✅ Test availability rules (recurring, seasonal, block)
- [x] ✅ Test tax categories (CRUD, default assignment)
- [x] ✅ Test slug generation (unique, re-generation)

### 13.2 Integration Tests
- [x] ✅ Test full service creation flow (category → service → variants → images → staff)
- [x] ✅ Test public catalog (only active + online-booking-enabled services appear)
- [x] ✅ Test template application (categories + services created in draft)
- [x] ✅ Test business scoping (cannot access other business services)
