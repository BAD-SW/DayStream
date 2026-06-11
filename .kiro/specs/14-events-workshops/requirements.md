# Phase 14: Events & Workshops - Requirements

## Overview

This phase extends the booking system to support one-off and recurring events, workshops, seminars, challenges, and retreats. While standard services are ongoing offerings, events have distinct characteristics: they often have higher capacity, specialized ticketing, specific dates (not always recurring), multi-day spans, and different registration flows. Examples from Transcend include Breath & Ice Workshops and Wellness Workshops.

## Goals

- Support creating and managing events, workshops, seminars, challenges, and retreats
- Implement ticketing with multiple tier options (free, paid, early bird, member pricing)
- Support recurring events (weekly classes, monthly workshops)
- Implement event registration flow distinct from standard booking
- Support multi-day events and event series (programs)
- Handle capacity, waitlists, and cancellation for events
- Support event communications (confirmations, reminders, follow-ups)
- Provide public event calendar/listing

## Glossary

- **Event**: A time-bound happening with a specific date, capacity, and registration flow (e.g., a Breath & Ice Workshop on June 15)
- **Event_Type**: The classification of an event (Workshop, Seminar, Challenge, Retreat, Class, Webinar)
- **Event_Series**: A linked sequence of events forming a program (e.g., "6-Week Recovery Program")
- **Ticket_Tier**: A pricing/access level for an event (e.g., Early Bird, Standard, VIP, Member)
- **Registration**: A customer's confirmed spot at an event (equivalent to a booking)
- **Facilitator**: The staff member(s) leading or instructing the event
- **Event_Calendar**: A public-facing listing of upcoming events

## Requirements

### Requirement 1: Event CRUD

**User Story:** As a business owner, I want to create and manage events, so that I can offer workshops, seminars, and special experiences to my customers.

#### Acceptance Criteria

1. THE system SHALL support creating Events with: title, description (rich text), event type (workshop, seminar, challenge, retreat, class, webinar), start date and time, end date and time, location (or "online"), facilitator(s), capacity (maximum attendees), minimum attendees (threshold for event to proceed), status (draft, published, cancelled, completed), cover image, tags/categories
2. THE system SHALL support updating any Event field via API
3. THE system SHALL support cancelling an Event (notifies all registered attendees)
4. THE system SHALL store all Events scoped to the current Tenant
5. THE system SHALL support a URL-friendly slug per Event
6. THE system SHALL track registration count and remaining capacity
7. THE system SHALL support multi-day events with a start and end date spanning multiple days
8. THE system SHALL support adding multiple facilitators to an event

### Requirement 2: Recurring Events

**User Story:** As a business owner, I want to set up recurring events (weekly yoga class, monthly workshop), so that I don't have to create them manually each time.

#### Acceptance Criteria

1. THE system SHALL support creating recurring events with patterns: weekly, biweekly, monthly (same day of month), custom interval
2. THE system SHALL generate individual Event instances for each occurrence
3. THE system SHALL allow modifying a single occurrence without affecting the series
4. THE system SHALL allow cancelling a single occurrence without affecting the series
5. THE system SHALL allow cancelling the entire series (future occurrences only)
6. THE system SHALL allow modifying the series template (applies to future occurrences)
7. THE system SHALL support an end condition: number of occurrences, end date, or ongoing
8. THE system SHALL carry over settings (capacity, pricing, facilitator) from the template to each occurrence

### Requirement 3: Event Series (Programs)

**User Story:** As a business owner, I want to create multi-session programs (6-week challenge, 4-session course), so that customers commit to a structured sequence.

#### Acceptance Criteria

1. THE system SHALL support creating an Event_Series linking multiple Events as a sequence
2. THE Event_Series SHALL have: series title, description, total sessions, pricing (for the whole series or per-session)
3. THE system SHALL support registering for the entire series in one action
4. THE system SHALL track attendance per session within the series
5. THE system SHALL support drop-in registrations for individual sessions (if enabled)
6. THE system SHALL display series progress for registered customers (sessions attended / total)
7. THE system SHALL support prerequisites (must complete Session 1 before attending Session 2, if configured)

### Requirement 4: Ticketing and Pricing Tiers

