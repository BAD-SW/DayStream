import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import http from 'http';

function request(path: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const req = http.get(`http://localhost:${address.port}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          resolve({ statusCode: res.statusCode!, body: JSON.parse(data) });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
    });
  });
}

describe('Health Endpoints', () => {
  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const { statusCode, body } = await request('/api/health');
      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health/ready', () => {
    it('returns 200 with database status', async () => {
      const { statusCode, body } = await request('/api/health/ready');
      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.dependencies.database.status).toBe('ok');
      expect(body.dependencies.database).toHaveProperty('responseTime');
    });
  });

  describe('GET /api/health/dependencies', () => {
    it('returns 200 with database details', async () => {
      const { statusCode, body } = await request('/api/health/dependencies');
      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.dependencies.database.status).toBe('ok');
      expect(body.dependencies.database).toHaveProperty('responseTime');
      expect(body.dependencies.database).toHaveProperty('activeConnections');
    });
  });
});
