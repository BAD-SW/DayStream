# Phase 17: Reporting & Analytics - Tasks

## Overview

Implementation tasks for the reporting and analytics module â€” database schema, data aggregation engine, dashboard framework, domain reports (revenue, bookings, memberships, staff, resources, customers, marketing, financial), scheduled delivery, data export, platform analytics, and frontend.

## Task Status Legend

- âœ… **Complete**: Task is finished and verified
- ðŸŸ¡ **In Progress**: Task is currently being worked on
- ðŸ“‹ **Planned**: Task is defined but not started
- â¸ï¸ **Blocked**: Task is waiting on dependencies
- âŒ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `report_daily_metrics` table
- [x] ✅ Create migration for `dashboard_configs` table
- [x] ✅ Create migration for `scheduled_reports` table
- [x] ✅ Create migration for `report_delivery_log` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, date, category, metric)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Data Aggregation Engine

### 2.1 Aggregation Service
- [x] ✅ Create `report-aggregation.service.ts`
- [x] ✅ Implement nightly aggregation job per tenant
- [x] ✅ Aggregate revenue metrics (total, by service, by plan)
- [x] ✅ Aggregate booking metrics (total, completed, cancelled, no-show)
- [x] ✅ Aggregate membership metrics (active, new, cancelled, credits)
- [x] ✅ Aggregate customer metrics (active, new, churned)
- [x] ✅ Aggregate staff metrics (sessions, hours, utilization)
- [x] ✅ Aggregate resource metrics (booked hours, utilization)
- [x] ✅ Aggregate check-in metrics (total, by method, walk-ins)
- [x] ✅ Aggregate marketing metrics (sent, opened, clicked)
- [x] ✅ Aggregate financial metrics (expenses, payroll, AR, AP)
- [x] ✅ Support re-running aggregation for a specific date range (backfill)
- [x] ✅ UPSERT into report_daily_metrics (idempotent)
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `POST /api/v1/reports/aggregate` endpoint (admin trigger)

---

## 3. Dashboard Framework

### 3.1 Dashboard Service
- [x] ✅ Create `report-dashboard.service.ts`
- [x] ✅ Resolve widget data (live for today, pre-aggregated for history)
- [x] ✅ Support stat_card, line_chart, bar_chart, pie_chart, table widget types
- [x] ✅ Support date range selection (today, week, month, quarter, year, custom)
- [x] ✅ Support comparison to previous period (% change calculation)
- [x] ✅ Return dashboard data in a single API call (all widgets)
- [x] ✅ Write tests

### 3.2 Dashboard Configuration
- [x] ✅ Support saving user dashboard layout (widgets JSONB)
- [x] ✅ Provide role-based default dashboards
- [x] ✅ Support add/remove/reorder widgets
- [x] ✅ Write tests

### 3.3 Routes
- [x] ✅ Create `GET /api/v1/reports/dashboard` endpoint
- [x] ✅ Create `GET /api/v1/reports/dashboard/config` endpoint
- [x] ✅ Create `PUT /api/v1/reports/dashboard/config` endpoint

---

## 4. Revenue Report

### 4.1 Revenue Service
- [x] ✅ Create `report-revenue.service.ts`
- [x] ✅ Calculate total revenue for period
- [x] ✅ Break down by service, plan, event, payment method
- [x] ✅ Calculate average per booking, per customer
- [x] ✅ Calculate MRR/ARR from memberships
- [x] ✅ Calculate trend (daily/weekly values over time)
- [x] ✅ Calculate comparison to previous period
- [x] ✅ Write tests

### 4.2 Routes
- [x] ✅ Create `GET /api/v1/reports/revenue` endpoint

---

## 5. Booking Report

