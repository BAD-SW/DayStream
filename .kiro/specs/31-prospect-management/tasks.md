# Phase 31: Prospect Management - Tasks

## Overview

Implementation broken into territory setup (system admin), prospect generation engine, and tenant-facing UI.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Territory Storage
- [x] ✅ Add territory columns to tenants table (territory_lat, territory_lng, territory_radius_km, territory_address)
- [x] ✅ Create migration for territory fields

### 1.2 Prospect Categories
- [x] ✅ Create sys_prospect_categories table (id, google_type, label, active)
- [x] ✅ Seed default categories (spa, gym, yoga_studio, physiotherapist, health, beauty_salon, etc.)

### 1.3 Prospects Table
- [x] ✅ Create prp_prospects table (id, tenant_id, google_place_id, name, address, phone, website, category, rating, review_count, status, notes, source, is_active, created_at, updated_at)
- [x] ✅ Add indexes on tenant_id, status, google_place_id
- [x] ✅ Add unique constraint on (tenant_id, google_place_id) for deduplication

## 2. Territory Management (System Admin)

### 2.1 API Endpoints
- [x] ✅ PUT /v1/prospects/territories/:tenantId — assign/update territory
- [x] ✅ GET /v1/prospects/territories — list all territories (for map view)
- [x] ✅ GET /v1/prospects/categories — list categories
- [x] ✅ POST /v1/prospects/categories — add category
- [x] ✅ DELETE /v1/prospects/categories/:id — remove category

### 2.2 System Admin UI
- [x] ✅ Territory assignment form on tenant detail page (address, lat, lng, radius)
- [x] ✅ Coverage map view showing all territories (card grid with Google Maps links)
- [ ] Category management page (CRUD list of Google Places types) — categories can be managed via API, no dedicated UI page yet

## 3. Prospect Generation Engine

### 3.1 Google Places Integration
- [x] ✅ Create Google Places service (search nearby by location + radius + type)
- [x] ✅ Handle pagination (Google returns max 60 results per query, paginated in 3 pages of 20)
- [x] ✅ Map Google Places response to prospect record fields
- [x] ✅ Handle rate limiting and API errors

### 3.2 Generation Logic
- [x] ✅ Query all configured categories for the tenant's territory
- [x] ✅ Deduplicate by google_place_id (upsert new, skip existing)
- [x] ✅ Mark prospects not found on refresh as inactive
- [x] ✅ Track generation metadata (last generated date, result count)

### 3.3 Billing
- [ ] Record each generation/refresh as a billable event — logged in prp_generation_log, actual payment charge not yet implemented
- [ ] Charge tenant's payment method on file (or track for invoicing)

## 4. Tenant Manager UI

### 4.1 Prospect List Page
- [x] ✅ Create Prospects page in tenant dashboard
- [x] ✅ Display prospects in sortable/filterable table (name, address, category, rating, status, notes)
- [x] ✅ Add filter controls (status, category, rating range)
- [x] ✅ Add search by business name

### 4.2 Prospect Actions
- [x] ✅ Status dropdown per prospect (New, Contacted, Demo Scheduled, Signed, Declined, Dismissed)
- [x] ✅ Inline notes editing
- [x] ✅ Dismiss action (removes from active view but retains in database)
- [x] ✅ "Show dismissed" toggle

### 4.3 Generate/Refresh
- [x] ✅ "Generate Prospects" button with confirmation dialog
- [x] ✅ Loading state and result summary after generation

### 4.4 Manual Entry
- [x] ✅ "Add Prospect" form (name, address, phone, website, category, notes)
- [x] ✅ Mark source as 'manual' to distinguish from API-generated

### 4.5 Export
- [x] ✅ CSV export button
- [x] ✅ Export respects current filters
- [x] ✅ Include all relevant fields in CSV

## 5. Coverage Map (System Admin)

- [x] ✅ Coverage Map page showing all territory cards
- [x] ✅ Labels with tenant name and status
- [x] ✅ Google Maps links for each territory
- [ ] Interactive map component (Leaflet/MapboxGL) — future enhancement, currently using card grid with map links

---

**Last Updated**: August 10, 2026


---

# Overture Redesign Tasks

See `design.md`. Built **additively behind a feature flag** — the existing Google engine
keeps working until the Overture path is validated and the default is flipped.

## 5. Data Source Integration (Overture via DuckDB)

