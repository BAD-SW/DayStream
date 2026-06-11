# Phase 03: Core Platform & Multi-Tenancy - Requirements

## Overview

This phase establishes the foundational platform capabilities including multi-tenant architecture, tenant provisioning, context propagation, API infrastructure, frontend application framework, configuration engine, feature flags, and internationalization. These core services provide the isolation, operational foundation, and shared utilities upon which all functional modules will be built.

## Goals

- Implement multi-tenant architecture with complete data isolation
- Build tenant provisioning and lifecycle management
- Establish automatic tenant context propagation through all service layers
- Create API routing infrastructure with versioning
- Bootstrap the frontend React application with routing and state management
- Implement a database-driven configuration engine
- Establish feature flag system for safe rollouts
- Lay internationalization (i18n) and multi-currency foundations

## Glossary

- **Platform**: The DayStream multi-tenant SaaS wellness business management system
- **Tenant**: An isolated customer business using the Platform
- **User**: An individual with authenticated access to the Platform
- **Tenant_Context**: The runtime context identifying which Tenant a request belongs to
- **Configuration_Engine**: The service that loads and manages tenant-specific settings from the database
- **Feature_Flag**: A toggle that enables or disables a feature per tenant or globally
- **API_Router**: The centralized Express router handling all API request routing and middleware
- **Migration**: A versioned database schema change
- **Seed_Data**: Baseline data populated for development and testing

## Requirements

### Requirement 1: Multi-Tenant Architecture

**User Story:** As a platform operator, I want to support multiple isolated customer businesses, so that each Tenant's data and configurations remain completely separate.

#### Acceptance Criteria

1. THE Platform SHALL isolate each Tenant's data, Users, and configurations from all other Tenants
2. THE Platform SHALL enforce tenant isolation via `tenant_id` column on every tenant-scoped table
3. THE Platform SHALL prevent cross-Tenant data leakage through queries, API calls, or error messages
4. THE Platform SHALL maintain separate audit logs per Tenant
5. THE Platform SHALL support tenant-specific configuration (branding, features, settings)
6. THE Platform SHALL implement PostgreSQL Row-Level Security policies as a defense-in-depth layer for tenant isolation
7. THE Platform SHALL include integration tests that verify no cross-tenant data access is possible

### Requirement 2: Tenant Provisioning and Lifecycle

**User Story:** As a platform operator, I want to provision and manage tenants, so that customer onboarding and offboarding is consistent and automated.

#### Acceptance Criteria

1. THE Platform SHALL provide an API endpoint for creating new Tenants
2. WHEN a Tenant is created, THE Platform SHALL generate a unique tenant_id (UUID)
3. WHEN a Tenant is created, THE Platform SHALL create default roles for the Tenant
4. WHEN a Tenant is created, THE Platform SHALL create an initial Business Owner user
5. WHEN a Tenant is created, THE Platform SHALL apply default configuration settings
6. THE Platform SHALL support tenant statuses: active, suspended, archived
7. WHEN a Tenant is suspended, THE Platform SHALL deny all user access for that Tenant
8. THE Platform SHALL support custom slug per Tenant for URL identification (e.g., `/transcend`)
9. THE Platform SHALL support custom domain mapping per Tenant (future, configurable)
10. THE Platform SHALL complete tenant provisioning within 10 seconds

### Requirement 3: Tenant Context Propagation

**User Story:** As a platform developer, I want automatic tenant context propagation, so that all operations are scoped to the correct tenant without manual checks in every function.

#### Acceptance Criteria

1. WHEN a User authenticates, THE Platform SHALL extract the tenant_id from the JWT token
2. THE Platform SHALL propagate Tenant_Context through all service layers via middleware
3. THE Platform SHALL automatically scope all database queries to the current Tenant_Context
4. THE Platform SHALL automatically scope file storage paths by tenant_id
5. THE Platform SHALL prevent API requests from accessing resources outside the Tenant_Context
6. THE Platform SHALL provide middleware that validates Tenant_Context on every request
7. THE Platform SHALL reject requests that lack a valid Tenant_Context (except public endpoints)
8. THE Platform SHALL include tenant_id in all log entries for traceability

### Requirement 4: API Infrastructure and Routing

**User Story:** As a platform developer, I want a structured API layer with consistent routing, middleware, and error handling, so that all endpoints behave predictably.

#### Acceptance Criteria

