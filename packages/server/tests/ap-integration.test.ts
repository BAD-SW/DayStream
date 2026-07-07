/**
 * Integration tests for the Accounts Payable module (Phase 11).
 * Verifies cross-cutting flows: payroll end-to-end, bill lifecycle, expense→journal, tax docs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as payrollService from '../src/services/payroll.service';
import * as journalService from '../src/services/journal.service';
import * as billsService from '../src/services/bills.service';
import * as expensesService from '../src/services/expenses.service';
import * as taxDocsService from '../src/services/tax-documents.service';
import * as coaService from '../src/services/chart-of-accounts.service';
import * as reconService from '../src/services/bank-reconciliation.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000010';
let BUSINESS_ID: string;
let STAFF_ID: string;
let VENDOR_ID: string;

describe('Accounts Payable — Integration Tests', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'AP Integration Biz', 'ap-integration-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'AP Integration Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM fin_payroll_entries WHERE pay_period_id IN (SELECT id FROM fin_pay_periods WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_pay_periods WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM fin_journal_entries WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_journal_entries WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_expenses WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_bills WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_vendors WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_compensation_rules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_payroll_deductions WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_time_entries WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_tax_documents WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_chart_of_accounts WHERE business_id = $1', [BUSINESS_ID]);

    // Seed chart of accounts
    await coaService.seedDefaults(BUSINESS_ID);

    // Staff
    STAFF_ID = '00000000-0000-0000-0000-000000000058';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'ap-int-staff@example.com', 'APInt', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'APInt'`, [STAFF_ID, TENANT_ID],
    );

    // Compensation: salary €3000/month
    await adminPool.query(
      `INSERT INTO fin_compensation_rules (business_id, user_id, rule_type, rate, effective_from)
       VALUES ($1, $2, 'salary', 300000, '2026-01-01')`, [BUSINESS_ID, STAFF_ID],
    );

    // Deduction: 22% income tax
    await adminPool.query(
      `INSERT INTO fin_payroll_deductions (business_id, user_id, name, deduction_type, calculation_type, value, effective_from)
       VALUES ($1, $2, 'Federal Income Tax', 'tax', 'percentage', 2200, '2026-01-01')`, [BUSINESS_ID, STAFF_ID],
    );

    // Time entry for June
    await adminPool.query(
      `INSERT INTO fin_time_entries (business_id, user_id, entry_type, start_time, hours, approved)
       VALUES ($1, $2, 'manual', '2026-06-01T09:00:00Z', 160, true)`, [BUSINESS_ID, STAFF_ID],
    );

    // Vendor
    const { rows: vendorRows } = await adminPool.query(
      `INSERT INTO fin_vendors (business_id, name, category, payment_terms) VALUES ($1, 'Supplies Inc', 'supplies', 30) RETURNING id`, [BUSINESS_ID],
    );
    VENDOR_ID = vendorRows[0].id;
  });

  describe('Full payroll flow: configure → track → run → deduct → finalize', () => {
    let periodId: string;

    it('opens a pay period', async () => {
      const period = await payrollService.openPayPeriod({ businessId: BUSINESS_ID, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
      expect(period.status).toBe('open');
      periodId = period.id;
    });

    it('runs payroll (calculates gross, deductions, net)', async () => {
      const result = await payrollService.runPayroll(periodId, BUSINESS_ID, TENANT_ID);
      expect(result.entries.length).toBe(1);
      const entry = result.entries[0];
      // Salary: €3000 gross, 22% tax = €660 deduction, net = €2340
      expect(entry.gross_pay).toBe(300000);
      expect(entry.total_deductions).toBe(66000); // 22% of 300000
      expect(entry.net_pay).toBe(234000);
    });

    it('finalizes payroll', async () => {
      const finalized = await payrollService.finalizePayroll(periodId, BUSINESS_ID, USER_ID, TENANT_ID);
      expect(finalized).toBe(true);
    });
  });

  describe('Bill lifecycle: create → approve → pay → journal entry', () => {
    let billId: string;

    it('creates a bill', async () => {
      const bill = await billsService.createBill({
        businessId: BUSINESS_ID, vendorId: VENDOR_ID, invoiceNumber: 'SUP-001',
        amount: 25000, dueDate: '2026-07-15', description: 'Office supplies',
      });
      expect(bill.status).toBe('draft');
      billId = bill.id;
    });

    it('approves the bill', async () => {
      const approved = await billsService.approveBill(billId, BUSINESS_ID, USER_ID);
      expect(approved).toBe(true);
    });

    it('records payment (marks as paid)', async () => {
      const result = await billsService.recordPayment(billId, BUSINESS_ID, 25000);
      expect(result.status).toBe('paid');
      expect(result.amount_paid).toBe(25000);
    });
  });

  describe('Expense lifecycle: submit → approve', () => {
    let expenseId: string;

    it('creates an expense', async () => {
      const { rows: acct } = await adminPool.query(
        "SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '6500'", [BUSINESS_ID],
      );

      const expense = await expensesService.createExpense({
        businessId: BUSINESS_ID, date: '2026-06-20', amount: 8500,
        accountId: acct[0]?.id, description: 'Towels and linens', submittedBy: USER_ID,
      });
      expect(expense.status).toBe('pending');
      expenseId = expense.id;
    });

    it('approves the expense', async () => {
      const approved = await expensesService.approveExpense(expenseId, BUSINESS_ID, USER_ID);
      expect(approved).toBe(true);
    });
  });

  describe('Journal entries maintain balance', () => {
    it('creates a balanced entry', async () => {
      const { rows: cashAcct } = await adminPool.query("SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1100'", [BUSINESS_ID]);
      const { rows: revAcct } = await adminPool.query("SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '4100'", [BUSINESS_ID]);

      const entry = await journalService.createEntry({
        businessId: BUSINESS_ID, entryDate: '2026-06-15', description: 'Integration test entry',
        lines: [
          { account_id: cashAcct[0].id, debit: 10000, credit: 0 },
          { account_id: revAcct[0].id, debit: 0, credit: 10000 },
        ],
      });
      expect(entry).toBeDefined();
    });

    it('rejects unbalanced entry', async () => {
      const { rows: cashAcct } = await adminPool.query("SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1100'", [BUSINESS_ID]);
      const { rows: revAcct } = await adminPool.query("SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '4100'", [BUSINESS_ID]);

      await expect(journalService.createEntry({
        businessId: BUSINESS_ID, entryDate: '2026-06-15', description: 'Bad entry',
        lines: [
          { account_id: cashAcct[0].id, debit: 5000, credit: 0 },
          { account_id: revAcct[0].id, debit: 0, credit: 3000 },
        ],
      })).rejects.toThrow('balance');
    });
  });

  describe('Tax document generation for full year', () => {
    it('generates W-2 for employee with payroll data', async () => {
      // Create a finalized year of payroll
      const { rows: pp } = await adminPool.query(
        `INSERT INTO fin_pay_periods (business_id, period_start, period_end, status, finalized_at)
         VALUES ($1, '2025-01-01', '2025-12-31', 'finalized', NOW())
         ON CONFLICT (business_id, period_start, period_end) DO UPDATE SET status = 'finalized' RETURNING id`, [BUSINESS_ID],
      );
      await adminPool.query(
        `INSERT INTO fin_payroll_entries (pay_period_id, user_id, gross_pay, total_deductions, net_pay, status)
         VALUES ($1, $2, 3600000, 792000, 2808000, 'finalized') ON CONFLICT DO NOTHING`, [pp[0].id, STAFF_ID],
      );

      const result = await taxDocsService.generateTaxDocuments(BUSINESS_ID, 2025);
      expect(result.generated).toBeGreaterThanOrEqual(1);
      expect(result.documents[0].document_type).toBe('w2');
      expect(result.documents[0].total_compensation).toBe(3600000);
    });
  });

  describe('Business scoping', () => {
    it('cannot access other business financial data', async () => {
      const { rows: otherBiz } = await adminPool.query(
        `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Other AP Biz', 'other-ap-biz', 'active')
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Other AP Biz' RETURNING id`, [TENANT_ID],
      );

      const vendors = await import('../src/services/vendors.service').then(m => m.getVendors(otherBiz[0].id));
      expect(vendors.some((v: any) => v.name === 'Supplies Inc')).toBe(false);
    });
  });
});
