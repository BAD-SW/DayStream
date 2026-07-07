import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as reconService from '../src/services/bank-reconciliation.service';
import * as taxDocsService from '../src/services/tax-documents.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      };
      const req = http.request(options, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => { server.close(); try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); } catch { resolve({ statusCode: res.statusCode!, body: d }); } });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data); req.end();
    });
  });
}

describe('Financial Reports, Bank Reconciliation & Tax Documents', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Reports Test Biz', 'reports-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Reports Test Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Financial Reports ====================

  describe('GET /ap/reports/pnl', () => {
    it('returns P&L structure', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/reports/pnl?business_id=${BUSINESS_ID}&date_from=2026-01-01&date_to=2026-12-31`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('revenue');
      expect(body.data).toHaveProperty('expenses');
      expect(body.data).toHaveProperty('net_profit');
      expect(body.data.revenue).toHaveProperty('total');
      expect(body.data.expenses).toHaveProperty('total');
    });
  });

  describe('GET /ap/reports/staff-costs', () => {
    it('returns staff cost structure', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/reports/staff-costs?business_id=${BUSINESS_ID}&date_from=2026-01-01&date_to=2026-12-31`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('staff');
      expect(body.data).toHaveProperty('total_gross');
    });
  });

  describe('GET /ap/reports/ap-aging', () => {
    it('returns aging buckets', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/reports/ap-aging?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('buckets');
      expect(body.data.buckets).toHaveProperty('current');
      expect(body.data.buckets).toHaveProperty('1_30');
      expect(body.data.buckets).toHaveProperty('90_plus');
      expect(body.data).toHaveProperty('total_outstanding');
    });
  });

  describe('GET /ap/reports/expenses', () => {
    it('returns expense breakdown', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/reports/expenses?business_id=${BUSINESS_ID}&date_from=2026-01-01&date_to=2026-12-31`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('categories');
      expect(body.data).toHaveProperty('total');
    });
  });

  // ==================== Bank Reconciliation ====================

  describe('Bank Reconciliation', () => {
    let statementId: string;
    let lineId: string;

    it('imports a bank statement', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/reconciliation/import', {
        business_id: BUSINESS_ID, account_name: 'Main Checking', statement_date: '2026-06-30',
        lines: [
          { date: '2026-06-01', description: 'Client payment', amount: 7500, reference: 'TXN001' },
          { date: '2026-06-05', description: 'Cleaning vendor', amount: -5000 },
          { date: '2026-06-10', description: 'Supplies', amount: -1500 },
        ],
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.line_count).toBe(3);
      statementId = body.data.id;
    });

    it('gets statement lines', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/reconciliation/${statementId}`, undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.lines.length).toBe(3);
      expect(body.data.status.total_lines).toBe(3);
      expect(body.data.status.completion_percentage).toBe(0);
      lineId = body.data.lines[0].id;
    });

    it('matches a line to a journal entry', async () => {
      // Create a journal entry to match against
      await adminPool.query('SELECT seed_chart_of_accounts($1)', [BUSINESS_ID]);
      const { rows: acct } = await adminPool.query(
        "SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1100'", [BUSINESS_ID],
      );
      const { rows: revAcct } = await adminPool.query(
        "SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '4100'", [BUSINESS_ID],
      );

      const { rows: je } = await adminPool.query(
        `INSERT INTO fin_journal_entries (business_id, entry_date, description) VALUES ($1, '2026-06-01', 'Client payment') RETURNING id`,
        [BUSINESS_ID],
      );
      await adminPool.query(
        `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 7500, 0), ($1, $3, 0, 7500)`,
        [je[0].id, acct[0].id, revAcct[0].id],
      );

      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/reconciliation/${lineId}/match`,
        { journal_entry_id: je[0].id }, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.matched).toBe(true);
    });

    it('completion percentage updates', async () => {
      const status = await reconService.getReconciliationStatus(statementId);
      expect(status.matched).toBe(1);
      expect(status.completion_percentage).toBe(33); // 1/3
    });
  });

  // ==================== Tax Documents ====================

  describe('Tax Documents', () => {
    beforeAll(async () => {
      // Create a finalized payroll for tax document generation
      const STAFF_ID = '00000000-0000-0000-0000-000000000057';
      await adminPool.query(
        `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
         VALUES ($1, $2, 'taxdoc-staff@example.com', 'TaxDoc', 'Staff', 'hashed', 'therapist', 'active')
         ON CONFLICT (id) DO UPDATE SET first_name = 'TaxDoc'`,
        [STAFF_ID, TENANT_ID],
      );

      const { rows: pp } = await adminPool.query(
        `INSERT INTO fin_pay_periods (business_id, period_start, period_end, status, finalized_at)
         VALUES ($1, '2025-01-01', '2025-12-31', 'finalized', NOW())
         ON CONFLICT (business_id, period_start, period_end) DO UPDATE SET status = 'finalized'
         RETURNING id`,
        [BUSINESS_ID],
      );

      await adminPool.query(
        `INSERT INTO fin_payroll_entries (pay_period_id, user_id, gross_pay, total_deductions, net_pay, status)
         VALUES ($1, $2, 4200000, 840000, 3360000, 'finalized')
         ON CONFLICT DO NOTHING`,
        [pp[0].id, STAFF_ID],
      );

      // Add tax deduction config
      await adminPool.query(
        `INSERT INTO fin_payroll_deductions (business_id, user_id, name, deduction_type, calculation_type, value, effective_from)
         VALUES ($1, $2, 'Federal Income Tax', 'tax', 'percentage', 2200, '2025-01-01')
         ON CONFLICT DO NOTHING`,
        [BUSINESS_ID, STAFF_ID],
      );
    });

    it('generates tax documents for a year', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/payroll/tax-documents/generate?business_id=${BUSINESS_ID}`,
        { tax_year: 2025 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.generated).toBeGreaterThanOrEqual(1);
    });

    it('lists generated documents', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/tax-documents?business_id=${BUSINESS_ID}&tax_year=2025`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('document_type');
      expect(body.data[0]).toHaveProperty('total_compensation');
      expect(body.data[0]).toHaveProperty('total_federal_tax');
    });

    it('skips already-generated documents', async () => {
      const result = await taxDocsService.generateTaxDocuments(BUSINESS_ID, 2025);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.generated).toBe(0);
    });

    it('supports corrected documents', async () => {
      const docs = await taxDocsService.getTaxDocuments(BUSINESS_ID, { taxYear: 2025 });
      const original = docs[0];

      const corrected = await taxDocsService.issueCorrection(original.id, BUSINESS_ID, {
        total_compensation: 4300000, total_federal_tax: 860000,
      });

      expect(corrected).not.toBeNull();
      expect(corrected.corrects_id).toBe(original.id);
      expect(corrected.total_compensation).toBe(4300000);
    });
  });
});
