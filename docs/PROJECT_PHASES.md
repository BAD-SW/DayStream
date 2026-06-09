# Transcend Wellness Platform — Project Phases

## Overview

A configurable wellness-business management platform for recovery centers, wellness studios, health optimization centers, gyms, spas, clinics, and hybrid businesses. First customer: **Transcend Health Mallorca**.

**Architecture:** Multi-tenant SaaS (single codebase, multiple businesses)  
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Auth + PostgreSQL + Storage) · Stripe  
**Mobile (Future):** React Native + Expo

---

## Phase 1 — Foundation & POC (Transcend)

Goal: A working booking system for a single tenant (Transcend Health Mallorca) with core scheduling, payments, and customer management.

### 1.1 Design System & UI Foundation

| Deliverable | Description |
|---|---|
| Color tokens | Dark-first palette: black, charcoal, warm gold, recovery blue |
| Typography system | Clean, Scandinavian-minimal type scale |
| Component library | Button, Card, Input, Modal, Badge, Avatar, Calendar cell |
| Layout primitives | Page shell, sidebar, responsive grid, hero banner |
| Dark/Light themes | CSS custom properties with Tailwind integration |

### 1.2 Authentication & User Management

| Deliverable | Description |
|---|---|
| Supabase Auth | Email/password, Google, Apple sign-in |
| Role system | Super Admin, Business Owner, Manager, Reception, Therapist, Trainer, Customer |
| Session management | Middleware-based route protection |
| Profile management | Personal info, preferences, language |

### 1.3 Service Management

| Deliverable | Description |
|---|---|
| Service CRUD | Admin creates/edits/archives services |
| Service categories | Recovery Services, Treatments, Coaching, Events |
| Service configuration | Duration, capacity, pricing, staff assignment, resources, images |
| Public service catalog | Customer-facing browsable service list with filtering |

### 1.4 Booking Engine (Core)

| Deliverable | Description |
|---|---|
| Availability engine | Calculate available slots based on staff, resources, hours |
| Individual appointments | 1:1 bookings (massage, float tank, PT) |
| Shared sessions | Multi-customer sessions (fire & ice, sauna) |
| Booking rules | Lead time, cut-off, cancellation policy |
| Calendar views | Day, week, month for admin; slot picker for customer |
| Booking lifecycle | Pending → Confirmed → Completed / Cancelled / No-show |

### 1.5 Customer Management (Basic)

| Deliverable | Description |
|---|---|
| Customer profiles | Name, contact, language, membership status |
| Booking history | Past & upcoming bookings, attendance |
| Customer notes | Wellness notes, preferences, goals |

### 1.6 Payments (Phase 1 Providers)

| Deliverable | Description |
|---|---|
| Stripe integration | One-time payments, stored cards |
| Checkout flow | Service selection → slot → payment → confirmation |
| Invoicing | Basic invoice generation per booking |
| Refunds | Admin-initiated refunds |

### 1.7 Membership Engine (Basic)

| Deliverable | Description |
|---|---|
| Membership types | Unlimited, credit-based, punch cards |
| Intro packages | Fire & Ice, Float Tank, Red Light Therapy packs |
| Auto-renewal | Stripe subscription billing |
| Credit deduction | Booking consumes credits from active membership |

### 1.8 Staff Management (Basic)

| Deliverable | Description |
|---|---|
| Staff profiles | Name, photo, bio, qualifications, languages |
| Availability | Weekly schedule, holidays, sick leave |
| Service assignment | Which staff can deliver which services |

### 1.9 Resource Management

| Deliverable | Description |
|---|---|
| Room/equipment CRUD | Float room, massage room, sauna, cold bath, etc. |
| Resource scheduling | Prevent double-booking of physical resources |
| Service-resource linking | Services require specific resources |

### 1.10 Customer Portal & Website Integration

| Deliverable | Description |
|---|---|
| Public homepage | Hero, services overview, CTAs (Transcend branding) |
| Service detail pages | Description, images, pricing, book button |
| Customer dashboard | Membership, credits, upcoming bookings, history |
| Mobile-responsive | Mobile-first design throughout |

---

## Phase 2 — Business Growth Tools

Goal: Marketing, engagement, and operational tools that help the business grow and retain customers.

### 2.1 CRM & Customer Segmentation

