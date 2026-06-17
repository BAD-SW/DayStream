# Phase 15: Check-In System - Tasks

## Overview

Implementation tasks for the check-in system â€” database schema, QR code generation, session validation, reception/kiosk/walk-in check-in, no-show detection, late arrival handling, real-time dashboard, attendance reports, and frontend.

## Task Status Legend

- âœ… **Complete**: Task is finished and verified
- ðŸŸ¡ **In Progress**: Task is currently being worked on
- ðŸ“‹ **Planned**: Task is defined but not started
- â¸ï¸ **Blocked**: Task is waiting on dependencies
- âŒ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `check_in_records` table
- [x] ✅ Create migration for `check_in_qr_codes` table
- [x] ✅ Create migration for `no_show_records` table
- [x] ✅ Create migration for `check_in_config` table
- [x] ✅ Create migration for `kiosk_sessions` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, booking, customer, date)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. QR Code Generation

### 2.1 QR Code Service
- [x] ✅ Create `checkin-qr.service.ts`
- [x] ✅ Generate unique booking QR code on booking confirmation
- [x] ✅ Generate persistent customer QR code
- [x] ✅ Support QR code regeneration (deactivate old, create new)
- [x] ✅ Set expiry for booking QR codes (end of booking day + grace)
- [x] ✅ Validate QR codes (check active, not expired)
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/qr-code/booking/:bookingId` endpoint
- [x] ✅ Create `GET /api/v1/check-in/qr-code/customer/:customerId` endpoint
- [x] ✅ Create `POST /api/v1/check-in/qr-code/customer/:customerId/regenerate` endpoint

---

## 3. Session Validation

### 3.1 Validation Service
- [x] ✅ Create `checkin-validation.service.ts`
- [x] ✅ Validate booking exists and is confirmed
- [x] ✅ Validate booking is for today (within early arrival window)
- [x] ✅ Prevent double check-in
- [x] ✅ Validate active membership (if service requires membership)
- [x] ✅ Validate sufficient credits (if credit-based, and mode = on_checkin)
- [x] ✅ Check outstanding balance (configurable)
- [x] ✅ Check no-show restriction thresholds
- [x] ✅ Return pass/warning/error structure
- [x] ✅ Support staff override with audit logging
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/validate/:bookingId` endpoint (dry run)

---

## 4. Check-In Methods

### 4.1 Check-In Service
- [x] ✅ Create `checkin.service.ts`
- [x] ✅ Implement QR code check-in (staff scans customer QR)
- [x] ✅ Implement QR self-service (customer scans venue QR â†’ triggers check-in)
- [x] ✅ Implement reception check-in (by booking ID, one-click)
- [x] ✅ Implement kiosk check-in (QR, reference, or name lookup)
- [x] ✅ Deduct credits on check-in (if credit_deduction_mode = 'on_checkin')
- [x] ✅ Create check_in_record with method and processor
- [x] ✅ Notify assigned staff of customer arrival
- [x] ✅ Write tests

### 4.2 Routes
- [x] ✅ Create `POST /api/v1/check-in/qr` endpoint
- [x] ✅ Create `POST /api/v1/check-in/reception` endpoint
- [x] ✅ Create `POST /api/v1/check-in/kiosk` endpoint

---

## 5. Walk-In Handling

### 5.1 Walk-In Service
- [x] ✅ Create `checkin-walkin.service.ts`
- [x] ✅ Identify customer (by QR, name/phone, or create new)
- [x] ✅ Check real-time service availability at current location
- [x] ✅ Create instant booking (start = now, end = now + duration)
- [x] ✅ Reserve resource if needed
- [x] ✅ Validate membership/credits/payment
- [x] ✅ Create check_in_record (method = 'walk_in')
- [x] ✅ Integrate with Pricing Engine for walk-in pricing
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `POST /api/v1/check-in/walk-in` endpoint

---

## 6. No-Show Detection and Management

### 6.1 No-Show Service
- [x] ✅ Create `checkin-noshow.service.ts`
- [x] ✅ Implement scheduled job: detect no-shows after grace period
- [x] ✅ Mark booking as no_show
- [x] ✅ Create no_show_record with fee calculation
- [x] ✅ Apply no-show fee from cancellation policy
- [x] ✅ Notify customer of no-show status
- [x] ✅ Track no-show count per customer
- [x] ✅ Implement escalation thresholds (warning â†’ restrict â†’ ban)
- [x] ✅ Support staff waiver (override with reason + audit)
- [x] ✅ Restore credits if deducted on booking and fee waived
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/no-shows` endpoint (list, date range)
- [x] ✅ Create `PUT /api/v1/check-in/no-shows/:id/waive` endpoint
- [x] ✅ Create `GET /api/v1/check-in/no-shows/customer/:customerId` endpoint

---

## 7. Late Arrival Handling

### 7.1 Late Arrival Logic
- [x] ✅ Support late arrival policies per service (allow, reschedule, no-show)
- [x] ✅ Allow check-in within configurable late window
- [x] ✅ Record actual check-in time (vs booking start)
- [x] ✅ Adjust session end time if "reduced time" policy applies
- [x] ✅ Notify assigned staff of late arrival
- [x] ✅ Write tests

---

## 8. Configuration

### 8.1 Configuration Service
- [x] ✅ Create `checkin-config.service.ts`
- [x] ✅ Support tenant-level config (grace period, early arrival, credit mode, no-show thresholds)
- [x] ✅ Support kiosk enablement per location
- [x] ✅ Support walk-in enablement
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/config` endpoint
- [x] ✅ Create `PUT /api/v1/check-in/config` endpoint

