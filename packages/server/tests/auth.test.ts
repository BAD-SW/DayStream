import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import http from 'http';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = `authtest_${Date.now()}@transcend.test`;
const TEST_PASSWORD = 'StrongP@ss1234!';

function request(method: string, path: string, body?: any): Promise<{ statusCode: number; body: any }> {
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
        },
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData) });
          } catch {
            resolve({ statusCode: res.statusCode!, body: responseData });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Auth API', () => {
  describe('POST /api/v1/auth/register', () => {
    it('registers a new user', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/register', {
        tenant_id: TENANT_ID,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        first_name: 'Test',
        last_name: 'User',
      });
      expect(statusCode).toBe(201);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.refresh_token).toBeDefined();
      expect(body.data.user.email).toBe(TEST_EMAIL);
    });

    it('rejects duplicate email', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/register', {
        tenant_id: TENANT_ID,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        first_name: 'Test',
        last_name: 'User',
      });
      expect(statusCode).toBe(409);
      expect(body.code).toBe('EMAIL_EXISTS');
    });

    it('rejects weak password', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/register', {
        tenant_id: TENANT_ID,
        email: 'weak@transcend.test',
        password: 'short',
        first_name: 'Test',
        last_name: 'User',
      });
      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in with valid credentials', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/login', {
        tenant_id: TENANT_ID,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(statusCode).toBe(200);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.refresh_token).toBeDefined();
    });

    it('rejects invalid password', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/login', {
        tenant_id: TENANT_ID,
        email: TEST_EMAIL,
        password: 'WrongP@ssword1!',
      });
      expect(statusCode).toBe(401);
      expect(body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('refreshes access token', async () => {
      // First login to get a refresh token
      const loginRes = await request('POST', '/api/v1/auth/login', {
        tenant_id: TENANT_ID,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      const refreshToken = loginRes.body.data.refresh_token;

      const { statusCode, body } = await request('POST', '/api/v1/auth/refresh', {
        refresh_token: refreshToken,
      });
      expect(statusCode).toBe(200);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.refresh_token).toBeDefined();
    });

    it('rejects invalid refresh token', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/refresh', {
        refresh_token: 'invalid-token',
      });
      expect(statusCode).toBe(401);
    });
  });

  describe('Input validation', () => {
    it('rejects missing fields', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/auth/login', {
        email: 'test@test.com',
      });
      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details.length).toBeGreaterThan(0);
    });
  });
});
