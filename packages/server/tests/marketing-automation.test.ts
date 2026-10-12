import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';
import * as engine from '../src/services/sequence-engine.service';
import * as notifications from '../src/services/booking-notifications.service';
import { findOrCreatePerson } from '../src/services/person-identity.service';
import { resetBusinessData } from './helpers/test-business';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let TEMPLATE_ID: string;
let CAMPAIGN_ID: string;
let SEQUENCE_ID: string;
let ownerToken: string;
// Marketing belongs to a business (Phase 46 R14): the tests use two dedicated ones.
let BUSINESS_ID: string;
let OTHER_BUSINESS_ID: string;

async function testBusiness(name: string, slug: string): Promise<string> {
  const { rows } = await adminPool.query(
    `INSERT INTO sys_businesses (tenant_id, name, slug, status, phone)
     VALUES ($1, $2, $3, 'active', '+34971000000')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_ID, name, slug],
  );
  // Marketing rows of earlier runs point at people and segments: remove them before the reset.
  await adminPool.query('DELETE FROM mkt_lead_funnels WHERE business_id = $1', [rows[0].id]);
  await adminPool.query('DELETE FROM mkt_campaigns WHERE business_id = $1', [rows[0].id]);
  await adminPool.query('DELETE FROM mkt_sequences WHERE business_id = $1', [rows[0].id]);
  await adminPool.query('DELETE FROM mkt_message_templates WHERE business_id = $1', [rows[0].id]);
  await resetBusinessData(rows[0].id);
  return rows[0].id;
}

/** Adds the business to a marketing address, as the client does for every request. */
function inBusiness(path: string, businessId: string = BUSINESS_ID): string {
  return `${path}${path.includes('?') ? '&' : '?'}business_id=${businessId}`;
}

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
    BUSINESS_ID = await testBusiness('Marketing Test Biz', 'marketing-test-biz');
    OTHER_BUSINESS_ID = await testBusiness('Marketing Other Test Biz', 'marketing-other-test-biz');
    // A tenant-level user (not tied to one business), so both test businesses are reachable.
    const { rows: tenantUsers } = await adminPool.query(
      `SELECT id FROM usr_users WHERE tenant_id = $1 AND business_id IS NULL AND status = 'active' ORDER BY created_at LIMIT 1`,
      [TENANT_ID],
    );
    ownerToken = authService.generateAccessToken(
      tenantUsers[0].id, TENANT_ID, 'tenant_owner',
      ['marketing:*', 'marketing:read'],
    );
  });

  describe('Templates', () => {
    it('creates an email template', async () => {
      const { statusCode, body } = await request('POST', inBusiness('/api/v1/marketing/templates'), {
        name: 'Welcome Email', channel: 'email', subject: 'Welcome {{first_name}}!',
        htmlContent: '<h1>Hello {{first_name}}</h1><p>Welcome to our studio.</p>',
        category: 'welcome',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Welcome Email');
      TEMPLATE_ID = body.data.id;
    });

    it('lists templates', async () => {
      const { statusCode, body } = await request('GET', inBusiness('/api/v1/marketing/templates'), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('previews a template with data', async () => {
      const { statusCode, body } = await request('POST', inBusiness(`/api/v1/marketing/templates/${TEMPLATE_ID}/preview`), {
        first_name: 'Jane',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.subject).toBe('Welcome Jane!');
      expect(body.data.htmlContent).toContain('Hello Jane');
    });

    it('deletes a template', async () => {
      // Create one to delete
      const { body: created } = await request('POST', inBusiness('/api/v1/marketing/templates'), {
        name: 'To Delete', channel: 'sms', textContent: 'Test',
      }, ownerToken);
      const { statusCode } = await request('DELETE', inBusiness(`/api/v1/marketing/templates/${created.data.id}`), undefined, ownerToken);
      expect(statusCode).toBe(200);
    });
  });

  describe('Campaigns', () => {
    it('creates a campaign', async () => {
      const { statusCode, body } = await request('POST', inBusiness('/api/v1/marketing/campaigns'), {
        name: 'Summer Promo', channel: 'email', subject: 'Summer Special!',
        htmlContent: '<p>50% off this week</p>',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Summer Promo');
      expect(body.data.status).toBe('draft');
      CAMPAIGN_ID = body.data.id;
    });

    it('lists campaigns', async () => {
      const { statusCode, body } = await request('GET', inBusiness('/api/v1/marketing/campaigns'), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('schedules a campaign', async () => {
      const { statusCode, body } = await request('POST', inBusiness(`/api/v1/marketing/campaigns/${CAMPAIGN_ID}/schedule`), {
        scheduled_at: '2026-07-01T10:00:00Z',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('scheduled');
    });

    it('gets campaign analytics', async () => {
      const { statusCode, body } = await request('GET', inBusiness(`/api/v1/marketing/campaigns/${CAMPAIGN_ID}/analytics`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('sent');
      expect(body.data).toHaveProperty('openRate');
    });
  });

  describe('Sequences', () => {
    it('creates a sequence', async () => {
      const { statusCode, body } = await request('POST', inBusiness('/api/v1/marketing/sequences'), {
        name: 'Welcome Series', description: 'Onboarding flow for new customers',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Welcome Series');
      expect(body.data.status).toBe('draft');
      SEQUENCE_ID = body.data.id;
    });

    it('gets a sequence with steps/connections', async () => {
      const { statusCode, body } = await request('GET', inBusiness(`/api/v1/marketing/sequences/${SEQUENCE_ID}`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('steps');
      expect(body.data).toHaveProperty('connections');
    });

    it('validates a sequence (fails without start/end)', async () => {
      const { statusCode, body } = await request('POST', inBusiness(`/api/v1/marketing/sequences/${SEQUENCE_ID}/validate`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.errors.length).toBeGreaterThan(0);
    });

    it('activates a sequence', async () => {
      const { statusCode, body } = await request('POST', inBusiness(`/api/v1/marketing/sequences/${SEQUENCE_ID}/activate`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('active');
    });

    it('pauses a sequence', async () => {
      const { statusCode, body } = await request('POST', inBusiness(`/api/v1/marketing/sequences/${SEQUENCE_ID}/pause`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('paused');
    });

    it('lists sequences', async () => {
      const { statusCode, body } = await request('GET', inBusiness('/api/v1/marketing/sequences'), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Consent', () => {
    it('gets preferences for a person of this business', async () => {
      const { person } = await findOrCreatePerson({ businessId: BUSINESS_ID, tenantId: TENANT_ID, email: 'mkt-prefs@example.com', firstName: 'Prefs', source: 'manual' });
      const { statusCode, body } = await request('GET', inBusiness(`/api/v1/marketing/preferences/${person.id}`), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('does not find a person who is not in this business', async () => {
      const { statusCode } = await request('GET', inBusiness('/api/v1/marketing/preferences/00000000-0000-0000-0000-000000000099'), undefined, ownerToken);
      expect(statusCode).toBe(404);
    });
  });

  describe('Funnels', () => {
    it('creates a funnel', async () => {
      const { statusCode, body } = await request('POST', inBusiness('/api/v1/marketing/funnels'), {
        name: 'Free Trial', slug: `free-trial-${Date.now()}`, headline: 'Try Us Free!',
        formFields: [{ name: 'email', type: 'email', required: true }],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Free Trial');
    });

    it('lists funnels', async () => {
      const { statusCode, body } = await request('GET', inBusiness('/api/v1/marketing/funnels'), undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Business scope (spec 46 R14)', () => {
    it('refuses a request that names no business', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/marketing/campaigns', undefined, ownerToken);
      expect(statusCode).toBe(400);
      expect(body.code).toBe('BUSINESS_REQUIRED');
    });

    it('refuses a user of one business asking for another', async () => {
      // The seeded business owner belongs to the seeded business.
      const seedOwner = authService.generateAccessToken('00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner', ['marketing:*']);
      const { rows } = await adminPool.query(`SELECT business_id FROM usr_users WHERE id = '00000000-0000-0000-0000-000000000010'`);
      if (!rows[0]?.business_id) return; // seed user not present in this database
      const { statusCode } = await request('GET', inBusiness('/api/v1/marketing/campaigns'), undefined, seedOwner);
      expect(statusCode).toBe(403);
    });

    it('keeps the campaigns, sequences, templates and lead forms of two businesses apart', async () => {
      const made: Record<string, string> = {};
      for (const [kind, payload] of Object.entries({
        campaigns: { name: 'Scope campaign', channel: 'email', subject: 'Scope' },
        sequences: { name: 'Scope sequence' },
        templates: { name: 'Scope template', channel: 'email', subject: 'Scope' },
        funnels: { name: 'Scope form', slug: `scope-form-${Date.now()}` },
      })) {
        const created = await request('POST', inBusiness(`/api/v1/marketing/${kind}`), payload, ownerToken);
        expect(created.statusCode).toBe(201);
        expect(created.body.data.business_id).toBe(BUSINESS_ID);
        made[kind] = created.body.data.id;

        const own = await request('GET', inBusiness(`/api/v1/marketing/${kind}`), undefined, ownerToken);
        expect(own.body.data.some((r: any) => r.id === made[kind])).toBe(true);
        const other = await request('GET', inBusiness(`/api/v1/marketing/${kind}`, OTHER_BUSINESS_ID), undefined, ownerToken);
        expect(other.body.data.some((r: any) => r.id === made[kind])).toBe(false);
      }

      // Addressed by id from the other business, each one is "not found".
      expect((await request('GET', inBusiness(`/api/v1/marketing/campaigns/${made.campaigns}`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('POST', inBusiness(`/api/v1/marketing/campaigns/${made.campaigns}/send`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('GET', inBusiness(`/api/v1/marketing/campaigns/${made.campaigns}/recipients`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('GET', inBusiness(`/api/v1/marketing/sequences/${made.sequences}`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('GET', inBusiness(`/api/v1/marketing/sequences/${made.sequences}/enrollments`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('GET', inBusiness(`/api/v1/marketing/templates/${made.templates}`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      expect((await request('GET', inBusiness(`/api/v1/marketing/funnels/${made.funnels}/analytics`, OTHER_BUSINESS_ID), undefined, ownerToken)).statusCode).toBe(404);
      // ...and still reachable from its own.
      expect((await request('GET', inBusiness(`/api/v1/marketing/campaigns/${made.campaigns}`), undefined, ownerToken)).statusCode).toBe(200);
    });

    it('refuses a campaign whose audience is a segment of another business', async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO cus_segments (business_id, name, rules, is_predefined, kind) VALUES ($1, 'Other business list', '{"logic":"AND","rules":[]}', false, 'static') RETURNING id`,
        [OTHER_BUSINESS_ID],
      );
      const res = await request('POST', inBusiness('/api/v1/marketing/campaigns'), { name: 'Wrong audience', channel: 'email', segmentId: rows[0].id }, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/another business/);
    });

    it('a sequence does not take a person of another business', async () => {
      const seq = await request('POST', inBusiness('/api/v1/marketing/sequences'), { name: 'Scope enrol' }, ownerToken);
      const { person } = await findOrCreatePerson({ businessId: OTHER_BUSINESS_ID, tenantId: TENANT_ID, email: 'mkt-other@example.com', firstName: 'Other', source: 'manual' });
      await expect(engine.enrollCustomer(seq.body.data.id, person.id)).rejects.toThrow(/another business/);
    });
  });

  describe('Consent before a message (spec 46 R10)', () => {
    it('a sequence message step is skipped for someone who has not agreed, and the reason is recorded', async () => {
      const { person } = await findOrCreatePerson({ businessId: BUSINESS_ID, tenantId: TENANT_ID, email: 'mkt-noconsent@example.com', firstName: 'NoConsent', source: 'manual' });
      const { rows: seq } = await adminPool.query(`INSERT INTO mkt_sequences (tenant_id, business_id, name) VALUES ($1, $2, 'Consent sequence') RETURNING id`, [TENANT_ID, BUSINESS_ID]);
      const { rows: step } = await adminPool.query(
        `INSERT INTO mkt_sequence_steps (sequence_id, step_category, step_type, config) VALUES ($1, 'output', 'send_email', '{}') RETURNING *`,
        [seq[0].id],
      );
      const { rows: enrol } = await adminPool.query(
        `INSERT INTO mkt_sequence_enrollments (sequence_id, customer_id, current_step_id) VALUES ($1, $2, $3) RETURNING *`,
        [seq[0].id, person.id, step[0].id],
      );
      const result = await engine.executeStep(step[0], enrol[0]);
      expect(result.reason).toBe('skipped:no_consent');
      const { rows: history } = await adminPool.query(`SELECT action, details FROM mkt_sequence_history WHERE sequence_id = $1 AND customer_id = $2`, [seq[0].id, person.id]);
      expect(history.some((h: any) => h.action === 'skipped' && h.details.reason === 'no_consent')).toBe(true);
    });

    it('a booking reminder is not queued for someone who switched reminders off', async () => {
      const { person } = await findOrCreatePerson({ businessId: BUSINESS_ID, tenantId: TENANT_ID, email: 'mkt-noreminder@example.com', firstName: 'NoReminder', source: 'manual' });
      const booking = (ref: string) => ({ business_id: BUSINESS_ID, customer_id: person.id, booking_reference: ref, start_time: new Date(Date.now() + 72 * 3600 * 1000).toISOString() });
      const queued = async (ref: string) => (await adminPool.query(
        `SELECT COUNT(*)::int AS n FROM apt_notification_queue WHERE type = 'booking.reminder' AND recipient_id = $1 AND data->>'booking_reference' = $2`,
        [person.id, ref],
      )).rows[0].n;

      await notifications.queueBookingReminder(booking('MKT-REM-ON'), person.email, [24]);
      expect(await queued('MKT-REM-ON')).toBe(1);

      await adminPool.query(
        `INSERT INTO mkt_communication_preferences (tenant_id, business_id, customer_id, channel, category, opted_in, source)
         VALUES ($1, $2, $3, 'email', 'reminders', false, 'test')
         ON CONFLICT (tenant_id, customer_id, channel, category) DO UPDATE SET opted_in = false`,
        [TENANT_ID, BUSINESS_ID, person.id],
      );
      await notifications.queueBookingReminder(booking('MKT-REM-OFF'), person.email, [24]);
      expect(await queued('MKT-REM-OFF')).toBe(0);
    });
  });
});
