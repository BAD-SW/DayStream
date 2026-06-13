import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as lifecycleService from '../src/services/customer-lifecycle.service';
import { createActivity } from '../src/services/customer-activity.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let CUSTOMER_ID_2: string;
let CUSTOMER_ID_3: string;
let ownerToken: string;

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

describe('Customer Lifecycle Tracking', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Lifecycle Test Biz', 'lifecycle-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Lifecycle Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Seed lifecycle config keys if not present
    await adminPool.query(`
      INSERT INTO configuration_definitions (key, category, data_type, default_value, description) VALUES
        ('lifecycle.trial_after_bookings', 'lifecycle', 'number', '1', 'Bookings to transition Lead → Trial'),
        ('lifecycle.active_after_visits', 'lifecycle', 'number', '3', 'Visits to transition Trial → Active'),
        ('lifecycle.at_risk_days', 'lifecycle', 'number', '30', 'Days inactivity for Active → At-Risk'),
        ('lifecycle.churned_days', 'lifecycle', 'number', '90', 'Days inactivity for At-Risk → Churned')
      ON CONFLICT (key) DO NOTHING
    `);

    // Create test customers
    const { rows: cust1 } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, lifecycle_stage, created_by)
       VALUES ($1, $2, 'CUST-LC01', 'lifecycle1@example.com', 'Lead', 'Customer', 'lead', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET lifecycle_stage = 'lead', first_name = 'Lead'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = cust1[0].id;

    const { rows: cust2 } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, lifecycle_stage, created_by)
       VALUES ($1, $2, 'CUST-LC02', 'lifecycle2@example.com', 'Trial', 'Customer', 'trial', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET lifecycle_stage = 'trial', first_name = 'Trial'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID_2 = cust2[0].id;

    const { rows: cust3 } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, lifecycle_stage, created_by)
       VALUES ($1, $2, 'CUST-LC03', 'lifecycle3@example.com', 'Active', 'Customer', 'active', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET lifecycle_stage = 'active', first_name = 'Active'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID_3 = cust3[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  describe('Manual Override API', () => {
    it('PUT /customers/:id/lifecycle transitions stage', async () => {
      const { statusCode, body } = await request(
        'PUT',
        `/api/v1/customers/${CUSTOMER_ID}/lifecycle?business_id=${BUSINESS_ID}`,
        { lifecycle_stage: 'trial' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.from).toBe('lead');
      expect(body.data.to).toBe('trial');
    });

    it('rejects invalid lifecycle stage', async () => {
      const { statusCode } = await request(
        'PUT',
        `/api/v1/customers/${CUSTOMER_ID}/lifecycle?business_id=${BUSINESS_ID}`,
        { lifecycle_stage: 'invalid_stage' },
        ownerToken,
      );

      expect(statusCode).toBe(400);
    });

    it('returns 404 for non-existent customer', async () => {
      const { statusCode, body } = await request(
        'PUT',
        `/api/v1/customers/00000000-0000-0000-0000-999999999999/lifecycle?business_id=${BUSINESS_ID}`,
        { lifecycle_stage: 'active' },
        ownerToken,
      );

      expect(statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('requires business_id', async () => {
      const { statusCode } = await request(
        'PUT',
        `/api/v1/customers/${CUSTOMER_ID}/lifecycle`,
        { lifecycle_stage: 'active' },
        ownerToken,
      );

      expect(statusCode).toBe(400);
    });
  });

  describe('Lifecycle Summary API', () => {
    it('GET /customers/lifecycle-summary returns counts per stage', async () => {
      const { statusCode, body } = await request(
        'GET',
        `/api/v1/customers/lifecycle-summary?business_id=${BUSINESS_ID}`,
        undefined,
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('lead');
      expect(body.data).toHaveProperty('trial');
      expect(body.data).toHaveProperty('active');
      expect(body.data).toHaveProperty('at_risk');
      expect(body.data).toHaveProperty('churned');
      expect(body.data).toHaveProperty('winback');
      // All values should be numbers
      for (const stage of Object.keys(body.data)) {
        expect(typeof body.data[stage]).toBe('number');
      }
    });

    it('requires business_id', async () => {
      const { statusCode } = await request(
        'GET',
        `/api/v1/customers/lifecycle-summary`,
        undefined,
        ownerToken,
      );

      expect(statusCode).toBe(400);
    });
  });

  describe('Lifecycle Service - evaluateOnBooking', () => {
    it('transitions Lead → Trial on first booking', async () => {
      // Reset to lead
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'lead' WHERE id = $1",
        [CUSTOMER_ID],
      );

      // Create a booking activity
      await createActivity({
        customerId: CUSTOMER_ID,
        businessId: BUSINESS_ID,
        activityType: 'booking',
        description: 'Booked: Test Service',
      });

      await lifecycleService.evaluateOnBooking(CUSTOMER_ID, BUSINESS_ID);

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID],
      );
      expect(rows[0].lifecycle_stage).toBe('trial');
    });

    it('transitions Churned → Winback on new booking', async () => {
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'churned' WHERE id = $1",
        [CUSTOMER_ID],
      );

      await lifecycleService.evaluateOnBooking(CUSTOMER_ID, BUSINESS_ID);

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID],
      );
      expect(rows[0].lifecycle_stage).toBe('winback');
    });

    it('transitions At-Risk → Active on new booking', async () => {
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'at_risk' WHERE id = $1",
        [CUSTOMER_ID],
      );

      await lifecycleService.evaluateOnBooking(CUSTOMER_ID, BUSINESS_ID);

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID],
      );
      expect(rows[0].lifecycle_stage).toBe('active');
    });
  });

  describe('Lifecycle Service - evaluateOnMembership', () => {
    it('transitions Trial → Active on membership purchase', async () => {
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'trial' WHERE id = $1",
        [CUSTOMER_ID_2],
      );

      await lifecycleService.evaluateOnMembership(CUSTOMER_ID_2, BUSINESS_ID);

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID_2],
      );
      expect(rows[0].lifecycle_stage).toBe('active');
    });

    it('transitions Lead → Active on membership purchase', async () => {
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'lead' WHERE id = $1",
        [CUSTOMER_ID_2],
      );

      await lifecycleService.evaluateOnMembership(CUSTOMER_ID_2, BUSINESS_ID);

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID_2],
      );
      expect(rows[0].lifecycle_stage).toBe('active');
    });
  });

  describe('Lifecycle Service - evaluateScheduledTransitions', () => {
    it('transitions Active → At-Risk when no recent activity', async () => {
      // Set customer to active with no recent activity
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'active' WHERE id = $1",
        [CUSTOMER_ID_3],
      );

      // Remove recent activities for this customer
      await adminPool.query(
        "DELETE FROM customer_activities WHERE customer_id = $1 AND activity_type IN ('booking', 'payment', 'membership')",
        [CUSTOMER_ID_3],
      );

      // Add an old activity (40 days ago)
      await adminPool.query(
        `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, created_at)
         VALUES ($1, $2, 'booking', 'Old booking', NOW() - INTERVAL '40 days')`,
        [CUSTOMER_ID_3, BUSINESS_ID],
      );

      const result = await lifecycleService.evaluateScheduledTransitions();

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID_3],
      );
      expect(rows[0].lifecycle_stage).toBe('at_risk');
      expect(result.transitioned).toBeGreaterThanOrEqual(1);
    });

    it('transitions At-Risk → Churned when no activity in churned_days', async () => {
      // Set customer to at_risk
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'at_risk' WHERE id = $1",
        [CUSTOMER_ID_3],
      );

      // Remove recent activities
      await adminPool.query(
        "DELETE FROM customer_activities WHERE customer_id = $1 AND activity_type IN ('booking', 'payment', 'membership')",
        [CUSTOMER_ID_3],
      );

      // Add an old activity (100 days ago)
      await adminPool.query(
        `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, created_at)
         VALUES ($1, $2, 'booking', 'Very old booking', NOW() - INTERVAL '100 days')`,
        [CUSTOMER_ID_3, BUSINESS_ID],
      );

      const result = await lifecycleService.evaluateScheduledTransitions();

      const { rows } = await adminPool.query(
        'SELECT lifecycle_stage FROM customers WHERE id = $1',
        [CUSTOMER_ID_3],
      );
      expect(rows[0].lifecycle_stage).toBe('churned');
      expect(result.transitioned).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Lifecycle Configuration', () => {
    it('reads default config values', async () => {
      const config = await lifecycleService.getLifecycleConfig(BUSINESS_ID);

      expect(config['lifecycle.trial_after_bookings']).toBe(1);
      expect(config['lifecycle.active_after_visits']).toBe(3);
      expect(config['lifecycle.at_risk_days']).toBe(30);
      expect(config['lifecycle.churned_days']).toBe(90);
    });

    it('respects business-level overrides', async () => {
      // Set a business override
      await adminPool.query(
        `INSERT INTO business_configurations (business_id, key, value)
         VALUES ($1, 'lifecycle.at_risk_days', '45')
         ON CONFLICT (business_id, key) DO UPDATE SET value = '45'`,
        [BUSINESS_ID],
      );

      const config = await lifecycleService.getLifecycleConfig(BUSINESS_ID);
      expect(config['lifecycle.at_risk_days']).toBe(45);

      // Clean up
      await adminPool.query(
        "DELETE FROM business_configurations WHERE business_id = $1 AND key = 'lifecycle.at_risk_days'",
        [BUSINESS_ID],
      );
    });
  });

  describe('Activity Timeline Logging', () => {
    it('logs lifecycle transitions in activity timeline', async () => {
      await adminPool.query(
        "UPDATE customers SET lifecycle_stage = 'lead' WHERE id = $1",
        [CUSTOMER_ID],
      );

      await lifecycleService.manualOverride(
        CUSTOMER_ID, BUSINESS_ID, 'active', '00000000-0000-0000-0000-000000000010',
      );

      const { rows } = await adminPool.query(
        `SELECT * FROM customer_activities
         WHERE customer_id = $1 AND activity_type = 'lifecycle'
         ORDER BY created_at DESC LIMIT 1`,
        [CUSTOMER_ID],
      );

      expect(rows.length).toBe(1);
      expect(rows[0].description).toContain('Lead');
      expect(rows[0].description).toContain('Active');
      const metadata = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
      expect(metadata.from).toBe('lead');
      expect(metadata.to).toBe('active');
      expect(metadata.reason).toBe('Manual override by staff');
    });
  });
});
