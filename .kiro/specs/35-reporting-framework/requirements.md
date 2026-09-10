# Phase 35: Reporting Framework - Requirements

## Overview

Business owners need detailed, on-demand reports that analyze their business, not just headline KPI numbers. This phase delivers a reporting framework: a catalog of named reports grouped by domain, each runnable over a user-chosen date range, rendered as a filterable on-screen table, and exportable to PDF or CSV. The framework establishes a single report contract so that all reports share one runner, one filtering/sorting experience, and one export pipeline. A unified Revenue report (services and products) is delivered as the reference implementation.

## Goals

- Replace the KPI-tile-plus-cards Reports page with a grouped report catalog
- Provide one generic report runner that renders any report defined via the shared contract
- Support user-selected date ranges, per-column filtering, sorting, and column totals on screen
- Support saving any report's results as PDF or CSV
- Deliver a unified Revenue report (services + products) as the reference report
- Make adding a new report a matter of one server-side definition plus one catalog entry

## Requirements

### Report Catalog

#### Requirement 1: Grouped Report Catalog

**User Story**: As a business owner, I want reports organized into categories with report tiles, so that I can find the report I need the way I navigate my dashboard.

##### Acceptance Criteria

1. THE system SHALL display the Reports landing page as categories, each containing report tiles, mirroring the dashboard tile-group layout.
2. THE system SHALL define the catalog (categories and their reports) as configuration data, not hardcoded layout.
3. THE system SHALL render each report tile with an icon, title, and short description.
4. THE system SHALL navigate to the report runner for the selected report when a tile is activated.
5. THE system SHALL only display report tiles the current user has permission to view.
6. THE system SHALL NOT display report tiles that navigate to routes with no backing report definition.

#### Requirement 2: Report Runner

**User Story**: As a business owner, I want to run a report over a date range I choose and see the results on screen, so that I can analyze any period I care about.

##### Acceptance Criteria

1. THE system SHALL provide a report runner view for a selected report that shows the report title and description.
2. THE system SHALL provide a date-range selector with presets and a custom From/To range.
3. THE system SHALL run the report for the active business and selected date range and render the returned rows in a table.
4. THE system SHALL default to a sensible date range (last 30 days) when none is selected.
5. THE system SHALL require an active business context and SHALL NOT run a business-scoped report without a `business_id`.
6. THE system SHALL show a loading state while the report runs and an empty-state message when a run returns no rows.

### Data Table

#### Requirement 3: On-Screen Filtering and Sorting

**User Story**: As a business owner, I want to filter and sort the report table by column, so that I can narrow the results to what matters without re-running the report.

##### Acceptance Criteria

1. THE system SHALL render report results in a table whose columns come from the report definition.
2. THE system SHALL provide a per-column filter input for filterable columns.
3. THE system SHALL filter rows on screen as filter values change, without a server round trip.
4. THE system SHALL allow sorting by any sortable column.
5. THE system SHALL format each column according to its declared type (text, number, currency, date, percent).
6. THE system SHALL display currency values from integer minor units (cents) as formatted currency.
7. THE system SHALL display totals for numeric and currency columns, reflecting the currently filtered rows.

### Export

#### Requirement 4: CSV Export

**User Story**: As a business owner, I want to save a report as CSV, so that I can work with the data in a spreadsheet.

##### Acceptance Criteria

1. THE system SHALL provide a Save as CSV action on the report runner.
2. THE system SHALL export the report's columns as headers and its rows as records for the selected date range.
3. THE system SHALL format currency and date values in the export consistently with the report definition.
4. THE system SHALL name the downloaded file using the report name and date range.

#### Requirement 5: PDF Export

**User Story**: As a business owner, I want to save a report as PDF, so that I can print or archive a clean copy.

##### Acceptance Criteria

1. THE system SHALL provide a Save as PDF action on the report runner.
2. THE system SHALL generate the PDF server-side as a table-oriented document.
3. THE system SHALL include the report title, business name, selected date range, and generation timestamp in the PDF.
4. THE system SHALL render the report columns and rows as a table in the PDF, with column totals where applicable.
5. THE system SHALL name the downloaded file using the report name and date range.

### Report Contract

#### Requirement 6: Shared Report Definition

**User Story**: As a developer, I want every report defined by one contract, so that adding a report does not require new UI or new endpoints.

##### Acceptance Criteria

1. THE system SHALL define each report by an identifier, category, title, description, icon, a column list, and a query runner.
2. THE system SHALL declare each column with a key, header, type, alignment, and whether it is filterable and/or totaled.
3. THE system SHALL run every report through one generic run endpoint keyed by report identifier.
4. THE system SHALL export every report through one generic export endpoint keyed by report identifier and format.
5. THE system SHALL enforce report read permission on both the run and export endpoints.
6. THE system SHALL return an error for an unknown report identifier.

### Reference Report

#### Requirement 7: Unified Revenue Report

**User Story**: As a business owner, I want a single revenue report covering both services and products, so that I can see all my revenue for a period in one place.

##### Acceptance Criteria

1. THE system SHALL provide a Revenue report that includes both service and product revenue.
2. THE system SHALL source revenue from completed orders and their line items within the selected date range.
3. THE system SHALL include a revenue-type column (service, product, membership, package) that is filterable.
4. THE system SHALL include, per line, the item name, revenue type, quantity, unit price, discount, tax, and line total.
5. THE system SHALL show a grand total and totals per revenue type reflecting the filtered rows.
6. THE system SHALL scope the report to the active business and enforce tenant isolation.

---

## Dependencies

- Phase 10 (Payment Platform): payment and order data that revenue reporting reads
- Phase 17 (Reporting & Analytics): existing report routes, services, and the `rpt_*` tables
- Phase 28 (Products & Services): `fin_orders` / `fin_order_items` unified order model that revenue reporting reads

## Success Criteria

- The Reports landing page shows grouped categories with report tiles and no dead links
- A report can be run over any chosen date range and its results shown in a filterable, sortable table with totals
- Any report can be saved as both CSV and PDF
- The Revenue report shows combined service and product revenue with per-type and grand totals
- A second report can be added by writing one server definition and one catalog entry, with no runner or export changes

## Out of Scope

- Forecast / projection reports - deferred to a later phase; they project forward and need separate design
- Scheduled report delivery (email) - the existing scheduled-reports feature is unchanged by this phase
- Server-side pagination of very large result sets - client-side filtering/sorting is sufficient for single-business date-ranged reports
- Dashboard KPI tile aggregation job wiring - tracked separately from this framework

## Notes

- Reuse existing design-system building blocks: `Table` (supports `clientSort` and a `filterRow` slot), `DateRangeFilter`, and the dashboard grouping components (`DashboardGroup`, `GroupedSortableTileGrid`, `dashboardGroups.ts`).
- Monetary values are stored as integer cents; formatting to currency happens at render/export via column type.
- All new UI must use the design system and CSS variables, not Tailwind.
- The report runner must read `business_id` from the context manager, not `localStorage`.

---

**Status**: 📋 Planned
**Dependencies**: Phase 10, Phase 17, Phase 28
**Next Phase**: TBD
