# DayStream - Project Context & Session History

**Last Updated**: July 6, 2026
**Repository**: https://github.com/BAD-SW/DayStream.git
**Local Path**: `c:\Users\Bill\BAD Software\DayStream`

---

## What is DayStream?

A multi-tenant SaaS booking and business management platform for service-based businesses (recovery centers, yoga studios, spas, clinics, etc.). Inspired by Momence, Mindbody, and similar — but designed for wellness/health optimization businesses. First customer target: Transcend Health Mallorca.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite (port 4000) |
| Backend | Express + TypeScript + tsx watch (port 4001) |
| Database | PostgreSQL with RLS (Row-Level Security) |
| Auth | JWT (access + refresh tokens) |
| Design System | Custom component library, CSS variables, dark/light mode |
| Monorepo | npm workspaces (`packages/client`, `packages/server`, `packages/shared`) |

**Dev commands:**
- Server: `npm run dev` in `packages/server` (tsx watch)
- Client: `npm run dev` in `packages/client` (Vite, proxies `/api` to port 4001)
- Migrations: `npm run migrate:dev` in `packages/server`

---

## Architecture

### Persona Model (4 levels)

| Persona | Scope | Example |
|---------|-------|---------|
| System | Platform-wide | DayStream platform admin |
| Tenant | All businesses under one org | Transcend Health (the company) |
| Business | Single business location/brand | Transcend Mallorca |
| Customer | End-user booking services | Someone booking a sauna session |

### Data Hierarchy

```
Platform (DayStream)
└── Tenant (e.g., Transcend Health)
    └── Business (e.g., Transcend Mallorca)
        ├── Locations (e.g., North, East)
        ├── Services (e.g., Massage, Float Tank)
        ├── Staff (with user accounts)
        ├── Resources (rooms, equipment)
        └── Customers
```

### Security Model

- **Tenant isolation**: PostgreSQL RLS policies on all tables
- **Business isolation**: All business-scoped endpoints require `business_id` parameter — no fallbacks, no guessing
- **Customer isolation**: Customer data access requires `customer_id + business_id`
- **JWT**: Contains `tenant_id`, user info; set via `tenantContext` middleware on all routes

---

## Key Design Decisions

1. **Staff = Users**. Every staff member gets a `users` record (login) AND a `staff_profiles` record (HR data). Created together. Email + password required at creation time.

2. **Multi-location support**. A business can have multiple locations. Services, staff, and resources can be assigned to specific locations. `locations` table with FK constraints.

3. **Monetary values stored as integers** (cents). Use `CurrencyInput` component for POS-style entry.

4. **Three-tier billing**: Business → Tenant → DayStream platform.

5. **Job scheduling is database-driven**, per-business, timezone-aware, uses `SKIP LOCKED` for non-blocking execution.

6. **No orphan endpoints** — every API endpoint must have a corresponding UI, and vice versa.

7. **Service variants** define bookable options with duration and price. A service can't be activated without at least one variant.

8. **Business owner is also a staff member** — created during tenant provisioning with a staff profile.

---

## Current State (as of July 6, 2026)

### Completed & Working

- ✅ System persona admin pages (Tenants CRUD, Configuration, Audit Log, Query Editor)
- ✅ Tenant persona pages (Businesses, Billing, Reports)
- ✅ Business persona dashboard with role-based KPI cards
- ✅ Customer management (CRUD, lifecycle stages, timeline with actor tracking, field-level change logging, search, export CSV, segments, import, GDPR anonymize)
- ✅ Service management (categories, CRUD, variants, images, staff assignment, availability rules, locations tab, cancellation policies, tax categories, templates)
- ✅ Staff management (merged with user accounts, create with password, reset password, qualifications, availability patterns, leave, service assignments, location assignments, capacity)
- ✅ Resource management (types, CRUD, schedules, availability, bookings, maintenance, dependencies, utilization)
- ✅ Booking engine (CRUD, calendar, flow)
- ✅ Membership engine (plans, subscriptions)
- ✅ Pricing engine (rules, discount codes)
- ✅ Payroll & Accounts Payable
- ✅ Events & Workshops
- ✅ Check-in system
- ✅ Marketing automation (campaigns, sequences)
- ✅ Reporting & Analytics
- ✅ Website CMS (pages, blog, media)
- ✅ Integrations module
- ✅ Community engagement
- ✅ Multi-location system (locations table, service-location assignments, staff-location assignments)
- ✅ Job scheduler (database-driven, timezone-aware, per-business)

