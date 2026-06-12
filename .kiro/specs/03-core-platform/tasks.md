# Phase 03: Core Platform & Multi-Tenancy - Tasks

## Overview

Implementation tasks for multi-tenant architecture, tenant provisioning, context propagation, API infrastructure, frontend application, configuration engine, feature flags, internationalization, and multi-currency support.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Multi-Tenant Architecture

### 1.1 Tenant Table Extensions
- [x] ✅ Create migration to add `default_language`, `currency`, `timezone` to tenants table
- [x] ✅ Add CHECK constraints for valid values
- [x] ✅ Update shared types (Tenant interface)

### 1.2 Row-Level Security
- [x] ✅ Enable RLS on users table
- [x] ✅ Create RLS policies (USING tenant_id = current_setting)
- [x] ✅ Create helper to set/reset `app.current_tenant_id` session variable
- [ ] Enable RLS on tenants table
- [ ] Write integration tests verifying RLS blocks cross-tenant access

### 1.3 Scoped Query Helpers
- [x] ✅ Create `tenantQuery()` function (sets RLS context, executes query, resets)
- [x] ✅ Create `tenantTransaction()` function (sets RLS context, executes in transaction)
- [ ] Write unit tests for query helper

---

## 2. Tenant Provisioning

### 2.1 Provisioning API
- [x] ✅ Create `POST /api/v1/admin/tenants` endpoint (Super Admin only)
- [x] ✅ Validate input: name, slug, owner email, currency, timezone, language
- [x] ✅ Check slug uniqueness
- [x] ✅ Create tenant record
- [x] ✅ Create default roles for tenant (Business Owner, Manager, Staff, Customer)
- [x] ✅ Create initial Business Owner user
- [ ] Apply default configuration values
- [x] ✅ Log provisioning in audit trail
- [ ] Write unit tests for provisioning flow

### 2.2 Tenant Management API
- [x] ✅ Create `GET /api/v1/admin/tenants` endpoint (list all — Super Admin)
- [x] ✅ Create `GET /api/v1/admin/tenants/:id` endpoint (detail)
- [ ] Create `PUT /api/v1/admin/tenants/:id` endpoint (update name, status)
- [x] ✅ Create `PUT /api/v1/admin/tenants/:id/suspend` endpoint
- [x] ✅ Create `PUT /api/v1/admin/tenants/:id/activate` endpoint
- [x] ✅ Enforce status transitions (active → suspended → archived)
- [ ] Write unit tests for management operations

### 2.3 Tenant Status Enforcement
- [ ] Create middleware that checks tenant status on every request
- [ ] Return 403 for suspended tenants (with explanation)
- [ ] Return 404 for archived tenants (as if non-existent)

---

## 3. Tenant Context Propagation

### 3.1 Context Middleware
- [x] ✅ Create `tenantContext` middleware (extract tenant_id from JWT)
- [x] ✅ Attach tenant_id to request object
- [x] ✅ Reject requests missing tenant context (401)
- [x] ✅ Apply to all `/api/v1/*` routes (except public endpoints)
- [ ] Create list of exempt routes (health, auth/login, auth/register, public catalog)

### 3.2 Storage Scoping
- [ ] Create file storage helper that prefixes paths with tenant_id
- [ ] Ensure uploaded files are stored at `/{tenant_id}/{path}`
- [ ] Prevent access to files outside tenant's scope

---

## 4. API Infrastructure

### 4.1 Route Organization
- [x] ✅ Mount auth routes (`/api/v1/auth/*`)
- [x] ✅ Mount tenant admin routes (`/api/v1/admin/tenants/*`)
- [ ] Create `packages/server/src/routes/v1/index.ts` (V1 router)
- [ ] Mount user routes (`/api/v1/users/*`)
- [ ] Mount profile routes (`/api/v1/profile/*`)
- [x] ✅ Mount config routes (`/api/v1/admin/config/*`)

### 4.2 Response Helpers
- [x] ✅ Create `success()` response helper
- [x] ✅ Create `error()` response helper
- [x] ✅ Define standard error codes (constants in shared package)
- [x] ✅ Create consistent 404 handler
- [x] ✅ Create global error handler (catches unhandled errors, returns structured response)

