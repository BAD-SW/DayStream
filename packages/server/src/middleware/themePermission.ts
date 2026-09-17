import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/middleware';
import { adminPool } from '../db/pool';
import { getCallerScope } from '../services/theme.service';
import { error } from '../utils/response';

/**
 * Write-permission guard for theme routes (create/update/delete/apply). Looks up the
 * caller's persona + own business_id (see theme.service.getCallerScope — the JWT alone
 * doesn't carry these) and rejects any write whose target scope the caller isn't
 * permitted to manage:
 *   - system persona: unrestricted
 *   - tenant persona: any scope except system
 *   - business persona: only their own business (scope='business', scope_id=own businessId)
 */
export function requireThemeWritePermission() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetScope: string | undefined = req.body?.scope;
      const targetScopeId: string | null = req.body?.scope_id ?? null;

      const caller = await getCallerScope(req as AuthenticatedRequest, adminPool);
      (req as any).callerScope = caller;

      if (caller.persona === 'system') { next(); return; }

      if (caller.persona === 'tenant') {
        if (targetScope === 'system') {
          error(res, 'Insufficient permissions to manage themes at scope \'system\'', 'FORBIDDEN', 403);
          return;
        }
        next();
        return;
      }

      if (caller.persona === 'business') {
        if (targetScope !== 'business' || targetScopeId !== caller.businessId) {
          error(res, 'Business personas can only manage their own business theme', 'FORBIDDEN', 403);
          return;
        }
        next();
        return;
      }

      error(res, 'Insufficient permissions', 'FORBIDDEN', 403);
    } catch (err: any) {
      error(res, 'Failed to verify theme permissions', 'INTERNAL_ERROR', 500);
    }
  };
}

/**
 * Write-permission guard for /:id routes (update/delete) where scope isn't in the body —
 * it must be looked up from the existing cfg_themes row first.
 */
export function requireThemeRowWritePermission() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const caller = await getCallerScope(req as AuthenticatedRequest, adminPool);
      (req as any).callerScope = caller;

      if (caller.persona === 'system') { next(); return; }

      const { rows } = await adminPool.query(
        'SELECT scope, scope_id FROM cfg_themes WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND deleted_at IS NULL',
        [req.params.id, caller.tenantId],
      );
      const theme = rows[0];
      // Let a missing/built-in id fall through to the service layer's own 404/403 —
      // this guard only rejects on a confirmed, permission-violating scope match.
      if (!theme) { next(); return; }

      if (caller.persona === 'tenant') {
        if (theme.scope === 'system') {
          error(res, 'Insufficient permissions to manage themes at scope \'system\'', 'FORBIDDEN', 403);
          return;
        }
        next();
        return;
      }

      if (caller.persona === 'business') {
        if (theme.scope !== 'business' || theme.scope_id !== caller.businessId) {
          error(res, 'Business personas can only manage their own business theme', 'FORBIDDEN', 403);
          return;
        }
        next();
        return;
      }

      error(res, 'Insufficient permissions', 'FORBIDDEN', 403);
    } catch (err: any) {
      error(res, 'Failed to verify theme permissions', 'INTERNAL_ERROR', 500);
    }
  };
}
