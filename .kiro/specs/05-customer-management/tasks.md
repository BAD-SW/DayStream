# Phase 05: Customer Management (CRM) - Tasks

## Overview

Implementation tasks for the customer management system — database schema, API endpoints, notes, search, segmentation, tags, lifecycle tracking, import/export, and frontend views.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `customers` table (with business_id, lifecycle_stage, status, anonymization fields)
- [x] ✅ Create migration for `customer_notes` table (encrypted content, categories)
- [x] ✅ Create migration for `note_categories` table (per-business, sensitivity, visibility)
- [x] ✅ Create migration for `tags` and `customer_tags` tables
- [x] ✅ Create migration for `customer_custom_fields` table
- [x] ✅ Create migration for `customer_activities` table (timeline events)
- [x] ✅ Create migration for `segments` table
- [x] ✅ Create migration for `customer_preferences` table (communication opt-ins)
- [x] ✅ Add full-text search index on customers (name, email, phone)
- [x] ✅ Add RLS policies on all new tables (business-scoped via tenant)
- [x] ✅ Grant permissions to daystream_app role

### 1.2 Reference Number Generation
- [x] ✅ Create function to auto-generate reference numbers per business (CUST-0001, CUST-0002)
- [x] ✅ Ensure uniqueness within business context

---

## 2. Customer CRUD API

### 2.1 Create Customer
- [x] ✅ Create `POST /api/v1/customers` endpoint
- [x] ✅ Validate input with Joi (required fields, email format, phone format)
- [x] ✅ Check for duplicate email within business
- [x] ✅ Generate reference number
- [x] ✅ Associate with current business context
- [x] ✅ Return duplicate warning if potential matches found
- [x] ✅ Log creation in audit trail
- [x] ✅ Write unit tests (customers.test.ts)

### 2.2 List/Search Customers
- [x] ✅ Create `GET /api/v1/customers` endpoint
- [x] ✅ Support full-text search query parameter
- [x] ✅ Support filter parameters (lifecycle_stage)
- [x] ✅ Support pagination (page, limit, sort, order)
- [x] ✅ Scope results to current business
- [x] ✅ Write unit tests (customers.test.ts)

### 2.3 Get Customer Detail
- [x] ✅ Create `GET /api/v1/customers/:id` endpoint
- [x] ✅ Verify customer belongs to current business
- [x] ✅ Write unit tests (customers.test.ts)

### 2.4 Update Customer
- [x] ✅ Create `PUT /api/v1/customers/:id` endpoint
- [x] ✅ Validate input
- [x] ✅ Log changes in activity timeline
- [x] ✅ Write unit tests (customers.test.ts)

### 2.5 Archive Customer
- [x] ✅ Create `PUT /api/v1/customers/:id/archive` endpoint
- [x] ✅ Set status to 'archived'
- [x] ✅ Log in audit trail
- [x] ✅ Write unit tests (customers.test.ts)

### 2.6 Anonymize Customer (GDPR)
- [x] ✅ Create `POST /api/v1/customers/:id/anonymize` endpoint
- [x] ✅ Replace PII with "[deleted]" (name, email, phone, DOB, etc.)
- [x] ✅ Delete notes content
- [x] ✅ Set status to 'anonymized', record who/when
- [x] ✅ Log in audit trail
- [x] ✅ Write unit tests (customers.test.ts)

---

## 3. Customer Notes

### 3.1 Note Categories
- [x] ✅ Create `GET /api/v1/customers/note-categories/list` endpoint
- [x] ✅ Create `POST /api/v1/customers/note-categories` endpoint
- [x] ✅ Support is_sensitive, customer_visible, display_order
- [x] ✅ Write unit tests (customer-notes.test.ts)

### 3.2 Notes CRUD
- [x] ✅ Create `POST /api/v1/customers/:id/notes` endpoint
- [x] ✅ Encrypt note content before storage (AES-256-GCM)
- [x] ✅ Validate category exists for business
- [x] ✅ Create `GET /api/v1/customers/:id/notes` endpoint
- [x] ✅ Decrypt on read, check role access for sensitive notes
- [x] ✅ Log access to sensitive notes in audit trail
- [x] ✅ Write unit tests (customer-notes.test.ts)