1. THE API_Router SHALL organize endpoints under `/api/v1/` for versioning
2. THE API_Router SHALL apply authentication middleware to all protected routes
3. THE API_Router SHALL apply tenant context middleware after authentication
4. THE API_Router SHALL apply permission-checking middleware per route
5. THE API_Router SHALL implement consistent error response format: `{ error: string, code: string, details?: object }`
6. THE API_Router SHALL implement consistent success response format: `{ data: object, meta?: object }`
7. THE API_Router SHALL support pagination via `page` and `limit` query parameters on list endpoints
8. THE API_Router SHALL support sorting via `sort` and `order` query parameters
9. THE API_Router SHALL support filtering via query parameters specific to each resource
10. THE API_Router SHALL implement request ID generation for correlation across logs

### Requirement 5: Frontend Application Bootstrap

**User Story:** As a platform developer, I want a configured frontend application framework, so that UI development can begin with routing, state management, and API integration in place.

#### Acceptance Criteria

1. THE Frontend SHALL use React with TypeScript for type safety
2. THE Frontend SHALL use react-router-dom for client-side navigation
3. THE Frontend SHALL use axios with a configured base URL (localhost:4001) and interceptors for auth tokens
4. THE Frontend SHALL implement route guards that redirect unauthenticated users to login
5. THE Frontend SHALL implement route guards that check role permissions before rendering pages
6. THE Frontend SHALL implement a global error boundary for graceful error handling
7. THE Frontend SHALL implement a loading/spinner state for async operations
8. THE Frontend SHALL support environment-based configuration (API URL, feature flags)
9. THE Frontend SHALL implement a layout system with navigation, sidebar, and content area

### Requirement 6: Frontend Authentication Integration

**User Story:** As a user, I want seamless authentication in the web interface, so that I can access the platform securely without friction.

#### Acceptance Criteria

1. THE Frontend SHALL provide a login form with email and password fields
2. THE Frontend SHALL provide OAuth login buttons (Google, Apple)
3. THE Frontend SHALL support MFA verification flow (TOTP code entry)
4. THE Frontend SHALL store JWT tokens securely (httpOnly cookies or memory)
5. THE Frontend SHALL automatically refresh access tokens before expiration
6. WHEN a token refresh fails, THE Frontend SHALL redirect to the login page
7. THE Frontend SHALL provide a logout action that clears tokens and redirects to login
8. THE Frontend SHALL display user information (name, role, tenant) in the navigation
9. THE Frontend SHALL redirect users to their originally requested page after successful authentication
10. THE Frontend SHALL handle authentication errors with user-friendly messages

### Requirement 7: Database-Driven Configuration Engine

**User Story:** As a platform operator, I want tenant configuration stored in the database rather than environment files, so that settings can be changed without redeployment and each tenant can be configured independently.

#### Acceptance Criteria

1. THE Configuration_Engine SHALL store all tenant-specific settings in a `tenant_configurations` table
2. THE Configuration_Engine SHALL support typed configuration values (string, number, boolean, JSON)
3. THE Configuration_Engine SHALL support configuration categories (branding, features, limits, integrations)
4. THE Configuration_Engine SHALL provide a default value for every configuration key
5. THE Configuration_Engine SHALL allow tenant-level overrides of default values
6. THE Configuration_Engine SHALL cache configuration in memory with a configurable TTL (default 5 minutes)
7. THE Configuration_Engine SHALL invalidate cache when configuration is updated via API
8. THE Configuration_Engine SHALL provide an API for administrators to read and update tenant configuration
9. THE Configuration_Engine SHALL validate configuration values against defined schemas before saving
10. THE Configuration_Engine SHALL log all configuration changes in the audit log

### Requirement 8: Feature Flag System

**User Story:** As a platform operator, I want feature flags, so that new features can be enabled per tenant or globally without code deployment.

#### Acceptance Criteria

1. THE Platform SHALL support feature flags stored in the database
2. THE Platform SHALL support flag scopes: global (all tenants), per-tenant, per-role
3. THE Platform SHALL provide an API for Super Admins to create, enable, and disable feature flags
4. THE Platform SHALL evaluate feature flags efficiently (cached, not per-request DB lookup)
5. THE Platform SHALL provide a frontend utility to check feature flag status for conditional rendering
6. THE Platform SHALL provide a backend middleware/utility to check feature flags for conditional logic
7. THE Platform SHALL log feature flag changes in the audit log
8. THE Platform SHALL support percentage-based rollouts (e.g., enable for 10% of tenants)

