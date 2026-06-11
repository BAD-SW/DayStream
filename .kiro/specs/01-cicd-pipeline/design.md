# Phase 01: CI/CD Pipeline and Version Management - Design Document

**Date**: June 11, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03

---

## Overview

This document describes the technical design for the DayStream CI/CD pipeline, versioning system, and update management infrastructure. The system uses GitHub Actions for automation, a simplified two-branch release model, and a Major.Patch versioning scheme with numeric comparison.

---

## Table of Contents

1. [Branching Model](#1-branching-model)
2. [Versioning System](#2-versioning-system)
3. [GitHub Actions Workflows](#3-github-actions-workflows)
4. [Artifact Packaging](#4-artifact-packaging)
5. [Version Manifest](#5-version-manifest)
6. [Update Manager Service](#6-update-manager-service)
7. [Admin Updates Interface](#7-admin-updates-interface)
8. [Rollback System](#8-rollback-system)
9. [Health Checks](#9-health-checks)

---

## 1. Branching Model

### Branch Structure

```
main                    ← All development (features + fixes)
  │
  ├── release/1         ← First quarterly release (bug fixes only)
  │     ├── v1.0       (initial release)
  │     ├── v1.1       (patch)
  │     ├── v1.2       (patch)
  │     └── v1.3       (patch)
  │
  └── release/2         ← Second quarterly release (bug fixes only)
        ├── v2.0       (initial release)
        ├── v2.1       (patch)
        └── v2.2       (patch)
```

### Workflow

1. All development happens on `main`
2. When ready for a quarterly release, create `release/N` from `main`
3. Tag `release/N` as `vN.0` (initial release)
4. Bug fixes are committed to `main` first, then cherry-picked to `release/N`
5. Each cherry-pick to `release/N` gets tagged as `vN.X` (incrementing patch)
6. When `release/N+1` is created, `release/N-1` (two versions old) is archived

### Active Branches at Any Time

| Branch | Purpose | Receives |
|---|---|---|
| `main` | Development | Features + bug fixes |
| `release/N` | Current production | Cherry-picked bug fixes only |
| `release/N-1` | Previous (transition) | Critical fixes only, archived after transition |

---

## 2. Versioning System

### Format

```
Major.Patch

Examples:
  1.0   → Release 1, initial
  1.1   → Release 1, first patch
  1.12  → Release 1, twelfth patch
  2.0   → Release 2, initial
  10.3  → Release 10, third patch
```

### Version File

A `version.json` file in the repository root tracks the current version:

```json
{
  "major": 2,
  "patch": 7,
  "version": "2.7",
  "buildDate": "2026-09-15T14:30:00Z",
  "commitSha": "abc123f"
}
```

### Numeric Comparison Logic

```typescript
interface Version {
  major: number;
  patch: number;
}

function parseVersion(versionStr: string): Version {
  const parts = versionStr.split('.');
  return {
    major: parseInt(parts[0], 10),
    patch: parseInt(parts[1], 10),
  };
}

function isNewer(candidate: Version, current: Version): boolean {
  if (candidate.major > current.major) return true;
  if (candidate.major === current.major && candidate.patch > current.patch) return true;
  return false;
}

// Examples:
// isNewer({major:10, patch:1}, {major:9, patch:52})  → true
// isNewer({major:2, patch:12}, {major:2, patch:9})   → true
// isNewer({major:1, patch:5}, {major:2, patch:0})    → false
```

### Version Bumping

- **New quarterly release:** Increment major, reset patch to 0
- **Bug fix patch:** Increment patch
- **Version is set via git tag:** `git tag v2.7` on the release branch
- **Build pipeline reads the tag** to set the artifact version

---

## 3. GitHub Actions Workflows

### Workflow Files

```
.github/workflows/
├── ci.yml              # Runs on all pushes and PRs (lint, type-check, test)
├── build.yml           # Runs on main and release/* (produces artifacts)
└── release.yml         # Manual trigger for creating a new release
```

### CI Workflow (`ci.yml`)

Triggered on: push to any branch, pull requests

```yaml
# Pseudostructure
name: CI
on: [push, pull_request]

jobs:
  lint:
    - Checkout code
    - Install dependencies
    - Run ESLint across all packages

  type-check:
    - Checkout code
    - Install dependencies
    - Run tsc --noEmit across all packages

  test:
    - Checkout code
    - Install dependencies
    - Run vitest across all packages
    - Upload coverage report
    - Fail if coverage below threshold
```

### Build Workflow (`build.yml`)

Triggered on: push to `main` or `release/*`

```yaml
# Pseudostructure
name: Build
on:
  push:
    branches: [main, 'release/*']

jobs:
  build:
    - Checkout code
    - Install dependencies
    - Run full CI checks (lint, type-check, test)
    - Build server (tsc)
    - Build client (vite build)
    - Generate build metadata (version, sha, timestamp)
    - Package artifact (zip: dist + migrations + metadata)
    - Upload artifact to GitHub Actions storage
```

### Release Workflow (`release.yml`)

Triggered on: manual dispatch

```yaml
# Pseudostructure
name: Create Release
on: workflow_dispatch
  inputs:
    release_type: [major, patch]

jobs:
  release:
    - Determine version (read current, increment based on type)
    - Update version.json
    - Create git tag
    - Build artifact
    - Publish to artifact storage
    - Update Version_Manifest
```

---

## 4. Artifact Packaging

### Artifact Structure

```
daystream-v2.7.zip
├── server/
│   └── dist/           # Compiled TypeScript
├── client/
│   └── dist/           # Vite build output
├── migrations/
│   └── *.sql           # All migration files
├── version.json        # Version metadata
└── checksums.json      # SHA-256 hashes of all files
```

### Build Metadata (`version.json`)

```json
{
  "major": 2,
  "patch": 7,
  "version": "2.7",
  "buildDate": "2026-09-15T14:30:00Z",
  "commitSha": "abc123f4567890",
  "branch": "release/2",
  "buildNumber": 142
}
```

---

## 5. Version Manifest

### Storage

During local development: JSON file served by the API or stored in the database.
Future (AWS): S3 bucket with CloudFront distribution.

### Manifest Structure

```json
{
  "lastUpdated": "2026-09-15T14:30:00Z",
  "checksum": "sha256:abcdef...",
  "releases": [
    {
      "version": "2.7",
      "major": 2,
      "patch": 7,
      "type": "patch",
      "releaseDate": "2026-09-15",
      "changelog": "Fixed booking conflict detection edge case",
      "hasMigrations": false,
      "minUpgradeFrom": "2.0",
      "artifactUrl": "artifacts/daystream-v2.7.zip",
      "artifactChecksum": "sha256:123abc..."
    },
    {
      "version": "2.0",
      "major": 2,
      "patch": 0,
      "type": "major",
      "releaseDate": "2026-07-01",
      "changelog": "Membership engine, pricing rules, staff scheduling",
      "hasMigrations": true,
      "minUpgradeFrom": "1.0",
      "artifactUrl": "artifacts/daystream-v2.0.zip",
      "artifactChecksum": "sha256:456def..."
    }
  ]
}
```

### Version Filtering

The Update Manager filters the manifest to show:
- **Available patches:** Same major, higher patch than currently installed
- **Available upgrades:** Higher major than currently installed, where `minUpgradeFrom` is satisfied

---

## 6. Update Manager Service

### Location

```
packages/server/src/services/update-manager/
├── index.ts                # Service entry point
├── version-checker.ts      # Fetches and parses Version_Manifest
├── artifact-downloader.ts  # Downloads and verifies artifacts
├── migration-applier.ts    # Applies pending migrations
├── backup-manager.ts       # Creates and restores backups
├── health-checker.ts       # Runs post-update health checks
└── update-scheduler.ts     # Cron-based scheduled updates
```

### Update Sequence

```
1. Verify target version > current version (numeric comparison)
2. Create Backup_Snapshot (database dump + current version.json)
3. Download artifact
4. Verify artifact checksum
5. Enter maintenance mode (set flag in database, return 503 to non-admin requests)
6. Apply pending migrations (in transaction)
7. Deploy new application code (replace dist/ directories)
8. Restart application
9. Run health checks (3 retries, 10 second intervals)
10. IF health checks pass → exit maintenance mode, log success
11. IF health checks fail → initiate rollback
```

### Maintenance Mode

When in maintenance mode:
- All non-admin API requests return HTTP 503 with `{"error": "System update in progress", "retryAfter": 300}`
- Admin requests (Super Admin role) continue to function
- Frontend displays a maintenance page

---

## 7. Admin Updates Interface

### Database Tables

```sql
-- Track installed updates
CREATE TABLE platform_updates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version VARCHAR(20) NOT NULL,
    major INTEGER NOT NULL,
    patch INTEGER NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by UUID REFERENCES users(id),
    trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'auto')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'rolled_back')),
    duration_seconds INTEGER,
    changelog TEXT,
    error_details TEXT
);

-- Update schedule configuration
CREATE TABLE update_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enabled BOOLEAN NOT NULL DEFAULT false,
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('one_time', 'recurring')),
    one_time_at TIMESTAMPTZ,
    recurring_cron VARCHAR(100),
    recurring_description VARCHAR(255),
    auto_apply_patches BOOLEAN NOT NULL DEFAULT true,
    auto_apply_major BOOLEAN NOT NULL DEFAULT false,
    notify_before_minutes INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current platform version (single row)
CREATE TABLE platform_version (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    major INTEGER NOT NULL,
    patch INTEGER NOT NULL,
    version VARCHAR(20) NOT NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    commit_sha VARCHAR(40)
);
```

### API Endpoints

```
GET    /api/v1/admin/updates/current       # Current installed version
GET    /api/v1/admin/updates/available      # Check for available updates
POST   /api/v1/admin/updates/install        # Install a specific version
POST   /api/v1/admin/updates/rollback       # Rollback to previous version
GET    /api/v1/admin/updates/history        # Update history
GET    /api/v1/admin/updates/schedule       # Get schedule config
PUT    /api/v1/admin/updates/schedule       # Update schedule config
```

---

## 8. Rollback System

### Backup Strategy

Before each update:
1. `pg_dump` the database to a local file (timestamped)
2. Copy current `version.json` to `version.json.backup`
3. Store the backup path in the `platform_updates` record

### Rollback Sequence

```
1. Log rollback initiation (reason, trigger)
2. Restore database from Backup_Snapshot (pg_restore)
3. Restore previous application code (previous dist/ directories)
4. Restore previous version.json
5. Restart application
6. Run health checks
7. IF healthy → log success, exit maintenance mode
8. IF unhealthy → send urgent alert to all Super_Admins
```

### Backup Retention

- Keep the most recent backup only (replaced on each successful update)
- Failed update backups are retained until manually cleared

---

## 9. Health Checks

### Check Sequence

```typescript
interface HealthCheckResult {
  check: string;
  status: 'pass' | 'fail';
  message?: string;
  durationMs: number;
}

const healthChecks = [
  { name: 'api_responding', check: () => fetch('/api/health') },
  { name: 'database_connected', check: () => pool.query('SELECT 1') },
  { name: 'version_correct', check: () => verifyVersion(expectedVersion) },
  { name: 'frontend_accessible', check: () => fetch('/index.html') },
];

// Run all checks with 3 retries, 10 second delay between retries
// All must pass for update to be considered successful
```

### Retry Logic

- 3 attempts per health check
- 10 seconds between attempts
- All checks must pass on the same attempt
- If all 3 attempts fail → update marked as failed → rollback triggered

---

**Last Updated**: June 11, 2026