---

## 4. Tags

### 4.1 Tag Management
- [x] ✅ Create `GET /api/v1/customers/tags/list` endpoint (list business tags)
- [x] ✅ Create `POST /api/v1/customers/tags` endpoint (create tag with name/color)
- [x] ✅ Create `PUT /api/v1/customers/tags/:id` endpoint (update)
- [x] ✅ Create `DELETE /api/v1/customers/tags/:id` endpoint (delete)
- [x] ✅ Write unit tests (customer-tags.test.ts)

### 4.2 Tag Assignment
- [x] ✅ Create `POST /api/v1/customers/:id/tags` endpoint (assign tag)
- [x] ✅ Create `DELETE /api/v1/customers/:id/tags/:tagId` endpoint (remove)
- [x] ✅ Log tag changes in activity timeline
- [x] ✅ Write unit tests (customer-tags.test.ts)

---

## 5. Activity Timeline

### 5.1 Timeline Service
- [x] ✅ Create `createActivity()` service function
- [x] ✅ Support all activity types (booking, payment, membership, note, profile_change, lifecycle, communication)
- [x] ✅ Store metadata as JSONB

### 5.2 Timeline API
- [x] ✅ Create `GET /api/v1/customers/:id/activities` endpoint
- [x] ✅ Support filtering by activity_type
- [x] ✅ Support date range filtering
- [x] ✅ Paginate results (most recent first)
- [x] ✅ Write unit tests (customer-activities.test.ts)

---

## 6. Lifecycle Tracking

### 6.1 Lifecycle Service
- [x] ✅ Create lifecycle transition service
- [x] ✅ Implement configurable transition rules (read from business_configurations)
- [x] ✅ Trigger transitions on: booking creation, attendance, membership purchase
- [x] ✅ Log transitions in activity timeline

### 6.2 Lifecycle API
- [x] ✅ Create `PUT /api/v1/customers/:id/lifecycle` endpoint (manual override)
- [x] ✅ Create `GET /api/v1/customers/lifecycle-summary` endpoint (counts per stage)
- [x] ✅ Write unit tests

### 6.3 Scheduled Transitions
- [x] ✅ Create scheduled job to evaluate At-Risk and Churned transitions
- [x] ✅ Check last activity date against configured thresholds
- [x] ✅ Batch process customers per business

---

## 7. Segmentation Engine

### 7.1 Segment CRUD
- [x] ✅ Create `GET /api/v1/segments` endpoint (list saved segments)
- [x] ✅ Create `POST /api/v1/segments` endpoint (create with rules)
- [x] ✅ Create `DELETE /api/v1/segments/:id` endpoint
- [x] ✅ Seed predefined segments per business

### 7.2 Segment Evaluation
- [x] ✅ Create `GET /api/v1/segments/:id/members` endpoint
- [x] ✅ Build dynamic SQL from segment rules
- [x] ✅ Support rule operators (eq, neq, gt, lt, in, between, contains)
- [x] ✅ Support AND/OR logic
- [x] ✅ Return members + count
- [x] ✅ Write unit tests for rule evaluation

---

## 8. Import/Export

### 8.1 CSV Import
- [x] ✅ Create `POST /api/v1/customers/import/validate` endpoint (dry-run)
- [x] ✅ Create `POST /api/v1/customers/import` endpoint (execute)
- [x] ✅ Parse CSV, validate each row against schema
- [x] ✅ Report errors with row numbers and field details
- [x] ✅ Support column mapping (frontend sends mapping)
- [x] ✅ Log import in audit trail
- [x] ✅ Write unit tests

### 8.2 CSV Export
- [x] ✅ Create `GET /api/v1/customers/export` endpoint
- [x] ✅ Support filtering (export subset or all)
- [x] ✅ Generate CSV with configurable columns
- [x] ✅ Support GDPR export format (JSON with all personal data)
- [x] ✅ Write unit tests

---

## 9. Duplicate Detection

