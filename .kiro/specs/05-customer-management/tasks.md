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
- [ ] Create `POST /api/v1/customers` endpoint
- [ ] Validate input with Joi (required fields, email format, phone format)
- [ ] Check for duplicate email within business
- [ ] Generate reference number
- [ ] Associate with current business context
- [ ] Return duplicate warning if potential matches found
- [ ] Log creation in audit trail
- [ ] Write unit tests

### 2.2 List/Search Customers
- [ ] Create `GET /api/v1/customers` endpoint
- [ ] Support full-text search query parameter
- [ ] Support filter parameters (lifecycle_stage, tag_ids, date ranges)
- [ ] Support pagination (page, limit, sort, order)
- [ ] Scope results to current business
- [ ] Write unit tests

### 2.3 Get Customer Detail
- [ ] Create `GET /api/v1/customers/:id` endpoint
- [ ] Include tags, lifecycle stage, preferences
- [ ] Verify customer belongs to current business
- [ ] Write unit tests

### 2.4 Update Customer
- [ ] Create `PUT /api/v1/customers/:id` endpoint
- [ ] Validate input
- [ ] Log changes in activity timeline
- [ ] Write unit tests

### 2.5 Archive Customer
- [ ] Create `PUT /api/v1/customers/:id/archive` endpoint
- [ ] Set status to 'archived'
- [ ] Log in audit trail
- [ ] Write unit tests

### 2.6 Anonymize Customer (GDPR)
- [ ] Create `POST /api/v1/customers/:id/anonymize` endpoint
- [ ] Replace PII with "[deleted]" (name, email, phone, DOB, etc.)
- [ ] Delete notes content
- [ ] Retain financial transaction IDs (no amounts/details)
- [ ] Set status to 'anonymized', record who/when
- [ ] Log in audit trail
- [ ] Write unit tests

---

## 3. Customer Notes

### 3.1 Note Categories
- [ ] Create `GET /api/v1/businesses/:id/note-categories` endpoint
- [ ] Create `POST /api/v1/businesses/:id/note-categories` endpoint
- [ ] Support is_sensitive, customer_visible, display_order
- [ ] Write unit tests

### 3.2 Notes CRUD
- [ ] Create `POST /api/v1/customers/:id/notes` endpoint
- [ ] Encrypt note content before storage (AES-256-GCM)
- [ ] Validate category exists for business
- [ ] Create `GET /api/v1/customers/:id/notes` endpoint
- [ ] Decrypt on read, check role access for sensitive notes
- [ ] Log access to sensitive notes in audit trail
- [ ] Write unit tests

---

## 4. Tags

### 4.1 Tag Management
- [ ] Create `GET /api/v1/tags` endpoint (list business tags)
- [ ] Create `POST /api/v1/tags` endpoint (create tag with name/color)
- [ ] Create `PUT /api/v1/tags/:id` endpoint (update)
- [ ] Create `DELETE /api/v1/tags/:id` endpoint (delete)
- [ ] Write unit tests

### 4.2 Tag Assignment
- [ ] Create `POST /api/v1/customers/:id/tags` endpoint (assign tag)
- [ ] Create `DELETE /api/v1/customers/:id/tags/:tagId` endpoint (remove)
- [ ] Log tag changes in activity timeline
- [ ] Write unit tests

---

## 5. Activity Timeline

### 5.1 Timeline Service
- [ ] Create `createActivity()` service function
- [ ] Support all activity types (booking, payment, membership, note, profile_change, lifecycle, communication)
- [ ] Store metadata as JSONB

### 5.2 Timeline API
- [ ] Create `GET /api/v1/customers/:id/activities` endpoint
- [ ] Support filtering by activity_type
- [ ] Support date range filtering
- [ ] Paginate results (most recent first)
- [ ] Write unit tests

---

## 6. Lifecycle Tracking

### 6.1 Lifecycle Service
- [ ] Create lifecycle transition service
- [ ] Implement configurable transition rules (read from business_configurations)
- [ ] Trigger transitions on: booking creation, attendance, membership purchase
- [ ] Log transitions in activity timeline

### 6.2 Lifecycle API
- [ ] Create `PUT /api/v1/customers/:id/lifecycle` endpoint (manual override)
- [ ] Create `GET /api/v1/customers/lifecycle-summary` endpoint (counts per stage)
- [ ] Write unit tests

### 6.3 Scheduled Transitions
- [ ] Create scheduled job to evaluate At-Risk and Churned transitions
- [ ] Check last activity date against configured thresholds
- [ ] Batch process customers per business

---

## 7. Segmentation Engine

### 7.1 Segment CRUD
- [ ] Create `GET /api/v1/segments` endpoint (list saved segments)
- [ ] Create `POST /api/v1/segments` endpoint (create with rules)
- [ ] Create `DELETE /api/v1/segments/:id` endpoint
- [ ] Seed predefined segments per business

