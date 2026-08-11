# Workspace Agent Rules

## Project

DayStream — Multi-tenant SaaS booking/business management platform.  
See `docs/PROJECT_CONTEXT.md` for full project history, architecture, and current state.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite (port 4000) |
| Backend | Express + TypeScript + tsx watch (port 4001) |
| Database | PostgreSQL with Row-Level Security (RLS) |
| Auth | JWT (access + refresh tokens) |
| Design System | Custom component library, CSS variables, dark/light mode |
| Monorepo | npm workspaces (`packages/client`, `packages/server`, `packages/shared`) |
| Testing | Vitest + Testing Library + supertest |

**Dev commands (run from workspace root):**
- `npm run dev` — starts both server and client
- `npm run dev:server` — server only
- `npm run dev:client` — client only
- `npm run migrate:dev` — apply pending DB migrations
- `npm run seed:dev` — seed development data
- `npm run test` — run all tests
- `npm run lint` — lint all packages

---

## Dual-Tool Workflow (KIRO + Claude)

This project uses **KIRO for specs, requirements, design, and tasks** and **Claude for coding implementation**.

### Rules for Claude (coding agent)
1. **Read the spec first** — before implementing any feature, read the relevant spec in `.kiro/specs/XX-feature-name/` (requirements.md, design.md, tasks.md)
2. **Never modify spec files** — `.kiro/specs/` files are owned by KIRO. Do not edit requirements.md, design.md, tasks.md, or .config.kiro
3. **Never modify steering files** — `.kiro/steering/` files are KIRO configuration. Do not edit them
4. **Follow the design exactly** — implement what the design.md specifies, not what seems convenient
5. **Update task status** — after completing a task, update the checkbox in tasks.md from `- [ ]` to `- [x]`
6. **Commit only when asked** — never auto-commit; wait for explicit user instruction
7. **Commit directly to main** — never create branches unless explicitly asked
8. **Pull before starting** — always pull latest from GitHub before beginning implementation work

---

## Persona Model

| Persona | Scope | Description |
|---------|-------|-------------|
| `system` | Platform-wide | DayStream platform admins — manage tenants, platform config |
| `tenant` | Organisation-level | Tenant owners/managers — manage their businesses, see cross-business data |
| `business` | Single business | Business owners, managers, staff — day-to-day operations |
| `customer` | End-user | Customers booking services — limited read/write on own data |

**Context vs Persona:** Persona is fixed (stored in JWT). Context is the active scope the UI is currently showing — a system admin can switch context to view a business without changing persona. See `spec 29-context-switcher` for the full model.

---

## Critical Rules — Never Violate These

1. **Never auto-create git branches** — commit directly to `main`, only when user requests
2. **All CSS must use CSS variables** — never hardcode colors, never use Tailwind for new components. Use `var(--color-*)`, `var(--spacing-*)` etc. from the design system
3. **Every business-scoped endpoint MUST require `business_id`** — no fallbacks, no defaults, no guessing
4. **Every tenant-scoped endpoint must require `tenant_id`** — enforced via JWT middleware
5. **Customer data access requires `customer_id + business_id`** — never expose cross-customer data
6. **No orphan endpoints** — every API endpoint must have a corresponding UI and vice versa
7. **Monetary values stored as integers (cents)** — never store floats for money; use `CurrencyInput` component for display
8. **No ORM** — raw SQL only via the `pg` driver. No Prisma, TypeORM, Drizzle, or similar
9. **No schema-per-tenant** — Row-Level Security on all tables via `tenant_id` column
10. **TypeScript strict mode** — no `any` types; all new code must be fully typed

---

## Database Conventions

- **Migrations**: versioned SQL files in `packages/server/src/db/migrations/`, named `NNN_description.sql`
- **Naming**: new migrations must use the next available number (currently at 070+)
- **Every table** must have `tenant_id UUID NOT NULL` with an RLS policy
- **Business-scoped tables** must also have `business_id UUID NOT NULL`
- **Primary keys**: UUIDs using `gen_random_uuid()`
- **Timestamps**: `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`
- **Soft deletes**: use `status` column with values like `active`/`archived` — no hard deletes on business data
- **Monetary columns**: `INTEGER` (cents), never `DECIMAL` or `FLOAT`
- **Apply migrations after adding**: run `npm run migrate:dev` after creating a new migration file

---

## Frontend Conventions

### File structure
```
packages/client/src/
├── api/              ← Axios API call functions, one file per domain
├── components/       ← Shared layout components (AppLayout, ContextSwitcher, etc.)
├── context/          ← React context providers (AuthContext, ContextManager, ThemeManager)
├── design-system/    ← Component library, tokens, themes — do not modify unless building design system
│   ├── components/   ← Reusable UI components (Button, Card, Table, Modal, etc.)
│   ├── themes/       ← light.css, dark.css
│   └── tokens/       ← colors.css, typography.css, spacing.css
├── pages/            ← Page components, one file per route
└── utils/            ← Pure utility functions
```

