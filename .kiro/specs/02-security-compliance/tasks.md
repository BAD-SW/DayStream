# Phase 02: Security & Compliance - Tasks

## Overview

Implementation tasks for authentication, OAuth social login, MFA, role-based access control, tenant isolation, encryption, GDPR compliance, audit logging, rate limiting, and input validation.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Email/Password Authentication

### 1.1 Registration
- [x] ✅ Create `POST /api/v1/auth/register` endpoint
- [x] ✅ Validate input (email, password, first_name, last_name) with Joi
- [x] ✅ Enforce password complexity (min 10 chars, mixed case, numbers, symbols)
- [x] ✅ Hash password with bcrypt (cost factor 12)
- [x] ✅ Check for existing user with same email in tenant
- [x] ✅ Create user record in database
- [x] ✅ Issue JWT access token and refresh token
- [x] ✅ Write unit tests for registration flow

### 1.2 Login
- [x] ✅ Create `POST /api/v1/auth/login` endpoint
- [x] ✅ Validate input (email, password)
- [x] ✅ Look up user by email and tenant
- [x] ✅ Verify password with bcrypt.compare
- [x] ✅ Check account lockout status (5 failed attempts)
- [x] ✅ Record login attempt (success/failure)
- [x] ✅ Issue JWT access token and refresh token on success
- [x] ✅ Return MFA challenge if MFA is enabled
- [x] ✅ Write unit tests for login flow (success, wrong password, locked account)

### 1.3 Password Reset
- [x] ✅ Create `POST /api/v1/auth/forgot-password` endpoint (sends reset email)
- [ ] Generate time-limited reset token (15 minutes)
- [ ] Create `POST /api/v1/auth/reset-password` endpoint (validates token, sets new password)
- [ ] Check password history (prevent reuse of last 5)
- [ ] Store new password hash in password_history table
- [ ] Revoke all refresh tokens on password change
- [ ] Write unit tests for reset flow

### 1.4 Account Lockout
- [x] ✅ Track failed login attempts per email + tenant
- [x] ✅ Lock account after 5 consecutive failures
- [x] ✅ Auto-unlock after 15 minutes
- [x] ✅ Clear failure count on successful login
- [ ] Log lockout events in audit trail

---

## 2. OAuth Social Login

### 2.1 Provider Infrastructure
- [ ] Create OAuth provider registry (configurable per tenant)
- [ ] Create `GET /api/v1/auth/oauth/:provider` (redirect to provider authorization URL)
- [ ] Create `GET /api/v1/auth/oauth/:provider/callback` (handle callback, exchange code)
- [ ] Implement account linking logic (find existing, link, or create new)

### 2.2 Google OAuth
- [ ] Implement Google OAuth 2.0 provider
- [ ] Configure scopes (email, profile)
- [ ] Exchange authorization code for tokens
- [ ] Fetch user profile from Google API
- [ ] Write integration tests

### 2.3 Facebook Login
- [ ] Implement Facebook Login provider
- [ ] Configure scopes (email, public_profile)
- [ ] Exchange code for access token
- [ ] Fetch user profile from Facebook Graph API
- [ ] Write integration tests

### 2.4 Apple Sign-In
- [ ] Implement Apple Sign-In provider
- [ ] Handle Apple's JWT-based identity token
- [ ] Parse user info from ID token (Apple only sends name on first auth)
- [ ] Write integration tests

### 2.5 Account Linking
- [x] ✅ Create `oauth_links` table migration
- [ ] Support linking multiple providers to one account
- [ ] Support unlinking a provider (if another auth method exists)
- [ ] Create `GET /api/v1/auth/linked-accounts` endpoint
- [ ] Create `DELETE /api/v1/auth/linked-accounts/:provider` endpoint

---

## 3. Multi-Factor Authentication

### 3.1 TOTP Setup
- [ ] Create `POST /api/v1/auth/mfa/setup` endpoint (generate secret, return QR code URL)
- [ ] Create `POST /api/v1/auth/mfa/verify-setup` endpoint (confirm TOTP code to enable)
- [ ] Encrypt and store TOTP secret in `user_mfa` table
- [ ] Generate 10 backup codes on setup (hashed with bcrypt)
- [ ] Store backup codes in `mfa_backup_codes` table

### 3.2 MFA Login Flow
- [x] ✅ Modify login to return MFA challenge when MFA is enabled
- [ ] Create `POST /api/v1/auth/mfa/verify` endpoint (verify TOTP code, issue tokens)
- [ ] Support backup code verification (mark as used)
- [ ] Support "remember this device" (skip MFA for 30 days on recognized device)

