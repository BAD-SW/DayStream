# Migration Tracker: Local Development → AWS

This document tracks all workarounds, local substitutions, and temporary implementations used during development that will need to change when migrating to AWS.

## How to Use This Document

When you implement something locally that you know won't be the final production approach, add an entry below. Each entry should capture:
- What the workaround is
- Why it exists (what AWS service it substitutes for)
- What the target AWS solution is
- Any notes on migration complexity

---

## Status Legend

- 🔲 Not yet migrated
- 🚧 Migration in progress
- ✅ Migrated to AWS
- ⚠️ Blocked (dependency or decision needed)

---

## Workarounds & Local Substitutions

### Database

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Authentication

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Storage (Files, Images)

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Email / Messaging

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Caching

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Search

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Networking / DNS

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Monitoring / Logging

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### CI/CD & Deployment

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Other

| # | Local Approach | AWS Target | Phase | Status | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

## Migration Checklist (Pre-Migration)

Before starting the AWS migration, confirm:

- [ ] All entries in this document have an identified AWS target
- [ ] AWS account and IAM structure is set up
- [ ] VPC and networking design is finalized
- [ ] Data migration strategy is defined (database, files, etc.)
- [ ] DNS cutover plan is documented
- [ ] Rollback plan exists for each migration step
- [ ] Performance benchmarks from local are documented for comparison

---

## Migration Log

Record completed migrations here with date and any issues encountered.

| Date | Item | Migrated By | Issues / Notes |
|---|---|---|---|
| | | | |
