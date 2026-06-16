# Phase 13: Resource Management - Tasks

## Overview

Implementation tasks for the resource management module — database schema, resource CRUD, types/categories, scheduling, service linking, conflict prevention, capacity, maintenance windows, calendar, utilization tracking, dependencies, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `resource_types` table
- [x] ✅ Create migration for `resources` table
- [x] ✅ Create migration for `resource_schedules` and `resource_schedule_slots` tables
- [x] ✅ Create migration for `resource_schedule_blocks` table
- [x] ✅ Create migration for `resource_bookings` table
- [x] ✅ Create migration for `service_resource_requirements` table
- [x] ✅ Create migration for `resource_dependencies` table
- [x] ✅ Create migration for `resource_maintenance` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, type, location, time ranges)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Resource Types and Categories

### 2.1 Resource Types CRUD
- [x] ✅ Create `resource-types.service.ts`
- [x] ✅ Seed default types (Room, Equipment, Facility variants)
- [x] ✅ Support custom type creation per tenant
- [x] ✅ Support type update and delete (prevent if resources exist)
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `GET /api/v1/resources/types` endpoint
- [x] ✅ Create `POST /api/v1/resources/types` endpoint
- [x] ✅ Create `PUT /api/v1/resources/types/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/resources/types/:id` endpoint

---

## 3. Resource CRUD

### 3.1 Resource Service
- [x] ✅ Create `resource.service.ts` with list/create/get/update methods
- [x] ✅ Support filtering by type, location, status, search
- [x] ✅ Support deactivation (soft-delete, preserve bookings)
- [x] ✅ Support custom attributes (JSONB)
- [x] ✅ Support photo upload via storage service
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `GET /api/v1/resources` endpoint
- [x] ✅ Create `POST /api/v1/resources` endpoint
- [x] ✅ Create `GET /api/v1/resources/:id` endpoint
- [x] ✅ Create `PUT /api/v1/resources/:id` endpoint
- [x] ✅ Create `PUT /api/v1/resources/:id/deactivate` endpoint
- [x] ✅ Create `POST /api/v1/resources/:id/photo` endpoint

---

## 4. Resource Scheduling

### 4.1 Schedule Service
- [x] ✅ Create `resource-schedule.service.ts`
- [x] ✅ Support weekly operating hours (recurring slots per day)
- [x] ✅ Support multiple schedules with effective date ranges
- [x] ✅ Support 24/7 option (bypass hour checks)
- [x] ✅ Support date blocks (holidays, closures)
- [x] ✅ Resolve effective schedule for a given date
- [x] ✅ Write tests

### 4.2 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/schedule` endpoint
- [x] ✅ Create `POST /api/v1/resources/:id/schedule` endpoint
- [x] ✅ Create `PUT /api/v1/resources/:id/schedule/:sid` endpoint
- [x] ✅ Create `GET /api/v1/resources/:id/schedule/blocks` endpoint
- [x] ✅ Create `POST /api/v1/resources/:id/schedule/blocks` endpoint
- [x] ✅ Create `DELETE /api/v1/resources/:id/schedule/blocks/:bid` endpoint

---

## 5. Service-to-Resource Linking

### 5.1 Requirements Service
- [x] ✅ Create `resource-requirements.service.ts`
- [x] ✅ Support linking resources to services (required/preferred)
- [x] ✅ Support "any of type" assignments
- [x] ✅ Support per-variant requirements
- [x] ✅ Support buffer time override on the link
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/resources/service-requirements/:serviceId` endpoint
- [x] ✅ Create `POST /api/v1/resources/service-requirements` endpoint
- [x] ✅ Create `PUT /api/v1/resources/service-requirements/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/resources/service-requirements/:id` endpoint

---

## 6. Resource Availability and Conflict Prevention

### 6.1 Availability Engine
- [x] ✅ Create `resource-availability.service.ts`
- [x] ✅ Implement `isResourceAvailable(resourceId, startTime, endTime)` algorithm
- [x] ✅ Check operating hours, date blocks, maintenance windows
- [x] ✅ Check capacity (count overlapping bookings vs capacity)
- [x] ✅ Check buffer/turnaround time between bookings
- [x] ✅ Implement `findAvailableResource(serviceId, variantId, startTime, endTime, locationId)`
- [x] ✅ Resolve "any of type" by finding first available matching resource
- [x] ✅ Support preferred vs required logic
- [x] ✅ Write tests

### 6.2 Conflict Prevention
- [x] ✅ Use FOR UPDATE NOWAIT for race condition prevention
- [x] ✅ Implement retry with backoff on lock contention
- [x] ✅ Return clear conflict errors with alternative suggestions
- [x] ✅ Re-validate at booking confirmation time
- [x] ✅ Write tests

### 6.3 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/availability` endpoint (date range check)
- [x] ✅ Create `POST /api/v1/resources/find-available` endpoint

---

## 7. Resource Bookings

