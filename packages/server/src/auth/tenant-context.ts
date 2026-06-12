import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';

/**
 * Middleware to enforce tenant context.
 * Requires authentication first — extracts tenant_id from JWT.
 * Rejects requests without a valid tenant context.
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user || !authReq.user.tid) {
    res.status(401).json({ error: 'Tenant context required', code: 'MISSING_TENANT' });
    return;
  }

  authReq.tenantId = authReq.user.tid;
  next();
}
