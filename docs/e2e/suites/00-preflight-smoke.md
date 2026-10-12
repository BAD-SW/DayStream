# Suite 00 — Preflight & Smoke

The fast gate. Run after every pull and before every push. Preflight proves the environment is fit to test; smoke proves every persona can log in and every major screen opens with data and without errors. Conventions: [README](../README.md).

Smoke scripts do not create data. A smoke screen "opens cleanly" when: the page renders its heading and main content, no error boundary or blank page appears, the browser console has no uncaught errors, and no API call made by the page returns 5xx.

---

## Preflight

### PRE-01 · Dependencies installed and up to date
`P0` `smoke` · Spec 00 R1 · Status: Verified
1. Compare `package-lock.json` with `node_modules` (`npm ls --depth=0` reports no missing or invalid packages).
**Expect:** no missing packages. After a pull that changed a `package.json`, `npm install` has been run.

### PRE-02 · Database reachable and migrations current
`P0` `smoke` · Spec 00 R5, R6 · Status: Verified
1. Confirm PostgreSQL is listening on 5432.
2. Compare the highest migration file number in `packages/server/src/db/migrations/` with the highest applied migration in the database.
**Expect:** they match. If not: stop, report "run `npm run migrate:dev`".

### PRE-03 · API is up
`P0` `smoke` · Spec 03 R12 · Status: Verified
1. `GET /api/health`, `GET /api/health/ready`, `GET /api/health/dependencies`.
**Expect:** all 200; dependencies report the database as healthy.

### PRE-04 · Client is up on the configured port
`P0` `smoke` · Spec 00 R4 · Status: Verified
1. Read `CLIENT_PORT` / `SERVER_PORT` from the repo-root `.env`.
2. Open `http://localhost:{CLIENT_PORT}/login`.
**Expect:** the DayStream login page renders (not another app: port 4000 on this machine is an unrelated project).

### PRE-05 · API documentation loads
`P2` `smoke` · Spec 00 R3 · Status: Verified
1. Open `http://localhost:{SERVER_PORT}/api/docs`.
**Expect:** Swagger UI renders with the route groups.

### PRE-06 · Seed accounts exist
`P0` `smoke` · Spec 00 R8 · Status: Verified
1. Log in through the API once as each of: system, tenant, owner, manager, reception, therapist, customer (7 logins: within the 10 per minute budget). The body must include `tenant_id` (`00000000-0000-0000-0000-000000000001`, the value the login page hardcodes) with `email` and `password`; without it the API answers 400 and the attempt still counts against the budget. Keep the tokens for the run.
**Expect:** all succeed and each response's `user.role` is the expected one (system_admin, tenant_owner, business_owner, manager, reception, therapist, customer). The token itself carries the role name, not the persona. A failure means the seed is missing: stop, report "run `npm run seed:dev`".

### PRE-07 · Payment processor is in a safe mode
`P0` `smoke` `guarded` · Spec 10 R0.1, R0.4 · Status: Verified
1. As system, `GET /api/v1/pay/processors/config?owner_level=platform`; as tenant, `?owner_level=tenant&tenant_id={tenantId}`; as owner, `?owner_level=business&tenant_id={tenantId}&business_id={businessId}`. Also confirm the repo-root `.env` holds no `STRIPE_*` live key.
**Expect:** every level returns either `data: null` (nothing configured, so the mock adapter is used) or a connection with mode `test`. If any level reports live mode: stop, do not run suites 05, 10 or the payment journeys.

### PRE-08 · Existing automated tests still pass
`P1` `smoke` · Spec 00 R9 · Status: Verified
1. `npm run test` from the repo root (server 895, client 186, shared 12 tests at run 20261012-3). The server tests run against `daystream_dev` but, since 2026-10-12, only inside their own `… Test Biz` businesses: they no longer delete the seed tenant's staff, resources, events or check-in records.
**Expect:** all Vitest suites pass in client, server and shared. Failures are reported with the failing test names; E2E continues only if the failures are unrelated to the environment.

### PRE-09 · TypeScript baseline has not grown
`P2` `smoke` · Status: Verified
1. Run the server type-check (`npm run build --workspace=packages/server`, which is `tsc --noEmit`).
**Expect:** 0 errors on the server (the baseline stated in spec 10 tasks). The client baseline is 31 errors (`npx tsc --noEmit` in `packages/client`, measured in run 20261012-1): report the count and whether it grew.

---

## Smoke

