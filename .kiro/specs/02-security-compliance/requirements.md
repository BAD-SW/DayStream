# Phase 02: Security & Compliance - Requirements

## Overview

This phase implements enterprise-grade security features for the DayStream platform including authentication, multi-factor authentication, role-based access control, tenant isolation, data encryption, GDPR compliance, and audit logging. These capabilities enable the platform to meet security requirements for handling customer data, payment information, and wellness/health-related records while maintaining comprehensive audit trails and tamper-proof logging.

## Goals

- Establish secure authentication with support for multiple sign-in methods
- Implement multi-factor authentication for account protection
- Define and enforce role-based access control per tenant
- Ensure complete tenant data isolation
- Implement GDPR compliance foundations (consent, export, deletion)
- Create tamper-proof audit logging
- Lay groundwork for future HIPAA-readiness
- Implement security scanning and vulnerability management

## Glossary

- **Platform**: The DayStream multi-tenant SaaS wellness business management system
- **SSO**: Single Sign-On authentication mechanism
- **IdP**: Identity Provider that authenticates users (Google, Apple, etc.)
- **MFA**: Multi-Factor Authentication requiring multiple verification methods
- **TOTP**: Time-based One-Time Password algorithm
- **RLS**: Row-Level Security that filters data based on tenant context
- **RBAC**: Role-Based Access Control assigning permissions via roles
- **User**: An individual with authenticated access to the Platform
- **Role**: A named set of permissions assigned to Users within a Tenant
- **Tenant**: An isolated customer business using the Platform
- **Audit_Log**: A tamper-proof record of system activities
- **GDPR**: General Data Protection Regulation for data privacy
- **PII**: Personally Identifiable Information
- **Consent_Record**: A timestamped record of a User's consent for data processing
- **Data_Subject**: Any individual whose personal data is stored in the Platform (customers, staff)

## Requirements

### Requirement 1: Email/Password Authentication

**User Story:** As a user, I want to sign in with my email and password, so that I can access the platform without relying on third-party services.

#### Acceptance Criteria

1. THE Platform SHALL support user registration with email and password
2. THE Platform SHALL hash passwords using bcrypt with a minimum cost factor of 12
3. THE Platform SHALL enforce password complexity requirements (minimum 10 characters, mixed case, numbers, symbols)
4. THE Platform SHALL prevent reuse of the last 5 passwords
5. THE Platform SHALL implement account lockout after 5 consecutive failed login attempts
6. THE Platform SHALL provide a password reset flow via email with time-limited tokens (15 minutes)
7. THE Platform SHALL issue JWT tokens upon successful authentication
8. THE Platform SHALL set JWT expiration to a configurable duration (default 24 hours)
9. THE Platform SHALL include tenant_id, user_id, and role in the JWT payload
10. THE Platform SHALL support refresh token rotation for extended sessions

### Requirement 2: Social/OAuth Authentication

**User Story:** As a customer, I want to sign in with Google or Apple, so that I can access the platform quickly without creating another password.

#### Acceptance Criteria

1. THE Platform SHALL support Google OAuth 2.0 sign-in
2. THE Platform SHALL support Apple Sign-In
3. WHEN a User authenticates via OAuth, THE Platform SHALL create or link the user account automatically
4. THE Platform SHALL extract user profile information (name, email, avatar) from the OAuth provider
5. THE Platform SHALL support linking multiple OAuth providers to a single user account
6. THE Platform SHALL allow unlinking OAuth providers if another authentication method exists
7. IF OAuth authentication fails, THEN THE Platform SHALL display a clear error and offer alternative sign-in methods
8. THE Platform SHALL validate OAuth tokens with the provider on each authentication

### Requirement 3: Multi-Factor Authentication

**User Story:** As a security-conscious user, I want to enable multi-factor authentication, so that my account is protected against credential theft.

#### Acceptance Criteria

1. THE Platform SHALL support TOTP-based MFA compatible with Google Authenticator and similar apps
2. THE Platform SHALL support SMS-based MFA code delivery
3. WHEN a User enables MFA, THE Platform SHALL generate a QR code for TOTP setup
4. WHEN a User logs in with MFA enabled, THE Platform SHALL require verification code entry after password
5. THE Platform SHALL generate backup codes for account recovery when MFA is enabled
6. THE Platform SHALL support "remember this device" option (configurable duration, default 30 days)
7. THE Platform SHALL allow tenant administrators to enforce MFA policies per Role
8. THE Platform SHALL allow administrators to reset MFA for users who lose access
9. THE Platform SHALL require MFA for all Super Admin and Business Owner roles

### Requirement 4: Role-Based Access Control

