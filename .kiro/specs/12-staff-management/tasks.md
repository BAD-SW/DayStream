# Phase 12: Staff Management - Tasks

## Overview

Implementation tasks for the staff management module — database schema, staff profiles, qualifications, availability patterns, overrides, leave management, service/location assignment, capacity, calendar APIs, notifications, self-service portal, public directory, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `staff_profiles` table
- [x] ✅ Create migration for `staff_qualifications` table
- [x] ✅ Create migration for `service_qualification_requirements` table
- [x] ✅ Create migration for `availability_patterns` and `availability_pattern_slots` tables
- [x] ✅ Create migration for `availability_overrides` table
- [x] ✅ Create migration for `leave_requests` and `leave_balances` tables
- [x] ✅ Create migration for `staff_service_assignments` table
- [x] ✅ Create migration for `staff_location_assignments` table
- [x] ✅ Create migration for `staff_capacity_config` and `staff_capacity_overrides` tables
- [x] ✅ Create migration for `staff_notification_preferences` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, status, dates, foreign keys)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Staff Profile CRUD

### 2.1 Profile Service
- [x] ✅ Create `staff.service.ts` with list/create/get/update methods
- [x] ✅ Implement auto-generated staff reference number (STF-001 per tenant)
- [x] ✅ Support filtering by status, employment type, location, search
- [x] ✅ Support deactivation (soft-delete, preserve history)
- [x] ✅ Link staff profile to user account (optional)
- [x] ✅ Write tests

### 2.2 Profile Photo Upload
- [x] ✅ Implement profile photo upload via storage service
- [x] ✅ Support photo deletion/replacement
- [x] ✅ Write tests

### 2.3 Routes
- [x] ✅ Create `GET /api/v1/staff` endpoint
- [x] ✅ Create `POST /api/v1/staff` endpoint
- [x] ✅ Create `GET /api/v1/staff/:id` endpoint
- [x] ✅ Create `PUT /api/v1/staff/:id` endpoint
- [x] ✅ Create `PUT /api/v1/staff/:id/deactivate` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/photo` endpoint

---

## 3. Qualifications and Certifications

### 3.1 Qualifications CRUD
- [x] ✅ Create `staff-qualifications.service.ts`
- [x] ✅ Support add/update/delete qualifications per staff
- [x] ✅ Support document upload for certifications
- [x] ✅ Implement expiry detection (configurable: 30/60/90 days)
- [x] ✅ Create expiring certifications report endpoint
- [x] ✅ Write tests

### 3.2 Qualification-to-Service Linking
- [x] ✅ Create `service_qualification_requirements` CRUD
- [x] ✅ Validate qualifications when assigning staff to services
- [x] ✅ Prevent assignment if mandatory qualification missing or expired
- [x] ✅ Write tests

### 3.3 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/qualifications` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/qualifications` endpoint
- [x] ✅ Create `PUT /api/v1/staff/:id/qualifications/:qid` endpoint
- [x] ✅ Create `DELETE /api/v1/staff/:id/qualifications/:qid` endpoint
- [x] ✅ Create `GET /api/v1/staff/qualifications/expiring` endpoint

---

## 4. Availability Patterns

### 4.1 Pattern Service
- [x] ✅ Create `staff-availability.service.ts`
- [x] ✅ Support create/update/delete patterns with time slots
- [x] ✅ Support multiple patterns with effective date ranges
- [x] ✅ Support per-location patterns
- [x] ✅ Support pattern duplication (copy)
- [x] ✅ Write tests

### 4.2 Effective Availability Resolver
- [x] ✅ Implement `getEffectiveAvailability(staffId, date, locationId?)` algorithm
- [x] ✅ Resolve active pattern for date (most specific match)
- [x] ✅ Return time blocks for the day of week
- [x] ✅ Integrate with Booking Engine slot calculator
- [x] ✅ Write tests

### 4.3 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/availability/patterns` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/availability/patterns` endpoint
- [x] ✅ Create `PUT /api/v1/staff/:id/availability/patterns/:pid` endpoint
- [x] ✅ Create `DELETE /api/v1/staff/:id/availability/patterns/:pid` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/availability/patterns/:pid/copy` endpoint
- [x] ✅ Create `GET /api/v1/staff/:id/availability` endpoint (resolved for date range)