### 9.1 Detection
- [x] ✅ Create duplicate check logic (email match, phone match, name similarity)
- [x] ✅ Run on customer creation
- [x] ✅ Return potential matches in API response

### 9.2 Merge
- [x] ✅ Create `POST /api/v1/customers/merge` endpoint
- [x] ✅ Accept primary and secondary customer IDs
- [x] ✅ Accept field selection (which profile data to keep)
- [x] ✅ Reassign all activities, notes, tags to primary
- [x] ✅ Delete secondary customer
- [x] ✅ Log merge in audit trail
- [x] ✅ Write unit tests

---

## 10. Communication Preferences

### 10.1 Preferences API
- [x] ✅ Create `GET /api/v1/customers/:id/preferences` endpoint
- [x] ✅ Create `PUT /api/v1/customers/:id/preferences` endpoint
- [x] ✅ Default all marketing to opted-out
- [x] ✅ Log changes in audit trail
- [x] ✅ Write unit tests

---

## 11. Customer Portal (Customer-facing)

### 11.1 Self-Service API
- [x] ✅ Create `GET /api/v1/profile/customer` endpoint (customer views own profile)
- [x] ✅ Create `PUT /api/v1/profile/customer` endpoint (update contact info)
- [x] ✅ Create `GET /api/v1/profile/customer/notes` endpoint (visible notes only)
- [x] ✅ Create `GET /api/v1/profile/customer/activities` endpoint (own timeline)
- [x] ✅ Create `POST /api/v1/profile/customer/export` endpoint (GDPR data export)
- [x] ✅ Create `POST /api/v1/profile/customer/delete` endpoint (GDPR deletion request)
- [x] ✅ Restrict access to customer persona only
- [x] ✅ Write unit tests

---

## 12. Frontend

### 12.1 Customer List Page
- [x] ✅ Create `/customers` page with Table component
- [x] ✅ Implement search bar with debounced full-text search
- [x] ✅ Implement filter panel (lifecycle, tags, date ranges)
- [x] ✅ Show lifecycle badge, tags on each row
- [x] ✅ Add Customer button → create form
- [x] ✅ Bulk actions (tag, export, archive)

### 12.2 Customer Detail Page
- [x] ✅ Create `/customers/:id` page
- [x] ✅ Profile header (avatar, name, reference number, lifecycle badge)
- [x] ✅ Tabs: Overview, Notes, Timeline, Preferences
- [x] ✅ Overview tab: contact info, custom fields, tags
- [x] ✅ Notes tab: categorized notes, add note form
- [x] ✅ Timeline tab: paginated activity feed with type filter
- [x] ✅ Preferences tab: communication toggles

### 12.3 Segments Page
- [x] ✅ Create `/customers/segments` page
- [x] ✅ List saved segments with member counts
- [x] ✅ Create segment form with rule builder
- [x] ✅ View segment members

### 12.4 Import Page
- [x] ✅ Create `/customers/import` page
- [x] ✅ File upload step
- [x] ✅ Column mapping step
- [x] ✅ Validation results step
- [x] ✅ Confirm/execute step

---

## 13. Testing

### 13.1 Unit Tests
- [x] ✅ Test customer CRUD (create, read, update, archive, anonymize)
- [x] ✅ Test business scoping (cannot access other business's customers)
- [x] ✅ Test note encryption/decryption
- [x] ✅ Test tag assignment/removal
- [x] ✅ Test lifecycle transitions (all state changes)
- [x] ✅ Test segment rule evaluation (all operators, AND/OR)
- [x] ✅ Test duplicate detection (email, phone, name)
- [x] ✅ Test CSV import validation (valid, invalid, dry-run)
- [x] ✅ Test reference number generation

### 13.2 Integration Tests
- [x] ✅ Test full customer lifecycle (create → book → active → at-risk → churned)
- [x] ✅ Test GDPR anonymization (verify PII removed, transactions retained)
- [x] ✅ Test CSV import end-to-end (upload → validate → confirm)
- [x] ✅ Test customer portal self-service (view, update, export, delete request)
- [x] ✅ Test search performance with 1000+ customers
