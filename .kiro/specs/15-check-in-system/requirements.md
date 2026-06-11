# Phase 15: Check-In System - Requirements

## Overview

This phase builds the customer check-in system that confirms attendance, validates session eligibility (membership/credits), tracks no-shows, and provides real-time arrival information to staff. Check-in bridges the gap between a confirmed booking and a completed session, enabling accurate attendance records, membership credit enforcement, and operational awareness for the business.

## Goals

- Support multiple check-in methods (QR code, mobile app, reception, kiosk)
- Validate session eligibility before check-in (active membership, sufficient credits, valid booking)
- Track attendance and no-shows accurately
- Provide real-time check-in status to staff
- Enforce no-show policies (fees, restrictions)
- Support walk-in bookings (unscheduled arrivals)
- Generate attendance reports

## Glossary

- **Check_In**: The act of confirming a customer's arrival for a booked session or event
- **Check_In_Method**: The mechanism used to check in (QR scan, reception, mobile, kiosk)
- **Session_Validation**: The process of verifying a customer is eligible to attend (valid booking, active membership, sufficient credits)
- **No_Show**: A customer who had a confirmed booking but did not arrive within the grace period
- **Walk_In**: A customer who arrives without a pre-existing booking and wants to book on the spot
- **Grace_Period**: The time window after a booking start time during which check-in is still accepted
- **Kiosk_Mode**: A full-screen, simplified interface designed for a self-service terminal at the business entrance
- **Attendance_Record**: A timestamped log of a customer's check-in for a specific booking

## Requirements

### Requirement 1: QR Code Check-In

**User Story:** As a customer, I want to scan a QR code when I arrive, so that check-in is fast and contactless.

#### Acceptance Criteria

1. THE system SHALL generate a unique QR code per booking (included in confirmation email and customer dashboard)
2. THE system SHALL generate a unique QR code per customer (persistent code for walk-in/membership check-in)
3. THE system SHALL support staff scanning the customer's QR code using a device camera
4. THE system SHALL support customer scanning a venue QR code displayed at reception (self-service)
5. WHEN a QR code is scanned, THE system SHALL perform Session_Validation before confirming check-in
6. THE system SHALL display a clear success or failure message upon scan
7. THE system SHALL support QR codes rendered in the mobile app (Phase 19) and as downloadable images
8. THE system SHALL reject expired or invalid QR codes with a descriptive message

### Requirement 2: Reception Check-In

**User Story:** As a receptionist, I want to check in customers from my screen, so that I can handle arrivals quickly and assist customers who don't have their QR code.

#### Acceptance Criteria

1. THE system SHALL provide a reception check-in interface showing today's upcoming bookings
2. THE interface SHALL display bookings sorted by time with: customer name, service, time, status (awaiting, checked-in, in-progress, completed, no-show)
3. THE system SHALL allow staff to check in a customer with one click
4. THE system SHALL support searching for a customer by name, phone, or booking reference
5. THE system SHALL perform Session_Validation before confirming check-in
6. THE system SHALL display validation warnings (e.g., "Membership expired", "Insufficient credits") with option to override
7. THE system SHALL support checking in customers who arrive early (within a configurable window, default: 15 minutes before)
8. THE system SHALL log which staff member processed the check-in

### Requirement 3: Kiosk Mode

**User Story:** As a business owner, I want a self-service kiosk at my entrance, so that customers can check themselves in without staff assistance.

#### Acceptance Criteria

