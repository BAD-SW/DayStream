# Phase 11: Accounts Payable - Tasks

## Overview

Implementation tasks for the accounts payable module — database schema, payroll processing, deductions/taxes, vendor/bill management, expenses, chart of accounts, journal entries, financial reports, bank reconciliation, tax document generation, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `compensation_rules` table
- [x] ✅ Create migration for `payroll_deductions` table (taxes, insurance, benefits, loans)
- [x] ✅ Create migration for `pay_periods` table
- [x] ✅ Create migration for `payroll_entries` table
- [x] ✅ Create migration for `time_entries` table
- [x] ✅ Create migration for `vendors` table
- [x] ✅ Create migration for `bills` and `bill_line_items` tables
- [x] ✅ Create migration for `expenses` table
- [x] ✅ Create migration for `chart_of_accounts` table
- [x] ✅ Create migration for `journal_entries` and `journal_entry_lines` tables
- [x] ✅ Create migration for `bank_statements` and `bank_statement_lines` tables
- [x] ✅ Create migration for `tax_documents` table

### 1.2 Indexes and Constraints
- [x] ✅ Add RLS policies on all tables (business-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Seed default chart of accounts for new businesses

---

## 2. Compensation Configuration

### 2.1 Compensation Rules CRUD
- [x] ✅ Create `GET /api/v1/payroll/compensation-rules` endpoint
- [x] ✅ Create `POST /api/v1/payroll/compensation-rules` endpoint
- [x] ✅ Create `PUT /api/v1/payroll/compensation-rules/:id` endpoint
- [x] ✅ Support rule types: hourly, per_session, commission, salary
- [x] ✅ Support effective dates and overtime/holiday multipliers
- [x] ✅ Write unit tests

---

## 3. Time & Session Tracking

### 3.1 Time Entry API
- [x] ✅ Create `GET /api/v1/payroll/time-entries` endpoint (filter by user, period)
- [x] ✅ Create `POST /api/v1/payroll/time-entries` endpoint (manual entry)
- [x] ✅ Auto-generate time entries from completed bookings
- [x] ✅ Support clock-in/clock-out entries
- [x] ✅ Support approval workflow (approve/reject)
- [x] ✅ Write unit tests

---

## 4. Payroll Processing

### 4.1 Pay Period Management
- [x] ✅ Create `GET /api/v1/payroll/periods` endpoint
- [x] ✅ Create `POST /api/v1/payroll/periods` endpoint (open period)
- [x] ✅ Prevent duplicate periods for same date range

### 4.2 Payroll Run
- [x] ✅ Create `POST /api/v1/payroll/periods/:id/run` endpoint
- [x] ✅ Gather time entries and booking data for period
- [x] ✅ Apply compensation rules (hourly, session, commission, salary)
- [x] ✅ Calculate overtime and holiday pay
- [x] ✅ Calculate gross pay per staff
- [x] ✅ Apply deductions (taxes, insurance, benefits, loans)
- [x] ✅ Calculate net pay
- [x] ✅ Store payroll entries with breakdown JSON

### 4.3 Finalize Payroll
- [x] ✅ Create `PUT /api/v1/payroll/periods/:id/finalize` endpoint
- [x] ✅ Lock entries (no further edits)
- [x] ✅ Generate journal entries (debit payroll expense, credit payable)
- [x] ✅ Log in audit trail
- [x] ✅ Write unit tests

---

## 5. Deductions & Adjustments

### 5.1 Deductions CRUD
- [x] ✅ Create `GET /api/v1/payroll/deductions` endpoint (filter by user)
- [x] ✅ Create `POST /api/v1/payroll/deductions` endpoint
- [x] ✅ Create `PUT /api/v1/payroll/deductions/:id` endpoint
- [x] ✅ Support types: tax, insurance, benefits, loan, other
- [x] ✅ Support percentage and fixed calculation
- [x] ✅ Support effective date ranges
- [x] ✅ Write unit tests

### 5.2 One-Time Adjustments
- [x] ✅ Support bonuses (positive adjustment)
- [x] ✅ Support advances/corrections (negative adjustment)
- [x] ✅ Apply during payroll run
- [x] ✅ Write unit tests

---

## 6. Vendor Management

### 6.1 Vendor CRUD
- [x] ✅ Create `GET /api/v1/ap/vendors` endpoint
- [x] ✅ Create `POST /api/v1/ap/vendors` endpoint
- [x] ✅ Create `PUT /api/v1/ap/vendors/:id` endpoint
- [x] ✅ Support categories, payment terms, tax ID
- [x] ✅ Track total spend per vendor
- [x] ✅ Write unit tests

---

## 7. Bill Management

### 7.1 Bill CRUD
- [x] ✅ Create `GET /api/v1/ap/bills` endpoint (with aging indicators)
- [x] ✅ Create `POST /api/v1/ap/bills` endpoint (with line items)
- [x] ✅ Create `PUT /api/v1/ap/bills/:id/approve` endpoint
- [x] ✅ Create `PUT /api/v1/ap/bills/:id/pay` endpoint (record payment)
- [x] ✅ Support partial payments
- [x] ✅ Auto-mark overdue bills (scheduled job)
- [x] ✅ Support recurring bills (auto-generate)
- [x] ✅ Calculate accounts payable total
- [x] ✅ Write unit tests

---

## 8. Expense Tracking

### 8.1 Expense CRUD
- [x] ✅ Create `GET /api/v1/ap/expenses` endpoint
- [x] ✅ Create `POST /api/v1/ap/expenses` endpoint
- [x] ✅ Create `PUT /api/v1/ap/expenses/:id/approve` endpoint
- [x] ✅ Support receipt upload (via storage service)
- [x] ✅ Support category split (multiple accounts per expense)
- [x] ✅ Support recurring expenses
- [x] ✅ Write unit tests

---

## 9. Chart of Accounts

### 9.1 Accounts CRUD
- [x] ✅ Create `GET /api/v1/ap/accounts` endpoint (hierarchical)
- [x] ✅ Create `POST /api/v1/ap/accounts` endpoint
- [x] ✅ Create `PUT /api/v1/ap/accounts/:id` endpoint (archive)
- [x] ✅ Support account types (asset, liability, equity, revenue, expense)
- [x] ✅ Support parent/child hierarchy
- [x] ✅ Prevent deletion of accounts with transactions
- [x] ✅ Seed defaults for new businesses
- [x] ✅ Write unit tests

---

## 10. Journal Entries

### 10.1 Journal Entry CRUD
- [x] ✅ Create `GET /api/v1/ap/journal` endpoint (paginated, filterable)
- [x] ✅ Create `POST /api/v1/ap/journal` endpoint (manual entries)
- [x] ✅ Create `PUT /api/v1/ap/journal/:id/void` endpoint (reversing entry)
- [x] ✅ Validate debits = credits on every entry
- [x] ✅ Auto-generate from payroll finalization
- [x] ✅ Auto-generate from bill payment
- [x] ✅ Auto-generate from expense approval
- [x] ✅ Link entries to source (reference_type + reference_id)
- [x] ✅ Write unit tests

---

## 11. Financial Reports

### 11.1 Report Endpoints
- [x] ✅ Create `GET /api/v1/ap/reports/pnl` endpoint (date range)
- [x] ✅ Create `GET /api/v1/ap/reports/staff-costs` endpoint
- [x] ✅ Create `GET /api/v1/ap/reports/ap-aging` endpoint
- [x] ✅ Create `GET /api/v1/ap/reports/expenses` endpoint (by category)
- [x] ✅ Support date range, category, vendor filters
- [x] ✅ Support CSV and PDF export
- [x] ✅ Support comparison periods (MoM, YoY)
- [x] ✅ Write unit tests

---

## 12. Bank Reconciliation

### 12.1 Reconciliation API
- [x] ✅ Create `POST /api/v1/ap/reconciliation/import` endpoint (CSV upload)
- [x] ✅ Parse bank statement CSV into statement lines
- [x] ✅ Create `GET /api/v1/ap/reconciliation/:statementId` endpoint
- [x] ✅ Auto-suggest matches (amount + date proximity)
- [x] ✅ Create `PUT /api/v1/ap/reconciliation/:lineId/match` endpoint
- [x] ✅ Track reconciliation status per line
- [x] ✅ Report reconciliation completion percentage
- [x] ✅ Write unit tests

---

## 13. Tax Document Generation

### 13.1 Document Generation
- [x] ✅ Create `POST /api/v1/payroll/tax-documents/generate` endpoint
- [x] ✅ Aggregate yearly payroll data per employee/contractor
- [x] ✅ Determine 1099-NEC eligibility (contractor, ≥ $600)
- [x] ✅ Determine W-2 eligibility (employee with withholdings)
- [x] ✅ Generate PDF from form template (1099-NEC, W-2 layouts)
- [x] ✅ Store PDF via storage service

### 13.2 Document Management
- [x] ✅ Create `GET /api/v1/payroll/tax-documents` endpoint (filter by year, type)
- [x] ✅ Create `GET /api/v1/payroll/tax-documents/:id/download` endpoint
- [x] ✅ Support batch generation (all qualifying workers)
- [x] ✅ Support corrected forms (link to original)
- [x] ✅ Track status: generated, delivered, corrected
- [x] ✅ Write unit tests

---

## 14. Frontend

### 14.1 Payroll Pages
- [x] ✅ Create `/payroll` page (pay periods list, run/finalize workflow)
- [x] ✅ Create per-staff payroll detail (hours, sessions, gross, deductions, net)
- [x] ✅ Create compensation rules configuration UI
- [x] ✅ Create deductions configuration UI

### 14.2 Vendors & Bills Pages
- [x] ✅ Create `/ap/vendors` page (list, detail with bills)
- [x] ✅ Create `/ap/bills` page (list with aging, create with line items, approve/pay)

### 14.3 Expenses Page
- [x] ✅ Create `/ap/expenses` page (list, quick entry, receipt upload, approve)

### 14.4 Chart of Accounts Page
- [x] ✅ Create `/ap/accounts` page (hierarchical tree, create/archive)

### 14.5 Reports Page
- [x] ✅ Create `/ap/reports` page (P&L, staff costs, AP aging, expenses)
- [x] ✅ Date range picker, filters, export buttons

### 14.6 Tax Documents Page
- [x] ✅ Create `/payroll/tax-documents` page
- [x] ✅ Year selector, generate batch, download PDFs, status tracking

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test compensation rule calculation (all types: hourly, session, commission, salary)
- [x] ✅ Test overtime and holiday multipliers
- [x] ✅ Test deduction application (percentage + fixed, all types including taxes)
- [x] ✅ Test payroll run (gross → deductions → net)
- [x] ✅ Test vendor/bill CRUD and aging
- [x] ✅ Test expense tracking and approval workflow
- [x] ✅ Test journal entry balance (debits = credits)
- [x] ✅ Test chart of accounts hierarchy
- [x] ✅ Test bank reconciliation matching
- [x] ✅ Test tax document generation (1099, W-2)

### 15.2 Integration Tests
- [x] ✅ Test full payroll flow (configure → track → run → deduct → finalize → journal entry)
- [x] ✅ Test bill lifecycle (create → approve → pay → journal entry)
- [x] ✅ Test expense lifecycle (submit → approve → journal entry)
- [x] ✅ Test tax document batch generation for a full year
- [x] ✅ Test business scoping (financial data isolated per business)
