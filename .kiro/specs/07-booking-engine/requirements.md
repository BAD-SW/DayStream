# Phase 07: Booking Engine - Requirements

## Overview

This phase builds the core scheduling and availability system — the heart of the platform. The booking engine calculates available time slots based on the intersection of service configuration, staff schedules, resource availability, and business rules. It supports individual appointments, shared sessions, group classes, and resource-only bookings with a complete lifecycle from creation through completion or cancellation.

## Goals

- Build an availability calculation engine that considers staff, resources, service rules, and business hours
- Support all booking types (individual, shared, group, resource-only)
- Implement the complete booking lifecycle with status transitions
- Provide calendar views for admin/staff and a slot picker for customers
- Implement waitlist management for full sessions
- Support recurring bookings and booking rules (lead time, cut-off, max advance)
- Handle time zones correctly for international tenants
- Deliver booking notifications (confirmation, reminder, cancellation)

## Glossary

- **Booking**: A confirmed reservation for a Customer to attend a Service at a specific date and time
- **Slot**: A calculated available time window for a specific Service, considering all constraints
- **Availability_Engine**: The service that computes available Slots based on all scheduling constraints
- **Booking_Type**: The scheduling model — Individual (1:1), Shared (fixed time, multi-customer), Group (class), Resource (room/equipment only)
- **Booking_Status**: The current state of a Booking (pending, confirmed, completed, cancelled, no-show)
- **Waitlist**: A queue of customers wanting a spot in a fully-booked session
- **Recurring_Booking**: A booking pattern that repeats on a schedule (weekly, biweekly, etc.)
- **Buffer_Time**: The gap before/after a booking for preparation or cleanup
- **Lead_Time**: Minimum hours before a slot that a booking can be made
- **Cut_Off_Time**: The point after which a booking can no longer be cancelled for free
- **Calendar_View**: A visual representation of bookings across time (day, week, month)

## Requirements

### Requirement 1: Availability Calculation Engine

**User Story:** As a customer, I want to see only the time slots that are actually available, so that I don't waste time trying to book a time that can't be fulfilled.

#### Acceptance Criteria

1. THE Availability_Engine SHALL calculate available Slots by intersecting: service availability rules (days, hours, season), staff schedules and availability, resource/room availability, existing bookings (no conflicts), buffer times between bookings, business operating hours
2. THE Availability_Engine SHALL return Slots in the tenant's configured time zone
3. THE Availability_Engine SHALL respect service-specific lead time (minimum hours before a slot can be booked)
4. THE Availability_Engine SHALL respect maximum advance booking time (how far ahead customers can book)
5. THE Availability_Engine SHALL exclude slots where required resources are already booked
6. THE Availability_Engine SHALL exclude slots where all assigned staff are unavailable
7. THE Availability_Engine SHALL return availability for a given date range (default: 7 days)
8. THE Availability_Engine SHALL complete availability calculations within 1 second for a single service over 7 days
9. THE Availability_Engine SHALL support querying availability for a specific staff member

### Requirement 2: Individual Appointment Booking

**User Story:** As a customer, I want to book a one-on-one appointment (massage, personal training, consultation), so that I get dedicated time with a provider.

#### Acceptance Criteria

1. THE system SHALL support booking an individual appointment for one Customer with one staff member
2. THE system SHALL block the staff member's time for the duration plus buffer time
3. THE system SHALL block the assigned resource/room for the duration plus buffer time
4. THE system SHALL prevent double-booking of the same staff member at overlapping times
5. THE system SHALL prevent double-booking of the same resource at overlapping times
6. THE system SHALL allow the customer to select a preferred staff member (if tenant enables this)
7. THE system SHALL auto-assign a staff member if the customer has no preference (round-robin or next available)
8. THE system SHALL support booking a specific Service_Variant (duration/price option)

### Requirement 3: Shared Session Booking

**User Story:** As a customer, I want to book into a shared session (Fire & Ice, sauna), so that I can attend alongside other customers at a fixed time.

#### Acceptance Criteria

