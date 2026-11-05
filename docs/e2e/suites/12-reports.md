# Suite 12 — Reports

Persona: owner unless stated. Covers spec 17 (reporting and analytics) and spec 35 (reporting framework: catalog, runner, export). Reports are where every other module's data has to agree, so this suite is mostly cross-checks. Run it **after** suites 08–11 in a full run. Conventions: [README](../README.md).

Method: for each figure, take a reading before the run's data is created (or use a date range that isolates the run) and compare the difference with what the run actually did.

---

### REP-01 · Dashboard KPIs by role
`P0` `regression` · Spec 17 R1 · As: owner, manager, therapist · Status: Verified
1. Open `/dashboard` as each role.
**Expect:** KPI cards differ by role (owner sees revenue; a provider sees their own figures only); no card shows `NaN`, `undefined` or raw cents.
**Cross-check:** owner's bookings-today card equals today's count on the calendar; `GET /api/v1/reports/business-kpis` and `/staff-kpis` return the same numbers as the cards.

### REP-02 · Report catalog and runner
`P0` `regression` · Spec 35-reporting R1, R2 · Status: Verified
1. At `/reports`, open every report in the catalog through the runner (`/reports/run/{reportId}`) with the current month.
**Expect:** reports are grouped; each one runs and returns rows or an explicit empty state; an unknown report id shows a not-found state, not a crash.

### REP-03 · Filter, sort and date range
`P1` `regression` · Spec 35-reporting R3 · Status: Verified
1. On a report with rows: change the date range to today, to a range with no data, to an inverted range; filter by a column; sort ascending and descending.
**Expect:** rows always respect the range in **business** time zone (a 23:30 booking belongs to its own day); the inverted range is refused; totals follow the filter.

### REP-04 · Revenue report equals the money actually taken
`P0` `regression` · Specs 17 R2, 35-reporting R7 · Status: Verified
1. Run the revenue report for the day of the run.
**Expect:** the Payments Received total = completed sales + payments recorded outside a sale − refunds, each counted once (a payment that belongs to an order is the order's line); the dashboard's month-to-date revenue is the same figure.
**Cross-check:** equals PAY-17's ledger net and ACC-06's P&L revenue for the same day. A package or membership sale counts once.

### REP-05 · Booking, membership, staff and customer reports
`P1` `regression` · Spec 17 R3–R7 · Status: Verified
1. Run each for the run's date range.
**Expect:** bookings by status match the bookings list (including the cancellations and the no-show from suite 09); membership counts match `/memberships`; staff performance lists the therapist's completed sessions; customer analytics counts the new E2E customers and the lifecycle distribution matches the customer list filter counts.

### REP-06 · Export: CSV and PDF
`P1` `regression` · Specs 17 R11, 35-reporting R4, R5 · Status: Verified
1. Export a filtered report to CSV and to PDF.
**Expect:** the CSV has the same rows, columns and totals as the screen, with currency and dates formatted unambiguously; the PDF opens and shows the same data with the report title and range.

### REP-07 · Scheduled reports
`P2` `regression` · Spec 17 R10 · Status: Verified
1. At `/reports/scheduled` schedule the revenue report weekly to a `.test` address; edit; delete.
**Expect:** the schedule is listed with next run time in business time zone, and is removed on delete.

### REP-08 · Reports are scoped and permissioned
`P0` `negative` · Spec 02 R4, R5 · As: reception, manager, biz-thin · Status: Verified
1. As reception: open `/reports`, call `GET /api/v1/reports/revenue`. 2. As manager (`reports:read`): open reports. 3. As biz-thin: run the revenue report for today.
**Expect:** reception refused; manager can read; the other business's report contains none of the demo business's revenue.

### REP-09 · Reconciliation report and sales tax
`P2` `regression` · Bill `cdca3f2` (reconciliation is work in progress) · Status: Verified
1. Run Reconciliation for the month. 2. Run Sales by Item.
**Expect:** reconciliation runs with no NaN, undefined or error; Sales by Item has a tax column. Totals are not asserted while the report is work in progress, except that Sales equals the Sales by Item Net total (REP-10) and Payments leaves out credit and debit notes (D-52).

### REP-10 · Refunds in the sales reports
`P0` `regression` · D-44, option A (David, 2026-10-20) · As: owner · Status: Verified
1. Sell two units of a product with a discount and tax, paid in cash. 2. From the order, refund one unit. 3. Run, for today: Sales by Item, Sales by Staff, Tax Summary, Revenue, Reconciliation, Discounts & Promotions, Staff Performance.
**Expect:** the sale stays on its own day at full value (Entry "Sale", quantity 2) although the order is now partly refunded; the refund is its own row (Entry "Refund") on the day of the refund: quantity −1, Refunds = −the revenue refunded, Tax = −the tax refunded, Net = −the amount refunded. Sales by Staff takes the refund (pre-tax) off the staff member credited with the sale; Tax Summary has the tax given back as a negative row; Revenue has the refunded service or product line as a negative row; Reconciliation's Sales still equals the Sales by Item Net total; Discounts still lists the discounted line of the refunded sale; Staff Performance's product revenue is sales less refunds.
**Cross-check:** refund rows and totals agree with `pay_order_refund_lines` for the day.
**Commissions:** see REP-11.

### REP-11 · Commission after a refund
`P0` `regression` · THE-21 (David, 2026-10-22) · As: owner, staff · Status: Verified
1. A staff member with a 15% product commission sells two units (cash); refund one unit the same day. 2. Run Commissions for today. 3. Settings → System → Commission after a refund: "Keep the commission"; run it again; set it back.
**Expect:** by default the sale keeps its commission on its own day (Entry "Sale", 15% of both units) and the refund takes the commission on the refunded unit back on the day of the refund (Entry "Refund", negative), so it lands in the pay period of the refund and a finalized pay period never changes; with "Keep the commission" there is no Refund line; only the business changes the setting.
