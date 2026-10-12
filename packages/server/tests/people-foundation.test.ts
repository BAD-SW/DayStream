import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as identity from '../src/services/person-identity.service';
import * as consent from '../src/services/consent.service';
import * as contactability from '../src/services/contactability.service';
import * as segments from '../src/services/customer-segments.service';
import * as duplicates from '../src/services/customer-duplicates.service';
import * as campaigns from '../src/services/marketing-campaigns.service';
import * as funnels from '../src/services/marketing-funnels.service';
import { adminPool } from '../src/db/pool';
import { resetBusinessData } from './helpers/test-business';

/**
 * Phase 46 — People Foundation. One person record for leads and customers:
 * identity matching, partial details, source, consent, contactability, merge, segments.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_ID = '00000000-0000-0000-0000-000000000021';
let BUSINESS_ID: string;
let OTHER_BUSINESS_ID: string;
let ownerToken: string;
let staffToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        hostname: 'localhost', port: address.port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }, (res) => {
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

async function testBusiness(name: string, slug: string): Promise<string> {
  const { rows } = await adminPool.query(
    `INSERT INTO sys_businesses (tenant_id, name, slug, status, phone)
     VALUES ($1, $2, $3, 'active', '+34971000000')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
     RETURNING id`,
    [TENANT_ID, name, slug],
  );
  await resetBusinessData(rows[0].id);
  return rows[0].id;
}

const person = (over: Partial<identity.PersonInput>) => identity.findOrCreatePerson({
  businessId: BUSINESS_ID, tenantId: TENANT_ID, source: 'manual', actorUserId: STAFF_ID, ...over,
});

describe('People Foundation (spec 46)', () => {
  beforeAll(async () => {
    BUSINESS_ID = await testBusiness('People Test Biz', 'people-test-biz');
    OTHER_BUSINESS_ID = await testBusiness('People Other Test Biz', 'people-other-test-biz');
    const perms = ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*', 'marketing:*'];
    ownerToken = authService.generateAccessToken(STAFF_ID, TENANT_ID, 'business_owner', perms);
    staffToken = authService.generateAccessToken(STAFF_ID, TENANT_ID, 'Staff', ['customers:read']);
  });

  describe('Normalising contact details', () => {
    it('reads the same phone number however it is typed', () => {
      expect(identity.normalisePhone('600 111 222', 'ES')).toBe('+34600111222');
      expect(identity.normalisePhone('+34 600-111-222')).toBe('+34600111222');
      expect(identity.normalisePhone('0034600111222', 'ES')).toBe('+34600111222');
    });

    it('returns nothing for text that is not a phone number', () => {
      expect(identity.normalisePhone('call me')).toBeNull();
      expect(identity.normalisePhone('')).toBeNull();
    });

    it('lower-cases and trims email', () => {
      expect(identity.normaliseEmail('  Anna@Example.COM ')).toBe('anna@example.com');
      expect(identity.normaliseEmail('  ')).toBeNull();
    });
  });

  describe('Partial details (R2)', () => {
    it('saves a person who only gave a phone number', async () => {
      const r = await person({ firstName: 'Phone', phone: '600 100 100' });
      expect(r.created).toBe(true);
      expect(r.person.email).toBeNull();
      expect(r.person.phone_e164).toBe('+34600100100');
      expect(r.person.lifecycle_stage).toBe('lead');
      expect(r.person.display_name).toBe('Phone');
    });

    it('shows the phone number when there is no name', async () => {
      const r = await person({ phone: '+34600100101', source: 'inbound_message', sourceDetail: 'sms' });
      expect(r.person.display_name).toBe('+34600100101');
    });

    it('refuses a person with neither email nor phone', async () => {
      await expect(person({ firstName: 'Nobody' })).rejects.toBeInstanceOf(identity.ContactPointRequiredError);
    });

    it('API: creates with a phone only, and refuses with neither', async () => {
      const ok = await request('POST', '/api/v1/customers', { first_name: 'Api', phone: '600 100 102', business_id: BUSINESS_ID, source: 'walk_in' }, ownerToken);
      expect(ok.statusCode).toBe(201);
      expect(ok.body.data.source).toBe('walk_in');
      expect(ok.body.data.email).toBeNull();

      const bad = await request('POST', '/api/v1/customers', { first_name: 'Api', business_id: BUSINESS_ID }, ownerToken);
      expect(bad.statusCode).toBe(400);
      expect(bad.body.code).toBe('CONTACT_POINT_REQUIRED');
    });

    it('API: a profile cannot be left with no way to reach the person', async () => {
      const r = await person({ firstName: 'Only', email: 'only-email@example.com' });
      const res = await request('PUT', `/api/v1/customers/${r.person.id}?business_id=${BUSINESS_ID}`, { email: '' }, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('CONTACT_POINT_REQUIRED');
    });
  });

  describe('Identity matching (R3) and source (R4)', () => {
    it('matches on email ignoring case, fills gaps, overwrites nothing, keeps the source', async () => {
      const first = await person({ firstName: 'Anna', email: 'anna.match@example.com', source: 'walk_in' });
      const again = await person({ firstName: 'Changed', lastName: 'Surname', email: 'ANNA.Match@Example.com', phone: '600 200 200', source: 'lead_form', sourceDetail: 'Spring offer' });

      expect(again.created).toBe(false);
      expect(again.matchedBy).toBe('email');
      expect(again.person.id).toBe(first.person.id);
      expect(again.person.first_name).toBe('Anna');          // not overwritten
      expect(again.person.last_name).toBe('Surname');        // gap filled
      expect(again.person.phone_e164).toBe('+34600200200');  // gap filled
      expect(again.person.source).toBe('walk_in');           // first source kept
    });

    it('matches on phone when exactly one person has it', async () => {
      const first = await person({ firstName: 'Solo', phone: '600 300 300' });
      const again = await person({ phone: '+34 600 300 300', source: 'inbound_message' });
      expect(again.created).toBe(false);
      expect(again.matchedBy).toBe('phone');
      expect(again.person.id).toBe(first.person.id);
    });

    it('does not merge two people who share a phone: creates a new person and flags them', async () => {
      const a = await person({ firstName: 'Parent', email: 'parent@example.com', phone: '600 400 400' });
      const b = await person({ firstName: 'Child', email: 'child@example.com', phone: '600 400 400' });
      expect(b.created).toBe(true);
      expect(b.person.id).not.toBe(a.person.id);

      const c = await person({ phone: '600 400 400', source: 'inbound_message' });
      expect(c.created).toBe(true);
      expect(c.duplicateFlagIds.length).toBe(2);

      const flags = await identity.getDuplicateFlags(c.person.id, BUSINESS_ID);
      expect(flags.map((f: any) => f.other_id).sort()).toEqual([a.person.id, b.person.id].sort());
    });

    it('never matches on name alone', async () => {
      const a = await person({ firstName: 'Same', lastName: 'Name', email: 'same1@example.com' });
      const b = await person({ firstName: 'Same', lastName: 'Name', email: 'same2@example.com' });
      expect(b.created).toBe(true);
      expect(b.person.id).not.toBe(a.person.id);
    });

    it('never matches across businesses', async () => {
      const here = await person({ firstName: 'Cross', email: 'cross@example.com' });
      const there = await identity.findOrCreatePerson({ businessId: OTHER_BUSINESS_ID, tenantId: TENANT_ID, firstName: 'Cross', email: 'cross@example.com', source: 'manual' });
      expect(there.created).toBe(true);
      expect(there.person.id).not.toBe(here.person.id);
    });

    it('API: creating someone who already exists returns who they are, not a second record', async () => {
      const res = await request('POST', '/api/v1/customers', { first_name: 'Anna', email: 'Anna.Match@example.com', business_id: BUSINESS_ID }, ownerToken);
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_EMAIL');
      expect(res.body.details.existing_id).toBeTruthy();
    });

    it('API: a refused add leaves the existing person untouched', async () => {
      const first = await request('POST', '/api/v1/customers', { first_name: 'Solo', phone: '+34 600 700 801', business_id: BUSINESS_ID }, ownerToken);
      expect(first.statusCode).toBe(201);
      const again = await request('POST', '/api/v1/customers', { first_name: 'Solo', email: 'solo.added@example.com', phone: '+34 600 700 801', business_id: BUSINESS_ID }, ownerToken);
      expect(again.statusCode).toBe(409);
      expect(again.body.code).toBe('DUPLICATE_PHONE');
      const { rows } = await adminPool.query('SELECT email FROM cus_customers WHERE id = $1', [first.body.data.id]);
      expect(rows[0].email).toBeNull();
    });

    it('a lead form submission creates one lead in the business, with the form as its source', async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO mkt_lead_funnels (tenant_id, name, slug) VALUES ($1, 'People Test Form', $2) RETURNING id`,
        [TENANT_ID, `people-test-form-${Date.now()}`],
      );
      const formData = { email: `form-${Date.now()}@example.com`, first_name: 'Form', phone: '600 500 500' };
      const one = await funnels.submitForm(rows[0].id, formData);
      const two = await funnels.submitForm(rows[0].id, formData);
      expect(two.customerId).toBe(one.customerId);

      const { rows: people } = await adminPool.query('SELECT * FROM cus_customers WHERE id = $1', [one.customerId]);
      expect(people[0].source).toBe('lead_form');
      expect(people[0].source_detail).toBe('People Test Form');
      expect(people[0].lifecycle_stage).toBe('lead');
      expect(people[0].business_id).toBeTruthy();
      expect(people[0].reference_number).toMatch(/^CUST-\d+$/);

      // Funnels belong to a tenant, so this lead landed in the tenant's first business (the
      // seeded demo business): remove it so test runs leave nothing behind there.
      await adminPool.query('DELETE FROM mkt_sequence_enrollments WHERE customer_id = $1', [one.customerId]);
      await adminPool.query('DELETE FROM cus_customers WHERE id = $1', [one.customerId]);
      await adminPool.query('DELETE FROM mkt_lead_funnels WHERE id = $1', [rows[0].id]);
    });

    it('reference numbers keep working when one in another format exists', async () => {
      await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name)
         VALUES ($1, $2, 'CUS-MGX12AB', 'odd-ref@example.com', 'Odd', 'Ref')`,
        [TENANT_ID, BUSINESS_ID],
      );
      const r = await person({ firstName: 'After', email: 'after-odd-ref@example.com' });
      expect(r.person.reference_number).toMatch(/^CUST-\d+$/);
    });
  });

  describe('Consent (R9)', () => {
    let personId: string;

    beforeAll(async () => {
      personId = (await person({ firstName: 'Consent', email: 'consent@example.com', phone: '600 600 600' })).person.id;
    });

    it('defaults to no marketing consent and reminders on', async () => {
      const prefs = await consent.getLegacyPreferences(personId);
      expect(prefs).toMatchObject({ email_marketing: false, sms_marketing: false, push_notifications: false, booking_reminders: true });
    });

    it('staff cannot record marketing consent without saying how it was obtained', async () => {
      const res = await request('PUT', `/api/v1/customers/${personId}/consent?business_id=${BUSINESS_ID}`, { channel: 'email', given: true }, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('CONSENT_EVIDENCE_REQUIRED');
    });

    it('records consent with its evidence, then a withdrawal, and keeps the history', async () => {
      const given = await request('PUT', `/api/v1/customers/${personId}/consent?business_id=${BUSINESS_ID}`, { channel: 'email', given: true, evidence: 'Signed the form at reception' }, ownerToken);
      expect(given.statusCode).toBe(200);
      expect(given.body.data.find((c: any) => c.channel === 'email').marketing).toBe(true);

      await consent.setConsent({ customerId: personId, channel: 'email', category: 'marketing', given: false, method: 'unsubscribe_link' });

      const history = await request('GET', `/api/v1/customers/${personId}/consent/history?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(history.statusCode).toBe(200);
      const email = history.body.data.filter((e: any) => e.channel === 'email' && e.category === 'marketing');
      expect(email.length).toBe(2);
      expect(email[0]).toMatchObject({ new_state: false, previous_state: true, method: 'unsubscribe_link' });
      expect(email[1]).toMatchObject({ new_state: true, method: 'staff_entry', evidence: 'Signed the form at reception' });
    });

    it('the profile switches and the marketing store are the same thing', async () => {
      await consent.setLegacyPreferences(personId, { sms_marketing: true }, { method: 'portal' });
      expect(await consent.isGiven(personId, 'sms', 'marketing')).toBe(true);
      const { rows } = await adminPool.query(
        `SELECT opted_in FROM mkt_communication_preferences WHERE customer_id = $1 AND channel = 'sms' AND category = 'marketing'`, [personId],
      );
      expect(rows[0].opted_in).toBe(true);
    });

    it('a read-only user cannot change consent', async () => {
      const res = await request('PUT', `/api/v1/customers/${personId}/consent?business_id=${BUSINESS_ID}`, { channel: 'email', given: true, evidence: 'x' }, staffToken);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Contactability (R10)', () => {
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const mk = async (key: string, over: Partial<identity.PersonInput>) => { ids[key] = (await person(over)).person.id; };
      await mk('consented', { firstName: 'Yes', email: 'can-yes@example.com' });
      await mk('noConsent', { firstName: 'No', email: 'can-no@example.com' });
      await mk('noEmail', { firstName: 'Phone', phone: '600 700 701' });
      await mk('archived', { firstName: 'Gone', email: 'can-archived@example.com' });
      await mk('bounced', { firstName: 'Bounce', email: 'can-bounced@example.com' });
      for (const key of ['consented', 'archived', 'bounced']) {
        await consent.setConsent({ customerId: ids[key], channel: 'email', category: 'marketing', given: true, method: 'form' });
      }
      await adminPool.query(`UPDATE cus_customers SET status = 'archived' WHERE id = $1`, [ids.archived]);
      await adminPool.query(`UPDATE cus_customers SET email_deliverability = 'bounced' WHERE id = $1`, [ids.bounced]);
    });

    it('gives the reason for every refusal', async () => {
      const reason = async (key: string) => (await contactability.canContact(ids[key], BUSINESS_ID, 'email', 'marketing')).reason;
      expect((await contactability.canContact(ids.consented, BUSINESS_ID, 'email', 'marketing')).allowed).toBe(true);
      expect(await reason('noConsent')).toBe('no_consent');
      expect(await reason('noEmail')).toBe('no_contact_point');
      expect(await reason('archived')).toBe('archived');
      expect(await reason('bounced')).toBe('undeliverable');
    });

    it('allows a transactional message without marketing consent', async () => {
      const d = await contactability.canContact(ids.noConsent, BUSINESS_ID, 'email', 'transactional');
      expect(d.allowed).toBe(true);
      expect(d.address).toBe('can-no@example.com');
    });

    it('respects the reminders switch for reminders only', async () => {
      await consent.setLegacyPreferences(ids.noConsent, { booking_reminders: false }, { method: 'portal' });
      expect((await contactability.canContact(ids.noConsent, BUSINESS_ID, 'email', 'transactional', { reminder: true })).reason).toBe('reminders_off');
      expect((await contactability.canContact(ids.noConsent, BUSINESS_ID, 'email', 'transactional')).allowed).toBe(true);
    });

    it('does not answer for a person of another business', async () => {
      const d = await contactability.canContact(ids.consented, OTHER_BUSINESS_ID, 'email', 'marketing');
      expect(d).toMatchObject({ allowed: false, reason: 'not_found' });
    });

    it('summarises an audience: 5 in the list, 1 will receive, 4 excluded with reasons', async () => {
      const list = await segments.createSegment({ businessId: BUSINESS_ID, name: 'Contactability list', kind: 'static', createdBy: STAFF_ID });
      await segments.addMembers(list.id, BUSINESS_ID, Object.values(ids), STAFF_ID);

      const res = await request('GET', `/api/v1/segments/${list.id}/audience-summary?business_id=${BUSINESS_ID}&channel=email&purpose=marketing`, undefined, ownerToken);
      expect(res.statusCode).toBe(200);
      // The archived person is still a member of the fixed list, and is excluded as "archived".
      expect(res.body.data).toMatchObject({ total: 5, willReceive: 1, excluded: 4 });
      const reasons = Object.fromEntries(res.body.data.excludedByReason.map((r: any) => [r.reason, r.count]));
      expect(reasons).toEqual({ no_consent: 1, no_contact_point: 1, archived: 1, undeliverable: 1 });
    });

    it('a campaign reaches only its segment, and only the people who may be contacted', async () => {
      const { rows: segRows } = await adminPool.query(`SELECT id FROM cus_segments WHERE business_id = $1 AND name = 'Contactability list'`, [BUSINESS_ID]);
      const campaign = await campaigns.createCampaign(TENANT_ID, { name: `People test campaign ${Date.now()}`, channel: 'email', segmentId: segRows[0].id, subject: 'Hello', content: 'Hello' } as any);
      const sent = await campaigns.sendCampaign(campaign.id, TENANT_ID);
      expect(sent.total_recipients).toBe(1);

      const { rows: recipients } = await adminPool.query('SELECT customer_id FROM mkt_campaign_recipients WHERE campaign_id = $1', [campaign.id]);
      expect(recipients.map((r: any) => r.customer_id)).toEqual([ids.consented]);
    });

    it('a campaign without an audience is refused', async () => {
      const campaign = await campaigns.createCampaign(TENANT_ID, { name: `People test no audience ${Date.now()}`, channel: 'email', subject: 'Hello', content: 'Hello' } as any);
      await expect(campaigns.sendCampaign(campaign.id, TENANT_ID)).rejects.toThrow(/audience/i);
    });
  });

  describe('Merge (R12)', () => {
    let a: any;
    let b: any;

    beforeAll(async () => {
      a = (await person({ firstName: 'Merge', lastName: 'Primary', email: 'merge-a@example.com' })).person;
      b = (await person({ firstName: 'Merge', lastName: 'Secondary', email: 'merge-b@example.com', phone: '600 800 800', source: 'lead_form' })).person;
      // Make B the older record, so its creation date and source must survive the merge.
      await adminPool.query(`UPDATE cus_customers SET created_at = NOW() - INTERVAL '30 days' WHERE id = $1`, [b.id]);

      // Things B owns in tables the old merge never touched.
      await adminPool.query(`INSERT INTO eng_customer_points (tenant_id, customer_id, points, action) VALUES ($1, $2, 50, 'test')`, [TENANT_ID, b.id]);
      await adminPool.query(`INSERT INTO eng_customer_streaks (tenant_id, customer_id) VALUES ($1, $2), ($1, $3)`, [TENANT_ID, a.id, b.id]);
      await adminPool.query(
        `INSERT INTO cus_activities (customer_id, business_id, activity_type, description) VALUES ($1, $2, 'note', 'Belongs to B')`, [b.id, BUSINESS_ID],
      );
      // A agreed to email marketing; B withdrew it. The withdrawal must win.
      await consent.setConsent({ customerId: a.id, channel: 'email', category: 'marketing', given: true, method: 'form' });
      await consent.setConsent({ customerId: b.id, channel: 'email', category: 'marketing', given: true, method: 'form' });
      await consent.setConsent({ customerId: b.id, channel: 'email', category: 'marketing', given: false, method: 'unsubscribe_link' });
    });

    it('previews what will move', async () => {
      const res = await request('POST', '/api/v1/customers/merge/preview', { primary_id: a.id, secondary_id: b.id, business_id: BUSINESS_ID }, ownerToken);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.blockers).toEqual([]);
      expect(res.body.data.moves.some((m: any) => m.table === 'eng_customer_points' && m.count === 1)).toBe(true);
    });

    it('a read-only user cannot merge', async () => {
      const res = await request('POST', '/api/v1/customers/merge', { primary_id: a.id, secondary_id: b.id, business_id: BUSINESS_ID }, staffToken);
      expect(res.statusCode).toBe(403);
    });

    it('moves everything, keeps the secondary as "merged", and leaves nothing pointing at it', async () => {
      const res = await request('POST', '/api/v1/customers/merge', { primary_id: a.id, secondary_id: b.id, business_id: BUSINESS_ID }, ownerToken);
      expect(res.statusCode).toBe(200);

      for (const ref of await duplicates.getPersonReferences()) {
        if (ref.table === 'cus_customers') continue;
        const { rows } = await adminPool.query(`SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE "${ref.column}" = $1`, [b.id]);
        expect(rows[0].n, `${ref.table}.${ref.column} still points at the merged record`).toBe(0);
      }

      const { rows: points } = await adminPool.query('SELECT COALESCE(SUM(points), 0)::int AS total FROM eng_customer_points WHERE customer_id = $1', [a.id]);
      expect(points[0].total).toBe(50);

      const { rows: secondary } = await adminPool.query('SELECT status, merged_into_id, email FROM cus_customers WHERE id = $1', [b.id]);
      expect(secondary[0]).toMatchObject({ status: 'merged', merged_into_id: a.id, email: null });
    });

    it('the primary keeps the older creation date and source, and gains the phone it lacked', async () => {
      const { rows } = await adminPool.query('SELECT * FROM cus_customers WHERE id = $1', [a.id]);
      expect(rows[0].source).toBe('lead_form');
      expect(rows[0].phone_e164).toBe('+34600800800');
      expect(new Date(rows[0].created_at).getTime()).toBeLessThan(Date.now() - 29 * 24 * 3600 * 1000);
    });

    it('a withdrawal of consent on either record survives the merge', async () => {
      expect(await consent.isGiven(a.id, 'email', 'marketing')).toBe(false);
    });

    it('an old link to the merged record says where the person lives now', async () => {
      const res = await request('GET', `/api/v1/customers/${b.id}?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'merged', merged_into_id: a.id });
    });

    it('the merged email is free to use again and the merged record is not in the list', async () => {
      const again = await person({ firstName: 'New', email: 'merge-b@example.com' });
      expect(again.created).toBe(true);
      const list = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&search=Secondary`, undefined, ownerToken);
      expect(list.body.data.some((c: any) => c.id === b.id)).toBe(false);
    });

    it('refuses to merge a record that is already merged, or two businesses', async () => {
      const merged = await request('POST', '/api/v1/customers/merge', { primary_id: a.id, secondary_id: b.id, business_id: BUSINESS_ID }, ownerToken);
      expect(merged.statusCode).toBe(400);

      const other = await identity.findOrCreatePerson({ businessId: OTHER_BUSINESS_ID, tenantId: TENANT_ID, firstName: 'Else', email: 'merge-else@example.com', source: 'manual' });
      const cross = await request('POST', '/api/v1/customers/merge', { primary_id: a.id, secondary_id: other.person.id, business_id: BUSINESS_ID }, ownerToken);
      expect(cross.statusCode).toBe(400);
    });

    it('every table that points at a person is covered by the merge', async () => {
      // A table added later is moved by the generic step; this guards the two that are handled by hand.
      const tables = new Set((await duplicates.getPersonReferences()).map((r) => r.table));
      expect(tables.has('mkt_communication_preferences')).toBe(true);
      expect(tables.has('cus_duplicate_flags')).toBe(true);
      expect(tables.size).toBeGreaterThan(30);
    });
  });

  describe('People list: views, filters, bulk actions (R1, R5, R8)', () => {
    let leadId: string;
    let activeId: string;

    beforeAll(async () => {
      leadId = (await person({ firstName: 'ViewLead', email: 'view-lead@example.com', source: 'referral' })).person.id;
      activeId = (await person({ firstName: 'ViewActive', email: 'view-active@example.com', initialStage: 'active' })).person.id;
    });

    it('each system view lists only its stages, and the counts match', async () => {
      const counts = await request('GET', `/api/v1/customers/view-counts?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(counts.statusCode).toBe(200);

      const leads = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&view=leads&limit=100`, undefined, ownerToken);
      expect(leads.body.data.every((c: any) => c.lifecycle_stage === 'lead')).toBe(true);
      expect(leads.body.meta.total).toBe(counts.body.data.leads);

      const customers = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&view=customers&limit=100`, undefined, ownerToken);
      expect(customers.body.data.some((c: any) => c.id === activeId)).toBe(true);
      expect(customers.body.data.some((c: any) => c.id === leadId)).toBe(false);
      expect(customers.body.meta.total).toBe(counts.body.data.customers);
    });

    it('filters by source and marks incomplete profiles', async () => {
      const res = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&source=referral`, undefined, ownerToken);
      expect(res.body.data.map((c: any) => c.id)).toEqual([leadId]);

      const incomplete = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&incomplete=true&limit=100`, undefined, ownerToken);
      expect(incomplete.body.data.length).toBeGreaterThan(0);
      expect(incomplete.body.data.every((c: any) => c.incomplete === true)).toBe(true);
    });

    it('assigns an owner, and "unassigned" no longer lists that person', async () => {
      const set = await request('PUT', `/api/v1/customers/${leadId}?business_id=${BUSINESS_ID}`, { owner_user_id: STAFF_ID }, ownerToken);
      expect(set.statusCode).toBe(200);
      expect(set.body.data.owner_user_id).toBe(STAFF_ID);

      const mine = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&owner=me`, undefined, ownerToken);
      expect(mine.body.data.map((c: any) => c.id)).toContain(leadId);
      const none = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&owner=none&limit=100`, undefined, ownerToken);
      expect(none.body.data.map((c: any) => c.id)).not.toContain(leadId);
    });

    it('bulk: previews the count, applies a stage change, and writes the timeline', async () => {
      const body = { business_id: BUSINESS_ID, ids: [leadId, activeId], action: 'change_stage', payload: { stage: 'at_risk' } };
      const preview = await request('POST', '/api/v1/customers/bulk/preview', body, ownerToken);
      expect(preview.body.data.count).toBe(2);

      const run = await request('POST', '/api/v1/customers/bulk', body, ownerToken);
      expect(run.statusCode).toBe(200);
      expect(run.body.data.affected).toBe(2);

      const { rows } = await adminPool.query(
        `SELECT description FROM cus_activities WHERE customer_id = $1 AND activity_type = 'lifecycle' ORDER BY created_at DESC LIMIT 1`, [leadId],
      );
      expect(rows[0].description).toBe('Stage: Lead → At risk');
    });

    it('bulk: a read-only user is refused', async () => {
      const res = await request('POST', '/api/v1/customers/bulk', { business_id: BUSINESS_ID, ids: [leadId], action: 'archive' }, staffToken);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Financial summary on the profile', () => {
    it('reports what is owed, what was paid in total and the business currency', async () => {
      const { person: p } = await person({ firstName: 'Money', email: 'money@example.com' });
      await adminPool.query(
        `INSERT INTO pay_invoices (tenant_id, business_id, customer_id, invoice_number, due_date, total_cents, amount_paid_cents, status)
         VALUES ($1, $2, $3, 990001, CURRENT_DATE - 5, 10000, 2500, 'issued'),
                ($1, $2, $3, 990002, CURRENT_DATE + 5, 4000, 4000, 'paid')`,
        [TENANT_ID, BUSINESS_ID, p.id],
      );
      await adminPool.query(
        `INSERT INTO pay_transactions (business_id, customer_id, type, status, amount, payment_method)
         VALUES ($1, $2, 'charge', 'completed', 6500, 'card'),
                ($1, $2, 'refund', 'completed', 1500, 'card'),
                ($1, $2, 'charge', 'failed', 9999, 'card')`,
        [BUSINESS_ID, p.id],
      );

      const res = await request('GET', `/api/v1/customers/${p.id}/financial-summary?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.balance_due_cents).toBe(7500);
      expect(res.body.data.open_invoices).toBe(1);
      expect(res.body.data.overdue_invoices).toBe(1);
      expect(res.body.data.lifetime_value_cents).toBe(5000);
      expect(res.body.data.account_credit_cents).toBe(0);
      expect(typeof res.body.data.currency).toBe('string');
    });
  });

  describe('Segments (R11)', () => {
    it('every business has the starter segments, with "New customers" for the trial stage', async () => {
      const res = await request('GET', `/api/v1/segments?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      const names = res.body.data.filter((s: any) => s.is_predefined).map((s: any) => s.name);
      for (const name of ['Leads', 'New customers', 'Active', 'At risk', 'Former', 'New this month', 'No visit in 30 days', 'Birthday this month']) {
        expect(names).toContain(name);
      }
      // Opening the list twice does not double them.
      const again = await request('GET', `/api/v1/segments?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(again.body.data.length).toBe(res.body.data.length);
    });

    it('a segment can be edited, and its membership follows', async () => {
      const created = await request('POST', '/api/v1/segments', { name: 'Editable', business_id: BUSINESS_ID, rules: { logic: 'AND', rules: [{ field: 'source', operator: 'eq', value: 'referral' }] } }, ownerToken);
      expect(created.statusCode).toBe(201);
      const before = await segments.getMemberIds(created.body.data.id, BUSINESS_ID);
      expect(before!.length).toBe(1);

      const updated = await request('PUT', `/api/v1/segments/${created.body.data.id}`, { business_id: BUSINESS_ID, name: 'Edited', rules: { logic: 'AND', rules: [{ field: 'source', operator: 'eq', value: 'api' }] } }, ownerToken);
      expect(updated.statusCode).toBe(200);
      expect(updated.body.data.name).toBe('Edited');
      expect((await segments.getMemberIds(created.body.data.id, BUSINESS_ID))!.length).toBe(0);
    });

    it('a fixed list holds exactly the people added, and can be used as a People view', async () => {
      const list = await request('POST', '/api/v1/segments', { name: 'Hand picked', kind: 'static', business_id: BUSINESS_ID }, ownerToken);
      expect(list.statusCode).toBe(201);
      expect(list.body.data.kind).toBe('static');

      const two = (await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&limit=2`, undefined, ownerToken)).body.data.map((c: any) => c.id);
      const added = await request('POST', `/api/v1/segments/${list.body.data.id}/members`, { business_id: BUSINESS_ID, customer_ids: two }, ownerToken);
      expect(added.body.data.added).toBe(2);

      const view = await request('GET', `/api/v1/customers?business_id=${BUSINESS_ID}&segment_id=${list.body.data.id}`, undefined, ownerToken);
      expect(view.body.data.map((c: any) => c.id).sort()).toEqual([...two].sort());

      // People cannot be added by hand to a rule-based segment.
      const dynamic = (await request('GET', `/api/v1/segments?business_id=${BUSINESS_ID}`, undefined, ownerToken)).body.data.find((s: any) => s.name === 'Leads');
      const refused = await request('POST', `/api/v1/segments/${dynamic.id}/members`, { business_id: BUSINESS_ID, customer_ids: two }, ownerToken);
      expect(refused.statusCode).toBe(404);
    });

    it('"no visit in 30 days" includes customers who have never visited', async () => {
      const never = (await person({ firstName: 'Never', email: 'never-visited@example.com', initialStage: 'active' })).person.id;
      const recent = (await person({ firstName: 'Recent', email: 'recent-visit@example.com', initialStage: 'active' })).person.id;
      await identity.touchVisit(recent);

      const total = await segments.countRules({ logic: 'AND', rules: [{ field: 'last_visit_at', operator: 'older_than_days', value: 30 }] }, BUSINESS_ID);
      const all = await segments.evaluateRules({ logic: 'AND', rules: [{ field: 'last_visit_at', operator: 'older_than_days', value: 30 }] }, BUSINESS_ID, 1, 100);
      expect(all.total).toBe(total);
      const ids = all.members.map((m: any) => m.id);
      expect(ids).toContain(never);
      expect(ids).not.toContain(recent);
    });

    it('a segment used by a scheduled campaign cannot be deleted', async () => {
      const seg = await segments.createSegment({ businessId: BUSINESS_ID, name: 'In use', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }] }, createdBy: STAFF_ID });
      await adminPool.query(
        `INSERT INTO mkt_campaigns (tenant_id, name, channel, status, segment_id, scheduled_at) VALUES ($1, 'Scheduled people test', 'email', 'scheduled', $2, NOW() + INTERVAL '1 day')`,
        [TENANT_ID, seg.id],
      );
      const res = await request('DELETE', `/api/v1/segments/${seg.id}?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('SEGMENT_IN_USE');
      await adminPool.query(`DELETE FROM mkt_campaigns WHERE segment_id = $1`, [seg.id]);
    });
  });

  describe('Activity and login signals (R6)', () => {
    it('a login is recorded on the account and counts as activity for the linked person', async () => {
      const email = `people-login-${Date.now()}@example.com`;
      const { rows: users } = await adminPool.query(
        `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, role, status, persona)
         VALUES ($1, $2, $3, 'Login', 'Person', 'customer', 'active', 'customer') RETURNING id`,
        [TENANT_ID, BUSINESS_ID, email],
      );
      const r = await person({ firstName: 'Login', lastName: 'Person', email, userId: users[0].id, source: 'online_registration' });
      expect(r.person.user_id).toBe(users[0].id);
      expect(r.person.last_activity_at).toBeNull();

      await identity.recordLogin(users[0].id);

      const got = await request('GET', `/api/v1/customers/${r.person.id}?business_id=${BUSINESS_ID}`, undefined, ownerToken);
      expect(got.body.data.has_account).toBe(true);
      expect(got.body.data.last_login_at).toBeTruthy();
      expect(got.body.data.last_activity_at).toBeTruthy();

      await adminPool.query('UPDATE cus_customers SET user_id = NULL WHERE id = $1', [r.person.id]);
      await adminPool.query('DELETE FROM usr_users WHERE id = $1', [users[0].id]);
    });

    it('a stage change stamps the date the person entered the stage', async () => {
      const r = await person({ firstName: 'Stage', email: 'stage-date@example.com' });
      await adminPool.query(`UPDATE cus_customers SET lifecycle_changed_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [r.person.id]);
      const res = await request('PUT', `/api/v1/customers/${r.person.id}/lifecycle?business_id=${BUSINESS_ID}`, { lifecycle_stage: 'trial' }, ownerToken);
      expect([200, 201]).toContain(res.statusCode);
      const { rows } = await adminPool.query('SELECT lifecycle_stage, lifecycle_changed_at FROM cus_customers WHERE id = $1', [r.person.id]);
      expect(rows[0].lifecycle_stage).toBe('trial');
      expect(Date.now() - new Date(rows[0].lifecycle_changed_at).getTime()).toBeLessThan(60_000);
    });
  });
});
