# Phase 17: Reporting & Analytics - Requirements

## Overview

This phase builds the business intelligence layer — dashboards, KPI tracking, and exportable reports that aggregate data from all platform modules. Business owners need to understand revenue, customer behavior, staff productivity, resource utilization, and membership health at a glance. The reporting system pulls data from across the platform and presents it in actionable formats with configurable date ranges, comparisons, and drill-down capabilities.

## Goals

- Provide configurable dashboards with role-appropriate KPIs
- Build reports across all core business areas (revenue, bookings, memberships, staff, resources, marketing)
- Support custom date ranges and comparison periods (this month vs. last, YoY)
- Implement scheduled report delivery via email
- Support data export (CSV, PDF, Excel)
- Provide platform-level analytics for Super Admin (cross-tenant)
- Establish the data aggregation approach (real-time vs. scheduled)

## Glossary

- **Dashboard**: A configurable page displaying widgets with real-time or near-real-time KPIs
- **Widget**: A single visual element on a dashboard (chart, stat card, table, trend line)
- **Report**: A structured output covering a specific business area for a defined period
- **KPI**: Key Performance Indicator — a metric that tracks business health (e.g., revenue, churn rate, utilization)
- **Drill_Down**: The ability to navigate from a summary metric into the underlying detailed data
- **Comparison_Period**: A reference period used to calculate growth/decline (e.g., previous month, same month last year)
- **Scheduled_Report**: A report automatically generated and emailed on a configured schedule
- **Data_Aggregation**: The process of summarizing transactional data into reportable metrics

## Requirements

### Requirement 1: Dashboard Framework

**User Story:** As a business owner, I want a dashboard that shows my key metrics at a glance, so that I can understand business health without running manual reports.

#### Acceptance Criteria