| Deliverable | Description |
|---|---|
| Segmentation engine | Filter by membership, attendance, revenue, last visit |
| Customer tags | Manual and auto-assigned tags |
| Customer timeline | Activity feed per customer |
| Lead tracking | Prospect → trial → member pipeline |

### 2.2 Marketing Automation

| Deliverable | Description |
|---|---|
| Email campaigns | Segment-targeted email blasts |
| SMS campaigns | Segment-targeted SMS |
| Automated sequences | Welcome, re-engagement, birthday, expiring membership |
| Push notifications | Mobile app notification triggers |

### 2.3 Events & Workshops

| Deliverable | Description |
|---|---|
| Event creation | Workshops, seminars, challenges, retreats |
| Ticketing | Capacity, waitlist, pricing |
| Event check-in | Attendance tracking |
| Recurring events | Weekly/monthly class schedules |

### 2.4 Gift Cards & Vouchers

| Deliverable | Description |
|---|---|
| Gift card purchase | Digital gift cards with custom amounts |
| Voucher codes | Promotional discounts, referral codes |
| Redemption | Apply at checkout |

### 2.5 Advanced Pricing Engine

| Deliverable | Description |
|---|---|
| Dynamic pricing | Peak/off-peak, seasonal |
| Promotional pricing | Time-limited offers |
| First-time customer pricing | Intro rates |
| Corporate pricing | B2B rate cards |

### 2.6 Check-In System

| Deliverable | Description |
|---|---|
| QR code check-in | Customer scans on arrival |
| Reception check-in | Staff confirms attendance |
| Session validation | Verify membership/credits before check-in |
| No-show tracking | Automatic marking and policy enforcement |

### 2.7 Advanced Staff Features

| Deliverable | Description |
|---|---|
| Payroll tracking | Hours, sessions delivered, commission |
| Performance metrics | Revenue per therapist, utilization |
| Staff notifications | Schedule changes, new bookings |

### 2.8 Reporting & Analytics (Core)

| Deliverable | Description |
|---|---|
| Revenue reports | Daily, weekly, monthly breakdowns |
| Membership metrics | Active, churned, renewed |
| Booking analytics | Utilization, attendance, no-shows |
| Resource utilization | Room/equipment usage rates |
| Staff productivity | Per-staff revenue and occupancy |

### 2.9 Additional Payment Providers

| Deliverable | Description |
|---|---|
| PayPal | Alternative payment method |
| GoCardless | Direct debit for memberships |
| SumUp | POS terminal integration |

---

## Phase 3 — Multi-Tenant SaaS & Scale

Goal: Transform the single-tenant system into a full multi-tenant SaaS platform with white-labeling.

### 3.1 Multi-Tenant Architecture

| Deliverable | Description |
|---|---|
| Tenant isolation | Row-level security, schema-per-tenant, or hybrid |
| Tenant onboarding | Self-service sign-up flow |
| Custom domains | Per-tenant vanity domains |
| Custom branding | Logo, colors, fonts per tenant |
| Feature flags | Enable/disable modules per plan |

### 3.2 SaaS Billing & Plans

| Deliverable | Description |
|---|---|
| Subscription plans | Starter (€90–150), Growing (€150–300), Multi-location (€300–600), Enterprise |
| Usage metering | Bookings, staff, locations counted |
| Plan upgrades/downgrades | Self-service tier changes |
| Invoice management | SaaS billing for platform fees |

### 3.3 Platform Admin (Super Admin)

| Deliverable | Description |
|---|---|
| Tenant management | Create, suspend, configure tenants |
| Platform analytics | Cross-tenant KPIs |
| Support ticketing | Tenant support requests |
| Feature flag control | A/B testing, gradual rollouts |

### 3.4 Website CMS

| Deliverable | Description |
|---|---|
| Page builder | Homepage, services, pricing, staff, blog, FAQ, gallery |
| SEO tools | Meta tags, structured data, sitemap, Open Graph |
| Content management | Rich text editor, image library |
| Template system | Pre-built page templates per business type |

### 3.5 API-First Architecture

| Deliverable | Description |
|---|---|
| REST API | Full CRUD for all entities |
| GraphQL API | Flexible querying for mobile/web |
| Webhooks | Event-driven integrations |
| API keys & rate limiting | Developer access management |

### 3.6 Integrations

