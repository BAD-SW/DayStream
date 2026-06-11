# Phase 06: Service Management - Requirements

## Overview

This phase builds the dynamic service engine allowing businesses to create, configure, categorize, and publish their service offerings. Services are the core product of every tenant — what customers browse, book, and pay for. The engine must be flexible enough to support recovery centers (Fire & Ice sessions, float tanks), yoga studios (classes), gyms (personal training), clinics (treatments), and any other wellness-oriented business type.

## Goals

- Build complete service CRUD with rich configuration options
- Implement hierarchical service categories
- Support multiple pricing variants per service (duration-based, package-based)
- Enable staff and resource assignment per service
- Build a public-facing service catalog (browsable, filterable)
- Support service templates for common business types
- Ensure all service data is tenant-scoped and configurable

## Glossary

- **Service**: A bookable offering provided by a Tenant (e.g., Sports Massage, Fire & Ice, Float Tank)
- **Service_Category**: A grouping of related Services (e.g., Recovery Services, Treatments, Coaching)
- **Service_Variant**: A pricing/duration option for a Service (e.g., 30 min, 60 min, 90 min)
- **Service_Catalog**: The public-facing browsable list of active Services for a Tenant
- **Service_Template**: A pre-configured Service definition for common business types
- **Booking_Type**: The scheduling model for a Service (individual, shared, group, resource)
- **Cancellation_Policy**: Rules governing cancellation fees and deadlines per Service
- **Service_Image**: A photo or visual asset associated with a Service

## Requirements

### Requirement 1: Service CRUD

**User Story:** As a business owner, I want to create and manage my service offerings, so that customers can see what my business provides.

#### Acceptance Criteria

1. THE system SHALL support creating a Service with: name, description, short description, booking type, status (draft, active, archived)
2. THE system SHALL support updating any Service field via API
3. THE system SHALL support archiving a Service (soft-delete, no longer bookable but history preserved)
4. THE system SHALL support restoring an archived Service to active
5. THE system SHALL store all Services scoped to the current Tenant
6. THE system SHALL support a display order field for controlling presentation sequence within a category
7. THE system SHALL track `created_at`, `updated_at`, and `created_by` on every Service
8. THE system SHALL validate that Service names are unique within a Tenant (within same category)
9. THE system SHALL support a URL-friendly slug per Service (auto-generated from name, editable)

### Requirement 2: Service Categories

**User Story:** As a business owner, I want to organize my services into categories, so that customers can browse them logically.

#### Acceptance Criteria

1. THE system SHALL support creating Service_Categories with: name, description, icon, display order, status
2. THE system SHALL support up to two levels of category hierarchy (parent category → subcategory)
3. THE system SHALL assign every Service to exactly one Service_Category
4. THE system SHALL support moving a Service between categories
5. THE system SHALL support reordering categories via display order
6. THE system SHALL provide default categories per business type: Recovery Services, Treatments, Coaching, Events, Fitness, Wellness
7. THE system SHALL allow Tenants to create custom categories
8. THE system SHALL display category counts (number of active services per category)

### Requirement 3: Service Configuration

**User Story:** As a business owner, I want to configure the details of each service, so that the booking engine knows how to schedule it correctly.

#### Acceptance Criteria

1. THE system SHALL support configuring per Service: default duration (minutes), buffer time before/after (minutes for cleanup/prep), maximum capacity (number of simultaneous customers), minimum advance booking time (hours), maximum advance booking time (days), booking type (individual, shared, group, resource-only)
2. THE system SHALL support configuring location assignment (which locations offer this service)
3. THE system SHALL support configuring resource requirements (which rooms/equipment are needed)
4. THE system SHALL support configuring staff assignment (which staff can deliver this service)
5. THE system SHALL support marking a service as "online booking enabled" or "reception-only"
6. THE system SHALL support a "preparation notes" field visible only to staff (internal instructions)
7. THE system SHALL validate configuration consistency (e.g., capacity > 0 for shared sessions)

