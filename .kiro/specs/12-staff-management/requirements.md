# Phase 12: Staff Management - Requirements

## Overview

This phase builds the staff profile, scheduling, availability, and permissions system. Staff are the service providers — therapists, trainers, receptionists, and managers who deliver services and operate the business. The Booking Engine (Phase 07) depends on staff availability to calculate bookable slots. This phase defines who works when, what they can do, and what services they deliver.

## Goals

- Build complete staff profiles with qualifications, certifications, and public bios
- Implement weekly availability patterns and scheduling
- Support leave management (holiday, sick, personal)
- Define staff-to-service assignment (which staff deliver which services)
- Implement staff permissions via role assignment (Phase 02 integration)
- Provide staff notifications for schedule changes and new bookings
- Build a staff self-service portal for managing their own schedule
- Support public staff directory for customer-facing views

## Glossary

- **Staff_Member**: An individual employed or contracted by a Tenant who delivers services or operates the business
- **Staff_Profile**: The complete data record for a Staff_Member including personal info, bio, qualifications, and certifications
- **Availability_Pattern**: A recurring weekly schedule defining when a Staff_Member is available to work
- **Availability_Override**: A one-time exception to the pattern (e.g., available extra on a specific Saturday)
- **Leave_Request**: A request for time off (holiday, sick, personal) that blocks availability
- **Service_Assignment**: A link between a Staff_Member and the Services they are qualified to deliver
- **Staff_Calendar**: A visual representation of a Staff_Member's schedule, bookings, and leave
- **Capacity**: The maximum number of bookings a Staff_Member can handle per day or per week

## Requirements

### Requirement 1: Staff Profile CRUD

**User Story:** As a business owner, I want to create and manage staff profiles, so that the system knows who works in my business and what they do.

#### Acceptance Criteria

