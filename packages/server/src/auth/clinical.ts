import { Request, Response, NextFunction } from 'express';
import { adminPool } from '../db/pool';
import { AuthenticatedRequest, JwtPayload } from './middleware';

/**
 * Who may see and write treatment charts (spec 51, gap 2).
 *
 * Roles that hold the `clinical:*` permission (tenant owner, business owner, manager) are
 * admitted directly. Technicians (and the older therapist and trainer roles) share the "Staff" role with reception, which must
 * not see charts, so they are admitted by their job title (the role stored on their user record)
 * instead of by a role permission. Everyone else, reception and customers included, is refused.
 */
// 'technician' is the generic job role; therapist and trainer are older names that still work.
const CLINICAL_JOB_TITLES = new Set(['technician', 'business_staff', 'therapist', 'trainer']);

export async function hasClinicalAccess(user: JwtPayload): Promise<boolean> {
  const perms = user.permissions || [];
  if (perms.some((p) => p === '*:*' || p === 'clinical:*')) return true;
  const { rows } = await adminPool.query('SELECT role FROM usr_users WHERE id = $1', [user.sub]);
  return rows[0] ? CLINICAL_JOB_TITLES.has(String(rows[0].role).toLowerCase()) : false;
}

/** Express guard: 403 unless the caller may use charts. */
export function requireClinical() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
      return;
    }
    try {
      if (await hasClinicalAccess(authReq.user)) { next(); return; }
    } catch (e) {
      console.error('Clinical access check failed', (e as Error).message);
      res.status(500).json({ error: 'Failed to check access', code: 'INTERNAL_ERROR' });
      return;
    }
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
  };
}