### SMK-01 · Login and dashboard, every persona
`P0` `smoke` · Spec 03 R6, Spec 04 R3A · Status: Verified
1. For each of system, tenant, owner, manager, reception, therapist, customer: log in through `/login`.
**Expect:** each lands on a dashboard appropriate to the persona, with their name shown and no error.
**Cross-check:** the sidebar matches the module registry for that persona and role (detail in AUTH-06 to AUTH-09).

### SMK-02 · System admin screens open
`P0` `smoke` · As: system · Status: Verified
1. Open in turn: `/admin/tenants`, `/admin/coverage-map`, `/admin/prospect-categories`, `/admin/system-reports`, `/admin/users`, `/admin/config`, `/admin/processes`, `/admin/audit-log`, `/query-editor`.
**Expect:** each opens cleanly; Tenants lists at least one tenant; Audit Log lists entries.

### SMK-03 · Tenant admin screens open
`P0` `smoke` · As: tenant · Status: Verified
1. Open in turn: `/admin/businesses`, `/admin/prospects`, `/admin/tenant-users`, `/admin/billing`, `/admin/tenant-reports`, `/admin/tenant-processes`, `/admin/tenant-settings`.
**Expect:** each opens cleanly; Businesses lists at least one business.

### SMK-04 · Business day-to-day screens open
`P0` `smoke` · As: owner · Status: Verified
1. Open in turn: `/customers`, `/bookings`, `/bookings/calendar`, `/schedule`, `/clock`, `/clock/admin`, `/clock/mine`, `/offers`, `/business`, `/accounting`, `/payroll`, `/reports`, `/marketing`, `/cms`, `/settings`.
**Expect:** each opens cleanly with the active business shown in the header; Customers, Offerings and the calendar show seeded data.

### SMK-05 · Business secondary screens open
`P1` `smoke` · As: owner · Status: Verified
1. Open in turn: `/customers/segments`, `/customers/import`, `/offers/categories`, `/orders`, `/checkout`, `/memberships`, `/memberships/plans`, `/pricing/rules`, `/pricing/codes`, `/payments`, `/staff`, `/staff/leave`, `/staff/calendar`, `/resources`, `/resources/calendar`, `/settings/locations`, `/check-in`, `/reports/scheduled`, `/cms/blog`, `/cms/media`, `/integrations`.
**Expect:** each opens cleanly.

### SMK-06 · Detail pages open from their lists
`P1` `smoke` · As: owner · Status: Verified
1. From each list, open the first record: a customer, a service, a staff member, a resource, a location, a booking (edit). The seed business holds `E2E Therapist`, `E2E Treatment Room` and `E2E Main Location` for this purpose; recreate them if missing.
**Expect:** each detail page opens cleanly with all its tabs selectable.

### SMK-07 · Customer self-service opens
`P0` `smoke` · As: customer · Status: Verified
1. Open `/dashboard`, `/bookings`, `/profile`.
**Expect:** each opens cleanly and shows only this customer's own data. `/bookings` is titled "My Bookings" and has no staff controls (no New Appointment / New Sale / Orders / Calendar buttons, no staff, service or customer filters, no row actions).
**Cross-check:** opening `/customers`, `/clock`, `/bookings/calendar` or `/checkout` as the customer lands on `/dashboard`.

### SMK-08 · Public pages open without login
`P1` `smoke` · Spec 38 R3 · Status: Verified
1. In a logged-out browser open `/login`, `/forgot-password`, and `/booking-widget?business_id={businessId}&product_id={serviceId}` (both parameters are required). The widget is enabled for the seed business by a row in `wgt_widget_configs` (inserted directly on 2026-10-12: there is no screen or API to change it yet, see KI-12).
**Expect:** all render; the widget lists the business's bookable offerings.

### SMK-09 · Protected routes reject anonymous users
`P0` `smoke` `negative` · Spec 02 R1 · Status: Verified
1. Logged out, open `/customers`, `/admin/tenants`, `/query-editor`.
2. Call `GET /api/v1/customers` with no token.
**Expect:** the browser is sent to `/login`; the API returns 401.

### SMK-10 · Logout ends the session
`P0` `smoke` · Spec 02 R7 · Status: Verified
1. As owner, log out, then press the browser back button and reload.
**Expect:** the login page; no business data is shown.
**Cross-check:** the old access token no longer refreshes (`POST /api/v1/auth/refresh` fails).

### SMK-11 · Theme toggle works and persists
`P2` `smoke` · Spec 30 R2, R3 · Status: Verified
1. As owner, switch dark ↔ light, reload the page.
**Expect:** the whole UI changes and the choice survives the reload.
