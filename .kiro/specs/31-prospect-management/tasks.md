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