---

## 5. Availability Overrides

### 5.1 Override Service
- [x] ✅ Implement create/delete overrides
- [x] ✅ Support override types: add, remove, modify
- [x] ✅ Integrate overrides into effective availability resolver
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/availability/overrides` endpoint (date range filter)
- [x] ✅ Create `POST /api/v1/staff/:id/availability/overrides` endpoint
- [x] ✅ Create `DELETE /api/v1/staff/:id/availability/overrides/:oid` endpoint

---

## 6. Leave Management

### 6.1 Leave Service
- [x] ✅ Create `staff-leave.service.ts`
- [x] ✅ Support submit/approve/reject/cancel workflow
- [x] ✅ Check for conflicting bookings on leave dates (warning on approve)
- [x] ✅ Integrate approved leave into availability resolver (block dates)
- [x] ✅ Write tests

### 6.2 Leave Balances
- [x] ✅ Support configurable leave balance tracking per tenant
- [x] ✅ Deduct from balance on approval, restore on cancellation
- [x] ✅ Year-based balance tracking
- [x] ✅ Write tests

### 6.3 Routes
- [x] ✅ Create `GET /api/v1/staff/leave` endpoint (list, filterable by status/staff/dates)
- [x] ✅ Create `POST /api/v1/staff/:id/leave` endpoint
- [x] ✅ Create `PUT /api/v1/staff/leave/:lid/approve` endpoint
- [x] ✅ Create `PUT /api/v1/staff/leave/:lid/reject` endpoint
- [x] ✅ Create `PUT /api/v1/staff/leave/:lid/cancel` endpoint
- [x] ✅ Create `GET /api/v1/staff/:id/leave/balance` endpoint

---

## 7. Service Assignment

### 7.1 Assignment Service
- [x] ✅ Create `staff-assignments.service.ts`
- [x] ✅ Support assigning staff to services (with optional variant)
- [x] ✅ Support primary designation per service
- [x] ✅ Support bulk assignment (multiple services at once)
- [x] ✅ Validate qualification requirements on assignment
- [x] ✅ Filter availability in Booking Engine by service assignment
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/services` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/services` endpoint (bulk)
- [x] ✅ Create `DELETE /api/v1/staff/:id/services/:sid` endpoint

---

## 8. Location Assignment

### 8.1 Location Assignment Service
- [x] ✅ Support assigning staff to locations
- [x] ✅ Support primary location designation
- [x] ✅ Scope availability by location in resolver
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/locations` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/locations` endpoint
- [x] ✅ Create `DELETE /api/v1/staff/:id/locations/:lid` endpoint

---

## 9. Capacity Management

### 9.1 Capacity Service
- [x] ✅ Create `staff-capacity.service.ts`
- [x] ✅ Support max bookings per day and per week configuration
- [x] ✅ Support max consecutive hours configuration
- [x] ✅ Enforce capacity limits in availability engine
- [x] ✅ Support manager override for specific dates (with audit)
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/capacity` endpoint
- [x] ✅ Create `PUT /api/v1/staff/:id/capacity` endpoint
- [x] ✅ Create `POST /api/v1/staff/:id/capacity/override` endpoint

---

## 10. Staff Calendar and Schedule

