/**
 * Integration tests for the Customer Management system (Phase 05).
 * These tests verify cross-cutting behavior across multiple services.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as lifecycleService from '../src/services/customer-lifecycle.service';
import * as importService from '../src/services/customer-import.service';
import * as duplicateService from '../src/services/customer-duplicates.service';
import { createActivity } from '../src/services/customer-activity.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let BUSINESS_ID_2: string;
let ownerToken: string;
let staffToken: string;
let customerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: address.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData) }); }
          catch { resolve({ statusCode: res.statusCode!, body: responseData }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Customer Management — Integration Tests', () => {
  beforeAll(async () => {
    // Create two businesses for scoping tests
    const { rows: biz1 } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Integration Biz 1', 'integration-biz-1', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Integration Biz 1'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = biz1[0].id;

    const { rows: biz2 } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Integration Biz 2', 'integration-biz-2', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Integration Biz 2'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID_2 = biz2[0].id;

    // Seed lifecycle config
    await adminPool.query(`
      INSERT INTO configuration_definitions (key, category, data_type, default_value, description) VALUES
        ('lifecycle.trial_after_bookings', 'lifecycle', 'number', '1', 'Bookings for Lead → Trial'),
        ('lifecycle.active_after_visits', 'lifecycle', 'number', '3', 'Visits for Trial → Active'),
        ('lifecycle.at_risk_days', 'lifecycle', 'number', '30', 'Days for Active → At-Risk'),
        ('lifecycle.churned_days', 'lifecycle', 'number', '90', 'Days for At-Risk → Churned')
      ON CONFLICT (key) DO NOTHING
    `);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );

    staffToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000020', TENANT_ID, 'business_staff',
      ['customers:read'],
    );

    customerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000030', TENANT_ID, 'customer',
      [],
    );
  });

  describe('13.2.1 Full Customer Lifecycle (create → book → active → at-risk → churned)', () => {
    let customerId: string;

    it('creates a customer in lead stage', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'lifecycle-full@example.com',
        first_name: 'Lifecycle',
        last_name: 'Full',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.lifecycle_stage).toBe('lead');
      customerId = body.data.id;
    });

    it('transitions Lead → Trial on first booking', async () => {
      await createActivity({
        customerId, businessId: BUSINESS_ID,
        activityType: 'booking', description: 'Booked: Test Session',
      });

      await lifecycleService.evaluateOnBooking(customerId, BUSINESS_ID);

      const { rows } = await adminPool.query('SELECT lifecycle_stage FROM customers WHERE id = $1', [customerId]);
      expect(rows[0].lifecycle_stage).toBe('trial');
    });

    it('transitions Trial → Active on membership purchase', async () => {
      await lifecycleService.evaluateOnMembership(customerId, BUSINESS_ID);

      const { rows } = await adminPool.query('SELECT lifecycle_stage FROM customers WHERE id = $1', [customerId]);
      expect(rows[0].lifecycle_stage).toBe('active');
    });

    it('transitions Active → At-Risk after inactivity', async () => {
      // Remove recent activities
      await adminPool.query(
        "DELETE FROM customer_activities WHERE customer_id = $1 AND activity_type IN ('booking', 'payment', 'membership')",
        [customerId],
      );
      // Add old activity (40 days ago)
      await adminPool.query(
        `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, created_at)
         VALUES ($1, $2, 'booking', 'Old session', NOW() - INTERVAL '40 days')`,
        [customerId, BUSINESS_ID],
      );

      await lifecycleService.evaluateScheduledTransitions();

      const { rows } = await adminPool.query('SELECT lifecycle_stage FROM customers WHERE id = $1', [customerId]);
      expect(rows[0].lifecycle_stage).toBe('at_risk');
    });

    it('transitions At-Risk → Churned after extended inactivity', async () => {
      // Remove all recent activities
      await adminPool.query(
        "DELETE FROM customer_activities WHERE customer_id = $1 AND activity_type IN ('booking', 'payment', 'membership')",
        [customerId],
      );
      // Add very old activity (100 days ago)
      await adminPool.query(
        `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, created_at)
         VALUES ($1, $2, 'booking', 'Very old session', NOW() - INTERVAL '100 days')`,
        [customerId, BUSINESS_ID],
      );

      await lifecycleService.evaluateScheduledTransitions();

      const { rows } = await adminPool.query('SELECT lifecycle_stage FROM customers WHERE id = $1', [customerId]);
      expect(rows[0].lifecycle_stage).toBe('churned');
    });

    it('transitions Churned → Winback on new booking', async () => {
      await lifecycleService.evaluateOnBooking(customerId, BUSINESS_ID);

      const { rows } = await adminPool.query('SELECT lifecycle_stage FROM customers WHERE id = $1', [customerId]);
      expect(rows[0].lifecycle_stage).toBe('winback');
    });

    it('records all transitions in activity timeline', async () => {
      const { rows } = await adminPool.query(
        "SELECT * FROM customer_activities WHERE customer_id = $1 AND activity_type = 'lifecycle' ORDER BY created_at",
        [customerId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(4); // lead→trial, trial→active, active→at_risk, at_risk→churned, churned→winback
    });
  });

  describe('13.2.2 GDPR Anonymization (verify PII removed, transactions retained)', () => {
    let customerId: string;

    it('creates customer with full profile + activities', async () => {
      const { body } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'gdpr-test@example.com',
        first_name: 'GDPR',
        last_name: 'Test',
        phone: '+34666777888',
        date_of_birth: '1990-05-15',
        gender: 'female',
      }, ownerToken);
      customerId = body.data.id;

      // Add activities
      await createActivity({ customerId, businessId: BUSINESS_ID, activityType: 'booking', description: 'Booked: Massage' });
      await createActivity({ customerId, businessId: BUSINESS_ID, activityType: 'payment', description: 'Payment: €50.00', metadata: { amount: 5000 } });
    });

    it('anonymizes all PII', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${customerId}/anonymize?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('anonymized');
    });

    it('verifies PII is removed', async () => {
      const { rows } = await adminPool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      const customer = rows[0];

      expect(customer.first_name).toBe('[deleted]');
      expect(customer.last_name).toBe('[deleted]');
      expect(customer.email).toContain('anonymized-');
      expect(customer.phone).toBeNull();
      expect(customer.date_of_birth).toBeNull();
      expect(customer.gender).toBeNull();
      expect(customer.anonymized_at).not.toBeNull();
      expect(customer.anonymized_by).not.toBeNull();
    });

    it('retains activity/transaction history (non-PII)', async () => {
      const { rows } = await adminPool.query(
        'SELECT * FROM customer_activities WHERE customer_id = $1',
        [customerId],
      );
      // Activities should still exist
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.some((a: any) => a.activity_type === 'payment')).toBe(true);
    });

    it('notes content is deleted', async () => {
      const { rows } = await adminPool.query(
        'SELECT * FROM customer_notes WHERE customer_id = $1',
        [customerId],
      );
      expect(rows.length).toBe(0);
    });
  });

  describe('13.2.3 CSV Import End-to-End (upload → validate → confirm)', () => {
    it('validates CSV with errors', () => {
      const csv = 'Email,First,Last\njohn@test.com,John,Doe\n,Missing,Email\nbad-email,Bad,Format';
      const result = importService.validateImport(csv, {
        Email: 'email', First: 'first_name', Last: 'last_name',
      });

      expect(result.valid).toBe(false);
      expect(result.total).toBe(3);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.row === 3 && e.field === 'email')).toBe(true);
      expect(result.errors.some((e) => e.row === 4 && e.message.includes('Invalid email'))).toBe(true);
    });

    it('imports valid rows and skips invalid ones', async () => {
      const csv = 'Email,First,Last,Phone\nimport-int1@example.com,Import,One,+111\nimport-int2@example.com,Import,Two,+222\n,Missing,Email,+333';
      const result = await importService.executeImport(
        csv,
        { Email: 'email', First: 'first_name', Last: 'last_name', Phone: 'phone' },
        BUSINESS_ID,
        TENANT_ID,
        '00000000-0000-0000-0000-000000000010',
      );

      expect(result.total).toBe(3);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
    });

    it('imported customers are accessible via API', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers?business_id=${BUSINESS_ID}&search=import-int1`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.some((c: any) => c.email === 'import-int1@example.com')).toBe(true);
    });

    it('rejects duplicate imports', async () => {
      const csv = 'Email,First,Last\nimport-int1@example.com,Duplicate,Import';
      const result = await importService.executeImport(
        csv,
        { Email: 'email', First: 'first_name', Last: 'last_name' },
        BUSINESS_ID,
        TENANT_ID,
        '00000000-0000-0000-0000-000000000010',
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('13.2.4 Customer Portal Self-Service', () => {
    let portalCustomerId: string;
    let portalUserToken: string;

    beforeAll(async () => {
      // Create a user + customer with matching email for portal access
      const portalEmail = 'portal-test@example.com';

      await adminPool.query(
        `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
         VALUES ('00000000-0000-0000-0000-000000000040', $1, $2, 'Portal', 'User', 'hashed', 'customer', 'active')
         ON CONFLICT (id) DO UPDATE SET email = $2`,
        [TENANT_ID, portalEmail],
      );

      const { rows } = await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-PORTAL', $3, 'Portal', 'User', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Portal'
         RETURNING id`,
        [TENANT_ID, BUSINESS_ID, portalEmail],
      );
      portalCustomerId = rows[0].id;

      // Create preferences
      await adminPool.query(
        'INSERT INTO customer_preferences (customer_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [portalCustomerId],
      );

      portalUserToken = authService.generateAccessToken(
        '00000000-0000-0000-0000-000000000040', TENANT_ID, 'customer', [],
      );
    });

    it('GET /profile/customer returns own profile', async () => {
      const { statusCode, body } = await request(
        'GET', '/api/v1/profile/customer',
        undefined, portalUserToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.email).toBe('portal-test@example.com');
      expect(body.data.first_name).toBe('Portal');
    });

    it('PUT /profile/customer updates contact info', async () => {
      const { statusCode, body } = await request(
        'PUT', '/api/v1/profile/customer',
        { phone: '+34999888777' },
        portalUserToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.phone).toBe('+34999888777');
    });

    it('GET /profile/customer/activities returns own timeline', async () => {
      // Add an activity first
      await createActivity({
        customerId: portalCustomerId, businessId: BUSINESS_ID,
        activityType: 'booking', description: 'Portal user booking',
      });

      const { statusCode, body } = await request(
        'GET', '/api/v1/profile/customer/activities',
        undefined, portalUserToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /profile/customer/export returns GDPR data', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/profile/customer/export',
        undefined, portalUserToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.format).toBe('GDPR_DATA_EXPORT');
      expect(body.data.personal_data.email).toBe('portal-test@example.com');
    });

    it('POST /profile/customer/delete submits deletion request', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/profile/customer/delete',
        undefined, portalUserToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.message).toContain('Deletion request submitted');

      // Check activity log records the request
      const { rows } = await adminPool.query(
        "SELECT * FROM customer_activities WHERE customer_id = $1 AND description LIKE '%Deletion request%'",
        [portalCustomerId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('13.2.5 Business Scoping (cannot access other business customers)', () => {
    let bizOneCustomerId: string;

    beforeAll(async () => {
      // Create customer in business 1
      const { rows } = await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-SCOPE1', 'scoped@example.com', 'Scoped', 'Customer', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Scoped'
         RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );
      bizOneCustomerId = rows[0].id;
    });

    it('cannot access customer with wrong business_id', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/${bizOneCustomerId}?business_id=${BUSINESS_ID_2}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(404);
    });

    it('customer list is scoped to business', async () => {
      const { body: biz1Result } = await request(
        'GET', `/api/v1/customers?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      const { body: biz2Result } = await request(
        'GET', `/api/v1/customers?business_id=${BUSINESS_ID_2}`,
        undefined, ownerToken,
      );

      // Business 2 should not contain business 1's customers
      const biz2Emails = biz2Result.data.map((c: any) => c.email);
      expect(biz2Emails).not.toContain('scoped@example.com');
    });
  });

  describe('13.1.9 Reference Number Generation', () => {
    it('generates sequential reference numbers per business', async () => {
      const { body: c1 } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID_2,
        email: 'ref-test-1@example.com', first_name: 'Ref', last_name: 'One',
      }, ownerToken);

      const { body: c2 } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID_2,
        email: 'ref-test-2@example.com', first_name: 'Ref', last_name: 'Two',
      }, ownerToken);

      expect(c1.data.reference_number).toMatch(/^CUST-\d{4}$/);
      expect(c2.data.reference_number).toMatch(/^CUST-\d{4}$/);

      // Second should be greater than first
      const num1 = parseInt(c1.data.reference_number.replace('CUST-', ''), 10);
      const num2 = parseInt(c2.data.reference_number.replace('CUST-', ''), 10);
      expect(num2).toBeGreaterThan(num1);
    });
  });

  describe('13.1.7 Duplicate Detection', () => {
    beforeAll(async () => {
      await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, created_by)
         VALUES ($1, $2, 'CUST-DUP-INT', 'dup-detect@example.com', 'Duplicate', 'Detect', '+34555666', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO NOTHING`,
        [TENANT_ID, BUSINESS_ID],
      );
    });

    it('finds duplicates by email', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'dup-detect@example.com');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].confidence).toBe(1.0);
    });

    it('finds duplicates by phone', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'unique@example.com', '+34555666');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].match_type).toBe('phone');
    });

    it('finds duplicates by name', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'unique@example.com', undefined, 'Duplicate', 'Detect');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].match_type).toBe('name');
    });
  });
});
