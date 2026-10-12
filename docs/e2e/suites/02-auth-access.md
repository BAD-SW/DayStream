# Suite 02 — Authentication, Access Control & Isolation

Covers specs 02 (security), 03 (tenancy, context), 29 (context switcher). These are `P0` by nature: a failure here is a security defect. Conventions: [README](../README.md).

Mind the login budget (10 auth requests per minute). Reuse sessions from preflight wherever a script does not test the login itself.

---

### AUTH-01 · Login with valid credentials
`P0` `regression` · Spec 02 R1 · As: owner · Status: Draft
1. Log in at `/login` with the correct email and password.
**Expect:** dashboard for the right business; the session survives a page reload.
**Cross-check:** `GET /api/v1/profile` returns this user; `GET /api/v1/admin/my-context` returns the matching tenant and business.

### AUTH-02 · Login refused with bad credentials
`P0` `negative` · Spec 02 R1 · Status: Draft
1. Correct email, wrong password. 2. Unknown email, any password.
**Expect:** both refused with the **same** generic message (no hint about which part was wrong); no token is issued; the password field is cleared.

### AUTH-03 · Password reset with a token
`P0` `regression` · Spec 02 R1 (commit `51cdf6f`) · Status: Draft
**Pre:** a throw-away user `e2e-{RUN}-reset@daystream.test` (created as staff in the E2E business, or by JNY-01).
1. At `/forgot-password` request a reset for that email.
2. Obtain the reset token (how it is delivered locally is calibrated on the first run: email log, server log or database).
3. Open `/reset-password` with the token; set a new password.
4. Log in with the old password, then with the new one. Reuse the same token again.
**Expect:** old password fails, new one works; the token works once only; an expired or tampered token is refused.
**Cross-check:** requesting a reset for an unknown email shows the same confirmation as for a known one (no account enumeration).

### AUTH-04 · Token refresh and logout-all
`P1` `regression` · Spec 02 R7 · As: manager · Status: Draft
1. With a valid session, call `POST /api/v1/auth/refresh`. 2. Call `POST /api/v1/auth/logout-all`. 3. Call refresh again with the earlier refresh token.
**Expect:** step 1 returns a new access token; step 3 is refused.

### AUTH-05 · Expired or malformed tokens are rejected
`P0` `negative` · Spec 02 R7 · Status: Draft
1. Call `GET /api/v1/customers` with: no token, a garbage token, a token with one character changed.
**Expect:** 401 each time; no data in the body.

### AUTH-06 · Sidebar and dashboard match the persona: system
`P0` `regression` · Specs 04 R3A, 29 R6 · As: system · Status: Draft
**Expect:** modules shown are exactly Tenants, Coverage Map, Prospect Categories, Reports, Users, Configuration, Processes, Audit Log, Query Editor. No business modules (Customers, Offerings…).

### AUTH-07 · Sidebar and dashboard match the persona: tenant
`P0` `regression` · As: tenant · Status: Draft
**Expect:** exactly Businesses, Prospects, Users, Billing, Reports, Processes, Settings. In the tenant UI "customers" means businesses.

### AUTH-08 · Sidebar matches role within the business persona
`P0` `regression` · Spec 02 R4 (commit `51cdf6f`, least-privilege nav) · As: owner, manager, reception · Status: Draft
**Expect:**
- Owner: Customers, Bookings/Orders, Schedule, Time Clock, Timesheets, My Hours, Accounting, Reports, Marketing, Offerings, Business Setup, Website, Settings (+ Events / Community only if their feature flags are on).
- Manager: as owner minus Accounting (`reports:*`), Marketing (`marketing:read`), Website (`cms:read`), Settings (`settings:*`).
- Reception / therapist / trainer (Staff): Customers, Bookings/Orders, Time Clock, My Hours only. No Schedule, Timesheets, Offerings, Business Setup (they lack `staff:read` and `services:read`).
**Cross-check:** the dashboard tiles show the same set as the sidebar for each role.

### AUTH-09 · Customer persona sees only self-service
`P0` `regression` · As: customer · Status: Draft
**Expect:** only booking-focused modules (Bookings/Orders, plus Events / Community when flagged on). No CRM, staff, money or settings modules, and no Time Clock or My Hours (defect D-3, fixed 2026-10-12).

### AUTH-10 · Hidden is not enough: direct URLs are refused
`P0` `negative` · Spec 02 R4 · As: reception, then customer · Status: Draft
1. As reception, type the URLs `/accounting`, `/payroll`, `/settings`, `/marketing`, `/staff`, `/admin/tenants`, `/query-editor`.
2. As customer, type `/customers`, `/staff`, `/reports`, `/admin/businesses`.
**Expect:** none of the pages show their data: the user is redirected or sees an access-denied state. Record any page that renders its shell and merely fails to load data: that is a finding (`P1`).

### AUTH-11 · The API enforces the same rules as the UI
`P0` `negative` · Spec 02 R4 · As: reception, customer · Status: Draft
1. As reception (Staff): `POST /api/v1/services`, `PUT /api/v1/payroll/settings`, `POST /api/v1/pay/refunds`, `GET /api/v1/admin/tenants`, `POST /api/v1/query-editor/execute`.
2. As customer: `GET /api/v1/customers`, `GET /api/v1/staff`, `GET /api/v1/reports/revenue`.
**Expect:** 403 for every call (401 only if the token is missing). No partial data.

