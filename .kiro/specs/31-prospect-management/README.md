# Phase 31: Prospect Management

**Status**: 📋 Planned
**Dependencies**: Phase 03 (Core Platform)
**Estimated Duration**: 3-4 weeks

---

## Documents

- **[requirements.md](./requirements.md)** - Territory assignment, prospect generation, list management
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

Prospect Management enables tenant managers to discover and track potential businesses in their assigned territory. System administrators define territories (location + radius + categories), and tenant managers generate prospect lists by querying Google Places API. The system handles deduplication on refresh, status tracking, and CSV export.

**Core Features**:
- Territory assignment by system admins (location, radius, business categories)
- One-click prospect generation for tenant managers (Google Places API)
- Prospect list curation (status tracking, notes, dismiss, manual add)
- Refresh with deduplication and inactive marking
- Coverage map for system admins
- CSV export for external marketing tools

---

**Last Updated**: August 10, 2026