### Requirement 4: Service Variants and Pricing

**User Story:** As a business owner, I want to offer different durations and price points for a single service, so that customers can choose what fits their needs and budget.

#### Acceptance Criteria

1. THE system SHALL support multiple Service_Variants per Service (e.g., 30 min / €45, 60 min / €75, 90 min / €105)
2. Each Service_Variant SHALL have: name/label, duration (minutes), base price (stored as cents/minor currency units), status (active/inactive)
3. THE system SHALL support at least one active variant per active Service
4. THE system SHALL support reordering variants via display order
5. THE system SHALL support variant-specific capacity overrides (if different from service default)
6. THE system SHALL support variant-specific resource requirements (if different from service default)
7. THE system SHALL integrate with the Pricing Engine (Phase 09) for dynamic/promotional pricing

### Requirement 5: Service Images and Media

**User Story:** As a business owner, I want to add photos to my services, so that customers can see what to expect before booking.

#### Acceptance Criteria

1. THE system SHALL support uploading multiple images per Service (minimum 1, maximum 10)
2. THE system SHALL designate one image as the primary/hero image
3. THE system SHALL support image reordering
4. THE system SHALL store images in tenant-scoped storage paths
5. THE system SHALL generate responsive image sizes (thumbnail, medium, large) on upload
6. THE system SHALL validate image uploads: accepted formats (JPEG, PNG, WebP), maximum file size (5MB), minimum dimensions (400x300px)
7. THE system SHALL support alt text per image for accessibility

### Requirement 6: Staff Assignment

**User Story:** As a manager, I want to assign specific staff members to services, so that only qualified staff appear as available for those services.

#### Acceptance Criteria

1. THE system SHALL support assigning multiple staff members to a Service
2. THE system SHALL support assigning staff to specific Service_Variants (e.g., senior therapist for 90-min only)
3. THE system SHALL display assigned staff on the Service detail page (customer-facing, optional per tenant config)
4. THE system SHALL use staff assignments to determine availability in the Booking Engine (Phase 07)
5. THE system SHALL prevent booking a Service with no assigned and available staff
6. THE system SHALL support a "primary provider" designation per Service (preferred staff shown first)
7. THE system SHALL allow customers to request a specific staff member when booking (if tenant enables this)

### Requirement 7: Cancellation Policies

**User Story:** As a business owner, I want to define cancellation rules per service, so that customers understand the terms and my business is protected from late cancellations.

#### Acceptance Criteria

1. THE system SHALL support defining a Cancellation_Policy per Service (or inherit from tenant default)
2. THE Cancellation_Policy SHALL specify: free cancellation window (hours before appointment), late cancellation fee (percentage or fixed amount), no-show fee (percentage or fixed amount)
3. THE system SHALL display the cancellation policy to customers during booking
4. THE system SHALL enforce the cancellation policy when a customer cancels (Phase 07 integration)
5. THE system SHALL support a tenant-wide default cancellation policy
6. THE system SHALL support per-service overrides of the default policy
7. THE system SHALL support waiving the cancellation fee (staff override with audit log entry)

### Requirement 8: Service Catalog (Customer-Facing)

**User Story:** As a customer, I want to browse available services, so that I can find and book what interests me.

#### Acceptance Criteria

1. THE system SHALL provide a public-facing Service_Catalog API endpoint (no authentication required)
2. THE Service_Catalog SHALL display only active Services with online booking enabled
3. THE Service_Catalog SHALL organize Services by category
4. THE Service_Catalog SHALL support filtering by: category, duration range, price range, available staff
5. THE Service_Catalog SHALL support text search across service names and descriptions
6. THE Service_Catalog SHALL display for each Service: name, short description, primary image, starting price, duration range, category
7. THE Service_Catalog SHALL support a detail view with: full description, all images, all variants with prices, assigned staff (if enabled), cancellation policy
8. THE Service_Catalog SHALL respect tenant configuration for what information is publicly visible
9. THE Service_Catalog SHALL include a "Book Now" action linking to the booking flow (Phase 07)

