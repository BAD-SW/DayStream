# Phase 13: Resource Management - Requirements

## Overview

This phase builds the system for managing physical resources — rooms, equipment, and facilities — and preventing scheduling conflicts. Resources are the third input to the Booking Engine's availability calculation (alongside staff schedules and service rules). A massage can't be booked if the massage room is occupied. A Float Tank session can't overlap with another. Compression boots can't serve two customers at the same time. This phase ensures physical constraints are respected.

## Goals

- Build resource CRUD (rooms, equipment, facilities)
- Implement resource scheduling and availability
- Prevent double-booking of physical resources
- Support service-to-resource linking (which services require which resources)
- Handle resource capacity (some resources serve multiple customers simultaneously)
- Support maintenance windows and blocked time
- Provide resource utilization tracking
- Support multi-location resource management

## Glossary

- **Resource**: A physical room, piece of equipment, or facility that can be booked or required for a service
- **Resource_Type**: A classification of resources (Room, Equipment, Facility)
- **Resource_Schedule**: The operating hours and availability for a Resource
- **Resource_Booking**: A time-blocked reservation of a Resource (linked to a service booking or maintenance)
- **Maintenance_Window**: A blocked time period for cleaning, repair, or preparation between uses
- **Resource_Conflict**: An attempted booking that overlaps with an existing reservation of the same Resource
- **Resource_Capacity**: The number of simultaneous customers/bookings a Resource can support
- **Utilization_Rate**: The percentage of available time a Resource is actually booked

## Requirements

### Requirement 1: Resource CRUD

**User Story:** As a business owner, I want to register and manage my physical resources, so that the system knows what facilities and equipment I have.

#### Acceptance Criteria

1. THE system SHALL support creating Resources with: name, description, resource type (room, equipment, facility), location assignment, capacity (number of concurrent users), status (active, inactive, maintenance), photo (optional)
2. THE system SHALL support updating any Resource field via API
3. THE system SHALL support deactivating a Resource (soft-delete, preserves booking history)
4. THE system SHALL store all Resources scoped to the current Tenant
5. THE system SHALL support a display order for presentation in the UI
6. THE system SHALL track `created_at`, `updated_at` on every Resource
7. THE system SHALL support grouping Resources by location (for multi-location tenants)
8. THE system SHALL support custom attributes per Resource (e.g., temperature setting for sauna, size for room)

### Requirement 2: Resource Types and Categories

**User Story:** As a business owner, I want to categorize my resources, so that I can manage and report on them by type.

#### Acceptance Criteria

1. THE system SHALL provide default Resource_Types: Room (e.g., Float Room, Massage Room, Gym Room, Treatment Room), Equipment (e.g., Sauna, Cold Bath, Jacuzzi, Compression Boots, Red Light Cabin), Facility (e.g., Pool, Courtyard, Parking)
2. THE system SHALL support creating custom Resource_Types per Tenant
3. THE system SHALL require assigning every Resource to exactly one Resource_Type
4. THE system SHALL support filtering and reporting by Resource_Type
5. THE system SHALL display resource counts per type

### Requirement 3: Resource Scheduling

**User Story:** As a manager, I want to define when resources are available, so that bookings only happen during operating hours.

#### Acceptance Criteria

1. THE system SHALL support defining operating hours per Resource (weekly recurring pattern)
2. THE system SHALL support different hours per day of the week
3. THE system SHALL support blocking specific dates (holidays, closures)
4. THE system SHALL support seasonal schedules with effective date ranges
5. THE system SHALL make resource schedules available to the Booking Engine (Phase 07) for slot calculation
6. THE system SHALL support a "24/7 available" option for resources with no hour restrictions
7. THE system SHALL inherit default operating hours from the tenant's business hours (overridable per resource)

### Requirement 4: Service-to-Resource Linking

**User Story:** As a business owner, I want to specify which resources each service requires, so that the booking engine automatically reserves the right room or equipment.

#### Acceptance Criteria

1. THE system SHALL support linking one or more Resources to a Service (Phase 06)
2. THE system SHALL support "required" resources (must be available for the service to be bookable)
3. THE system SHALL support "preferred" resources (used if available, otherwise alternative)
4. THE system SHALL support "any of type" assignments (e.g., service needs "any Massage Room" — system picks an available one)
5. THE system SHALL support resource requirements per Service_Variant (e.g., 90-min massage needs the larger room)
6. THE system SHALL communicate resource requirements to the Booking Engine for availability calculation
7. THE system SHALL automatically reserve the required resource when a booking is confirmed

### Requirement 5: Conflict Prevention

**User Story:** As a platform operator, I want to guarantee that no resource is double-booked, so that scheduling conflicts are impossible.

#### Acceptance Criteria

1. THE system SHALL check for resource availability before confirming any booking
2. THE system SHALL prevent overlapping Resource_Bookings for the same Resource (exclusive-use resources)
3. THE system SHALL respect buffer/maintenance time between bookings (no back-to-back if buffer is configured)
4. THE system SHALL use database-level constraints or locking to prevent race conditions
5. THE system SHALL return a clear error if a conflict is detected, suggesting alternative times or resources
6. THE system SHALL re-validate resource availability at the moment of booking confirmation (not just when slot was displayed)
7. THE system SHALL handle concurrent booking attempts for the same resource safely

### Requirement 6: Resource Capacity (Shared Resources)

**User Story:** As a business owner, I want some resources to serve multiple customers simultaneously (e.g., sauna fits 6 people), so that shared sessions are scheduled correctly.

#### Acceptance Criteria

