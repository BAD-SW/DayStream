# Phase 01: CI/CD Pipeline and Version Management - Tasks

## Overview

Implementation tasks for establishing the GitHub Actions CI/CD pipeline, versioning system, update manager, and admin interface. This phase is deferred from immediate execution — tasks are defined for when deployment automation is needed.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Versioning System

### 1.1 Version File
- [ ] Create `version.json` at repository root (major, patch, version, buildDate, commitSha)
- [ ] Initialize at version 1.0
- [ ] Create `packages/server/src/utils/version.ts` (parse version file, numeric comparison)
- [ ] Implement `parseVersion()` function (string → {major, patch})
- [ ] Implement `isNewer()` function (numeric comparison, not lexicographic)
- [ ] Write unit tests for version comparison edge cases (10.1 > 9.52, 2.12 > 2.9)

### 1.2 Version API Endpoint
- [ ] Create `GET /api/v1/admin/updates/current` endpoint
- [ ] Return current version from `version.json` or `platform_version` table
- [ ] Include uptime, build date, and commit SHA in response

---

## 2. GitHub Actions Workflows

### 2.1 CI Workflow
- [ ] Create `.github/workflows/ci.yml`
- [ ] Configure trigger on push to all branches and pull requests
- [ ] Add lint job (ESLint across all packages)
- [ ] Add type-check job (tsc --noEmit across all packages)
- [ ] Add test job (vitest across all packages)
- [ ] Add coverage reporting
- [ ] Configure coverage threshold (fail if below configured minimum)
- [ ] Verify workflow completes under 10 minutes

### 2.2 Build Workflow
- [ ] Create `.github/workflows/build.yml`
- [ ] Configure trigger on push to `main` and `release/*` branches
- [ ] Add server build step (tsc → dist/)
- [ ] Add client build step (vite build → dist/)
- [ ] Add build metadata generation (version, sha, timestamp)
- [ ] Package artifact (zip: server dist + client dist + migrations + metadata)
- [ ] Upload artifact to GitHub Actions artifact storage
- [ ] Generate checksums for artifact files

### 2.3 Release Workflow
- [ ] Create `.github/workflows/release.yml`
- [ ] Configure manual dispatch with input (release_type: major | patch)
- [ ] Implement version increment logic (major: N+1.0, patch: N.X+1)
- [ ] Update version.json
- [ ] Create git tag (vN.X)
- [ ] Trigger build workflow
- [ ] Update Version Manifest

---

## 3. Version Manifest

### 3.1 Manifest Structure
- [ ] Define manifest JSON schema
- [ ] Create initial empty manifest file
- [ ] Implement manifest update logic in build pipeline
- [ ] Include: version, releaseDate, changelog, hasMigrations, minUpgradeFrom, checksums

### 3.2 Manifest API
- [ ] Create `GET /api/v1/admin/updates/available` endpoint
- [ ] Fetch and parse manifest
- [ ] Filter available patches (same major, higher patch)
- [ ] Filter available upgrades (higher major, minUpgradeFrom satisfied)
- [ ] Return filtered results with compatibility status

---

## 4. Database Schema for Updates

### 4.1 Migration
- [ ] Create migration for `platform_version` table (single-row, current version)
- [ ] Create migration for `platform_updates` table (update history)
- [ ] Create migration for `update_schedule` table (scheduling config)
- [ ] Seed initial platform_version row (1.0)

---

## 5. Update Manager Service

### 5.1 Core Service
- [ ] Create `packages/server/src/services/update-manager/index.ts`
- [ ] Implement version check (fetch manifest, compare numeric versions)
- [ ] Implement artifact download with checksum verification
- [ ] Implement maintenance mode (set flag, return 503 for non-admin requests)

### 5.2 Backup Manager
- [ ] Create `backup-manager.ts`
- [ ] Implement database backup (pg_dump to local file)
- [ ] Implement version.json backup
- [ ] Implement backup restore (pg_restore)
- [ ] Implement backup cleanup (retain only most recent)

