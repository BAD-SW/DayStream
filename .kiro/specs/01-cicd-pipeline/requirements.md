# Phase 01: CI/CD Pipeline and Version Management - Requirements

## Overview

This phase implements a CI/CD pipeline on GitHub Actions for the DayStream platform, a versioning strategy, and automated build/test/deploy workflows. The platform uses a calendar-based versioning scheme (YYYY.M.YYYYMMDD) with monthly feature releases and daily patch builds. The repository is hosted on GitHub at `BAD-SW/daystream` with no pipelines currently configured. Initial deployment targets local development, with AWS migration planned for the future.

## Goals

- Establish automated build and test pipelines on GitHub Actions for the `BAD-SW/daystream` repository
- Implement calendar-based versioning with monthly releases and daily patch builds
- Support multiple concurrently active release branches (rolling 12 months)
- Provide automated testing gates that prevent broken code from reaching main
- Establish artifact packaging for future deployment automation
- Lay groundwork for an Admin "Updates" interface for managing platform updates

## Glossary

- **Platform**: The DayStream multi-tenant SaaS wellness business management system
- **Version**: A monthly feature release identified by `YYYY.M.0` (e.g., `2026.8.0`)
- **Patch**: A bug-fix-only build applied to an existing Version, identified by `YYYY.M.YYYYMMDD` (e.g., `2026.8.20260815`)
- **Release_Branch**: A long-lived Git branch for a specific Version (e.g., `release/2026.8`) that receives cherry-picked bug fixes
- **Build_Pipeline**: The GitHub Actions workflow that compiles, tests, and packages the Platform into deployment artifacts
- **Artifact**: A versioned, deployable package containing compiled backend code, built frontend assets, migration files, and metadata
- **Version_Manifest**: A JSON document listing all available Versions and Patches with their metadata
- **Update_Manager**: The backend service responsible for checking for updates, downloading Artifacts, and orchestrating the update process
- **Update_Scheduler**: A scheduled job that checks for and applies Patches or Upgrades at a configured time
- **Migration**: An ordered, idempotent SQL script that modifies the database schema, tracked in the migrations table
- **Rollback**: The process of reverting the Platform to a previous Artifact after a failed update
- **Backup_Snapshot**: A point-in-time copy of the database and configuration taken before an update
- **Super_Admin**: A user with the super administrator role who manages Platform-wide settings
- **Tenant**: An isolated customer business using the Platform
- **Health_Check**: An automated verification that Platform services are responding correctly after an update

## Requirements

### Requirement 1: GitHub Actions Build Pipeline

**User Story:** As a developer, I want code pushed to the repository to be automatically built and tested by GitHub Actions, so that deployment artifacts are consistently produced without manual intervention.

#### Acceptance Criteria

1. THE system SHALL define GitHub Actions workflows in `.github/workflows/` that configure all build pipelines
2. THE Build_Pipeline SHALL run on every push to `main` and to any `release/*` branch
3. THE Build_Pipeline SHALL run on pull requests targeting `main` or any `release/*` branch
4. THE Build_Pipeline SHALL run the full test suite (unit tests, integration tests, linting) before producing an Artifact
5. IF any test or lint check fails, THEN THE Build_Pipeline SHALL abort the build and mark the workflow as failed
6. THE Build_Pipeline SHALL compile the backend TypeScript code and produce a production-ready Node.js bundle
7. THE Build_Pipeline SHALL build the frontend React application using Vite and produce optimized static assets
8. THE Build_Pipeline SHALL generate a build metadata file containing version, Git commit SHA, branch, build number, timestamp, and artifact checksums
9. THE Build_Pipeline SHALL upload build artifacts to GitHub Actions artifact storage
10. THE Build_Pipeline SHALL support a manual trigger for production deployment from tagged version workflows

### Requirement 2: Calendar-Based Versioning Scheme

