# DayStream

Multi-tenant SaaS booking and business management platform.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your local PostgreSQL credentials

# 3. Create the database
createdb daystream_dev
# Or via psql: CREATE DATABASE daystream_dev;

# 4. Run migrations
npm run migrate:dev

# 5. Seed test data
npm run seed:dev

# 6. Start development
npm run dev
```

- **Client:** http://localhost:4000
- **API:** http://localhost:4001
- **API Docs:** http://localhost:4001/api/docs

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start both server and client |
| `npm run dev:server` | Start only the API server |
| `npm run dev:client` | Start only the frontend |
| `npm run build` | Build all packages |
| `npm run test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run migrate:dev` | Apply pending database migrations |
| `npm run seed:dev` | Populate seed data (idempotent) |

## Project Structure

```
packages/
├── server/     Express.js API (port 4001)
├── client/     React + Vite frontend (port 4000)
└── shared/     Shared TypeScript types and constants
```

## Seed Users

All seed users use password: `password123`

| Role | Email |
|---|---|
| Business Owner | owner@transcend.test |
| Manager | manager@transcend.test |
| Reception | reception@transcend.test |
| Therapist | therapist@transcend.test |
| Trainer | trainer@transcend.test |
| Customer | customer@transcend.test |

## Documentation

- [Architecture Decisions](./docs/ARCHITECTURE_DECISIONS.md)
- [Local Development](./docs/LOCAL_DEVELOPMENT.md)
- [Third-Party Services](./docs/THIRD_PARTY_SERVICES.md)
- [Migration Tracker](./docs/MIGRATION_TRACKER.md)
