# Project Phases

This directory contains the high-level phase overview for the DayStream platform.

**Detailed specs live in:** `.kiro/specs/<phase-folder>/`

## Phase Structure

Each phase has a dedicated spec folder containing:
- `requirements.md` — Scope, objectives, dependencies, key decisions
- `design.md` — Architecture and design decisions (added during planning)
- `tasks.md` — Implementation tasks (added during execution)

## Phase Index

### Foundation Phases

| Phase | Spec Folder | Description | Status |
|---|---|---|---|
| 00 | `00-infrastructure` | Cloud infrastructure, environments, database provisioning | 🔲 |
| 01 | `01-cicd-pipeline` | Build, test, deploy automation | 🔲 |
| 02 | `02-security-compliance` | Auth, encryption, audit, GDPR foundations | 🔲 |
| 03 | `03-core-platform` | Tenant model, shared services, configuration engine | 🔲 |
| 04 | `04-design-system` | UI components, theming, branding engine | 🔲 |

### Functional Phases

| Phase | Spec Folder | Description | Status |
|---|---|---|---|
| 05 | `05-customer-management` | Customer profiles, segmentation, contact management | 🔲 |
| 06 | `06-service-management` | Service catalog, categories, configuration | 🔲 |
| 07 | `07-booking-engine` | Scheduling, availability, calendar, booking lifecycle | 🔲 |
| 08 | `08-membership-engine` | Plans, credits, punch cards, renewals | 🔲 |
| 09 | `09-pricing-engine` | Dynamic pricing, promotions, corporate rates | 🔲 |
| 10 | `10-payment-platform` | Stripe Connect, checkout, invoicing, refunds | 🔲 |
| 11 | `11-accounts-payable` | Payroll, vendor payments, financial reporting | 🔲 |
| 12 | `12-staff-management` | Profiles, scheduling, availability, permissions | 🔲 |
| 13 | `13-resource-management` | Rooms, equipment, conflict prevention | 🔲 |
| 14 | `14-events-workshops` | Classes, workshops, retreats, ticketing | 🔲 |
| 15 | `15-check-in-system` | QR, kiosk, attendance, no-show tracking | 🔲 |
| 16 | `16-marketing-automation` | Email, SMS, push, sequences, campaigns | 🔲 |
| 17 | `17-reporting-analytics` | KPIs, dashboards, export, scheduled reports | 🔲 |
| 18 | `18-website-cms` | Tenant site customization, SEO, content management | 🔲 |
| 19 | `19-mobile-app` | React Native app, booking, membership, notifications | 🔲 |
| 20 | `20-integrations` | Calendar sync, Zapier, WhatsApp, third-party connectors | 🔲 |
| 21 | `21-ai-features` | Booking assistant, chatbot, business intelligence | 🔲 |
| 22 | `22-community-engagement` | Social feed, challenges, leaderboards, VOD, LMS | 🔲 |

## Dependency Map

```
00 Infrastructure
├── 01 CI/CD
├── 02 Security & Compliance
│   └── 03 Core Platform & Multi-Tenancy
│       ├── 04 Design System
│       ├── 05 Customer Management
│       ├── 06 Service Management
│       │   ├── 07 Booking Engine
│       │   │   ├── 14 Events & Workshops
│       │   │   └── 15 Check-In System
│       │   └── 09 Pricing Engine
│       ├── 08 Membership & Subscriptions
│       ├── 10 Payment Platform
│       │   └── 11 Accounts Payable
│       ├── 12 Staff Management
│       ├── 13 Resource Management
│       ├── 16 Marketing & Automation
│       ├── 17 Reporting & Analytics
│       ├── 18 Website & CMS
│       ├── 19 Mobile Application
│       ├── 20 Integrations
│       ├── 21 AI Features
│       └── 22 Community & Engagement
```

## Working With Specs

Each spec folder (`.kiro/specs/<phase>/`) will evolve through these stages:

1. **Requirements** (`requirements.md`) — What needs to be built, acceptance criteria
2. **Design** (`design.md`) — How it will be built, architecture, data models
3. **Tasks** (`tasks.md`) — Granular implementation tasks with checkboxes

Start a Kiro spec session on any phase folder when ready to detail it out.

## Status Legend

- 🔲 Not Started
- 🟡 In Planning
- 🚧 In Progress
- ✅ Complete
- ⏸️ Paused
