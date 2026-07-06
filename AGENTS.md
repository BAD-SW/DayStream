# Workspace Agent Rules

## Project

DayStream — Multi-tenant SaaS booking/business management platform. See `docs/PROJECT_CONTEXT.md` for full project history and architecture.

## Tech Stack

- **Frontend**: React + TypeScript + Vite (port 4000)
- **Backend**: Express + TypeScript + tsx watch (port 4001)
- **Database**: PostgreSQL with Row-Level Security
- **Auth**: JWT (access + refresh tokens)
- **Monorepo**: npm workspaces (packages/client, packages/server, packages/shared)

## Critical Rules

1. **Never auto-create branches** — commit directly to `main`, only when user requests
2. **All CSS must use CSS variables** from the design system — never hardcode colors
3. **Every business-scoped endpoint MUST require `business_id`** — no fallbacks, no guessing
4. **Every tenant-scoped endpoint must require `tenant_id`** (enforced via JWT)
5. **Customer data access requires `customer_id + business_id`** to prevent cross-customer breach
6. **Don't add endpoints without UI** — both must be built together
7. **Monetary values stored as integers (cents)**
8. **Staff = Users** — every staff member has both a `staff_profiles` record and a `users` record, created together
9. **Service variants** define bookable options (duration + price). A service can't be activated without at least one variant.
10. **Multi-location** — services, staff, and resources can be assigned to specific locations

## Persona Model

| Persona | Scope | Tables |
|---------|-------|--------|
| System | Platform admin | users (persona='system') |
| Tenant | Org-level management | users (persona='tenant'), tenants |
| Business | Single business | users (persona='business'), businesses, staff_profiles |
| Customer | End-user | customers table (separate from users) |

## Commands

- Server dev: `npm run dev` in `packages/server`
- Client dev: `npm run dev` in `packages/client`
- Migrations: `npm run migrate:dev` in `packages/server`
- The Vite client proxies `/api` to `localhost:4001`

## Key Files

- `docs/PROJECT_CONTEXT.md` — Full project history, architecture, current state
- `docs/Definition.md` — Original requirements
- `.kiro/steering/style-guide.md` — Design system
- `packages/server/src/routes/index.ts` — All API routes
- `packages/client/src/App.tsx` — All frontend routes
- `packages/client/src/design-system/components/dashboard/moduleRegistry.ts` — Sidebar/dashboard modules
