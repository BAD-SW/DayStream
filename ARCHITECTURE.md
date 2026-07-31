# DayStream — Architecture Summary

*Compiled by reading `packages/*`, `docs/*`, and `.kiro/*` directly, cross-checked against (and correcting in places) the existing internal docs. Counts reflect the tree as of 2026-07-31.*

DayStream is a multi-tenant SaaS booking & business-management platform (four-level persona model: platform → tenant → business → customer) built as an npm-workspaces monorepo: an Express/PostgreSQL API, a React/Vite admin+booking client, an Expo mobile app, and a shared types package.

**At a glance:** 4 packages · 33 route files · 149 service modules · 72 client pages · 71 migrations · 74 server tests / 10 client tests.

---

## 1. Repository Layout

```
daystream/
├── packages/
│   ├── server/          Express + TypeScript API (port 4001)
│   │   └── src/
│   │       ├── app.ts, index.ts     bootstrap + middleware chain
│   │       ├── auth/                JWT, tenant/business context, RBAC
│   │       ├── middleware/          logging, rate-limit, validation, tenant status
│   │       ├── routes/              33 files, one per mounted resource
│   │       ├── services/            149 files, fine-grained per-domain logic
│   │       ├── db/                  pool, migrations (71 .sql), seed, tenant-query
│   │       ├── jobs/                DB-driven scheduler (SKIP LOCKED)
│   │       └── docs/openapi.ts      hand-written OpenAPI spec
│   ├── client/           React + Vite admin/booking UI (port 4000)
│   │   └── src/
│   │       ├── App.tsx              ~50 routes, flat, wrapped in ProtectedRoute
│   │       ├── design-system/       tokens, themes, components, hooks
│   │       ├── pages/                72 page components (flat, PascalCase)
│   │       ├── api/                 19 domain modules over one axios client
│   │       ├── context/AuthContext  JWT session, feature flags
│   │       └── i18n/                en / es, 3 namespaces
│   ├── mobile/           Expo + expo-router app (React Native 0.86)
│   │   └── app/, services/, store/, theme/
│   └── shared/           Shared TS types, constants, utils (@daystream/shared)
├── docs/                 Architecture, phases, migration-tracker, context history
└── .kiro/
    ├── steering/         style-guide.md, documentation standards
    └── specs/            per-feature specs (30+), tracks build phases
```

### Persona & tenancy hierarchy

Every domain table hangs off this chain; RBAC and routing both branch on `persona`.

```
Platform (system persona)
└── Tenant (e.g. Transcend Health)
    └── Business (e.g. Transcend Mallorca)
        ├── Location
        │   ├── Services + Variants
        │   ├── Staff
        │   └── Resources
        └── Customers
            └── Bookings (references Services, Staff, Resources)
```

---

## 2. Backend — Express API

`packages/server/src/app.ts` assembles one middleware chain: request-id → inline request logger (writes `sys_api_request_logs`) → CORS (locked to the Vite dev origin) → cookie-parser → `express.json` → `/storage` static file guard (path-traversal checked) → `/api/docs` (Swagger UI) → `/api` router → 404 handler → global error handler.

**Request lifecycle:**

```
Client
  → app.ts middleware (request-id, logging, cors, json)
  → authenticate + tenantContext (verifies JWT, attaches req.user/tenantId)
  → route handler (permission gate, Joi validate)
  → *.service.ts (domain logic)
  → PostgreSQL via adminPool (parameterized SQL)
  ← rows
  ← { data } or { error, code }
```

### Auth & authorization

JWT payload carries `sub`, `tid` (tenant), `role`, and a flattened `permissions[]` array — authorization is a pure string match (`matchPermission` supports `*:*`, `bookings:*`, `bookings:create`) against the token, with no live DB lookup per request. `tenantContext()` just asserts the JWT's `tid` is present; `businessContext()` (resolves `business_id` from header/JWT/query) exists but most route handlers bypass it, requiring `business_id` manually per-handler instead.

### Routes → Services → DB

Route files (`routes/*.ts`) self-apply `authenticate` + `tenantContext`, validate with **Joi** (not zod) on write paths and manual presence checks on many read paths, then delegate to services and respond via `utils/response.ts`'s `{ data }` / `{ error, code }` envelope. Services are plain async functions — no ORM, no query builder — issuing parameterized `pg` SQL directly against `adminPool`. The domain decomposition is fine-grained: a "core" service per domain (`booking.service.ts`, `customer.service.ts`) plus feature-sliced siblings sharing its prefix (`checkin-qr`, `checkin-walkin`, `membership-freeze`, `resource-utilization`, …) — 149 files in one flat `services/` directory, so the filename prefix is the folder that never got created.

**Route prefixes:**

