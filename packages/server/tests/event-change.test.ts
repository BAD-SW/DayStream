import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';
import { customerCancelWindow, DEFAULT_CANCEL_SETTINGS } from '../src/services/customer-cancellation.service';

// Changing a published event (David, 2026-11-04, decision 14): changes stay live; capacity cannot go
// below the places taken; a date, time or place change with people registered opens a full-refund
// window for them; Unpublish only while nobody is registered or waiting.

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TITLES = ['Change Me Empty', 'Change Me Busy'];
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

async function makeEvent(title: string, registered: number) {
  const start = new Date(Date.now() + 30 * 86400000);
  const { rows } = await adminPool.query(
    `INSERT INTO evt_events (tenant_id, event_type_id, title, slug, start_time, end_time, capacity, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 10, 'published', '00000000-0000-0000-0000-000000000021') RETURNING id, start_time`,
    [TENANT_ID, typeId, title, `${title.toLowerCase().replace(/ /g, '-')}-${Date.now().toString(36)}`, start, new Date(start.getTime() + 3600000)]);
  const id = rows[0].id as string;
  if (registered) {
    const { rows: tier } = await adminPool.query(`INSERT INTO evt_ticket_tiers (event_id, name, price) VALUES ($1, 'Standard', 0) RETURNING id`, [id]);
    await adminPool.query(
      `INSERT INTO evt_registrations (event_id, ticket_tier_id, customer_id, status, reference_number, group_size) VALUES ($1, $2, $3, 'confirmed', $4, $5)`,
      [id, tier[0].id, customerId, `CHG-${Date.now().toString(36)}`, registered]);
  }
  return { id, start: new Date(rows[0].start_time) };
}

describe('Changing a published event', () => {
  beforeAll(async () => {
    await cleanUp();
    const { rows: t } = await adminPool.query(`SELECT id FROM evt_types WHERE tenant_id = $1 AND name = 'Change Test Type'`, [TENANT_ID]);
    typeId = t[0]?.id || (await adminPool.query(`INSERT INTO evt_types (tenant_id, name, slug) VALUES ($1, 'Change Test Type', 'change-test-type') RETURNING id`, [TENANT_ID])).rows[0].id;
    const { rows: c } = await adminPool.query(`SELECT id FROM cus_customers WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]);
    customerId = c[0].id;
    ownerToken = authService.generateAccessToken('00000000-0000-0000-0000-000000000021', TENANT_ID, 'business_owner', ['events:*']);
  });
  afterAll(async () => {
    await cleanUp();
    await adminPool.query("DELETE FROM evt_types WHERE tenant_id = $1 AND name = 'Change Test Type' AND id NOT IN (SELECT event_type_id FROM evt_events WHERE event_type_id IS NOT NULL)", [TENANT_ID]);
  });

  it('keeps a changed event published; a text change opens no refund window', async () => {
    const { id } = await makeEvent('Change Me Busy', 2);
    const res = await request('PUT', `/api/v1/events/${id}`, { description: 'New text' }, ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.material_change).toBeUndefined();
    expect(res.body.data.change_refund_until).toBeNull();
  });

  it('refuses a capacity below the places taken', async () => {
    const { id } = await makeEvent('Change Me Busy', 3);
    const res = await request('PUT', `/api/v1/events/${id}`, { capacity: 2 }, ownerToken);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('3 places');
    expect((await request('PUT', `/api/v1/events/${id}`, { capacity: 3 }, ownerToken)).statusCode).toBe(200);
  });

  it('opens a refund window when the date changes with people registered', async () => {
    const { id, start } = await makeEvent('Change Me Busy', 1);
    const later = new Date(start.getTime() + 86400000);
    const res = await request('PUT', `/api/v1/events/${id}`, { start_time: later.toISOString(), end_time: new Date(later.getTime() + 3600000).toISOString() }, ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.material_change.registrations).toBe(1);
    expect(res.body.data.material_change.refund_days).toBe(7);
    const until = new Date(res.body.data.change_refund_until).getTime();
    expect(Math.abs(until - (Date.now() + 7 * 86400000))).toBeLessThan(60000);
  });

  it('opens no window when nobody is registered', async () => {
    const { id, start } = await makeEvent('Change Me Empty', 0);
    const later = new Date(start.getTime() + 86400000);
    const res = await request('PUT', `/api/v1/events/${id}`, { start_time: later.toISOString(), end_time: new Date(later.getTime() + 3600000).toISOString() }, ownerToken);
    expect(res.body.data.material_change).toBeUndefined();
  });

  it('lets a customer cancel during the window even when the business does not allow cancelling', () => {
    const start = new Date(Date.now() + 2 * 86400000);
    expect(customerCancelWindow(DEFAULT_CANCEL_SETTINGS, start).allowed).toBe(false);
    const w = customerCancelWindow(DEFAULT_CANCEL_SETTINGS, start, new Date(), new Date(Date.now() + 86400000));
    expect(w).toMatchObject({ allowed: true, afterChange: true });
    expect(customerCancelWindow(DEFAULT_CANCEL_SETTINGS, start, new Date(), new Date(Date.now() - 1000)).allowed).toBe(false);
  });

  it('unpublishes only while nobody is registered', async () => {
    const empty = await makeEvent('Change Me Empty', 0);
    const ok = await request('PUT', `/api/v1/events/${empty.id}/unpublish`, undefined, ownerToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.status).toBe('draft');
    const busy = await makeEvent('Change Me Busy', 1);
    const refused = await request('PUT', `/api/v1/events/${busy.id}/unpublish`, undefined, ownerToken);
    expect(refused.statusCode).toBe(400);
    expect(refused.body.error).toContain('Cancel the event');
  });
});
