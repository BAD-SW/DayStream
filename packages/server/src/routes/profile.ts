import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';

export const profileRouter = Router();

// All profile routes require authentication and tenant context
profileRouter.use(authenticate);
profileRouter.use(tenantContext);

// GET /api/v1/profile — Get current user's profile
profileRouter.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, status, created_at, updated_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [authReq.user.sub, authReq.tenantId],
    );

    if (rows.length === 0) {
      error(res, 'Profile not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to get profile', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/profile — Update current user's profile
const updateProfileSchema = Joi.object({
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
}).min(1);

profileRouter.put('/', validate(updateProfileSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(req.body)) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    fields.push('updated_at = NOW()');
    values.push(authReq.user.sub);
    values.push(authReq.tenantId);

    await adminPool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}`,
      values,
    );

    // Return updated profile
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, status, created_at, updated_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [authReq.user.sub, authReq.tenantId],
    );

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to update profile', 'INTERNAL_ERROR', 500);
  }
});
