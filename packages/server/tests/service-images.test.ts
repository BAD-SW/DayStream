import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as imagesService from '../src/services/service-images.service';
import { adminPool } from '../src/db/pool';
import sharp from 'sharp';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let IMAGE_ID: string;
let ownerToken: string;

// Generate a valid test image (500x400 JPEG)
async function createTestImage(width = 500, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).jpeg().toBuffer();
}

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

// Multipart upload helper
function uploadImage(path: string, imageBuffer: Buffer, token: string, altText?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const boundary = '----TestBoundary' + Date.now();
      let body = '';
      body += `--${boundary}\r\n`;
      body += 'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n';
      body += 'Content-Type: image/jpeg\r\n\r\n';

      const bodyStart = Buffer.from(body, 'utf-8');
      let bodyEnd = `\r\n`;
      if (altText) {
        bodyEnd += `--${boundary}\r\n`;
        bodyEnd += `Content-Disposition: form-data; name="alt_text"\r\n\r\n`;
        bodyEnd += `${altText}\r\n`;
      }
      bodyEnd += `--${boundary}--\r\n`;
      const bodyEndBuf = Buffer.from(bodyEnd, 'utf-8');

      const fullBody = Buffer.concat([bodyStart, imageBuffer, bodyEndBuf]);

      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullBody.length,
          Authorization: `Bearer ${token}`,
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
      req.write(fullBody);
      req.end();
    });
  });
}

describe('Service Images API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Images Test Biz', 'images-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Images Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Image Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, created_by)
       VALUES ($1, $2, 'Image Test Service', 'image-test-service', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('Image validation', () => {
    it('accepts valid JPEG', () => {
      const result = imagesService.validateImage({ buffer: Buffer.alloc(100), mimetype: 'image/jpeg', size: 1024 });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid mime type', () => {
      const result = imagesService.validateImage({ buffer: Buffer.alloc(100), mimetype: 'image/gif', size: 1024 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });

    it('rejects oversized file', () => {
      const result = imagesService.validateImage({ buffer: Buffer.alloc(100), mimetype: 'image/jpeg', size: 6 * 1024 * 1024 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('large');
    });
  });

  describe('POST /services/:id/images', () => {
    it('uploads an image and generates responsive sizes', async () => {
      const imageBuffer = await createTestImage();
      const { statusCode, body } = await uploadImage(
        `/api/v1/services/${SERVICE_ID}/images?business_id=${BUSINESS_ID}`,
        imageBuffer, ownerToken, 'Test image alt',
      );

      expect(statusCode).toBe(201);
      expect(body.data.service_id).toBe(SERVICE_ID);
      expect(body.data.is_primary).toBe(true); // first image is primary
      expect(body.data.alt_text).toBe('Test image alt');
      expect(body.data.urls).toHaveProperty('original');
      expect(body.data.urls).toHaveProperty('large');
      expect(body.data.urls).toHaveProperty('medium');
      expect(body.data.urls).toHaveProperty('thumbnail');
      IMAGE_ID = body.data.id;
    });

    it('second image is not primary', async () => {
      const imageBuffer = await createTestImage();
      const { statusCode, body } = await uploadImage(
        `/api/v1/services/${SERVICE_ID}/images?business_id=${BUSINESS_ID}`,
        imageBuffer, ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.is_primary).toBe(false);
    });

    it('rejects image below minimum dimensions', async () => {
      const smallImage = await sharp({
        create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).jpeg().toBuffer();

      const { statusCode, body } = await uploadImage(
        `/api/v1/services/${SERVICE_ID}/images?business_id=${BUSINESS_ID}`,
        smallImage, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('small');
    });
  });

  describe('GET /services/:id/images', () => {
    it('lists images with URLs', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/${SERVICE_ID}/images`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('urls');
    });
  });

  describe('PUT /services/:id/images/:imageId', () => {
    it('updates alt text', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/images/${IMAGE_ID}`,
        { alt_text: 'Updated alt text' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.alt_text).toBe('Updated alt text');
    });
  });

  describe('DELETE /services/:id/images/:imageId', () => {
    it('deletes an image', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/images/${IMAGE_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });
});
