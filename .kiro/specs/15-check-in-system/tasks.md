# Phase 15: Check-In System - Tasks

## Overview

Implementation tasks for the check-in system — database schema, QR code generation, session validation, reception/kiosk/walk-in check-in, no-show detection, late arrival handling, real-time dashboard, attendance reports, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [ ] Create migration for `check_in_records` table
- [ ] Create migration for `check_in_qr_codes` table
- [ ] Create migration for `no_show_records` table
- [ ] Create migration for `check_in_config` table
- [ ] Create migration for `kiosk_sessions` table

### 1.2 Indexes and Permissions
- [ ] Add indexes (tenant, booking, customer, date)
- [ ] Add RLS policies on all tables (tenant-scoped)
- [ ] Grant permissions to daystream_app role
- [ ] Run migrations and verify schema

---

## 2. QR Code Generation

### 2.1 QR Code Service
- [ ] Create `checkin-qr.service.ts`
- [ ] Generate unique booking QR code on booking confirmation
- [ ] Generate persistent customer QR code
- [ ] Support QR code regeneration (deactivate old, create new)
- [ ] Set expiry for booking QR codes (end of booking day + grace)
- [ ] Validate QR codes (check active, not expired)
- [ ] Write tests

### 2.2 Routes
- [ ] Create `GET /api/v1/check-in/qr-code/booking/:bookingId` endpoint
- [ ] Create `GET /api/v1/check-in/qr-code/customer/:customerId` endpoint
- [ ] Create `POST /api/v1/check-in/qr-code/customer/:customerId/regenerate` endpoint

---

## 3. Session Validation

### 3.1 Validation Service
- [ ] Create `checkin-validation.service.ts`
- [ ] Validate booking exists and is confirmed
- [ ] Validate booking is for today (within early arrival window)
- [ ] Prevent double check-in
- [ ] Validate active membership (if service requires membership)
- [ ] Validate sufficient credits (if credit-based, and mode = on_checkin)
- [ ] Check outstanding balance (configurable)
- [ ] Check no-show restriction thresholds
- [ ] Return pass/warning/error structure
- [ ] Support staff override with audit logging
- [ ] Write tests

### 3.2 Routes
- [ ] Create `GET /api/v1/check-in/validate/:bookingId` endpoint (dry run)

---

## 4. Check-In Methods

### 4.1 Check-In Service
- [ ] Create `checkin.service.ts`
- [ ] Implement QR code check-in (staff scans customer QR)
- [ ] Implement QR self-service (customer scans venue QR → triggers check-in)
- [ ] Implement reception check-in (by booking ID, one-click)
- [ ] Implement kiosk check-in (QR, reference, or name lookup)
- [ ] Deduct credits on check-in (if credit_deduction_mode = 'on_checkin')
- [ ] Create check_in_record with method and processor
- [ ] Notify assigned staff of customer arrival
- [ ] Write tests

### 4.2 Routes
- [ ] Create `POST /api/v1/check-in/qr` endpoint
- [ ] Create `POST /api/v1/check-in/reception` endpoint
- [ ] Create `POST /api/v1/check-in/kiosk` endpoint

---

## 5. Walk-In Handling

### 5.1 Walk-In Service
- [ ] Create `checkin-walkin.service.ts`
- [ ] Identify customer (by QR, name/phone, or create new)
- [ ] Check real-time service availability at current location
- [ ] Create instant booking (start = now, end = now + duration)
- [ ] Reserve resource if needed
- [ ] Validate membership/credits/payment
- [ ] Create check_in_record (method = 'walk_in')
- [ ] Integrate with Pricing Engine for walk-in pricing
- [ ] Write tests

### 5.2 Routes
- [ ] Create `POST /api/v1/check-in/walk-in` endpoint

---

## 6. No-Show Detection and Management

### 6.1 No-Show Service
- [ ] Create `checkin-noshow.service.ts`
- [ ] Implement scheduled job: detect no-shows after grace period
- [ ] Mark booking as no_show
- [ ] Create no_show_record with fee calculation
- [ ] Apply no-show fee from cancellation policy
- [ ] Notify customer of no-show status
- [ ] Track no-show count per customer
- [ ] Implement escalation thresholds (warning → restrict → ban)
- [ ] Support staff waiver (override with reason + audit)
- [ ] Restore credits if deducted on booking and fee waived
- [ ] Write tests

### 6.2 Routes
- [ ] Create `GET /api/v1/check-in/no-shows` endpoint (list, date range)
- [ ] Create `PUT /api/v1/check-in/no-shows/:id/waive` endpoint
- [ ] Create `GET /api/v1/check-in/no-shows/customer/:customerId` endpoint

---

## 7. Late Arrival Handling

### 7.1 Late Arrival Logic
- [ ] Support late arrival policies per service (allow, reschedule, no-show)
- [ ] Allow check-in within configurable late window
- [ ] Record actual check-in time (vs booking start)
- [ ] Adjust session end time if "reduced time" policy applies
- [ ] Notify assigned staff of late arrival
- [ ] Write tests

---

## 8. Configuration

### 8.1 Configuration Service
- [ ] Create `checkin-config.service.ts`
- [ ] Support tenant-level config (grace period, early arrival, credit mode, no-show thresholds)
- [ ] Support kiosk enablement per location
- [ ] Support walk-in enablement
- [ ] Write tests

