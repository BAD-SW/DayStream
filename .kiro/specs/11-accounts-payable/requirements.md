# Phase 11: Accounts Payable - Requirements

## Overview

This phase builds a reusable financial module for payroll tracking, vendor payments, expense management, and financial reporting. This is designed as a cornerstone component — built once, reused across future applications. The module covers the outgoing money side of the business: paying staff, paying vendors, tracking expenses, and generating financial reports. It is provider-agnostic for payment execution (leveraging the Payment_Adapter from Phase 10 where applicable) and focuses on tracking, calculation, and reporting rather than actual fund movement initially.

## Goals

- Build staff payroll tracking (hours, sessions, commissions, pay calculations)
- Implement vendor/supplier management and bill tracking
- Build expense tracking and categorization
- Implement a chart of accounts for financial organization
- Support pay period management and payroll runs
- Generate financial reports (P&L, expense reports, staff cost analysis)
- Design for reusability across future applications
- Support multi-currency financial records

## Glossary

- **Payroll_Run**: A scheduled calculation and recording of staff compensation for a pay period
- **Pay_Period**: A defined time range for which compensation is calculated (weekly, biweekly, monthly)
- **Compensation_Rule**: A configurable rule defining how a staff member is paid (hourly, per-session, commission, salary)
- **Vendor**: An external supplier or service provider that the business pays
- **Bill**: An invoice received from a Vendor for goods or services
- **Expense**: A recorded business cost, categorized for reporting
- **Chart_of_Accounts**: A structured list of all financial categories used for classification
- **Account**: A category in the Chart_of_Accounts (e.g., "Staff Wages", "Rent", "Equipment")
- **Journal_Entry**: A double-entry bookkeeping record (debit and credit)
- **Financial_Report**: A generated summary of financial data over a period (P&L, balance sheet)
- **Reconciliation**: The process of matching recorded transactions against bank statements

## Requirements

### Requirement 1: Staff Compensation Configuration

**User Story:** As a business owner, I want to configure how each staff member is compensated, so that payroll calculations are accurate and automatic.

#### Acceptance Criteria

1. THE system SHALL support configuring Compensation_Rules per staff member: hourly rate, per-session rate (fixed amount per booking delivered), commission (percentage of service revenue generated), base salary (fixed amount per pay period), combination (salary + commission, hourly + per-session bonus)
2. THE system SHALL support multiple Compensation_Rules per staff member (e.g., hourly base + commission on services over a threshold)
3. THE system SHALL support effective dates on compensation rules (start date, end date for historical tracking)
4. THE system SHALL store all monetary values as integers (cents/minor currency units)
5. THE system SHALL support configuring overtime rules (rate multiplier after X hours per week)
6. THE system SHALL support configuring holiday/bank holiday pay rates
7. THE system SHALL store compensation configurations scoped to the current Tenant
8. THE system SHALL log all compensation rule changes in the audit trail

### Requirement 2: Time and Session Tracking

**User Story:** As a manager, I want the system to track staff hours and sessions delivered, so that payroll data is accurate without manual timesheets.

#### Acceptance Criteria

1. THE system SHALL automatically track sessions delivered per staff member from completed bookings (Phase 07)
2. THE system SHALL support manual time entry for non-booking work (admin hours, training, cleaning)
3. THE system SHALL support clock-in/clock-out time tracking (optional per tenant)
4. THE system SHALL calculate total hours worked per pay period
5. THE system SHALL calculate total sessions delivered per pay period
6. THE system SHALL calculate revenue generated per staff member per pay period (from booking payments)
7. THE system SHALL flag discrepancies (e.g., scheduled but no bookings, clocked in but no activity)
8. THE system SHALL support time entry approval workflow (staff submits, manager approves)

### Requirement 3: Payroll Run Processing

**User Story:** As a business owner, I want to run payroll on a schedule, so that staff compensation is calculated consistently and on time.

#### Acceptance Criteria

1. THE system SHALL support configuring pay periods per Tenant (weekly, biweekly, monthly)
2. THE system SHALL support initiating a Payroll_Run for a specific pay period
3. THE Payroll_Run SHALL calculate gross compensation per staff member based on their Compensation_Rules and tracked time/sessions
4. THE Payroll_Run SHALL produce a payroll summary: staff member, hours worked, sessions delivered, revenue generated, gross pay, deductions (if configured), net pay
5. THE system SHALL support payroll in draft status (review before finalizing)
6. THE system SHALL support finalizing a payroll run (locks calculations, no further edits)
7. THE system SHALL prevent duplicate payroll runs for the same pay period
8. THE system SHALL store payroll history for all past runs
9. THE system SHALL log payroll finalization in the audit trail

