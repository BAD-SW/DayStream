# DayStream — Pre-Launch Security Hardening Checklist

**Purpose**: Close known security gaps before production launch and before commissioning a paid penetration test.
**Status**: 📋 Planned
**Last Updated**: October 24, 2026

---

## How to use this document

Findings are grouped by severity. Each item lists:
- **What** — the gap
- **Where** — the file(s) involved
- **Fix** — the concrete change
- **Checkbox** — mark `- [x]` when done and verified

Work top-down: close **High** before launch, close **Medium** before the pen test, and triage **Low / supply-chain** as time allows. A penetration test is most cost-effective *after* the High and Medium items are closed — otherwise you pay for a report that restates what's already known here.

This checklist is based on a code-level review of authentication, tenant isolation, input handling, secrets, headers, and dependencies. It is not a substitute for the paid penetration test or for manual testing with security tooling — it is the pre-work that makes that test worthwhile.

---

## High severity — close before launch

### H1. Row-Level Security is defined but effectively bypassed in production
- [ ] Decide and document the tenant-isolation model (RLS backstop vs. accepted app-level-only)
- [ ] If keeping RLS: run the app with a non-owner DB role so policies actually apply; move request-path queries off `adminPool`
- [ ] If accepting app-level-only: document the compensating controls and add tests that prove cross-tenant access is rejected

**What**: Migrations enable RLS with `tenant_id` policies, but the running app connects with the database-owner connection string, and table owners bypass RLS. The vast majority of queries run on the admin pool, so there is no database-level isolation backstop. Tenant isolation is single-layer and enforced only in application code.

**Where**:
- `packages/server/src/db/pool.ts` (documents that per-role RLS connections were removed; both pools use the same credentials)
- `packages/server/src/auth/tenant-context.ts` (the actual app-level enforcement)
- `packages/server/src/db/migrations/` (RLS policies that are not taking effect at runtime)

**Fix**: This is an architecture decision, not a one-line change. Either (a) reinstate a non-superuser application role (`daystream_app`) for the request-path pool so RLS policies apply as a second layer, and migrate request-handler queries from `adminPool` to the RLS-enforced pool; or (b) make a conscious, documented decision to run app-level-only and add automated cross-tenant isolation tests as the compensating control. Enterprise customers' security teams will ask about this — have a defensible answer.

---

### H2. The `tenant_id` in login is not a real security boundary
- [ ] Remove or constrain the cross-tenant email fallback in login
- [ ] Resolve the correct tenant on the login screen instead of passing a hardcoded seed tenant
- [ ] Confirm lockout counters key consistently on the resolved tenant

**What**: Login falls back to a cross-tenant lookup by email alone when the tenant-scoped lookup misses, so authentication is effectively global-by-email. The `tenant_id` supplied at login provides no isolation. There is also a minor inconsistency in which tenant the lockout counter keys on between the two code paths.

**Where**:
- `packages/server/src/services/auth.service.ts` — `loginUser`, `findActiveUserByEmailAnyTenant`

**Fix**: Resolve the real tenant before authenticating (e.g. by domain, subdomain, or an explicit tenant selection) rather than relying on a hardcoded seed tenant on the login screen, then remove the global email fallback. If a fallback must remain temporarily, make the behavior explicit and keep lockout keyed on the resolved tenant in both paths.

---

### H3. MFA is a non-functional stub
- [ ] Implement the MFA verification endpoint (TOTP verify)
- [ ] Issue tokens only after successful second factor
- [ ] Require MFA for system and tenant-level personas at minimum

**What**: Login detects `requires_mfa` and withholds tokens, but there is no verification endpoint, so a second factor cannot be completed. MFA is effectively unavailable as a control — including for system administrators who manage all tenants.

**Where**:
- `packages/server/src/routes/auth.ts` (no verify route)
- `packages/server/src/services/auth.service.ts` (`loginUser` returns `requiresMfa` but the temp token is never used)

**Fix**: Add the MFA verification endpoint, validate the TOTP against `usr_user_mfa`, and only then issue access/refresh tokens. At minimum, require MFA for `system` and `tenant` personas given their blast radius.

---

## Medium severity — close before the penetration test

### M1. No security headers (helmet not installed)
- [ ] Add `helmet` to the server
- [ ] Enable HSTS, a Content-Security-Policy, `X-Frame-Options`, `X-Content-Type-Options`, and referrer policy
- [ ] Verify headers on a deployed response

**What**: No `helmet` and no security headers. Missing HSTS, CSP, `X-Frame-Options`, `X-Content-Type-Options`. This is close to an automatic scanner finding.

**Where**: `packages/server/src/app.ts`

**Fix**: Install `helmet` and mount it early in the middleware chain. Tune CSP to the client origin and any embed (widget) needs. This is a cheap, high-leverage fix.

---