1. THE system SHALL provide a Kiosk_Mode interface optimized for tablet/touchscreen
2. THE Kiosk_Mode SHALL support: QR code scanning (via device camera), booking reference entry (numeric code), customer name/phone lookup
3. THE Kiosk_Mode SHALL display large, touch-friendly buttons and text
4. THE Kiosk_Mode SHALL display clear success/failure feedback with instructions
5. THE Kiosk_Mode SHALL auto-return to the welcome screen after 30 seconds of inactivity
6. THE Kiosk_Mode SHALL NOT require authentication (runs in a locked-down browser mode)
7. THE Kiosk_Mode SHALL be configured per location (shows only that location's bookings)
8. THE Kiosk_Mode SHALL support tenant branding (logo, colors)

### Requirement 4: Session Validation

**User Story:** As a business owner, I want the system to verify that a customer is eligible to attend before checking them in, so that only paying or valid members access services.

#### Acceptance Criteria

1. THE system SHALL validate the following before check-in: booking exists and is in "Confirmed" status, booking is for today (or within early arrival window), customer has an active membership (if membership-gated service), customer has sufficient credits (if credit-based access), no outstanding unpaid invoices that block access (configurable per tenant)
2. THE system SHALL clearly indicate the validation result: pass (all checks met), warning (minor issue but check-in allowed, e.g., membership expiring soon), fail (cannot check in, with reason)
3. THE system SHALL allow staff override for validation failures (with audit log and reason)
4. THE system SHALL deduct credits at check-in time (not at booking time) if the tenant configures "deduct on arrival" mode
5. THE system SHALL support "deduct on booking" OR "deduct on check-in" as a tenant configuration
6. THE system SHALL prevent double check-in for the same booking

### Requirement 5: No-Show Detection and Management

**User Story:** As a business owner, I want the system to detect no-shows automatically, so that I can enforce my no-show policy and free up resources.

#### Acceptance Criteria

1. THE system SHALL automatically mark a booking as No-Show if the customer has not checked in within the Grace_Period after the booking start time
2. THE Grace_Period SHALL be configurable per Tenant (default: 15 minutes)
3. WHEN a booking is marked No-Show, THE system SHALL apply the no-show fee from the service's cancellation policy (Phase 06)
4. THE system SHALL notify the customer when they are marked as a no-show
5. THE system SHALL track no-show count per customer
6. THE system SHALL support configuring automatic consequences for repeat no-shows: warning after X no-shows, booking restriction after Y no-shows (requires prepayment), temporary ban after Z no-shows (configurable per tenant)
7. THE system SHALL allow staff to override a no-show (e.g., customer called ahead, mark as late arrival instead)
8. THE system SHALL restore credits (if deducted on booking) when marked as no-show with fee waiver

### Requirement 6: Walk-In Handling

**User Story:** As a customer, I want to walk in without a booking and still access services if there's availability, so that I can be spontaneous.

#### Acceptance Criteria

1. THE system SHALL support walk-in check-in for customers without a pre-existing booking
2. THE system SHALL check real-time availability for the requested service at the current time
3. IF availability exists, THE system SHALL create a booking and check in the customer in one flow
4. THE system SHALL validate membership/credits for walk-in bookings
5. THE system SHALL support walk-in payment (if no membership or insufficient credits)
6. THE system SHALL integrate with the Pricing Engine (Phase 09) for walk-in pricing
7. THE system SHALL display available services and next-available times if immediate walk-in is not possible
8. THE system SHALL log walk-ins distinctly from pre-booked check-ins for reporting

### Requirement 7: Late Arrival Handling

**User Story:** As a receptionist, I want to handle late arrivals appropriately, so that the service can still happen if possible or be rescheduled.

#### Acceptance Criteria

1. THE system SHALL support configuring a late arrival policy per service: allow late start (reduce remaining time), reschedule to next available slot, mark as no-show (if beyond grace period)
2. THE system SHALL allow staff to check in a late-arriving customer within a configurable window (e.g., up to 50% of session duration elapsed)
3. THE system SHALL record the actual check-in time (distinct from booking start time) for analytics
4. THE system SHALL adjust session end time if "reduced time" policy is configured
5. THE system SHALL notify the assigned staff member of a late arrival

### Requirement 8: Real-Time Status Dashboard

**User Story:** As a receptionist, I want a live view of today's check-in status, so that I can see who has arrived, who is in-session, and who hasn't shown up yet.

#### Acceptance Criteria

1. THE system SHALL provide a real-time dashboard showing today's bookings with check-in status
2. THE dashboard SHALL categorize bookings: Upcoming (not yet time), Awaiting (time passed, not checked in), Checked In (arrived, waiting for session), In Progress (session started), Completed, No-Show
3. THE dashboard SHALL auto-update without manual refresh (polling or WebSocket)
4. THE dashboard SHALL highlight overdue arrivals (past start time, not checked in)
5. THE dashboard SHALL display customer photo (if available) for easy identification
6. THE dashboard SHALL support filtering by service, staff member, or resource
7. THE dashboard SHALL show next-up queue for walk-in-friendly services

### Requirement 9: Attendance Reporting

**User Story:** As a business owner, I want attendance reports, so that I can understand customer behavior and identify no-show patterns.

#### Acceptance Criteria

1. THE system SHALL report attendance rate per period (day, week, month): (check-ins / confirmed bookings) × 100%
2. THE system SHALL report no-show rate per period
3. THE system SHALL report late arrival rate per period
4. THE system SHALL report walk-in volume per period
5. THE system SHALL report attendance by service type
6. THE system SHALL report peak check-in times (busiest arrival windows)
7. THE system SHALL identify customers with high no-show rates
8. THE system SHALL report by check-in method (QR, reception, kiosk)
9. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)