1. THE system SHALL support creating a Staff_Profile with: first name, last name, email, mobile phone, date of birth, hire date, employment type (full-time, part-time, contractor), status (active, inactive, onboarding, terminated), bio (public-facing description), profile photo
2. THE system SHALL support updating any Staff_Profile field via API
3. THE system SHALL support deactivating a Staff_Member (soft-delete, removes from scheduling but preserves history)
4. THE system SHALL store all Staff_Profiles scoped to the current Tenant
5. THE system SHALL auto-generate a staff reference number per Tenant
6. THE system SHALL track `created_at`, `updated_at`, and `created_by` on every profile
7. THE system SHALL link Staff_Profile to a User account (for login and permissions)
8. THE system SHALL support staff without a User account (e.g., contractors who don't need platform access)

### Requirement 2: Qualifications and Certifications

**User Story:** As a manager, I want to track staff qualifications and certifications, so that I can ensure only qualified staff are assigned to specialized services.

#### Acceptance Criteria

1. THE system SHALL support recording qualifications per Staff_Member: qualification name, issuing body, date obtained, expiry date (if applicable), certification number, supporting document (file upload)
2. THE system SHALL support multiple qualifications per Staff_Member
3. THE system SHALL flag expiring certifications (configurable: 30, 60, 90 days before expiry)
4. THE system SHALL notify managers when staff certifications expire
5. THE system SHALL support linking qualifications to service eligibility (e.g., "Sports Massage" requires "Level 4 Massage Certification")
6. THE system SHALL prevent assigning a staff member to a service if they lack the required qualification
7. THE system SHALL display relevant qualifications on the public staff profile (if tenant enables this)

### Requirement 3: Weekly Availability Patterns

**User Story:** As a staff member, I want to set my regular working hours, so that customers can only book me when I'm available.

#### Acceptance Criteria

1. THE system SHALL support defining an Availability_Pattern per Staff_Member as a weekly recurring schedule
2. THE Availability_Pattern SHALL specify available time blocks per day of the week (e.g., Monday 9:00–17:00, Tuesday 10:00–20:00)
3. THE system SHALL support multiple time blocks per day (e.g., 9:00–12:00 and 14:00–18:00 for a split shift)
4. THE system SHALL support days with no availability (day off)
5. THE system SHALL support multiple availability patterns with effective date ranges (e.g., summer schedule vs. winter schedule)
6. THE system SHALL make the active pattern available to the Booking Engine (Phase 07) for slot calculation
7. THE system SHALL support copying/duplicating patterns for quick setup
8. THE system SHALL support a default pattern applied to new staff (configurable per tenant)

### Requirement 4: Availability Overrides

**User Story:** As a staff member, I want to adjust my availability for specific dates, so that I can work extra or block time for one-off situations.

#### Acceptance Criteria

1. THE system SHALL support creating Availability_Overrides for specific dates
2. THE Override SHALL allow: adding availability on a normally unavailable day, removing availability on a normally available day, adjusting hours for a specific day
3. THE system SHALL give overrides precedence over the recurring pattern
4. THE system SHALL support overrides with a reason (optional note)
5. THE system SHALL display overrides visually on the Staff_Calendar
6. THE system SHALL make overrides available to the Booking Engine for accurate slot calculation

### Requirement 5: Leave Management

**User Story:** As a staff member, I want to request time off, so that the system blocks my availability and I don't get booked.

#### Acceptance Criteria

1. THE system SHALL support Leave_Request types: holiday/vacation, sick leave, personal leave, training, other (configurable per tenant)
2. THE system SHALL support leave requests with: start date, end date, leave type, notes, status (pending, approved, rejected, cancelled)
3. THE system SHALL support an approval workflow: staff submits → manager approves/rejects
4. WHEN leave is approved, THE system SHALL block the staff member's availability for those dates
5. THE system SHALL prevent approving leave if the staff member has confirmed bookings on those dates (display warning, require rebooking)
6. THE system SHALL track leave balances (e.g., 25 holiday days per year) if configured per tenant
7. THE system SHALL deduct from leave balance when leave is approved
8. THE system SHALL display leave on the Staff_Calendar and team schedule view
9. THE system SHALL notify affected staff and managers of leave approvals/rejections

### Requirement 6: Service Assignment

**User Story:** As a manager, I want to assign staff to specific services, so that only qualified and designated staff appear as available for those services.

#### Acceptance Criteria

1. THE system SHALL support assigning multiple Services to a Staff_Member
2. THE system SHALL support assigning a Staff_Member to specific Service_Variants (e.g., senior therapist handles 90-min sessions only)
3. THE system SHALL use Service_Assignment to filter which staff appear in availability calculations (Phase 07)
4. THE system SHALL support a "primary" designation per service (preferred provider shown first to customers)
5. THE system SHALL validate qualification requirements when assigning staff to a service
6. THE system SHALL allow bulk assignment (assign one staff member to multiple services at once)
7. THE system SHALL display service assignments on the Staff_Profile

### Requirement 7: Location Assignment

**User Story:** As a manager with multiple locations, I want to assign staff to specific locations, so that they only appear as available at the locations where they work.

#### Acceptance Criteria

1. THE system SHALL support assigning Staff_Members to one or more locations
2. THE system SHALL scope availability by location (staff only bookable at assigned locations)
3. THE system SHALL support different availability patterns per location (e.g., Mon-Wed at Location A, Thu-Fri at Location B)
4. THE system SHALL prevent booking a staff member at a location they are not assigned to
5. THE system SHALL support a primary location per staff member

### Requirement 8: Capacity Management

**User Story:** As a manager, I want to limit how many bookings a staff member handles per day, so that I can prevent burnout and ensure quality.

#### Acceptance Criteria

1. THE system SHALL support configuring maximum bookings per day per Staff_Member
2. THE system SHALL support configuring maximum bookings per week per Staff_Member
3. THE system SHALL support configuring maximum consecutive hours without a break
4. THE system SHALL enforce capacity limits in the Booking Engine (stop showing availability when capacity is reached)
5. THE system SHALL allow manager override of capacity limits for specific situations (with audit log)
6. THE system SHALL display current utilization vs. capacity on the staff dashboard

### Requirement 9: Staff Calendar and Schedule View

**User Story:** As a staff member, I want to see my schedule clearly, so that I know my upcoming bookings, availability, and time off.

#### Acceptance Criteria

1. THE system SHALL provide a Staff_Calendar showing: confirmed bookings (with service, customer, and time), availability blocks, leave/time off, blocked time (overrides), buffer/break times
2. THE system SHALL support day, week, and month views
3. THE system SHALL color-code entries by type (booking, available, leave, blocked)
4. THE system SHALL support a team view showing all staff schedules side-by-side (manager view)
5. THE system SHALL support filtering the team view by location, service, or staff member
6. THE system SHALL update in near-real-time when bookings are created or cancelled

### Requirement 10: Staff Notifications

**User Story:** As a staff member, I want to be notified about schedule changes, so that I'm always aware of new bookings, cancellations, and approvals.

#### Acceptance Criteria

1. THE system SHALL notify staff when a new booking is assigned to them
2. THE system SHALL notify staff when a booking assigned to them is cancelled or rescheduled
3. THE system SHALL notify staff when their leave request is approved or rejected
4. THE system SHALL notify staff of schedule changes made by a manager
5. THE system SHALL notify managers when a staff member's certification is expiring
6. THE system SHALL support notification channels: email (required), in-app (required), SMS (optional)
7. THE system SHALL respect staff notification preferences
8. THE system SHALL use localized notification content (i18n)

### Requirement 11: Staff Self-Service Portal

**User Story:** As a staff member, I want to manage my own schedule within defined boundaries, so that I have flexibility without needing to go through a manager for every change.

#### Acceptance Criteria

1. THE system SHALL allow staff to view their own schedule and upcoming bookings
2. THE system SHALL allow staff to submit leave requests
3. THE system SHALL allow staff to set availability overrides within their assigned hours
4. THE system SHALL allow staff to update their own profile information (bio, photo, contact)
5. THE system SHALL allow staff to view their performance metrics (sessions delivered, revenue generated)
6. THE system SHALL NOT allow staff to change their service assignments or capacity limits
7. THE system SHALL NOT allow staff to modify other staff members' profiles or schedules
8. THE system SHALL scope self-service access via RBAC (Phase 02)

### Requirement 12: Public Staff Directory

**User Story:** As a customer, I want to see who works at the business, so that I can choose a preferred provider or learn about staff qualifications.

#### Acceptance Criteria

1. THE system SHALL provide a public-facing staff directory (no authentication required)
2. THE directory SHALL display: name, photo, bio, languages spoken, and qualifications (configurable per tenant)
3. THE directory SHALL only show staff marked as "visible on directory"
4. THE directory SHALL support filtering by service (show staff who deliver a specific service)
5. THE directory SHALL support filtering by location
6. THE directory SHALL link to the booking flow (book with this staff member)
7. THE tenant SHALL configure which profile fields are publicly visible

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner, file storage (photos, documents)
- Phase 02: Security & Compliance - RBAC (role assignment for staff), audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, API infrastructure
- Phase 04: Design System - Calendar components, profile views, forms
- Phase 06: Service Management - Services (for staff-to-service assignment)
- Phase 07: Booking Engine - Consumes staff availability for slot calculation

## Success Criteria

- Staff profiles can be created with qualifications, bios, and photos
- Weekly availability patterns correctly define bookable hours
- Overrides and leave block availability as expected
- Booking Engine receives accurate staff availability data
- Capacity limits prevent over-scheduling
- Leave approval workflow functions with notifications
- Staff self-service portal allows schedule management within boundaries
- Public directory displays configured staff information to customers
- All staff data is strictly tenant-scoped

## Out of Scope

- Payroll calculation - Phase 11 (Accounts Payable)
- Staff performance reviews - Future HR module
- Recruitment and hiring workflow - Out of platform scope
- Shift trading between staff - Future enhancement
- GPS/location tracking - Not applicable

## Notes

- Staff availability is one of the three inputs to the Booking Engine's slot calculation (along with service rules and resource availability)
- The Availability_Pattern + Override model is proven in Gold Mine and Caterra — reuse the same approach
- Staff without User accounts (contractors) can have profiles and be scheduled, but can't log in
- Qualification-to-service linking ensures safety in wellness/therapy contexts (only certified staff deliver regulated services)
- Multi-location staff need per-location patterns; this adds complexity but is essential for growth
- Public directory is optional per tenant — some businesses prefer not to show staff externally

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 06, Phase 07
**Next Phase**: Phase 13 (Resource Management)