### M2. Secrets not validated at startup; hardcoded audit-key fallback
- [ ] Validate `JWT_SECRET`, `ENCRYPTION_KEY`, and `AUDIT_SIGNING_KEY` at startup (fail fast if missing/weak)
- [ ] Remove the `'dev-audit-key'` fallback
- [ ] Replace the literal DB-role password in the migration with a provisioned secret

**What**: `JWT_SECRET`, `ENCRYPTION_KEY`, and `AUDIT_SIGNING_KEY` are not in the startup config validation. `audit.service.ts` falls back to a hardcoded `'dev-audit-key'` for audit-log integrity signing if the env var is unset. A migration creates a DB role with a literal password.

**Where**:
- `packages/server/src/config/index.ts` (validation schema does not cover these)
- `packages/server/src/services/audit.service.ts` — `getAuditKey()` fallback
- `packages/server/src/db/migrations/004_rls_app_role.sql` (literal role password)

**Fix**: Add these keys to the config validation so the server refuses to start without strong values, including a minimum-length check on `JWT_SECRET`. Remove the audit-key fallback so audit signing cannot silently use a known constant. Provision the DB role password from an environment-sourced secret.

---

### M3. Access tokens are long-lived with no revocation
- [ ] Shorten access-token lifetime (e.g. 15–60 min) and rely on refresh rotation
- [ ] Check `jti` against a revocation list on logout / forced sign-out, or shorten lifetime enough to make this moot

**What**: Access tokens are valid for 24h and there is no server-side revocation/denylist. A `jti` is minted but never checked, so a stolen access token remains valid until expiry regardless of logout.

**Where**: `packages/server/src/services/auth.service.ts` — `ACCESS_TOKEN_EXPIRY`, `generateAccessToken`

**Fix**: Shorten the access-token lifetime and lean on the existing refresh-token rotation. Optionally add a `jti` denylist for immediate revocation on logout-all / compromise.

---

### M4. Refresh token duplicated into the JSON response body
- [ ] Stop returning the refresh token in the response body, or gate it behind a non-browser client flag
- [ ] Confirm the SPA relies solely on the httpOnly cookie

**What**: The refresh token is set as an `httpOnly` cookie (good) but also returned in the JSON body "for non-browser clients." Any SPA that stores the body value in `localStorage` undermines the httpOnly protection.

**Where**: `packages/server/src/routes/auth.ts` — login and refresh responses

**Fix**: Remove the refresh token from the response body for browser clients. If non-browser clients genuinely need it, gate that behind an explicit request signal and document it.

---

### M5. `trust proxy` defaults to `true` in production (XFF spoofing)
- [ ] Set `TRUST_PROXY` to the real hop count for the production topology
- [ ] Verify client IP is accurate behind the load balancer

**What**: `trust proxy` defaults to `true` in production, which (as the code comments flag) lets a client forge `X-Forwarded-For` and defeat the IP-based auth rate limiting.

**Where**: `packages/server/src/app.ts` (`trustProxy` logic)

**Fix**: Set `TRUST_PROXY` to the exact number of proxy hops in front of the app (e.g. ALB + CloudFront) so `req.ip` reflects the real client and rate limiting can't be bypassed.

---

### M6. File uploads have size limits but no type allow-list
- [ ] Add a MIME/extension allow-list at the multer layer per upload route
- [ ] Validate actual file content (magic bytes) for images before processing

**What**: `multer` enforces size limits (5MB / 10MB) but has no `fileFilter`/MIME allow-list; the stored type is trusted from the client-supplied `mimetype`.

**Where**: Upload routes using `multer` (e.g. `cms.ts`, staff/services/resources/merchandise/admin logo, import)

**Fix**: Add a `fileFilter` that restricts to expected MIME types per route, and validate real content type (magic bytes) for images before `sharp` processing.

---

### M7. Unauthenticated / unverified webhook endpoints
- [ ] Add signature verification to marketing email/SMS webhooks (or remove the placeholders until implemented)
- [ ] Confirm per-business Stripe webhook events are reconciled safely given they aren't signature-verified at the endpoint

**What**: Marketing email/SMS webhooks are unauthenticated placeholders that return `{received:true}` with no signature verification. Per-business Stripe webhooks aren't signature-verified at the endpoint and rely on a polling reconciler.

**Where**:
- `packages/server/src/routes/marketing.ts` — `/webhooks/email`, `/webhooks/sms`
- `packages/server/src/routes/payment-platform.ts` — per-business webhook handling

**Fix**: Verify provider signatures on the marketing webhooks before trusting any payload, or remove the placeholder routes until they're implemented. Confirm the Stripe per-business reconciliation path cannot be tricked by a forged event.

---

## Low severity / supply chain — triage as time allows

### L1. Dependency risks
- [ ] Review `xlsx` CDN-tarball dependency (provenance, pinning, known CVEs)
- [ ] Evaluate upgrading `multer` from 1.x to 2.x
- [ ] Run `npm audit` and address high/critical advisories
- [ ] Move `vite` out of server dependencies if it isn't needed at server runtime
- [ ] Consider pinning (or lockfile-enforcing) critical security dependencies

