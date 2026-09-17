# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/) — the project is pre-1.0 (in active
development), so `0.x.y` releases may include breaking changes. `1.0.0` is reserved
for the first live/public release.

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