### AUTH-12 · Context switcher: system looks into a tenant and a business
`P0` `regression` · Spec 29 R1–R7, R10 · As: system · Status: Draft
1. Open the context switcher; switch to a tenant; then to one of its businesses.
2. Navigate across three pages; reload; switch back to system.
**Expect:** the sidebar changes to tenant modules, then to business modules; a breadcrumb shows platform › tenant › business; the context survives navigation and reload; the header never shows a business other than the one selected (KI-2).
**Cross-check:** API calls made in business context carry that business id; the lists show that business's data and not another's.

### AUTH-13 · Context switching never raises privileges
`P0` `negative` · Spec 29 R9 · As: tenant, owner, reception · Status: Draft
1. As tenant: the switcher lists only this tenant's businesses; try to force another tenant's business id (through the URL, `sessionStorage`, or the `X-Context-Tenant-Id` header on an API call).
2. As owner and reception: the switcher offers no other tenant and no system scope.
**Expect:** forced values are rejected by the API (403 / 404); the UI falls back to an allowed context.

### AUTH-14 · Tenant isolation at the API
`P0` `negative` · Specs 02 R5, 03 R1 · As: owner (tenant A) vs biz-thin (tenant B, if seeded under a different tenant) or the E2E tenant from JNY-01 · Status: Draft
1. As user A, note the ids of a customer, a service, a booking, a staff member, an invoice.
2. As user B, `GET`, `PUT` and `DELETE`/archive each of those ids.
3. As user B, list each collection.
**Expect:** every direct access returns 404 or 403; lists contain none of A's records; A's records are unchanged afterwards.

### AUTH-15 · Business isolation inside one tenant
`P0` `negative` · AGENTS rule 3 · As: owners of two businesses under one tenant · Status: Draft
1. Call business-scoped endpoints (`/customers`, `/bookings`, `/services`) with **no** business id. 2. Call them with the sibling business's id.
**Expect:** step 1 is refused (no fallback to a default business); step 2 is refused for a business-persona user.

### AUTH-16 · Customer can reach only their own records
`P0` `negative` · AGENTS rule 5 · As: customer · Status: Draft
1. `GET /api/v1/profile/customer` and its notes, activities, preferences.
2. Try another customer's id on `/api/v1/customers/{id}`, `/api/v1/bookings/{id}`, `/api/v1/pay/methods` (with another customer id), `/api/v1/pay/invoices/{id}`.
**Expect:** own data returned; every cross-customer call refused.
**Bookings (defect D-4, fixed 2026-10-12):** `GET /api/v1/bookings` returns only bookings whose customer record has the caller's email, and an empty list when the login has no customer record in that business; `GET /bookings/{id}` and `/bookings/{id}/ical` for any other booking, including one with no customer attached, return 404; `GET /bookings/calendar` and `/bookings/recurring/{id}` return 403; passing another `customer_id` or a `customer_search` in the query does not widen the result.
**Note:** `/pay/methods` has no explicit permission check yet (KI-4). Record exactly what a customer and a Staff user can do there on the first run.

### AUTH-17 · Auth rate limit
`P1` `negative` · Spec 02 R10 · Status: Draft · **Run last in this suite, then wait 60 seconds**
1. Send 11 login attempts with a wrong password within one minute.
**Expect:** the 11th returns 429 with code `RATE_LIMITED`; after the window, a correct login works again.

### AUTH-18 · Sensitive actions are audited
`P1` `regression` · Spec 02 R9 · As: system · Status: Draft
1. After this suite, open `/admin/audit-log` and filter to the run's time window.
**Expect:** entries exist for logins, the password reset, and the admin changes made in the run, each with actor, time and target. Entries cannot be edited or deleted from the UI.

### AUTH-19 · Logout revokes the refresh token
`P0` `regression` · Spec 02 R7 · As: owner · Status: Verified
1. Log in through the UI; copy the refresh token from local storage. 2. Click **Sign out**. 3. Call `POST /api/v1/auth/refresh` with the copied token.
**Expect:** step 3 returns 401 (defect D-2, fixed 2026-10-12: the logout request used to leave unauthenticated and revoke nothing).
**Cross-check:** `usr_refresh_tokens` shows the token revoked; nothing but theme preferences remains in local storage.

### AUTH-20 · Each role can use every module its sidebar offers
`P0` `regression` · Migration 135 · As: owner, manager, reception · Status: Verified
1. For each role, open every sidebar item and watch the network panel.
**Expect:** no 403 on any call made by a screen the sidebar offers. Owner reaches Marketing, Website (pages, blog, media), Integrations and Check-In (defect D-1, fixed 2026-10-12); manager and staff reach Check-In; staff get 403 on Marketing if they type the URL.
**D-8 (fixed 2026-10-12):** `/bookings`, booking create and edit read the business time zone, currency and filter names from `GET /api/v1/bookings/filters`, which every business role may call (customers get 403). Check as reception that the staff and service filters are filled and that a booking stored at 10:00 UTC shows as 12:00 PM for a business in `Europe/Madrid` (summer).
**Open (D-10):** as reception / therapist, `/bookings/calendar` still gets 403 on `/locations` and `/services`.

### AUTH-21 · Processor configuration is limited to the caller's own level
`P0` `negative` · Spec 10 R0.1 · As: owner, tenant · Status: Verified
1. As owner, `GET /api/v1/pay/processors/config?owner_level=platform`, then the same for another tenant and another business. 2. Repeat as tenant for the platform level.
**Expect:** every call outside the caller's own level and scope is refused.
**Verified 2026-10-12 (defect D-7 fixed):** owner → platform 403, tenant level 403, another business 403, own business 200, list of all connections 403, `PUT` at platform level 403; tenant user → platform 403, other tenant 403, business of another tenant 403, own tenant and own businesses 200; system → all 200.
