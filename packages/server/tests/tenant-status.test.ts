import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { enforceTenantStatus } from '../src/middleware/tenant-status';

// Mock the pool
vi.mock('../src/db/pool', () => ({
  pool: { query: vi.fn() },
  adminPool: { query: vi.fn() },
}));

import { pool, adminPool } from '../src/db/pool';
const mockQuery = adminPool.query as ReturnType<typeof vi.fn>;

function mockReqRes(tenantId?: string) {
  const req = {
    tenantId: tenantId || undefined,
    user: tenantId ? { sub: 'user-1', tid: tenantId } : undefined,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next };
}

describe('enforceTenantStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next for active tenant', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'active' }] });
    const { req, res, next } = mockReqRes('tenant-1');
    await enforceTenantStatus(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 for suspended tenant', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'suspended' }] });
    const { req, res, next } = mockReqRes('tenant-1');
    await enforceTenantStatus(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TENANT_SUSPENDED' }));
  });

  it('returns 404 for archived tenant', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'archived' }] });
    const { req, res, next } = mockReqRes('tenant-1');
    await enforceTenantStatus(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 when tenant not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { req, res, next } = mockReqRes('nonexistent');
    await enforceTenantStatus(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('calls next when no tenant context', async () => {
    const { req, res, next } = mockReqRes(undefined);
    await enforceTenantStatus(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
