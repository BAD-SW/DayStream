# Architecture Decisions

This document tracks key architecture and technology decisions for the platform.
Update the status of each as decisions are made.

## Status Legend
- 🟡 Proposed — Recommendation made, pending team review
- ✅ Decided — Team has agreed
- 🔄 Revisiting — Reopened for discussion

---

## ADR-001: Repository Structure

**Status:** ✅ Decided

**Decision:** Monorepo using npm workspaces

**Packages:**
- `packages/server` — Express.js API
- `packages/client` — React + Vite frontend
- `packages/mobile` — React Native app (future)
- `packages/shared` — Types, constants, validation schemas

**Rationale:** Shared types, atomic commits, simpler dependency management for a two-person team. Consistent with existing projects (Caterra, Gold Mine).

---

## ADR-002: Backend Architecture

**Status:** ✅ Decided

**Decision:** Express.js with TypeScript

**Rationale:**
- Mobile app needs a standalone API
- Complex background processes (payments, payroll) don't belong in serverless
- Cleaner multi-tenant middleware, RBAC, audit logging
- Consistent with team's existing projects and expertise
- Full control, no framework magic

---

## ADR-003: Database

**Status:** ✅ Decided

**Decision:** PostgreSQL with raw SQL (pg driver), row-level tenancy via `tenant_id`

**Multi-tenant strategy:** Row-Level Security with `tenant_id` on every table

**Migration strategy:** Versioned raw SQL files with a custom migration runner (consistent with existing projects)

**Rationale:** Scales to 10k tenants without schema-per-tenant operational overhead. Single connection pool, unified migrations. No ORM — full control over queries.

**Hosting:** Local PostgreSQL during development, AWS RDS for production (future)

---

## ADR-004: Language

**Status:** ✅ Decided

**Decision:** TypeScript everywhere (frontend, backend, mobile)

**Rationale:** Shared types DB-to-UI, one language for small team, strong ecosystem. Consistent with all existing projects.

---

## ADR-005: Authentication

**Status:** 🟡 Proposed

**Recommendation:** Managed auth provider (Auth0 or Clerk) OR custom JWT + bcrypt (consistent with existing projects)

**Rationale:**
- Multi-tenant auth with per-org roles is complex
- Auth0/Clerk reduces security liability
- However, existing projects use custom JWT + bcrypt successfully

**Open question:** Managed provider vs. custom — to be evaluated in Phase 02

---

## ADR-006: Mobile Framework

**Status:** 🟡 Proposed

**Recommendation:** React Native + Expo

**Rationale:** Shares TypeScript/logic with web, managed OTA updates, single codebase for iOS + Android.

---

## ADR-007: Hosting & Infrastructure

**Status:** ✅ Decided

**Decision:** Local development for now, migrate to AWS when ready

**Rationale:** Development is local-first. AWS migration is planned but not immediate (months out). All local workarounds are tracked in docs/MIGRATION_TRACKER.md.

**Local setup:**
- Frontend: http://localhost:4000
- Backend API: http://localhost:4001
- PostgreSQL: localhost:5432

---

## ADR-008: Payment Platform

**Status:** 🟡 Proposed

**Recommendation:** Stripe Connect

**Rationale:** Purpose-built for multi-tenant payments. Connected accounts per business, platform fee collection, managed payouts.

**Note:** To be evaluated when Phase 10 begins. No third-party service is pre-selected.

---

## ADR-009: Frontend Framework

**Status:** ✅ Decided

**Decision:** React + Vite + TypeScript

**Libraries:**
- react-router-dom (routing)
- axios (HTTP client)
- i18next (internationalization)

**Rationale:** Proven stack in existing projects. Vite is fast for development, React gives full control over UI architecture. Colleague will drive look and feel decisions.

---

## ADR-010: Testing

**Status:** ✅ Decided

**Decision:** Vitest (faster, more modern than Jest)

**Strategy:**
- Stage 1: Unit tests for every function (written during development by Kiro)
- Stage 2: Integration tests for frontend ↔ backend (written during development by Kiro)
- Stage 3: System-wide testing (manual, by team)

**Libraries:** Vitest, Testing Library, supertest (API testing)

---

## ADR-011: API Documentation

**Status:** ✅ Decided

**Decision:** OpenAPI/Swagger from day one (swagger-ui-express)

**Rationale:** Serves as the contract between frontend and backend. Auto-generated API docs keep both developers aligned.

---

## ADR-012: Configuration Philosophy

**Status:** ✅ Decided

**Decision:** Minimize .env files. All application configuration stored in database.

**.env contains ONLY:** Database connection, app port, Node environment, third-party API secrets, encryption keys.

**Database contains:** All tenant config, feature flags, business logic settings, service provider settings, pricing rules, everything else.

---

## ADR-013: Third-Party Services

**Status:** ✅ Decided

**Decision:** No third-party service is pre-selected. Each is evaluated at point of need with an abstraction layer to avoid lock-in.

**Details:** See docs/THIRD_PARTY_SERVICES.md

---

## Decision Log

| # | Decision | Status | Date |
|---|---|---|---|
| 001 | Monorepo (npm workspaces) | ✅ Decided | 2026-06-10 |
| 002 | Express.js backend | ✅ Decided | 2026-06-10 |
| 003 | PostgreSQL + RLS + raw SQL | ✅ Decided | 2026-06-10 |
| 004 | TypeScript everywhere | ✅ Decided | 2026-06-10 |
| 005 | Auth provider | 🟡 Proposed | 2026-06-10 |
| 006 | React Native + Expo | 🟡 Proposed | 2026-06-10 |
| 007 | Local dev → AWS later | ✅ Decided | 2026-06-10 |
| 008 | Payment platform | 🟡 Proposed | 2026-06-10 |
| 009 | React + Vite frontend | ✅ Decided | 2026-06-10 |
| 010 | Vitest for testing | ✅ Decided | 2026-06-10 |
| 011 | OpenAPI/Swagger docs | ✅ Decided | 2026-06-10 |
| 012 | DB-driven config (minimal .env) | ✅ Decided | 2026-06-10 |
| 013 | Third-party eval at point of need | ✅ Decided | 2026-06-10 |
