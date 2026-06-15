# Phase 11: Accounts Payable - Design Document

**Date**: June 15, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 07, Phase 10, Phase 12

---

## Overview

This document describes the technical design for the DayStream accounts payable module — payroll processing, vendor/bill management, expense tracking, chart of accounts, journal entries, financial reporting, bank reconciliation, and tax document generation. Designed as a cornerstone component for reuse across future applications.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Payroll Processing](#2-payroll-processing)
3. [Deductions & Tax Withholding](#3-deductions--tax-withholding)
4. [Vendor & Bill Management](#4-vendor--bill-management)
5. [Expense Tracking](#5-expense-tracking)
6. [Chart of Accounts & Journal Entries](#6-chart-of-accounts--journal-entries)
7. [Financial Reports](#7-financial-reports)
8. [Bank Reconciliation](#8-bank-reconciliation)
9. [Tax Document Generation](#9-tax-document-generation)
10. [API Endpoints](#10-api-endpoints)
11. [Frontend Views](#11-frontend-views)

---

## 1. Database Schema

### Compensation Rules

```sql
CREATE TABLE compensation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('hourly', 'per_session', 'commission', 'salary')),
    rate INTEGER NOT NULL,                        -- cents (hourly/session rate) or basis points (commission)
    threshold_amount INTEGER,                     -- commission kicks in after this revenue
    overtime_multiplier NUMERIC(3,2) DEFAULT 1.5,
    overtime_after_hours INTEGER DEFAULT 40,
    holiday_multiplier NUMERIC(3,2) DEFAULT 2.0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Deductions

```sql
CREATE TABLE payroll_deductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    deduction_type VARCHAR(20) NOT NULL
        CHECK (deduction_type IN ('tax', 'insurance', 'benefits', 'loan', 'other')),
    calculation_type VARCHAR(10) NOT NULL CHECK (calculation_type IN ('percentage', 'fixed')),
    value INTEGER NOT NULL,                       -- percentage (basis points) or fixed (cents)
    is_recurring BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Pay Periods & Payroll Runs

```sql
CREATE TABLE pay_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'processing', 'finalized')),
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payroll_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pay_period_id UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    -- Calculated values
    hours_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
    sessions_delivered INTEGER NOT NULL DEFAULT 0,
    revenue_generated INTEGER NOT NULL DEFAULT 0,
    gross_pay INTEGER NOT NULL DEFAULT 0,
    total_deductions INTEGER NOT NULL DEFAULT 0,
    net_pay INTEGER NOT NULL DEFAULT 0,
    -- Detail
    breakdown JSONB,                              -- detailed calculation breakdown
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Time Entries

```sql
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('clock', 'manual', 'booking')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    hours NUMERIC(5,2),
    description VARCHAR(200),
    booking_id UUID REFERENCES bookings(id),
    approved BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES users(id),
    pay_period_id UUID REFERENCES pay_periods(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Vendors

```sql
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    tax_id VARCHAR(50),
    payment_terms INTEGER DEFAULT 30,             -- net days
    category VARCHAR(50),
    default_account_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Bills

```sql
CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    invoice_number VARCHAR(100),
    amount INTEGER NOT NULL,                      -- total in cents
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'approved', 'paid', 'overdue', 'void')),
    amount_paid INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_interval VARCHAR(20),              -- monthly, quarterly, etc.
    attachment_path TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bill_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    description VARCHAR(200) NOT NULL,
    quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    account_id UUID,                              -- chart of accounts category
    amount INTEGER NOT NULL
);
```

### Expenses

```sql
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    amount INTEGER NOT NULL,
    account_id UUID NOT NULL,                     -- chart of accounts category
    description VARCHAR(500),
    vendor_id UUID REFERENCES vendors(id),
    payment_method VARCHAR(50),
    receipt_path TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Chart of Accounts

```sql
CREATE TABLE chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES chart_of_accounts(id),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL
        CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,     -- cannot be deleted
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, code)
);
```

### Journal Entries

```sql
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    reference_type VARCHAR(30),                   -- 'booking', 'payroll', 'bill', 'expense', 'manual'
    reference_id UUID,
    is_void BOOLEAN NOT NULL DEFAULT false,
    void_entry_id UUID REFERENCES journal_entries(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    debit INTEGER NOT NULL DEFAULT 0,
    credit INTEGER NOT NULL DEFAULT 0,
    description VARCHAR(200)
);
```

### Bank Reconciliation

```sql
CREATE TABLE bank_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    account_name VARCHAR(100) NOT NULL,
    statement_date DATE NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    description VARCHAR(500),
    amount INTEGER NOT NULL,                      -- positive = credit, negative = debit
    reference VARCHAR(100),
    reconciliation_status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
        CHECK (reconciliation_status IN ('unmatched', 'matched', 'discrepancy')),
    matched_entry_id UUID REFERENCES journal_entries(id),
    reconciled_at TIMESTAMPTZ
);
```

### Tax Documents

```sql
CREATE TABLE tax_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    tax_year INTEGER NOT NULL,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('w2', '1099_nec')),
    total_compensation INTEGER NOT NULL,
    total_federal_tax INTEGER NOT NULL DEFAULT 0,
    total_state_tax INTEGER NOT NULL DEFAULT 0,
    total_social_security INTEGER NOT NULL DEFAULT 0,
    total_medicare INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL,                          -- full form field data
    file_path TEXT,                               -- generated PDF path
    status VARCHAR(20) NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated', 'delivered', 'corrected')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    corrects_id UUID REFERENCES tax_documents(id)
);
```

---

## 2. Payroll Processing

### Calculation Flow

```
1. Open a pay period (period_start, period_end)
2. Gather data:
   - Time entries (clock + manual) for each staff member
   - Completed bookings for session-based pay
   - Revenue generated per staff (from bookings)
3. Apply compensation rules:
   - Hourly: hours × rate (+ overtime if applicable)
   - Per-session: sessions × rate
   - Commission: revenue × percentage (above threshold)
   - Salary: fixed amount / periods per year
4. Calculate gross pay (sum of all rule outputs)
5. Apply deductions (taxes, insurance, benefits, loans)
6. Calculate net pay (gross - deductions)
7. Create payroll entry with breakdown
8. Review → Finalize → Generate journal entries
```

---

## 3. Deductions & Tax Withholding

Deduction categories:
- **Tax**: Income tax, social security, Medicare (percentage-based typically)
- **Insurance**: Health, dental, vision (fixed or percentage)
- **Benefits**: 401k, pension contributions (percentage)
- **Loan**: Repayment of advances or loans (fixed)
- **Other**: Union dues, garnishments, etc.

Applied in order during payroll calculation. All configurable per employee with effective dates.

---

## 4. Vendor & Bill Management

- Vendors scoped to business, with payment terms
- Bills linked to vendor, support line items against chart of accounts
- Status lifecycle: draft → pending → approved → paid (or overdue)
- Aging report groups bills by: current, 1-30 days, 31-60, 61-90, 90+

---

## 5. Expense Tracking

- Quick entry (date, amount, category) or detailed (vendor, receipt, split)
- Approval workflow: submitted → approved/rejected
- Recurring expenses auto-generate monthly

---

## 6. Chart of Accounts & Journal Entries

- Default accounts seeded per business type
- Double-entry: every journal entry must balance (sum debits = sum credits)
- Auto-generated entries from bookings, payroll, and bills
- Void creates a reversing entry (never delete)

---

## 7. Financial Reports

- **P&L**: Revenue accounts minus expense accounts for a period
- **Staff Cost**: Per-staff compensation breakdown, sessions vs cost
- **AP Aging**: Bills grouped by overdue period
- **Expense by Category**: Grouped by chart of accounts

---

## 8. Bank Reconciliation

- Import CSV of bank statement lines
- Auto-suggest matches by amount ± date proximity
- Manual override for unmatched items
- Track reconciliation completion percentage

---

## 9. Tax Document Generation

- Aggregate yearly data per employee/contractor from payroll entries
- 1099-NEC: total payments to contractors ≥ $600
- W-2: compensation + withholding totals by category
- Generate PDF from template with field mapping
- Store in filesystem (same storage service as Phase 06 images)

---

## 10. API Endpoints

### Compensation & Payroll

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/payroll/compensation-rules` | List rules for staff |
| POST | `/api/v1/payroll/compensation-rules` | Create rule |
| GET | `/api/v1/payroll/time-entries` | List time entries |
| POST | `/api/v1/payroll/time-entries` | Create manual entry |
| GET | `/api/v1/payroll/periods` | List pay periods |
| POST | `/api/v1/payroll/periods` | Open pay period |
| POST | `/api/v1/payroll/periods/:id/run` | Execute payroll run |
| PUT | `/api/v1/payroll/periods/:id/finalize` | Finalize payroll |
| GET | `/api/v1/payroll/deductions` | List deductions |
| POST | `/api/v1/payroll/deductions` | Create deduction |

### Vendors & Bills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ap/vendors` | List vendors |
| POST | `/api/v1/ap/vendors` | Create vendor |
| GET | `/api/v1/ap/bills` | List bills |
| POST | `/api/v1/ap/bills` | Create bill |
| PUT | `/api/v1/ap/bills/:id/approve` | Approve bill |
| PUT | `/api/v1/ap/bills/:id/pay` | Record payment |

### Expenses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ap/expenses` | List expenses |
| POST | `/api/v1/ap/expenses` | Create expense |
| PUT | `/api/v1/ap/expenses/:id/approve` | Approve expense |

### Chart of Accounts & Journal

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ap/accounts` | List chart of accounts |
| POST | `/api/v1/ap/accounts` | Create account |
| GET | `/api/v1/ap/journal` | List journal entries |
| POST | `/api/v1/ap/journal` | Create manual entry |
| PUT | `/api/v1/ap/journal/:id/void` | Void an entry |

### Reports & Reconciliation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ap/reports/pnl` | Profit & Loss |
| GET | `/api/v1/ap/reports/staff-costs` | Staff cost analysis |
| GET | `/api/v1/ap/reports/ap-aging` | AP aging report |
| POST | `/api/v1/ap/reconciliation/import` | Import bank statement |
| GET | `/api/v1/ap/reconciliation/:statementId` | Get statement lines |
| PUT | `/api/v1/ap/reconciliation/:lineId/match` | Match to entry |

### Tax Documents

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/payroll/tax-documents/generate` | Generate for tax year |
| GET | `/api/v1/payroll/tax-documents` | List generated documents |
| GET | `/api/v1/payroll/tax-documents/:id/download` | Download PDF |

---

## 11. Frontend Views

### Payroll (`/payroll`)
- Pay periods list with status
- Run payroll wizard (review → approve → finalize)
- Per-staff breakdown (hours, sessions, gross, deductions, net)
- Compensation rules configuration

### Vendors (`/ap/vendors`)
- Vendor list with spend totals
- Vendor detail with linked bills

### Bills (`/ap/bills`)
- Bill list with aging indicators
- Create/edit bill with line items
- Approval workflow UI

### Expenses (`/ap/expenses`)
- Expense list with category grouping
- Quick expense entry form
- Receipt upload

### Chart of Accounts (`/ap/accounts`)
- Hierarchical account tree
- Create/archive accounts

### Reports (`/ap/reports`)
- P&L, staff costs, AP aging, expense breakdown
- Date range picker, export buttons

### Tax Documents (`/payroll/tax-documents`)
- Tax year selector
- Generate batch/individual
- Download PDFs
- Status tracking (generated/delivered/corrected)

---

**Last Updated**: June 15, 2026