### 10.1 Calendar Service
- [x] ✅ Create `staff-calendar.service.ts`
- [x] ✅ Aggregate bookings, availability, leave, and overrides for date range
- [x] ✅ Support day/week/month views
- [x] ✅ Support team view (all staff for a date range)
- [x] ✅ Support filtering team view by location, service, staff
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/staff/:id/calendar` endpoint (date range, view type)
- [x] ✅ Create `GET /api/v1/staff/calendar/team` endpoint

---

## 11. Staff Notifications

### 11.1 Notification Service
- [x] ✅ Create `staff-notifications.service.ts`
- [x] ✅ Implement notification routing by event type and staff preferences
- [x] ✅ Support email channel (via existing email service)
- [x] ✅ Support in-app channel (store in notifications table)
- [x] ✅ Trigger on: new booking, cancellation, leave status, schedule change
- [x] ✅ Trigger certification expiry alerts (30/60/90 days)
- [x] ✅ Write tests

### 11.2 Notification Preferences
- [x] ✅ Create preferences CRUD (per event type, per channel)
- [x] ✅ Create `GET /api/v1/staff/me/notifications/preferences` endpoint
- [x] ✅ Create `PUT /api/v1/staff/me/notifications/preferences` endpoint

---

## 12. Staff Self-Service Portal

### 12.1 Self-Service API
- [x] ✅ Create `GET /api/v1/staff/me` endpoint (own profile)
- [x] ✅ Create `PUT /api/v1/staff/me` endpoint (update bio, photo, contact)
- [x] ✅ Create `GET /api/v1/staff/me/calendar` endpoint
- [x] ✅ Create `GET /api/v1/staff/me/metrics` endpoint (sessions, revenue)
- [x] ✅ Scope access via RBAC — cannot modify other staff or capacity/assignments
- [x] ✅ Write tests

---

## 13. Public Staff Directory

### 13.1 Directory API
- [x] ✅ Create `GET /api/v1/staff/directory` endpoint (no auth required)
- [x] ✅ Return only staff with show_on_directory = true and status = active
- [x] ✅ Include: name, photo, bio, languages, qualifications (if enabled)
- [x] ✅ Support filtering by service and location
- [x] ✅ Respect tenant configuration for visible fields
- [x] ✅ Write tests

---

## 14. Frontend

### 14.1 Staff List Page
- [x] ✅ Create `/staff` page with paginated list
- [x] ✅ Add search, filters (status, employment type, location)
- [x] ✅ Add "Create Staff" button and form

### 14.2 Staff Detail Page
- [x] ✅ Create `/staff/:id` page with tabbed layout
- [x] ✅ Profile tab (info, photo, deactivate)
- [x] ✅ Qualifications tab (list, add, edit, delete, document upload)
- [x] ✅ Availability tab (pattern editor, overrides calendar)
- [x] ✅ Services & locations tab (assignments, bulk add)
- [x] ✅ Calendar tab (bookings, leave, availability view)
- [x] ✅ Capacity tab (config, override history)

### 14.3 Leave Management Page
- [x] ✅ Create `/staff/leave` page
- [x] ✅ Pending requests queue with approve/reject actions
- [x] ✅ Team leave calendar view
- [x] ✅ Balance tracker per staff

### 14.4 Team Calendar Page
- [x] ✅ Create `/staff/calendar` page
- [x] ✅ Side-by-side staff schedule (day/week view)
- [x] ✅ Color-coded entries (bookings, available, leave, blocked)
- [x] ✅ Location/service filters

### 14.5 Self-Service Page
- [x] ✅ Create `/staff/me` page
- [x] ✅ Own schedule, leave request form, override editor
- [x] ✅ Profile editor (bio, photo, contact)
- [x] ✅ Performance metrics display

### 14.6 Public Directory
- [x] ✅ Create public directory component (customer-facing)
- [x] ✅ Staff cards with photo, name, bio
- [x] ✅ Filter by service, location
- [x] ✅ "Book with" CTA linking to booking flow

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test staff profile CRUD (create, update, deactivate, search)
- [x] ✅ Test qualification management and expiry detection
- [x] ✅ Test qualification-to-service validation
- [x] ✅ Test availability pattern resolution (single pattern, multiple, effective dates)
- [x] ✅ Test availability overrides (add, remove, modify)
- [x] ✅ Test leave workflow (submit, approve, reject, cancel, balance)
- [x] ✅ Test capacity enforcement (daily, weekly, consecutive hours)
- [x] ✅ Test service/location assignment with qualification validation
- [x] ✅ Test public directory filtering

### 15.2 Integration Tests
- [x] ✅ Test full availability flow (pattern + override + leave → resolved slots)
- [x] ✅ Test booking engine integration (staff availability feeds slot calculation)
- [x] ✅ Test leave approval with conflicting bookings (warning)
- [x] ✅ Test capacity limit blocking further bookings
- [x] ✅ Test self-service portal access control (can edit own, cannot edit others)
- [x] ✅ Test tenant scoping (staff isolated per tenant)