### 3.3 MFA Management
- [ ] Create `DELETE /api/v1/auth/mfa` endpoint (disable MFA, requires password confirmation)
- [ ] Create `POST /api/v1/auth/mfa/backup-codes/regenerate` endpoint
- [ ] Admin endpoint to reset MFA for a user
- [ ] Revoke all sessions on MFA disable
- [ ] Write unit tests for TOTP verification

---

## 4. Role-Based Access Control

### 4.1 Database Setup
- [x] ✅ Create `roles` table migration
- [x] ✅ Create `user_roles` table migration
- [x] ✅ Seed default system roles (Super Admin, Business Owner, Manager, Staff, Customer)
- [x] ✅ Define default permissions per role

### 4.2 Permission Middleware
- [x] ✅ Create `requirePermission()` middleware
- [x] ✅ Implement permission matching logic (exact, wildcard resource, wildcard all)
- [x] ✅ Deny access by default (only granted permissions allow)
- [ ] Log permission denials in audit trail
- [x] ✅ Write unit tests for permission matching

### 4.3 Role Management API
- [ ] Create `GET /api/v1/admin/roles` endpoint (list roles for tenant)
- [ ] Create `POST /api/v1/admin/roles` endpoint (create custom role)
- [ ] Create `PUT /api/v1/admin/roles/:id` endpoint (update permissions)
- [ ] Create `DELETE /api/v1/admin/roles/:id` endpoint (delete custom role)
- [ ] Prevent editing system roles
- [ ] Prevent privilege escalation (can't assign higher than own role)

### 4.4 User Role Assignment
- [ ] Create `POST /api/v1/admin/users/:id/roles` endpoint (assign role)
- [ ] Create `DELETE /api/v1/admin/users/:id/roles/:roleId` endpoint (remove role)
- [ ] Log role changes in audit trail

---

## 5. Tenant Data Isolation

### 5.1 Middleware
- [x] ✅ Create `tenantContext` middleware (extract tenant_id from JWT, attach to request)
- [x] ✅ Reject requests missing tenant context (except public endpoints)
- [ ] Create helper function for scoped queries (always includes tenant_id)

### 5.2 Row-Level Security
- [ ] Enable RLS on all tenant-scoped tables
- [ ] Create RLS policies using `app.current_tenant_id` setting
- [ ] Set tenant context on each database connection from the pool
- [ ] Write integration tests verifying no cross-tenant data access

### 5.3 Isolation Verification
- [ ] Write tests that attempt cross-tenant access (expect failure)
- [ ] Verify error messages never leak data from other tenants
- [ ] Verify file storage paths are tenant-scoped

---

## 6. Data Encryption

### 6.1 Encryption Module
- [x] ✅ Create `packages/server/src/utils/encryption.ts`
- [x] ✅ Implement AES-256-GCM encrypt function
- [x] ✅ Implement AES-256-GCM decrypt function
- [x] ✅ Load encryption key from environment variable
- [x] ✅ Write unit tests for encrypt/decrypt round-trip
- [x] ✅ Write test for tampered ciphertext detection

### 6.2 Apply to Sensitive Fields
- [ ] Encrypt OAuth client secrets before database storage
- [ ] Encrypt MFA secrets before database storage
- [ ] Encrypt wellness/health notes (Phase 05 integration point)
- [ ] Never log encrypted field values

---

## 7. Session Management

### 7.1 Refresh Tokens
- [x] ✅ Create `refresh_tokens` table migration
- [x] ✅ Implement refresh token generation (crypto random, hashed for storage)
- [x] ✅ Create `POST /api/v1/auth/refresh` endpoint (exchange refresh token for new access token)
- [x] ✅ Implement token rotation (new refresh token on each use, revoke old)
- [x] ✅ Store device info and IP address with refresh token

### 7.2 Session Control
- [ ] Create `GET /api/v1/auth/sessions` endpoint (list active sessions)
- [ ] Create `DELETE /api/v1/auth/sessions/:id` endpoint (revoke specific session)
- [x] ✅ Create `DELETE /api/v1/auth/sessions` endpoint (revoke all — sign out everywhere)
- [ ] Revoke all on password change
- [ ] Revoke all on MFA reset

### 7.3 CSRF Protection
- [ ] Implement CSRF token generation for state-changing requests
- [ ] Validate CSRF token on POST/PUT/DELETE endpoints
- [ ] Exempt API-key authenticated requests from CSRF

---

## 8. GDPR Compliance

### 8.1 Data Export
- [ ] Create `POST /api/v1/profile/data-export` endpoint (request export)
- [ ] Implement data aggregation (profile, bookings, memberships, payments, consents)
- [ ] Generate JSON export package
- [ ] Notify user when export is ready (email with download link)
- [ ] Expire download link after 48 hours

### 8.2 Data Deletion
- [x] ✅ Create `deletion_requests` table migration
- [ ] Create `POST /api/v1/profile/delete-account` endpoint (request deletion)
- [ ] Implement grace period (configurable, default 30 days)
- [ ] Implement anonymization (replace PII with "[deleted]")
- [ ] Retain legally required records (financial transactions)
- [ ] Log deletion in audit trail
- [ ] Send confirmation email

### 8.3 Consent Management
- [x] ✅ Create `consent_records` table migration
- [ ] Create `GET /api/v1/profile/consents` endpoint
- [ ] Create `PUT /api/v1/profile/consents` endpoint (grant/revoke)
- [ ] Record all consent changes with timestamp, method, IP
- [ ] Default to opted-out for marketing (opt-in required)

---

## 9. Audit Logging

### 9.1 Audit Service
- [x] ✅ Create `audit_log` table migration
- [x] ✅ Create `packages/server/src/services/audit.ts`
- [x] ✅ Implement `logAudit()` function (write log entry with HMAC signature)
- [x] ✅ Implement HMAC chain (link to previous entry signature)
- [ ] Implement tamper detection (verify chain on read)
- [ ] Batch writes for performance (queue and flush)

### 9.2 Audit Middleware
- [ ] Create middleware that auto-logs all API requests (method, path, status, duration)
- [ ] Redact sensitive data from logs (passwords, tokens, card numbers)
- [x] ✅ Include request metadata (IP, user agent, tenant_id, user_id)
- [x] ✅ Handle audit logging failures without impacting request processing

### 9.3 Audit API
- [ ] Create `GET /api/v1/admin/audit-log` endpoint (paginated, filterable)
- [x] ✅ Support filtering by: date range, user, action, resource type
- [ ] Restrict access to Manager+ roles
- [ ] Support export to JSON and CSV

---

## 10. Rate Limiting

### 10.1 Implementation
- [x] ✅ Install and configure `express-rate-limit`
- [x] ✅ Apply strict rate limit to auth endpoints (10 req/min per IP)
- [x] ✅ Apply moderate rate limit to API endpoints (1000 req/hour per user or IP)
- [x] ✅ Exempt health check and docs endpoints
- [x] ✅ Return 429 with Retry-After header when exceeded
- [ ] Log rate limit violations in audit trail
- [ ] Write tests for rate limiting behavior

---

## 11. Input Validation

### 11.1 Validation Framework
- [x] ✅ Create `validate()` middleware (Joi schema → request validation)
- [x] ✅ Support body, query, and params validation
- [x] ✅ Return structured error response with field-level details
- [x] ✅ Strip unknown fields (strict mode)
- [x] ✅ Enforce max request body size (1MB)

### 11.2 Sanitization
- [ ] Sanitize string inputs against SQL injection
- [ ] Sanitize string inputs against XSS
- [ ] Validate and constrain pagination parameters
- [ ] Validate file uploads (type, size, content)

---

## 12. Vulnerability Management

### 12.1 Dependency Scanning
- [ ] Add `npm audit` to CI pipeline
- [ ] Fail build on critical vulnerabilities
- [ ] Configure Dependabot or similar for automated dependency updates

### 12.2 Secret Scanning
- [ ] Add secret scanning to CI (detect leaked keys, passwords in code)
- [ ] Add `.env` and credential patterns to pre-commit hook
- [ ] Document responsible disclosure policy

---

## 13. Testing

### 13.1 Unit Tests
- [x] ✅ Test password hashing and verification
- [x] ✅ Test JWT generation and validation
- [x] ✅ Test permission matching logic (wildcards, exact, deny)
- [x] ✅ Test encryption round-trip
- [ ] Test TOTP generation and verification
- [ ] Test version comparison (numeric)
- [ ] Test rate limiter behavior

### 13.2 Integration Tests
- [x] ✅ Test full registration → login → access protected endpoint flow
- [ ] Test OAuth callback and account linking
- [ ] Test MFA enrollment and verification flow
- [x] ✅ Test refresh token rotation
- [ ] Test account lockout and unlock
- [ ] Test tenant isolation (cross-tenant access denied)
- [ ] Test GDPR export generates correct data
- [ ] Test GDPR deletion anonymizes correctly
- [ ] Test audit log chain integrity

---

## 14. Email Service

### 14.1 Nodemailer + Ethereal
- [x] ✅ Install and configure Nodemailer
- [x] ✅ Create email service with Ethereal transport for development
- [x] ✅ Support production SMTP configuration
- [x] ✅ Log preview URLs for dev emails
- [x] ✅ Create password reset email template
- [x] ✅ Create data export ready email template
- [x] ✅ Create account deletion confirmation email template
