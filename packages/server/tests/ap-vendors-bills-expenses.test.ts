import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as billsService from '../src/services/bills.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let VENDOR_ID: string;
let BILL_ID: string;
let EXPENSE_ID: string;
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

describe('Vendors, Bills & Expenses', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status) VALUES ($1, 'AP Test Biz', 'ap-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'AP Test Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;
    await adminPool.query('DELETE FROM expenses WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM bills WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM vendors WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Vendors ====================
  describe('Vendors', () => {
    it('creates a vendor', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/vendors', {
        business_id: BUSINESS_ID, name: 'Cleaning Co', category: 'services',
        email: 'info@cleaning.co', payment_terms: 30, tax_id: 'CC-12345',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Cleaning Co');
      expect(body.data.payment_terms).toBe(30);
      VENDOR_ID = body.data.id;
    });

    it('lists vendors with spend/outstanding', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/ap/vendors?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('total_spend');
      expect(body.data[0]).toHaveProperty('outstanding');
    });

    it('updates a vendor', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/ap/vendors/${VENDOR_ID}?business_id=${BUSINESS_ID}`, { payment_terms: 60 }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.payment_terms).toBe(60);
    });
  });

  // ==================== Bills ====================
  describe('Bills', () => {
    it('creates a bill with line items', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/bills', {
        business_id: BUSINESS_ID, vendor_id: VENDOR_ID, invoice_number: 'INV-001',
        amount: 50000, due_date: '2026-07-15', description: 'Monthly cleaning',
        line_items: [{ description: 'Office cleaning', quantity: 4, unit_price: 12500 }],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.amount).toBe(50000);
      expect(body.data.status).toBe('draft');
      BILL_ID = body.data.id;
    });

    it('lists bills with vendor name', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/ap/bills?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].vendor_name).toBe('Cleaning Co');
    });

    it('approves a bill', async () => {
      const { statusCode } = await request('PUT', `/api/v1/ap/bills/${BILL_ID}/approve?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
    });

    it('records partial payment', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/ap/bills/${BILL_ID}/pay?business_id=${BUSINESS_ID}`, { amount: 25000 }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.amount_paid).toBe(25000);
      expect(body.data.status).toBe('approved'); // not fully paid
    });

    it('records final payment (marks as paid)', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/ap/bills/${BILL_ID}/pay?business_id=${BUSINESS_ID}`, { amount: 25000 }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.amount_paid).toBe(50000);
      expect(body.data.status).toBe('paid');
    });

    it('calculates AP total', async () => {
      // Create an unpaid bill
      await request('POST', '/api/v1/ap/bills', {
        business_id: BUSINESS_ID, vendor_id: VENDOR_ID, amount: 30000, due_date: '2026-08-01',
      }, ownerToken);

      const total = await billsService.getAccountsPayableTotal(BUSINESS_ID);
      expect(total).toBe(30000); // only the unpaid one
    });

    it('marks overdue bills', async () => {
      // Create a past-due bill
      await adminPool.query(
        `INSERT INTO bills (business_id, vendor_id, amount, due_date, status) VALUES ($1, $2, 10000, '2025-01-01', 'pending')`,
        [BUSINESS_ID, VENDOR_ID],
      );
      const overdue = await billsService.markOverdueBills();
      expect(overdue).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== Expenses ====================
  describe('Expenses', () => {
    it('creates an expense', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/ap/expenses', {
        business_id: BUSINESS_ID, date: '2026-06-10', amount: 15000,
        description: 'Office supplies', payment_method: 'credit_card',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.amount).toBe(15000);
      expect(body.data.status).toBe('pending');
      EXPENSE_ID = body.data.id;
    });

    it('lists expenses', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/ap/expenses?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('approves an expense', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/ap/expenses/${EXPENSE_ID}/approve?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.approved).toBe(true);
    });

    it('rejects re-approval', async () => {
      const { statusCode } = await request('PUT', `/api/v1/ap/expenses/${EXPENSE_ID}/approve?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(400);
    });
  });
});
