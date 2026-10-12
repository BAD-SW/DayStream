import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';
import { logger } from '../middleware/logger';

/**
 * Match a user permission against a required permission.
 * Supports:
 *   - Exact match: 'bookings:create' matches 'bookings:create'
 *   - Wildcard all: '*:*' matches everything
 *   - Resource wildcard: 'bookings:*' matches 'bookings:create', 'bookings:read', etc.
 */
function matchPermission(userPerm: string, required: string): boolean {
  if (userPerm === '*:*') return true;
  if (userPerm === required) return true;

  const [userResource, userAction] = userPerm.split(':');
  const [reqResource] = required.split(':');

  if (userResource === reqResource && userAction === '*') return true;

  return false;
}

/**
 * Whether a role is a platform (DayStream staff) role. A login token carries the role's
 * display name ("Super Admin"); the column value form ("system_admin") is accepted as well.
 */
export function isSystemRole(role: string | undefined | null): boolean {
  const r = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return r === 'super_admin' || r === 'system_admin' || r === 'system_support';
}

/**
 * Require ALL of the specified permissions to proceed.
 *
 * Requiring '*:*' means "platform staff only". Holding the '*:*' permission is not enough for
 * that: a tenant owner holds it too (everything, within their own tenant), and platform
 * endpoints (all tenants, all users, platform configuration, platform billing) must stay closed
 * to them. So a '*:*' requirement also demands a platform role.
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
      return;
    }

    const userPermissions = authReq.user.permissions || [];

    const hasAll = permissions.every((required) =>
      userPermissions.some((userPerm) => matchPermission(userPerm, required)),
    ) && (!permissions.includes('*:*') || isSystemRole(authReq.user.role));

    if (!hasAll) {
      logger.warn('Permission denied', {
        userId: authReq.user.sub,
        required: permissions,
        userPermissions,
      });
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return;
    }

    next();
  };
}

/**
 * Require ANY ONE of the specified permissions to proceed.
 */
export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
      return;
    }

    const userPermissions = authReq.user.permissions || [];

    const hasAny = permissions.some((required) =>
      userPermissions.some((userPerm) => matchPermission(userPerm, required)),
    );

    if (!hasAny) {
      logger.warn('Permission denied (any)', {
        userId: authReq.user.sub,
        required: permissions,
        userPermissions,
      });
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return;
    }

    next();
  };
}
