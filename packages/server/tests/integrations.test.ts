import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let ownerToken: string;
let WEBHOOK_ID: string;
let API_KEY_ID: string;
let API_KEY_RAW: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      };
      const req = http.request(options, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { server.close(); try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); } catch { resolve({ statusCode: res.statusCode!, body: d }); } }); });
      req.on('error', (err) => { server.close(); reject(err); }); if (data) req.write(data); req.end();
    });
  });
}

describe('Integrations', () => {
  beforeAll(() => {
    ownerToken = authService.generateAccessToken('00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner', ['integrations:*', 'integrations:read']);
  });

  describe('Marketplace', () => {
    it('returns available integrations with status', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/integrations/marketplace', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('connectionStatus');
    });
  });

  describe('Webhooks', () => {
    it('creates a webhook subscription', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/integrations/webhooks', {
        url: 'https://example.com/webhook', event_types: ['booking.created', 'booking.cancelled'],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.url).toBe('https://example.com/webhook');
      expect(body.data.secret).toBeTruthy();
      WEBHOOK_ID = body.data.id;
    });

    it('lists webhooks', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/integrations/webhooks', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('gets deliveries', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/integrations/webhooks/${WEBHOOK_ID}/deliveries`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('deletes a webhook', async () => {
      const { statusCode } = await request('DELETE', `/api/v1/integrations/webhooks/${WEBHOOK_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
    });
  });

  describe('API Keys', () => {
    it('creates an API key', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/integrations/api-keys', {
        name: 'Test Key', scopes: ['bookings:read', 'customers:read'],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.key).toMatch(/^dsk_live_/);
      expect(body.data.key.length).toBeGreaterThan(30);
      API_KEY_ID = body.data.id;
      API_KEY_RAW = body.data.key;
    });

    it('lists API keys (prefix only)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/integrations/api-keys', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      // Should NOT contain the full key
      expect(body.data[0].key).toBeUndefined();
      expect(body.data[0].key_prefix).toBeTruthy();
    });

    it('deletes an API key', async () => {
      const { statusCode } = await request('DELETE', `/api/v1/integrations/api-keys/${API_KEY_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
    });
  });

  describe('iCal Feeds', () => {
    it('gets or creates a staff iCal feed', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/integrations/ical/staff', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.feed_token).toBeTruthy();
      expect(body.data.feed_type).toBe('staff');
    });

    it('serves iCal content by token', async () => {
      const { body: feedBody } = await request('GET', '/api/v1/integrations/ical/staff', undefined, ownerToken);
      const { statusCode, body } = await request('GET', `/api/v1/integrations/ical/${feedBody.data.feed_token}`);
      expect(statusCode).toBe(200);
      expect(typeof body).toBe('string');
      expect(body).toContain('BEGIN:VCALENDAR');
    });
  });

  describe('Connections', () => {
    it('lists connections (empty initially)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/integrations', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
