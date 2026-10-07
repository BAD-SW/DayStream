# Phase 39: Security Profiles

**Status**: 📋 Planned
**Dependencies**: Phase 03 (Core Platform), Phase 12 (Staff Management)

---

## Documents

- **[requirements.md](./requirements.md)** - Role and permission model, assignment, and enforcement
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

Security Profiles defines how roles and permissions are modeled, assigned, and enforced across the platform. Today permissions are partly derived from hardcoded role names on the client, which has produced drift between what the UI shows and what the API allows. This phase establishes a single source of truth for permissions (carried on the authenticated session) and a consistent enforcement model on both server and client.

**Core Features**:
- Centralized role and permission definitions
- Permissions sourced from the JWT/session rather than re-derived from role names
- Consistent server-side authorization and client-side nav/visibility
- Configurable security profiles per persona (system, tenant, business, customer)
- Auditable permission changes

---

**Last Updated**: October 7, 2026