### Currently Testing

- 🟡 Services module — functional, testing the full flow (create → variants → staff assign → availability → locations)
- 🟡 Staff module — just merged user/staff concepts, existing staff may need account linking

### Known Issues / Remaining Work

- Existing staff member "Hingle McCringleberry" has `user_id: null` — needs account linking via `POST /staff/:id/link-account`
- Business owner created before the staff profile auto-creation needs a staff profile retroactively
- StaffCreate page uses Tailwind classes (inconsistent with design system CSS variables used elsewhere)
- StaffDetail page uses Tailwind classes (same inconsistency)
- Some pre-existing TS errors in `auth.ts` and `seed.ts` (not blocking runtime)

---

## Database Migrations

35 migration files in `packages/server/src/db/migrations/`. Key ones:

| # | Name | What it does |
|---|------|-------------|
| 006 | business_layer | Businesses table, persona model, business configs |
| 007 | customer_management | Customers, activities, notes, tags, segments |
| 009 | service_management | Services, categories, variants, images, staff, availability |
| 011 | booking_engine | Bookings, slots, waitlist |
| 013 | membership_engine | Plans, subscriptions, credits |
| 017 | staff_management | Staff profiles, qualifications, availability, leave |
| 018 | resource_management | Resources, types, schedules, bookings, maintenance |
| 034 | job_scheduler | Scheduled jobs, job history |
| 035 | locations | Locations table, FK constraints to existing location_id references |

---

## Route Files (20+)

All registered in `packages/server/src/routes/index.ts` under `/api/v1/...`

Key: `auth`, `admin`, `customers`, `services`, `bookings`, `memberships`, `pricing`, `payroll`, `ap`, `staff`, `resources`, `events`, `check-in`, `marketing`, `reports`, `cms`, `integrations`, `community`, `locations`, `query-editor`

---

## Frontend Module Registry

`packages/client/src/design-system/components/dashboard/moduleRegistry.ts` defines all sidebar/dashboard modules per persona. Business persona sees: Customers, Services, Bookings, Memberships, Pricing, Staff, Resources, Events, Check-in, Marketing, Reports, Website, Integrations, Settings, Locations, Community.

---

## Important Conventions

1. **Never auto-create branches** — commit directly to `main`
2. **Only commit when user requests it**
3. **All CSS uses CSS variables** (from design system) — never hardcode colors
4. **Every business endpoint requires `business_id`** — no exceptions
5. **Revenue YTD** = collected payments; **Revenue Still Expected** = projected from billing config
6. **From tenant perspective, "customers" are businesses** (not end-users)
7. **KPI cards are role-based** for business persona
8. **Don't add endpoints without UI** — both must be built together
9. **Customer lifecycle stages**: lead → trial → active → at_risk → churned → winback
10. **Sidebar mirrors dashboard tiles** for each persona

---

## Testing Accounts (Dev Seed Data)

- **System admin**: platform-level access
- **Business owner**: logged in under a specific business (`business_id` in localStorage)
- **Customers**: Jane Smith, William Everitt, Jack Frost, Archive Me (test data)

---

## What's Next

- Complete services module testing (variants pricing, location-based availability)
- Staff module UI consistency (convert from Tailwind to CSS variables)
- Booking flow end-to-end testing
- Resource assignment to services
- Payment integration
- Mobile app (React Native / Expo — not started)

---

## Files to Read for Full Context

- `docs/Definition.md` — Full requirements specification
- `.kiro/steering/style-guide.md` — UI/UX design system
- `.kiro/steering/spec-documentation-standards.md` — Documentation standards
- `packages/client/src/design-system/` — Component library
- `packages/server/src/routes/index.ts` — All API routes
- `packages/client/src/App.tsx` — All frontend routes
- `packages/client/src/design-system/components/dashboard/moduleRegistry.ts` — Module definitions