**User Story:** As a product manager, I want a clear versioning format that communicates when a release was created and whether it is a feature release or a patch, so that customers and support can easily identify what version an instance is running.

#### Acceptance Criteria

1. THE system SHALL use the versioning format `YYYY.M.YYYYMMDD` where `YYYY.M` identifies the monthly Version and `YYYYMMDD` identifies the patch date
2. A base monthly Version release SHALL use `0` as the patch segment (e.g., `2026.8.0`)
3. A Patch build SHALL use the build date as the patch segment (e.g., `2026.8.20260815`)
4. THE Build_Pipeline SHALL derive the version automatically from the branch name and build date: `release/YYYY.M` branches produce `YYYY.M.0` for the initial tag and `YYYY.M.YYYYMMDD` for subsequent patch builds
5. THE system SHALL maintain up to 12 active Release_Branches at any time, corresponding to a rolling 12-month window
6. WHEN a 13th monthly Version is created, THE system SHALL archive (stop building) the oldest Release_Branch
7. Patches SHALL contain only bug fixes; new features SHALL only be introduced in new monthly Versions built from `main`

### Requirement 3: Multi-Version Release Branch Management

**User Story:** As a developer, I want each monthly version to have its own long-lived release branch, so that bug fixes can be cherry-picked to any supported version independently.

#### Acceptance Criteria

1. THE system SHALL create a new `release/YYYY.M` branch from `main` at the start of each monthly release cycle
2. THE Build_Pipeline SHALL run on every push to any `release/*` branch, producing a Patch Artifact
3. Bug fixes SHALL be cherry-picked from `main` into the relevant `release/*` branches
4. Each Release_Branch SHALL have its own pipeline configuration that tags Artifacts with the correct `YYYY.M.YYYYMMDD` version
5. THE system SHALL support building and deploying any of the 12 active Release_Branches independently
6. Multiple DayStream instances SHALL be able to run different Versions simultaneously, each pulling Artifacts from their respective Release_Branch

### Requirement 4: Artifact Storage and Version Manifest

**User Story:** As a Super_Admin, I want a centralized registry of all available versions and patches, so that I can see what updates are available for my instance.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL publish built Artifacts upon successful build completion
2. THE system SHALL maintain a Version_Manifest as a JSON document listing all available Versions and Patches
3. THE Version_Manifest SHALL include for each entry: version string, release date, changelog summary, migration requirements, minimum compatible upgrade-from version, and artifact checksums
4. THE Version_Manifest SHALL distinguish between Version upgrades (new monthly releases) and Patches (bug fixes for the current Version)
5. WHEN a new Artifact is published, THE Build_Pipeline SHALL append the entry to the Version_Manifest atomically
6. THE Version_Manifest SHALL include a checksum for integrity verification
7. THE Update_Manager SHALL fetch the latest Version_Manifest when checking for updates

### Requirement 5: Platform Admin Updates Interface

**User Story:** As a Super_Admin, I want an "Updates" section in the platform administration area, so that I can view and manage platform updates from within the application.

#### Acceptance Criteria

1. THE Platform SHALL provide an "Updates" section in the Super Admin area
2. THE Updates section SHALL display the currently installed Platform version
3. THE Updates section SHALL display available Patches for the currently installed Version
4. THE Updates section SHALL display available Version upgrades (newer monthly releases)
5. THE Updates section SHALL display the changelog and migration summary for each available update
6. THE Updates section SHALL indicate compatibility status for each available update
7. THE Updates section SHALL provide a "Check for Updates" action that refreshes the Version_Manifest
8. THE Updates section SHALL display the history of previously applied updates with timestamps and outcomes

### Requirement 6: Manual Update Installation

**User Story:** As a Super_Admin, I want to click "Install Now" for a patch or version upgrade and have the system apply it fully without manual steps, so that updates are fast and error-free.

#### Acceptance Criteria

