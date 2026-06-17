import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let TEMPLATE_ID: string;
let CAMPAIGN_ID: string;
let SEQUENCE_ID: string;
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

describe('Marketing & Automation', () => {
  beforeAll(async () => {
    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['marketing:*', 'marketing:read'],
    );
  });

  describe('Templates', () => {
    it('creates an email template', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/marketing/templates', {
        name: 'Welcome Email', channel: 'email', subject: 'Welcome {{first_name}}!',
        htmlContent: '<h1>Hello {{first_name}}</h1><p>Welcome to our studio.</p>',
        category: 'welcome',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Welcome Email');
      TEMPLATE_ID = body.data.id;
    });

    it('lists templates', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/templates', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('previews a template with data', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/marketing/templates/${TEMPLATE_ID}/preview`, {
        first_name: 'Jane',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.subject).toBe('Welcome Jane!');
      expect(body.data.htmlContent).toContain('Hello Jane');
    });

    it('deletes a template', async () => {
      // Create one to delete
      const { body: created } = await request('POST', '/api/v1/marketing/templates', {
        name: 'To Delete', channel: 'sms', textContent: 'Test',
      }, ownerToken);
      const { statusCode } = await request('DELETE', `/api/v1/marketing/templates/${created.data.id}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
    });
  });

  describe('Campaigns', () => {
    it('creates a campaign', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/marketing/campaigns', {
        name: 'Summer Promo', channel: 'email', subject: 'Summer Special!',
        htmlContent: '<p>50% off this week</p>',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Summer Promo');
      expect(body.data.status).toBe('draft');
      CAMPAIGN_ID = body.data.id;
    });

    it('lists campaigns', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/campaigns', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('schedules a campaign', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/marketing/campaigns/${CAMPAIGN_ID}/schedule`, {
        scheduled_at: '2026-07-01T10:00:00Z',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('scheduled');
    });

    it('gets campaign analytics', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/marketing/campaigns/${CAMPAIGN_ID}/analytics`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('sent');
      expect(body.data).toHaveProperty('openRate');
    });
  });

  describe('Sequences', () => {
    it('creates a sequence', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/marketing/sequences', {
        name: 'Welcome Series', description: 'Onboarding flow for new customers',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Welcome Series');
      expect(body.data.status).toBe('draft');
      SEQUENCE_ID = body.data.id;
    });

    it('gets a sequence with steps/connections', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/marketing/sequences/${SEQUENCE_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('steps');
      expect(body.data).toHaveProperty('connections');
    });

    it('validates a sequence (fails without start/end)', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/marketing/sequences/${SEQUENCE_ID}/validate`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.errors.length).toBeGreaterThan(0);
    });

    it('activates a sequence', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/marketing/sequences/${SEQUENCE_ID}/activate`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('active');
    });

    it('pauses a sequence', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/marketing/sequences/${SEQUENCE_ID}/pause`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('paused');
    });

    it('lists sequences', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/sequences', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Consent', () => {
    it('gets preferences (empty for new customer)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/preferences/00000000-0000-0000-0000-000000000099', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Funnels', () => {
    it('creates a funnel', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/marketing/funnels', {
        name: 'Free Trial', slug: `free-trial-${Date.now()}`, headline: 'Try Us Free!',
        formFields: [{ name: 'email', type: 'email', required: true }],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Free Trial');
    });

    it('lists funnels', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/funnels', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