1. THE system SHALL support shared sessions with a fixed time and capacity limit
2. THE system SHALL allow multiple Customers to book the same session up to the capacity limit
3. THE system SHALL block the session from further bookings when capacity is reached
4. THE system SHALL display remaining capacity to customers ("3 spots left")
5. THE system SHALL support a staff member assigned to facilitate the session
6. THE system SHALL support shared sessions that recur on a schedule (e.g., every Tuesday at 10 AM)
7. THE system SHALL treat each occurrence of a recurring shared session as an independent bookable slot

### Requirement 4: Group Class Booking

**User Story:** As a customer, I want to book into a group class (workshop, yoga class), so that I can attend instructor-led sessions with other participants.

#### Acceptance Criteria

1. THE system SHALL support group classes with a defined schedule, instructor, and capacity
2. THE system SHALL allow multiple Customers to book a class up to the capacity limit
3. THE system SHALL support a minimum participant threshold (class cancelled if below minimum)
4. THE system SHALL support waitlist when capacity is reached
5. THE system SHALL display class details: instructor, time, duration, current enrollment, capacity
6. THE system SHALL support recurring class schedules (weekly, biweekly)
7. THE system SHALL support cancelling a single occurrence or an entire recurring series

### Requirement 5: Resource-Only Booking

**User Story:** As a customer, I want to book a resource directly (gym room, specific equipment), so that I can use the facility without needing a staff member.

#### Acceptance Criteria

1. THE system SHALL support booking a resource (room/equipment) without a staff member
2. THE system SHALL prevent double-booking of the resource
3. THE system SHALL respect the resource's operating hours and availability rules
4. THE system SHALL support configurable time slot durations for resource bookings
5. THE system SHALL display resource availability on a dedicated calendar

### Requirement 6: Booking Lifecycle and Status Transitions

**User Story:** As a receptionist, I want bookings to have clear statuses, so that I know which bookings are upcoming, completed, or cancelled.

#### Acceptance Criteria

1. THE system SHALL support the following Booking_Statuses: Pending (awaiting payment/confirmation), Confirmed (payment received or no payment required), In Progress (currently happening), Completed (attended and finished), Cancelled (by customer or staff), No-Show (customer did not attend)
2. THE system SHALL enforce valid status transitions: Pending → Confirmed, Cancelled; Confirmed → In Progress, Cancelled, No-Show; In Progress → Completed; No-Show and Completed are terminal states
3. THE system SHALL timestamp every status transition
4. THE system SHALL record who initiated each status change (customer, staff, system)
5. THE system SHALL log all status transitions in the audit trail
6. THE system SHALL automatically transition Confirmed → No-Show if not checked in within a configurable window after start time (default: 15 minutes)

### Requirement 7: Booking Rules and Policies

**User Story:** As a business owner, I want to set rules that control how far in advance customers can book and how late they can cancel, so that my schedule is manageable and protected.

#### Acceptance Criteria

1. THE system SHALL enforce minimum lead time per Service (e.g., cannot book less than 2 hours ahead)
2. THE system SHALL enforce maximum advance booking time per Service (e.g., cannot book more than 30 days ahead)
3. THE system SHALL enforce the Cancellation_Policy from Service Management (Phase 06) during cancellation
4. THE system SHALL support a reschedule policy (how close to the appointment a customer can reschedule)
5. THE system SHALL support maximum active bookings per customer (prevent over-booking)
6. THE system SHALL support tenant-level defaults for all booking rules with per-service overrides
7. THE system SHALL display booking rules clearly to customers during the booking flow

### Requirement 8: Customer Booking Flow

**User Story:** As a customer, I want a simple step-by-step booking process, so that I can select a service, choose a time, and confirm my booking quickly.

#### Acceptance Criteria