### 7.2 Segment Evaluation
- [ ] Create `GET /api/v1/segments/:id/members` endpoint
- [ ] Build dynamic SQL from segment rules
- [ ] Support rule operators (eq, neq, gt, lt, in, between, contains)
- [ ] Support AND/OR logic
- [ ] Return members + count
- [ ] Write unit tests for rule evaluation

---

## 8. Import/Export

### 8.1 CSV Import
- [ ] Create `POST /api/v1/customers/import/validate` endpoint (dry-run)
- [ ] Create `POST /api/v1/customers/import` endpoint (execute)
- [ ] Parse CSV, validate each row against schema
- [ ] Report errors with row numbers and field details
- [ ] Support column mapping (frontend sends mapping)
- [ ] Log import in audit trail
- [ ] Write unit tests

### 8.2 CSV Export
- [ ] Create `GET /api/v1/customers/export` endpoint
- [ ] Support filtering (export subset or all)
- [ ] Generate CSV with configurable columns
- [ ] Support GDPR export format (JSON with all personal data)
- [ ] Write unit tests

---

## 9. Duplicate Detection

### 9.1 Detection
- [ ] Create duplicate check logic (email match, phone match, name similarity)
- [ ] Run on customer creation
- [ ] Return potential matches in API response

### 9.2 Merge
- [ ] Create `POST /api/v1/customers/merge` endpoint
- [ ] Accept primary and secondary customer IDs
- [ ] Accept field selection (which profile data to keep)
- [ ] Reassign all activities, notes, tags to primary
- [ ] Delete secondary customer
- [ ] Log merge in audit trail
- [ ] Write unit tests

---

## 10. Communication Preferences

### 10.1 Preferences API
- [ ] Create `GET /api/v1/customers/:id/preferences` endpoint
- [ ] Create `PUT /api/v1/customers/:id/preferences` endpoint
- [ ] Default all marketing to opted-out
- [ ] Log changes in audit trail
- [ ] Write unit tests

---

## 11. Customer Portal (Customer-facing)

### 11.1 Self-Service API
- [ ] Create `GET /api/v1/profile/customer` endpoint (customer views own profile)
- [ ] Create `PUT /api/v1/profile/customer` endpoint (update contact info)
- [ ] Create `GET /api/v1/profile/customer/notes` endpoint (visible notes only)
- [ ] Create `GET /api/v1/profile/customer/activities` endpoint (own timeline)
- [ ] Create `POST /api/v1/profile/customer/export` endpoint (GDPR data export)
- [ ] Create `POST /api/v1/profile/customer/delete` endpoint (GDPR deletion request)
- [ ] Restrict access to customer persona only
- [ ] Write unit tests

---

## 12. Frontend

### 12.1 Customer List Page
- [ ] Create `/customers` page with Table component
- [ ] Implement search bar with debounced full-text search
- [ ] Implement filter panel (lifecycle, tags, date ranges)
- [ ] Show lifecycle badge, tags on each row
- [ ] Add Customer button → create form
- [ ] Bulk actions (tag, export, archive)

### 12.2 Customer Detail Page
- [ ] Create `/customers/:id` page
- [ ] Profile header (avatar, name, reference number, lifecycle badge)
- [ ] Tabs: Overview, Notes, Timeline, Preferences
- [ ] Overview tab: contact info, custom fields, tags
- [ ] Notes tab: categorized notes, add note form
- [ ] Timeline tab: paginated activity feed with type filter
- [ ] Preferences tab: communication toggles

### 12.3 Segments Page
- [ ] Create `/customers/segments` page
- [ ] List saved segments with member counts
- [ ] Create segment form with rule builder
- [ ] View segment members

### 12.4 Import Page
- [ ] Create `/customers/import` page
- [ ] File upload step
- [ ] Column mapping step
- [ ] Validation results step
- [ ] Confirm/execute step

---

## 13. Testing

### 13.1 Unit Tests
- [ ] Test customer CRUD (create, read, update, archive, anonymize)
- [ ] Test business scoping (cannot access other business's customers)
- [ ] Test note encryption/decryption
- [ ] Test tag assignment/removal
- [ ] Test lifecycle transitions (all state changes)
- [ ] Test segment rule evaluation (all operators, AND/OR)
- [ ] Test duplicate detection (email, phone, name)
- [ ] Test CSV import validation (valid, invalid, dry-run)
- [ ] Test reference number generation

### 13.2 Integration Tests
- [ ] Test full customer lifecycle (create → book → active → at-risk → churned)
- [ ] Test GDPR anonymization (verify PII removed, transactions retained)
- [ ] Test CSV import end-to-end (upload → validate → confirm)
- [ ] Test customer portal self-service (view, update, export, delete request)
- [ ] Test search performance with 1000+ customers