### Requirement 4: Deductions and Adjustments

**User Story:** As a business owner, I want to configure deductions and adjustments for payroll, so that the net pay reflects the actual amount to be paid.

#### Acceptance Criteria

1. THE system SHALL support configuring recurring deductions per staff member (e.g., insurance, benefits, loan repayments)
2. THE system SHALL support one-time adjustments (bonuses, advances, corrections)
3. THE system SHALL apply deductions and adjustments during the Payroll_Run calculation
4. THE system SHALL display deduction details on the payroll summary
5. THE system SHALL support percentage-based and fixed-amount deductions
6. THE system SHALL support deduction effective date ranges
7. THE system SHALL NOT calculate tax withholding (out of scope — varies by jurisdiction, complex regulatory area)

### Requirement 5: Vendor Management

**User Story:** As a business owner, I want to track my vendors and suppliers, so that I have organized records of who I pay for goods and services.

#### Acceptance Criteria

1. THE system SHALL support creating Vendor records with: name, contact info, address, tax ID, payment terms (net 30, net 60, etc.), default Account category, notes
2. THE system SHALL support updating and archiving Vendor records
3. THE system SHALL track total spend per Vendor over time
4. THE system SHALL support categorizing Vendors (supplies, services, utilities, rent, equipment)
5. THE system SHALL store all Vendor records scoped to the current Tenant
6. THE system SHALL support linking multiple Bills to a Vendor
7. THE system SHALL display outstanding balance per Vendor

### Requirement 6: Bill Management

**User Story:** As a business owner, I want to record bills I receive from vendors, so that I know what I owe and when payments are due.

#### Acceptance Criteria

1. THE system SHALL support recording Bills with: vendor, invoice number, amount, currency, due date, line items (description, quantity, unit price, account category), status (draft, pending, approved, paid, overdue), attachments (PDF upload of vendor invoice)
2. THE system SHALL calculate due dates based on vendor payment terms
3. THE system SHALL automatically mark bills as overdue when past due date
4. THE system SHALL support bill approval workflow (staff submits, owner approves)
5. THE system SHALL support partial payments on bills
6. THE system SHALL track payment history per bill
7. THE system SHALL display total accounts payable (sum of all unpaid bills)
8. THE system SHALL support recurring bills (e.g., monthly rent auto-generates a new bill each month)

### Requirement 7: Expense Tracking

**User Story:** As a business owner, I want to categorize and track all business expenses, so that I understand where my money goes.

#### Acceptance Criteria

1. THE system SHALL support recording Expenses with: date, amount, category (from Chart_of_Accounts), description, vendor (optional), receipt attachment (image/PDF), payment method used
2. THE system SHALL support quick expense entry (minimal required fields: date, amount, category)
3. THE system SHALL support categorizing expenses against the Chart_of_Accounts
4. THE system SHALL support recurring expenses (auto-generate monthly entries for fixed costs)
5. THE system SHALL provide expense totals by category and time period
6. THE system SHALL support expense approval workflow (staff submits, manager/owner approves)
7. THE system SHALL support splitting an expense across multiple categories

### Requirement 8: Chart of Accounts

**User Story:** As a business owner, I want organized financial categories, so that my revenue and expenses are classified consistently for reporting.

#### Acceptance Criteria

1. THE system SHALL provide a configurable Chart_of_Accounts per Tenant
2. THE system SHALL provide default accounts for wellness businesses: Revenue (services, memberships, products, gift cards), Cost of Goods Sold, Operating Expenses (rent, utilities, insurance, marketing, supplies), Payroll Expenses (wages, commissions, contractor payments), Other Expenses
3. THE system SHALL support custom account creation by the business owner
4. THE system SHALL support account hierarchy (parent account → child accounts)
5. THE system SHALL assign an account type to each account: Asset, Liability, Equity, Revenue, Expense
6. THE system SHALL prevent deletion of accounts that have transactions
7. THE system SHALL support archiving unused accounts

### Requirement 9: Journal Entries

**User Story:** As a business owner, I want the system to record financial entries using standard double-entry bookkeeping, so that my books balance and are auditable.