1. THE Updates section SHALL provide an "Install Now" button for each compatible Patch and Version upgrade
2. WHEN the Super_Admin clicks "Install Now", THE Update_Manager SHALL initiate the full update sequence
3. THE Update_Manager SHALL create a Backup_Snapshot of the database and current application configuration before applying any changes
4. THE Update_Manager SHALL download and verify the Artifact checksum before proceeding with installation
5. THE Update_Manager SHALL place the Platform into maintenance mode, displaying a maintenance page to all users
6. THE Update_Manager SHALL apply all pending database Migrations in sequential order
7. THE Update_Manager SHALL deploy the new application code
8. THE Update_Manager SHALL run Health_Checks to verify all services are responding correctly after the update
9. WHEN all Health_Checks pass, THE Update_Manager SHALL exit maintenance mode and resume normal operations
10. THE Update_Manager SHALL log every step of the update process with timestamps and outcomes
11. IF any step of the update fails, THEN THE Update_Manager SHALL initiate an automatic Rollback

### Requirement 7: Scheduled Updates

**User Story:** As a Super_Admin, I want to schedule a one-time upgrade or configure recurring patch checks, so that updates are applied during low-usage windows without manual intervention.

#### Acceptance Criteria

1. THE Updates section SHALL provide a scheduling interface for configuring updates
2. THE scheduling interface SHALL support scheduling a one-time upgrade at a specific date and time
3. THE scheduling interface SHALL support scheduling recurring patch checks (e.g., weekly on Wednesday at 2 AM)
4. WHEN a recurring patch check finds an available Patch, THE Update_Scheduler SHALL auto-apply it using the same process as manual installation
5. THE Update_Scheduler SHALL display a human-readable description of the configured schedule
6. THE Update_Scheduler SHALL support enabling and disabling the schedule
7. THE Update_Scheduler SHALL send a notification to configured Super_Admin users before starting a scheduled update
8. THE Update_Scheduler SHALL send a notification after a scheduled update completes with the outcome

### Requirement 8: Database Migration Handling During Updates

**User Story:** As a developer, I want database migrations to be applied automatically and safely during updates, so that schema changes are tracked and reversible.

#### Acceptance Criteria

1. THE Update_Manager SHALL discover all pending Migrations included in the Artifact
2. THE Update_Manager SHALL apply Migrations in sequential order based on their numeric prefix
3. THE Update_Manager SHALL execute each Migration within a database transaction
4. THE Update_Manager SHALL record each applied Migration in the migrations tracking table with a timestamp
5. THE Update_Manager SHALL skip Migrations that have already been applied
6. THE Update_Manager SHALL apply Migrations to the platform schema and to each Tenant's data as required
7. IF a Migration fails, THEN THE Update_Manager SHALL halt the update and report which Migration failed
8. THE Update_Manager SHALL validate that all Migration files included in the Artifact are present and uncorrupted before applying any changes

### Requirement 9: Rollback and Recovery

**User Story:** As a Super_Admin, I want the system to automatically roll back a failed update, so that the platform returns to a working state without data loss.

#### Acceptance Criteria

1. THE Update_Manager SHALL create a Backup_Snapshot before every update that includes the database state and the current Artifact version identifier
2. THE Backup_Snapshot SHALL be retained until the next successful update replaces it
3. IF the update process fails at any step, THEN THE Update_Manager SHALL restore the database from the Backup_Snapshot
4. IF the update process fails at any step, THEN THE Update_Manager SHALL redeploy the previous application code
5. THE Update_Manager SHALL verify service health after a Rollback using the same Health_Checks as a normal update
6. THE Update_Manager SHALL log all Rollback actions with timestamps and reasons
7. THE Updates section SHALL provide a manual "Rollback to Previous Version" button for the Super_Admin
8. IF an automatic Rollback fails, THEN THE Update_Manager SHALL send an urgent notification to all Super_Admin users with diagnostic details

### Requirement 10: Health Checks and Verification

