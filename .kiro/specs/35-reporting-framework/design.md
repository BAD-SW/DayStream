# Phase 35: Reporting Framework - Design Document

**Date**: July 6, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 10, Phase 17, Phase 28

---

## Overview

This design defines a report contract shared by every report, a pair of generic server endpoints (run + export) keyed by report id, and a client catalog + runner that reuse existing design-system components. Once the contract, endpoints, runner, and one reference report (Revenue) exist, each additional report is a server-side definition plus a client catalog entry — no new UI or endpoints.

The guiding principle: **define once, replicate by data.** A report is data (columns + a SQL runner on the server, a catalog entry on the client), not code.

---

## Table of Contents

1. [Report Contract](#1-report-contract)
2. [Backend: Registry and Endpoints](#2-backend-registry-and-endpoints)
3. [Backend: Reference Report (Revenue)](#3-backend-reference-report-revenue)
4. [Backend: Export](#4-backend-export)
5. [Frontend: Catalog](#5-frontend-catalog)
6. [Frontend: Report Runner](#6-frontend-report-runner)
7. [Formatting Rules](#7-formatting-rules)
8. [Adding a New Report](#8-adding-a-new-report)
9. [Security](#9-security)

---

## 1. Report Contract

The contract is shared in `packages/shared` so client and server agree on column shape.

```ts
// packages/shared/src/reports/types.ts
export type ReportColumnType = 'text' | 'number' | 'currency' | 'date' | 'percent';
export type ReportColumnAlign = 'left' | 'right' | 'center';

export interface ReportColumn {
  key: string;                 // matches a key on each returned row
  header: string;              // column header label
  type: ReportColumnType;      // drives formatting, alignment, and totals
  filterable?: boolean;        // renders a per-column filter input
  total?: boolean;             // include a column total (number/currency only)
  align?: ReportColumnAlign;   // defaults derived from type (number/currency => right)
  width?: string;
}

export interface ReportRunResult {
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals: Record<string, number>;  // keyed by column key, for total:true columns
  meta: {
    reportId: string;
    title: string;
    businessName: string;
    dateRange: { start: string; end: string };
    generatedAt: string;         // ISO timestamp
    currency: string;            // e.g. 'USD' / 'EUR'
  };
}
```

Column `type` is the single source of truth for how a value is formatted on screen, in CSV, and in PDF — so the three renderings never drift.

---

## 2. Backend: Registry and Endpoints

### Report definition (server side)

```ts
// packages/server/src/services/reports/types.ts
import { ReportColumn } from '@daystream/shared';

export interface ReportContext {
  tenantId: string;
  businessId: string;
  start: string;   // yyyy-mm-dd
  end: string;     // yyyy-mm-dd
}

export interface ReportDefinition {
  id: string;                 // e.g. 'revenue'
  title: string;
  columns: ReportColumn[];
  run: (ctx: ReportContext) => Promise<Record<string, any>[]>;  // returns raw rows (cents, ISO dates)
}
```

### Registry

```ts
// packages/server/src/services/reports/registry.ts
import { revenueReport } from './definitions/revenue.report';

const DEFINITIONS: Record<string, ReportDefinition> = {
  [revenueReport.id]: revenueReport,
  // future: [bookingsReport.id]: bookingsReport, ...
};

export function getReportDefinition(id: string): ReportDefinition | null {
  return DEFINITIONS[id] ?? null;
}
```

### Endpoints (added to existing `routes/reports.ts`, mounted at `/v1/reports`)

- `GET /v1/reports/run/:reportId?start_date=&end_date=` (header `x-business-id`)
  - Resolves definition; 404 on unknown id.
  - Runs `definition.run(ctx)`, computes `totals` for `total:true` columns, resolves business name + currency, returns `ReportRunResult`.
  - Permission: `reports:read`.
- `GET /v1/reports/run/:reportId/export?format=csv|pdf&start_date=&end_date=` (header `x-business-id`)
  - Runs the same definition, then serializes via the export service.
  - `csv` → `text/csv` attachment; `pdf` → `application/pdf` attachment.
  - Permission: `reports:read`.

Totals are computed server-side from the full result set; the client recomputes filtered totals on screen (Requirement 3.7) but the export uses the server totals for the full set.

The existing per-domain routes (`/revenue`, `/bookings`, etc.) remain for now; the new generic `/run/:reportId` path supersedes them and is what the catalog uses. Legacy routes can be retired once all reports move to the registry.

---

## 3. Backend: Reference Report (Revenue)

Unified service + product (+ membership + package) revenue from completed orders.

```ts
// packages/server/src/services/reports/definitions/revenue.report.ts
export const revenueReport: ReportDefinition = {
  id: 'revenue',
  title: 'Revenue',
  columns: [
    { key: 'completed_at', header: 'Date', type: 'date', filterable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true },
    { key: 'item_type', header: 'Type', type: 'text', filterable: true },
    { key: 'item_name', header: 'Item', type: 'text', filterable: true },
    { key: 'customer_name', header: 'Customer', type: 'text', filterable: true },
    { key: 'quantity', header: 'Qty', type: 'number', total: true },
    { key: 'unit_price', header: 'Unit Price', type: 'currency' },
    { key: 'discount_amount', header: 'Discount', type: 'currency', total: true },
    { key: 'tax_amount', header: 'Tax', type: 'currency', total: true },
    { key: 'total_price', header: 'Line Total', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await appPool.query(
      `SELECT o.completed_at::date AS completed_at,
              o.order_number,
              oi.item_type,
              oi.item_name,
              COALESCE(c.first_name || ' ' || c.last_name, '—') AS customer_name,
              oi.quantity,
              oi.unit_price,
              oi.discount_amount,
              oi.tax_amount,
              oi.total_price
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN cus_customers c ON c.id = o.customer_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND o.completed_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.completed_at DESC, o.order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
```

Notes:
- Uses `appPool` (RLS-enforced) with `tenantContext` already setting `app.current_tenant_id`, so tenant isolation holds even though the query filters by `business_id`.
- Money stays in cents; the `currency` column type formats it downstream.
- `item_type` is filterable, satisfying the "one report, filter by type" model (services vs products).
- Per-type subtotals on screen fall out of client-side filtering by `item_type` + the totals row.

---

## 4. Backend: Export

```
packages/server/src/services/reports/export.service.ts
```

- `toCsv(result: ReportRunResult): string` — header row from `columns[].header`; each row formats cells by column type (currency cents → decimal string, dates → yyyy-mm-dd); appends a totals row.
- `toPdf(result: ReportRunResult): Promise<Buffer>` — uses **PDFKit** (lightweight, no headless browser). Layout: title, business name, date range, generated timestamp; a table with column headers and rows; a totals row; page numbers in the footer. Right-aligns number/currency columns.

PDFKit is added to `packages/server` dependencies (pinned version). No client-side PDF rendering and no on-screen PDF preview (per user: the table is on screen; PDF is a save format only).

Filename convention (both formats): `revenue_2026-06-01_2026-06-30.pdf`.

---

## 5. Frontend: Catalog

### Catalog config (mirrors `dashboardGroups.ts`)

```ts
// packages/client/src/pages/reports/reportCatalog.ts
export interface ReportCatalogEntry {
  id: string;            // matches server report id
  title: string;
  description: string;
  icon: string;          // emoji or design-system icon key
  permission?: string;
}
export interface ReportCategory {
  id: string;
  label: string;
  accentColor: string;
  accentColorDark: string;
  reports: ReportCatalogEntry[];
}

export const REPORT_CATALOG: ReportCategory[] = [
  {
    id: 'accounting', label: 'Accounting',
    accentColor: '#6B8F63', accentColorDark: '#8FBF86',
    reports: [
      { id: 'revenue', title: 'Revenue', description: 'Service and product revenue by line item', icon: '💰' },
      // future: payments, tax summary, outstanding invoices...
    ],
  },
  // future categories: Marketing, Bookings, Customers, Staff, Memberships, Forecast...
];
```

### Catalog page

`Reports.tsx` is rewritten to render `REPORT_CATALOG` as accent-barred category sections (reusing the visual language of `DashboardGroup`) with report tiles. Tiles are filtered by permission. Activating a tile navigates to `/reports/run/:reportId`. No KPI tiles here (the ask is detailed reports, not headline numbers); a compact KPI strip can be reconsidered later.

Dead cards (`resources`, `marketing` with no route) are removed — only cataloged reports appear.

---

## 6. Frontend: Report Runner

Route: `/reports/run/:reportId` → `ReportRunner.tsx`. Replaces the generic `ReportView` for cataloged reports.

Behavior:
- Reads `reportId` from the route; looks up the catalog entry for title/description.
- Reads active business from `useContextManager().activeContext.businessId` (not `localStorage`).
- Header: title, description, `DateRangeFilter` (default last 30 days), Run button, Save as CSV, Save as PDF.
- On Run: `GET /v1/reports/run/:reportId?start_date=&end_date=` → `ReportRunResult`.
- Renders results with the existing `Table` component:
  - `columns` mapped from `result.columns`, with `render` per column type (currency, date, percent formatting) and `sortable: true`.
  - `filterRow` slot populated with a text input per filterable column; runner holds `filters` state and filters `rows` client-side before passing to `Table`.
  - `clientSort` enabled.
  - A totals row rendered under the table from the currently filtered rows (recomputed client-side for `total:true` columns).
- Export buttons call the export endpoint with the current date range and trigger a file download (blob). Export reflects the selected date range; column filters are a screen convenience and are not applied to the export in v1 (documented; can be added later by passing filter state to the server or exporting the filtered client rows).

New API functions in `packages/client/src/api/reports.ts`: `runReport(reportId, { businessId, start, end })` and `exportReport(reportId, format, { businessId, start, end })` (blob response).

---

## 7. Formatting Rules

One formatter module, used by table render, CSV, and PDF, keyed by column type:

| Type | On-screen / PDF | CSV |
|------|-----------------|-----|
| `text` | as-is | as-is (quoted/escaped) |
| `number` | grouped integer/decimal | raw number |
| `currency` | `Intl.NumberFormat` in report currency, from cents | decimal string (cents/100), no symbol |
| `date` | locale short date | `yyyy-mm-dd` |
| `percent` | `n%` with 1 decimal | numeric |

Currency uses `result.meta.currency` so a Spain business shows EUR and a US business shows USD.

---

## 8. Adding a New Report

The whole point of the framework. To add report `bookings`:

1. Create `packages/server/src/services/reports/definitions/bookings.report.ts` (columns + `run` query).
2. Register it in `registry.ts`.
3. Add a catalog entry under the right category in `reportCatalog.ts`.

No changes to the runner, endpoints, export service, or table. That is the "nail down the first, replicate across the rest" contract in practice.

---

## 9. Security

- Both endpoints require `authenticate` + `tenantContext` + `requirePermission('reports:read')`.
- Business-scoped reports require `x-business-id`; the endpoint returns 400 if missing.
- Queries use `appPool` (RLS-enforced) so tenant isolation is enforced at the database, not just the query filter.
- Unknown report id returns 404; export with an unsupported format returns 400.
- No secrets or cross-business data are exposed; the runner cannot request a business the user's context does not allow.

---

**Status**: 🎨 Design Phase
**Next**: Break into tasks (tasks.md)
