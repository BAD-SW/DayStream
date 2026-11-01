# DayStream — Business & Competitive Overview

**Last Updated**: October 25, 2026
**Purpose**: A current, accurate summary of what DayStream is and does — for comparing functionality and pricing against competitors.

> This reflects what is actually **built** (verified against the implementation specs),
> not the original vision document (`Definition.md`), which is now out of date and
> described a different intended tech stack.

---

## What DayStream is

DayStream is a **multi-tenant SaaS platform for booking and running service-based
businesses** — purpose-built for the **wellness, recovery, fitness, and health-optimization**
space (recovery centers, spas, yoga/fitness studios, clinics), but configurable for any
appointment- and membership-driven business.

It competes with **Mindbody, Momence, WellnessLiving, Glofox, Mariana Tek, and bsport**,
with a deliberate difference: it is designed for the **premium wellness/recovery vertical**,
and it is **franchise/territory-aware** — a single organization (tenant) can run many
business locations, and DayStream itself sells territories to tenant owners.

**First reference customer:** Transcend Health (Western New York and Mallorca).

---

## Who uses it (four personas)

| Persona | Who | What they do |
|---|---|---|
| **System** | DayStream platform staff | Manage tenants, platform config, billing, support |
| **Tenant** | Franchise/organization owner | Manage all their businesses, cross-business reporting, prospect/territory tools |
| **Business** | Owner/manager/staff of one location | Day-to-day operations: bookings, customers, staff, POS |
| **Customer** | End user | Book services, manage memberships, pay |

A context-switcher lets higher personas view into lower scopes without changing identity.

---

## Functional capability (built and working)

### Core operations
- **Booking engine** — individual appointments, shared sessions, group classes, resource
  bookings; configurable lead/cut-off times, capacity, waitlists, cancellation/reschedule
  policies; day/week/month/timeline and resource calendar views; capacity-aware calendar.
- **Service management** — categories, services, variants (duration/price), images, staff
  assignment, availability rules, per-location assignment, tax categories, cancellation
  policies, reusable templates.
- **Staff management** — staff = user accounts; qualifications, certifications, languages,
  availability patterns, leave, service/location assignment, capacity, role-based permissions.
- **Resource management** — rooms/equipment with schedules, availability, double-booking
  prevention, maintenance, dependencies, utilization tracking.
- **Multi-location** — one business can run multiple locations; services, staff, resources
  assignable per location.
- **Check-in system** — QR, mobile, reception, kiosk; attendance and no-show tracking.
- **Events & workshops** — ticketing, capacity, waitlist, attendance, check-in.

### Revenue & commerce
- **Membership engine** — unlimited, credit-based, hybrid, punch cards, intro packages;
  auto-renew, freeze/pause, upgrade/downgrade.
- **Pricing engine** — fixed, membership, promotional, seasonal, first-time, corporate
  pricing; discount codes.
- **Payment platform** — Stripe-based; one-time and subscription payments, refunds, gift
  cards, stored payment methods; platform/tenant/business billing tiers. *(A few items
  still in progress.)*
- **Invoicing / accounts receivable** and **accounts payable / payroll tracking**.
- **Products & services** commerce (retail/merchandise alongside services).

### Growth & customer engagement
- **CRM / customer management** — full profiles, lifecycle stages
  (lead → trial → active → at-risk → churned → winback), timelines with actor tracking,
  field-level change logging, segments, CSV import/export, GDPR anonymize.
- **Marketing automation** — email & SMS campaigns, sequences/automations
  (welcome, re-engagement, renewal, birthday), segmentation.
- **Community engagement** — social feed, challenges, leaderboards, badges, courses/LMS
  scaffolding.
- **Prospect management (differentiator)** — territory definition and automated lead-list
  generation from mapping data, so a tenant owner starts with a ready prospect list.
  *(Functional; the search engine is slated for a reliability/efficiency re-engineer —
  see `PROSPECT_SEARCH_REDESIGN_NOTES.md`.)*