### 5.1 Booking Analytics Service
- [x] ✅ Create `report-bookings.service.ts`
- [x] ✅ Calculate total bookings by status
- [x] ✅ Calculate utilization rate
- [x] ✅ Calculate cancellation rate with reasons
- [x] ✅ Calculate no-show rate
- [x] ✅ Generate peak times heatmap (day Ã— hour)
- [x] ✅ Calculate average lead time
- [x] ✅ Break down by service, staff, location
- [x] ✅ Calculate waitlist conversion rate
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/reports/bookings` endpoint

---

## 6. Membership Report

### 6.1 Membership Metrics Service
- [x] ✅ Create `report-memberships.service.ts`
- [x] ✅ Calculate active count by plan
- [x] ✅ Calculate new/cancelled/net per period
- [x] ✅ Calculate churn rate and renewal rate
- [x] ✅ Calculate MRR/ARR
- [x] ✅ Calculate average lifespan
- [x] ✅ Calculate credit utilization
- [x] ✅ Calculate growth trend
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/reports/memberships` endpoint

---

## 7. Staff Report

### 7.1 Staff Performance Service
- [x] ✅ Create `report-staff.service.ts`
- [x] ✅ Calculate per-staff: sessions, revenue, utilization, no-show rate
- [x] ✅ Generate ranking (sortable by metric)
- [x] ✅ Calculate schedule adherence
- [x] ✅ Support filtering by location, service, period
- [x] ✅ Support comparison between staff and across periods
- [x] ✅ Enforce visibility (staff sees own, manager sees team)
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `GET /api/v1/reports/staff` endpoint

---

## 8. Resource Report

### 8.1 Resource Utilization Service
- [x] ✅ Create `report-resources.service.ts`
- [x] ✅ Calculate utilization per resource and type
- [x] ✅ Generate peak usage heatmap
- [x] ✅ Flag underutilized resources (< configurable threshold)
- [x] ✅ Flag over-capacity resources
- [x] ✅ Calculate maintenance downtime
- [x] ✅ Support comparison across resources and periods
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/reports/resources` endpoint

---

## 9. Customer Report

### 9.1 Customer Analytics Service
- [x] ✅ Create `report-customers.service.ts`
- [x] ✅ Calculate active/new/churned per period
- [x] ✅ Calculate lifecycle stage distribution
- [x] ✅ Calculate LTV, visit frequency, retention rate
- [x] ✅ Generate cohort retention analysis (monthly cohorts)
- [x] ✅ Identify top customers (by revenue, visits)
- [x] ✅ Support filtering by segment, membership, location
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `GET /api/v1/reports/customers` endpoint

---

## 10. Marketing Report

### 10.1 Marketing Analytics Service
- [x] ✅ Create `report-marketing.service.ts`
- [x] ✅ Calculate campaign performance (delivery, open, click rates)
- [x] ✅ Calculate sequence performance (enrollment, completion, drop-off)
- [x] ✅ Calculate channel comparison (email vs SMS vs push)
- [x] ✅ Calculate list growth rate
- [x] ✅ Identify best-performing campaigns
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/reports/marketing` endpoint

---

## 11. Financial Report

### 11.1 Financial Summary Service
- [x] ✅ Create `report-financial.service.ts`
- [x] ✅ Calculate P&L summary (revenue - expenses)
- [x] ✅ Calculate revenue vs expenses trend
- [x] ✅ Calculate AP aging (outstanding bills by bucket)
- [x] ✅ Calculate AR aging (outstanding receivables: current, 1-30, 31-60, 61-90, 90+)
- [x] ✅ Calculate payroll costs per period
- [x] ✅ Calculate payment method distribution
- [x] ✅ Calculate refund totals and rates
- [x] ✅ Calculate tax collected
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `GET /api/v1/reports/financial` endpoint

---

## 12. Scheduled Reports

