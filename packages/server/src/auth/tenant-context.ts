import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';

const CONTEXT_TENANT_HEADER = 'x-context-tenant-id';

/**
 * Middleware to enforce tenant context.
 * Requires authentication first — extracts tenant_id from JWT.
 * Rejects requests without a valid tenant context.
 *
 * A caller holding the platform-wide '*:*' permission (system persona) may narrow
 * the effective tenant scope for this request via the X-Context-Tenant-Id header —
 * e.g. a system admin who has switched the Context Switcher into a specific tenant.
 * This is a data-scoping hint only: it never grants access beyond what the JWT's
 * own role/permissions already allow, and non-system callers cannot use it to
 * escape their own tenant (the header is ignored for them).
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user || !authReq.user.tid) {
    res.status(401).json({ error: 'Tenant context required', code: 'MISSING_TENANT' });
    return;
  }

  const contextTenantHeader = req.headers[CONTEXT_TENANT_HEADER];
  const hasPlatformPermission = (authReq.user.permissions || []).includes('*:*');

  if (hasPlatformPermission && typeof contextTenantHeader === 'string' && contextTenantHeader) {
    authReq.tenantId = contextTenantHeader;
  } else {
    authReq.tenantId = authReq.user.tid;
  }

  next();
}
