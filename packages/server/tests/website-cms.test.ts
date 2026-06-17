import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let SITE_ID: string;
let PAGE_ID: string;
let POST_ID: string;
let ownerToken: string;

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

describe('Website & CMS', () => {
  beforeAll(() => {
    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['cms:*', 'cms:read'],
    );
  });

  describe('Site Management', () => {
    it('gets or creates tenant site', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/site', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.tenant_id).toBe(TENANT_ID);
      expect(body.data.slug).toBeTruthy();
      SITE_ID = body.data.id;
    });

    it('configures a custom domain', async () => {
      const { statusCode, body } = await request('PUT', '/api/v1/cms/site/domain', { domain: 'www.example-wellness.com' }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.custom_domain).toBe('www.example-wellness.com');
      expect(body.data.domain_status).toBe('verifying');
    });

    it('publishes the site', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/cms/site/publish', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.is_published).toBe(true);
    });
  });

  describe('Pages', () => {
    it('creates a page', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/cms/pages', {
        slug: 'about', title: 'About Us', pageType: 'about',
        contentBlocks: [{ type: 'text_section', config: { html: '<p>Welcome</p>' } }],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.slug).toBe('about');
      PAGE_ID = body.data.id;
    });

    it('lists pages', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/pages', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('publishes a page', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/cms/pages/${PAGE_ID}/publish`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('published');
    });
  });

  describe('Blog', () => {
    it('creates a blog post', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/cms/blog', {
        title: 'Benefits of Cold Therapy', content: '<p>Cold water immersion...</p>', category: 'wellness',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.title).toBe('Benefits of Cold Therapy');
      expect(body.data.slug).toContain('benefits');
      POST_ID = body.data.id;
    });

    it('publishes a blog post', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/cms/blog/${POST_ID}/publish`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('published');
    });

    it('lists blog posts', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/blog', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Navigation', () => {
    it('updates header navigation', async () => {
      const { statusCode, body } = await request('PUT', '/api/v1/cms/navigation', {
        nav_type: 'header',
        items: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: 'Book Now', href: '/book', isCta: true }],
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.nav_type).toBe('header');
    });

    it('gets navigation', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/navigation', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.header).toBeTruthy();
    });
  });

  describe('Templates', () => {
    it('lists templates', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/templates', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Forms', () => {
    it('submits a contact form (public)', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/cms/forms/submit', {
        tenant_id: TENANT_ID, form_name: 'contact',
        data: { name: 'Jane', email: 'jane@test.com', message: 'Hello!' },
      });
      expect(statusCode).toBe(201);
      expect(body.data.form_name).toBe('contact');
    });

    it('lists submissions (admin)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/cms/forms/submissions', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Public Site', () => {
    it('gets public site by slug', async () => {
      const { body: siteBody } = await request('GET', '/api/v1/cms/site', undefined, ownerToken);
      const slug = siteBody.data.slug;
      const { statusCode, body } = await request('GET', `/api/v1/cms/public/site?slug=${slug}`);
      expect(statusCode).toBe(200);
      expect(body.data.site).toBeTruthy();
      expect(body.data.navigation).toBeTruthy();
    });
  });
});