### 4.3 Pagination
- [x] ✅ Create pagination validation schema (page, limit, sort, order)
- [x] ✅ Create `paginate()` query helper (adds LIMIT, OFFSET, ORDER BY)
- [x] ✅ Create pagination response meta builder (page, limit, total, totalPages)
- [ ] Write unit tests for pagination logic

### 4.4 Request ID
- [x] ✅ Create request ID middleware (generate UUID, set X-Request-Id header)
- [x] ✅ Include request ID in all log entries
- [x] ✅ Pass request ID through to error responses

---

## 5. Frontend Application

### 5.1 Routing Setup
- [x] ✅ Configure react-router-dom with route structure
- [x] ✅ Create public routes (login)
- [x] ✅ Create protected routes with AuthGuard
- [ ] Create admin routes with role-based AuthGuard
- [ ] Create placeholder pages for each route

### 5.2 Auth Guard
- [x] ✅ Create `AuthGuard` component (checks auth state, redirects if not logged in)
- [ ] Support `requiredRole` prop for role-based access
- [ ] Show loading spinner while auth state is resolving
- [ ] Store redirect URL for post-login navigation

### 5.3 API Client
- [x] ✅ Create axios instance with base URL and default headers
- [x] ✅ Add request interceptor (attach Authorization header)
- [x] ✅ Add response interceptor (handle 401, attempt token refresh)
- [x] ✅ Redirect to login on refresh failure
- [ ] Create typed API helper functions (get, post, put, delete)

### 5.4 Auth State Management
- [x] ✅ Create auth context/provider (stores user, tokens, loading state)
- [x] ✅ Implement login function (call API, store tokens, set user)
- [x] ✅ Implement logout function (clear tokens, redirect)
- [x] ✅ Implement token refresh function
- [ ] Persist tokens securely (memory for access, secure storage for refresh)

### 5.5 Layout
- [ ] Create `AppLayout` component (header, sidebar, content area)
- [ ] Create `AdminLayout` component (admin-specific navigation)
- [ ] Create responsive header with user menu and tenant branding
- [ ] Create collapsible sidebar for desktop/mobile
- [ ] Create loading spinner component
- [ ] Create error boundary component

---

## 6. Configuration Engine

### 6.1 Database Setup
- [x] ✅ Create migration for `configuration_definitions` table
- [x] ✅ Create migration for `tenant_configurations` table
- [x] ✅ Seed default configuration definitions (branding, features, limits)

### 6.2 Configuration Service
- [x] ✅ Create `ConfigurationService` (get, set, getAll)
- [x] ✅ Implement `get(tenantId, key)` — check cache → tenant override → default
- [x] ✅ Implement `set(tenantId, key, value, userId)` — validate, upsert, invalidate cache, audit log
- [x] ✅ Implement in-memory cache with configurable TTL (5 minutes)
- [x] ✅ Implement cache invalidation on update
- [ ] Write unit tests for caching behavior

### 6.3 Configuration API
- [x] ✅ Create `GET /api/v1/admin/config` endpoint (list all config for tenant)
- [x] ✅ Create `GET /api/v1/admin/config/:key` endpoint (get specific value)
- [x] ✅ Create `PUT /api/v1/admin/config/:key` endpoint (update value)
- [x] ✅ Validate values against definition schema before saving
- [x] ✅ Restrict to Business Owner+ role
- [ ] Write unit tests for API endpoints

---

## 7. Feature Flag System

### 7.1 Database Setup
- [x] ✅ Create migration for `feature_flags` table
- [x] ✅ Create migration for `feature_flag_overrides` table
- [x] ✅ Seed initial feature flags (booking, waitlist, etc.)

### 7.2 Feature Flag Service
- [x] ✅ Create `FeatureFlagService` (isEnabled, evaluateAll)
- [x] ✅ Implement `isEnabled(flagKey, context)` — evaluate based on scope
- [x] ✅ Support global, tenant, and percentage-based evaluation
- [x] ✅ Implement deterministic percentage evaluation (hash-based)
- [x] ✅ Cache flag evaluations (invalidate on change)
- [ ] Write unit tests for each scope type

### 7.3 Feature Flag API
- [x] ✅ Create `GET /api/v1/admin/feature-flags` endpoint (list all flags)
- [x] ✅ Create `PUT /api/v1/admin/feature-flags/:key` endpoint (update flag)
- [x] ✅ Create `PUT /api/v1/admin/feature-flags/:key/override` endpoint (tenant override)
- [x] ✅ Restrict to Super Admin (global flags) and Business Owner (tenant overrides)
- [ ] Audit log all flag changes

