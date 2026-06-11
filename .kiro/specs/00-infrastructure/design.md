# Phase 00: Infrastructure - Design Document

**Date**: June 11, 2026
**Status**: 🎨 Design Phase
**Dependencies**: None (foundation phase)

---

## Overview

This document describes the technical design for the DayStream local development infrastructure. It defines the monorepo structure, server and client configuration, database schema, migration system, seed data approach, and testing setup.

---

## Table of Contents

1. [Monorepo Structure](#1-monorepo-structure)
2. [Backend Server Architecture](#2-backend-server-architecture)
3. [Frontend Client Architecture](#3-frontend-client-architecture)
4. [Shared Package](#4-shared-package)
5. [Database Design](#5-database-design)
6. [Migration System](#6-migration-system)
7. [Seed Data](#7-seed-data)
8. [API Documentation (Swagger)](#8-api-documentation-swagger)
9. [Testing Infrastructure](#9-testing-infrastructure)
10. [Environment Configuration](#10-environment-configuration)
11. [Project Scripts](#11-project-scripts)

---

## 1. Monorepo Structure

```
daystream/
├── packages/
│   ├── server/                 # Express.js API (port 4001)
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point
│   │   │   ├── app.ts          # Express app setup (middleware, routes)
│   │   │   ├── config/         # Environment loading, validation
│   │   │   ├── db/
│   │   │   │   ├── pool.ts     # PostgreSQL connection pool
│   │   │   │   ├── migrate.ts  # Migration runner
│   │   │   │   ├── seed.ts     # Seed script
│   │   │   │   └── migrations/ # Numbered SQL files
│   │   │   ├── middleware/     # CORS, logging, error handling
│   │   │   ├── routes/         # API route definitions
│   │   │   └── docs/           # Swagger/OpenAPI config
│   │   ├── tests/              # Server tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── client/                 # React + Vite (port 4000)
│   │   ├── src/
│   │   │   ├── main.tsx        # React entry point
│   │   │   ├── App.tsx         # Root component with router
│   │   │   ├── api/            # Axios client configuration
│   │   │   ├── pages/          # Route pages
│   │   │   └── components/     # UI components
│   │   ├── tests/              # Client tests
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── vitest.config.ts
│   └── shared/                 # Shared types and utilities
│       ├── src/
│       │   ├── index.ts        # Package exports
│       │   ├── types/          # TypeScript interfaces and types
│       │   ├── constants/      # Shared constants
│       │   └── validation/     # Joi schemas
│       ├── package.json
│       └── tsconfig.json
├── .env.example                # Environment variable template
├── .gitignore
├── package.json                # Root workspace config
├── README.md
└── docs/                       # Project documentation
```

### Workspace Configuration (root `package.json`)

```json
{
  "name": "daystream",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "npm run dev --workspace=packages/server",
    "dev:client": "npm run dev --workspace=packages/client",
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "lint": "npm run lint --workspaces",
    "migrate:dev": "npm run migrate:dev --workspace=packages/server",
    "seed:dev": "npm run seed:dev --workspace=packages/server"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

---

## 2. Backend Server Architecture

### Entry Point (`src/index.ts`)

```typescript
import { app } from './app';
import { config } from './config';
import { pool } from './db/pool';

const start = async () => {
  // Validate environment
  config.validate();

  // Test database connection
  await pool.query('SELECT 1');
  console.log('✓ Database connected');

  // Start server
  app.listen(config.port, () => {
    console.log(`✓ Server running on http://localhost:${config.port}`);
    console.log(`✓ API docs at http://localhost:${config.port}/api/docs`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
```

### Express App (`src/app.ts`)

Middleware stack (in order):
1. Request ID generation (`X-Request-Id` header)
2. Request logging (winston)
3. CORS (configured for localhost:4000)
4. JSON body parser (limit: 1MB)
5. API routes (versioned under `/api/v1/`)
6. Swagger UI (`/api/docs`)
7. Health check (`/api/health`)
8. 404 handler
9. Global error handler

### Server Package Dependencies

```json
{
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.1",
    "express": "^4.18.2",
    "joi": "^17.11.0",
    "pg": "^8.11.3",
    "swagger-ui-express": "^5.0.0",
    "uuid": "^9.0.1",
    "winston": "^3.19.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.16",
    "@types/swagger-ui-express": "^4.1.6",
    "@types/uuid": "^9.0.7",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^2.1.8"
  }
}
```

### Server Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "migrate:dev": "tsx src/db/migrate.ts",
    "seed:dev": "tsx src/db/seed.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts"
  }
}
```

---

## 3. Frontend Client Architecture

### Vite Configuration

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});
```

### Client Package Dependencies

```json
{
  "dependencies": {
    "axios": "^1.6.7",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.1.5",
    "@testing-library/react": "^14.1.2",
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "jsdom": "^28.1.0",
    "typescript": "^5.3.3",
    "vite": "^5.1.0",
    "vitest": "^2.1.8"
  }
}
```

### Axios Client Configuration (`src/api/client.ts`)

```typescript
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});
```

Note: The Vite proxy handles forwarding `/api` requests to port 4001, so the client doesn't need to know the server port directly.

### Placeholder App (`src/App.tsx`)

A minimal page that:
- Confirms React is running
- Calls `GET /api/health` and displays the response
- Shows the DayStream logo/name and "System Ready" status

---

## 4. Shared Package

### Purpose

Zero-dependency package containing only TypeScript types, constants, and Joi validation schemas shared between server and client.

### Structure

```typescript
// packages/shared/src/types/tenant.ts
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  created_at: string;
  updated_at: string;
}

// packages/shared/src/types/user.ts
export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export type UserRole = 'super_admin' | 'business_owner' | 'manager' | 'reception' | 'therapist' | 'trainer' | 'customer';

// packages/shared/src/types/api.ts
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

// packages/shared/src/constants/roles.ts
export const USER_ROLES = ['super_admin', 'business_owner', 'manager', 'reception', 'therapist', 'trainer', 'customer'] as const;
```

### Package Configuration

```json
{
  "name": "@daystream/shared",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {}
}
```

No build step — consumed directly as TypeScript source via workspace resolution.

---

## 5. Database Design

### Foundation Schema

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'customer'
        CHECK (role IN ('super_admin', 'business_owner', 'manager', 'reception', 'therapist', 'trainer', 'customer')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Indexes
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_tenants_slug ON tenants(slug);
```

### Conventions

All tables follow these conventions:
- `id` — UUID primary key, auto-generated
- `tenant_id` — UUID foreign key to `tenants` (on all tenant-scoped tables)
- `created_at` — TIMESTAMPTZ, auto-set on insert
- `updated_at` — TIMESTAMPTZ, auto-set on insert, updated on modification
- Status fields use CHECK constraints with defined allowed values
- Unique constraints include tenant_id where applicable (e.g., email unique per tenant, not globally)

---

## 6. Migration System

### File Naming Convention

```
packages/server/src/db/migrations/
├── 001_initial_schema.sql
├── 002_add_services.sql       (future - Phase 06)
├── 003_add_bookings.sql       (future - Phase 07)
└── ...
```

### Migration Runner (`src/db/migrate.ts`)

```typescript
// Pseudocode for migration runner

1. Connect to database
2. Create `migrations` table if not exists:
   - id SERIAL PRIMARY KEY
   - filename VARCHAR(255) NOT NULL UNIQUE
   - applied_at TIMESTAMPTZ DEFAULT NOW()
3. Read all .sql files from migrations/ directory (sorted by number)
4. Query applied migrations from the `migrations` table
5. For each unapplied migration:
   a. Read SQL file contents
   b. Execute within a transaction
   c. Insert record into `migrations` table
   d. Log: "Applied: 001_initial_schema.sql"
6. Log summary: "X migrations applied, Y already up to date"
```

### Migrations Table Schema

```sql
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. Seed Data

### Seed Script Design (`src/db/seed.ts`)

The seed script is idempotent — it clears and recreates seed data on every run.

```typescript
// Pseudocode for seed script

1. Connect to database
2. Clear existing seed data (DELETE from users, tenants WHERE seeded = true or specific IDs)
3. Insert test tenant:
   - name: "Transcend Health Mallorca"
   - slug: "transcend"
   - status: "active"
4. Insert test users (per role):
   - Business Owner: owner@transcend.test
   - Manager: manager@transcend.test
   - Reception: reception@transcend.test
   - Therapist: therapist@transcend.test
   - Trainer: trainer@transcend.test
   - Customer: customer@transcend.test
5. All passwords hashed as "password123" (dev only)
6. Log summary: "Seed complete: 1 tenant, 6 users"
```

### Seed Data Identification

Seed records use fixed UUIDs so they can be reliably deleted and recreated:

```typescript
const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SEED_USERS = {
  owner:      '00000000-0000-0000-0000-000000000010',
  manager:    '00000000-0000-0000-0000-000000000011',
  reception:  '00000000-0000-0000-0000-000000000012',
  therapist:  '00000000-0000-0000-0000-000000000013',
  trainer:    '00000000-0000-0000-0000-000000000014',
  customer:   '00000000-0000-0000-0000-000000000015',
};
```

---

## 8. API Documentation (Swagger)

### Approach

Use `swagger-ui-express` with a manually maintained OpenAPI spec (YAML or JSON). As routes are added, the spec is updated alongside.

### File Structure

```
packages/server/src/docs/
├── openapi.ts          # OpenAPI spec definition (programmatic)
└── schemas/            # Reusable schema definitions
```

### OpenAPI Spec Structure

```typescript
export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'DayStream API',
    version: '0.1.0',
    description: 'DayStream wellness platform API',
  },
  servers: [
    { url: 'http://localhost:4001', description: 'Local development' },
  ],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '0.1.0' },
                    uptime: { type: 'number', example: 12345 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
```

### Swagger UI Mount

```typescript
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
```

---

## 9. Testing Infrastructure

### Server Tests (`packages/server/vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/db/seed.ts'],
    },
  },
});
```

### Client Tests (`packages/client/vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'src/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
});
```

### Initial Tests

**Server** (`packages/server/tests/health.test.ts`):
- `GET /api/health` returns 200 with status "ok"

**Client** (`packages/client/tests/App.test.tsx`):
- App component renders without crashing
- Displays the DayStream name

---

## 10. Environment Configuration

### `.env.example`

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=daystream_dev

# Application
SERVER_PORT=4001
CLIENT_PORT=4000
NODE_ENV=development
```

### Config Module (`packages/server/src/config/index.ts`)

```typescript
import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const schema = Joi.object({
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  SERVER_PORT: Joi.number().default(4001),
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
}).unknown(true);

const { error, value } = schema.validate(process.env);

export const config = {
  db: {
    host: value.DB_HOST,
    port: value.DB_PORT,
    user: value.DB_USER,
    password: value.DB_PASSWORD,
    database: value.DB_NAME,
  },
  port: value.SERVER_PORT,
  nodeEnv: value.NODE_ENV,
  validate: () => {
    if (error) {
      throw new Error(`Environment validation failed: ${error.message}`);
    }
  },
};
```

---

## 11. Project Scripts

### Complete Script Reference

| Command | Location | Action |
|---|---|---|
| `npm run dev` | root | Starts server and client concurrently |
| `npm run dev:server` | root | Starts only the API server (tsx watch) |
| `npm run dev:client` | root | Starts only the Vite dev server |
| `npm run build` | root | Builds all packages |
| `npm run test` | root | Runs all tests across packages |
| `npm run lint` | root | Lints all packages |
| `npm run migrate:dev` | root | Runs pending database migrations |
| `npm run seed:dev` | root | Seeds database with test data |

### Developer Onboarding Flow

```
1. git clone https://github.com/BAD-SW/daystream.git
2. cd daystream
3. npm install
4. cp .env.example .env        (edit with local DB credentials)
5. createdb daystream_dev      (create the PostgreSQL database)
6. npm run migrate:dev         (apply schema migrations)
7. npm run seed:dev            (populate test data)
8. npm run dev                 (start both server and client)
9. Open http://localhost:4000  (client)
10. Open http://localhost:4001/api/docs (Swagger)
```

---

**Last Updated**: June 11, 2026
