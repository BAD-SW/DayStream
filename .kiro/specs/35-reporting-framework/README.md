# Phase 35: Reporting Framework

**Status**: 📋 Planned
**Dependencies**: Phase 10 (Payment Platform), Phase 17 (Reporting & Analytics), Phase 28 (Products & Services)
**Estimated Duration**: 1-2 weeks

---

## Documents

- **[requirements.md](./requirements.md)** - Report catalog, report runner, filtering, and export requirements
- **[design.md](./design.md)** - Report contract, generic run/export endpoints, catalog and runner UI
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

The current Reports page is a dashboard of KPI tiles plus navigation cards that render whatever a service returns as generic rows. Business owners need full, detailed reports they can run over a date range of their choosing, view on screen in a filterable table, and save as PDF or CSV.

This phase replaces the "dashboard with drill-in tiles" model with a **report catalog**: a grouped, dashboard-style landing page where each category holds named report tiles. Selecting a report opens a runner that executes it over a chosen date range and renders the results in a table with per-column filtering, sorting, and totals. Every report is defined once via a shared contract (columns + a SQL runner), so adding new reports is a query and a catalog entry, not new UI.

**Core Features**:
- Grouped report catalog mirroring the dashboard tile-group layout
- Generic report runner with date-range selection, per-column filtering, sorting, and totals
- CSV and PDF export driven by the same report definition
- Reference report: unified Revenue (services + products) proving the framework end to end

---

**Last Updated**: July 6, 2026
