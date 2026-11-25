/**
 * Phase 44, requirement 2: PUT /api/v1/profile/language saves the menu bar's language on the account;
 * a customer's choice also sets their customer record's language; the System persona cannot set one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app } from '../src/app';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const BUSINESS_ID = '00000000-0000-0000-0000-000000000002';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000020';
const STAFF_EMAIL = 'language-staff@test.daystream';
const CUSTOMER_EMAIL = 'language-customer@test.daystream';

let staffId: string;
let customerUserId: string;
let customerId: string;
let systemLanguageBefore: string | null;

function request(method: string, path: string, body: unknown, token: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: 'localhost', port, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: `Bearer ${token}` },
      }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => { server.close(); try { resolve({ statusCode: res.statusCode!, body: JSON.parse(text) }); } catch { resolve({ statusCode: res.statusCode!, body: text }); } });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.write(data);
      req.end();
    });
  });
}

async function addUser(email: string, persona: string, role: string): Promise<string> {
  const { rows } = await adminPool.query(
    `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, role, persona, status)
     VALUES ($1, $2, $3, 'Lang', 'Test', $4, $5, 'active')
     ON CONFLICT (tenant_id, email) DO UPDATE SET preferred_language = NULL
     RETURNING id`,
    [TENANT_ID, BUSINESS_ID, email, role, persona]);
  return rows[0].id;
}

describe('PUT /api/v1/profile/language', () => {
  beforeAll(async () => {
    staffId = await addUser(STAFF_EMAIL, 'business', 'reception');
    customerUserId = await addUser(CUSTOMER_EMAIL, 'customer', 'customer');
    const { rows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, first_name, last_name, email, preferred_language)
       VALUES ($1, $2, 'LANG-TEST-1', 'Lang', 'Test', $3, 'xx') RETURNING id`,
      [TENANT_ID, BUSINESS_ID, CUSTOMER_EMAIL]);
    customerId = rows[0].id;
    const sys = await adminPool.query('SELECT preferred_language FROM usr_users WHERE id = $1', [SYSTEM_USER_ID]);
    systemLanguageBefore = sys.rows[0]?.preferred_language ?? null;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM cus_customers WHERE id = $1', [customerId]);
    await adminPool.query('DELETE FROM usr_users WHERE id = ANY($1)', [[staffId, customerUserId]]);
    await adminPool.query('UPDATE usr_users SET preferred_language = $1 WHERE id = $2', [systemLanguageBefore, SYSTEM_USER_ID]);
  });

  it('saves the language on a staff member\'s account', async () => {
    const token = authService.generateAccessToken(staffId, TENANT_ID, 'reception', []);
    const res = await request('PUT', '/api/v1/profile/language', { language: 'en' }, token);
    expect(res.statusCode).toBe(200);
    const { rows } = await adminPool.query('SELECT preferred_language FROM usr_users WHERE id = $1', [staffId]);
    expect(rows[0].preferred_language).toBe('en');
  });

  it('refuses a language that is not offered', async () => {
    const token = authService.generateAccessToken(staffId, TENANT_ID, 'reception', []);
    const res = await request('PUT', '/api/v1/profile/language', { language: 'fr' }, token);
    expect(res.statusCode).toBe(400);
  });

  it('also sets a customer\'s customer record in the business being used', async () => {
    const token = authService.generateAccessToken(customerUserId, TENANT_ID, 'customer', []);
    const res = await request('PUT', `/api/v1/profile/language?business_id=${BUSINESS_ID}`, { language: 'en' }, token);
    expect(res.statusCode).toBe(200);
    const { rows } = await adminPool.query('SELECT preferred_language FROM cus_customers WHERE id = $1', [customerId]);
    expect(rows[0].preferred_language).toBe('en');
  });

  it('does not let the System persona set a language (always English)', async () => {
    const token = authService.generateAccessToken(SYSTEM_USER_ID, TENANT_ID, 'system_admin', ['*:*']);
    const res = await request('PUT', '/api/v1/profile/language', { language: 'en' }, token);
    expect(res.statusCode).toBe(403);
  });
});
