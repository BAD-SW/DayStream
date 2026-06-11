# Phase 00: Infrastructure - Tasks

## Overview

Implementation tasks for scaffolding the DayStream monorepo, configuring the server and client packages, setting up the database with migrations and seed data, and establishing the testing infrastructure.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Monorepo Setup

### 1.1 Root Configuration
- [ ] Create root `package.json` with npm workspaces configuration
- [ ] Add `concurrently` as root dev dependency
- [ ] Configure root-level scripts (dev, dev:server, dev:client, build, test, lint, migrate:dev, seed:dev)
- [ ] Create `.env.example` with all required environment variables
- [ ] Update `.gitignore` for monorepo (node_modules per package, dist, coverage, .env)

### 1.2 Package Directories
- [ ] Create `packages/server/` directory
- [ ] Create `packages/client/` directory
- [ ] Create `packages/shared/` directory

---

## 2. Shared Package

### 2.1 Package Configuration
- [ ] Create `packages/shared/package.json` (name: @daystream/shared, zero dependencies)
- [ ] Create `packages/shared/tsconfig.json`
- [ ] Create `packages/shared/src/index.ts` (barrel export)

### 2.2 Type Definitions
- [ ] Create `src/types/tenant.ts` (Tenant interface)
- [ ] Create `src/types/user.ts` (User interface, UserRole type)
- [ ] Create `src/types/api.ts` (ApiResponse, ApiError interfaces)
- [ ] Create `src/constants/roles.ts` (USER_ROLES constant)

---

## 3. Backend Server

### 3.1 Package Configuration
- [ ] Create `packages/server/package.json` with dependencies and scripts
- [ ] Create `packages/server/tsconfig.json` (strict mode)
- [ ] Install dependencies (express, cors, dotenv, pg, joi, winston, uuid, swagger-ui-express)
- [ ] Install dev dependencies (tsx, typescript, vitest, @types/*)

### 3.2 Configuration Module
- [ ] Create `src/config/index.ts` (load dotenv, validate with Joi, export config object)
- [ ] Validate required environment variables at startup
- [ ] Fail with clear error messages for missing/invalid values

### 3.3 Database Connection
- [ ] Create `src/db/pool.ts` (pg Pool with config from environment)
- [ ] Configure connection pool size
- [ ] Add connection error handling with clear messages
- [ ] Test database connectivity at startup

### 3.4 Express Application
- [ ] Create `src/app.ts` (Express app with middleware stack)
- [ ] Add request ID middleware (X-Request-Id header)
- [ ] Add request logging middleware (winston)
- [ ] Add CORS middleware (configured for localhost:4000)
- [ ] Add JSON body parser (1MB limit)
- [ ] Add 404 handler
- [ ] Add global error handler (structured error response)

### 3.5 Routes
- [ ] Create `src/routes/index.ts` (router registry)
- [ ] Create `src/routes/health.ts` (GET /api/health — returns status, version, uptime)
- [ ] Mount routes under `/api/v1/` prefix

### 3.6 Server Entry Point
- [ ] Create `src/index.ts` (validate config, test DB connection, start server on configured port)
- [ ] Log startup confirmation with port and docs URL

---

## 4. API Documentation (Swagger)

### 4.1 OpenAPI Spec
- [ ] Create `src/docs/openapi.ts` (OpenAPI 3.0 spec object)
- [ ] Define info section (title: DayStream API, version, description)
- [ ] Define server entry (localhost:4001)
- [ ] Define health endpoint schema

### 4.2 Swagger UI
- [ ] Mount swagger-ui-express at `/api/docs`
- [ ] Verify Swagger UI loads and displays health endpoint

---

## 5. Database Setup

### 5.1 Migration System
- [ ] Create `src/db/migrations/` directory
- [ ] Create `src/db/migrate.ts` (migration runner script)
- [ ] Create migrations table if not exists (id, filename, applied_at)
- [ ] Read migration files from directory (sorted numerically)
- [ ] Compare against applied migrations
- [ ] Execute unapplied migrations in transaction
- [ ] Log applied migrations
- [ ] Add `migrate:dev` script to package.json

### 5.2 Foundation Schema Migration
- [ ] Create `src/db/migrations/001_initial_schema.sql`
- [ ] Add uuid-ossp extension
- [ ] Create `tenants` table (id, name, slug, status, created_at, updated_at)
- [ ] Create `users` table (id, tenant_id, email, first_name, last_name, password_hash, role, status, created_at, updated_at)
- [ ] Add CHECK constraints for status and role fields
- [ ] Add UNIQUE constraint on (tenant_id, email)
- [ ] Add indexes on tenant_id, email, slug columns

### 5.3 Seed Script
- [ ] Create `src/db/seed.ts`
- [ ] Define fixed seed UUIDs for tenant and users
- [ ] Clear existing seed data before inserting
- [ ] Insert test tenant (Transcend Health Mallorca)
- [ ] Insert test users (one per role: owner, manager, reception, therapist, trainer, customer)
- [ ] Hash test passwords (password123)
- [ ] Log seed summary
- [ ] Add `seed:dev` script to package.json

---

## 6. Frontend Client

### 6.1 Package Configuration
- [ ] Create `packages/client/package.json` with dependencies and scripts
- [ ] Create `packages/client/tsconfig.json`
- [ ] Install dependencies (react, react-dom, react-router-dom, axios)
- [ ] Install dev dependencies (vite, @vitejs/plugin-react, typescript, vitest, @testing-library/*, jsdom)

### 6.2 Vite Configuration
- [ ] Create `vite.config.ts` (port 4000, proxy /api to localhost:4001)
- [ ] Create `index.html` (React mount point)

### 6.3 Application Shell
- [ ] Create `src/main.tsx` (React entry point, render App)
- [ ] Create `src/App.tsx` (BrowserRouter, placeholder page)
- [ ] Create `src/api/client.ts` (axios instance with /api baseURL)
- [ ] Create placeholder page that calls /api/health and displays status
- [ ] Confirm "DayStream — System Ready" renders on screen

---

## 7. Testing Infrastructure

### 7.1 Server Tests
- [ ] Create `packages/server/vitest.config.ts` (node environment)
- [ ] Create `packages/server/tests/health.test.ts` (GET /api/health returns 200)
- [ ] Verify `npm run test` passes in server package

### 7.2 Client Tests
- [ ] Create `packages/client/vitest.config.ts` (jsdom environment)
- [ ] Create `packages/client/tests/setup.ts` (testing-library setup)
- [ ] Create `packages/client/tests/App.test.tsx` (App renders without crashing)
- [ ] Verify `npm run test` passes in client package

### 7.3 Root Test Script
- [ ] Verify `npm run test` from root runs all package tests
- [ ] Confirm all tests pass

---

## 8. Final Verification

### 8.1 Full Onboarding Flow
- [ ] Run `npm install` from clean clone
- [ ] Run `npm run migrate:dev` — migrations apply successfully
- [ ] Run `npm run seed:dev` — seed data populates
- [ ] Run `npm run dev` — both server and client start
- [ ] Verify http://localhost:4001/api/health returns JSON response
- [ ] Verify http://localhost:4001/api/docs loads Swagger UI
- [ ] Verify http://localhost:4000 renders the placeholder page
- [ ] Run `npm run test` — all tests pass
- [ ] Run seed script a second time — idempotent (no duplicates)

### 8.2 Documentation
- [ ] Update README.md with onboarding steps
- [ ] Verify .env.example documents all required variables
- [ ] Commit and push to GitHub