1. THE system SHALL provide role-based default dashboards: Business Owner (revenue, memberships, bookings, top-line KPIs), Manager (staff performance, resource utilization, daily operations), Reception (today's bookings, check-ins, pending arrivals), Super Admin (platform-wide metrics, tenant health)
2. THE system SHALL support configurable dashboard layouts (add, remove, reorder widgets)
3. THE system SHALL support a date range selector (today, this week, this month, this quarter, this year, custom range)
4. THE system SHALL support comparison to a previous period (show % change)
5. THE system SHALL auto-refresh dashboard data at a configurable interval (default: 5 minutes)
6. THE system SHALL support full-screen mode for dashboards (display on a wall-mounted screen)
7. THE system SHALL save dashboard configurations per user

### Requirement 2: Revenue Reporting

**User Story:** As a business owner, I want to see detailed revenue data, so that I can track income trends and identify growth opportunities.

#### Acceptance Criteria

1. THE system SHALL report total revenue for a configurable period (daily, weekly, monthly, quarterly, annually)
2. THE system SHALL report revenue broken down by: service category, individual service, membership plans, events, payment method, new vs. returning customers
3. THE system SHALL report average revenue per booking
4. THE system SHALL report average revenue per customer
5. THE system SHALL report Monthly Recurring Revenue (MRR) from memberships
6. THE system SHALL report revenue trend (line chart over time)
7. THE system SHALL report comparison to previous period (absolute and percentage change)
8. THE system SHALL support Drill_Down from a summary into individual transactions

### Requirement 3: Booking Analytics

**User Story:** As a business owner, I want to understand booking patterns, so that I can optimize scheduling and identify demand.

#### Acceptance Criteria

1. THE system SHALL report total bookings per period (by status: confirmed, completed, cancelled, no-show)
2. THE system SHALL report booking utilization rate: (booked slots / available slots) × 100%
3. THE system SHALL report cancellation rate and reasons
4. THE system SHALL report no-show rate
5. THE system SHALL report peak booking times (heatmap by day of week and hour)
6. THE system SHALL report average lead time (how far in advance customers book)
7. THE system SHALL report bookings by service, by staff member, by location
8. THE system SHALL report waitlist conversion rate (waitlisted → booked)
9. THE system SHALL report walk-in vs. pre-booked ratio

### Requirement 4: Membership Metrics

**User Story:** As a business owner, I want to track membership health, so that I can monitor retention and revenue stability.

#### Acceptance Criteria

1. THE system SHALL report active membership count by plan type
2. THE system SHALL report new memberships per period
3. THE system SHALL report cancellations (churn) per period with reasons breakdown
4. THE system SHALL report churn rate: (cancelled / total active at start) × 100%
5. THE system SHALL report renewal rate: (renewed / eligible for renewal) × 100%
6. THE system SHALL report membership revenue (MRR, ARR)
7. THE system SHALL report average membership lifespan (days from activation to cancellation)
8. THE system SHALL report credit utilization: (credits used / credits allocated) × 100%
9. THE system SHALL report membership growth trend (net new = new - cancelled)
10. THE system SHALL report paused/frozen membership count

### Requirement 5: Staff Performance

**User Story:** As a manager, I want to see staff productivity metrics, so that I can optimize scheduling and identify high performers.

#### Acceptance Criteria

1. THE system SHALL report per staff member: total sessions delivered, revenue generated, average booking value, utilization rate (booked hours / available hours), no-show rate (of their customers), average customer rating (if collected)
2. THE system SHALL report staff ranking (sortable by revenue, sessions, utilization)
3. THE system SHALL report staff schedule adherence (actual vs. planned hours)
4. THE system SHALL support filtering by date range, location, service
5. THE system SHALL support comparison between staff members
6. THE system SHALL support comparison across periods (this month vs. last month)
7. THE system SHALL respect privacy (staff see their own metrics; managers see their team)

### Requirement 6: Resource Utilization Reports

**User Story:** As a business owner, I want to see how my rooms and equipment are being used, so that I can identify bottlenecks and underutilized assets.

#### Acceptance Criteria

1. THE system SHALL report utilization per resource: (booked hours / available hours) × 100%
2. THE system SHALL report peak usage times per resource (heatmap)
3. THE system SHALL report underutilized resources (below configurable threshold)
4. THE system SHALL report over-capacity resources (consistently full, generating waitlists)
5. THE system SHALL report utilization by resource type
6. THE system SHALL report utilization by location
7. THE system SHALL report maintenance downtime per resource
8. THE system SHALL support comparison across resources and periods

### Requirement 7: Customer Analytics

**User Story:** As a business owner, I want to understand customer behavior, so that I can improve retention and lifetime value.

#### Acceptance Criteria

1. THE system SHALL report customer metrics: total active customers, new customers per period, customer lifetime value (average), visit frequency (average visits per customer per month), retention rate (customers who visited this month who also visited last month), customer acquisition source (if tracked)
2. THE system SHALL report customer distribution by lifecycle stage (lead, trial, active, at-risk, churned)
3. THE system SHALL report top customers by revenue, visits, or longevity
4. THE system SHALL report customer cohort analysis (customers acquired in month X — how many are still active in months X+1, X+2, etc.)
5. THE system SHALL support filtering by segment, membership type, location

### Requirement 8: Marketing Campaign Reports

**User Story:** As a business owner, I want to see how my marketing campaigns performed, so that I can improve targeting and messaging.

#### Acceptance Criteria

1. THE system SHALL report per campaign: delivery rate, open rate, click rate, unsubscribe rate, revenue attributed
2. THE system SHALL report automation sequence performance: enrollment count, completion rate, drop-off per step, conversion rate
3. THE system SHALL report overall marketing metrics: total messages sent per period, engagement rates trending, list growth rate
4. THE system SHALL report channel comparison (email vs. SMS vs. push effectiveness)
5. THE system SHALL report best-performing campaigns by conversion rate

### Requirement 9: Financial Reports

**User Story:** As a business owner, I want financial summaries, so that I can track profitability and manage cash flow.

#### Acceptance Criteria

1. THE system SHALL provide a Profit & Loss summary (revenue - expenses = profit) from Phase 11 data
2. THE system SHALL report revenue vs. expenses trend over time
3. THE system SHALL report accounts payable aging (outstanding bills by due date)
4. THE system SHALL report payroll costs per period
5. THE system SHALL report payment method distribution (card, cash, membership credit)
6. THE system SHALL report refund totals and rates
7. THE system SHALL report outstanding invoices (unpaid)
8. THE system SHALL report tax collected per period

### Requirement 10: Scheduled Reports

**User Story:** As a business owner, I want reports emailed to me automatically, so that I can stay informed without logging in every day.

#### Acceptance Criteria

1. THE system SHALL support scheduling reports for automatic delivery: daily summary, weekly summary, monthly summary, custom schedule (cron-based)
2. THE system SHALL support configuring which reports to include in each scheduled delivery
3. THE system SHALL support configuring recipients (multiple email addresses)
4. THE system SHALL deliver reports as PDF attachment or inline summary with link to full dashboard
5. THE system SHALL support enabling/disabling scheduled reports
6. THE system SHALL send reports at the configured time in the tenant's time zone
7. THE system SHALL log scheduled report deliveries

### Requirement 11: Data Export

**User Story:** As a business owner, I want to export report data, so that I can analyze it in external tools or share it with my accountant.

#### Acceptance Criteria

1. THE system SHALL support exporting report data in CSV format
2. THE system SHALL support exporting report data in PDF format (formatted for print)
3. THE system SHALL support exporting report data in Excel (.xlsx) format
4. THE system SHALL include column headers and metadata (date range, filters applied) in exports
5. THE system SHALL support exporting from any report view
6. THE system SHALL support exporting the full underlying data set (not just the visible chart/summary)
7. THE system SHALL respect RBAC (users can only export data they have permission to view)

### Requirement 12: Platform-Level Analytics (Super Admin)

**User Story:** As a platform operator, I want to see metrics across all tenants, so that I can monitor platform health, billing, and growth.

#### Acceptance Criteria

1. THE system SHALL provide Super Admin analytics showing: total tenants (active, suspended, trial), total platform revenue (sum of platform fees), total bookings processed across all tenants, tenant growth trend, top tenants by revenue/bookings, tenants at risk (declining usage)
2. THE system SHALL provide per-tenant health metrics: monthly active users, bookings per month, revenue, feature utilization
3. THE system SHALL support identifying inactive tenants (candidates for outreach)
4. THE system SHALL support comparing tenants within the same business type
5. THE system SHALL scope platform analytics to Super Admin role only

### Requirement 13: Data Aggregation Strategy

**User Story:** As a platform developer, I want an efficient data aggregation approach, so that dashboards load quickly even with large data volumes.

#### Acceptance Criteria

1. THE system SHALL pre-aggregate common metrics on a scheduled basis (daily roll-up of transactions, bookings, attendance)
2. THE system SHALL store aggregated data in dedicated reporting tables (separate from transactional tables)
3. THE system SHALL support real-time metrics for today's data (current day is calculated live, historical is pre-aggregated)
4. THE system SHALL run aggregation jobs during off-peak hours (configurable schedule)
5. THE system SHALL support re-running aggregation for a specific date range (backfill/correction)
6. THE system SHALL ensure dashboard loads complete within 3 seconds for any date range
7. THE system SHALL handle multi-tenant aggregation efficiently (per-tenant roll-ups, not cross-tenant queries on transactional tables)

---

## Dependencies

- Phase 00: Infrastructure - Database, API
- Phase 02: Security & Compliance - RBAC (role-based dashboard access)
- Phase 03: Core Platform - Tenant context, configuration engine, i18n (localized formatting)
- Phase 04: Design System - Chart components, stat cards, dashboard grid
- Phase 05: Customer Management - Customer data and segments
- Phase 07: Booking Engine - Booking data
- Phase 08: Membership Engine - Membership data
- Phase 09: Pricing Engine - Revenue data
- Phase 10: Payment Platform - Transaction data
- Phase 11: Accounts Payable - Expense and payroll data
- Phase 12: Staff Management - Staff data
- Phase 13: Resource Management - Resource utilization data
- Phase 14: Events & Workshops - Event attendance data
- Phase 15: Check-In System - Attendance data
- Phase 16: Marketing & Automation - Campaign performance data

## Success Criteria

- Dashboards load within 3 seconds with relevant KPIs per role
- Revenue, booking, membership, staff, and resource reports are accurate
- Date range selection and comparison periods work correctly
- Scheduled reports deliver on time with correct data
- Data exports produce valid CSV, PDF, and Excel files
- Platform-level analytics give Super Admin visibility across all tenants
- Pre-aggregation keeps dashboards fast even with large data volumes
- All reporting data respects tenant isolation and RBAC

## Out of Scope

- Custom report builder (drag-and-drop report creation) - Future enhancement
- Real-time streaming dashboards (WebSocket) - Polling sufficient initially
- Predictive analytics / forecasting - Phase 21 (AI Features)
- External BI tool integration (Tableau, PowerBI, Looker) - Phase 20 (Integrations)
- Data warehouse / data lake architecture - Future scale decision

## Notes

- Reporting is a read-heavy, write-light workload — separate reporting tables from transactional tables
- Aggregation strategy: today = real-time queries, yesterday and older = pre-aggregated
- Charting library decision (Recharts, Chart.js, Tremor) to be made during design phase
- Cohort analysis is powerful for understanding retention but computationally expensive; pre-aggregate monthly
- Super Admin platform analytics must NEVER expose one tenant's raw data to another
- Export functionality must handle large datasets without timeout (streaming or pagination)
- Multi-currency reporting: reports always show amounts in the tenant's currency (no cross-currency aggregation at platform level)

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05–16 (data sources)
**Next Phase**: Phase 18 (Website & CMS)