**User Story:** As a Super_Admin, I want the system to verify that an update was successful before resuming normal operations, so that users are not impacted by a broken deployment.

#### Acceptance Criteria

1. THE Update_Manager SHALL execute Health_Checks after every update and Rollback
2. THE Health_Check SHALL verify the backend API responds on `GET /api/health` with HTTP 200
3. THE Health_Check SHALL verify the frontend application is accessible
4. THE Health_Check SHALL verify database connectivity and query execution
5. THE Health_Check SHALL verify that the reported application version matches the expected version
6. IF any Health_Check fails within 3 retry attempts, THEN THE Update_Manager SHALL mark the update as failed and initiate a Rollback
7. THE Update_Manager SHALL record Health_Check results as part of the update history

### Requirement 11: Update Notifications and Audit Trail

**User Story:** As a Super_Admin, I want to be notified about update events and have a complete audit trail, so that I can track what changed and when.

#### Acceptance Criteria

1. THE Platform SHALL log all update-related events in an audit trail accessible from the Updates section
2. THE audit trail SHALL record: event type, timestamp, initiating user or schedule, version, outcome, and duration
3. WHEN a new Patch or Version becomes available, THE Platform SHALL display a notification indicator in the Super Admin navigation
4. WHEN an update starts, THE Platform SHALL send a notification to all Super_Admin users
5. WHEN an update completes or fails, THE Platform SHALL send a notification with the outcome summary
6. THE audit trail SHALL be retained for at least 1 year

### Requirement 12: Code Quality Gates

**User Story:** As a developer, I want automated quality checks to run on every pull request, so that code standards are enforced consistently.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL run ESLint on all TypeScript files and fail if errors are found
2. THE Build_Pipeline SHALL run TypeScript type-checking in strict mode and fail if type errors exist
3. THE Build_Pipeline SHALL run the full Vitest test suite and fail if any test fails
4. THE Build_Pipeline SHALL report test coverage and fail if coverage drops below a configured threshold
5. THE Build_Pipeline SHALL run on pull requests and report status checks that block merging on failure
6. THE Build_Pipeline SHALL complete within a reasonable time (target: under 10 minutes)

---

## Dependencies

- Phase 00: Infrastructure - Monorepo structure, test configuration, database migrations
- Phase 02: Security & Compliance - Authentication, role-based access for Super Admin
- Phase 03: Core Platform - Multi-tenant architecture, tenant data isolation

## Success Criteria

- GitHub Actions builds and tests code on every push to `main` and `release/*` branches
- Pull requests cannot be merged if tests, lint, or type-checks fail
- Versioned artifacts are produced with correct calendar-based version strings
- Super Admin users can view available patches and version upgrades
- Manual "Install Now" executes the full update sequence including migrations and health checks
- Scheduled updates execute at the configured time
- Failed updates trigger automatic rollback to the previous working state
- Multiple instances can run different versions simultaneously

## Out of Scope

- Blue-green or canary deployment strategies - Future enhancement
- Zero-downtime deployments - Updates use a maintenance window
- Per-tenant version pinning or staggered rollouts - All tenants in an instance update together
- Automatic version bumping from commit messages - Version derived from branch name and build date
- AWS-specific deployment (ECS, ECR) - Tracked in MIGRATION_TRACKER.md for later
- Docker containerization - Will be added when AWS deployment is implemented

## Notes

- The repository `BAD-SW/daystream` on GitHub has no workflows configured
- Current deployment is local development only; CI/CD establishes the foundation for future production deployment
- The migration system from Phase 00 (sequential numbered SQL files with tracking table) is reused by the Update_Manager
- AWS deployment details (ECS, ECR, S3 for manifests) will be added to MIGRATION_TRACKER.md when the time comes
- Initial implementation may use local artifact storage until AWS S3 is available

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03
**Next Phase**: Phase 02 (Security & Compliance)
