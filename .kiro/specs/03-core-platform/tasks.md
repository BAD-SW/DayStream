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
- [x] ✅ Enable RLS on tenants table
- [x] ✅ Enable RLS on users table
- [x] ✅ Create RLS policies (USING tenant_id = current_setting)
- [x] ✅ Create helper to set/reset `app.current_tenant_id` session variable
- [x] ✅ Create dedicated `daystream_app` role (non-superuser for RLS enforcement)
- [x] ✅ Enable RLS on all tenant-scoped tables (audit_log, consent_records, deletion_requests, etc.)
- [x] ✅ Write integration tests verifying RLS blocks cross-tenant access

### 1.3 Scoped Query Helpers
- [x] ✅ Create `tenantQuery()` function (sets RLS context, executes query, resets)
- [x] ✅ Create `tenantTransaction()` function (sets RLS context, executes in transaction)
- [x] ✅ Write integration tests for query helper (tenant-isolation.test.ts)

---

## 2. Tenant Provisioning

### 2.1 Provisioning API
- [x] ✅ Create `POST /api/v1/admin/tenants` endpoint (Super Admin only)
- [x] ✅ Validate input: name, slug, owner email, currency, timezone, language
- [x] ✅ Check slug uniqueness
- [x] ✅ Create tenant record
- [x] ✅ Create default roles for tenant (Business Owner, Manager, Staff, Customer)
- [x] ✅ Create initial Business Owner user
- [x] ✅ Apply default configuration values
- [x] ✅ Log provisioning in audit trail
- [x] ✅ Write integration tests for provisioning flow (tenant-provisioning.test.ts)

### 2.2 Tenant Management API
- [x] ✅ Create `GET /api/v1/admin/tenants` endpoint (list all — Super Admin)
- [x] ✅ Create `GET /api/v1/admin/tenants/:id` endpoint (detail)
- [x] ✅ Create `PUT /api/v1/admin/tenants/:id` endpoint (update name, language, currency, timezone)
- [x] ✅ Create `PUT /api/v1/admin/tenants/:id/suspend` endpoint
- [x] ✅ Create `PUT /api/v1/admin/tenants/:id/activate` endpoint
- [x] ✅ Enforce status transitions (active → suspended → archived)
- [x] ✅ Write tests for management operations (tenant-provisioning.test.ts)

### 2.3 Tenant Status Enforcement
- [x] ✅ Create middleware that checks tenant status on every request
- [x] ✅ Return 403 for suspended tenants (with explanation)
- [x] ✅ Return 404 for archived tenants (as if non-existent)
- [x] ✅ Write unit tests for tenant status middleware (tenant-status.test.ts)

---

## 3. Tenant Context Propagation

### 3.1 Context Middleware
- [x] ✅ Create `tenantContext` middleware (extract tenant_id from JWT)
- [x] ✅ Attach tenant_id to request object
- [x] ✅ Reject requests missing tenant context (401)
- [x] ✅ Apply to all `/api/v1/*` routes (except public endpoints)
- [x] ✅ Health, auth/login, auth/register exempt from tenant context requirement

### 3.2 Storage Scoping
- [x] ✅ Create file storage helper that prefixes paths with tenant_id
- [x] ✅ Prevent path traversal outside tenant's scope
- [x] ✅ Write unit tests for storage scoping (storage.test.ts)

---

## 4. API Infrastructure

### 4.1 Route Organization
- [x] ✅ Mount auth routes (`/api/v1/auth/*`)
- [x] ✅ Mount tenant admin routes (`/api/v1/admin/tenants/*`)
- [x] ✅ Mount config routes (`/api/v1/admin/config/*`)
- [x] ✅ Mount feature flags routes (`/api/v1/admin/feature-flags/*`)
- [x] ✅ Mount user routes (`/api/v1/users/*`)
- [x] ✅ Mount profile routes (`/api/v1/profile/*`)

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
- [x] ✅ Write unit tests for pagination logic (pagination.test.ts)

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
- [x] ✅ Create admin routes with role-based AuthGuard
- [x] ✅ Create placeholder pages (Dashboard, Profile, AdminDashboard)

### 5.2 Auth Guard
- [x] ✅ Create `ProtectedRoute` component (checks auth state, redirects if not logged in)
- [x] ✅ Support `requiredRole` prop for role-based access
- [x] ✅ Show loading spinner while auth state is resolving
- [x] ✅ Store redirect URL for post-login navigation (sessionStorage)

### 5.3 API Client
- [x] ✅ Create axios instance with base URL and default headers
- [x] ✅ Add request interceptor (attach Authorization header)
- [x] ✅ Add response interceptor (handle 401, attempt token refresh)
- [x] ✅ Redirect to login on refresh failure
- [x] ✅ Create typed API helper functions (apiGet, apiPost, apiPut, apiDelete)

### 5.4 Auth State Management
- [x] ✅ Create auth context/provider (stores user, tokens, loading state)
- [x] ✅ Implement login function (call API, store tokens, set user)
- [x] ✅ Implement logout function (clear tokens, redirect)
- [x] ✅ Implement token refresh function (via axios interceptor)
- [x] ✅ Persist tokens securely (httpOnly cookie for refresh token, server sets/clears cookie)

### 5.5 Layout
- [x] ✅ Create `AppLayout` component (header, sidebar, content area)
- [x] ✅ Create `AdminLayout` component (admin-specific navigation)
- [x] ✅ Create header with user menu and language switcher
- [x] ✅ Create collapsible sidebar for desktop/mobile (toggle button, icon-only collapsed state)
- [x] ✅ Create loading spinner component
- [x] ✅ Create error boundary component

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
- [x] ✅ Write unit tests for caching behavior (config-service.test.ts)