- **Inbox / unified messaging** — in progress.

### Platform & presentation
- **Website CMS** — pages, blog, media, SEO (meta/structured data/sitemap/Open Graph).
- **Embeddable booking widget** — drop booking into an existing site.
- **Reporting & analytics** — revenue (daily/weekly/monthly), membership (active/churn/
  renewals), bookings (utilization/attendance/no-shows), staff productivity, resource
  utilization.
- **Theming** — multiple themes, dark/light mode.
- **Integrations module** and a system-admin **Query Editor** (read-only SQL) and audit log.
- **Mobile app** — React Native/Expo consumer app (bookings, membership, payments,
  notifications).
- **Data migration tooling** — import customers and related records from a legacy system
  when onboarding a tenant. *(In progress.)*

---

## Where DayStream aims to differentiate vs. incumbents

1. **Vertical focus** — built for premium wellness/recovery (intro packs, recovery
   services, float/sauna/cold-therapy resource modeling), not a generic studio tool.
2. **Franchise/territory model** — tenant owners buy territories; built-in prospect
   generation and cross-business (tenant-level) management. Most competitors are
   single-business or loosely multi-location.
3. **Premium design system** — dark-mode-first, luxury-wellness aesthetic, themeable.
4. **Onboarding migration tooling** — import from a legacy booking system.

---

## Honest status — built vs. planned (for fair comparison)

**Solidly built and working** (verified against implementation tasks): core platform,
design system, CRM, services, booking, memberships, pricing, staff, resources, events,
check-in, marketing automation, reporting, website CMS, integrations, community, mobile app,
accounts payable/payroll, multi-location, context switcher, embeddable widget, data query
editor.

**In progress / partial:** payment platform (a few items open), invoicing/AR, data
migration, unified inbox, newer marketing module, custom lead stages, prospect-search
re-engineering, multi-language support.

**Planned / not yet built — important gaps for competitive claims:**
- **AI features** (booking assistant, AI receptionist/chatbot, churn prediction, business
  insights) — specified as a differentiator but **not implemented**. Do not claim these.
- **CI/CD pipeline** and parts of **security/compliance** hardening — in progress; relevant
  to enterprise/security questionnaires (see `SECURITY_HARDENING_CHECKLIST.md`).
- **Full multi-language** — specified, not yet delivered; note for EU/Mallorca market.
- Some **theming/calendar/booking-flow** refinements still open.

---

## Competitive & pricing comparison — how to use this doc

When benchmarking against Mindbody / Momence / WellnessLiving / Glofox / bsport:

1. **Feature parity**: DayStream matches the incumbents on the operational core (booking,
   memberships, CRM, POS/payments, staff/resources, reporting, marketing, CMS, mobile).
2. **Differentiators to price for**: territory/franchise model + prospect generation,
   vertical-specific wellness modeling, premium theming, migration onboarding.
3. **Gaps to be honest about in a bake-off**: AI assistant (not built), full i18n, and
   enterprise security/CI maturity (in progress).
4. **Pricing anchor** (from the original plan, for reference — validate against the market):
   Starter €90–150/mo, Growing €150–300/mo, Multi-location €300–600+/mo, Enterprise custom.
   DayStream's territory model may warrant a different structure (per-territory + per-location)
   than competitors' per-location SaaS pricing.

---

## Source-of-truth pointers

- Implementation specs: `.kiro/specs/` (00–50) — the authoritative "what's built" record.
- `docs/PROJECT_CONTEXT.md` — architecture and history (note: dated July 2026).
- `docs/Definition.md` — original vision/requirements (historical; stack described there
  was not the one built).
- `docs/AWS_DEPLOYMENT_AND_COSTS.md` — hosting cost model by growth phase.
- `docs/SECURITY_HARDENING_CHECKLIST.md` — security posture / pre-launch gaps.