### Requirement 10: Check-In Notifications

**User Story:** As a staff member, I want to know when my next customer has arrived, so that I can prepare and greet them.

#### Acceptance Criteria

1. THE system SHALL notify the assigned staff member when their customer checks in
2. THE system SHALL notify reception/front desk of all check-ins (summary or individual, configurable)
3. THE system SHALL alert staff when a customer is approaching the no-show threshold
4. THE system SHALL support notification channels: in-app (real-time), push notification (mobile, Phase 19), audio alert (for kiosk/reception mode)
5. THE system SHALL include customer name, service, and any special notes in the notification

---

## Dependencies

- Phase 00: Infrastructure - Database, API
- Phase 02: Security & Compliance - RBAC (staff roles for check-in), audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n
- Phase 04: Design System - Kiosk UI, dashboard components, status badges
- Phase 05: Customer Management - Customer profiles (photos, notes), Activity_Timeline
- Phase 07: Booking Engine - Booking data (confirmed bookings for today), status transitions
- Phase 08: Membership Engine - Membership validation, credit deduction
- Phase 09: Pricing Engine - Walk-in pricing
- Phase 10: Payment Platform - Walk-in payment, no-show fee charges

## Success Criteria

- QR code, reception, and kiosk check-in methods all function correctly
- Session validation correctly blocks ineligible customers (expired membership, no credits)
- No-shows are detected automatically after grace period and policies enforced
- Walk-ins can book and check in via a single flow if availability exists
- Real-time dashboard shows accurate current status for all today's bookings
- Attendance reports provide actionable data on no-show patterns and peak times
- Staff are notified when their customers arrive
- All check-in data is strictly tenant-scoped

## Out of Scope

- Facial recognition or biometric check-in - Privacy/regulatory concerns, future evaluation
- Access control hardware integration (turnstiles, door locks) - Future IoT phase
- Automatic session start based on check-in (e.g., start sauna timer) - Future enhancement
- Check-in for online/virtual sessions - Future when virtual events are supported

## Notes

- "Deduct credits on booking" vs. "deduct on check-in" is a significant tenant configuration choice; both models exist in the market (Mindbody uses on-booking, some studios prefer on-arrival)
- QR codes should be simple, regeneratable if lost, and time-bounded for security
- Kiosk mode runs in a locked browser; security is handled by the fact it only reads bookings for today at one location
- No-show enforcement must be fair — always notify before charging, allow staff override
- Walk-in handling is a real operational need; many wellness businesses have spontaneous visitors
- Real-time dashboard may use polling initially; WebSockets can be added as an optimization

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 08, Phase 09, Phase 10
**Next Phase**: Phase 16 (Marketing & Automation)