### 5.3 Migration Applier
- [ ] Create `migration-applier.ts`
- [ ] Discover pending migrations from artifact
- [ ] Apply migrations in transaction
- [ ] Record applied migrations in tracking table
- [ ] Halt and report on failure

### 5.4 Health Checker
- [ ] Create `health-checker.ts`
- [ ] Implement API health check (GET /api/health → 200)
- [ ] Implement database connectivity check
- [ ] Implement version verification (numeric match)
- [ ] Implement frontend accessibility check
- [ ] Implement retry logic (3 attempts, 10s delay)

### 5.5 Update Orchestrator
- [ ] Implement full update sequence (verify → backup → download → maintenance → migrate → deploy → health check → exit maintenance)
- [ ] Implement automatic rollback on failure
- [ ] Log all steps with timestamps and outcomes
- [ ] Prevent downgrade (numeric version comparison)
- [ ] Write integration tests for update sequence

---

## 6. Rollback System

### 6.1 Rollback Implementation
- [ ] Implement automatic rollback trigger (on health check failure)
- [ ] Implement manual rollback endpoint (`POST /api/v1/admin/updates/rollback`)
- [ ] Restore database from backup
- [ ] Restore previous application code
- [ ] Restore previous version.json
- [ ] Run health checks after rollback
- [ ] Send urgent alert if rollback fails

---

## 7. Scheduled Updates

### 7.1 Schedule Configuration
- [ ] Create `GET /api/v1/admin/updates/schedule` endpoint
- [ ] Create `PUT /api/v1/admin/updates/schedule` endpoint
- [ ] Support one-time schedule (date/time)
- [ ] Support recurring schedule (cron expression)
- [ ] Support enabling/disabling schedule
- [ ] Store schedule config in `update_schedule` table

### 7.2 Scheduler Service
- [ ] Create `update-scheduler.ts`
- [ ] Implement cron-based schedule evaluation
- [ ] Auto-check for available patches on schedule
- [ ] Auto-apply patches if configured
- [ ] Send pre-update notification (configurable minutes before)
- [ ] Send post-update notification with outcome

---

## 8. Admin Updates Interface (API)

### 8.1 Endpoints
- [ ] `GET /api/v1/admin/updates/current` — current version info
- [ ] `GET /api/v1/admin/updates/available` — available updates from manifest
- [ ] `POST /api/v1/admin/updates/install` — trigger installation of specific version
- [ ] `POST /api/v1/admin/updates/rollback` — trigger manual rollback
- [ ] `GET /api/v1/admin/updates/history` — paginated update history
- [ ] `GET /api/v1/admin/updates/schedule` — current schedule config
- [ ] `PUT /api/v1/admin/updates/schedule` — update schedule config

### 8.2 Authorization
- [ ] Restrict all update endpoints to Super_Admin role
- [ ] Log all update actions in audit trail

---

## 9. Notifications

### 9.1 Update Notifications
- [ ] Notify Super_Admins when new patch/version is available (in-app indicator)
- [ ] Notify before scheduled update starts
- [ ] Notify on update success
- [ ] Notify on update failure
- [ ] Notify urgently on rollback failure

---

## 10. Testing

### 10.1 Unit Tests
- [ ] Test version parsing and comparison (edge cases: 10.1 > 9.52, 2.12 > 2.9)
- [ ] Test manifest filtering logic
- [ ] Test health check retry logic
- [ ] Test backup/restore logic (mocked)

### 10.2 Integration Tests
- [ ] Test full update sequence (happy path)
- [ ] Test update with failed health check → rollback
- [ ] Test downgrade prevention
- [ ] Test maintenance mode (non-admin gets 503)
- [ ] Test scheduled update execution

---

## 11. Documentation

### 11.1 Developer Guide
- [ ] Document branching workflow (main → release/N)
- [ ] Document how to create a new quarterly release
- [ ] Document how to cherry-pick a bug fix to release branch
- [ ] Document version bumping process
- [ ] Update README with CI/CD information