#### Acceptance Criteria

1. THE system SHALL support double-entry Journal_Entries (every entry has matching debits and credits)
2. THE system SHALL automatically create Journal_Entries for: booking payments (debit: bank/receivable, credit: revenue), refunds (debit: revenue, credit: bank/receivable), payroll runs (debit: payroll expense, credit: payable), bill payments (debit: expense, credit: bank/payable), membership charges
3. THE system SHALL support manual Journal_Entries for adjustments
4. THE system SHALL validate that debits equal credits on every entry
5. THE system SHALL link Journal_Entries to source transactions (booking ID, payroll run ID, bill ID)
6. THE system SHALL support voiding entries (creates a reversing entry, does not delete)
7. THE system SHALL maintain an unbroken audit trail of all entries

### Requirement 10: Financial Reports

**User Story:** As a business owner, I want financial reports, so that I can understand profitability, costs, and make informed business decisions.

#### Acceptance Criteria

1. THE system SHALL generate a Profit & Loss report for a configurable date range
2. THE system SHALL generate an Expense report by category for a configurable date range
3. THE system SHALL generate a Staff Cost report (compensation by staff member, sessions vs. pay)
4. THE system SHALL generate an Accounts Payable aging report (outstanding bills by due date)
5. THE system SHALL generate a Revenue vs. Expense summary per month
6. THE system SHALL support filtering reports by: date range, account category, vendor, staff member
7. THE system SHALL support exporting reports to CSV and PDF
8. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)
9. THE system SHALL support comparison periods (this month vs. last month, YoY)

### Requirement 11: Bank Reconciliation Foundations

**User Story:** As a business owner, I want to match my recorded transactions against bank statements, so that I can verify my books are accurate.

#### Acceptance Criteria

1. THE system SHALL support importing bank statement data (CSV format)
2. THE system SHALL support manual matching of bank statement lines to recorded transactions
3. THE system SHALL suggest automatic matches based on amount, date, and description
4. THE system SHALL track reconciliation status per transaction (matched, unmatched, discrepancy)
5. THE system SHALL display unmatched items for investigation
6. THE system SHALL support marking items as reconciled
7. THE system SHALL report reconciliation status per bank account per period

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC (financial data access restricted to Owner/Manager), audit logging, encryption
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, multi-currency
- Phase 07: Booking Engine - Completed bookings feed session counts and revenue per staff
- Phase 10: Payment Platform - Transaction data feeds into journal entries; Payment_Adapter may be used for payouts
- Phase 12: Staff Management - Staff profiles, schedules (for hours calculation)

## Success Criteria

- Payroll runs calculate correctly based on configured compensation rules and tracked sessions/hours
- Bills can be recorded, approved, and tracked with aging visibility
- Expenses are categorized against the chart of accounts
- Journal entries maintain double-entry balance (debits = credits always)
- Financial reports (P&L, expenses, staff costs) generate accurately for any date range
- Bank reconciliation matches recorded transactions to statement lines
- All financial data is strictly tenant-scoped and role-restricted
- Module architecture supports extraction as a standalone package for reuse

## Out of Scope

- Actual payroll processing (tax withholding, direct deposit, pay slips) - Varies heavily by jurisdiction; tracking only
- Integration with external accounting software (Xero, QuickBooks) - Phase 20 (Integrations)
- Accounts Receivable (invoicing customers) - Handled by Phase 10 (Payment Platform)
- Budgeting and forecasting - Future enhancement
- Multi-entity consolidation - Future/enterprise phase
- Real-time bank feed (Plaid/Open Banking) - May be evaluated as a third-party service later

## Notes

- **Cornerstone component**: Designed for reusability. Architecture should allow extraction as a standalone module for future applications.
- Tax withholding is explicitly out of scope — it's a regulatory minefield that varies by country/state. The system tracks gross pay; actual tax calculation requires jurisdiction-specific services.
- Double-entry bookkeeping is important for financial integrity but adds complexity; ensure all automated entries are tested thoroughly
- This phase intersects with Phase 10 (incoming money) — Phase 11 is the outgoing money and classification side
- Bank reconciliation is foundational here; full auto-reconciliation via bank APIs (Open Banking, Plaid) is a future enhancement
- During local development, no actual fund transfers occur — this is a tracking and calculation system

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 07, Phase 10, Phase 12
**Next Phase**: Phase 12 (Staff Management)