### 5.1 DuckDB + Overture access
- [x] ✅ Add `duckdb` dependency to the server (native binary; note in AWS deploy image)
- [x] ✅ Config: Overture release id + S3 base path (not hardcoded) — `OVERTURE_RELEASE_PATH` env override
- [x] ✅ Overture query service: load httpfs + spatial, query places Parquet by bbox
- [x] ✅ Derive the query bbox from the tenant's stored H3 territory hexes
- [x] ✅ Per-run safety timeout on the DuckDB query (no hung runs)
- [x] ✅ Map Overture fields (name, taxonomy, basic_category, confidence, address parts,
      phones, websites, socials, lat/lng, source) to a common candidate shape

### 5.2 Category mapping (config)
- [x] ✅ Define category → Overture taxonomy/basic_category mapping (curated, not regex)
- [x] ✅ Store mapping as editable config (`prp_category_mappings.overture_taxonomy`)
- [x] ✅ Apply category selection in the query (kept slightly broad)

## 6. Post-Query Filtering (app-side)

### 6.1 Precise territory filter
- [x] ✅ For each candidate, compute H3 cell and keep only if in the territory hex set (robust to mixed stored resolutions)
- [x] ✅ Verify it drops bbox spillover (Canada / Erie PA) and keeps edge towns

### 6.2 Tunable classification (reversible, not delete)
- [x] ✅ Store every fetched record; classify rather than discard
- [x] ✅ Local confidence threshold (active vs held) — configurable, not query-time
- [x] ✅ Operator-selectable contact-completeness filter: Include all / phone OR website
      (default) / phone AND website — applied post-query as a reversible flag

## 7. De-duplication & Reconciliation

### 7.1 Normalize
- [x] ✅ Canonicalize address (street/city/region/postal/point) across field shapes
- [x] ✅ Normalize names (lowercase, strip punctuation + filler)

### 7.2 Match & reconcile
- [x] ✅ Group by geographic proximity, confirm with fuzzy name similarity (tuned thresholds)
- [x] ✅ Reconcile merged records (canonical name; best field per source; sources list)
- [x] ✅ De-dup within Overture AND against the tenant's existing prospects (update, not dup)
- [x] ✅ Preserve multi-location chains (same name, different address = distinct)

## 8. Fit Signals, Fit Score, Territory Valuation

### 8.1 Fit signals
- [x] ✅ Persist raw signals per prospect (category, confidence, has-phone/website/social,
      multi-location flag, review count/rating, address completeness)
- [x] ✅ Derive multi-location-operator flag via name-clustering within the territory

### 8.2 Fit Score (v1, configurable)
- [x] ✅ Transparent weighted 0–100 score; weights stored as config
- [x] ✅ Derive fit tier (strong/moderate/weak)
- [x] ✅ Keep strictly separate from Overture confidence

### 8.3 Territory Valuation (descriptive)
- [x] ✅ Aggregate fit tiers/counts per territory (descriptive, not a $ figure)
- [x] ✅ Surface on the prospect list view (territory fit bar)

## 9. Data Model

- [x] ✅ Migration 158: source='overture', external_id, confidence, fit_signals (JSONB),
      fit_score, fit_tier, inclusion/hold_reason flags, contributing_sources
- [x] ✅ Config entries: category→taxonomy map (SQL); fit-score weights, confidence
      threshold, Overture release id (service-layer defaults + optional config override)

## 10. Optional Enrichment (contact gaps)

- [ ] (Optional) Google Place Details lookup for prospects missing phone/website only — deferred
- [ ] Respect the existing Places daily quota; keep off the critical path; deferrable — deferred

## 11. Background Job & UI

- [x] ✅ Run Overture generation as a background job (reuses status-polling pattern)
- [x] ✅ Generate screen: contact-completeness option + category selection
- [x] ✅ Prospect list: show fit score/tier, confidence, source, included/held state
- [x] ✅ Territory view: show descriptive valuation (fit-tier counts)

## 12. Rollout & Testing

- [x] ✅ Feature flag to select Overture vs Google engine (`feature.prospects_overture`)
- [x] ✅ Unit tests with STUBBED fixtures: Advanced Care (keep 6), Susan Naturally (merge),
      Grand Island PT vs Island Aesthetics (don't merge)
- [x] ✅ Territory-polygon filter test (out-of-territory excluded; edge town included)
- [x] ✅ Fit-score tests (known inputs → expected tier; Exotic Tan → found, low fit)
- [x] ✅ Ground-truth recall check on one dense + one sparse territory
- [ ] Validate against evaluation numbers, then flip default to Overture — flag still off, pending sign-off

---

**Overture Redesign Status**: ✅ Built & verified behind `feature.prospects_overture` (off by default). Remaining: optional Google enrichment (deferred) and flipping the default (pending validation sign-off).
**Last Updated**: November 2, 2026
