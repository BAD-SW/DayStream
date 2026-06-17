# Phase 17: Reporting & Analytics - Design Document

**Date**: June 17, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05–16

---

## Overview

This document describes the technical design for the DayStream reporting and analytics module — configurable dashboards, pre-aggregated KPIs, domain-specific reports (revenue, bookings, memberships, staff, resources, customers, marketing, financials), scheduled report delivery, data export, and platform-level analytics.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Data Aggregation Strategy](#2-data-aggregation-strategy)
3. [Dashboard Framework](#3-dashboard-framework)
4. [Report Domains](#4-report-domains)
5. [Scheduled Reports](#5-scheduled-reports)
6. [Data Export](#6-data-export)
7. [API Endpoints](#7-api-endpoints)
8. [Frontend Views](#8-frontend-views)

---

## 1. Database Schema

### Aggregated Metrics (Pre-computed)

```sql
CREATE TABLE report_daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    metric_category VARCHAR(30) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    metric_value NUMERIC NOT NULL DEFAULT 0,
    dimensions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, metric_date, metric_category, metric_name, dimensions)
);

CREATE INDEX idx_daily_metrics_tenant_date ON report_daily_metrics(tenant_id, metric_date);
CREATE INDEX idx_daily_metrics_category ON report_daily_metrics(tenant_id, metric_category, metric_name);
```

### Dashboard Configurations

```sql
CREATE TABLE dashboard_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL DEFAULT 'My Dashboard',
    role_type VARCHAR(30),
    widgets JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dashboard_configs_user ON dashboard_configs(user_id);
```

### Scheduled Reports

```sql
CREATE TABLE scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    schedule_type VARCHAR(20) NOT NULL
        CHECK (schedule_type IN ('daily', 'weekly', 'monthly', 'custom')),
    cron_expression VARCHAR(100),
    report_types JSONB NOT NULL DEFAULT '[]',
    recipients JSONB NOT NULL DEFAULT '[]',
    format VARCHAR(10) NOT NULL DEFAULT 'pdf'
        CHECK (format IN ('pdf', 'csv', 'email_summary')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_sent_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_reports_tenant ON scheduled_reports(tenant_id);
CREATE INDEX idx_scheduled_reports_next ON scheduled_reports(next_run_at) WHERE is_active = true;
```

### Report Delivery Log

```sql
CREATE TABLE report_delivery_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheduled_report_id UUID NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recipients_count INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent', 'failed')),
    error_message TEXT
);
```

---

## 2. Data Aggregation Strategy

### Approach: Hybrid (Real-time today + Pre-aggregated history)

```
Today's data:
  → Queried live from transactional tables
  → Slightly slower but always fresh

Yesterday and older:
  → Queried from report_daily_metrics
  → Fast (pre-computed, indexed)
  → Aggregation job runs nightly (2 AM tenant local time)
```

### Aggregation Job

Runs nightly per tenant:
1. Calculate metrics for the previous day from transactional tables
2. UPSERT into `report_daily_metrics`
3. Metrics include: revenue, bookings_count, cancellations, no_shows, new_customers, memberships_sold, membership_cancellations, check_ins, walk_ins, resource_utilization, campaign_sent, campaign_opened

### Metric Categories

| Category | Metrics |
|----------|---------|
| `revenue` | total, by_service, by_plan, by_event, refunds |
| `bookings` | total, completed, cancelled, no_show, walk_in |
| `memberships` | active, new, cancelled, frozen, credits_used |
| `customers` | total_active, new, returning, churned |
| `staff` | sessions_delivered, hours_worked, utilization |
| `resources` | booked_hours, utilization_pct |
| `checkin` | total, by_method, no_shows |
| `marketing` | emails_sent, opened, clicked, unsubscribed |
| `financial` | expenses, payroll, ap_total, ar_total |

---

## 3. Dashboard Framework

### Widget Types

| Type | Description | Data |
|------|-------------|------|
| `stat_card` | Single KPI with comparison | value, change %, label |
| `line_chart` | Trend over time | time series |
| `bar_chart` | Category comparison | categories + values |
| `pie_chart` | Distribution | slices |
| `heatmap` | Day/hour density | matrix |
| `table` | Tabular data | columns + rows |
| `funnel` | Conversion funnel | stages |

### Widget Configuration (stored in dashboard_configs.widgets JSONB)

```json
[
  { "id": "w1", "type": "stat_card", "config": { "metric": "revenue.total", "label": "Revenue", "comparison": "previous_period" }, "position": { "x": 0, "y": 0, "w": 3, "h": 1 } },
  { "id": "w2", "type": "line_chart", "config": { "metric": "bookings.total", "groupBy": "day" }, "position": { "x": 3, "y": 0, "w": 6, "h": 2 } }
]
```

### Role-Based Defaults

- **Business Owner**: Revenue, MRR, bookings today, active memberships, top services
- **Manager**: Staff utilization, resource utilization, check-ins today, no-shows
- **Reception**: Today's arrivals, checked in, pending, upcoming
- **Super Admin**: Total tenants, platform revenue, bookings processed, tenant health

---

## 4. Report Domains

### Revenue Report
- Total revenue (period)
- Revenue by service / plan / event
- Average per booking / per customer
- MRR / ARR
- Trend line + comparison

### Booking Report
- Total bookings by status
- Utilization rate
- Peak times (heatmap)
- Cancellation rate + reasons
- Lead time distribution

### Membership Report
- Active count by plan
- New / cancelled / net growth
- Churn rate, renewal rate
- Credit utilization
- Average lifespan

### Staff Report
- Sessions delivered / revenue per staff
- Utilization rate
- Ranking table
- Schedule adherence

### Resource Report
- Utilization per resource / type
- Peak usage heatmap
- Underutilized flagging
- Maintenance downtime

### Customer Report
- Active / new / churned
- Lifecycle stage distribution
- LTV, visit frequency
- Cohort retention
- Top customers

### Marketing Report
- Campaign performance (delivery/open/click rates)
- Sequence conversion funnel
- Channel comparison
- List growth

### Financial Report
- P&L summary
- Revenue vs expenses trend
- AP aging (outstanding bills)
- AR aging (outstanding receivables: current, 1-30, 31-60, 61-90, 90+)
- Payroll costs
- Payment method distribution
- Tax collected

---

## 5. Scheduled Reports

```
Scheduled report flow:
1. Job runs every minute, checks for due reports (next_run_at <= NOW)
2. For each due report:
   a. Generate report data for the configured period
   b. Format as PDF or CSV
   c. Send to configured recipients
   d. Log delivery
   e. Calculate next_run_at based on schedule
```

---

## 6. Data Export

### Export Formats

| Format | Library | Notes |
|--------|---------|-------|
| CSV | Built-in | Streaming for large datasets |
| PDF | PDFKit or Puppeteer | Formatted tables + charts |
| Excel | ExcelJS | Sheets with formatting |

All exports include: report title, date range, filters applied, generation timestamp.

---

## 7. API Endpoints

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/dashboard` | Get dashboard data (widgets resolved) |
| GET | `/api/v1/reports/dashboard/config` | Get user's dashboard config |
| PUT | `/api/v1/reports/dashboard/config` | Save dashboard config |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/revenue` | Revenue report |
| GET | `/api/v1/reports/bookings` | Booking analytics |
| GET | `/api/v1/reports/memberships` | Membership metrics |
| GET | `/api/v1/reports/staff` | Staff performance |
| GET | `/api/v1/reports/resources` | Resource utilization |
| GET | `/api/v1/reports/customers` | Customer analytics |
| GET | `/api/v1/reports/marketing` | Marketing performance |
| GET | `/api/v1/reports/financial` | Financial summary (P&L, AR/AP aging) |

### Scheduled Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/scheduled` | List scheduled reports |
| POST | `/api/v1/reports/scheduled` | Create scheduled report |
| PUT | `/api/v1/reports/scheduled/:id` | Update schedule |
| DELETE | `/api/v1/reports/scheduled/:id` | Delete schedule |

### Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/:type/export` | Export report data (format query param) |

### Platform Analytics (Super Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/platform/overview` | Platform-wide metrics |
| GET | `/api/v1/reports/platform/tenants` | Per-tenant health |

### Aggregation (Internal/Admin)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/reports/aggregate` | Trigger aggregation for date range |

---

## 8. Frontend Views

### Main Dashboard (`/reports`)
- Grid-based widget layout
- Date range picker (top bar)
- Comparison toggle (vs previous period)
- Auto-refresh indicator
- Full-screen mode button
- Widget add/remove/reorder

### Report Pages (`/reports/:domain`)
- Revenue (`/reports/revenue`)
- Bookings (`/reports/bookings`)
- Memberships (`/reports/memberships`)
- Staff (`/reports/staff`)
- Resources (`/reports/resources`)
- Customers (`/reports/customers`)
- Marketing (`/reports/marketing`)
- Financial (`/reports/financial`)

Each report page includes:
- Date range selector
- Comparison period toggle
- Charts + tables
- Export button (CSV/PDF/Excel)
- Drill-down on clickable metrics

### Scheduled Reports (`/reports/scheduled`)
- List of configured schedules
- Create/edit modal (frequency, reports, recipients, format)
- Enable/disable toggle
- Delivery history log

### Platform Analytics (`/admin/analytics`) — Super Admin only
- Platform overview cards
- Tenant health table
- Growth charts

---

**Last Updated**: June 17, 2026
