# Architecture Decisions

This document tracks key architecture and technology decisions for the platform.
Update the status of each as decisions are made.

## Status Legend
- 🟡 Proposed — Recommendation made, pending team review
- ✅ Decided — Team has agreed
- 🔄 Revisiting — Reopened for discussion

---

## ADR-001: Repository Structure

**Status:** 🟡 Proposed

**Recommendation:** Monorepo (Turborepo or Nx)

**Packages:**
- `apps/web` — Next.js customer/admin portal
- `apps/api` — Backend service
- `apps/mobile` — React Native app
- `packages/shared` — Types, constants, validation schemas
- `packages/ui` — Shared component library
- `packages/db` — Database schema, migrations, queries

**Rationale:** Shared types, atomic commits, simpler dependency management for a two-person team.

---

## ADR-002: Backend Architecture

**Status:** 🟡 Proposed

**Recommendation:** Separate backend (NestJS or Hono) rather than Next.js API routes

**Rationale:**
- Mobile app needs a standalone API
- Complex background processes (payments, payroll) don't belong in serverless
- Cleaner multi-tenant middleware, RBAC, audit logging

**Open question:** NestJS (more structure, DI) vs. Hono (lightweight, modern, flexible)

---

## ADR-003: Database

**Status:** 🟡 Proposed

**Recommendation:** PostgreSQL (managed)

**Multi-tenant strategy:** Row-Level Security with `tenant_id` on every table

**Rationale:** Scales to 10k tenants without schema-per-tenant operational overhead. Single connection pool, unified migrations.

**Open question:** Managed provider — AWS RDS, Neon, Supabase (DB only), or other

---

## ADR-004: Language

**Status:** 🟡 Proposed

**Recommendation:** TypeScript everywhere (frontend, backend, mobile, IaC)

**Rationale:** Shared types DB-to-UI, one language for small team, strong ecosystem.

---

## ADR-005: Authentication

**Status:** 🟡 Proposed

**Recommendation:** Managed auth provider (Auth0 or Clerk)

**Rationale:**
- Multi-tenant auth with per-org roles is complex
- Auth0 Organizations or Clerk multi-tenant support handles this
- Security liability reduced vs. custom auth

**Open question:** Auth0 vs. Clerk — evaluate SDK quality, pricing at scale, React Native support

---

## ADR-006: Mobile Framework

**Status:** 🟡 Proposed

**Recommendation:** React Native + Expo

**Rationale:** Shares TypeScript/logic with web, managed OTA updates, single codebase for iOS + Android.

---

## ADR-007: Hosting & Infrastructure

**Status:** 🟡 Proposed

**Recommendation:** Start simple (Vercel + Railway/Render), migrate to AWS when scale demands

**Rationale:** 50 businesses doesn't need Kubernetes. Minimize ops overhead while small; move to AWS (ECS/Fargate + RDS) when fine-grained control or compliance requires it.

---

## ADR-008: Payment Platform

**Status:** 🟡 Proposed

**Recommendation:** Stripe Connect

**Rationale:** Purpose-built for multi-tenant payments. Connected accounts per business, platform fee collection, managed payouts.

**Open question:** Connect type — Standard, Express, or Custom

---

## Decision Log

| # | Decision | Status | Date |
|---|---|---|---|
| 001 | Monorepo | 🟡 Proposed | 2025-06-09 |
| 002 | Separate backend | 🟡 Proposed | 2025-06-09 |
| 003 | PostgreSQL + RLS | 🟡 Proposed | 2025-06-09 |
| 004 | TypeScript everywhere | 🟡 Proposed | 2025-06-09 |
| 005 | Managed auth (Auth0/Clerk) | 🟡 Proposed | 2025-06-09 |
| 006 | React Native + Expo | 🟡 Proposed | 2025-06-09 |
| 007 | Start simple hosting | 🟡 Proposed | 2025-06-09 |
| 008 | Stripe Connect | 🟡 Proposed | 2025-06-09 |
