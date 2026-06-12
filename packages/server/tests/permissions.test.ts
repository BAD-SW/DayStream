import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { requirePermission, requireAnyPermission } from '../src/auth/permissions';

function mockReqRes(permissions: string[]) {
  const req = {
    user: { sub: 'user-1', tid: 'tenant-1', role: 'staff', permissions },
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next };
}

describe('requirePermission', () => {
  it('allows exact permission match', () => {
    const { req, res, next } = mockReqRes(['bookings:create']);
    requirePermission('bookings:create')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows wildcard all (*:*)', () => {
    const { req, res, next } = mockReqRes(['*:*']);
    requirePermission('bookings:create')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows resource wildcard (bookings:*)', () => {
    const { req, res, next } = mockReqRes(['bookings:*']);
    requirePermission('bookings:delete')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies when permission not present', () => {
    const { req, res, next } = mockReqRes(['bookings:read']);
    requirePermission('bookings:create')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires ALL permissions when multiple specified', () => {
    const { req, res, next } = mockReqRes(['bookings:create']);
    requirePermission('bookings:create', 'bookings:delete')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('denies when no user', () => {
    const req = {} as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    requirePermission('bookings:create')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireAnyPermission', () => {
  it('allows if user has any one of the listed permissions', () => {
    const { req, res, next } = mockReqRes(['bookings:read']);
    requireAnyPermission('bookings:read', 'services:read')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies if user has none of the listed permissions', () => {
    const { req, res, next } = mockReqRes(['customers:read']);
    requireAnyPermission('bookings:read', 'services:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