**User Story:** As a business owner, I want to assign roles to my staff, so that each person can only access the features and data relevant to their job.

#### Acceptance Criteria

1. THE Platform SHALL define the following base roles: Super Admin, Business Owner, Manager, Reception, Therapist, Trainer, Customer
2. THE Platform SHALL assign permissions to roles (not directly to users)
3. THE Platform SHALL evaluate permissions on every API request via middleware
4. THE Platform SHALL scope role assignments per Tenant (a user can have different roles in different tenants)
5. THE Platform SHALL support a permission model with resources and actions (e.g., `bookings:create`, `services:edit`, `reports:view`)
6. THE Platform SHALL deny access by default; only explicitly granted permissions allow access
7. THE Platform SHALL allow Business Owners to create custom roles with selected permissions
8. THE Platform SHALL prevent privilege escalation (users cannot assign roles higher than their own)
9. THE Platform SHALL include role and permissions in the JWT or retrieve them efficiently on each request

### Requirement 5: Tenant Data Isolation

**User Story:** As a business owner, I want absolute certainty that my data is isolated from other businesses, so that there is no risk of data leakage.

#### Acceptance Criteria

1. THE Platform SHALL include `tenant_id` on every tenant-scoped database table
2. THE Platform SHALL enforce tenant context on every API request via middleware
3. THE Platform SHALL reject any query that does not include a tenant filter for tenant-scoped data
4. THE Platform SHALL prevent cross-tenant data access even by authenticated users
5. THE Platform SHALL use PostgreSQL Row-Level Security policies as a defense-in-depth layer
6. THE Platform SHALL validate that API responses never contain data from other tenants
7. THE Platform SHALL scope file/image storage paths by tenant_id
8. THE Platform SHALL include tenant_id in all audit log entries

### Requirement 6: Data Encryption

**User Story:** As a platform operator, I want all sensitive data encrypted, so that data is protected even if storage is compromised.

#### Acceptance Criteria

1. THE Platform SHALL encrypt all data in transit using TLS 1.2 or higher
2. THE Platform SHALL encrypt sensitive fields at the application level before database storage (e.g., payment tokens, personal health notes)
3. THE Platform SHALL use AES-256 encryption for application-level field encryption
4. THE Platform SHALL store encryption keys separately from encrypted data
5. THE Platform SHALL support key rotation without requiring data re-encryption in a single operation
6. THE Platform SHALL never log or expose sensitive data (passwords, tokens, encrypted fields) in error messages or logs
7. THE Platform SHALL encrypt database backups

### Requirement 7: Session Management

**User Story:** As a user, I want my sessions managed securely, so that unauthorized access is prevented if my device is lost or stolen.

#### Acceptance Criteria

1. THE Platform SHALL support concurrent sessions across multiple devices
2. THE Platform SHALL allow users to view and revoke active sessions
3. THE Platform SHALL automatically expire inactive sessions after a configurable timeout (default 30 minutes of inactivity)
4. THE Platform SHALL invalidate all sessions when a password is changed
5. THE Platform SHALL invalidate all sessions when MFA is reset
6. THE Platform SHALL provide a "sign out all devices" action
7. THE Platform SHALL use secure, httpOnly cookies for refresh tokens in web applications
8. THE Platform SHALL implement CSRF protection on state-changing endpoints

### Requirement 8: GDPR Compliance

**User Story:** As a data protection officer, I want GDPR compliance features, so that the platform meets data subject rights requirements for EU customers.

#### Acceptance Criteria

1. THE Platform SHALL provide an API for Data_Subjects to export all their personal data (right to access) in machine-readable JSON format
2. THE Platform SHALL provide a workflow for Data_Subjects to request data deletion (right to erasure)
3. THE Platform SHALL implement consent management with timestamped Consent_Records for each processing purpose
4. THE Platform SHALL display privacy policy and require acceptance before account creation
5. THE Platform SHALL track the legal basis for processing each category of personal data
6. THE Platform SHALL support data processing agreement management for Tenant administrators
7. WHEN a data breach is detected, THE Platform SHALL provide notification workflow to affected users within 72 hours
8. THE Platform SHALL implement data minimization (only collect data necessary for the stated purpose)
9. THE Platform SHALL support configurable data retention periods per data category
10. THE Platform SHALL automatically purge data that exceeds retention periods (with configurable grace period)

### Requirement 9: Audit Logging

**User Story:** As a compliance officer, I want tamper-proof audit logs, so that all security-relevant actions can be traced and verified.

#### Acceptance Criteria

