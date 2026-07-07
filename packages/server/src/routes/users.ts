import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { validate } from '../middleware/validate';
import { paginationSchema, paginateSQL, paginationMeta, PaginationParams } from '../utils/pagination';

export const usersRouter = Router();

// All user routes require authentication and tenant context
usersRouter.use(authenticate);
usersRouter.use(tenantContext);

// GET /api/v1/users — List users in current tenant
usersRouter.get('/', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { error: validationError, value: params } = paginationSchema.validate(req.query);
    if (validationError) {
      error(res, 'Invalid pagination params', 'VALIDATION_ERROR', 400);
      return;
    }

    const pagination = params as PaginationParams;
    const { clause } = paginateSQL(pagination, ['created_at', 'email', 'first_name', 'last_name']);

    const [dataResult, countResult] = await Promise.all([
      adminPool.query(
        `SELECT id, email, first_name, last_name, role, status, created_at
         FROM usr_users WHERE tenant_id = $1 ${clause}`,
        [authReq.tenantId],
      ),
      adminPool.query(
        'SELECT COUNT(*) AS total FROM usr_users WHERE tenant_id = $1',
        [authReq.tenantId],
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);
    success(res, dataResult.rows, paginationMeta(total, pagination));
  } catch (err: any) {
    error(res, 'Failed to list users', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/users/:id — Get user detail
usersRouter.get('/:id', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, status, created_at, updated_at
       FROM usr_users WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, authReq.tenantId],
    );

    if (rows.length === 0) {
      error(res, 'User not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to get user', 'INTERNAL_ERROR', 500);
  }
});