1. THE system SHALL provide a booking flow: Browse service → Select variant → Choose date/time → Select staff (optional) → Confirm → Pay (if required)
2. THE system SHALL display available slots in a clear, selectable format
3. THE system SHALL hold a slot temporarily (5 minutes) while the customer completes the booking to prevent conflicts
4. THE system SHALL release held slots if the customer abandons the flow
5. THE system SHALL confirm the booking immediately after successful payment (or immediately if no payment required)
6. THE system SHALL display a booking confirmation with: service, date, time, staff, location, cancellation policy, booking reference
7. THE system SHALL allow customers to add the booking to their calendar (iCal download)
8. THE system SHALL support booking on behalf of another customer (staff-initiated)

### Requirement 9: Admin Booking Management

**User Story:** As a receptionist, I want to create, modify, and cancel bookings from the admin view, so that I can manage the schedule on behalf of customers.

#### Acceptance Criteria

1. THE system SHALL allow staff to create bookings on behalf of customers
2. THE system SHALL allow staff to reschedule bookings (change date/time/staff)
3. THE system SHALL allow staff to cancel bookings with an optional reason
4. THE system SHALL allow staff to mark bookings as No-Show
5. THE system SHALL allow staff to override booking rules (e.g., book outside lead time)
6. THE system SHALL log all admin-initiated booking changes in the audit trail with the staff member's identity
7. THE system SHALL support bulk operations (cancel multiple bookings for a day, e.g., staff sick)

### Requirement 10: Calendar Views

**User Story:** As a manager, I want to see the schedule in day, week, and month views, so that I can understand utilization and spot gaps or conflicts.

#### Acceptance Criteria

1. THE system SHALL provide a Day view showing all bookings across staff and resources for a single day
2. THE system SHALL provide a Week view showing bookings in a time grid for the current week
3. THE system SHALL provide a Month view showing booking counts per day
4. THE system SHALL provide a Resource calendar showing bookings per room/equipment
5. THE system SHALL provide a Staff calendar showing a specific staff member's schedule
6. THE system SHALL color-code bookings by status (confirmed, in progress, cancelled, no-show)
7. THE system SHALL support drag-and-drop rescheduling in day and week views (staff only)
8. THE system SHALL support clicking an empty slot to create a new booking
9. THE system SHALL update in near-real-time when bookings are created or modified

### Requirement 11: Waitlist Management

**User Story:** As a customer, I want to join a waitlist when a session is full, so that I get notified if a spot opens up.

#### Acceptance Criteria

1. THE system SHALL allow Customers to join a waitlist when a shared session or group class is at capacity
2. THE system SHALL maintain waitlist order (first-come, first-served)
3. WHEN a spot opens up (cancellation), THE system SHALL notify the next customer on the waitlist
4. THE system SHALL give the notified customer a configurable time window (default: 2 hours) to confirm
5. IF the notified customer does not confirm within the window, THE system SHALL move to the next waitlist entry
6. THE system SHALL allow customers to remove themselves from a waitlist
7. THE system SHALL display waitlist position to the customer
8. THE system SHALL limit waitlist size per session (configurable, default: 5)

### Requirement 12: Recurring Bookings

**User Story:** As a customer, I want to set up a recurring booking (e.g., weekly massage every Thursday at 2 PM), so that my regular appointment is guaranteed.

#### Acceptance Criteria

1. THE system SHALL support creating recurring bookings with patterns: weekly, biweekly, monthly (same day)
2. THE system SHALL generate individual booking instances for each occurrence
3. THE system SHALL validate availability for each occurrence before confirming the series
4. THE system SHALL allow cancelling a single occurrence without affecting the series
5. THE system SHALL allow cancelling the entire recurring series (future occurrences only)
6. THE system SHALL allow modifying a single occurrence (reschedule one date)
7. THE system SHALL support an end condition: number of occurrences, end date, or ongoing (no end)
8. THE system SHALL handle conflicts gracefully (if one occurrence conflicts, skip it and notify the customer)

### Requirement 13: Booking Notifications

**User Story:** As a customer, I want to receive confirmations and reminders, so that I don't forget my appointments.

#### Acceptance Criteria

