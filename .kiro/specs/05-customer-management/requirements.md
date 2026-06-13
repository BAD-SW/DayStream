# Phase 05: Customer Management (CRM) - Requirements

## Overview

This phase builds the customer profile system, contact management, segmentation engine, and customer lifecycle tracking. Customers are the central entity that bookings, memberships, payments, and communications revolve around. Customers belong to a specific Business — if the same individual interacts with a different Business within the same Tenant, they are a separate customer record. The CRM must support wellness-specific data (goals, injuries, recovery focus) while remaining flexible for other business types (yoga studios, gyms, clinics).

## Goals

- Build complete customer profile CRUD with personal, contact, and wellness information
- Implement customer search, filtering, and segmentation at the business level
- Support customer lifecycle tracking (lead → trial → active → churned) per business
- Enable tagging (manual and automated) for marketing and operations
- Build activity timeline per customer per business
- Support customer import/export and duplicate detection
- Ensure all customer data is tenant-scoped with business-level access control and GDPR-compliant

## Glossary

- **Customer**: An individual who books services, holds memberships, or interacts with a Business. A Customer belongs to a single Business. If the same individual uses a different Business within the same Tenant, they are a separate Customer record.
- **Customer_Profile**: The complete data record for a Customer including personal info, contact, preferences, and wellness notes
- **Business**: The specific business within a Tenant that the Customer belongs to. Customer data is scoped to the Business level.
- **Segment**: A dynamic group of Customers defined by filter criteria, scoped per Business
- **Tag**: A label applied to a Customer for categorization (manual or automated)
- **Activity_Timeline**: A chronological feed of all actions and events related to a Customer
- **Lead**: A prospective Customer who has not yet booked or purchased
- **Lifecycle_Stage**: The current stage of a Customer's relationship (lead, trial, active, at-risk, churned, winback)
- **PII**: Personally Identifiable Information subject to GDPR protections
- **Consent_Record**: A timestamped record of a Customer's consent for data processing

## Requirements

### Requirement 1: Customer Profile CRUD

**User Story:** As a receptionist, I want to create and manage customer profiles, so that I have all relevant information when a customer visits or calls.

#### Acceptance Criteria

1. THE system SHALL support creating a Customer_Profile with: first name, last name, email, mobile phone, date of birth, gender, preferred language, country
2. THE system SHALL support updating any Customer_Profile field via API
3. THE system SHALL support archiving (soft-delete) a Customer_Profile
4. THE system SHALL support anonymizing a Customer_Profile (GDPR right to erasure) — replacing all PII with "[deleted]" while retaining non-identifying transaction history
5. WHEN anonymizing, THE system SHALL log the date, time, and user who performed the action in the audit trail
6. WHEN anonymizing, THE system SHALL retain financial records as required by law but strip all personally identifiable information
7. THE system SHALL enforce unique email per Business (no duplicate customers with same email within a single Business)
5. THE system SHALL store all Customer_Profiles scoped to a specific Business (business_id on every customer record)
6. THE system SHALL auto-generate a customer reference number per Business (e.g., CUST-0001)
7. THE system SHALL track `created_at`, `updated_at`, and `created_by` on every profile
8. THE system SHALL support an optional profile photo/avatar
9. THE system SHALL support custom fields configurable per Business (key-value pairs for business-specific data)
10. THE system SHALL scope Business User access to only see customers belonging to their Business

### Requirement 2: Customer Notes and Records

**User Story:** As a service provider, I want to record notes, history, and relevant details about a customer, so that I can provide informed and personalized service.

#### Acceptance Criteria

1. THE system SHALL support storing categorized notes per Customer (e.g., service history, preferences, special requirements, medical/health info, vehicle details, pet details — depending on business type)
2. THE system SHALL encrypt sensitive notes at the application level before database storage (field-level encryption)
3. THE system SHALL restrict access to sensitive notes based on role (configurable per Business)
4. THE system SHALL log all access to sensitive notes in the audit trail
5. THE system SHALL support timestamped note entries (append-only note log)
6. THE system SHALL allow Customers to view their own notes via the customer portal (configurable: Business Owner decides which note categories are customer-visible)
7. THE system SHALL support attaching categories/tags to notes (Business-defined categories, e.g., "allergies", "vehicle info", "preferences", "goals")
8. THE system SHALL allow Businesses to define their own note categories relevant to their industry

### Requirement 3: Customer Search and Filtering

**User Story:** As a staff member, I want to quickly find customers by name, email, or phone, so that I can pull up their profile during a call or visit.

