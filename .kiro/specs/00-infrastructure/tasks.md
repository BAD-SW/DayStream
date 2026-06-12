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
- [x] ✅ Create root `package.json` with npm workspaces configuration
- [x] ✅ Add `concurrently` as root dev dependency
- [x] ✅ Configure root-level scripts (dev, dev:server, dev:client, build, test, lint, migrate:dev, seed:dev)
- [x] ✅ Create `.env.example` with all required environment variables
- [x] ✅ Update `.gitignore` for monorepo (node_modules per package, dist, coverage, .env)

### 1.2 Package Directories
- [x] ✅ Create `packages/server/` directory
- [x] ✅ Create `packages/client/` directory
- [x] ✅ Create `packages/shared/` directory

---

## 2. Shared Package

### 2.1 Package Configuration
- [x] ✅ Create `packages/shared/package.json` (name: @daystream/shared, zero dependencies)
- [x] ✅ Create `packages/shared/tsconfig.json`
- [x] ✅ Create `packages/shared/src/index.ts` (barrel export)

### 2.2 Type Definitions
- [x] ✅ Create `src/types/tenant.ts` (Tenant interface)
- [x] ✅ Create `src/types/user.ts` (User interface, UserRole type)
- [x] ✅ Create `src/types/api.ts` (ApiResponse, ApiError interfaces)
- [x] ✅ Create `src/constants/roles.ts` (USER_ROLES constant)

---

## 3. Backend Server

