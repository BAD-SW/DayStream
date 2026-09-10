# Phase 35: Reporting Framework - Tasks

## Overview

Tasks are ordered to build the framework once, prove it with the Revenue report end to end, then leave a clear path to replicate. Backend contract and endpoints come first, then the reference report, then export, then the client catalog and runner, then verification.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Shared Contract

### 1.1 Report types
- [ ] Add report column and result types to `packages/shared/src/reports/types.ts`
- [ ] Export report types from `packages/shared/src/index.ts`

## 2. Backend Framework

### 2.1 Report definition and registry
- [ ] Create server-side `ReportDefinition` / `ReportContext` types
- [ ] Create the report registry with lookup by id
- [ ] Add a shared server-side value formatter keyed by column type

### 2.2 Run endpoint
- [ ] Add `GET /v1/reports/run/:reportId` to `routes/reports.ts`
- [ ] Resolve definition, 404 on unknown id
- [ ] Require `x-business-id`, 400 when missing
- [ ] Run the definition, compute server-side totals, return `ReportRunResult` with meta (title, business name, date range, currency, generatedAt)
- [ ] Enforce `reports:read` permission

## 3. Reference Report: Revenue

### 3.1 Definition
- [ ] Create `revenue.report.ts` with columns and the completed-order line-item query
- [ ] Use `appPool` and confirm tenant isolation via RLS
- [ ] Register the revenue report in the registry

## 4. Export

### 4.1 Export service
- [ ] Add PDFKit dependency to `packages/server` (pinned version)
- [ ] Implement CSV serialization from a `ReportRunResult`
- [ ] Implement table-oriented PDF generation (title, business, date range, timestamp, table, totals, page numbers)

### 4.2 Export endpoint
- [ ] Add `GET /v1/reports/run/:reportId/export` with `format=csv|pdf`
- [ ] Set correct content type and attachment filename per format
- [ ] Enforce `reports:read` permission; 400 on unsupported format

## 5. Frontend Framework

### 5.1 Catalog config and page
- [ ] Create `reportCatalog.ts` (categories + report entries), mirroring `dashboardGroups.ts`
- [ ] Rewrite `Reports.tsx` as the grouped catalog using the design system (no Tailwind)
- [ ] Filter tiles by permission; remove dead cards (resources, marketing) with no definition
- [ ] Navigate to `/reports/run/:reportId` on tile activation

### 5.2 API functions
- [ ] Add `runReport` and `exportReport` (blob) to `api/reports.ts`

### 5.3 Report runner
- [ ] Create `ReportRunner.tsx` at route `/reports/run/:reportId`
- [ ] Read active business from context manager (not localStorage)
- [ ] Add `DateRangeFilter` (default last 30 days), Run, Save as CSV, Save as PDF
- [ ] Render results in `Table` with per-column type formatting and `clientSort`
- [ ] Populate the `filterRow` slot with per-filterable-column inputs and filter rows client-side
- [ ] Render a totals row from currently filtered rows for `total:true` columns
- [ ] Wire export buttons to download CSV/PDF for the selected date range

### 5.4 Routing
- [ ] Add `/reports/run/:reportId` route in `App.tsx` under the Reports section
- [ ] Remove or redirect obsolete per-domain `/reports/:type` routes that are superseded

## 6. Client Formatting
- [ ] Add a client value formatter keyed by column type (shared logic with table render and CSV)
- [ ] Format currency using report currency from meta (cents → currency)

## 7. Verification
- [ ] Type-check client and server (`npx tsc --noEmit`)
- [ ] Run the Revenue report for a date range and confirm rows, formatting, filtering, sorting, and totals on screen
- [ ] Confirm CSV export opens correctly with formatted values and a totals row
- [ ] Confirm PDF export produces a table-oriented document with header, totals, and page numbers
- [ ] Confirm an unknown report id returns 404 and a missing business returns 400
- [ ] Confirm currency renders per business currency (USD vs EUR)

## 8. Replication Path (future reports, not this phase)
- [ ] Document the three-step add-a-report process in the design (done) and confirm a second report can be added with no runner/endpoint changes
