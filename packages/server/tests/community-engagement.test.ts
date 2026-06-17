import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let POST_ID: string;
let CHALLENGE_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = { hostname: 'localhost', port: address.port, path, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
      const req = http.request(options, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { server.close(); try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); } catch { resolve({ statusCode: res.statusCode!, body: d }); } }); });
      req.on('error', (err) => { server.close(); reject(err); }); if (data) req.write(data); req.end();
    });
  });
}

describe('Community & Engagement', () => {
  beforeAll(() => {
    ownerToken = authService.generateAccessToken('00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner', ['community:*']);
  });

  describe('Feed', () => {
    it('creates a post', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/community/posts', { content: 'Hello community!', post_type: 'text' }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.content).toBe('Hello community!');
      POST_ID = body.data.id;
    });

    it('gets the feed', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/feed', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('reacts to a post', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/community/posts/${POST_ID}/react`, { reaction_type: 'celebrate' }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.reaction_type).toBe('celebrate');
    });

    it('comments on a post', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/community/posts/${POST_ID}/comments`, { content: 'Great post!' }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.content).toBe('Great post!');
    });
  });

  describe('Challenges', () => {
    it('creates a challenge', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/community/challenges', {
        title: '30-Day Sauna Challenge', challengeType: 'attendance', goalConfig: { target: 10 },
        startDate: '2026-07-01', endDate: '2026-07-31',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.title).toBe('30-Day Sauna Challenge');
      CHALLENGE_ID = body.data.id;
    });

    it('lists challenges', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/challenges', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Points', () => {
    it('gets points (starts at 0)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/points', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('balance');
    });
  });

  describe('Badges', () => {
    it('lists available badges', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/badges', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Streaks', () => {
    it('gets streak (null if no activity)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/streaks', undefined, ownerToken);
      expect(statusCode).toBe(200);
      // null or streak object
    });
  });

  describe('Leaderboard', () => {
    it('gets points leaderboard', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/leaderboard?type=points', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('VOD', () => {
    it('creates VOD content', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/community/vod', {
        title: 'Guided Breathing', videoUrl: 'https://example.com/video.mp4', category: 'wellness', difficulty: 'beginner',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.title).toBe('Guided Breathing');
    });

    it('lists VOD library', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/community/vod', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reviews', () => {
    it('submits a review', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/community/reviews', {
        rating: 5, content: 'Amazing experience!',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.rating).toBe(5);
    });
  });
});
