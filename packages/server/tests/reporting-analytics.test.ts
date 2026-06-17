import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: { 'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      };
      const req = http.request(options, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => { server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); }
          catch { resolve({ statusCode: res.statusCode!, body: d }); } });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data); req.end();
    });
  });
}

describe('Reporting & Analytics', () => {
  beforeAll(() => {
    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['reports:*', 'reports:read'],
    );
  });

  describe('Dashboard', () => {
    it('gets dashboard data', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/dashboard', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('widgets');
      expect(body.data).toHaveProperty('dateRange');
    });

    it('gets dashboard config', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/dashboard/config', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('widgets');
    });
  });

  describe('Domain Reports', () => {
    it('gets revenue report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/revenue', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('totalRevenue');
      expect(body.data).toHaveProperty('trend');
    });

    it('gets bookings report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/bookings', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('totalBookings');
      expect(body.data).toHaveProperty('peakTimes');
    });

    it('gets memberships report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/memberships', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('activeCount');
      expect(body.data).toHaveProperty('churnRate');
    });

    it('gets staff report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/staff', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('staff');
      expect(body.data).toHaveProperty('summary');
    });

    it('gets customers report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/customers', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('activeCount');
      expect(body.data).toHaveProperty('topCustomers');
    });

    it('gets financial report', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/financial', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('profitAndLoss');
      expect(body.data).toHaveProperty('apAging');
      expect(body.data).toHaveProperty('arAging');
    });
  });

  describe('Aggregation', () => {
    it('triggers aggregation for a date', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/reports/aggregate', {
        date: '2026-06-15',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.aggregated).toBe(true);
    });
  });

  describe('Scheduled Reports', () => {
    let scheduleId: string;

    it('creates a scheduled report', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/reports/scheduled', {
        name: 'Weekly Summary', schedule_type: 'weekly',
        report_types: ['revenue', 'bookings'],
        recipients: [{ email: 'owner@test.com' }],
        format: 'pdf',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Weekly Summary');
      scheduleId = body.data.id;
    });

    it('lists scheduled reports', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/scheduled', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('deletes a scheduled report', async () => {
      const { statusCode } = await request('DELETE', `/api/v1/reports/scheduled/${scheduleId}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
    });
  });

  describe('Export', () => {
    it('exports bookings as CSV', async () => {
      const { statusCode } = await request('GET', '/api/v1/reports/bookings/export?format=csv', undefined, ownerToken);
      expect(statusCode).toBe(200);
    });

    it('exports revenue as JSON', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/reports/revenue/export?format=json', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