**User Story:** As a business owner, I want to offer different ticket tiers for my events, so that I can reward early registration, offer member pricing, and create VIP experiences.

#### Acceptance Criteria

1. THE system SHALL support multiple Ticket_Tiers per Event: tier name (e.g., Early Bird, Standard, VIP, Member-Only), price (from Pricing Engine, Phase 09), quantity available per tier, availability window (start/end dates for when this tier can be purchased), description of what's included, eligibility rules (e.g., members only, first-time only)
2. THE system SHALL support free events (price = 0)
3. THE system SHALL integrate with the Pricing Engine (Phase 09) for dynamic pricing, discount codes, and membership pricing
4. THE system SHALL enforce tier availability windows (Early Bird closes 7 days before event)
5. THE system SHALL track tickets sold per tier
6. THE system SHALL support "sold out" display per tier when quantity is exhausted
7. THE system SHALL support member-only tiers visible only to customers with qualifying memberships

### Requirement 5: Event Registration Flow

**User Story:** As a customer, I want to register for an event easily, so that my spot is secured.

#### Acceptance Criteria

1. THE system SHALL provide a registration flow: View event details → Select ticket tier → Enter attendee info → Pay (if paid event) → Confirm
2. THE system SHALL hold a registration spot temporarily (10 minutes) while the customer completes payment
3. THE system SHALL confirm registration immediately upon successful payment (or immediately for free events)
4. THE system SHALL send a registration confirmation with event details, location, time, and any preparation instructions
5. THE system SHALL support registering multiple attendees in one transaction (group registration)
6. THE system SHALL support collecting additional information during registration (configurable fields per event, e.g., dietary requirements for retreats)
7. THE system SHALL allow customers to view their registered events in their dashboard
8. THE system SHALL generate a unique registration reference per attendee

### Requirement 6: Capacity and Waitlist

**User Story:** As a customer, I want to join a waitlist when an event is full, so that I can get a spot if someone cancels.

#### Acceptance Criteria

1. THE system SHALL enforce capacity limits per event (stop accepting registrations when full)
2. THE system SHALL display remaining capacity to customers
3. THE system SHALL support a waitlist when capacity is reached
4. THE system SHALL maintain waitlist order (first-come, first-served)
5. WHEN a spot opens (cancellation), THE system SHALL notify the next waitlisted customer
6. THE system SHALL give the notified customer a configurable time window to confirm (default: 4 hours)
7. IF the customer does not confirm, THE system SHALL move to the next waitlist entry
8. THE system SHALL display waitlist position to the customer
9. THE system SHALL support a minimum attendee threshold — if not met by a configurable deadline, event may be cancelled

### Requirement 7: Event Cancellation and Refunds

**User Story:** As a customer, I want clear cancellation terms for events, so that I know the rules before registering.

#### Acceptance Criteria

1. THE system SHALL support a cancellation policy per Event (free cancellation until X days before, partial refund, no refund)
2. THE system SHALL enforce the cancellation policy when a customer cancels their registration
3. THE system SHALL process refunds according to the policy via the Payment Platform (Phase 10)
4. THE system SHALL allow admin-initiated cancellation with optional full refund (override policy)
5. WHEN the business cancels an entire event, THE system SHALL notify all registrants and process full refunds automatically
6. THE system SHALL support transferring a registration to another customer (name change)
7. THE system SHALL log all cancellations and refunds in the audit trail

### Requirement 8: Event Check-In and Attendance

**User Story:** As a facilitator, I want to track who actually attended my event, so that I have accurate records and can follow up with no-shows.

#### Acceptance Criteria

1. THE system SHALL support marking attendees as: checked-in, no-show, late arrival
2. THE system SHALL support QR code check-in (customer presents QR, staff scans)
3. THE system SHALL support manual check-in by facilitator/reception
4. THE system SHALL record check-in timestamp
5. THE system SHALL provide an attendee list per event for the facilitator
6. THE system SHALL report attendance rate per event (attended / registered)
7. THE system SHALL log attendance in the customer's Activity_Timeline (Phase 05)

### Requirement 9: Event Communications

**User Story:** As a business owner, I want automated communications for events, so that attendees receive all the information they need before, during, and after.

