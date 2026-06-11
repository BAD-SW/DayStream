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
- [ ] Create migration to add `default_language`, `currency`, `timezone` to tenants table
- [ ] Add CHECK constraints for valid values
- [ ] Update shared types (Tenant interface)

### 1.2 Row-Level Security
- [ ] Enable RLS on tenants table
- [ ] Enable RLS on users table
- [ ] Create RLS policies (USING tenant_id = current_setting)
- [ ] Create helper to set/reset `app.current_tenant_id` session variable
- [ ] Write integration tests verifying RLS blocks cross-tenant access

### 1.3 Scoped Query Helpers
- [ ] Create `tenantQuery()` function (sets RLS context, executes query, resets)
- [ ] Ensure all future queries use this helper for tenant-scoped data
- [ ] Write unit tests for query helper

---

## 2. Tenant Provisioning

### 2.1 Provisioning API
- [ ] Create `POST /api/v1/admin/tenants` endpoint (Super Admin only)
- [ ] Validate input: name, slug, owner email, currency, timezone, language
- [ ] Check slug uniqueness
- [ ] Create tenant record
- [ ] Create default roles for tenant (Business Owner, Manager, Staff, Customer)
- [ ] Create initial Business Owner user
- [ ] Apply default configuration values
- [ ] Log provisioning in audit trail
- [ ] Write unit tests for provisioning flow

### 2.2 Tenant Management API
- [ ] Create `GET /api/v1/admin/tenants` endpoint (list all — Super Admin)
- [ ] Create `GET /api/v1/admin/tenants/:id` endpoint (detail)
- [ ] Create `PUT /api/v1/admin/tenants/:id` endpoint (update name, status)
- [ ] Create `PUT /api/v1/admin/tenants/:id/suspend` endpoint
- [ ] Create `PUT /api/v1/admin/tenants/:id/activate` endpoint
- [ ] Enforce status transitions (active → suspended → archived)
- [ ] Write unit tests for management operations

### 2.3 Tenant Status Enforcement
- [ ] Create middleware that checks tenant status on every request
- [ ] Return 403 for suspended tenants (with explanation)
- [ ] Return 404 for archived tenants (as if non-existent)

---

## 3. Tenant Context Propagation

### 3.1 Context Middleware
- [ ] Create `tenantContext` middleware (extract tenant_id from JWT)
- [ ] Attach tenant_id to request object
- [ ] Reject requests missing tenant context (401)
- [ ] Apply to all `/api/v1/*` routes (except public endpoints)
- [ ] Create list of exempt routes (health, auth/login, auth/register, public catalog)

### 3.2 Storage Scoping
- [ ] Create file storage helper that prefixes paths with tenant_id
- [ ] Ensure uploaded files are stored at `/{tenant_id}/{path}`
- [ ] Prevent access to files outside tenant's scope

---

## 4. API Infrastructure

### 4.1 Route Organization
- [ ] Create `packages/server/src/routes/v1/index.ts` (V1 router)
- [ ] Mount auth routes (`/api/v1/auth/*`)
- [ ] Mount tenant admin routes (`/api/v1/admin/tenants/*`)
- [ ] Mount user routes (`/api/v1/users/*`)
- [ ] Mount profile routes (`/api/v1/profile/*`)
- [ ] Mount config routes (`/api/v1/admin/config/*`)

### 4.2 Response Helpers
- [ ] Create `success()` response helper
- [ ] Create `error()` response helper
- [ ] Define standard error codes (constants in shared package)
- [ ] Create consistent 404 handler
- [ ] Create global error handler (catches unhandled errors, returns structured response)

### 4.3 Pagination
- [ ] Create pagination validation schema (page, limit, sort, order)
- [ ] Create `paginate()` query helper (adds LIMIT, OFFSET, ORDER BY)
- [ ] Create pagination response meta builder (page, limit, total, totalPages)
- [ ] Write unit tests for pagination logic

### 4.4 Request ID
- [ ] Create request ID middleware (generate UUID, set X-Request-Id header)
- [ ] Include request ID in all log entries
- [ ] Pass request ID through to error responses

---

## 5. Frontend Application

### 5.1 Routing Setup
- [ ] Configure react-router-dom with route structure
- [ ] Create public routes (login, register, forgot-password)
- [ ] Create protected routes with AuthGuard component
- [ ] Create admin routes with role-based AuthGuard
- [ ] Create placeholder pages for each route

### 5.2 Auth Guard
- [ ] Create `AuthGuard` component (checks auth state, redirects if not logged in)
- [ ] Support `requiredRole` prop for role-based access
- [ ] Show loading spinner while auth state is resolving
- [ ] Store redirect URL for post-login navigation

### 5.3 API Client
- [ ] Create axios instance with base URL and default headers
- [ ] Add request interceptor (attach Authorization header)
- [ ] Add response interceptor (handle 401, attempt token refresh)
- [ ] Redirect to login on refresh failure
- [ ] Create typed API helper functions (get, post, put, delete)