### Requirement 9: Internationalization (i18n) Framework

**User Story:** As a user, I want the platform available in my language, so that I can use it comfortably regardless of my locale.

#### Acceptance Criteria

1. THE Platform SHALL use i18next for frontend internationalization
2. THE Platform SHALL support English and Spanish as initial languages
3. THE Platform SHALL store translation files in a structured format (JSON per namespace per locale)
4. THE Platform SHALL detect user language preference from browser settings or user profile
5. THE Platform SHALL allow users to override language preference in their profile
6. THE Platform SHALL support per-tenant default language
7. THE Platform SHALL externalize all user-facing strings (no hardcoded text in components)
8. THE Platform SHALL support date, time, number, and currency formatting per locale
9. THE Backend SHALL return localized error messages based on the user's language preference

### Requirement 10: Multi-Currency Foundation

**User Story:** As a business owner operating in different markets, I want the platform to support multiple currencies, so that prices and financial data display correctly for my locale.

#### Acceptance Criteria

1. THE Platform SHALL store a `currency` field per Tenant (ISO 4217 code, e.g., EUR, USD, GBP)
2. THE Platform SHALL format monetary values according to the tenant's configured currency and locale
3. THE Platform SHALL store all monetary values as integers (cents/minor units) to avoid floating-point errors
4. THE Platform SHALL support displaying prices in the tenant's currency throughout the UI
5. THE Platform SHALL not perform automatic currency conversion (each tenant operates in a single currency)
6. THE Platform SHALL support configuring tax/VAT display rules per tenant (inclusive vs. exclusive)

### Requirement 11: Shared Utilities and Patterns

**User Story:** As a platform developer, I want shared utility functions and patterns, so that common operations are consistent and not duplicated across the codebase.

#### Acceptance Criteria

1. THE Platform SHALL provide a shared `packages/shared` package with TypeScript types, constants, and validation schemas
2. THE Platform SHALL define shared types for common entities (Tenant, User, ApiResponse, PaginatedResult)
3. THE Platform SHALL define shared Joi validation schemas used by both frontend and backend
4. THE Platform SHALL provide utility functions for UUID generation, date formatting, and slug creation
5. THE Platform SHALL provide typed API error codes as constants
6. THE Platform SHALL enforce that `packages/shared` has zero runtime dependencies (types and pure functions only)

### Requirement 12: Health and Status Endpoints

**User Story:** As a platform operator, I want health and status endpoints, so that I can monitor the platform's operational state and dependencies.

#### Acceptance Criteria

1. THE Platform SHALL provide `GET /api/health` returning HTTP 200 with uptime and version
2. THE Platform SHALL provide `GET /api/health/ready` that checks database connectivity
3. THE Platform SHALL provide `GET /api/health/dependencies` that checks all external service connections (DB, cache, storage)
4. THE health endpoints SHALL be exempt from authentication and rate limiting
5. THE health endpoints SHALL return structured JSON with status per dependency
6. THE Platform SHALL return HTTP 503 from readiness checks if any critical dependency is unavailable

---

## Dependencies

- Phase 00: Infrastructure - Monorepo, database, migration runner, API server, frontend app
- Phase 02: Security & Compliance - Authentication, RBAC, audit logging

## Success Criteria

- A new tenant can be provisioned via API and immediately used
- Tenant context propagates automatically; no query can access another tenant's data
- Configuration changes take effect without redeployment
- Feature flags can enable/disable features per tenant
- Frontend renders with routing, auth flow, and language switching
- Shared types are consumed by both server and client
- Health endpoints report accurate dependency status
- All operations are scoped to the correct tenant

## Out of Scope

- Custom domain DNS configuration - Infrastructure/ops concern for later
- Tenant billing/subscription management - Phase handled by SaaS billing (future)
- Advanced RBAC UI (custom role builder) - Can use API initially
- State management library (Redux/Zustand) - Evaluate when UI complexity requires it
- Custom branding UI (logo upload, color picker) - Phase 04 and Phase 18

## Notes

- Configuration stored in DB aligns with the project's "minimal .env" philosophy
- i18n is limited to English and Spanish initially but architecture supports any language
- Multi-currency does NOT mean currency conversion; each tenant operates in one currency
- The shared package must remain dependency-free to avoid bloating frontend bundles
- Frontend state management intentionally left flexible — add Redux/Zustand when needed, not preemptively

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02
**Next Phase**: Phase 04 (Design System)