### 3.1 Package Configuration
- [x] ✅ Create `packages/server/package.json` with dependencies and scripts
- [x] ✅ Create `packages/server/tsconfig.json` (strict mode)
- [x] ✅ Install dependencies (express, cors, dotenv, pg, joi, winston, uuid, swagger-ui-express)
- [x] ✅ Install dev dependencies (tsx, typescript, vitest, @types/*)

### 3.2 Configuration Module
- [x] ✅ Create `src/config/index.ts` (load dotenv, validate with Joi, export config object)
- [x] ✅ Validate required environment variables at startup
- [x] ✅ Fail with clear error messages for missing/invalid values

### 3.3 Database Connection
- [x] ✅ Create `src/db/pool.ts` (pg Pool with config from environment)
- [x] ✅ Configure connection pool size
- [x] ✅ Add connection error handling with clear messages
- [x] ✅ Test database connectivity at startup

### 3.4 Express Application
- [x] ✅ Create `src/app.ts` (Express app with middleware stack)
- [x] ✅ Add request ID middleware (X-Request-Id header)
- [x] ✅ Add request logging middleware (winston)
- [x] ✅ Add CORS middleware (configured for localhost:4000)
- [x] ✅ Add JSON body parser (1MB limit)
- [x] ✅ Add 404 handler
- [x] ✅ Add global error handler (structured error response)

### 3.5 Routes
- [x] ✅ Create `src/routes/index.ts` (router registry)
- [x] ✅ Create `src/routes/health.ts` (GET /api/health — returns status, version, uptime)
- [x] ✅ Mount routes under `/api/v1/` prefix

### 3.6 Server Entry Point
- [x] ✅ Create `src/index.ts` (validate config, test DB connection, start server on configured port)
- [x] ✅ Log startup confirmation with port and docs URL

---

## 4. API Documentation (Swagger)

### 4.1 OpenAPI Spec
- [x] ✅ Create `src/docs/openapi.ts` (OpenAPI 3.0 spec object)
- [x] ✅ Define info section (title: DayStream API, version, description)
- [x] ✅ Define server entry (localhost:4001)
- [x] ✅ Define health endpoint schema

### 4.2 Swagger UI
- [x] ✅ Mount swagger-ui-express at `/api/docs`
- [x] ✅ Verify Swagger UI loads and displays health endpoint

---

## 5. Database Setup

### 5.1 Migration System
- [x] ✅ Create `src/db/migrations/` directory
- [x] ✅ Create `src/db/migrate.ts` (migration runner script)
- [x] ✅ Create migrations table if not exists (id, filename, applied_at)
- [x] ✅ Read migration files from directory (sorted numerically)
- [x] ✅ Compare against applied migrations
- [x] ✅ Execute unapplied migrations in transaction
- [x] ✅ Log applied migrations
- [x] ✅ Add `migrate:dev` script to package.json

### 5.2 Foundation Schema Migration
- [x] ✅ Create `src/db/migrations/001_initial_schema.sql`
- [x] ✅ Add uuid-ossp extension
- [x] ✅ Create `tenants` table (id, name, slug, status, created_at, updated_at)
- [x] ✅ Create `users` table (id, tenant_id, email, first_name, last_name, password_hash, role, status, created_at, updated_at)
- [x] ✅ Add CHECK constraints for status and role fields
- [x] ✅ Add UNIQUE constraint on (tenant_id, email)
- [x] ✅ Add indexes on tenant_id, email, slug columns

### 5.3 Seed Script
- [x] ✅ Create `src/db/seed.ts`
- [x] ✅ Define fixed seed UUIDs for tenant and users
- [x] ✅ Clear existing seed data before inserting
- [x] ✅ Insert test tenant (Transcend Health Mallorca)
- [x] ✅ Insert test users (one per role: owner, manager, reception, therapist, trainer, customer)
- [x] ✅ Hash test passwords (password123)
- [x] ✅ Log seed summary
- [x] ✅ Add `seed:dev` script to package.json

---

## 6. Frontend Client

### 6.1 Package Configuration
- [x] ✅ Create `packages/client/package.json` with dependencies and scripts
- [x] ✅ Create `packages/client/tsconfig.json`
- [x] ✅ Install dependencies (react, react-dom, react-router-dom, axios)
- [x] ✅ Install dev dependencies (vite, @vitejs/plugin-react, typescript, vitest, @testing-library/*, jsdom)

### 6.2 Vite Configuration
- [x] ✅ Create `vite.config.ts` (port 4000, proxy /api to localhost:4001)
- [x] ✅ Create `index.html` (React mount point)

### 6.3 Application Shell
- [x] ✅ Create `src/main.tsx` (React entry point, render App)
- [x] ✅ Create `src/App.tsx` (BrowserRouter, placeholder page)
- [x] ✅ Create `src/api/client.ts` (axios instance with /api baseURL)
- [x] ✅ Create placeholder page that calls /api/health and displays status
- [x] ✅ Confirm "DayStream — System Ready" renders on screen

---

## 7. Testing Infrastructure

### 7.1 Server Tests
- [x] ✅ Create `packages/server/vitest.config.ts` (node environment)
- [x] ✅ Create `packages/server/tests/health.test.ts` (GET /api/health returns 200)
- [x] ✅ Verify `npm run test` passes in server package

### 7.2 Client Tests
- [x] ✅ Create `packages/client/vitest.config.ts` (jsdom environment)
- [x] ✅ Create `packages/client/tests/setup.ts` (testing-library setup)
- [x] ✅ Create `packages/client/tests/App.test.tsx` (App renders without crashing)
- [x] ✅ Verify `npm run test` passes in client package

### 7.3 Root Test Script
- [x] ✅ Verify `npm run test` from root runs all package tests
- [x] ✅ Confirm all tests pass

---

## 8. Final Verification

### 8.1 Full Onboarding Flow
- [x] ✅ Run `npm install` from clean clone
- [x] ✅ Run `npm run migrate:dev` — migrations apply successfully
- [x] ✅ Run `npm run seed:dev` — seed data populates
- [x] ✅ Run `npm run dev` — both server and client start
- [x] ✅ Verify http://localhost:4001/api/health returns JSON response
- [x] ✅ Verify http://localhost:4001/api/docs loads Swagger UI
- [x] ✅ Verify http://localhost:4000 renders the placeholder page
- [x] ✅ Run `npm run test` — all tests pass
- [x] ✅ Run seed script a second time — idempotent (no duplicates)

### 8.2 Documentation
- [x] ✅ Update README.md with onboarding steps
- [x] ✅ Verify .env.example documents all required variables
- [x] ✅ Commit and push to GitHub