### 12.1 Scheduling Service
- [x] ✅ Create `report-scheduling.service.ts`
- [x] ✅ Support schedule types: daily, weekly, monthly, custom (cron)
- [x] ✅ Calculate next_run_at based on schedule
- [x] ✅ Implement delivery job (checks due reports every minute)
- [x] ✅ Generate report data for configured period
- [x] ✅ Format as PDF or CSV
- [x] ✅ Send via email service
- [x] ✅ Log deliveries to report_delivery_log
- [x] ✅ Support enable/disable
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/reports/scheduled` endpoint
- [x] ✅ Create `POST /api/v1/reports/scheduled` endpoint
- [x] ✅ Create `PUT /api/v1/reports/scheduled/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/reports/scheduled/:id` endpoint

---

## 13. Data Export

### 13.1 Export Service
- [x] ✅ Create `report-export.service.ts`
- [x] ✅ Support CSV export (streaming for large datasets)
- [x] ✅ Support PDF export (formatted tables + charts)
- [x] ✅ Support Excel export (.xlsx with formatting)
- [x] ✅ Include metadata (title, date range, filters, timestamp)
- [x] ✅ Respect RBAC (users export only what they can view)
- [x] ✅ Write tests

### 13.2 Routes
- [x] ✅ Create `GET /api/v1/reports/:type/export` endpoint (format via query param)

---

## 14. Platform Analytics (Super Admin)

### 14.1 Platform Service
- [x] ✅ Create `report-platform.service.ts`
- [x] ✅ Calculate platform overview (total tenants, revenue, bookings)
- [x] ✅ Calculate per-tenant health (MAU, bookings/month, revenue)
- [x] ✅ Identify inactive tenants
- [x] ✅ Calculate tenant growth trend
- [x] ✅ Scope to Super Admin role only
- [x] ✅ Write tests

### 14.2 Routes
- [x] ✅ Create `GET /api/v1/reports/platform/overview` endpoint
- [x] ✅ Create `GET /api/v1/reports/platform/tenants` endpoint

---

## 15. Frontend

### 15.1 Main Dashboard
- [x] ✅ Create `/reports` page with grid widget layout
- [x] ✅ Implement stat_card widget component
- [x] ✅ Implement line_chart widget (Recharts or Chart.js)
- [x] ✅ Implement bar_chart widget
- [x] ✅ Implement pie_chart widget
- [x] ✅ Implement table widget
- [x] ✅ Date range picker (top bar)
- [x] ✅ Comparison toggle (vs previous period)
- [x] ✅ Auto-refresh (5-min interval)
- [x] ✅ Full-screen mode
- [x] ✅ Widget add/remove/reorder (drag grid)

### 15.2 Report Pages
- [x] ✅ Create `/reports/revenue` page
- [x] ✅ Create `/reports/bookings` page
- [x] ✅ Create `/reports/memberships` page
- [x] ✅ Create `/reports/staff` page
- [x] ✅ Create `/reports/resources` page
- [x] ✅ Create `/reports/customers` page
- [x] ✅ Create `/reports/marketing` page
- [x] ✅ Create `/reports/financial` page (includes AR/AP aging)
- [x] ✅ Each with date range, comparison, charts, tables, export button

### 15.3 Scheduled Reports
- [x] ✅ Create `/reports/scheduled` management page
- [x] ✅ Create/edit form (frequency, reports, recipients, format)
- [x] ✅ Enable/disable toggle
- [x] ✅ Delivery history log

### 15.4 Platform Analytics (Super Admin)
- [x] ✅ Create `/admin/analytics` page
- [x] ✅ Platform overview cards
- [x] ✅ Tenant health table
- [x] ✅ Growth charts

---

## 16. Testing

### 16.1 Unit Tests
- [x] ✅ Test aggregation job (correct metric calculation for each category)
- [x] ✅ Test dashboard data resolution (live today, aggregated history)
- [x] ✅ Test revenue report calculations
- [x] ✅ Test booking analytics (utilization, cancellation, peak times)
- [x] ✅ Test membership metrics (churn, renewal, MRR)
- [x] ✅ Test financial report (P&L, AR aging, AP aging)
- [x] ✅ Test scheduled report generation and delivery
- [x] ✅ Test export formats (CSV, PDF, Excel)
- [x] ✅ Test comparison period calculation

### 16.2 Integration Tests
- [x] ✅ Test full aggregation â†’ dashboard display flow
- [x] ✅ Test scheduled report â†’ email delivery
- [x] ✅ Test export with various date ranges and filters
- [x] ✅ Test role-based dashboard access (owner vs manager vs reception)
- [x] ✅ Test platform analytics (Super Admin only)
- [x] ✅ Test tenant scoping (report data isolated per tenant)
