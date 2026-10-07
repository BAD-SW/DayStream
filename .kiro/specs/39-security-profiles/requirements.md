# Phase 39: Security Profiles - Requirements

## Overview

Establish a single, authoritative model for roles and permissions, and ensure server authorization and client visibility both derive from it. Replace the current client-side role-to-permission derivation, which has caused UI/permission drift.

## Goals

- Define a clear role and permission model usable across all personas
- Make the authenticated session the source of truth for a user's permissions
- Enforce authorization consistently on the server and reflect it accurately in the client
- Allow security profiles to be configured and audited

## Requirements

> 📋 To be defined. Capture requirements here using the `THE system SHALL` format once the extent of this phase is verified.

---

## Dependencies

- Phase 03: Core Platform - authentication, JWT, tenant context
- Phase 12: Staff Management - staff roles and account linking

## Success Criteria

- To be defined

## Out of Scope

- To be defined

## Notes

- Prompted by observed drift: the client previously re-derived permissions from hardcoded role names, so job-title roles (e.g. reception, therapist, trainer) and unknown roles could see modules the API would deny. The direction is to source permissions from the session instead.

---

**Status**: 📋 Planned
**Dependencies**: Phase 03, Phase 12
**Next Phase**: TBD