#### Acceptance Criteria

1. THE system SHALL send a registration confirmation immediately upon registration
2. THE system SHALL send an event reminder (configurable: 1 day, 3 days, 1 week before)
3. THE system SHALL send a "what to bring / how to prepare" message (configurable per event, sent X days before)
4. THE system SHALL send a post-event follow-up (thank you, feedback request, next steps)
5. THE system SHALL send cancellation notifications (to individual or all attendees)
6. THE system SHALL support sending ad-hoc messages to all registrants of a specific event
7. THE system SHALL respect customer communication preferences (Phase 05)
8. THE system SHALL use localized content (i18n)

### Requirement 10: Public Event Calendar

**User Story:** As a customer, I want to browse upcoming events, so that I can find workshops and experiences that interest me.

#### Acceptance Criteria

1. THE system SHALL provide a public-facing Event_Calendar (no authentication required)
2. THE Event_Calendar SHALL display only published, future events
3. THE Event_Calendar SHALL support view modes: list view (chronological), calendar view (month grid), card grid
4. THE Event_Calendar SHALL support filtering by: event type, date range, facilitator, category/tag, availability (not sold out)
5. THE Event_Calendar SHALL display for each event: title, date/time, cover image, facilitator, price (starting from), remaining capacity, event type badge
6. THE Event_Calendar SHALL support a detail view with full description, ticket tiers, facilitator bios, and registration action
7. THE Event_Calendar SHALL support sharing events (social share links)
8. THE system SHALL support embedding the event calendar on external websites (iframe or widget)

### Requirement 11: Event Reporting

**User Story:** As a business owner, I want to see event performance metrics, so that I can understand what's working and plan future events.

#### Acceptance Criteria

1. THE system SHALL report per event: total registrations, attendance rate, revenue, capacity utilization, waitlist size, cancellation rate
2. THE system SHALL report aggregated metrics: events per period, total event revenue, average attendance rate, most popular event types
3. THE system SHALL report facilitator performance (events led, average attendance, customer ratings if collected)
4. THE system SHALL support comparing events (this event vs. last time it ran)
5. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)
6. THE system SHALL support exporting attendee lists and reports to CSV

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n
- Phase 04: Design System - Calendar components, cards, registration forms
- Phase 05: Customer Management - Customer profiles (registration linked to customer), Activity_Timeline
- Phase 07: Booking Engine - Shared concepts (availability, waitlist, conflict detection); events may share resources
- Phase 09: Pricing Engine - Ticket tier pricing, discount codes, member pricing
- Phase 10: Payment Platform - Payment processing for paid events, refunds on cancellation
- Phase 13: Resource Management - Resource reservation for events requiring rooms/equipment

## Success Criteria

- Events can be created with multiple ticket tiers and published to a public calendar
- Recurring events generate correct instances on schedule
- Event series track multi-session progress per customer
- Registration flow completes with payment and confirmation
- Capacity limits and waitlists function correctly
- Cancellation policies enforce correctly with appropriate refunds
- Check-in tracks attendance accurately
- Event communications send at the right times in the right language
- Public event calendar is browsable, filterable, and embeddable
- All event data is strictly tenant-scoped

## Out of Scope

- Live streaming or virtual event hosting (Zoom integration) - Future enhancement
- Customer reviews/ratings of events - Phase 22 (Community)
- Automated event recommendation (AI) - Phase 21 (AI Features)
- Event merchandise or add-on product sales - Future ecommerce enhancement
- Sponsorship management - Out of platform scope

## Notes

- Events share many patterns with the Booking Engine (capacity, waitlist, cancellation) but have distinct needs (ticketing, series, multi-day)
- The relationship between Events and Services is architectural: events COULD be modeled as a special service type or as a separate entity. Separate entity recommended for flexibility.
- Transcend's Breath & Ice Workshops and Wellness Workshops are the initial use case
- Event_Series enables the "6-Week Challenge" or "Recovery Program" concept that builds customer commitment
- Embeddable event calendar is important for tenants who want to show events on their existing website
- Post-event communications (feedback requests) feed into future customer engagement features

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 09, Phase 10, Phase 13
**Next Phase**: Phase 15 (Check-In System)