| Prefix | Handles | Prefix | Handles |
|---|---|---|---|
| `/v1/auth` | login/refresh (rate-limited) | `/v1/bookings` | booking CRUD, calendar |
| `/v1/customers` | CRM, segments, import | `/v1/services`, `/catalog` | service catalog, variants |
| `/v1/staff` | profiles, availability, leave | `/v1/resources` | rooms/equipment, maintenance |
| `/v1/memberships` | plans, credits, billing | `/v1/pricing`, `/promotions` | rules, discount codes |
| `/v1/payroll`, `/ap` | payroll, accounts payable | `/v1/events` | workshops, registration |
| `/v1/check-in` | QR, kiosk, no-show | `/v1/marketing` | campaigns, sequences |
| `/v1/reports` | analytics, exports | `/v1/cms` | website pages, blog, media |
| `/v1/integrations` | OAuth, webhooks, iCal | `/v1/community` | badges, points, feed |
| `/v1/locations`, `/schedule` | multi-location, staff shifts | `/v1/admin`, `/query-editor` | platform admin, SQL console |

### Background jobs

The job scheduler polls every 60s, releases stale claims older than 10 minutes, then atomically claims up to 5 due rows via `UPDATE sys_scheduled_jobs … FOR UPDATE SKIP LOCKED RETURNING …` — letting multiple server instances share one job table without blocking each other. Each business's next run time is computed in its own IANA timezone (`schedule_timezone`) before being stored back in UTC. Job types (`lifecycle_evaluation`, `billing_process`, `campaign_dispatch`, `report_aggregation`) are handlers registered in `job-registry.ts`; a job auto-disables after 5 consecutive failures.

