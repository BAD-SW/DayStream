# Phase 02: Security & Compliance - Design Document

**Date**: June 11, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 03

---

## Overview

This document describes the technical design for DayStream's security and compliance layer including authentication, OAuth social login, MFA, role-based access control, tenant isolation, encryption, session management, GDPR compliance, audit logging, rate limiting, and input validation.

---

## Table of Contents

1. [Authentication Architecture](#1-authentication-architecture)
2. [OAuth Social Login](#2-oauth-social-login)
3. [Multi-Factor Authentication](#3-multi-factor-authentication)
4. [Role-Based Access Control](#4-role-based-access-control)
5. [Tenant Data Isolation](#5-tenant-data-isolation)
6. [Data Encryption](#6-data-encryption)
7. [Session Management](#7-session-management)
8. [GDPR Compliance](#8-gdpr-compliance)
9. [Audit Logging](#9-audit-logging)
10. [Rate Limiting](#10-rate-limiting)
11. [Input Validation](#11-input-validation)
12. [Database Schema](#12-database-schema)

---

## 1. Authentication Architecture

### Flow

```
Client                    Server                     Database
  │                         │                           │
  ├─── POST /api/v1/auth/login ──►                      │
  │    { email, password }  │                           │
  │                         ├── Lookup user by email ───►│
  │                         │◄── User record ───────────┤
  │                         ├── bcrypt.compare() ──►    │
  │                         ├── Generate JWT ──►        │
  │                         ├── Generate refresh token ─►│
  │                         │   (store in DB)           │
  │◄── { accessToken, refreshToken } ──┤                │
  │                         │                           │
```

### JWT Structure

```typescript
// Access token payload
interface JwtPayload {
  sub: string;        // user_id (UUID)
  tid: string;        // tenant_id (UUID)
  role: string;       // user's role
  iat: number;        // issued at
  exp: number;        // expiration
}

// Token configuration
const ACCESS_TOKEN_EXPIRY = '24h';   // configurable per tenant (future)
const REFRESH_TOKEN_EXPIRY = '7d';
const JWT_ALGORITHM = 'HS256';
```

### Password Hashing

```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### Password Complexity Rules

```typescript
const passwordSchema = Joi.string()
  .min(10)
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/[0-9]/, 'digit')
  .pattern(/[^a-zA-Z0-9]/, 'special')
  .required();
```

---

## 2. OAuth Social Login

### Provider Architecture

```
packages/server/src/auth/
├── providers/
│   ├── index.ts              # Provider registry
│   ├── google.ts             # Google OAuth implementation
│   ├── facebook.ts           # Facebook Login implementation
│   └── apple.ts              # Apple Sign-In implementation
├── oauth-handler.ts          # Common OAuth callback logic
└── account-linker.ts         # Link/create account from OAuth profile
```

### OAuth Flow

```
1. Client initiates: GET /api/v1/auth/oauth/:provider (redirect to provider)
2. User authorizes on provider's site
3. Provider redirects to: GET /api/v1/auth/oauth/:provider/callback?code=...
4. Server exchanges code for access token
5. Server fetches user profile from provider
6. Server creates or links user account
7. Server issues JWT + refresh token
8. Redirect client with tokens
```

### Provider Configuration (per tenant, stored in DB)

```typescript
interface OAuthProviderConfig {
  provider: 'google' | 'facebook' | 'apple';
  enabled: boolean;
  client_id: string;       // encrypted at rest
  client_secret: string;   // encrypted at rest
  scopes: string[];
}
```

### Account Linking Logic

```typescript
async function handleOAuthCallback(profile: OAuthProfile, tenantId: string) {
  // 1. Check if OAuth link exists for this provider + provider_user_id
  const existingLink = await findOAuthLink(profile.provider, profile.id, tenantId);
  
  if (existingLink) {
    // Known user — issue tokens
    return issueTokens(existingLink.user_id, tenantId);
  }

  // 2. Check if email matches an existing user in this tenant
  const existingUser = await findUserByEmail(profile.email, tenantId);
  
  if (existingUser) {
    // Link provider to existing account
    await createOAuthLink(existingUser.id, profile);
    return issueTokens(existingUser.id, tenantId);
  }

  // 3. Create new user account + link
  const newUser = await createUser({ ...profile, tenantId, role: 'customer' });
  await createOAuthLink(newUser.id, profile);
  return issueTokens(newUser.id, tenantId);
}
```

---

## 3. Multi-Factor Authentication

### TOTP Implementation

```typescript
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';

// Generate secret for user
function generateMfaSecret(userEmail: string): { secret: string; qrCodeUrl: string } {
  const secret = speakeasy.generateSecret({
    name: `DayStream (${userEmail})`,
    issuer: 'DayStream',
  });
  return {
    secret: secret.base32,
    qrCodeUrl: secret.otpauth_url,
  };
}

// Verify TOTP code
function verifyTotp(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1, // Allow 1 step drift (30 seconds)
  });
}
```

### MFA Login Flow

```
1. User submits email + password
2. Server validates credentials
3. IF user has MFA enabled:
   a. Server returns { requiresMfa: true, mfaToken: <temp_token> }
   b. Client prompts for TOTP code
   c. Client submits: POST /api/v1/auth/mfa/verify { mfaToken, code }
   d. Server verifies TOTP code
   e. Server issues full JWT + refresh token
4. IF user does NOT have MFA:
   a. Server issues JWT + refresh token directly
```

### Backup Codes

- Generate 10 single-use backup codes on MFA enrollment
- Hash each code before storage (bcrypt)
- Mark as used after redemption
- Allow regeneration (invalidates all previous codes)

---

## 4. Role-Based Access Control

### Permission Model

```typescript
// Permission format: resource:action
type Permission = string;

// Examples:
// 'bookings:create', 'bookings:read', 'bookings:update', 'bookings:delete'
// 'services:*'  (wildcard — all actions on services)
// '*:*'         (super admin — everything)

interface Role {
  id: string;
  tenant_id: string | null;  // null = system role (super_admin)
  name: string;
  permissions: Permission[];
  is_system: boolean;        // system roles cannot be edited by tenants
}
```

### Default Roles

| Role | Key Permissions |
|---|---|
| Super Admin | `*:*` (all) |
| Business Owner | `services:*`, `bookings:*`, `staff:*`, `reports:*`, `settings:*` |
| Manager | `services:read`, `bookings:*`, `staff:read`, `reports:read`, `customers:*` |
| Staff | `bookings:read`, `bookings:update`, `customers:read`, `schedule:read` |
| Customer | `bookings:create(own)`, `bookings:read(own)`, `profile:update(own)` |

### Permission Middleware

```typescript
function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userPermissions = req.user.permissions; // loaded from JWT or cache
    
    const hasPermission = permissions.every(required =>
      userPermissions.some(userPerm => matchPermission(userPerm, required))
    );

    if (!hasPermission) {
      auditLog('permission_denied', { user: req.user.id, required: permissions });
      return res.status(403).json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
    }
    
    next();
  };
}

function matchPermission(userPerm: string, required: string): boolean {
  if (userPerm === '*:*') return true;
  const [userResource, userAction] = userPerm.split(':');
  const [reqResource, reqAction] = required.split(':');
  if (userResource === reqResource && userAction === '*') return true;
  return userPerm === required;
}
```

### Custom Roles

Business Owners can create custom roles:
- Select from available permissions
- Cannot include permissions higher than their own role
- Stored per tenant in the `roles` table
- Assigned to users via `user_roles` join table

---

## 5. Tenant Data Isolation

### Middleware

```typescript
function tenantContext(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.user?.tid; // from JWT
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_TENANT' });
  }

  // Attach to request for use in queries
  req.tenantId = tenantId;
  next();
}
```

### Query Pattern

All tenant-scoped queries MUST include tenant_id:

```typescript
// CORRECT
async function getBookings(tenantId: string, filters: BookingFilters) {
  return pool.query(
    'SELECT * FROM bookings WHERE tenant_id = $1 AND status = $2',
    [tenantId, filters.status]
  );
}

// NEVER — missing tenant_id
async function getBookings(filters: BookingFilters) {
  return pool.query('SELECT * FROM bookings WHERE status = $1', [filters.status]);
}
```

### PostgreSQL Row-Level Security (Defense in Depth)

```sql
-- Enable RLS on tenant-scoped tables
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their tenant's rows
CREATE POLICY tenant_isolation_bookings ON bookings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Set tenant context at connection level
SET app.current_tenant_id = '<tenant-uuid>';
```

RLS is a defense-in-depth layer — application code always includes tenant_id explicitly, but RLS catches any mistakes.

---

## 6. Data Encryption

### Field-Level Encryption

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Fields Requiring Encryption

- Wellness/health notes (Phase 05)
- OAuth client secrets (per tenant)
- Stored payment tokens (Phase 10)
- Any PII marked as sensitive by tenant configuration

---

## 7. Session Management

### Refresh Token Storage

```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    device_info VARCHAR(500),
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

### Token Refresh Flow

```
1. Client sends expired access token + refresh token
2. Server looks up refresh token by hash
3. IF revoked or expired → 401 (redirect to login)
4. IF valid → issue new access token + new refresh token (rotation)
5. Revoke old refresh token
```

### Session Revocation

- Password change → revoke ALL refresh tokens for user
- MFA reset → revoke ALL refresh tokens for user
- Explicit logout → revoke current refresh token
- "Sign out all devices" → revoke ALL refresh tokens for user

---

## 8. GDPR Compliance

### Data Export (Right to Access)

```typescript
async function exportUserData(userId: string, tenantId: string): Promise<ExportPackage> {
  return {
    profile: await getUserProfile(userId, tenantId),
    bookings: await getUserBookings(userId, tenantId),
    memberships: await getUserMemberships(userId, tenantId),
    payments: await getUserPayments(userId, tenantId),
    consents: await getUserConsents(userId, tenantId),
    communications: await getUserCommunications(userId, tenantId),
    activityLog: await getUserActivity(userId, tenantId),
    exportedAt: new Date().toISOString(),
  };
}
```

### Data Deletion (Right to Erasure)

```
1. Customer requests deletion
2. System creates deletion request record (pending)
3. Admin reviews (configurable: auto-approve or manual)
4. Grace period (configurable: 30 days default)
5. Execute deletion:
   - Anonymize: replace PII with "[deleted]"
   - Retain: financial records (legal requirement), anonymized booking history
   - Delete: profile photo, wellness notes, communication preferences
6. Log deletion event in audit trail
```

### Consent Records

```sql
CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    purpose VARCHAR(100) NOT NULL,        -- e.g., 'marketing_email', 'data_processing'
    granted BOOLEAN NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    method VARCHAR(50) NOT NULL,          -- 'signup_form', 'preference_center', 'api'
    ip_address INET
);
```

---

## 9. Audit Logging

### Log Entry Structure

```typescript
interface AuditLogEntry {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;              // e.g., 'user.login', 'booking.create', 'permission.denied'
  resource_type: string;       // e.g., 'user', 'booking', 'service'
  resource_id: string | null;
  details: Record<string, unknown>;  // action-specific data
  ip_address: string;
  user_agent: string;
  timestamp: string;
  signature: string;           // HMAC for tamper detection
  previous_signature: string;  // chain link
}
```

### HMAC Chain

```typescript
function signAuditEntry(entry: AuditLogEntry, previousSignature: string): string {
  const payload = JSON.stringify({
    ...entry,
    previous_signature: previousSignature,
  });
  return crypto.createHmac('sha256', AUDIT_SIGNING_KEY).update(payload).digest('hex');
}
```

### Audit Events

| Category | Events |
|---|---|
| Auth | login, logout, login_failed, password_changed, mfa_enabled, mfa_disabled |
| Access | permission_denied, role_assigned, role_removed |
| Data | record_created, record_updated, record_deleted |
| Admin | tenant_created, config_changed, user_suspended |
| System | update_applied, rollback_executed, maintenance_mode |

---

## 10. Rate Limiting

### Implementation

```typescript
import rateLimit from 'express-rate-limit';

// Auth endpoints: strict
const authLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 10,               // 10 attempts
  message: { error: 'Too many attempts', code: 'RATE_LIMITED', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
});

// API endpoints: moderate
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 1000,                   // 1000 requests
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Apply
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1', apiLimiter);
```

### Exempt Endpoints

- `GET /api/health` — no rate limit
- `GET /api/docs` — no rate limit

---

## 11. Input Validation

### Validation Middleware

```typescript
import Joi from 'joi';

function validate(schema: Joi.ObjectSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    req[source] = value; // replace with validated/sanitized data
    next();
  };
}
```

### Usage Pattern

```typescript
const createBookingSchema = Joi.object({
  service_id: Joi.string().uuid().required(),
  date: Joi.date().iso().required(),
  time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  staff_id: Joi.string().uuid().optional(),
});

router.post('/bookings', validate(createBookingSchema), requirePermission('bookings:create'), createBooking);
```

---

## 12. Database Schema

### Security-Related Tables

```sql
-- OAuth provider links
CREATE TABLE oauth_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'facebook', 'apple')),
    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    provider_avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, provider, provider_user_id)
);

-- MFA configuration
CREATE TABLE user_mfa (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('totp', 'sms')),
    secret_encrypted VARCHAR(500) NOT NULL,  -- encrypted TOTP secret
    enabled BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MFA backup codes
CREATE TABLE mfa_backup_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles and permissions
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),    -- NULL for system roles
    name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

-- User role assignments
CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id, tenant_id)
);

-- Password history (prevent reuse)
CREATE TABLE password_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Account lockout tracking
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    tenant_id UUID REFERENCES tenants(id),
    ip_address INET NOT NULL,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    signature VARCHAR(64) NOT NULL,
    previous_signature VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Data deletion requests (GDPR)
CREATE TABLE deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    grace_period_ends TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processed_by UUID REFERENCES users(id)
);
```

---

**Last Updated**: June 11, 2026
