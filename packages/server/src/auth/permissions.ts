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
 * Require ALL of the specified permissions to proceed.
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
    );

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