**What**: `xlsx` is installed from a CDN tarball (no npm registry provenance, pinned to a URL). `multer` is on the 1.x line (2.x is current). All deps use caret ranges. `vite` appears in the server dependencies.

**Where**: `packages/server/package.json`

**Fix**: Run `npm audit`, review each item, and decide on upgrades. Document the `xlsx` CDN-tarball choice and its justification, or move to a vetted registry alternative.

---

### L2. Non-parameterized SQL in session/DDL contexts
- [ ] Validate `tenantId` as a UUID inside `tenant-query.ts` before interpolation
- [ ] Confirm the query-editor's interpolated context values are UUID/number-validated

**What**: Most SQL is parameterized, but some `SET` statements and the query editor interpolate values (tenant/user ids, timeout, admin SQL) rather than parameterizing. These are mitigated (JWT-sourced, UUID-validated upstream, admin-only) but brittle.

**Where**:
- `packages/server/src/db/tenant-query.ts` — `SET app.current_tenant_id = '${tenantId}'`
- `packages/server/src/services/query-editor/query-executor.ts` — `SET LOCAL` statements and the wrapped SQL

**Fix**: Add a UUID guard inside `tenant-query.ts` (don't rely on callers), and confirm the query-editor validates its context values. The query editor intentionally runs admin SQL — keep it SELECT-only, system-admin-only, and read-role scoped.

---

### L3. Verbose error logging in one auth path
- [ ] Reduce the login catch block to log `err.message` rather than the full error object

**What**: Most catch blocks log only `err.message`, but the login catch logs the full error object.

**Where**: `packages/server/src/routes/auth.ts` — login catch block

**Fix**: Log `err.message` (and request id) consistently; avoid logging full error objects that may carry sensitive context.

---

### L4. Potential token-in-logs via query string
- [ ] Confirm password-reset links (raw token in query) never appear in request logs
- [ ] Redact token-bearing query strings in the request logger

**What**: The request logger records `originalUrl` (which includes the query string). Password-reset links carry the raw token as a query parameter. Any logged GET with that token would expose it.

**Where**:
- `packages/server/src/app.ts` — request logger
- `email.service.ts` — reset link construction

**Fix**: Redact known token parameters from logged URLs, or ensure token-bearing endpoints are never logged with their query string.

---

## Decisions recorded (deliberately the secure path)

### Google Cloud usage monitoring — keyless (ADC), no service-account key
- [x] ✅ Authentication for the Places usage reader uses **Application Default Credentials**, not a downloaded service-account key.

**What**: Reading Places API usage from Cloud Monitoring needs a Google identity with the Monitoring Viewer role. The quick path (download a service-account JSON key) was deliberately **rejected** — the org policy `iam.disableServiceAccountKeyCreation` forbids key files, and long-lived keys are a known leak risk. The reader authenticates via ADC instead: `gcloud auth application-default login` locally, workload identity (or SA impersonation) in production. No secret is stored in the app; only the project id.

**Where**: `packages/server/src/services/google-cloud-usage.service.ts`, setup in `docs/LOCAL_DEVELOPMENT.md`.

**Production note**: before launch, confirm the server's workload identity (or impersonated SA) has Monitoring Viewer, and that no service-account key was ever created as a workaround.

### Google Cloud — migrate off the personal account before production
- [ ] Move the Google Cloud project out of the personal Gmail account (`williamheveritt@gmail.com`) into the **corporate organization**.
- [ ] Stop using the personal Owner identity for ADC. Provision a **dedicated, least-privilege service account** (Monitoring Viewer only) and have the production server impersonate it or run as a workload identity.
- [ ] Re-point the Places API key (and billing) to the corporate project; update the **Project ID** in DayStream (Configuration → API Keys). No code change required.
- [ ] Remove the temporary personal-account access once the corporate identity is confirmed working.

**Why**: Local development currently authenticates ADC as a personal Gmail account with Owner — a convenient dev scaffold, but it must not carry into production. Nothing in the app hardcodes the personal account (only a project id is stored), so this is a Google Cloud migration, not a code change.

---

## Pre-pen-test readiness gate

Before commissioning the paid penetration test, confirm:

- [ ] All **High** items closed and verified
- [ ] All **Medium** items closed or formally risk-accepted with documented compensating controls
- [ ] `npm audit` clean of high/critical (or exceptions documented)
- [ ] Security headers present on deployed responses
- [ ] Cross-tenant isolation tests passing
- [ ] Secrets validated at startup in the deployed environment
- [ ] A documented decision on the RLS vs. app-level isolation model

---

## Notes

- This checklist reflects a point-in-time code review. Re-review after any significant change to auth, tenant isolation, or payment handling.
- Nothing here indicates a broken architecture — the auth core is solid. These are known, fixable gaps.
- Keep the one-time penetration test (budgeted in `AWS_DEPLOYMENT_AND_COSTS.md`, ~$5,000–$15,000) scheduled for *after* this checklist is worked down.
