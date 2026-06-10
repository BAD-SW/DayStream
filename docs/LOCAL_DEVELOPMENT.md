# Local Development Environment

## Ports

| Service | Port | URL |
|---|---|---|
| Frontend (web) | 4000 | http://localhost:4000 |
| Backend (API) | 4001 | http://localhost:4001 |
| PostgreSQL | 5432 | localhost:5432 (default) |

## Database

- **Instance:** Existing local PostgreSQL on port 5432
- **Database name:** `booking_manager_dev` (to be created)

## Configuration Philosophy

**Minimize .env files.** Only infrastructure-level settings that are required to bootstrap the application belong in environment variables. All application configuration, tenant settings, and feature flags are stored in the database.

### .env contains ONLY:
- Database connection (host, port, credentials, db name)
- Application port
- Node environment
- Third-party API keys/secrets (auth provider, Stripe, etc.)
- Encryption/signing keys

### Database contains:
- All tenant configuration
- Feature flags
- Business logic settings
- Service provider settings
- Notification preferences
- Pricing rules
- Everything else

## Repository Structure

**Monorepo** — all code (frontend, backend, mobile, shared packages) lives in a single repository.

## Testing Strategy

Three stages of testing:

| Stage | Type | Scope | Performed By |
|---|---|---|---|
| 1 | Unit tests | Individual functions/modules | Kiro (during development) |
| 2 | Integration tests | Frontend ↔ Backend communication | Kiro (during development) |
| 3 | System tests | End-to-end, full system | Bill & colleague (manual) |

- Every function is tested before release
- Unit and integration tests are written alongside code as each feature is built
- System testing is a manual phase conducted by the team

## Prerequisites

- Node.js (installed)
- PostgreSQL (installed, running on 5432)

## Development Standards

- **Codebase language:** All code, comments, variable names, and commit messages in English
- **Localization:** Only user/consumer-facing content is localized (i18n)

## Database Management

- Each developer runs their own local PostgreSQL instance
- Database migrations use versioned SQL scripts (committed to repo)
- Each developer is responsible for applying migration changes to their local environment
- A shared seed script provides a consistent starting point for both developers

## API Documentation

- OpenAPI/Swagger documentation from the start
- Auto-generated from API code/decorators
- Serves as the contract between frontend and backend
