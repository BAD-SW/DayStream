# Phase 03: Core Platform & Multi-Tenancy - Design Document

**Date**: June 11, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02

---

## Overview

This document describes the technical design for the DayStream core platform — multi-tenant architecture, tenant provisioning, context propagation, API infrastructure, frontend bootstrap, configuration engine, feature flags, internationalization, and multi-currency support.

---

## Table of Contents

1. [Multi-Tenant Architecture](#1-multi-tenant-architecture)
2. [Tenant Provisioning](#2-tenant-provisioning)
3. [Tenant Context Propagation](#3-tenant-context-propagation)
4. [API Infrastructure](#4-api-infrastructure)
5. [Frontend Application](#5-frontend-application)
6. [Configuration Engine](#6-configuration-engine)
7. [Feature Flag System](#7-feature-flag-system)
8. [Internationalization](#8-internationalization)
9. [Multi-Currency](#9-multi-currency)
10. [Shared Utilities Package](#10-shared-utilities-package)
11. [Health and Status Endpoints](#11-health-and-status-endpoints)
12. [Database Schema](#12-database-schema)

---

## 1. Multi-Tenant Architecture

### Isolation Strategy

DayStream uses **row-level tenancy** with PostgreSQL RLS as defense-in-depth:

```
┌─────────────────────────────────────────┐
│           Single Database                │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │ tenants table                       │ │
│  │  id | name | slug | status          │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │ users table                         │ │
│  │  id | tenant_id | email | ...       │ │
│  │  Row 1: tenant_a | user@a.com      │ │
│  │  Row 2: tenant_b | user@b.com      │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Every query: WHERE tenant_id = $1       │
│  RLS Policy: tenant_id = current_tenant  │
└─────────────────────────────────────────┘
```

### Guarantees

1. **Application layer**: All queries include `tenant_id` (enforced by helper functions)
2. **Database layer**: RLS policies reject rows not matching current tenant context
3. **Storage layer**: File paths prefixed with tenant_id (`/storage/{tenant_id}/...`)
4. **Logging**: All log entries include tenant_id for filtering

---

## 2. Tenant Provisioning

### Provisioning Flow

```
POST /api/v1/admin/tenants
  │
  ├── 1. Validate input (name, slug, owner email)
  ├── 2. Check slug uniqueness
  ├── 3. Create tenant record (status: 'active')
  ├── 4. Create default roles for tenant (Business Owner, Manager, Staff, Customer)
  ├── 5. Create initial Business Owner user
  ├── 6. Apply default configuration (from tenant_configurations)
  ├── 7. Log provisioning in audit trail
  └── 8. Return tenant details + owner credentials
```

### Tenant Data Model

```typescript
interface Tenant {
  id: string;           // UUID
  name: string;         // Display name ("Transcend Health Mallorca")
  slug: string;         // URL identifier ("transcend") — unique globally
  status: 'active' | 'suspended' | 'archived';
  default_language: string;   // ISO 639-1 (e.g., 'en', 'es')
  currency: string;           // ISO 4217 (e.g., 'EUR', 'USD')
  timezone: string;           // IANA timezone (e.g., 'Europe/Madrid')
  created_at: string;
  updated_at: string;
}
```

### Tenant Status Effects

| Status | Effect |
|---|---|
| `active` | Full access for all users |
| `suspended` | All user access denied; admin-only |
| `archived` | Data retained but inaccessible; soft-deleted |

---

## 3. Tenant Context Propagation

### Middleware Chain

```typescript
// Applied to all /api/v1/* routes (after auth middleware)

function tenantContext(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.user?.tid;  // From JWT payload

  if (!tenantId) {
    return res.status(401).json({
      error: 'Missing tenant context',
      code: 'TENANT_REQUIRED',
    });
  }

  req.tenantId = tenantId;

  // Set PostgreSQL session variable for RLS
  // (done at query time via pool wrapper)
  next();
}
```

### Scoped Query Helper

```typescript
import { pool } from '../db/pool';

interface QueryOptions {
  text: string;
  values?: unknown[];
}

// All tenant-scoped queries go through this
async function tenantQuery(tenantId: string, query: QueryOptions) {
  const client = await pool.connect();
  try {
    // Set RLS context
    await client.query("SET app.current_tenant_id = $1", [tenantId]);
    // Execute query (tenant_id should also be in WHERE clause as primary defense)
    const result = await client.query(query.text, query.values);
    return result;
  } finally {
    // Reset context before returning to pool
    await client.query("RESET app.current_tenant_id");
    client.release();
  }
}
```

---

## 4. API Infrastructure

### Route Structure

```
packages/server/src/routes/
├── index.ts                # Route registry - mounts all versioned routes
├── v1/
│   ├── index.ts            # V1 router - mounts all domain routes
│   ├── health.ts           # GET /api/health (unversioned, no auth)
│   ├── auth.ts             # /api/v1/auth/* (login, register, OAuth, MFA)
│   ├── tenants.ts          # /api/v1/admin/tenants/*
│   ├── users.ts            # /api/v1/users/*
│   ├── profile.ts          # /api/v1/profile/* (self-service)
│   └── config.ts           # /api/v1/admin/config/*
```

### Standard Response Formats

```typescript
// Success response
interface ApiSuccess<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// Error response
interface ApiError {
  error: string;        // Human-readable message
  code: string;         // Machine-readable code (e.g., 'VALIDATION_ERROR')
  details?: unknown;    // Field-level errors or additional context
}

// Response helpers
function success<T>(res: Response, data: T, meta?: object, status = 200) {
  return res.status(status).json({ data, meta });
}

function error(res: Response, message: string, code: string, status: number, details?: unknown) {
  return res.status(status).json({ error: message, code, details });
}
```

### Pagination Pattern

```typescript
// Query parameters: ?page=1&limit=20&sort=created_at&order=desc
interface PaginationParams {
  page: number;      // 1-based
  limit: number;     // default 20, max 100
  sort: string;      // column name
  order: 'asc' | 'desc';
}

// Parse and validate
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().default('created_at'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
});
```

### Request ID

```typescript
import { v4 as uuidv4 } from 'uuid';

function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.headers['x-request-id'] as string || uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
```

---

## 5. Frontend Application

### Route Structure

```typescript
// packages/client/src/App.tsx
<BrowserRouter>
  <Routes>
    {/* Public routes */}
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />

    {/* Protected routes */}
    <Route element={<AuthGuard />}>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* Additional routes added per phase */}
      </Route>
    </Route>

    {/* Admin routes */}
    <Route element={<AuthGuard requiredRole="manager" />}>
      <Route element={<AdminLayout />}>
        <Route path="/admin" element={<AdminDashboardPage />} />
        {/* Additional admin routes per phase */}
      </Route>
    </Route>
  </Routes>
</BrowserRouter>
```

### Auth Guard

```typescript
function AuthGuard({ requiredRole }: { requiredRole?: string }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" />;
  if (requiredRole && !hasRole(user, requiredRole)) return <Navigate to="/" />;

  return <Outlet />;
}
```

### API Client with Token Refresh

```typescript
// packages/client/src/api/client.ts
import axios from 'axios';

const apiClient = axios.create({ baseURL: '/api' });

// Request interceptor: attach access token
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handle 401, attempt refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(error.config);
      }
      // Refresh failed — redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

---

## 6. Configuration Engine

### Storage Model

```sql
-- Configuration definitions (what settings exist)
CREATE TABLE configuration_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,         -- 'branding', 'features', 'limits', 'integrations'
    data_type VARCHAR(20) NOT NULL,        -- 'string', 'number', 'boolean', 'json'
    default_value TEXT NOT NULL,
    description VARCHAR(500),
    validation_schema JSONB                -- Optional Joi schema for validation
);

-- Tenant-specific overrides
CREATE TABLE tenant_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);
```

### Configuration Service

```typescript
class ConfigurationService {
  private cache: Map<string, Map<string, unknown>> = new Map(); // tenant_id → key → value
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  async get(tenantId: string, key: string): Promise<unknown> {
    // 1. Check cache
    const cached = this.getFromCache(tenantId, key);
    if (cached !== undefined) return cached;

    // 2. Check tenant override
    const override = await this.getTenantOverride(tenantId, key);
    if (override !== null) {
      this.setCache(tenantId, key, override);
      return override;
    }

    // 3. Fall back to default
    const def = await this.getDefault(key);
    this.setCache(tenantId, key, def);
    return def;
  }

  async set(tenantId: string, key: string, value: unknown, userId: string): Promise<void> {
    // Validate value against definition schema
    await this.validate(key, value);
    // Upsert tenant override
    await this.upsertTenantConfig(tenantId, key, value, userId);
    // Invalidate cache
    this.invalidateCache(tenantId, key);
    // Audit log
    await auditLog('config.updated', { tenantId, key, value, userId });
  }

  invalidateCache(tenantId: string, key?: string): void {
    if (key) {
      this.cache.get(tenantId)?.delete(key);
    } else {
      this.cache.delete(tenantId);
    }
  }
}
```

### Example Configuration Keys

| Category | Key | Type | Default |
|---|---|---|---|
| branding | `brand.primary_color` | string | `#C9A96E` |
| branding | `brand.logo_url` | string | `` |
| features | `feature.online_booking` | boolean | `true` |
| features | `feature.waitlist` | boolean | `true` |
| limits | `limit.max_advance_booking_days` | number | `30` |
| limits | `limit.max_bookings_per_customer` | number | `10` |
| integrations | `integration.google_calendar` | boolean | `false` |

---

## 7. Feature Flag System

### Storage

```sql
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    scope VARCHAR(20) NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'tenant', 'role', 'percentage')),
    enabled BOOLEAN NOT NULL DEFAULT false,
    percentage INTEGER CHECK (percentage >= 0 AND percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-specific flag overrides
CREATE TABLE feature_flag_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    UNIQUE(flag_id, tenant_id)
);
```

### Evaluation Logic

```typescript
async function isFeatureEnabled(flagKey: string, context: { tenantId: string; role?: string }): Promise<boolean> {
  const flag = await getFlag(flagKey);
  if (!flag) return false;

  switch (flag.scope) {
    case 'global':
      return flag.enabled;

    case 'tenant':
      const override = await getTenantOverride(flag.id, context.tenantId);
      return override !== null ? override.enabled : flag.enabled;

    case 'percentage':
      // Deterministic: hash(tenantId + flagKey) % 100 < percentage
      const hash = deterministicHash(context.tenantId + flagKey);
      return (hash % 100) < (flag.percentage || 0);

    default:
      return flag.enabled;
  }
}
```

### Frontend Usage

```typescript
// Hook
function useFeatureFlag(key: string): boolean {
  const { flags } = useAuth(); // flags loaded with auth context
  return flags[key] ?? false;
}

// Usage in component
function BookingPage() {
  const waitlistEnabled = useFeatureFlag('feature.waitlist');
  // ...
}
```

---

## 8. Internationalization

### Architecture (System-Level)

i18n is a **platform-level capability** — all tenants share the same language set and selection mechanism.

```
packages/client/src/i18n/
├── index.ts              # i18next configuration
├── locales/
│   ├── en/
│   │   ├── common.json   # Shared strings (buttons, labels, errors)
│   │   ├── auth.json     # Auth-specific strings
│   │   ├── booking.json  # Booking-specific strings (future phases)
│   │   └── ...
│   └── es/
│       ├── common.json
│       ├── auth.json
│       ├── booking.json
│       └── ...
```

### Configuration

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  resources: { en, es },
  lng: detectLanguage(),      // Browser setting → user profile → tenant default
  fallbackLng: 'en',
  ns: ['common', 'auth'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});
```

### Language Detection Priority

1. User profile `preferred_language` (if authenticated)
2. Browser `navigator.language`
3. Tenant `default_language`
4. Fallback: `'en'`

### Backend Localization

```typescript
// Error messages localized based on Accept-Language header or user preference
function localizedError(key: string, lang: string): string {
  const messages = loadMessages(lang);
  return messages[key] || messages['error.generic'];
}
```

---

## 9. Multi-Currency

### Storage

- Each tenant has a `currency` field (ISO 4217: 'EUR', 'USD', 'GBP', etc.)
- All monetary values stored as integers (minor units / cents)
- No cross-tenant currency conversion

### Formatting

```typescript
function formatCurrency(amountInCents: number, currency: string, locale: string): string {
  const amount = amountInCents / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

// Examples:
// formatCurrency(4500, 'EUR', 'es-ES') → "45,00 €"
// formatCurrency(4500, 'USD', 'en-US') → "$45.00"
// formatCurrency(4500, 'GBP', 'en-GB') → "£45.00"
```

---

## 10. Shared Utilities Package

### Package Structure

```
packages/shared/src/
├── index.ts              # Barrel export
├── types/
│   ├── tenant.ts         # Tenant, TenantStatus
│   ├── user.ts           # User, UserRole
│   ├── api.ts            # ApiResponse, ApiError, PaginatedResult
│   └── config.ts         # ConfigDefinition, FeatureFlag
├── constants/
│   ├── roles.ts          # USER_ROLES, PERMISSIONS
│   ├── config-keys.ts    # Configuration key constants
│   └── error-codes.ts    # ERROR_CODES
├── validation/
│   ├── auth.ts           # Login, register, password schemas
│   ├── tenant.ts         # Tenant creation schema
│   └── pagination.ts     # Pagination params schema
└── utils/
    ├── uuid.ts           # UUID generation helper
    ├── slug.ts           # String → URL-friendly slug
    ├── date.ts           # Date formatting utilities
    └── currency.ts       # Currency formatting
```

### Rules

- **Zero runtime dependencies** — only types, constants, and pure functions
- **No build step** — consumed directly as TypeScript via workspace resolution
- Shared between server and client packages

---

## 11. Health and Status Endpoints

### Endpoints

```typescript
// GET /api/health — basic (no auth, no rate limit)
{
  status: 'ok',
  version: '1.0',
  uptime: 12345
}

// GET /api/health/ready — dependency check (no auth)
{
  status: 'ok',
  dependencies: {
    database: { status: 'ok', responseTime: 5 },
    // future: redis, storage, etc.
  }
}

// GET /api/health/dependencies — full detail (admin only)
{
  status: 'ok',
  dependencies: {
    database: { status: 'ok', responseTime: 5, poolSize: 10, activeConnections: 3 },
    // future: redis, s3, etc.
  }
}
```

### Status Codes

- `200` — All dependencies healthy
- `503` — One or more critical dependencies unavailable

---

## 12. Database Schema

### Core Platform Tables

```sql
-- Tenants (extends Phase 00 schema)
ALTER TABLE tenants ADD COLUMN default_language VARCHAR(5) NOT NULL DEFAULT 'en';
ALTER TABLE tenants ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE tenants ADD COLUMN timezone VARCHAR(50) NOT NULL DEFAULT 'UTC';

-- Configuration definitions (system-level)
CREATE TABLE configuration_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'json')),
    default_value TEXT NOT NULL,
    description VARCHAR(500),
    validation_schema JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant configuration overrides
CREATE TABLE tenant_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL REFERENCES configuration_definitions(key),
    value TEXT NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);

-- Feature flags
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    scope VARCHAR(20) NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'tenant', 'role', 'percentage')),
    enabled BOOLEAN NOT NULL DEFAULT false,
    percentage INTEGER CHECK (percentage >= 0 AND percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feature flag tenant overrides
CREATE TABLE feature_flag_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    UNIQUE(flag_id, tenant_id)
);

-- Indexes
CREATE INDEX idx_tenant_config_tenant ON tenant_configurations(tenant_id);
CREATE INDEX idx_feature_flag_overrides_tenant ON feature_flag_overrides(tenant_id);
```

---

**Last Updated**: June 11, 2026