1. THE system SHALL support a capacity field per Resource (number of concurrent users)
2. THE system SHALL allow multiple bookings on a shared resource up to its capacity limit
3. THE system SHALL block further bookings when capacity is reached for a given time slot
4. THE system SHALL display remaining capacity to customers ("3 spots left in sauna")
5. THE system SHALL support capacity overrides per time slot (e.g., reduced capacity during maintenance)
6. THE system SHALL distinguish between exclusive resources (capacity = 1) and shared resources (capacity > 1)

### Requirement 7: Maintenance Windows

**User Story:** As a manager, I want to schedule maintenance time between bookings, so that rooms can be cleaned and equipment prepared.

#### Acceptance Criteria

1. THE system SHALL support configuring a Maintenance_Window per Resource: fixed time after each booking (e.g., 15 minutes for room turnover), scheduled maintenance blocks (e.g., deep clean every Friday 18:00–20:00), ad-hoc maintenance (one-time block for repair)
2. THE system SHALL enforce maintenance windows in availability calculations (no bookings during maintenance)
3. THE system SHALL display maintenance blocks on the resource calendar
4. THE system SHALL support different buffer times based on the service type (e.g., float tank needs 30 min, massage room needs 15 min)
5. THE system SHALL support configuring buffer time on the service-resource link (not just globally on the resource)
6. THE system SHALL notify staff when a maintenance window approaches

### Requirement 8: Resource Calendar View

**User Story:** As a manager, I want to see the schedule for each resource, so that I can spot availability gaps and utilization issues.

#### Acceptance Criteria

1. THE system SHALL provide a Resource calendar showing all bookings and maintenance blocks per Resource
2. THE system SHALL support day, week, and month views
3. THE system SHALL support a combined view showing all resources side-by-side (timeline view)
4. THE system SHALL color-code entries: booked (by service type), maintenance, available, offline
5. THE system SHALL display customer name and service on each booking block
6. THE system SHALL support filtering by resource type, location, or specific resource
7. THE system SHALL allow clicking an available slot to create a new booking

### Requirement 9: Resource Utilization Tracking

**User Story:** As a business owner, I want to see how much each resource is being used, so that I can identify underutilized assets or capacity constraints.

#### Acceptance Criteria

1. THE system SHALL calculate Utilization_Rate per Resource: (booked hours / available hours) × 100%
2. THE system SHALL report utilization by: day, week, month, custom date range
3. THE system SHALL report peak usage times per resource (busiest hours/days)
4. THE system SHALL report underutilized resources (below configurable threshold, e.g., < 40% utilization)
5. THE system SHALL report over-utilized resources (consistently at capacity)
6. THE system SHALL support comparison between resources of the same type
7. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)

### Requirement 10: Multi-Location Resource Management

**User Story:** As a business owner with multiple locations, I want resources tracked per location, so that scheduling respects physical locations.

#### Acceptance Criteria

1. THE system SHALL assign every Resource to exactly one location
2. THE system SHALL scope resource availability by location in the Booking Engine
3. THE system SHALL prevent booking a resource at a different location from the selected service location
4. THE system SHALL support viewing resources filtered by location
5. THE system SHALL support identical resource names at different locations (e.g., "Massage Room 1" at both locations)
6. THE system SHALL report utilization per location and across locations

### Requirement 11: Resource Dependencies

**User Story:** As a manager, I want to define that some resources depend on others, so that booking one automatically reserves its dependencies.

#### Acceptance Criteria

1. THE system SHALL support defining resource dependencies (e.g., "Float Tank" requires "Float Room" and "Shower Room for 10 min after")
2. THE system SHALL automatically reserve dependent resources when the primary resource is booked
3. THE system SHALL check availability of all dependent resources before confirming
4. THE system SHALL release dependent resources when the primary booking is cancelled
5. THE system SHALL display dependencies in the resource configuration

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner, file storage (photos)
- Phase 02: Security & Compliance - RBAC, audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n
- Phase 04: Design System - Calendar components, timeline views
- Phase 06: Service Management - Services (service-to-resource linking)
- Phase 07: Booking Engine - Consumes resource availability for slot calculation

## Success Criteria

- Resources can be created, categorized, and assigned to services
- Availability engine correctly respects resource schedules and existing bookings
- No double-booking of exclusive resources is possible under any circumstance
- Shared resources correctly track remaining capacity
- Maintenance windows block bookings as expected
- Resource calendar displays accurate booking and availability data
- Utilization metrics provide actionable insights
- Multi-location resources are correctly scoped
- Resource dependencies are automatically reserved together
- All resource data is strictly tenant-scoped

## Out of Scope

- IoT/sensor integration (automated room availability detection) - Future enhancement
- Resource purchase/procurement tracking - Phase 11 handles expense/vendor management
- Resource depreciation or asset valuation - Future finance enhancement
- Customer self-service equipment booking without a service - Requires service or pass; not standalone

## Notes

- Resources are the third leg of the availability triangle: Staff + Resources + Service Rules = Available Slots
- The conflict prevention logic must be bulletproof — use database transactions with row-level locking, same as booking engine
- Buffer/maintenance times vary: float tank needs 30 min between uses (drain, clean, refill), massage room needs 15 min, sauna needs minimal turnaround
- Resource dependencies handle complex scenarios (float tank = tank + room + post-shower time in adjacent bathroom)
- During local development, image storage uses local filesystem (AWS S3 migration tracked in MIGRATION_TRACKER.md)
- Utilization data is critical for business owners to justify equipment investment

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 06, Phase 07
**Next Phase**: Phase 14 (Events & Workshops)