| Deliverable | Description |
|---|---|
| Google Calendar | Two-way sync |
| Outlook Calendar | Two-way sync |
| Mailchimp / Klaviyo | Marketing list sync |
| Zapier | No-code automation connector |
| WhatsApp Business | Messaging integration |

### 3.7 Mobile Application

| Deliverable | Description |
|---|---|
| React Native + Expo | Cross-platform iOS & Android |
| Authentication | Email, Google, Apple |
| Booking flow | Browse, book, cancel, reschedule |
| Membership management | View, purchase, upgrade |
| Push notifications | Booking reminders, marketing |
| White-label | Per-tenant branding in app |

---

## Phase 4 — AI & Differentiation

Goal: AI-powered features that differentiate this platform from competitors.

### 4.1 AI Booking Assistant

| Deliverable | Description |
|---|---|
| Service recommendation | Suggest services based on customer goals |
| Schedule optimization | "When am I available?" natural language queries |
| Recovery plan builder | AI-generated recovery plans |

### 4.2 AI Receptionist (Chatbot)

| Deliverable | Description |
|---|---|
| Website chatbot | Book sessions, answer FAQs via chat |
| WhatsApp bot | Conversational booking via messaging |
| Membership advisor | Recommend plans based on usage |

### 4.3 AI Business Assistant

| Deliverable | Description |
|---|---|
| Revenue insights | Trend analysis, forecasting |
| Churn prediction | At-risk customer identification |
| Staff optimization | Scheduling recommendations |
| Pricing suggestions | Demand-based pricing recommendations |

### 4.4 Community & Engagement

| Deliverable | Description |
|---|---|
| Community feed | Social engagement within app |
| Challenges & leaderboards | Gamification |
| Video-on-demand | Wellness content library |
| Online courses / LMS | Educational content delivery |

---

## Phase 5 — Enterprise & Expansion

Goal: Features for large multi-location businesses and franchise operations.

### 5.1 Multi-Location Support

| Deliverable | Description |
|---|---|
| Location management | Multiple physical locations per tenant |
| Cross-location booking | Book at any location on membership |
| Location-specific pricing | Different rates per venue |
| Staff assignment per location | |

### 5.2 Franchise Support

| Deliverable | Description |
|---|---|
| Franchise hierarchy | Parent company → locations |
| Centralized reporting | Roll-up analytics |
| Shared memberships | Use credits across franchise |

### 5.3 Advanced Compliance

| Deliverable | Description |
|---|---|
| GDPR tooling | Data export, deletion, consent management |
| Multi-language | Full i18n across all customer-facing surfaces |
| Multi-currency | Per-location currency support |
| Tax configuration | VAT rules per country/region |

### 5.4 POS & In-Person

| Deliverable | Description |
|---|---|
| Point of Sale | In-location product/service sales |
| Hardware integration | Card readers, receipt printers |
| Inventory management | Retail product stock |

---

## Development Principles

1. **API-first** — Every feature is an API endpoint before it's a UI.
2. **Mobile-first design** — All UI designed for mobile, scaled up to desktop.
3. **Tenant-aware from day 1** — Even in Phase 1, data models include `tenant_id`.
4. **Type-safe** — Full TypeScript, strict mode, no `any`.
5. **Test coverage** — Unit tests for business logic, integration tests for APIs.
6. **Feature flags** — New features behind flags for safe rollout.
7. **Internationalization-ready** — String externalization from the start.

---

## Comparable Systems

| System | Strengths | Our Differentiation |
|---|---|---|
| Momence | Booking UX, memberships | AI features, wellness-specific |
| Mindbody | Market leader, integrations | Modern stack, lower cost |
| WellnessLiving | All-in-one | Better UX, recovery-focused |
| Glofox | Mobile-first | Multi-tenant from start |
| bsport | European, class-focused | Broader service types |

---

## Current Tech Stack Status

| Layer | Choice | Status |
|---|---|---|
| Frontend | Next.js 16 + React 19 + Tailwind 4 | ✅ Set up |
| Database/Auth | Supabase (PostgreSQL + Auth) | ✅ Set up |
| Testing | Vitest + Testing Library + MSW | ✅ Set up |
| Payments | Stripe | 🔲 To integrate |
| Mobile | React Native + Expo | 🔲 Phase 3 |
| Search | Elasticsearch/OpenSearch | 🔲 Phase 3+ |
| Cache | Redis | 🔲 Phase 2+ |