### 8.2 Routes
- [ ] Create `GET /api/v1/check-in/config` endpoint
- [ ] Create `PUT /api/v1/check-in/config` endpoint

---

## 9. Kiosk Mode

### 9.1 Kiosk Service
- [ ] Create `checkin-kiosk.service.ts`
- [ ] Register kiosk devices per location (token-based auth)
- [ ] Scope check-in to kiosk's location
- [ ] Support QR scan, reference entry, name/phone lookup
- [ ] Auto-timeout (return to welcome screen after 30s)
- [ ] Write tests

### 9.2 Routes
- [ ] Create `POST /api/v1/check-in/kiosk/register` endpoint
- [ ] Create `GET /api/v1/check-in/kiosk/status` endpoint

---

## 10. Real-Time Dashboard

### 10.1 Dashboard Service
- [ ] Create `checkin-dashboard.service.ts`
- [ ] Aggregate today's bookings with check-in status
- [ ] Categorize: upcoming, awaiting, checked-in, in-progress, completed, no-show
- [ ] Support filtering by service, staff, resource, location
- [ ] Support upcoming queue (next N bookings)
- [ ] Include customer photo and service details
- [ ] Write tests

### 10.2 Routes
- [ ] Create `GET /api/v1/check-in/dashboard` endpoint
- [ ] Create `GET /api/v1/check-in/dashboard/upcoming` endpoint

---

## 11. Check-In Notifications

### 11.1 Notification Logic
- [ ] Notify assigned staff when customer checks in
- [ ] Notify reception of all check-ins (configurable)
- [ ] Alert staff when customer approaching no-show threshold
- [ ] Include customer name, service, special notes
- [ ] Support in-app notification channel
- [ ] Write tests

---

## 12. Attendance Reporting

### 12.1 Reports Service
- [ ] Create `checkin-reports.service.ts`
- [ ] Calculate attendance rate (check-ins / confirmed bookings)
- [ ] Calculate no-show rate per period
- [ ] Calculate late arrival rate
- [ ] Calculate walk-in volume
- [ ] Report attendance by service type
- [ ] Report peak check-in times
- [ ] Report by check-in method (QR, reception, kiosk)
- [ ] Identify high no-show customers
- [ ] Write tests

### 12.2 Routes
- [ ] Create `GET /api/v1/check-in/reports/attendance` endpoint
- [ ] Create `GET /api/v1/check-in/reports/no-shows` endpoint
- [ ] Create `GET /api/v1/check-in/reports/walk-ins` endpoint
- [ ] Create `GET /api/v1/check-in/reports/peak-times` endpoint
- [ ] Create `GET /api/v1/check-in/reports/methods` endpoint

---

## 13. Frontend

### 13.1 Reception Check-In Page
- [ ] Create `/check-in` page with today's bookings
- [ ] One-click check-in buttons
- [ ] Search by name/phone/reference
- [ ] Validation result display (pass/warning/error)
- [ ] Override button with reason input
- [ ] Real-time auto-refresh (polling)

### 13.2 Kiosk Mode
- [ ] Create `/check-in/kiosk` full-screen interface
- [ ] QR scanner (device camera)
- [ ] Booking reference numeric input
- [ ] Name/phone lookup
- [ ] Large success/error feedback
- [ ] Auto-reset (30s inactivity)
- [ ] Tenant branding

### 13.3 Real-Time Dashboard
- [ ] Create `/check-in/dashboard` page
- [ ] Timeline with color-coded status
- [ ] Columns: upcoming, awaiting, checked-in, in-progress, completed, no-show
- [ ] Customer photo and service names
- [ ] Filters (service, staff, resource)
- [ ] Highlight overdue arrivals

### 13.4 No-Show Management
- [ ] Create `/check-in/no-shows` page
- [ ] List with dates, fees, status
- [ ] Waive button with reason
- [ ] Customer repeat-offender flags

### 13.5 Attendance Reports
- [ ] Create `/check-in/reports` page
- [ ] Attendance rate chart
- [ ] No-show trend
- [ ] Walk-in volume
- [ ] Peak times heatmap
- [ ] Method breakdown
- [ ] High no-show customer list

---

## 14. Testing

### 14.1 Unit Tests
- [ ] Test QR code generation (booking, customer, regeneration, expiry)
- [ ] Test session validation (all conditions: booking, membership, credits, no-show)
- [ ] Test check-in methods (QR, reception, kiosk, walk-in)
- [ ] Test no-show detection (grace period, fee application, escalation)
- [ ] Test walk-in flow (availability check, instant booking, credit deduction)
- [ ] Test late arrival handling (policies, time adjustment)
- [ ] Test dashboard status categorization
- [ ] Test attendance calculations

### 14.2 Integration Tests
- [ ] Test full check-in flow (booking confirmed → QR generated → scan → validated → checked in)
- [ ] Test no-show detection job (booking passes grace → marked → fee applied → notified)
- [ ] Test walk-in complete flow (arrive → identify → select service → book → check-in)
- [ ] Test credit deduction on check-in mode
- [ ] Test override flow (validation fails → staff override → check-in allowed)
- [ ] Test no-show escalation (multiple no-shows → restriction applied)
- [ ] Test tenant scoping (check-in data isolated per tenant)
