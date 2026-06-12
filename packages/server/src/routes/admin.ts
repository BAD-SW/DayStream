import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { tenantContext } from '../auth/tenant-context';
import * as tenantService from '../services/tenant.service';
import * as configService from '../services/config.service';
import * as featureFlagService from '../services/feature-flag.service';
import { success, error } from '../utils/response';
import { pool } from '../db/pool';

export const adminRouter = Router();

// All admin routes require authentication
adminRouter.use(authenticate);

// --- Tenant Management (Super Admin only) ---

const createTenantSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  slug: Joi.string().min(2).max(100).pattern(/^[a-z0-9-]+$/),
  owner_email: Joi.string().email({ tlds: false }).required(),
  owner_first_name: Joi.string().min(1).max(100).required(),
  owner_last_name: Joi.string().min(1).max(100).required(),
  owner_password: Joi.string().min(10).required(),
  default_language: Joi.string().valid('en', 'es').default('en'),
  currency: Joi.string().length(3).uppercase().default('EUR'),
  timezone: Joi.string().max(50).default('UTC'),
});

// POST /api/v1/admin/tenants — Create a new tenant
adminRouter.post('/tenants', requirePermission('*:*'), validate(createTenantSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await tenantService.createTenant(req.body, authReq.user.sub);
    success(res, result, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('slug already exists')) {
      error(res, err.message, 'SLUG_EXISTS', 409);
    } else {
      error(res, 'Tenant creation failed', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/admin/tenants — List all tenants
adminRouter.get('/tenants', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const tenants = await tenantService.getTenants();
    success(res, tenants);
  } catch (err: any) {
    error(res, 'Failed to list tenants', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/tenants/:id — Get tenant detail
adminRouter.get('/tenants/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);
    if (!tenant) {
      error(res, 'Tenant not found', 'NOT_FOUND', 404);
      return;
    }
    success(res, tenant);
  } catch (err: any) {
    error(res, 'Failed to get tenant', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/tenants/:id/suspend
adminRouter.put('/tenants/:id/suspend', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenant = await tenantService.updateTenantStatus(req.params.id, 'suspended', authReq.user.sub);
    success(res, tenant);
  } catch (err: any) {
    if (err.message.includes('Cannot transition')) {
      error(res, err.message, 'INVALID_TRANSITION', 400);
    } else if (err.message === 'Tenant not found') {
      error(res, err.message, 'NOT_FOUND', 404);
    } else {
      error(res, 'Failed to suspend tenant', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/admin/tenants/:id/activate
adminRouter.put('/tenants/:id/activate', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenant = await tenantService.updateTenantStatus(req.params.id, 'active', authReq.user.sub);
    success(res, tenant);
  } catch (err: any) {
    if (err.message.includes('Cannot transition')) {
      error(res, err.message, 'INVALID_TRANSITION', 400);
    } else if (err.message === 'Tenant not found') {
      error(res, err.message, 'NOT_FOUND', 404);
    } else {
      error(res, 'Failed to activate tenant', 'INTERNAL_ERROR', 500);
    }
  }
});

// --- Configuration (Business Owner+, requires tenant context) ---

// GET /api/v1/admin/config — Get all config for current tenant
adminRouter.get('/config', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await configService.getAllConfig(authReq.tenantId);
    success(res, config);
  } catch (err: any) {
    error(res, 'Failed to get configuration', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/config/:key
adminRouter.get('/config/:key', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const value = await configService.getConfig(authReq.tenantId, req.params.key);
    if (value === undefined) {
      error(res, 'Configuration key not found', 'NOT_FOUND', 404);
      return;
    }
    success(res, { key: req.params.key, value });
  } catch (err: any) {
    error(res, 'Failed to get configuration', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/config/:key
const updateConfigSchema = Joi.object({
  value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).required(),
});

adminRouter.put('/config/:key', tenantContext, requirePermission('settings:*'), validate(updateConfigSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await configService.setConfig(authReq.tenantId, req.params.key, req.body.value, authReq.user.sub);
    success(res, { key: req.params.key, value: req.body.value });
  } catch (err: any) {
    if (err.message.includes('does not exist')) {
      error(res, err.message, 'NOT_FOUND', 404);
    } else {
      error(res, 'Failed to update configuration', 'INTERNAL_ERROR', 500);
    }
  }
});

// --- Feature Flags ---

// GET /api/v1/admin/feature-flags — List all flags
adminRouter.get('/feature-flags', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const flags = await featureFlagService.evaluateAllFlags({ tenantId: authReq.tenantId });
    success(res, flags);
  } catch (err: any) {
    error(res, 'Failed to get feature flags', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/feature-flags/:key — Update global flag (Super Admin)
const updateFlagSchema = Joi.object({
  enabled: Joi.boolean().required(),
});

adminRouter.put('/feature-flags/:key', requirePermission('*:*'), validate(updateFlagSchema), async (req: Request, res: Response) => {
  try {
    await pool.query(
      'UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2',
      [req.body.enabled, req.params.key],
    );
    featureFlagService.invalidateFlagCache();
    success(res, { key: req.params.key, enabled: req.body.enabled });
  } catch (err: any) {
    error(res, 'Failed to update feature flag', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/feature-flags/:key/override — Tenant override
adminRouter.put('/feature-flags/:key/override', tenantContext, requirePermission('settings:*'), validate(updateFlagSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Get flag ID
    const { rows } = await pool.query('SELECT id FROM feature_flags WHERE key = $1', [req.params.key]);
    if (rows.length === 0) {
      error(res, 'Feature flag not found', 'NOT_FOUND', 404);
      return;
    }

    await pool.query(
      `INSERT INTO feature_flag_overrides (flag_id, tenant_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (flag_id, tenant_id) DO UPDATE SET enabled = $3`,
      [rows[0].id, authReq.tenantId, req.body.enabled],
    );
    featureFlagService.invalidateFlagCache();
    success(res, { key: req.params.key, enabled: req.body.enabled, scope: 'tenant' });
  } catch (err: any) {
    error(res, 'Failed to update feature flag override', 'INTERNAL_ERROR', 500);
  }
});
