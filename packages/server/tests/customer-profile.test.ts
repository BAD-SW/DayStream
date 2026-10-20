import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';
import { canContact } from '../src/services/contactability.service';
import { resetBusinessData } from './helpers/test-business';

// Customer profile (Linear THE-16): address and home location, Timeline filters, tasks,
// documents scoping and the "transactional emails" switch.

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let OTHER_BUSINESS_ID: string;
let CUSTOMER_ID: string;
let LOCATION_ID: string;
let OTHER_LOCATION_ID: string;
let STAFF_USER_ID: string;
let ownerToken: string;
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

const url = (path: string) => `/api/v1/customers/${CUSTOMER_ID}${path}?business_id=${BUSINESS_ID}`;

describe('Customer profile (THE-16)', () => {
  beforeAll(async () => {
    const biz = async (name: string, slug: string) => (await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [TENANT_ID, name, slug],
    )).rows[0].id;
    BUSINESS_ID = await biz('Profile Test Biz', 'profile-test-biz');
    OTHER_BUSINESS_ID = await biz('Profile Other Biz', 'profile-other-biz');
    await resetBusinessData(BUSINESS_ID);
    await resetBusinessData(OTHER_BUSINESS_ID);

    const loc = async (businessId: string, name: string) => (await adminPool.query(
      `INSERT INTO sys_locations (business_id, name, slug, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [businessId, name, `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`],
    )).rows[0].id;
    LOCATION_ID = await loc(BUSINESS_ID, 'Profile North');
    OTHER_LOCATION_ID = await loc(OTHER_BUSINESS_ID, 'Other North');

    CUSTOMER_ID = (await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-PROF01', 'profile-test@example.test', 'Profile', 'Test', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    )).rows[0].id;

    STAFF_USER_ID = (await adminPool.query(
      `SELECT id FROM usr_users WHERE tenant_id = $1 AND persona <> 'customer' AND status = 'active' ORDER BY created_at LIMIT 1`,
      [TENANT_ID],
    )).rows[0].id;

    // The tenant-level seed user (as in the other customer tests) can reach the test businesses.
    const CALLER = '00000000-0000-0000-0000-000000000021';
    ownerToken = authService.generateAccessToken(CALLER, TENANT_ID, 'business_owner', ['customers:*', 'settings:*']);
    readerToken = authService.generateAccessToken(CALLER, TENANT_ID, 'staff', ['customers:read']);
  });

  it('saves the address and a home location of the business, and refuses another business\'s location', async () => {
    const ok = await request('PUT', `/api/v1/customers/${CUSTOMER_ID}?business_id=${BUSINESS_ID}`,
      { address_line: 'Carrer Major 1', city: 'Palma', postal_code: '07001', region: 'Illes Balears', home_location_id: LOCATION_ID }, ownerToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.home_location_name).toBe('Profile North');
    expect(ok.body.data.city).toBe('Palma');

    const bad = await request('PUT', `/api/v1/customers/${CUSTOMER_ID}?business_id=${BUSINESS_ID}`, { home_location_id: OTHER_LOCATION_ID }, ownerToken);
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe('INVALID_LOCATION');
  });

  it('lists the Timeline newest first and refuses an unknown filter', async () => {
    await request('PUT', `/api/v1/customers/${CUSTOMER_ID}?business_id=${BUSINESS_ID}`, { preferred_language: 'es' }, ownerToken);
    const all = await request('GET', url('/timeline'), undefined, readerToken);
    expect(all.statusCode).toBe(200);
    const at = all.body.data.map((i: any) => i.at);
    expect([...at].sort().reverse()).toEqual(at);

    const changes = await request('GET', `${url('/timeline')}&kind=profile_change`, undefined, readerToken);
    expect(changes.body.data.some((i: any) => /Language/i.test(i.description))).toBe(true);

    const messages = await request('GET', `${url('/timeline')}&kind=message`, undefined, readerToken);
    expect(messages.body.data).toEqual([]);

    const bad = await request('GET', `${url('/timeline')}&kind=nonsense`, undefined, readerToken);
    expect(bad.statusCode).toBe(400);
  });

  it('lists sent messages on the Timeline, those of the same kind on the same day on one line', async () => {
    const queue = (type: string, status: string, at: string) => adminPool.query(
      `INSERT INTO apt_notification_queue (business_id, type, channel, recipient_id, data, status, sent_at, scheduled_for)
       VALUES ($1, $2, 'email', $3, '{}', $4, $5, $5)`,
      [BUSINESS_ID, type, CUSTOMER_ID, status, at],
    );
    await queue('booking.confirmation', 'sent', '2026-03-02T09:00:00Z');
    await queue('booking.confirmation', 'sent', '2026-03-02T15:00:00Z');
    await queue('payment.receipt', 'sent', '2026-03-02T15:05:00Z');
    await queue('booking.confirmation', 'sent', '2026-03-03T10:00:00Z');
    await queue('booking.confirmation', 'cancelled', '2026-03-04T10:00:00Z');

    const { body } = await request('GET', `${url('/timeline')}&kind=message`, undefined, readerToken);
    expect(body.data.map((i: any) => i.description)).toEqual([
      'Email sent: Booking confirmation',
      'Email sent: Payment receipt',
      '2 emails sent: Booking confirmation',
    ]);
    await adminPool.query('DELETE FROM apt_notification_queue WHERE recipient_id = $1', [CUSTOMER_ID]);
  });

  it('returns figures for the person', async () => {
    const { statusCode, body } = await request('GET', url('/figures'), undefined, readerToken);
    expect(statusCode).toBe(200);
    expect(body.data).toEqual({ visits: 0, appointments: 0, events: 0, session_credits: 0 });
  });

  it('creates a task for several staff, needs at least one, and is refused to a read-only login', async () => {
    const none = await request('POST', url('/tasks'), { title: 'Call', staff_ids: [] }, ownerToken);
    expect(none.statusCode).toBe(400);

    const readOnly = await request('POST', url('/tasks'), { title: 'Call', staff_ids: [STAFF_USER_ID] }, readerToken);
    expect(readOnly.statusCode).toBe(403);

    const created = await request('POST', url('/tasks'), { title: 'Call about the pack', staff_ids: [STAFF_USER_ID], send_reminder: false }, ownerToken);
    expect(created.statusCode).toBe(201);
    expect(created.body.data.staff).toHaveLength(1);
    expect(created.body.data.status).toBe('open');

    const done = await request('PUT', url(`/tasks/${created.body.data.id}/status`), { done: true }, ownerToken);
    expect(done.statusCode).toBe(200);
    expect(done.body.data.status).toBe('done');

    const gone = await request('DELETE', url(`/tasks/${created.body.data.id}`), undefined, ownerToken);
    expect(gone.statusCode).toBe(200);
  });

  it('does not show a person\'s tasks or documents under another business', async () => {
    const tasks = await request('GET', `/api/v1/customers/${CUSTOMER_ID}/tasks?business_id=${OTHER_BUSINESS_ID}`, undefined, ownerToken);
    expect(tasks.statusCode).toBe(404);
    const docs = await request('GET', `/api/v1/customers/${CUSTOMER_ID}/documents?business_id=${OTHER_BUSINESS_ID}`, undefined, ownerToken);
    expect(docs.statusCode).toBe(404);
  });

  it('stops transactional emails when the switch is off, and leaves booking reminders to their own switch', async () => {
    const before = await canContact(CUSTOMER_ID, BUSINESS_ID, 'email', 'transactional');
    expect(before.allowed).toBe(true);

    const off = await request('PUT', url('/preferences'), { transactional_emails: false }, ownerToken);
    expect(off.statusCode).toBe(200);
    expect(off.body.data.transactional_emails).toBe(false);

    const after = await canContact(CUSTOMER_ID, BUSINESS_ID, 'email', 'transactional');
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe('transactional_off');

    const reminder = await canContact(CUSTOMER_ID, BUSINESS_ID, 'email', 'transactional', { reminder: true });
    expect(reminder.allowed).toBe(true);

    const sms = await canContact(CUSTOMER_ID, BUSINESS_ID, 'sms', 'transactional');
    expect(sms.reason).not.toBe('transactional_off');

    await request('PUT', url('/preferences'), { transactional_emails: true }, ownerToken);
    expect((await canContact(CUSTOMER_ID, BUSINESS_ID, 'email', 'transactional')).allowed).toBe(true);
  });

  it('refuses a password reset for a person without an account', async () => {
    const { statusCode, body } = await request('POST', url('/password-reset'), undefined, ownerToken);
    expect(statusCode).toBe(409);
    expect(body.code).toBe('NO_ACCOUNT');
  });

  it('refuses a personal-data link that does not exist', async () => {
    const { statusCode } = await request('GET', `/api/v1/public/personal-data/${'a'.repeat(64)}`);
    expect(statusCode).toBe(410);
  });
});
