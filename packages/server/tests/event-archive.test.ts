import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

// Deleting an event archives it and can be undone; an event with registrations or a waiting
// list cannot be deleted until it is cancelled (David, 2026-10-28).

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TITLES = ['Archive Me Empty', 'Archive Me Busy'];
let ownerToken: string;
let typeId: string;
let customerId: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        hostname: 'localhost', port: address.port, path, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => { server.close(); try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); } catch { resolve({ statusCode: res.statusCode!, body: d }); } });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data); req.end();
    });
  });
}

async function cleanUp() {
  const mine = `SELECT id FROM evt_events WHERE tenant_id = $1 AND title = ANY($2)`;
  await adminPool.query(`DELETE FROM evt_registrations WHERE event_id IN (${mine})`, [TENANT_ID, TITLES]);
  await adminPool.query(`DELETE FROM evt_waitlist WHERE event_id IN (${mine})`, [TENANT_ID, TITLES]);
  await adminPool.query(`DELETE FROM evt_ticket_tiers WHERE event_id IN (${mine})`, [TENANT_ID, TITLES]);
  await adminPool.query(`DELETE FROM evt_events WHERE id IN (${mine})`, [TENANT_ID, TITLES]);
}

async function makeEvent(title: string) {
  const start = new Date(Date.now() + 7 * 86400000);
  const { rows } = await adminPool.query(
    `INSERT INTO evt_events (tenant_id, event_type_id, title, slug, start_time, end_time, capacity, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 10, 'published', '00000000-0000-0000-0000-000000000021') RETURNING id`,
    [TENANT_ID, typeId, title, `${title.toLowerCase().replace(/ /g, '-')}-${Date.now().toString(36)}`, start, new Date(start.getTime() + 3600000)]);
  return rows[0].id as string;
}

describe('Deleting and restoring an event', () => {
  beforeAll(async () => {
    await cleanUp();
    // Its own event type, so other tests' clean-ups of their types never meet these events.
    const { rows: t } = await adminPool.query(`SELECT id FROM evt_types WHERE tenant_id = $1 AND name = 'Archive Test Type'`, [TENANT_ID]);
    typeId = t[0]?.id || (await adminPool.query(`INSERT INTO evt_types (tenant_id, name, slug) VALUES ($1, 'Archive Test Type', 'archive-test-type') RETURNING id`, [TENANT_ID])).rows[0].id;
    const { rows: c } = await adminPool.query(`SELECT id FROM cus_customers WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]);
    customerId = c[0].id;
    ownerToken = authService.generateAccessToken('00000000-0000-0000-0000-000000000021', TENANT_ID, 'business_owner', ['events:*']);
  });
  // Leave the shared demo organisation as it was: these events and their type go.
  afterAll(async () => {
    await cleanUp();
    await adminPool.query("DELETE FROM evt_types WHERE tenant_id = $1 AND name = 'Archive Test Type' AND id NOT IN (SELECT event_type_id FROM evt_events WHERE event_type_id IS NOT NULL)", [TENANT_ID]);
  });

  it('archives an event without registrations, hides it, and restores it', async () => {
    const id = await makeEvent('Archive Me Empty');
    const del = await request('DELETE', `/api/v1/events/${id}`, undefined, ownerToken);
    expect(del.statusCode).toBe(200);
    expect(del.body.data.deleted_at).toBeTruthy();

    const listed = await request('GET', `/api/v1/events?search=${encodeURIComponent('Archive Me Empty')}`, undefined, ownerToken);
    expect(listed.body.data.some((e: any) => e.id === id)).toBe(false);
    const deleted = await request('GET', `/api/v1/events?deleted=true&search=${encodeURIComponent('Archive Me Empty')}`, undefined, ownerToken);
    expect(deleted.body.data.some((e: any) => e.id === id)).toBe(true);
    const publicList = await request('GET', `/api/v1/events/calendar?tenant_id=${TENANT_ID}&search=${encodeURIComponent('Archive Me Empty')}`);
    expect(publicList.body.data.some((e: any) => e.id === id)).toBe(false);

    const again = await request('DELETE', `/api/v1/events/${id}`, undefined, ownerToken);
    expect(again.statusCode).toBe(409);

    const restored = await request('PUT', `/api/v1/events/${id}/restore`, undefined, ownerToken);
    expect(restored.statusCode).toBe(200);
    expect(restored.body.data.deleted_at).toBeNull();
    expect(restored.body.data.status).toBe('published');
    const back = await request('GET', `/api/v1/events?search=${encodeURIComponent('Archive Me Empty')}`, undefined, ownerToken);
    expect(back.body.data.some((e: any) => e.id === id)).toBe(true);
  });

  it('refuses an event with registrations until it is cancelled', async () => {
    const id = await makeEvent('Archive Me Busy');
    const { rows: tier } = await adminPool.query(`INSERT INTO evt_ticket_tiers (event_id, name, price) VALUES ($1, 'Standard', 0) RETURNING id`, [id]);
    await adminPool.query(
      `INSERT INTO evt_registrations (event_id, ticket_tier_id, customer_id, status, reference_number) VALUES ($1, $2, $3, 'confirmed', $4)`,
      [id, tier[0].id, customerId, `ARC-${Date.now().toString(36)}`]);
    const refused = await request('DELETE', `/api/v1/events/${id}`, undefined, ownerToken);
    expect(refused.statusCode).toBe(409);
    expect(refused.body.code).toBe('HAS_REGISTRATIONS');
    expect(refused.body.error).toContain('1 registration');

    expect((await request('PUT', `/api/v1/events/${id}/cancel`, undefined, ownerToken)).statusCode).toBe(200);
    expect((await request('DELETE', `/api/v1/events/${id}`, undefined, ownerToken)).statusCode).toBe(200);
  });

  it('needs the right to manage events', async () => {
    const id = await makeEvent('Archive Me Empty');
    const staff = authService.generateAccessToken('00000000-0000-0000-0000-000000000022', TENANT_ID, 'business_staff', ['events:read']);
    expect((await request('DELETE', `/api/v1/events/${id}`, undefined, staff)).statusCode).toBe(403);
  });
});
