# DayStream — Product Context

This file is written for using DayStream **as an application** (clicking through the
UI, testing flows, exploring data) — not for editing its code. If you're coding
against this repo, see `AGENTS.md` instead.

## What is DayStream?

A multi-tenant SaaS booking and business-management platform for service-based
businesses (recovery/wellness centers, yoga studios, spas, clinics, gyms). Think
Momence/Mindbody, but aimed at health-optimization businesses. The first real
customer target is **Transcend Health Mallorca**, which is also the seeded demo
business.

## Running it locally

- Client (UI): **http://localhost:4000**
- Server (API): **http://localhost:4001** (docs at `/api/docs`)
- Start both: `npm run dev` from the repo root.

## The persona model — read this first

DayStream has four nested levels of "who is logged in." This is the single most
important concept for navigating the UI, because the sidebar/dashboard modules
shown are entirely different per persona.

| Persona | Scope | Analogy |
|---|---|---|
| `system` | The whole DayStream platform | DayStream's own staff, managing all tenants |
| `tenant` | One organization, possibly owning several businesses | "Transcend Health" as a company |
| `business` | One physical/brand location | "Transcend Mallorca" |
| `customer` | An end-user booking services | Someone booking a massage |

**Persona is fixed per login** (it's in the JWT). Separately, there's a **context
switcher** in the UI: a `system` or `tenant` user can switch their active *context*
to look into a specific tenant/business without changing their underlying persona.

Terminology trap: from the **tenant** persona's perspective, the entities called
"customers" in the tenant admin UI are actually **businesses** (the tenant's
clients), not end-user customers. End-user customers only exist under a business.

## Data hierarchy

```
Platform (DayStream)
└─ Tenant (e.g. Transcend Health)
   └─ Business (e.g. Transcend Mallorca)
      ├─ Locations (e.g. North, East)
      ├─ Services (e.g. Massage, Float Tank) → variants (duration/price options)
      ├─ Staff (also a user account — staff always = a login + an HR profile)
      ├─ Resources (rooms, equipment)
      └─ Customers (end users who book)
```

## Test login accounts (all use password `password123`)

| Email | Persona | Role |
|---|---|---|
| `system@daystream.test` | system | Platform admin |
| `tenant@daystream.test` | tenant | Tenant owner |
| `business@daystream.test` | business | Business owner |
| `customer@daystream.test` | customer | End-user customer |
| `owner@transcend.test` | business | Business owner (Transcend Mallorca) |
| `manager@transcend.test` | business | Manager |
| `reception@transcend.test` | business | Front desk |
| `therapist@transcend.test` | business | Staff (service provider) |
| `trainer@transcend.test` | business | Staff (service provider) |
| `customer@transcend.test` | customer | Customer of Transcend Mallorca |

The `*@transcend.test` accounts are the richer, populated demo dataset (real
services, staff, bookings) — use those for realistic UI testing. The
`*@daystream.test` accounts are thinner, one-per-persona sanity accounts.

## What's in the product (modules by persona)

**Business persona** (the main day-to-day app — most testing happens here):
- Customers — CRM: profiles, lifecycle stage (lead → trial → active → at_risk →
  churned → winback), notes, tags, segments, timeline, import/export
- Appointments — booking calendar and flow
- Schedule — staff shifts/scheduling
- Offerings — services, variants, products, memberships, promotions/pricing
- Business Setup — staff, resources, locations
- Accounting — accounts payable/receivable, **Payroll** (pay periods, pay
  frequency, tax profiles, run/finalize)
- Reports — analytics/insights
- Marketing — campaigns and automation
- Website — CMS for the business's public site
- Events — events/workshops (feature-flagged)
- Community — engagement features (feature-flagged)
- Settings — business configuration

**Tenant persona** (managing a portfolio of businesses):
- Businesses, Prospects (lead-gen for new businesses to onboard), Users, Billing,
  Reports

**System persona** (DayStream platform operators):
- Tenants, Coverage Map, Prospect Categories (Google Places types used for lead
  gen), Users, Configuration, Audit Log, Query Editor (raw DB query tool)

**Customer persona**: booking-focused self-service views (appointments, events).

## Conventions worth knowing while using the UI

- Money is always shown/entered as currency, backed by integer cents — no floats.
- Every business-scoped screen requires an active business context; there are no
  "all businesses" fallback views except at the tenant/system level.
- Staff members are always both a login (user account) and an HR profile —
  creating a staff member also creates their account.
- A service can't go live without at least one variant (duration + price).
- Dark/light mode toggle is available; the whole UI respects it.
- Design system is custom (not Tailwind/MUI) — visuals may look plain in a few
  older pages (e.g. Staff pages) that haven't been migrated to it yet.

## Recently added / actively evolving areas (worth exploring)

- **Payroll**: pay frequency settings (weekly/biweekly/semi-monthly/monthly),
  auto-generated pay periods, current period run/finalize, history, tax profiles
  (US federal + Spain IRPF supported) — Accounting tab.
- **Prospect management** (tenant persona): find and categorize potential
  business customers, including city-based filtering.
- **Calendar/booking**: capacity-aware calendar and a redesigned booking flow are
  recent work — good areas to poke at for rough edges.

## Known pre-existing quirk

Availability logic for resource-type services with **no staff assigned** has a
known bug in the staff-list handling — if a booking/availability flow behaves
oddly for a resource-only service (e.g. a room with no therapist attached), that's
a known issue, not a new bug to chase.
