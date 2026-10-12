# Suite 12 — Reports

Persona: owner unless stated. Covers spec 17 (reporting and analytics) and spec 35 (reporting framework: catalog, runner, export). Reports are where every other module's data has to agree, so this suite is mostly cross-checks. Run it **after** suites 08–11 in a full run. Conventions: [README](../README.md).

Method: for each figure, take a reading before the run's data is created (or use a date range that isolates the run) and compare the difference with what the run actually did.

---

### REP-01 · Dashboard KPIs by role
`P0` `regression` · Spec 17 R1 · As: owner, manager, therapist · Status: Draft
1. Open `/dashboard` as each role.
**Expect:** KPI cards differ by role (owner sees revenue; a provider sees their own figures only); no card shows `NaN`, `undefined` or raw cents.
**Cross-check:** owner's bookings-today card equals today's count on the calendar; `GET /api/v1/reports/business-kpis` and `/staff-kpis` return the same numbers as the cards.

### REP-02 · Report catalog and runner
`P0` `regression` · Spec 35-reporting R1, R2 · Status: Draft
1. At `/reports`, open every report in the catalog through the runner (`/reports/run/{reportId}`) with the current month.
**Expect:** reports are grouped; each one runs and returns rows or an explicit empty state; an unknown report id shows a not-found state, not a crash.

### REP-03 · Filter, sort and date range
`P1` `regression` · Spec 35-reporting R3 · Status: Draft
1. On a report with rows: change the date range to today, to a range with no data, to an inverted range; filter by a column; sort ascending and descending.
**Expect:** rows always respect the range in **business** time zone (a 23:30 booking belongs to its own day); the inverted range is refused; totals follow the filter.

### REP-04 · Revenue report equals the money actually taken
`P0` `regression` · Specs 17 R2, 35-reporting R7 · Status: Draft
1. Run the revenue report for the day of the run.
**Expect:** revenue = payments − refunds from suite 10 and the journeys, broken down by service / method consistently.
**Cross-check:** equals PAY-17's ledger net and ACC-06's P&L revenue for the same day. A package or membership sale counts once.

### REP-05 · Booking, membership, staff and customer reports
`P1` `regression` · Spec 17 R3–R7 · Status: Draft
1. Run each for the run's date range.
**Expect:** bookings by status match the bookings list (including the cancellations and the no-show from suite 09); membership counts match `/memberships`; staff performance lists the therapist's completed sessions; customer analytics counts the new E2E customers and the lifecycle distribution matches the customer list filter counts.

### REP-06 · Export: CSV and PDF
`P1` `regression` · Specs 17 R11, 35-reporting R4, R5 · Status: Draft
1. Export a filtered report to CSV and to PDF.
**Expect:** the CSV has the same rows, columns and totals as the screen, with currency and dates formatted unambiguously; the PDF opens and shows the same data with the report title and range.

### REP-07 · Scheduled reports
`P2` `regression` · Spec 17 R10 · Status: Draft
1. At `/reports/scheduled` schedule the revenue report weekly to a `.test` address; edit; delete.
**Expect:** the schedule is listed with next run time in business time zone, and is removed on delete.

### REP-08 · Reports are scoped and permissioned
`P0` `negative` · Spec 02 R4, R5 · As: reception, manager, biz-thin · Status: Draft
1. As reception: open `/reports`, call `GET /api/v1/reports/revenue`. 2. As manager (`reports:read`): open reports. 3. As biz-thin: run the revenue report for today.
**Expect:** reception refused; manager can read; the other business's report contains none of the demo business's revenue.
