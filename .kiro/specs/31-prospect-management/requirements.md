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


---

# Addendum: Hybrid Multi-Source Prospect Discovery (Redesign)

**Added**: November 1, 2026
**Status**: 🔬 Evaluation → design (not yet built)

This addendum supersedes the original single-source (Google Places) discovery approach.
The territory-definition process (Phase 1 — resolve area → boundary polygon → H3 tiling →
population filter) is considered sound and is **retained unchanged**. Only the *discovery*
and *storage/reconcile* of businesses is being re-engineered.

## Why change

The original design used Google Places as the sole source. Two problems surfaced in use:

1. **Completeness is unreliable.** Google Places is a maps/discovery API (60-result cap on
   legacy, 20 on the new API), not a business directory. The recursive H3 drill-down built
   to work around the cap depends on Google's `next_page_token` "more results" signal, which
   is inconsistent — sometimes absent in dense areas (under-capture) and sometimes present on
   sparse cells (over-drilling). Measured on Oahu: ~8 API calls per business found, one run
   consumed ~23,000 calls for a territory with ~150 real businesses, and repeat runs return
   different lists (non-deterministic).
2. **Platform risk.** The endpoint in use is the **legacy** Places API, which Google has
   marked for deprecation; its successor caps results even lower per request.

See `docs/PROSPECT_SEARCH_HOW_IT_WORKS.md`, `docs/PROSPECT_SEARCH_REDESIGN_NOTES.md`, and
`docs/GOOGLE_API_COST_CONTROLS.md` for the full analysis and incident history.

## Target architecture: hybrid discovery + de-duplication

Three phases, replacing the single Places call:

- **Phase A — Discovery (multiple sources, in parallel), each queried by the territory
  polygon:**
  - **OpenStreetMap / Overpass** — free, keyless, polygon-queryable, no result cap.
  - **Overture Maps Places** — free, open license, conflated from multiple providers
    (Meta/Microsoft/etc.), carries a confidence score; bulk GeoParquet dataset.
  - **Foursquare Open Source Places** — free (Apache 2.0), 100M+ POIs, monthly updates;
    bulk dataset.
  - **Google Places (optional, as enrichment only)** — used to confirm/complete contact
    details, not as the primary enumerator. Reduces reliance on the capped/legacy API.
- **Phase B — Normalize** each source's records into a common shape (name, address, phone,
  website, category, lat/lng, source).
- **Phase C — De-duplicate & reconcile** across sources: match the same business (by
  name + address proximity, phone, website domain, geocoded point within a small radius),
  merge into one record keeping the best field from each source, and record WHICH sources
  found it (a confidence signal — a business found by 3 sources is almost certainly real).

## Requirements (draft — to be refined during design)

- THE system SHALL discover businesses within a tenant's territory polygon from multiple
  independent data sources.
- THE system SHALL NOT depend on any single vendor API for completeness.
- THE system SHALL de-duplicate businesses across sources into a single reconciled record.
- THE system SHALL record, per prospect, which sources contributed it (for confidence).
- THE system SHALL produce deterministic results for the same territory + categories.
- THE system SHALL bound the cost/time of any run (no unbounded API usage).
- THE system SHALL retain the existing territory-definition workflow unchanged.
- THE design SHALL be validated against ground truth (a known-count area) before replacing
  the existing engine, and SHALL be built additively (behind a flag) so the current engine
  keeps working until the new path is proven.

## Open questions (to resolve via the evaluation spike)

- Which sources actually have the best coverage for small wellness businesses in the target
  markets (WNY, Mallorca)? (Measure, don't assume.)
- How much do the sources overlap (drives de-dup difficulty)?
- How large is the contact-data gap (phone/website) that would justify a Google enrichment
  pass or a paid firmographic source?
- Operational model for the bulk datasets (host a regional slice vs. query a cloud copy).

## Evaluation spike (must precede design/build)

A throwaway measurement (no app changes): pull one WNY county (e.g. Erie) for the three
active categories from OSM, Overture, and Foursquare; report raw counts and cross-source
overlap; compare against the current ~543 Google-derived prospects and a hand-count of one
small dense area. The spike's numbers decide the source mix before any engine is built.