### 7.4 Frontend Integration
- [ ] Create `useFeatureFlag(key)` hook
- [ ] Load feature flags on auth (include in auth context)
- [ ] Support conditional rendering based on flag status
- [ ] Write unit tests for hook

---

## 8. Internationalization (i18n)

### 8.1 Framework Setup
- [x] ✅ Install i18next and react-i18next in client package
- [x] ✅ Create i18n configuration (initialization, fallback, namespaces)
- [x] ✅ Create locale directory structure (`locales/en/`, `locales/es/`)

### 8.2 Translation Files
- [x] ✅ Create `common.json` for English (buttons, labels, generic messages)
- [x] ✅ Create `auth.json` for English (login, register, password messages)
- [x] ✅ Create `common.json` for Spanish
- [x] ✅ Create `auth.json` for Spanish
- [ ] Create `errors.json` for English (error messages)
- [ ] Create `errors.json` for Spanish

### 8.3 Language Detection
- [x] ✅ Implement language detection priority (browser → localStorage → 'en')
- [ ] Create language switcher component (dropdown in header/settings)
- [ ] Persist language preference to user profile on change
- [ ] Apply language change without page reload

### 8.4 Backend Localization
- [ ] Create server-side message catalog (error messages per locale)
- [ ] Read Accept-Language header or user preference
- [ ] Return localized error messages from API
- [ ] Write unit tests for language detection

---

## 9. Multi-Currency

### 9.1 Currency Configuration
- [x] ✅ Store currency per tenant (set during provisioning)
- [x] ✅ Create `formatCurrency()` utility in shared package (uses Intl.NumberFormat)
- [x] ✅ Store all monetary values as integers (cents/minor units) — documented in design
- [ ] Write unit tests for currency formatting (EUR, USD, GBP)

### 9.2 Frontend Formatting
- [ ] Create `useCurrency()` hook (reads tenant currency from context)
- [ ] Create `<Price>` component (formats amount using tenant currency and locale)
- [ ] Write tests for price display in multiple locales

---

## 10. Shared Utilities Package

### 10.1 Types
- [x] ✅ Define `Tenant` interface (with new fields: default_language, currency, timezone)
- [x] ✅ Define `ConfigDefinition` interface
- [x] ✅ Define `FeatureFlag` interface
- [x] ✅ Define `PaginatedResult<T>` interface
- [x] ✅ Export all types from barrel index

### 10.2 Constants
- [x] ✅ Define `ERROR_CODES` object
- [x] ✅ Define `CONFIG_KEYS` object
- [x] ✅ Define `SUPPORTED_LANGUAGES` array
- [x] ✅ Define `SUPPORTED_CURRENCIES` array

### 10.3 Utilities
- [x] ✅ Create `generateSlug(name)` function
- [x] ✅ Create `formatDate(date, locale)` function
- [x] ✅ Create `formatCurrency(cents, currency, locale)` function
- [ ] Write unit tests for all utility functions

---

## 11. Health Endpoints

### 11.1 Implementation
- [x] ✅ Create `GET /api/health` (basic — no auth, no rate limit)
- [x] ✅ Create `GET /api/health/ready` (checks DB connectivity)
- [ ] Create `GET /api/health/dependencies` (full detail — admin only)
- [x] ✅ Return 503 if critical dependency is down
- [ ] Write unit tests for health endpoints

---

## 12. Testing

### 12.1 Unit Tests
- [ ] Test tenant provisioning (create, default roles, default config)
- [ ] Test tenant context middleware (valid JWT, missing tenant, suspended tenant)
- [ ] Test configuration service (cache hit, cache miss, invalidation)
- [ ] Test feature flag evaluation (global, tenant, percentage)
- [ ] Test pagination helper
- [ ] Test currency formatting
- [ ] Test slug generation

### 12.2 Integration Tests
- [ ] Test full tenant provisioning flow (API → DB → verify data)
- [ ] Test cross-tenant isolation (user from tenant A cannot access tenant B data)
- [ ] Test configuration CRUD (create definition, set override, read back)
- [ ] Test feature flag with tenant override
- [ ] Test i18n language switching
- [ ] Test auth guard redirects (unauthenticated, wrong role)
