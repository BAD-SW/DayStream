# Phase 00: Infrastructure & DevOps - Requirements

## Overview

Establish the local development infrastructure for the DayStream platform. This phase scaffolds the monorepo, configures the database, sets up the API and frontend projects, and creates the foundation that all subsequent phases build upon. AWS migration is out of scope — this is local-first development infrastructure.

## Goals

- Scaffold a working monorepo with separate server and client packages
- Establish the PostgreSQL database with a migration runner and tenant-aware foundation schema
- Get both server (port 4001) and client (port 4000) running locally
- Set up OpenAPI/Swagger documentation
- Create a seed script for consistent development data
- Establish testing infrastructure (Vitest)

## Requirements

### Monorepo Structure

#### Requirement 1: npm Workspaces Monorepo

**User Story**: As a developer, I want a single repository with clearly separated packages, so that I can share code between server and client while keeping concerns isolated.

##### Acceptance Criteria

1. THE system SHALL use npm workspaces to manage multiple packages
2. THE system SHALL contain a `packages/server` directory for the Express.js API
3. THE system SHALL contain a `packages/client` directory for the React + Vite frontend
4. THE system SHALL contain a `packages/shared` directory for shared TypeScript types, constants, and validation schemas
5. THE system SHALL provide root-level scripts to run both server and client concurrently
6. THE system SHALL provide root-level scripts to run server and client independently
7. THE system SHALL use `concurrently` to run parallel dev processes from the root

---

### Backend Server

#### Requirement 2: Express.js API Server

**User Story**: As a developer, I want a configured Express.js server with TypeScript, so that I can immediately begin building API endpoints.

##### Acceptance Criteria

1. THE system SHALL run an Express.js server on port 4001
2. THE system SHALL use TypeScript with strict mode enabled
3. THE system SHALL use `tsx watch` for development hot-reloading
4. THE system SHALL include CORS configuration
5. THE system SHALL include JSON body parsing middleware
6. THE system SHALL include a health check endpoint (`GET /api/health`)
7. THE system SHALL include request logging (using winston or similar)
8. THE system SHALL load configuration from a `.env` file using dotenv

#### Requirement 3: OpenAPI/Swagger Documentation

**User Story**: As a developer, I want auto-generated API documentation available at a URL, so that both developers can understand and test endpoints without reading source code.

##### Acceptance Criteria

1. THE system SHALL serve Swagger UI at `/api/docs`
2. THE system SHALL generate OpenAPI 3.0 specification from route definitions
3. THE system SHALL update documentation automatically as new routes are added
4. THE system SHALL include request/response schemas in the documentation

---

### Frontend Client

#### Requirement 4: React + Vite Client

**User Story**: As a developer, I want a configured React application with Vite, so that I can begin building UI components when ready.

##### Acceptance Criteria

1. THE system SHALL run a Vite dev server on port 4000
2. THE system SHALL use React 18+ with TypeScript
3. THE system SHALL include react-router-dom for routing
4. THE system SHALL include axios configured to call the API at localhost:4001
5. THE system SHALL display a minimal placeholder page confirming the app is running
6. THE system SHALL proxy API requests or handle CORS to communicate with the backend

---

### Database

#### Requirement 5: PostgreSQL Database Setup

**User Story**: As a developer, I want a local PostgreSQL database configured and ready, so that I can persist and query application data.

##### Acceptance Criteria

1. THE system SHALL connect to a PostgreSQL database named `DayStream` on localhost:5432
2. THE system SHALL use the `pg` driver (no ORM)
3. THE system SHALL provide a database connection pool with configurable pool size
4. THE system SHALL gracefully handle database connection failures with clear error messages
5. THE system SHALL include database connection configuration in `.env`

#### Requirement 6: Migration Runner

**User Story**: As a developer, I want a migration system using raw SQL files, so that schema changes are versioned, repeatable, and shared between developers.

##### Acceptance Criteria

1. THE system SHALL store migrations as numbered SQL files (e.g., `001_initial_schema.sql`)
2. THE system SHALL track which migrations have been applied in a `migrations` table
3. THE system SHALL apply only unapplied migrations when the migrate command is run
4. THE system SHALL provide a `migrate:dev` npm script to run pending migrations
5. THE system SHALL log which migrations are applied during each run
6. THE system SHALL prevent re-running previously applied migrations

