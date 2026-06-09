# Transcend Wellness Platform

A configurable wellness-business management platform for recovery centers, wellness studios, health optimization centers, gyms, spas, and clinics.

**First customer:** Transcend Health Mallorca

## Tech Stack

- **Frontend:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4
- **Backend/DB:** Supabase (PostgreSQL + Auth + Storage)
- **Payments:** Stripe
- **Testing:** Vitest · Testing Library · MSW
- **Mobile (Future):** React Native + Expo

## Project Structure

```
src/
├── app/
│   ├── (customer)/       # Customer-facing routes
│   │   ├── book/         # Booking flow
│   │   ├── bookings/     # My bookings
│   │   ├── login/        # Auth pages
│   │   ├── register/
│   │   └── services/     # Service catalog
│   ├── admin/            # Admin dashboard
│   │   ├── bookings/     # Booking management
│   │   ├── schedule/     # Staff scheduling
│   │   ├── services/     # Service CRUD
│   │   └── users/        # User management
│   └── api/              # API routes
├── components/
│   ├── admin/            # Admin-specific components
│   ├── customer/         # Customer-facing components
│   ├── pwa/              # Progressive web app components
│   └── ui/               # Shared design system
├── lib/
│   ├── services/         # Business logic
│   ├── supabase/         # Database client & helpers
│   └── types/            # TypeScript type definitions
└── __tests__/            # Test suites
```

## Documentation

- [Project Phases](docs/PROJECT_PHASES.md) — Full roadmap broken into 5 phases

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests (single run) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Phase Overview

| Phase | Focus | Status |
|---|---|---|
| 1 | Foundation & POC (Transcend) | 🚧 In Progress |
| 2 | Business Growth Tools | 🔲 Planned |
| 3 | Multi-Tenant SaaS & Scale | 🔲 Planned |
| 4 | AI & Differentiation | 🔲 Planned |
| 5 | Enterprise & Expansion | 🔲 Planned |

See [docs/PROJECT_PHASES.md](docs/PROJECT_PHASES.md) for full details on each phase.
