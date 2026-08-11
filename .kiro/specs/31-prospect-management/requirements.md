# Phase 31: Prospect Management - Requirements

## Overview

Provide tenant managers with a curated list of potential businesses in their assigned territory to accelerate sales outreach. System administrators control territory definitions and business categories. Tenant managers generate and manage their prospect lists with minimal effort.

## Goals

- Help tenant managers identify ideal DayStream customers in their territory
- Provide a low-cost, high-value prospecting tool (pennies per prospect via Google Places)
- Prevent territorial overlap by centralizing territory assignment at the system admin level
- Support global deployment (any geography where Google Maps operates)
- Enable export for use with external marketing/CRM tools

## Requirements

### Territory Management (System Admin)

#### Requirement 1: Territory Assignment

**User Story**: As a system administrator, I want to assign a geographic territory to a tenant, so that their prospect generation is scoped to a specific area.

##### Acceptance Criteria

1. THE system SHALL allow system admins to define a territory as a center point (latitude/longitude or address) plus a radius (in kilometers)
2. THE system SHALL associate exactly one territory per tenant
3. THE system SHALL allow the territory radius to range from 5km to 100km
4. THE system SHALL store the territory definition on the tenant record
5. THE system SHALL allow system admins to update or reassign a territory at any time
6. THE system SHALL display the assigned territory on the tenant detail screen

#### Requirement 2: Business Category Configuration

**User Story**: As a system administrator, I want to configure which business categories are searched, so that prospect lists contain relevant businesses.

##### Acceptance Criteria

1. THE system SHALL maintain a configurable list of Google Places types to search (e.g., spa, gym, physiotherapist, yoga_studio)
2. THE system SHALL allow system admins to manage this list globally (add/remove types)
3. THE system SHALL use all configured categories when generating prospect lists
4. THE system SHALL provide a default set of categories relevant to wellness/recovery businesses

#### Requirement 3: Coverage Map

**User Story**: As a system administrator, I want to see all territories on a map, so that I can identify areas without coverage.

##### Acceptance Criteria

1. THE system SHALL display a map view showing all assigned territories as circles (center + radius)
2. THE system SHALL label each territory with the tenant name
3. THE system SHALL visually distinguish territories (different colors or labels)
4. THE system SHALL allow system admins to zoom and pan the map
5. THE system SHALL show territories that are unassigned or pending

### Prospect Generation (Tenant Manager)

#### Requirement 4: Generate Prospect List

**User Story**: As a tenant manager, I want to press a button to generate a list of potential businesses in my territory, so that I have leads to work without manual research.

##### Acceptance Criteria

1. THE system SHALL provide a "Generate Prospects" action on the tenant manager dashboard
2. THE system SHALL query Google Places API using the tenant's assigned territory and configured categories
3. THE system SHALL store results in the database with: business name, address, phone, website, Google Place ID, category, rating, and review count
4. THE system SHALL confirm the charge before executing (tenant's payment method on file)
5. THE system SHALL display a summary of results after generation (X new prospects found)
6. THE system SHALL handle API errors gracefully with user-friendly messages

#### Requirement 5: Refresh Prospect List

**User Story**: As a tenant manager, I want to refresh my prospect list to pick up new businesses, so that my list stays current over time.

##### Acceptance Criteria

1. THE system SHALL allow the tenant manager to refresh their prospect list at any time
2. THE system SHALL deduplicate by Google Place ID (no duplicate entries)
3. THE system SHALL add only new businesses not previously found
4. THE system SHALL mark businesses no longer returned by the API as inactive
5. THE system SHALL preserve all existing curation data (status, notes) on refresh
6. THE system SHALL charge the tenant for each refresh operation

### Prospect List Management (Tenant Manager)

#### Requirement 6: View and Curate Prospects

**User Story**: As a tenant manager, I want to manage my prospect list, so that I can track outreach and focus on the best candidates.

##### Acceptance Criteria

1. THE system SHALL display prospects in a sortable, filterable table
2. THE system SHALL allow filtering by status, category, and rating
3. THE system SHALL allow the tenant manager to set a status on each prospect: New, Contacted, Demo Scheduled, Signed, Declined, Dismissed
4. THE system SHALL allow the tenant manager to add free-text notes to any prospect
5. THE system SHALL allow the tenant manager to dismiss irrelevant prospects (removes from active view but retains in database)
6. THE system SHALL show the date of last status change

#### Requirement 7: Manual Prospect Entry

**User Story**: As a tenant manager, I want to manually add prospects, so that I can track businesses I find through other channels.

##### Acceptance Criteria

1. THE system SHALL allow adding a prospect manually with: business name, address, phone, website, category, and notes
2. THE system SHALL distinguish manually added prospects from API-generated ones
3. THE system SHALL include manual prospects in all filtering and export operations

#### Requirement 8: Export Prospect List

**User Story**: As a tenant manager, I want to export my prospect list, so that I can use it with external marketing or CRM tools.

##### Acceptance Criteria

1. THE system SHALL provide a CSV export of the prospect list
2. THE system SHALL include all prospect fields in the export (name, address, phone, website, category, status, notes, rating, date added)
3. THE system SHALL respect current filters when exporting (export what's visible)
4. THE system SHALL allow exporting all prospects or only selected statuses

---

## Dependencies

- Phase 03: Core Platform (tenant/user model, system admin persona)
- Google Places API account and billing configuration
- Tenant payment method on file (for API cost pass-through)

## Success Criteria

- Tenant manager can generate a prospect list in under 30 seconds
- Prospect list contains relevant, real businesses with accurate contact info
- System admin can see all territories on a map and identify gaps
- Refresh operations only add new entries without disrupting existing curation
- Export produces a clean CSV usable in any CRM or email tool

## Out of Scope

- Automated outreach (email/SMS campaigns to prospects) — use export + external tool
- Lead scoring or AI-based prioritization — future enhancement
- Direct CRM integration (Salesforce, HubSpot) — future enhancement
- Territorial overlap prevention (advisory only via coverage map)
- Multi-territory per tenant (use larger radius or create additional tenant)

## Notes

- Google Places API cost is approximately $17 per 1,000 requests (basic details)
- A typical territory search returns 60-200 results depending on density
- Google Place ID is the unique stable identifier for deduplication
- Small businesses in the target market almost always have a Google Business listing
- The feature works globally — anywhere Google Maps has coverage

---

**Status**: 📋 Planned
**Dependencies**: Phase 03 (Core Platform)
**Next Phase**: TBD
