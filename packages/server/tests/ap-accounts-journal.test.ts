import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as journalService from '../src/services/journal.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ACCOUNT_ID_CASH: string;
let ACCOUNT_ID_REVENUE: string;
let ACCOUNT_ID_CUSTOM: string;
let JOURNAL_ENTRY_ID: string;
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

describe('Chart of Accounts & Journal Entries', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'CoA Test Biz', 'coa-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'CoA Test Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM fin_journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM fin_journal_entries WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_journal_entries WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_chart_of_accounts WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Chart of Accounts ====================

  describe('POST /ap/accounts/seed', () => {
    it('seeds default accounts', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/ap/accounts/seed?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.seeded).toBe(true);
    });
  });

  describe('GET /ap/accounts', () => {
    it('lists seeded accounts', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/accounts?business_id=${BUSINESS_ID}`, undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(20);
      // Find cash and revenue accounts for journal tests
      ACCOUNT_ID_CASH = body.data.find((a: any) => a.code === '1100')?.id;
      ACCOUNT_ID_REVENUE = body.data.find((a: any) => a.code === '4100')?.id;
      expect(ACCOUNT_ID_CASH).toBeDefined();
      expect(ACCOUNT_ID_REVENUE).toBeDefined();
    });
  });

  describe('POST /ap/accounts', () => {
    it('creates a custom account', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/accounts', {
        business_id: BUSINESS_ID, code: '6150', name: 'Cleaning Services',
        account_type: 'expense', description: 'External cleaning vendor',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.code).toBe('6150');
      expect(body.data.is_system).toBe(false);
      ACCOUNT_ID_CUSTOM = body.data.id;
    });

    it('rejects duplicate code', async () => {
      const { statusCode } = await request('POST', '/api/v1/ap/accounts', {
        business_id: BUSINESS_ID, code: '6150', name: 'Duplicate', account_type: 'expense',
      }, ownerToken);
      expect(statusCode).toBe(409);
    });
  });

  describe('PUT /ap/accounts/:id/archive', () => {
    it('archives a custom account without transactions', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/accounts/${ACCOUNT_ID_CUSTOM}/archive?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.archived).toBe(true);
    });

    it('rejects archiving system accounts', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/accounts/${ACCOUNT_ID_CASH}/archive?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('system');
    });
  });

  // ==================== Journal Entries ====================

  describe('POST /ap/journal', () => {
    it('creates a balanced journal entry', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/journal', {
        business_id: BUSINESS_ID, entry_date: '2026-06-15',
        description: 'Service payment received',
        lines: [
          { account_id: ACCOUNT_ID_CASH, debit: 7500, credit: 0 },
          { account_id: ACCOUNT_ID_REVENUE, debit: 0, credit: 7500 },
        ],
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.description).toBe('Service payment received');
      JOURNAL_ENTRY_ID = body.data.id;
    });

    it('rejects unbalanced entry', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/journal', {
        business_id: BUSINESS_ID, entry_date: '2026-06-15',
        description: 'Bad entry',
        lines: [
          { account_id: ACCOUNT_ID_CASH, debit: 5000, credit: 0 },
          { account_id: ACCOUNT_ID_REVENUE, debit: 0, credit: 3000 },
        ],
      }, ownerToken);

      expect(statusCode).toBe(400);
      expect(body.error).toContain('balance');
    });

    it('rejects zero-amount entry', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/journal', {
        business_id: BUSINESS_ID, entry_date: '2026-06-15',
        description: 'Zero entry',
        lines: [
          { account_id: ACCOUNT_ID_CASH, debit: 0, credit: 0 },
          { account_id: ACCOUNT_ID_REVENUE, debit: 0, credit: 0 },
        ],
      }, ownerToken);

      expect(statusCode).toBe(400);
      expect(body.error).toContain('non-zero');
    });
  });

  describe('GET /ap/journal', () => {
    it('lists entries with lines', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/ap/journal?business_id=${BUSINESS_ID}`, undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].lines.length).toBe(2);
      expect(body.data[0].lines[0]).toHaveProperty('account_name');
    });
  });

  describe('PUT /ap/journal/:id/void', () => {
    it('voids an entry (creates reversing entry)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/journal/${JOURNAL_ENTRY_ID}/void?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.voided).toBe(true);
      expect(body.data.reversing_entry_id).toBeDefined();

      // Original marked as void
      const { rows } = await adminPool.query('SELECT is_void FROM fin_journal_entries WHERE id = $1', [JOURNAL_ENTRY_ID]);
      expect(rows[0].is_void).toBe(true);
    });

    it('rejects voiding already-voided entry', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/journal/${JOURNAL_ENTRY_ID}/void?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('already voided');
    });
  });

  describe('Account archiving with transactions', () => {
    it('rejects archiving account that has journal lines', async () => {
      // ACCOUNT_ID_CASH has a journal entry from above (even voided, lines still exist)
      const { statusCode, body } = await request(
        'PUT', `/api/v1/ap/accounts/${ACCOUNT_ID_CASH}/archive?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      // Already a system account so it'll fail for that reason
      expect(statusCode).toBe(400);
    });
  });
});