### CSS rules
- Use CSS custom properties exclusively: `var(--color-primary)`, `var(--color-accent)`, etc.
- Never use Tailwind CSS classes — the project uses a custom design system
- Never hardcode hex values, rgb values, or pixel values for colors
- Spacing uses the 4px base unit scale: `var(--spacing-xs)` (4px), `var(--spacing-sm)` (8px), `var(--spacing-md)` (16px), `var(--spacing-lg)` (24px), `var(--spacing-xl)` (32px)
- New component CSS files live alongside the component file
- Refer to `.kiro/steering/style-guide.md` for the full design token reference

### Component conventions
- Use the existing design system components from `packages/client/src/design-system/components/` — do not rebuild what already exists
- Key existing components: `Button`, `Card`, `Table`, `Modal`, `Drawer`, `Badge`, `Tabs`, `MultiSelect`, `Pagination`
- Forms: labels above inputs (not placeholder-as-label); required indicator is a subtle asterisk
- Tables: sortable columns with arrow icons; pagination below; mobile switches to card layout
- All interactive elements must meet WCAG 2.1 AA: 4.5:1 contrast, keyboard navigable, visible focus indicators

### Routing
- All routes defined in `packages/client/src/App.tsx`
- Add new routes to the appropriate persona section (system, tenant, business, customer)
- Protect routes with the existing `ProtectedRoute` component

### API calls
- All API functions in `packages/client/src/api/`
- Use the shared `apiClient` (Axios instance) — do not create new Axios instances
- The `apiClient` interceptor handles auth headers and context scope injection (business_id, X-Context-Tenant-Id)
- Do not read `business_id` from `localStorage` directly — use `useContextManager().activeContext.businessId`

---

## Backend Conventions

### File structure
```
packages/server/src/
├── db/
│   ├── migrations/   ← SQL migration files NNN_description.sql
│   ├── pool.ts       ← adminPool and appPool (RLS-enforced)
│   └── migrate.ts    ← migration runner
├── middleware/       ← Express middleware (auth, tenant context, logging, RLS)
├── routes/           ← Route handlers, one file per domain
├── services/         ← Business logic, one file per domain
└── jobs/             ← Background job definitions and scheduler
```

### Route conventions
- All routes registered in `packages/server/src/routes/index.ts` under `/api/v1/...`
- Use `appPool` (RLS-enforced) for all business data queries, not `adminPool`
- `adminPool` is only for migrations, seeding, and system-level admin operations
- Every route must validate `business_id` is present for business-scoped operations
- Use the `tenantContext` middleware on all routes

### Service conventions
- Business logic lives in `services/`, not in route handlers
- Services receive a `pool` client (for transaction support) and return plain objects
- No circular dependencies between services

---

## Spec & Documentation Conventions

Spec files live in `.kiro/specs/XX-feature-name/` and follow this structure:
```
.kiro/specs/XX-feature-name/
├── .config.kiro        ← KIRO workflow config — never edit
├── README.md           ← Overview (optional but recommended)
├── requirements.md     ← Requirements with user stories and acceptance criteria
├── design.md           ← Technical design (optional for simple features)
└── tasks.md            ← Implementation task list
```

**Folder naming**: `XX-feature-name` where XX is the next sequential number (currently at 30).  
**Do not create spec folders** — spec creation is KIRO's job. Claude only reads specs and implements them.

---

## Key Files to Read Before Making Changes

| File | Why |
|------|-----|
| `docs/PROJECT_CONTEXT.md` | Full project history, architecture, current state |
| `.kiro/steering/style-guide.md` | Complete design system reference |
| `.kiro/steering/spec-documentation-standards.md` | Spec formatting standards |
| `packages/server/src/routes/index.ts` | All registered API routes |
| `packages/client/src/App.tsx` | All frontend routes |
| `packages/client/src/design-system/components/dashboard/moduleRegistry.ts` | Module/sidebar definitions |
| `packages/client/src/context/AuthContext.tsx` | Auth state and JWT handling |
| `packages/client/src/context/ContextManager.tsx` | Active context state (persona + context switcher) |

---

## Seed Test Accounts (password: `password123`)

| Role | Email | Persona |
|------|-------|---------|
| System Admin | `admin@daystream.app` | system (password: `DayStream2026!`) |
| Business Owner | `owner@transcend.test` | business |
| Manager | `manager@transcend.test` | business |
| Reception | `reception@transcend.test` | business |
| Therapist | `therapist@transcend.test` | business |
| Trainer | `trainer@transcend.test` | business |
| Customer | `customer@transcend.test` | customer |
