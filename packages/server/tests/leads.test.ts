import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';
import { resetBusinessData } from './helpers/test-business';

// Leads (Linear THE-17): business-defined lead stages, the Leads list, adding a lead by hand,
// changing stage / staff, archiving and restoring.

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let OTHER_BUSINESS_ID: string;
let STAFF_ID: string;
let OTHER_STAFF_ID: string;
let TAG_ID: string;
let ownerToken: string;
let editorToken: string;
let readerToken: string;

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

const q = (path: string, biz = BUSINESS_ID) => `/api/v1/leads${path}${path.includes('?') ? '&' : '?'}business_id=${biz}`;

describe('Leads (THE-17)', () => {
  beforeAll(async () => {
    const biz = async (name: string, slug: string) => (await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [TENANT_ID, name, slug],
    )).rows[0].id;
    BUSINESS_ID = await biz('Leads Test Biz', 'leads-test-biz');
    OTHER_BUSINESS_ID = await biz('Leads Other Biz', 'leads-other-biz');
    await resetBusinessData(BUSINESS_ID);
    await resetBusinessData(OTHER_BUSINESS_ID);

    const staff = async (businessId: string, email: string, first: string) => {
      const { rows } = await adminPool.query('SELECT id FROM usr_users WHERE email = $1', [email]);
      if (rows[0]) {
        await adminPool.query(`UPDATE usr_users SET business_id = $2, status = 'active' WHERE id = $1`, [rows[0].id, businessId]);
        return rows[0].id;
      }
      return (await adminPool.query(
        `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, role, status, persona)
         VALUES ($1, $2, $3, $4, 'Staff', 'business_staff', 'active', 'business') RETURNING id`,
        [TENANT_ID, businessId, email, first],
      )).rows[0].id;
    };
    STAFF_ID = await staff(BUSINESS_ID, 'leads-staff@example.test', 'Amanda');
    OTHER_STAFF_ID = await staff(OTHER_BUSINESS_ID, 'leads-other-staff@example.test', 'Other');

    TAG_ID = (await adminPool.query(
      `INSERT INTO cus_tags (business_id, name) VALUES ($1, 'VIP') RETURNING id`, [BUSINESS_ID],
    )).rows[0].id;

    const CALLER = '00000000-0000-0000-0000-000000000021';
    ownerToken = authService.generateAccessToken(CALLER, TENANT_ID, 'business_owner', ['customers:*', 'settings:*']);
    editorToken = authService.generateAccessToken(CALLER, TENANT_ID, 'staff', ['customers:*']);
    readerToken = authService.generateAccessToken(CALLER, TENANT_ID, 'staff', ['customers:read']);
  });

  it('gives a business the default stages the first time', async () => {
    const res = await request('GET', q('/stages'), undefined, readerToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((s: any) => s.name)).toEqual(['New', 'Contacted', 'Interested', 'Trial booked', 'Lost']);
  });

  it('lets only settings managers add, rename and reorder stages, and refuses a duplicate name', async () => {
    const denied = await request('POST', q('/stages'), { name: 'Qualified' }, editorToken);
    expect(denied.statusCode).toBe(403);

    const added = await request('POST', q('/stages'), { name: 'Qualified' }, ownerToken);
    expect(added.statusCode).toBe(201);
    const dup = await request('POST', q('/stages'), { name: 'qualified' }, ownerToken);
    expect(dup.statusCode).toBe(409);

    const renamed = await request('PUT', q(`/stages/${added.body.data.id}`), { name: 'Qualified lead' }, ownerToken);
    expect(renamed.body.data.name).toBe('Qualified lead');

    const stages = (await request('GET', q('/stages'), undefined, ownerToken)).body.data;
    const ids = stages.map((s: any) => s.id);
    const reordered = await request('PUT', q('/stages/order'), { ids: [ids[0], ids[5], ...ids.slice(1, 5)] }, ownerToken);
    expect(reordered.body.data.map((s: any) => s.name).slice(0, 3)).toEqual(['New', 'Qualified lead', 'Contacted']);

    const incomplete = await request('PUT', q('/stages/order'), { ids: ids.slice(1) }, ownerToken);
    expect(incomplete.statusCode).toBe(400);
  });

  it('adds a lead with source, first stage by default, staff and tags, and refuses one without email or phone', async () => {
    const none = await request('POST', q(''), { first_name: 'Nobody' }, editorToken);
    expect(none.statusCode).toBe(400);
    expect(none.body.code).toBe('CONTACT_POINT_REQUIRED');

    const badSource = await request('POST', q(''), { first_name: 'X', email: 'x-lead@example.test', lead_source: 'billboard' }, editorToken);
    expect(badSource.statusCode).toBe(400);

    const otherStaff = await request('POST', q(''), { first_name: 'X', email: 'x-lead@example.test', owner_user_id: OTHER_STAFF_ID }, editorToken);
    expect(otherStaff.statusCode).toBe(400);

    const res = await request('POST', q(''), {
      first_name: 'Lena', last_name: 'Lead', email: 'lena-lead@example.test', lead_source: 'whatsapp',
      owner_user_id: STAFF_ID, tag_ids: [TAG_ID],
    }, editorToken);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.lead_stage_name).toBe('New');
    expect(res.body.data.lead_source).toBe('whatsapp');
    expect(res.body.data.owner_name).toBe('Amanda Staff');
    expect(res.body.data.tags.map((t: any) => t.name)).toEqual(['VIP']);
    expect(res.body.data.messages_sent).toBe(0);

    const again = await request('POST', q(''), { first_name: 'Lena', email: 'lena-lead@example.test' }, editorToken);
    expect(again.statusCode).toBe(409);
  });

  it('lists only active leads of the business, with stage filter and messages sent', async () => {
    // A customer (not a lead) and a lead with no stage set (shown in the first stage).
    await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, lifecycle_stage, created_by)
       VALUES ($1, $2, 'CUST-LDS01', 'cust-not-lead@example.test', 'Cara', 'Customer', 'active', '00000000-0000-0000-0000-000000000010'),
              ($1, $2, 'CUST-LDS02', 'nostage-lead@example.test', 'Nora', 'Nostage', 'lead', '00000000-0000-0000-0000-000000000010')`,
      [TENANT_ID, BUSINESS_ID],
    );
    const nora = (await adminPool.query(`SELECT id FROM cus_customers WHERE email = 'nostage-lead@example.test' AND business_id = $1`, [BUSINESS_ID])).rows[0].id;
    await adminPool.query(
      `INSERT INTO apt_notification_queue (business_id, type, channel, recipient_id, data, status, sent_at, scheduled_for)
       VALUES ($1, 'booking.reminder', 'email', $2, '{}', 'sent', NOW(), NOW()), ($1, 'booking.reminder', 'sms', $2, '{}', 'sent', NOW(), NOW()),
              ($1, 'booking.reminder', 'email', $2, '{}', 'failed', NOW(), NOW())`,
      [BUSINESS_ID, nora],
    );

    const all = await request('GET', q('?sort=first_name&order=asc'), undefined, readerToken);
    expect(all.statusCode).toBe(200);
    expect(all.body.data.map((l: any) => l.first_name)).toEqual(['Lena', 'Nora']);
    const n = all.body.data.find((l: any) => l.first_name === 'Nora');
    expect(n.lead_stage_name).toBe('New');
    expect(n.messages_sent).toBe(2);
    expect(n.tags).toEqual([]);

    const stages = all.body.meta.stages;
    const contacted = stages.find((s: any) => s.name === 'Contacted');
    const filtered = await request('GET', q(`?stage_id=${contacted.id}`), undefined, readerToken);
    expect(filtered.body.data).toEqual([]);
    const newOnes = await request('GET', q(`?stage_id=${stages[0].id}`), undefined, readerToken);
    expect(newOnes.body.meta.total).toBe(2);

    const other = await request('GET', q('', OTHER_BUSINESS_ID), undefined, readerToken);
    expect(other.body.data).toEqual([]);
  });

  it('changes stage and staff, writing the stage change on the Timeline', async () => {
    const lena = (await request('GET', q('?search=lena'), undefined, readerToken)).body.data[0];
    const stages = (await request('GET', q('/stages'), undefined, readerToken)).body.data;
    const interested = stages.find((s: any) => s.name === 'Interested');

    const denied = await request('PATCH', q(`/${lena.id}`), { lead_stage_id: interested.id }, readerToken);
    expect(denied.statusCode).toBe(403);

    const res = await request('PATCH', q(`/${lena.id}`), { lead_stage_id: interested.id, owner_user_id: null }, editorToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.lead_stage_name).toBe('Interested');
    expect(res.body.data.owner_name).toBeNull();

    const timeline = await request('GET', `/api/v1/customers/${lena.id}/timeline?business_id=${BUSINESS_ID}&kind=lifecycle`, undefined, readerToken);
    expect(timeline.body.data.some((i: any) => i.description === 'Lead stage: New → Interested')).toBe(true);
  });

  it('deletes a stage only after asking where its leads go, and never the last one', async () => {
    const stages = (await request('GET', q('/stages'), undefined, ownerToken)).body.data;
    const interested = stages.find((s: any) => s.name === 'Interested');
    const contacted = stages.find((s: any) => s.name === 'Contacted');

    const ask = await request('DELETE', q(`/stages/${interested.id}`), undefined, ownerToken);
    expect(ask.statusCode).toBe(400);
    expect(ask.body.code).toBe('MOVE_TO_REQUIRED');

    const ok = await request('DELETE', q(`/stages/${interested.id}?move_to=${contacted.id}`), undefined, ownerToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.some((s: any) => s.name === 'Interested')).toBe(false);
    const lena = (await request('GET', q('?search=lena'), undefined, readerToken)).body.data[0];
    expect(lena.lead_stage_name).toBe('Contacted');

    // Deleting the first stage moves the leads with no stage set as well.
    const first = ok.body.data[0];
    const moved = await request('DELETE', q(`/stages/${first.id}?move_to=${contacted.id}`), undefined, ownerToken);
    expect(moved.statusCode).toBe(200);
    const nora = (await request('GET', q('?search=nora'), undefined, readerToken)).body.data[0];
    expect(nora.lead_stage_name).toBe('Contacted');

    let left = moved.body.data;
    while (left.length > 1) {
      const [gone, keep] = [left[left.length - 1], left[0]];
      left = (await request('DELETE', q(`/stages/${gone.id}?move_to=${keep.id}`), undefined, ownerToken)).body.data;
    }
    const last = await request('DELETE', q(`/stages/${left[0].id}`), undefined, ownerToken);
    expect(last.statusCode).toBe(400);
    expect(last.body.code).toBe('LAST_STAGE');
  });

  it('archives a lead (Delete lead) and restores it', async () => {
    const nora = (await request('GET', q('?search=nora'), undefined, readerToken)).body.data[0];
    const archived = await request('PUT', `/api/v1/customers/${nora.id}/archive?business_id=${BUSINESS_ID}`, undefined, editorToken);
    expect(archived.statusCode).toBe(200);
    expect((await request('GET', q('?search=nora'), undefined, readerToken)).body.data).toEqual([]);
    expect((await request('GET', q('?archived=true'), undefined, readerToken)).body.data.map((l: any) => l.first_name)).toEqual(['Nora']);

    const restored = await request('PUT', `/api/v1/customers/${nora.id}/reactivate?business_id=${BUSINESS_ID}`, undefined, editorToken);
    expect(restored.statusCode).toBe(200);
    expect((await request('GET', q('?search=nora'), undefined, readerToken)).body.data).toHaveLength(1);
  });

  it('refuses a business of another organisation', async () => {
    const res = await request('GET', q('', '00000000-0000-0000-0000-00000000dead'), undefined, readerToken);
    expect([403, 404]).toContain(res.statusCode);
  });
});