> **Cross-cutting note:** PostgreSQL RLS policies exist and are structurally sound (see Database), but almost every service queries through `adminPool` — a superuser connection — rather than the restricted, RLS-bound `pool`. Since RLS keys off a session variable (`app.current_tenant_id`) that's set only by `tenant-query.ts`'s helpers (used in exactly one service), tenant isolation is enforced almost entirely by application-level `WHERE tenant_id = …` predicates today, not by the database. See [Recommended Improvements](#8-recommended-improvements).

---

## 3. Database — PostgreSQL

71 forward-only SQL migrations, tracked in a `migrations` table and applied lexically (hence the zero-padded `NNN_` prefix). Each file runs inside its own transaction; a failure halts the run. There are no down-migrations — schema fixes are "fix-forward" files (`028_fix_request_logs_fk.sql`, `059_fix_booking_status_constraint.sql`).

### Entity hierarchy

`sys_tenants` → `sys_businesses` → `sys_locations` → {services/variants, staff, resources, customers} → `bookings`, with parallel domain clusters for memberships/pricing (`mem_`, `pri_`), financials (`fin_`), marketing (`mkt_`), events (`evt_`), CMS (`web_`), integrations (`int_`), and community (`eng_`). Migration 036 retroactively renamed nearly every table into these 3-letter domain prefixes.

### Row-Level Security pattern

Applied near-uniformly across tenant-scoped tables:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_<table> ON <table>
    FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_<table> ON <table>
    FOR ALL TO postgres
    USING (true);
```

A dedicated non-superuser role (`daystream_app`) exists precisely so RLS can't be bypassed by table ownership — but the app mostly connects as `adminPool` (superuser), which sidesteps the whole mechanism in practice.

### Conventions & patterns observed

- UUID primary keys throughout; `uuid_generate_v4()` in early migrations, `gen_random_uuid()` (pgcrypto) later — a quiet library switch mid-project.
- No soft-delete columns — deletion relies on FK `ON DELETE CASCADE` / `SET NULL`; state history instead lives in explicit tables like `booking_status_history`.
- Status/role/persona fields are `VARCHAR + CHECK (... IN (...))` rather than native Postgres `ENUM` — flexible, but needs "fix" migrations when value sets change.
- JSONB used for genuinely variable payloads (`configuration_definitions.validation_schema`, `notification_queue.data`), not as a general-purpose escape hatch.
- Most recent work (067–070) builds a staff-scheduling layer — `stf_schedule_templates` / `stf_schedule_entries` — explicitly documented as sitting "between availability (when they can work) and bookings (appointments)," plus per-location operating hours and location↔staff assignment.

---

## 4. Frontend — React Client

`App.tsx` is a single flat route tree (react-router-dom v6, no nested layout routes) inside one `ErrorBoundary`. Every app route is wrapped in `<ProtectedRoute>`, which owns all the guard logic: auth check, role gate, loading state, and which shell to render — `AppLayout` for the ~50 ordinary business/customer routes, or a manually-applied `AdminLayout` for `/admin/*` and `/query-editor` (system/tenant screens). CRUD modules follow a consistent `/x`, `/x/new`, `/x/:id`, `/x/:id/edit` shape.

### Design system

Theming is context-based (`ThemeProvider`), toggling `document.documentElement[data-theme]` between light/dark, persisted to `localStorage` and synced to the OS preference; a separate per-business white-label layer overrides CSS custom properties (`--color-primary`, `--radius-md`, …) fetched from tenant config. All color/spacing/type tokens live as CSS variables in `design-system/tokens/*.css` — there is no Tailwind anywhere in the repo (no config, no dependency); components use CSS Modules or CSS-variable-driven inline styles. The component library is broad: `Table`, `Modal`, `Drawer`, `Toast`, a full `forms/` set with a `useForm` hook, `Tabs`/`Pagination`/`Breadcrumbs`, and Storybook stories for many primitives.

### Persona-aware navigation

`design-system/components/dashboard/moduleRegistry.ts` holds a flat array of module descriptors (id, path, icon, `personas[]`, optional permission, optional feature flag), each tagged with the build "phase" that introduced it. `getVisibleModules(persona, permissions, flags)` filters that one registry to drive both the sidebar and the dashboard tiles for whichever of the four personas is logged in.

### API layer & state

19 domain modules under `src/api/` share one axios instance (`client.ts`) that injects the bearer token and silently refreshes on 401. There's no React Query/SWR and no Redux/Zustand — data fetching is ad hoc `useEffect`/`useState` per page, and `business_id` is threaded explicitly through nearly every call rather than embedded in the client. i18n (`i18next`) currently covers only `common`/`auth`/`errors` namespaces in `en`/`es` — most of the 72 pages' copy is still hardcoded English.

---

## 5. Mobile — Expo / React Native

More built-out than the internal docs suggest (`PROJECT_PHASES.md` still marks mobile "future" / not started). It has a working **expo-router** file-based tree — `(auth)` group (login, forgot-password) and a `(tabs)` group (Home, Book, Bookings, Events, Profile) — plus modal routes for check-in, membership, and notifications, backed by **zustand** for auth state and **@tanstack/react-query** + axios for data, with Face ID via `expo-local-authentication` and QR check-in via `expo-camera`.

- ✅ Working: auth + token refresh, 5-tab nav, QR check-in
- ⚠️ Gap: no `@daystream/shared` import anywhere
- ⚠️ Gap: 3 linked screens missing route files

It does not depend on `@daystream/shared` at all — `store/auth.ts` redeclares its own `User` shape in camelCase, diverging from the shared, snake_case type the server and web client both use, and service modules hand-map API responses with `any` typing instead of shared DTOs. `membership`, `notifications`, and `booking/[id]` are linked to from the tab screens but have no corresponding route files yet.

---

## 6. Shared Package

`@daystream/shared` centralizes cross-cutting types (`Tenant`, `Business`, `User`/`Persona`, `ApiResponse`, config/feature-flag types, query-editor DTOs), constants (roles, ~15 error codes, dotted config keys, supported locales/currencies), and utilities (`formatCurrency`, `formatDate`/`formatDateTime`, `generateSlug`). The server consumes it across six services; the client mostly does too — **except** `client/src/utils/currency.ts`, which reimplements a second, incompatible `formatCurrency` (hand-rolled symbol map, reads currency from `localStorage`) alongside the shared one. Mobile doesn't import the package at all.

---

## 7. Naming Conventions

| Layer | Convention | Example |
|---|---|---|
| SQL migrations | `NNN_snake_case_description.sql`, zero-padded to sort lexically | `069_staff_schedule.sql` |
| SQL tables | `<3-letter domain>_<plural noun>`, imposed retroactively in migration 036 | `stf_schedule_entries`, `cus_customers` |
| SQL indexes / policies | `idx_<table>_<cols>`, `tenant_isolation_<table>` | `idx_bookings_staff_time` |
| Server routes | flat, one file per mounted resource, plain/kebab noun | `check-in.ts`, `accounts-payable.ts` |
| Server services | `<domain>.service.ts` core + `<domain>-<feature>.service.ts` siblings | `membership-freeze.service.ts` |
| Client pages | flat `src/pages/`, PascalCase, CRUD siblings share a stem | `StaffCreate.tsx`, `StaffDetail.tsx` |
| Client design-system | PascalCase component + colocated `.module.css` / `.stories.tsx` | `Button.tsx`, `Button.module.css` |

### Dependency snapshot

| Package | Core | Data / State | Testing |
|---|---|---|---|
| server | express 4, pg 8 (no ORM), jsonwebtoken, bcrypt | joi (validation), winston (logging) | vitest, integration tests |
| client | react-router-dom 6, axios, i18next | plain Context — no Redux/Zustand/React Query | vitest, @testing-library/react, Storybook 10 |
| mobile | expo-router, react-native 0.86 | zustand, @tanstack/react-query, expo-secure-store | none observed |
| shared | pure TS, no runtime deps | — | vitest |

Neither `client` nor `server` has a lint step configured — both `package.json`s currently define `"lint": "echo \"No lint configured yet\""`.

---

## 8. Recommended Improvements

Ordered roughly by risk. These are concrete findings from reading the code, not stylistic preferences.

### High

1. **RLS is defined but dormant on the request path.** Tenant isolation policies exist in SQL and look correct, but nearly every service connects via `adminPool` (superuser), which never sets `app.current_tenant_id` — so RLS silently does nothing for almost all live queries. Isolation currently depends entirely on every service remembering its `WHERE tenant_id = …` / `business_id = …` clause by hand.
   *Where: `packages/server/src/db/pool.ts`, `tenant-query.ts`, `services/*.ts`*

2. **Booking creation isn't transactional.** Conflict checks (staff, resource, capacity, customer) and the insert run as separate sequential queries rather than one `BEGIN…COMMIT`, leaving a race window for double-booking under concurrent requests — the same package already uses real transactions elsewhere (e.g. `resource-schedule.service.ts`), so the pattern to follow exists in-repo.
   *Where: `packages/server/src/services/booking.service.ts`*

### Medium

3. **Mobile app is disconnected from the shared type system.** `packages/mobile` never imports `@daystream/shared`; it redeclares a diverging, camelCase `User` type and maps API responses with `any`. Three linked screens (`membership`, `notifications`, `booking/[id]`) have no route file yet, and dev tooling (vite, vitest, Storybook) is listed under runtime `dependencies` rather than `devDependencies`.
   *Where: `packages/mobile/store/auth.ts`, `package.json`, `app/(tabs)/*`*

4. **Two duplicate, incompatible currency formatters.** `@daystream/shared`'s `formatCurrency` uses `Intl.NumberFormat`; `client/src/utils/currency.ts` reimplements the same name with a hand-rolled symbol map and a `localStorage` currency read. Callers get different output depending on which import they happened to use.
   *Where: `packages/client/src/utils/currency.ts` vs `packages/shared/src/utils/currency.ts`*

5. **Two parallel job-scheduling mechanisms.** `job-scheduler.ts` (generic, registry-driven, SKIP LOCKED) and `lifecycle-scheduler.ts` (a standalone `setInterval` that calls the lifecycle service directly) are both started from `index.ts`. They appear to overlap in responsibility — worth confirming one supersedes the other and retiring the loser.
   *Where: `packages/server/src/jobs/job-scheduler.ts`, `lifecycle-scheduler.ts`*

6. **Business-scoping middleware exists but isn't used.** `businessContext()` would centralize `business_id` resolution and validation, but route handlers mostly re-implement the same check inline instead. Consolidating onto the middleware would remove a class of "forgot to check business_id" bugs the project's own rules explicitly warn about.
   *Where: `packages/server/src/auth/business-context.ts`*

7. **API rate limiting is partially wired.** `authLimiter` is applied to `/v1/auth`, but the general-purpose `apiLimiter` is defined and exported yet never mounted anywhere — the rest of the API has no rate limiting.
   *Where: `packages/server/src/middleware/rate-limit.ts`*

8. **OpenAPI docs and lint are effectively absent.** The hand-maintained OpenAPI spec documents only `/api/health` against 33 route files, and both `client` and `server` ship a no-op `lint` script — neither is enforced in CI-shaped workflows today.
   *Where: `packages/server/src/docs/openapi.ts`; both `package.json` "lint" scripts*

### Low

9. **Dead / superseded middleware.** `middleware/request-logger.ts` duplicates logic now inlined directly in `app.ts` and doesn't appear to be wired up — safe to delete once confirmed unused.
   *Where: `packages/server/src/middleware/request-logger.ts`*

10. **Top-level docs have drifted from the actual stack.** `docs/PROJECT_PHASES.md`'s tech-stack table still lists Next.js 16, Tailwind 4, and Supabase — none of which exist in the repo (it's Vite + Express + raw `pg`, no Tailwind). Worth a pass to reconcile the docs with what's actually running, since new contributors will read that file first.
    *Where: `docs/PROJECT_PHASES.md`*

11. **Migration numbering has collisions and a gap.** Two pairs of files share a number (`008_lifecycle_config.sql`/`008_query_editor.sql`, `009_query_reader_role.sql`/`009_service_management.sql`) and `046` is missing. The lexical-sort runner tolerates it, but it's a paper cut for anyone reasoning about migration order.
    *Where: `packages/server/src/db/migrations/`*

12. **Client test coverage is thin relative to surface area.** 10 test files cover design-system primitives and routing smoke tests; none of the 72 page components have dedicated tests. The server side is much better covered (74 files, largely per-domain integration tests).
    *Where: `packages/client/tests/`*