1. THE Platform SHALL log all authentication events (login, logout, failed attempts, MFA events)
2. THE Platform SHALL log all authorization failures (access denied events)
3. THE Platform SHALL log all data modifications (create, update, delete) with before/after values for sensitive entities
4. THE Platform SHALL log all administrative actions (role changes, user management, configuration changes)
5. THE Platform SHALL generate HMAC signatures for each Audit_Log entry
6. THE Platform SHALL maintain a chain of integrity by linking each log entry to the previous entry's signature
7. IF tampered log entries are detected, THEN THE Platform SHALL generate alerts to administrators
8. THE Platform SHALL store Audit_Log entries in append-only fashion (no updates or deletes)
9. THE Platform SHALL include tenant_id, user_id, IP address, user agent, and timestamp on every log entry
10. THE Platform SHALL retain audit logs for a minimum of 1 year (configurable per tenant)

### Requirement 10: Rate Limiting and Abuse Prevention

**User Story:** As a platform operator, I want rate limiting on all endpoints, so that the platform is protected against brute-force attacks and abuse.

#### Acceptance Criteria

1. THE Platform SHALL enforce rate limits on authentication endpoints (max 10 attempts per minute per IP)
2. THE Platform SHALL enforce rate limits on API endpoints (configurable per endpoint category)
3. THE Platform SHALL return HTTP 429 with a Retry-After header when rate limits are exceeded
4. THE Platform SHALL support rate limiting per IP address and per authenticated user
5. THE Platform SHALL implement progressive penalties for repeated violations
6. THE Platform SHALL exempt health check endpoints from rate limiting
7. THE Platform SHALL log rate limit violations in the Audit_Log

### Requirement 11: Input Validation and Sanitization

**User Story:** As a developer, I want all input validated and sanitized at the API boundary, so that injection attacks and malformed data are prevented.

#### Acceptance Criteria

1. THE Platform SHALL validate all API request bodies against Joi schemas before processing
2. THE Platform SHALL reject requests with unknown/unexpected fields (strict validation)
3. THE Platform SHALL sanitize all string inputs to prevent SQL injection
4. THE Platform SHALL sanitize all string inputs to prevent XSS (cross-site scripting)
5. THE Platform SHALL enforce maximum request body sizes (configurable, default 1MB)
6. THE Platform SHALL validate and constrain all pagination parameters (page, limit)
7. THE Platform SHALL return structured validation error responses with field-level error details
8. THE Platform SHALL validate file uploads (type, size, content) before processing

### Requirement 12: Security Vulnerability Management

**User Story:** As a platform operator, I want automated security scanning, so that vulnerabilities are detected and addressed proactively.

#### Acceptance Criteria

1. THE Platform SHALL scan application dependencies for known vulnerabilities on every build
2. THE Platform SHALL scan code for exposed secrets and credentials (pre-commit and CI)
3. THE Platform SHALL test for OWASP Top 10 vulnerabilities
4. WHEN a critical vulnerability is detected in dependencies, THE Platform SHALL fail the build
5. THE Platform SHALL generate security scan reports with vulnerability details and remediation guidance
6. THE Platform SHALL track vulnerability remediation status over time
7. THE Platform SHALL maintain a security contact and responsible disclosure policy
8. THE Platform SHALL undergo penetration testing before production launch

---

## Dependencies

- Phase 00: Infrastructure - Database, API server, environment configuration
- Phase 03: Core Platform - Multi-tenant architecture, user model

## Success Criteria

- Users can register and sign in with email/password, Google, and Apple
- MFA can be enabled and enforced per role
- Role-based access control prevents unauthorized access to all endpoints
- Tenant data isolation is verified (no cross-tenant data leakage)
- Audit logs capture all security-relevant events with cryptographic integrity
- GDPR data export and deletion workflows function correctly
- Rate limiting blocks brute-force attempts
- All API inputs are validated via Joi schemas
- Dependency scanning runs on every build

## Out of Scope

- HIPAA compliance - Architecture supports future implementation but not in this phase
- SAML/LDAP SSO - May be added in a future enterprise phase
- SOC 2 certification - Controls are implemented but formal audit is separate
- Biometric authentication - Mobile app phase will evaluate this
- Hardware security keys (FIDO2/WebAuthn) - Future enhancement

## Notes

- Auth decision (managed provider vs. custom JWT+bcrypt) is still pending discussion with colleague
- Even if a managed provider is chosen, the RBAC, tenant isolation, audit logging, and compliance features remain in scope
- The existing Gold Mine pattern (JWT + bcrypt + custom RBAC) is proven and can be reused
- Encryption keys and JWT secrets are the only security-related values in .env
- Health data (wellness notes, goals, injuries) requires field-level encryption even before HIPAA

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 03
**Next Phase**: Phase 03 (Core Platform)