#### Acceptance Criteria

1. THE system SHALL support full-text search across customer name, email, and phone number
2. THE system SHALL return search results within 500ms for up to 10,000 customers per business
3. THE system SHALL support filtering customers by: lifecycle stage, membership status, tag, last visit date, registration date, language
4. THE system SHALL support combining multiple filters (AND logic)
5. THE system SHALL support sorting results by: name, last visit, registration date, total spend
6. THE system SHALL paginate search results with configurable page size
7. THE system SHALL highlight matching text in search results
8. THE system SHALL scope search results to the current Business

### Requirement 4: Customer Segmentation Engine

**User Story:** As a business staff member, I want to define customer segments based on behavior and attributes, so that I can target marketing campaigns and identify trends.

#### Acceptance Criteria

1. THE system SHALL support defining Segments with filter rules on: membership type, attendance frequency, total revenue, last visit date, lifecycle stage, tags, age range, registration date
2. THE system SHALL support AND/OR logic for combining segment rules
3. THE system SHALL calculate segment membership dynamically (not pre-computed, evaluated at query time)
4. THE system SHALL support saving named Segments for reuse, scoped per Business
5. THE system SHALL display segment member count when viewing a Segment
6. THE system SHALL provide predefined Segments: "New this month", "No visit in 30 days", "High value (top 10% spend)", "At risk (no visit in 60 days)"
7. THE system SHALL support exporting a Segment's customer list (for marketing phases)
8. THE system SHALL scope segment data to the current Business for Business Users

### Requirement 5: Customer Tags

**User Story:** As a manager, I want to tag customers with labels, so that I can categorize them for operational and marketing purposes.

#### Acceptance Criteria

1. THE system SHALL support creating custom tags per Business
2. THE system SHALL support assigning multiple tags to a Customer within a Business context
3. THE system SHALL support removing tags from a Customer
4. THE system SHALL support manual tag assignment by staff
5. THE system SHALL support automated tag assignment based on rules (e.g., "VIP" after 50 visits, "New" for first 30 days)
6. THE system SHALL display tags on the Customer_Profile and in search results
7. THE system SHALL support filtering customers by tag in search and segmentation
8. THE system SHALL support tag colors for visual differentiation

### Requirement 6: Activity Timeline

**User Story:** As a staff member, I want to see a customer's complete history at a glance, so that I can provide informed service.

#### Acceptance Criteria

1. THE system SHALL display a chronological Activity_Timeline on each Customer_Profile
2. THE Activity_Timeline SHALL include: bookings (booked, attended, cancelled, no-show), membership changes (joined, renewed, cancelled, paused), payments (charged, refunded), communications (emails sent, SMS sent), profile changes, wellness note additions, check-ins
3. THE Activity_Timeline SHALL support filtering by activity type
4. THE Activity_Timeline SHALL support date range filtering
5. THE Activity_Timeline SHALL paginate for customers with extensive history
6. THE Activity_Timeline SHALL display the most recent activities first
7. THE Activity_Timeline SHALL be populated automatically from other modules (booking, payment, membership events)

### Requirement 7: Customer Lifecycle Tracking

**User Story:** As a staff member, I want to track where each customer is in their journey, so that I can identify opportunities and risks.

#### Acceptance Criteria

1. THE system SHALL define lifecycle stages: Lead, Trial, Active, At-Risk, Churned, Winback
2. THE system SHALL automatically transition customers between stages based on configurable rules:
   - Lead → Trial: first booking made
   - Trial → Active: membership purchased or 3+ visits
   - Active → At-Risk: no visit in configurable days (default 30)
   - At-Risk → Churned: no visit in configurable days (default 90)
   - Churned → Winback: returns after being churned
3. THE system SHALL support manual lifecycle stage override by staff
4. THE system SHALL log lifecycle stage transitions in the Activity_Timeline
5. THE system SHALL support viewing customer counts per lifecycle stage (pipeline view)
6. THE system SHALL support configuring transition rules per Business
7. THE system SHALL track lifecycle stage per customer (scoped to the Business the customer belongs to)

### Requirement 8: Customer Import and Export

**User Story:** As a staff member, I want to import existing customers from a spreadsheet or csv, so that I can migrate from another system without manual data entry.

#### Acceptance Criteria