### 7.1 Booking Service
- [x] ✅ Create `resource-bookings.service.ts`
- [x] ✅ Support creating resource bookings (service, maintenance, manual, hold)
- [x] ✅ Support cancelling resource bookings
- [x] ✅ Auto-create resource bookings when service bookings are confirmed
- [x] ✅ Auto-cancel resource bookings when service bookings are cancelled
- [x] ✅ Resolve and reserve dependencies in same transaction
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/bookings` endpoint (date range filter)
- [x] ✅ Create `POST /api/v1/resources/:id/bookings` endpoint (manual booking)
- [x] ✅ Create `DELETE /api/v1/resources/:id/bookings/:bid` endpoint

---

## 8. Capacity Management

### 8.1 Shared Resources
- [x] ✅ Enforce capacity limits during availability checks
- [x] ✅ Allow multiple bookings up to capacity for shared resources
- [x] ✅ Block further bookings when capacity reached
- [x] ✅ Expose remaining capacity in availability response
- [x] ✅ Support capacity overrides per time slot
- [x] ✅ Write tests

---

## 9. Maintenance Windows

### 9.1 Maintenance Service
- [x] ✅ Create `resource-maintenance.service.ts`
- [x] ✅ Support recurring maintenance (day/time weekly)
- [x] ✅ Support one-time maintenance (specific date/time)
- [x] ✅ Integrate maintenance into availability checks
- [x] ✅ Display maintenance on resource calendar
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/maintenance` endpoint
- [x] ✅ Create `POST /api/v1/resources/:id/maintenance` endpoint
- [x] ✅ Create `DELETE /api/v1/resources/:id/maintenance/:mid` endpoint

---

## 10. Resource Dependencies

### 10.1 Dependencies Service
- [x] ✅ Create `resource-dependencies.service.ts`
- [x] ✅ Support defining resource dependencies (with time offset and duration)
- [x] ✅ Auto-reserve dependent resources during booking
- [x] ✅ Auto-release on cancellation
- [x] ✅ Validate all dependencies available before confirming
- [x] ✅ Prevent circular dependencies
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/dependencies` endpoint
- [x] ✅ Create `POST /api/v1/resources/:id/dependencies` endpoint
- [x] ✅ Create `DELETE /api/v1/resources/:id/dependencies/:did` endpoint

---

## 11. Resource Calendar

### 11.1 Calendar Service
- [x] ✅ Create `resource-calendar.service.ts`
- [x] ✅ Aggregate bookings, maintenance, and availability for date range
- [x] ✅ Support single resource calendar view
- [x] ✅ Support timeline view (all resources side-by-side)
- [x] ✅ Support filtering by type, location
- [x] ✅ Color-code entries (booked, maintenance, available, offline)
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `GET /api/v1/resources/:id/calendar` endpoint
- [x] ✅ Create `GET /api/v1/resources/calendar/timeline` endpoint

---

## 12. Utilization Tracking

### 12.1 Utilization Service
- [x] ✅ Create `resource-utilization.service.ts`
- [x] ✅ Calculate utilization rate (booked hours / available hours)
- [x] ✅ Report by day, week, month, custom range
- [x] ✅ Identify peak usage hours per resource
- [x] ✅ Identify underutilized resources (below threshold)
- [x] ✅ Identify over-utilized resources (at capacity)
- [x] ✅ Support comparison between resources of same type
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/resources/utilization` endpoint (all resources summary)
- [x] ✅ Create `GET /api/v1/resources/:id/utilization` endpoint (single resource detail)

---

## 13. Frontend

### 13.1 Resource List Page
- [x] ✅ Create `/resources` page with list grouped by type
- [x] ✅ Add filters (type, location, status)
- [x] ✅ Resource cards with photo, name, capacity, status
- [x] ✅ "Add Resource" button and type selector

### 13.2 Resource Detail Page
- [x] ✅ Create `/resources/:id` page with tabbed layout
- [x] ✅ Details tab (name, type, capacity, location, photo, custom attributes)
- [x] ✅ Schedule tab (weekly hours editor, date blocks)
- [x] ✅ Services tab (linked services with requirement type)
- [x] ✅ Maintenance tab (recurring + one-time schedules)
- [x] ✅ Dependencies tab (dependent resources)
- [x] ✅ Calendar tab (bookings and availability)
- [x] ✅ Utilization tab (charts and metrics)

### 13.3 Resource Calendar Page
- [x] ✅ Create `/resources/calendar` page
- [x] ✅ Timeline view (resources as rows, time as columns)
- [x] ✅ Day/week toggle
- [x] ✅ Color-coded entries
- [x] ✅ Filter by location, type
- [x] ✅ Click-to-book on available slots

### 13.4 Utilization Dashboard
- [x] ✅ Create `/resources/utilization` page
- [x] ✅ Overview cards (average utilization, peak hours, underutilized count)
- [x] ✅ Per-resource bar chart
- [x] ✅ Date range picker
- [x] ✅ Type comparison view

---

## 14. Testing

### 14.1 Unit Tests
- [x] ✅ Test resource CRUD (create, update, deactivate, filter)
- [x] ✅ Test resource type management (create, delete with protection)
- [x] ✅ Test schedule resolution (operating hours, date blocks)
- [x] ✅ Test availability algorithm (hours, blocks, maintenance, capacity, buffer)
- [x] ✅ Test conflict prevention (overlapping bookings, capacity limits)
- [x] ✅ Test service-resource linking (required, preferred, any-of-type)
- [x] ✅ Test maintenance windows (recurring, one-time)
- [x] ✅ Test resource dependencies (auto-reserve, auto-release)
- [x] ✅ Test utilization calculation

### 14.2 Integration Tests
- [x] ✅ Test full booking flow (service booking → resource auto-reserved)
- [x] ✅ Test conflict prevention under concurrent access (FOR UPDATE NOWAIT)
- [x] ✅ Test shared resource capacity (multiple bookings up to limit)
- [x] ✅ Test buffer enforcement (no back-to-back violations)
- [x] ✅ Test dependency chain (primary + dependents reserved together)
- [x] ✅ Test cancellation cascading (service cancel → resource released)
- [x] ✅ Test tenant scoping (resources isolated per tenant)
