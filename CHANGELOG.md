# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/) — the project is pre-1.0 (in active
development), so `0.x.y` releases may include breaking changes. `1.0.0` is reserved
for the first live/public release.

## [0.3.0] - 2026-09-17

### Added
- **Embeddable Booking Widget** (spec 38, Phases 4–7): the widget is now actually live
  on real infrastructure, not just locally — https://daystream-app.vercel.app (client),
  https://daystream-fake-transcend.vercel.app (fake test site),
  https://daystream-ys5i.onrender.com (API), Neon (database), all connected.
- **Package & membership purchase** (Phase 5): the widget can now sell packages
  ("The Reset", session packs, etc.) and memberships, not only book services — no
  calendar/slot steps, since there's no appointment time to reserve.
- **Location/staff selection** during service booking: the widget now offers the same
  filter chips the admin booking flow already has, rather than silently auto-picking
  the first available option; a resolved "📍 location 🧑 staff" line always shows even
  when there was nothing to actively choose.
- **Widget snippet generation** (Phase 6): a "Copy widget snippet" button on the
  Service/Package/Membership detail pages — a business gets ready-made embed markup for
  each item without ever seeing or typing a DayStream id.
- GitHub → Vercel continuous deployment (auto-deploys `daystream-app` on every push to
  `main`); a versioning + changelog practice for every release going forward.

### Fixed
- The server's production start path (`tsc` → `node dist/`) had apparently never been
  run for real: it compiled to ES modules without file extensions on relative imports
  (Node's ESM resolver requires them), and `@daystream/shared` was never actually
  compiled, only ever consumed as raw TypeScript via the dev tool's on-the-fly
  transpiler. Server now runs via `tsx` in production too (same tool as local dev);
  `@daystream/shared` now has a real build step.
- Render sits behind its own edge/CDN, so every request arrives with a multi-hop
  `X-Forwarded-For` chain — one login code path fed that raw header straight into a
  Postgres column typed for a single IP, 500ing every login attempt in production only.
  Fixed via `app.set('trust proxy', true)` plus using Express's own `req.ip`.
- `assertOriginAllowed()` (the widget's per-business origin allowlist) was written in
  Phase 1 but never actually called from any route — enforced now, on every endpoint.
  `requireValidBusinessId` had the same gap (only 3 of ~13 routes).
- `pkg_purchases` has no `updated_at` column (unlike `mbr_enrollments`, which does) —
  broke package-purchase payment confirmation.
- A pre-existing bug in `membership.service.ts`'s period-date math broke whenever a
  caller explicitly supplied a `start_date` (Joi normalizes a bare date into a full ISO
  datetime, which the date math then double-stamped into an invalid string) — affects
  the admin membership-enrollment flow too, not only the widget.
- `wgt_widget_transactions` was only ever recording successful payments despite its own
  schema anticipating a `'failed'` status — now also logs failed payment attempts.

## [0.2.0] - 2026-09-17

### Added
- **Theme Setup** (spec 37): named saved themes (built-in Bold Business/Classic +
  custom), Theme Gallery/Editor/Apply Dialog, applied per system/tenant/business scope
  with inheritance, Quick Setup + Advanced modes.
- **Embeddable Booking Widget** (spec 38, Phases 1–4): a vanilla-JS embed script and
  hosted booking flow (`/booking-widget`) that lets a business's own website offer
  DayStream service bookings without redirecting elsewhere. Covers the full service
  booking flow (availability, location/staff selection, login/register, conditional
  emulated payment, confirmation), a public widget API, a local test harness
  (`fake-business-site/`), and initial Vercel/Neon/Render deployment support.
- Reports: Active Memberships, Staff Performance, Commissions, New Customers, Customer
  Retention, Customer Lifetime Value, New & Cancelled Memberships, Recognized Revenue,
  Payroll Summary, Utilization; Orders history page; auto-run report runner;
  clickable customer/order links across the report framework.

### Fixed
- `POST /v1/auth/register` never set `usr_users.business_id` (NOT NULL) — broke for any
  tenant with its own businesses; had zero existing callers before the widget's
  Login/Register step became the first.
- A booking-widget customer lookup queried a `phone` column that only exists on
  `cus_customers`, not `usr_users`.
- Global CORS's non-development origin fallback pointed at the API's own port, which
  could never have worked for a real deployed client — now reads `CLIENT_URL`.
- Several early RLS-setup migrations (004 through 043) hardcoded a local-only database
  name (`daystream_dev`) and role name (`postgres`), breaking a fresh migration run
  against any differently-named/rooted database (e.g. Neon). Made portable via
  `current_database()`/`CURRENT_USER`.

### Changed
- DB connection layer now supports a single `DATABASE_URL` (as managed Postgres hosts
  like Neon provide) as an alternative to discrete `DB_HOST`/`DB_USER`/etc., with SSL
  enabled automatically when it's used.
- Client API calls now respect `VITE_API_URL` for deployed (non-proxied) environments,
  falling back to the local Vite dev proxy when unset.