### 6.3 Configuration API
- [x] ✅ Create `GET /api/v1/admin/config` endpoint (list all config for tenant)
- [x] ✅ Create `GET /api/v1/admin/config/:key` endpoint (get specific value)
- [x] ✅ Create `PUT /api/v1/admin/config/:key` endpoint (update value)
- [x] ✅ Validate values against definition schema before saving
- [x] ✅ Restrict to Business Owner+ role
- [x] ✅ Write unit tests for config service (config-service.test.ts)

---

## 7. Feature Flag System

### 7.1 Database Setup
- [x] ✅ Create migration for `feature_flags` table
- [x] ✅ Create migration for `feature_flag_overrides` table
- [x] ✅ Seed initial feature flags (booking, waitlist, memberships, etc.)

### 7.2 Feature Flag Service
- [x] ✅ Create `FeatureFlagService` (isEnabled, evaluateAll)
- [x] ✅ Implement `isEnabled(flagKey, context)` — evaluate based on scope
- [x] ✅ Support global, tenant, and percentage-based evaluation
- [x] ✅ Implement deterministic percentage evaluation (hash-based)
- [x] ✅ Cache flag evaluations (invalidate on change)
- [x] ✅ Write unit tests for each scope type (feature-flags.test.ts)

### 7.3 Feature Flag API
- [x] ✅ Create `GET /api/v1/admin/feature-flags` endpoint (list all flags)
- [x] ✅ Create `PUT /api/v1/admin/feature-flags/:key` endpoint (update flag)
- [x] ✅ Create `PUT /api/v1/admin/feature-flags/:key/override` endpoint (tenant override)
- [x] ✅ Restrict to Super Admin (global flags) and Business Owner (tenant overrides)
- [x] ✅ Audit log all flag changes

### 7.4 Frontend Integration
- [x] ✅ Create `useFeatureFlag(key)` hook
- [x] ✅ Load feature flags on auth (included in auth context, loaded on login)
- [x] ✅ Support conditional rendering based on flag status
- [x] ✅ Write unit tests for hook (useFeatureFlag.test.tsx)

---

## 8. Internationalization (i18n)

### 8.1 Framework Setup
- [x] ✅ Install i18next and react-i18next in client package
- [x] ✅ Create i18n configuration (initialization, fallback, namespaces)
- [x] ✅ Create locale directory structure (`locales/en/`, `locales/es/`)

### 8.2 Translation Files
- [x] ✅ Create `common.json` for English (buttons, labels, generic messages)
- [x] ✅ Create `auth.json` for English (login, register, password messages)
- [x] ✅ Create `errors.json` for English (error messages)
- [x] ✅ Create `common.json` for Spanish
- [x] ✅ Create `auth.json` for Spanish
- [x] ✅ Create `errors.json` for Spanish

### 8.3 Language Detection
- [x] ✅ Implement language detection priority (browser → localStorage → 'en')
- [x] ✅ Create language switcher component (dropdown in header)
- [x] ✅ Persist language preference to localStorage on change
- [x] ✅ Apply language change without page reload

### 8.4 Backend Localization
- [x] ✅ Create server-side message catalog (error messages per locale)
- [x] ✅ Implement `detectLanguageFromRequest()` from Accept-Language header
- [x] ✅ Implement `getLocalizedMessage()` with fallback to English
- [x] ✅ Write unit tests for language detection (i18n.test.ts)

---

## 9. Multi-Currency

### 9.1 Currency Configuration
- [x] ✅ Store currency per tenant (set during provisioning)
- [x] ✅ Create `formatCurrency()` utility in shared package (uses Intl.NumberFormat)
- [x] ✅ Store all monetary values as integers (cents/minor units) — documented in design
- [x] ✅ Write unit tests for currency formatting (utilities.test.ts — EUR, USD, GBP)

### 9.2 Frontend Formatting
- [x] ✅ Create `useCurrency()` hook (reads tenant currency from context)
- [x] ✅ Create `<Price>` component (formats amount using tenant currency and locale)
- [x] ✅ Write tests for price display (Price.test.tsx)

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
- [x] ✅ Write unit tests for all utility functions (utilities.test.ts)

---

## 11. Health Endpoints

### 11.1 Implementation
- [x] ✅ Create `GET /api/health` (basic — no auth, no rate limit)
- [x] ✅ Create `GET /api/health/ready` (checks DB connectivity)
- [x] ✅ Create `GET /api/health/dependencies` (full detail with active connections)
- [x] ✅ Return 503 if critical dependency is down
- [x] ✅ Write unit tests for health endpoints (health-endpoints.test.ts)

---

## 12. Testing

### 12.1 Unit Tests
- [x] ✅ Test tenant provisioning (tenant-provisioning.test.ts)
- [x] ✅ Test tenant context middleware (tenant-status.test.ts)
- [x] ✅ Test configuration service (config-service.test.ts — cache hit, miss, invalidation)
- [x] ✅ Test feature flag evaluation (feature-flags.test.ts — global, tenant, percentage)
- [x] ✅ Test pagination helper (pagination.test.ts)
- [x] ✅ Test currency formatting (utilities.test.ts)
- [x] ✅ Test slug generation (utilities.test.ts)

### 12.2 Integration Tests
- [x] ✅ Test full tenant provisioning flow (tenant-provisioning.test.ts)
- [x] ✅ Test cross-tenant isolation (tenant-isolation.test.ts)
- [x] ✅ Test configuration CRUD end-to-end (config-api.test.ts)
- [x] ✅ Test feature flag override end-to-end (config-api.test.ts)
- [x] ✅ Test i18n language switching (i18n.test.ts — backend detection)
- [x] ✅ Test auth guard redirects (App.test.tsx — unauthenticated + admin redirect)
