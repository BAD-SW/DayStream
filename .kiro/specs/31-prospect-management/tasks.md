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
- [ ] Add territory columns to tenants table (territory_lat, territory_lng, territory_radius_km, territory_address)
- [ ] Create migration for territory fields

### 1.2 Prospect Categories
- [ ] Create sys_prospect_categories table (id, google_type, label, active)
- [ ] Seed default categories (spa, gym, yoga_studio, physiotherapist, health, beauty_salon, etc.)

### 1.3 Prospects Table
- [ ] Create prp_prospects table (id, tenant_id, google_place_id, name, address, phone, website, category, rating, review_count, status, notes, source, is_active, created_at, updated_at)
- [ ] Add indexes on tenant_id, status, google_place_id
- [ ] Add unique constraint on (tenant_id, google_place_id) for deduplication

## 2. Territory Management (System Admin)

### 2.1 API Endpoints
- [ ] PUT /admin/tenants/:id/territory — assign/update territory
- [ ] GET /admin/tenants/territories — list all territories (for map view)
- [ ] GET /admin/prospect-categories — list categories
- [ ] POST /admin/prospect-categories — add category
- [ ] DELETE /admin/prospect-categories/:id — remove category

### 2.2 System Admin UI
- [ ] Territory assignment form on tenant detail page (address input with geocoding, radius slider)
- [ ] Coverage map view showing all territories (use Leaflet or similar)
- [ ] Category management page (CRUD list of Google Places types)

## 3. Prospect Generation Engine

### 3.1 Google Places Integration
- [ ] Create Google Places service (search nearby by location + radius + type)
- [ ] Handle pagination (Google returns max 60 results per query, paginated in 3 pages of 20)
- [ ] Map Google Places response to prospect record fields
- [ ] Handle rate limiting and API errors

### 3.2 Generation Logic
- [ ] Query all configured categories for the tenant's territory
- [ ] Deduplicate by google_place_id (upsert new, skip existing)
- [ ] Mark prospects not found on refresh as inactive
- [ ] Track generation metadata (last generated date, result count)

### 3.3 Billing
- [ ] Record each generation/refresh as a billable event
- [ ] Charge tenant's payment method on file (or track for invoicing)

## 4. Tenant Manager UI

### 4.1 Prospect List Page
- [ ] Create Prospects page in tenant dashboard
- [ ] Display prospects in sortable/filterable table (name, address, category, rating, status, notes)
- [ ] Add filter controls (status, category, rating range)
- [ ] Add search by business name

### 4.2 Prospect Actions
- [ ] Status dropdown per prospect (New, Contacted, Demo Scheduled, Signed, Declined, Dismissed)
- [ ] Inline notes editing
- [ ] Dismiss action (sets inactive, removes from default view)
- [ ] "Show dismissed" toggle

### 4.3 Generate/Refresh
- [ ] "Generate Prospects" button with confirmation dialog (shows estimated cost)
- [ ] "Refresh" button with confirmation
- [ ] Loading state and result summary after generation

### 4.4 Manual Entry
- [ ] "Add Prospect" form (name, address, phone, website, category, notes)
- [ ] Mark source as 'manual' to distinguish from API-generated

### 4.5 Export
- [ ] CSV export button
- [ ] Export respects current filters
- [ ] Include all relevant fields in CSV

## 5. Coverage Map (System Admin)

- [ ] Map component showing all territory circles
- [ ] Labels with tenant name
- [ ] Zoom/pan controls
- [ ] Color coding by tenant status (active, pending)

---

**Last Updated**: August 10, 2026