### Requirement 9: Service Templates

**User Story:** As a new tenant, I want pre-configured service templates for my business type, so that I can get started quickly without configuring everything from scratch.

#### Acceptance Criteria

1. THE system SHALL provide Service_Templates for common business types: Recovery Center, Yoga Studio, Gym/Fitness, Spa, Physiotherapy Clinic
2. Each template SHALL include: pre-defined categories, sample services with typical durations and descriptions, suggested pricing structure, default cancellation policy
3. THE system SHALL allow a tenant to apply a template during onboarding (creating services from the template)
4. THE system SHALL allow customization of all template-generated content after application
5. THE system SHALL not overwrite existing services when a template is applied (additive only)
6. THE system SHALL mark template-generated services as drafts (requiring review before publishing)

### Requirement 10: Service Availability Rules

**User Story:** As a business owner, I want to control when services are available for booking, so that I can align with my business operating hours and seasonal schedules.

#### Acceptance Criteria

1. THE system SHALL support defining available days and hours per Service (independent of staff schedules)
2. THE system SHALL support seasonal availability (e.g., outdoor services available May–September only)
3. THE system SHALL support blocking specific dates for a Service (holidays, maintenance)
4. THE system SHALL support recurring availability patterns (e.g., Fire & Ice only Tue/Thu/Sat)
5. THE system SHALL combine service availability with staff availability and resource availability to determine bookable slots (Phase 07)
6. THE system SHALL support effective date ranges for availability rules (start date, end date)
7. THE system SHALL support a service-level "pause" that temporarily removes it from booking without archiving

### Requirement 11: Tax Configuration

**User Story:** As a business owner, I want to configure tax rules for my services, so that invoices and prices display correctly for my jurisdiction.

#### Acceptance Criteria

1. THE system SHALL support assigning a tax rate to each Service
2. THE system SHALL support tax-inclusive and tax-exclusive display per Tenant configuration
3. THE system SHALL support multiple tax categories (standard rate, reduced rate, zero-rated)
4. THE system SHALL store tax rates in the database per Tenant (not hardcoded)
5. THE system SHALL calculate tax amounts correctly and include them on invoices (Phase 10 integration)
6. THE system SHALL support configuring a default tax category that applies to new services

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner, file storage
- Phase 02: Security & Compliance - RBAC (who can create/edit services), audit logging
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, API infrastructure
- Phase 04: Design System - UI components for service catalog, forms, image galleries

## Success Criteria

- Services can be created with full configuration (duration, capacity, pricing variants, images)
- Service categories organize offerings hierarchically
- Public service catalog API returns filtered, paginated results for customer browsing
- Staff and resource assignments are stored and queryable
- Cancellation policies are defined and displayed to customers
- Service templates allow quick onboarding for new tenants
- Availability rules constrain when services can be booked
- All service data is strictly tenant-scoped

## Out of Scope

- Booking flow and availability calculation - Phase 07 (Booking Engine)
- Dynamic/promotional pricing logic - Phase 09 (Pricing Engine)
- Resource CRUD (rooms, equipment) - Phase 13 (Resource Management)
- Staff profiles and scheduling - Phase 12 (Staff Management)
- Event/workshop-specific features - Phase 14 (Events & Workshops)

## Notes

- Service_Variants are the link between a service and pricing; the Pricing Engine (Phase 09) can override base prices
- Services reference staff and resources by ID; those entities are created in their respective phases
- The Service entity is central to the booking flow; its schema must support all Booking_Types
- Image storage is local filesystem during development (AWS S3 migration later — tracked in MIGRATION_TRACKER.md)
- Tax configuration is simple initially; complex multi-jurisdiction tax can be added via tax service integration later

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04
**Next Phase**: Phase 07 (Booking Engine)