1. THE system SHALL support importing customers from CSV files
2. THE system SHALL support column mapping during import (map CSV columns to Customer_Profile fields)
3. THE system SHALL validate imported data against the same rules as manual creation
4. THE system SHALL report import errors with row numbers and field-level details
5. THE system SHALL support dry-run mode (validate without saving)
6. THE system SHALL support exporting all customers or a filtered set to CSV
7. THE system SHALL export in GDPR-compliant format when requested (right to data portability)
8. THE system SHALL log import operations in the audit trail with record counts

### Requirement 9: Duplicate Detection and Merge

**User Story:** As a staff member, I want the system to detect potential duplicate customers, so that I don't create multiple records for the same person.

#### Acceptance Criteria

1. THE system SHALL check for potential duplicates when creating a new customer (matching on email, phone, or name similarity within the Business)
2. THE system SHALL display potential matches and allow the user to proceed or link to existing
3. THE system SHALL support merging two Customer_Profiles into one within the same Business (staff-initiated)
4. WHEN merging, THE system SHALL combine Activity_Timelines, bookings, memberships, and payment history
5. WHEN merging, THE system SHALL allow selecting which profile fields to keep
6. THE system SHALL log merge operations in the audit trail with both original record IDs
7. THE system SHALL prevent merging customers across different Businesses or Tenants

### Requirement 10: Communication Preferences and Consent

**User Story:** As a customer, I want to control how the business communicates with me, so that I only receive messages I've opted into.

#### Acceptance Criteria

1. THE system SHALL store communication preferences per Customer: email marketing (opt-in/out), SMS marketing (opt-in/out), push notifications (opt-in/out), booking reminders (on/off)
2. THE system SHALL record Consent_Records with timestamp, purpose, and method of consent
3. THE system SHALL respect opt-out preferences in all marketing modules (Phase 16)
4. THE system SHALL provide a customer-facing preference management interface
5. THE system SHALL support an unsubscribe link in marketing communications that updates preferences
6. THE system SHALL log all preference changes in the audit trail
7. THE system SHALL default to opted-out for marketing communications (GDPR: opt-in required)

### Requirement 11: Customer Portal Access

**User Story:** As a customer, I want to view and update my own profile, so that my information stays current without needing to call the business.

#### Acceptance Criteria

1. THE system SHALL allow authenticated Customers to view their own profile
2. THE system SHALL allow Customers to update their contact information (email, phone, address)
3. THE system SHALL allow Customers to update their communication preferences
4. THE system SHALL allow Customers to view their own wellness notes (read-only)
5. THE system SHALL allow Customers to view their Activity_Timeline
6. THE system SHALL allow Customers to request data export (GDPR right to access)
7. THE system SHALL allow Customers to request account deletion (GDPR right to erasure)
8. THE system SHALL NOT allow Customers to modify their lifecycle stage, tags, or internal notes

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - Authentication, RBAC, audit logging, GDPR features, field-level encryption
- Phase 03: Core Platform - Tenant context, API infrastructure, i18n, configuration engine
- Phase 04: Design System - UI components for profile views, forms, tables, timelines

## Success Criteria

- Customer profiles can be created, searched, filtered, and updated
- Business Users only see customers belonging to their Business
- Tenant Users do not have access to customer-level data (administrative role only)
- Sensitive notes are encrypted and access-controlled
- Segmentation engine returns correct customer sets based on filter criteria
- Activity timeline aggregates events from across the platform
- Lifecycle stages transition automatically based on configured rules per Business
- CSV import handles 10,000 records with validation and error reporting
- Duplicate detection catches matching email/phone on creation within a Business
- GDPR export and deletion requests function correctly
- All customer data is scoped to a specific Business within a Tenant

## Out of Scope

- Marketing campaign execution - Phase 16 (Marketing & Automation)
- Booking history display - Phase 07 (populated by Booking Engine)
- Membership data - Phase 08 (populated by Membership Engine)
- Payment history - Phase 10 (populated by Payment Platform)
- Customer-to-customer social features - Phase 22 (Community)

## Notes

- Wellness notes require field-level encryption due to sensitivity (even pre-HIPAA)
- Segmentation is evaluated at query time to avoid stale data; caching can be added later if performance requires
- Activity_Timeline is an aggregation view — events are written by other modules and read here
- Custom fields per Business enable flexibility without schema changes for each business type
- The Customer entity is referenced by nearly every other module; its schema must be stable early
- Customers belong to a single Business. If the same individual uses multiple Businesses within a Tenant, they are separate customer records (potentially with the same personal information).
- Tenant Users do not have access to customer data — they are administrative and do not interact with business-level details
- Business Users see only their Business's customers

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04
**Next Phase**: Phase 06 (Service Management)