1. THE system SHALL send a confirmation notification when a booking is created (email)
2. THE system SHALL send a reminder notification before the appointment (configurable: 24 hours, 2 hours, or both)
3. THE system SHALL send a notification when a booking is cancelled (to customer and affected staff)
4. THE system SHALL send a notification when a booking is rescheduled (to customer and affected staff)
5. THE system SHALL send a waitlist notification when a spot opens up
6. THE system SHALL support notification channels: email (required), SMS (optional), push (future — Phase 19)
7. THE system SHALL respect customer communication preferences (Phase 05) when sending notifications
8. THE system SHALL use localized notification content based on customer language preference (i18n)
9. THE system SHALL include an iCal attachment in confirmation emails

### Requirement 14: Time Zone Handling

**User Story:** As a business operating internationally, I want all bookings displayed in the correct local time, so that there is no confusion for staff or customers.

#### Acceptance Criteria

1. THE system SHALL store all booking times in UTC in the database
2. THE system SHALL display booking times in the tenant's configured time zone for staff
3. THE system SHALL display booking times in the customer's local time zone (detected or profile setting)
4. THE system SHALL handle daylight saving time transitions correctly
5. THE system SHALL include time zone information in booking confirmations and calendar exports
6. THE system SHALL support tenants operating in a single time zone (configured per tenant)

### Requirement 15: Conflict Detection

**User Story:** As a platform developer, I want robust conflict detection, so that double-bookings are impossible regardless of how bookings are created.

#### Acceptance Criteria

1. THE system SHALL check for staff conflicts before confirming any booking
2. THE system SHALL check for resource conflicts before confirming any booking
3. THE system SHALL check for customer conflicts (customer already booked at overlapping time)
4. THE system SHALL use database-level locking or constraints to prevent race conditions in concurrent booking attempts
5. THE system SHALL return a clear error if a conflict is detected, suggesting alternative slots
6. THE system SHALL re-validate availability at the moment of confirmation (not just when slot was displayed)

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - Authentication, RBAC, audit logging
- Phase 03: Core Platform - Tenant context, API infrastructure, i18n, configuration engine
- Phase 04: Design System - Calendar UI components, forms, modals
- Phase 05: Customer Management - Customer profiles (booking is linked to a customer)
- Phase 06: Service Management - Services, variants, staff assignment, resource assignment, cancellation policies, availability rules
- Phase 12: Staff Management - Staff schedules and availability (can be developed in parallel, interfaces defined)
- Phase 13: Resource Management - Resource schedules and availability (can be developed in parallel, interfaces defined)

## Success Criteria

- Availability engine returns correct slots considering all constraints (staff, resources, service rules, existing bookings)
- Individual, shared, group, and resource-only bookings can all be created and managed
- No double-bookings are possible even under concurrent load
- Customer booking flow completes in under 30 seconds end-to-end
- Calendar views display bookings accurately in day/week/month formats
- Waitlist promotes customers correctly when spots open
- Recurring bookings generate correct individual instances
- Notifications are sent at the right time in the right language
- All times are stored in UTC and displayed in correct local time zones

## Out of Scope

- Payment processing during booking - Phase 10 (Payment Platform) integrates with this flow
- Check-in and attendance - Phase 15 (Check-In System)
- Membership credit deduction - Phase 08 (Membership Engine)
- Event/workshop-specific booking features - Phase 14 (Events & Workshops)
- Mobile push notifications - Phase 19 (Mobile App)
- SMS notification delivery - Phase 16 (Marketing & Automation provides SMS infrastructure)

## Notes

- The availability engine is the most complex algorithm in the platform; it must be thoroughly unit tested
- Slot holding (5-minute reservation) prevents race conditions in the customer flow but needs cleanup for abandoned sessions
- Staff and resource availability are defined in Phases 12 and 13, but the Booking Engine defines the interface it expects; parallel development is possible
- Email notifications are the only required channel initially; SMS and push are added by later phases
- Calendar UI may use a library (FullCalendar or similar) — decision to be made during design phase
- Conflict detection must be bulletproof; use database transactions with row-level locking

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06, Phase 12, Phase 13
**Next Phase**: Phase 08 (Membership Engine)