#### Requirement 7: Foundation Schema

**User Story**: As a developer, I want a baseline database schema with multi-tenancy built in, so that all subsequent tables follow the same tenant-aware pattern.

##### Acceptance Criteria

1. THE system SHALL create a `tenants` table (id, name, slug, status, created_at, updated_at)
2. THE system SHALL create a `users` table with a `tenant_id` foreign key
3. THE system SHALL include UUID primary keys on all tables
4. THE system SHALL include `created_at` and `updated_at` timestamps on all tables
5. THE system SHALL include a `tenant_id` column on every tenant-scoped table
6. THE system SHALL create appropriate indexes on `tenant_id` columns

#### Requirement 8: Seed Script

**User Story**: As a developer, I want a seed script that populates the database with realistic test data, so that both developers start from the same baseline.

##### Acceptance Criteria

1. THE system SHALL provide a `seed:dev` npm script to populate test data
2. THE system SHALL create at least one test tenant
3. THE system SHALL create at least one test user per role (admin, staff, customer)
4. THE system SHALL be idempotent (safe to run multiple times without duplicating data)
5. THE system SHALL clear existing seed data before re-seeding

---

### Testing Infrastructure

#### Requirement 9: Vitest Configuration

**User Story**: As a developer, I want testing infrastructure configured for both server and client, so that unit and integration tests can be written immediately.

##### Acceptance Criteria

1. THE system SHALL configure Vitest for the server package
2. THE system SHALL configure Vitest for the client package (with jsdom environment)
3. THE system SHALL provide `test`, `test:watch`, and `test:coverage` scripts per package
4. THE system SHALL provide root-level `test` script that runs all package tests
5. THE system SHALL include at least one passing test per package confirming the setup works

---

### Developer Experience

#### Requirement 10: Environment Configuration

**User Story**: As a developer, I want a minimal environment file containing only what is needed to bootstrap the application, so that all other configuration lives in the database and onboarding is straightforward.

##### Acceptance Criteria

1. THE system SHALL include a `.env.example` file documenting all required environment variables
2. THE system SHALL include `.env` in `.gitignore`
3. THE system SHALL limit `.env` to ONLY bootstrap-level values: database connection string (host, port, user, password, database name), application ports (server, client), Node environment (development, staging, production)
4. THE system SHALL NOT store application configuration, feature flags, tenant settings, or business logic values in `.env`
5. THE system SHALL load all non-bootstrap configuration from the database via the Configuration Engine (Phase 03)
6. THE system SHALL fail gracefully with clear messages if required environment variables are missing
7. THE system SHALL validate environment variables at startup before attempting database connection

#### Requirement 11: Project Scripts

**User Story**: As a developer, I want consistent npm scripts across the project, so that common operations are discoverable and uniform.

##### Acceptance Criteria

1. THE system SHALL provide `dev` — start both server and client
2. THE system SHALL provide `dev:server` — start only the API
3. THE system SHALL provide `dev:client` — start only the frontend
4. THE system SHALL provide `build` — build all packages
5. THE system SHALL provide `test` — run all tests
6. THE system SHALL provide `lint` — lint all packages
7. THE system SHALL provide `migrate:dev` — run database migrations
8. THE system SHALL provide `seed:dev` — populate seed data

---

## Dependencies

- None — this is the foundation phase

## Success Criteria

- Running `npm install` followed by `npm run migrate:dev` and `npm run dev` starts both server and client
- API responds at http://localhost:4001/api/health
- Swagger UI loads at http://localhost:4001/api/docs
- Client renders at http://localhost:4000
- Tests pass with `npm test`
- Seed script populates consistent baseline data

## Out of Scope

- AWS infrastructure — tracked in docs/MIGRATION_TRACKER.md for later
- Authentication — Phase 02
- CI/CD pipeline — Phase 01
- Design system / UI components — Phase 04
- Business logic — Phases 05+

## Notes

- Each developer runs their own local PostgreSQL instance
- Port 4000 (client) and 4001 (server) chosen to avoid conflict with other local projects
- Configuration philosophy: only infrastructure-level values in .env, everything else in DB

---

**Status**: 📋 Planned
**Dependencies**: None
**Next Phase**: Phase 01 (CI/CD Pipeline)
