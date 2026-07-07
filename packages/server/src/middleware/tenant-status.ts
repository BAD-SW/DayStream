import { Request, Response, NextFunction } from 'express';
import { adminPool } from '../db/pool';
import { AuthenticatedRequest } from '../auth/middleware';

/**
 * Middleware that checks the tenant's status before allowing the request to proceed.
 * Returns 403 for suspended tenants and 404 for archived tenants.
 * Should be applied after authentication and tenant context.
 */
export async function enforceTenantStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const tenantId = authReq.tenantId;

  if (!tenantId) {
    next();
    return;
  }

  try {
    const { rows } = await adminPool.query('SELECT status FROM sys_tenants WHERE id = $1', [tenantId]);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found', code: 'TENANT_NOT_FOUND' });
      return;
    }

    const status = rows[0].status;

    if (status === 'suspended') {
      res.status(403).json({
        error: 'This account has been suspended. Please contact support.',
        code: 'TENANT_SUSPENDED',
      });
      return;
    }

    if (status === 'archived') {
      res.status(404).json({ error: 'Not found', code: 'TENANT_NOT_FOUND' });
      return;
    }

    next();
  } catch {
    next();
  }
}