---

## 9. Kiosk Mode

### 9.1 Kiosk Service
- [x] ✅ Create `checkin-kiosk.service.ts`
- [x] ✅ Register kiosk devices per location (token-based auth)
- [x] ✅ Scope check-in to kiosk's location
- [x] ✅ Support QR scan, reference entry, name/phone lookup
- [x] ✅ Auto-timeout (return to welcome screen after 30s)
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `POST /api/v1/check-in/kiosk/register` endpoint
- [x] ✅ Create `GET /api/v1/check-in/kiosk/status` endpoint

---

## 10. Real-Time Dashboard

### 10.1 Dashboard Service
- [x] ✅ Create `checkin-dashboard.service.ts`
- [x] ✅ Aggregate today's bookings with check-in status
- [x] ✅ Categorize: upcoming, awaiting, checked-in, in-progress, completed, no-show
- [x] ✅ Support filtering by service, staff, resource, location
- [x] ✅ Support upcoming queue (next N bookings)
- [x] ✅ Include customer photo and service details
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/dashboard` endpoint
- [x] ✅ Create `GET /api/v1/check-in/dashboard/upcoming` endpoint

---

## 11. Check-In Notifications

### 11.1 Notification Logic
- [x] ✅ Notify assigned staff when customer checks in
- [x] ✅ Notify reception of all check-ins (configurable)
- [x] ✅ Alert staff when customer approaching no-show threshold
- [x] ✅ Include customer name, service, special notes
- [x] ✅ Support in-app notification channel
- [x] ✅ Write tests

---

## 12. Attendance Reporting

### 12.1 Reports Service
- [x] ✅ Create `checkin-reports.service.ts`
- [x] ✅ Calculate attendance rate (check-ins / confirmed bookings)
- [x] ✅ Calculate no-show rate per period
- [x] ✅ Calculate late arrival rate
- [x] ✅ Calculate walk-in volume
- [x] ✅ Report attendance by service type
- [x] ✅ Report peak check-in times
- [x] ✅ Report by check-in method (QR, reception, kiosk)
- [x] ✅ Identify high no-show customers
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/check-in/reports/attendance` endpoint
- [x] ✅ Create `GET /api/v1/check-in/reports/no-shows` endpoint
- [x] ✅ Create `GET /api/v1/check-in/reports/walk-ins` endpoint
- [x] ✅ Create `GET /api/v1/check-in/reports/peak-times` endpoint
- [x] ✅ Create `GET /api/v1/check-in/reports/methods` endpoint

---

## 13. Frontend

### 13.1 Reception Check-In Page
- [x] ✅ Create `/check-in` page with today's bookings
- [x] ✅ One-click check-in buttons
- [x] ✅ Search by name/phone/reference
- [x] ✅ Validation result display (pass/warning/error)
- [x] ✅ Override button with reason input
- [x] ✅ Real-time auto-refresh (polling)

### 13.2 Kiosk Mode
- [x] ✅ Create `/check-in/kiosk` full-screen interface
- [x] ✅ QR scanner (device camera)
- [x] ✅ Booking reference numeric input
- [x] ✅ Name/phone lookup
- [x] ✅ Large success/error feedback
- [x] ✅ Auto-reset (30s inactivity)
- [x] ✅ Tenant branding

### 13.3 Real-Time Dashboard
- [x] ✅ Create `/check-in/dashboard` page
- [x] ✅ Timeline with color-coded status
- [x] ✅ Columns: upcoming, awaiting, checked-in, in-progress, completed, no-show
- [x] ✅ Customer photo and service names
- [x] ✅ Filters (service, staff, resource)
- [x] ✅ Highlight overdue arrivals

### 13.4 No-Show Management
- [x] ✅ Create `/check-in/no-shows` page
- [x] ✅ List with dates, fees, status
- [x] ✅ Waive button with reason
- [x] ✅ Customer repeat-offender flags

### 13.5 Attendance Reports
- [x] ✅ Create `/check-in/reports` page
- [x] ✅ Attendance rate chart
- [x] ✅ No-show trend
- [x] ✅ Walk-in volume
- [x] ✅ Peak times heatmap
- [x] ✅ Method breakdown
- [x] ✅ High no-show customer list

---

## 14. Testing

### 14.1 Unit Tests
- [x] ✅ Test QR code generation (booking, customer, regeneration, expiry)
- [x] ✅ Test session validation (all conditions: booking, membership, credits, no-show)
- [x] ✅ Test check-in methods (QR, reception, kiosk, walk-in)
- [x] ✅ Test no-show detection (grace period, fee application, escalation)
- [x] ✅ Test walk-in flow (availability check, instant booking, credit deduction)
- [x] ✅ Test late arrival handling (policies, time adjustment)
- [x] ✅ Test dashboard status categorization
- [x] ✅ Test attendance calculations

### 14.2 Integration Tests
- [x] ✅ Test full check-in flow (booking confirmed â†’ QR generated â†’ scan â†’ validated â†’ checked in)
- [x] ✅ Test no-show detection job (booking passes grace â†’ marked â†’ fee applied â†’ notified)
- [x] ✅ Test walk-in complete flow (arrive â†’ identify â†’ select service â†’ book â†’ check-in)
- [x] ✅ Test credit deduction on check-in mode
- [x] ✅ Test override flow (validation fails â†’ staff override â†’ check-in allowed)
- [x] ✅ Test no-show escalation (multiple no-shows â†’ restriction applied)
- [x] ✅ Test tenant scoping (check-in data isolated per tenant)