### 5.4 Auth State Management
- [ ] Create auth context/provider (stores user, tokens, loading state)
- [ ] Implement login function (call API, store tokens, set user)
- [ ] Implement logout function (clear tokens, redirect)
- [ ] Implement token refresh function
- [ ] Persist tokens securely (memory for access, httpOnly cookie or secure storage for refresh)

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
- [ ] Create migration for `configuration_definitions` table
- [ ] Create migration for `tenant_configurations` table
- [ ] Seed default configuration definitions (branding, features, limits)

### 6.2 Configuration Service
- [ ] Create `ConfigurationService` class
- [ ] Implement `get(tenantId, key)` — check cache → tenant override → default
- [ ] Implement `set(tenantId, key, value, userId)` — validate, upsert, invalidate cache, audit log
- [ ] Implement in-memory cache with configurable TTL (5 minutes)
- [ ] Implement cache invalidation on update
- [ ] Write unit tests for caching behavior

### 6.3 Configuration API
- [ ] Create `GET /api/v1/admin/config` endpoint (list all config for tenant)
- [ ] Create `GET /api/v1/admin/config/:key` endpoint (get specific value)
- [ ] Create `PUT /api/v1/admin/config/:key` endpoint (update value)
- [ ] Validate values against definition schema before saving
- [ ] Restrict to Business Owner+ role
- [ ] Write unit tests for API endpoints

---

## 7. Feature Flag System

### 7.1 Database Setup
- [ ] Create migration for `feature_flags` table
- [ ] Create migration for `feature_flag_overrides` table
- [ ] Seed initial feature flags (booking, waitlist, etc. — all enabled by default)

### 7.2 Feature Flag Service
- [ ] Create `FeatureFlagService` class
- [ ] Implement `isEnabled(flagKey, context)` — evaluate based on scope
- [ ] Support global, tenant, and percentage-based evaluation
- [ ] Implement deterministic percentage evaluation (hash-based)
- [ ] Cache flag evaluations (invalidate on change)
- [ ] Write unit tests for each scope type

### 7.3 Feature Flag API
- [ ] Create `GET /api/v1/admin/feature-flags` endpoint (list all flags)
- [ ] Create `PUT /api/v1/admin/feature-flags/:key` endpoint (update flag)
- [ ] Create `PUT /api/v1/admin/feature-flags/:key/override` endpoint (tenant override)
- [ ] Restrict to Super Admin (global flags) and Business Owner (tenant overrides)
- [ ] Audit log all flag changes

### 7.4 Frontend Integration
- [ ] Create `useFeatureFlag(key)` hook
- [ ] Load feature flags on auth (include in auth context)
- [ ] Support conditional rendering based on flag status
- [ ] Write unit tests for hook

---

## 8. Internationalization (i18n)

### 8.1 Framework Setup
- [ ] Install i18next and react-i18next in client package
- [ ] Create i18n configuration (initialization, fallback, namespaces)
- [ ] Create locale directory structure (`locales/en/`, `locales/es/`)

### 8.2 Translation Files
- [ ] Create `common.json` for English (buttons, labels, generic messages)
- [ ] Create `auth.json` for English (login, register, password messages)
- [ ] Create `errors.json` for English (error messages)
- [ ] Create `common.json` for Spanish
- [ ] Create `auth.json` for Spanish
- [ ] Create `errors.json` for Spanish

### 8.3 Language Detection
- [ ] Implement language detection priority (user profile → browser → tenant default → 'en')
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
- [ ] Store currency per tenant (set during provisioning)
- [ ] Create `formatCurrency()` utility in shared package (uses Intl.NumberFormat)
- [ ] Store all monetary values as integers (cents/minor units)
- [ ] Write unit tests for currency formatting (EUR, USD, GBP)

### 9.2 Frontend Formatting
- [ ] Create `useCurrency()` hook (reads tenant currency from context)
- [ ] Create `<Price>` component (formats amount using tenant currency and locale)
- [ ] Write tests for price display in multiple locales

---

## 10. Shared Utilities Package

### 10.1 Types
- [ ] Define `Tenant` interface (with new fields: default_language, currency, timezone)
- [ ] Define `ConfigDefinition` interface
- [ ] Define `FeatureFlag` interface
- [ ] Define `PaginatedResult<T>` interface
- [ ] Export all types from barrel index

### 10.2 Constants
- [ ] Define `ERROR_CODES` object
- [ ] Define `CONFIG_KEYS` object
- [ ] Define `SUPPORTED_LANGUAGES` array
- [ ] Define `SUPPORTED_CURRENCIES` array

### 10.3 Utilities
- [ ] Create `generateSlug(name)` function
- [ ] Create `formatDate(date, locale)` function
- [ ] Create `formatCurrency(cents, currency, locale)` function
- [ ] Write unit tests for all utility functions

---

## 11. Health Endpoints

### 11.1 Implementation
- [ ] Create `GET /api/health` (basic — no auth, no rate limit)
- [ ] Create `GET /api/health/ready` (checks DB connectivity)
- [ ] Create `GET /api/health/dependencies` (full detail — admin only)
- [ ] Return 503 if critical dependency is down
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
