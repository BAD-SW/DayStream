# Phase 07: Booking Engine - Tasks

## Overview

Implementation tasks for the booking engine — database schema, availability calculation, booking CRUD and lifecycle, slot holding, waitlist, recurring bookings, conflict detection, notifications, calendar views, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `bookings` table (with status, timing, booking_type, references)
- [x] ✅ Create migration for `booking_status_history` table
- [x] ✅ Create migration for `slot_holds` table (temporary reservations)
- [x] ✅ Create migration for `waitlist_entries` table
- [x] ✅ Create migration for `recurring_booking_series` table
- [x] ✅ Create migration for `staff_schedules` table (interface for Phase 12)
- [x] ✅ Create migration for `staff_time_off` table
- [x] ✅ Create migration for `notification_queue` table

### 1.2 Indexes and Constraints
- [x] ✅ Add composite indexes for time-range conflict queries (staff_id + time, resource_id + time)
- [x] ✅ Add RLS policies on all booking tables (business-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Add booking reference sequence function

### 1.3 Seed Data
- [x] ✅ Seed booking-related configuration_definitions (no_show_window, hold_duration, reminder_hours)

---

## 2. Availability Engine

### 2.1 Core Algorithm
- [x] ✅ Create availability service with slot generation logic
- [x] ✅ Load and intersect service availability rules
- [x] ✅ Load and intersect staff schedules (weekly patterns)
- [x] ✅ Exclude staff time off blocks
- [x] ✅ Exclude existing confirmed bookings
- [x] ✅ Exclude active slot holds
- [x] ✅ Apply buffer times between slots
- [x] ✅ Respect lead time (min advance booking hours)
- [x] ✅ Respect max advance booking days

### 2.2 Availability API
- [x] ✅ Create `GET /api/v1/bookings/availability` endpoint
- [x] ✅ Accept parameters: service_id, business_id, date_from, date_to, staff_id (optional)
- [x] ✅ Return available slots with staff info and capacity remaining
- [x] ✅ Cache results for 60 seconds (invalidate on booking/cancel)
- [x] ✅ Write unit tests (validate against known schedule scenarios)

---

## 3. Booking CRUD

### 3.1 Create Booking
- [x] ✅ Create `POST /api/v1/bookings` endpoint
- [x] ✅ Validate service, variant, customer, and time slot
- [x] ✅ Generate booking reference (BK-YYYY-NNNN)
- [x] ✅ Run conflict detection (staff, resource, customer)
- [x] ✅ Support all booking types (individual, shared, group, resource)
- [x] ✅ For shared/group: check capacity and update participant count
- [x] ✅ Log in audit trail and customer activity timeline
- [x] ✅ Trigger confirmation notification

### 3.2 List Bookings
- [x] ✅ Create `GET /api/v1/bookings` endpoint
- [x] ✅ Filter by: date range, status, customer_id, staff_id, service_id
- [x] ✅ Paginate results
- [x] ✅ Include customer name, service name, staff name in response

### 3.3 Get Booking Detail
- [x] ✅ Create `GET /api/v1/bookings/:id` endpoint
- [x] ✅ Include full booking data, status history, customer info

### 3.4 Staff-Initiated Booking
- [x] ✅ Support creating bookings on behalf of a customer
- [x] ✅ Allow overriding lead time rules (staff privilege)
- [x] ✅ Log staff identity in created_by

### 3.5 Write Unit Tests
- [x] ✅ Test individual booking creation
- [x] ✅ Test shared session booking (capacity management)
- [x] ✅ Test conflict detection (staff, resource, customer)
- [x] ✅ Test booking reference generation

---

## 4. Booking Lifecycle

### 4.1 Status Transitions
- [x] ✅ Create `PUT /api/v1/bookings/:id/confirm` endpoint
- [x] ✅ Create `PUT /api/v1/bookings/:id/cancel` endpoint (with reason, fee calculation)
- [x] ✅ Create `PUT /api/v1/bookings/:id/check-in` endpoint (Confirmed → In Progress)
- [x] ✅ Create `PUT /api/v1/bookings/:id/complete` endpoint
- [x] ✅ Create `PUT /api/v1/bookings/:id/no-show` endpoint
- [x] ✅ Validate state transitions (reject invalid transitions)
- [x] ✅ Record all transitions in booking_status_history
- [x] ✅ Log transitions in audit trail

### 4.2 Reschedule
- [x] ✅ Create `PUT /api/v1/bookings/:id/reschedule` endpoint
- [x] ✅ Accept new date/time/staff
- [x] ✅ Re-validate availability for new slot
- [x] ✅ Update booking record, log change
- [x] ✅ Trigger reschedule notification

### 4.3 Auto No-Show Job
- [x] ✅ Create scheduled job to mark no-shows
- [x] ✅ Check confirmed bookings past start_time + configurable window
- [x] ✅ Transition to no_show status
- [x] ✅ Trigger no-show notification

### 4.4 Write Unit Tests
- [x] ✅ Test valid transitions (pending → confirmed → in_progress → completed)
- [x] ✅ Test invalid transitions (completed → confirmed)
- [x] ✅ Test cancellation with fee calculation
- [x] ✅ Test auto no-show timing

---

## 5. Slot Holding

### 5.1 Hold API
- [x] ✅ Create `POST /api/v1/bookings/hold` endpoint
- [x] ✅ Create hold record with 5-minute expiry
- [x] ✅ Exclude held slots from availability queries
- [x] ✅ Create `DELETE /api/v1/bookings/hold/:id` endpoint (release)

### 5.2 Hold Cleanup
- [x] ✅ Create scheduled job to purge expired holds (every 60 seconds)
- [x] ✅ Write unit tests

---

## 6. Waitlist

### 6.1 Waitlist API
- [x] ✅ Create `POST /api/v1/bookings/:id/waitlist` endpoint (join)
- [x] ✅ Create `DELETE /api/v1/bookings/:id/waitlist` endpoint (leave)
- [x] ✅ Create `PUT /api/v1/bookings/waitlist/:entryId/confirm` endpoint
- [x] ✅ Assign position (FIFO)
- [x] ✅ Enforce max waitlist size (configurable, default 5)

### 6.2 Waitlist Promotion
- [x] ✅ On cancellation: notify next waitlist entry
- [x] ✅ Start 2-hour confirmation window
- [x] ✅ Expire and promote next if not confirmed
- [x] ✅ Create booking on confirmation

### 6.3 Write Unit Tests
- [x] ✅ Test join, leave, position
- [x] ✅ Test promotion on cancellation
- [x] ✅ Test expiry and cascade to next

---

## 7. Recurring Bookings

### 7.1 Recurring Series API
- [x] ✅ Create `POST /api/v1/bookings/recurring` endpoint
- [x] ✅ Accept: service, variant, staff, pattern, end condition
- [x] ✅ Generate individual booking instances (4-8 weeks ahead)
- [x] ✅ Validate availability per occurrence (skip conflicts)
- [x] ✅ Create `GET /api/v1/bookings/recurring/:seriesId` endpoint
- [x] ✅ Create `PUT /api/v1/bookings/recurring/:seriesId/cancel` endpoint

### 7.2 Series Management
- [x] ✅ Cancel single occurrence (without affecting series)
- [x] ✅ Cancel all future occurrences
- [x] ✅ Modify single occurrence (reschedule)
- [x] ✅ Scheduled job to generate new instances as time progresses

### 7.3 Write Unit Tests
- [x] ✅ Test weekly recurring generation
- [x] ✅ Test conflict skipping
- [x] ✅ Test single cancel vs series cancel
- [x] ✅ Test instance generation job

---

## 8. Conflict Detection

### 8.1 Detection Service
- [x] ✅ Create conflict detection function (staff, resource, customer)
- [x] ✅ Use FOR UPDATE NOWAIT for database-level locking
- [x] ✅ Return conflicting bookings on failure
- [x] ✅ Suggest alternative slots on conflict

### 8.2 Write Unit Tests
- [x] ✅ Test staff double-booking prevention
- [x] ✅ Test resource double-booking prevention
- [x] ✅ Test customer overlap detection
- [x] ✅ Test concurrent booking attempts (race condition)

---

## 9. Notifications

### 9.1 Notification Service
- [x] ✅ Create notification dispatch service
- [x] ✅ Create notification_queue table processing job
- [x] ✅ Support email channel (via existing email service)
- [x] ✅ Build email templates: confirmation, reminder, cancellation, reschedule, waitlist

### 9.2 iCal Generation
- [x] ✅ Create iCal (.ics) file generator for bookings
- [x] ✅ Include VTIMEZONE, VEVENT with correct times
- [x] ✅ Attach to confirmation emails

### 9.3 Reminder Scheduler
- [x] ✅ Create scheduled job for sending reminders
- [x] ✅ Support configurable timing (24h, 2h, or both)
- [x] ✅ Respect customer communication preferences

### 9.4 Write Unit Tests
- [x] ✅ Test notification queueing
- [x] ✅ Test iCal generation format
- [x] ✅ Test reminder scheduling logic

---

## 10. Calendar APIs

### 10.1 Calendar Endpoint
- [x] ✅ Create `GET /api/v1/bookings/calendar` endpoint
- [x] ✅ Support view parameter (day, week, month)
- [x] ✅ Support date parameter
- [x] ✅ Support filter by staff_id, resource_id, service_id
- [x] ✅ Day/Week: return individual bookings with times
- [x] ✅ Month: return daily counts and summary

### 10.2 iCal Download
- [x] ✅ Create `GET /api/v1/bookings/:id/ical` endpoint
- [x] ✅ Return .ics file for single booking

### 10.3 Write Unit Tests
- [x] ✅ Test day view returns correct bookings
- [x] ✅ Test week view aggregation
- [x] ✅ Test staff-filtered calendar

---

## 11. Booking Rules

### 11.1 Rules Engine
- [x] ✅ Create booking rules validation service
- [x] ✅ Enforce lead time per service
- [x] ✅ Enforce max advance booking per service
- [x] ✅ Enforce max active bookings per customer
- [x] ✅ Apply cancellation policy fees
- [x] ✅ Support staff override of rules

### 11.2 Write Unit Tests
- [x] ✅ Test lead time enforcement
- [x] ✅ Test max advance booking enforcement
- [x] ✅ Test customer booking limit
- [x] ✅ Test staff override bypass

---

## 12. Frontend

### 12.1 Customer Booking Flow
- [x] ✅ Create `/book/:serviceSlug` page
- [x] ✅ Step 1: Select variant
- [x] ✅ Step 2: Select date (calendar picker)
- [x] ✅ Step 3: Select time slot (slot grid)
- [x] ✅ Step 4: Select staff (optional)
- [x] ✅ Step 5: Confirm and submit
- [x] ✅ Show booking confirmation with reference and details

### 12.2 Admin Calendar
- [x] ✅ Create `/bookings/calendar` page
- [x] ✅ Day/Week/Month view toggle
- [x] ✅ Filter by staff, service, status
- [x] ✅ Click booking → detail side panel
- [x] ✅ Click empty slot → create booking modal
- [x] ✅ Color-code by status

### 12.3 Booking List
- [x] ✅ Create `/bookings` page
- [x] ✅ Table with filters (date, status, customer, service)
- [x] ✅ Quick actions (confirm, cancel, no-show)
- [x] ✅ Pagination

### 12.4 Customer My Bookings
- [x] ✅ Create `/profile/bookings` page
- [x] ✅ Upcoming bookings with cancel/reschedule actions
- [x] ✅ Past bookings history

---

## 13. Testing

### 13.1 Unit Tests
- [x] ✅ Test availability engine (all constraint types)
- [x] ✅ Test booking CRUD (all types: individual, shared, group, resource)
- [x] ✅ Test lifecycle transitions (all valid and invalid paths)
- [x] ✅ Test conflict detection (staff, resource, customer, concurrent)
- [x] ✅ Test slot holding (create, expire, cleanup)
- [x] ✅ Test waitlist (join, promote, expire, cascade)
- [x] ✅ Test recurring (generate, skip conflicts, cancel series/single)
- [x] ✅ Test booking reference generation (sequential per business)
- [x] ✅ Test cancellation fee calculation
- [x] ✅ Test time zone handling (UTC storage, local display)

### 13.2 Integration Tests
- [x] ✅ Test full booking flow (availability → hold → book → confirm → complete)
- [x] ✅ Test shared session (book to capacity → waitlist → cancel → promote)
- [x] ✅ Test recurring series (create → skip conflict → cancel future)
- [x] ✅ Test concurrent booking attempts (only one succeeds)
- [x] ✅ Test business scoping (cannot access other business bookings)
- [x] ✅ Test notification dispatch (confirmation, reminder, cancellation)
