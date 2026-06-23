import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { tenantContext } from '../auth/tenant-context';
import * as tenantService from '../services/tenant.service';
import * as configService from '../services/config.service';
import * as featureFlagService from '../services/feature-flag.service';
import { logAudit, queryAuditLog } from '../services/audit.service';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';

export const adminRouter = Router();

// All admin routes require authentication
adminRouter.use(authenticate);

/**
 * Calculate the next billing date based on last billing date (or signup date as fallback) and frequency.
 * Logic: advance from the reference date by the frequency interval until the date is in the future.
 */
function calculateNextBillingDate(lastBillingDate: string | null, signupDate: string | null, frequency: string): string | null {
  const refDateStr = lastBillingDate || signupDate;
  if (!refDateStr) return null;
  const ref = new Date(refDateStr);
  if (isNaN(ref.getTime())) return null;

  const now = new Date();
  let next = new Date(ref);

  const addInterval = (d: Date): Date => {
    const result = new Date(d);
    switch (frequency) {
      case 'monthly': result.setMonth(result.getMonth() + 1); break;
      case 'quarterly': result.setMonth(result.getMonth() + 3); break;
      case 'semi-annual': result.setMonth(result.getMonth() + 6); break;
      case 'annual': result.setFullYear(result.getFullYear() + 1); break;
      default: result.setMonth(result.getMonth() + 1);
    }
    return result;
  };

  // Advance until next billing date is in the future
  while (next <= now) {
    next = addInterval(next);
  }

  return next.toISOString().split('T')[0];
}
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

// GET /api/v1/admin/tenants/:id — Get tenant detail (includes owner)
adminRouter.get('/tenants/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);
    if (!tenant) {
      error(res, 'Tenant not found', 'NOT_FOUND', 404);
      return;
    }
    // Fetch owner (first business_owner user for this tenant)
    const { rows: ownerRows } = await adminPool.query(
      `SELECT id, email, first_name, last_name FROM users WHERE tenant_id = $1 AND role = 'business_owner' ORDER BY created_at ASC LIMIT 1`,
      [req.params.id],
    );
    const owner = ownerRows[0] || null;
    success(res, { ...tenant, owner });
  } catch (err: any) {
    error(res, 'Failed to get tenant', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/tenants/:id — Update tenant
const updateTenantSchema = Joi.object({
  name: Joi.string().min(2).max(255),
  slug: Joi.string().min(2).max(100).pattern(/^[a-z0-9-]+$/),
  default_language: Joi.string().valid('en', 'es'),
  currency: Joi.string().length(3).uppercase(),
  timezone: Joi.string().max(50),
  owner_email: Joi.string().email({ tlds: false }),
  owner_first_name: Joi.string().min(1).max(100),
  owner_last_name: Joi.string().min(1).max(100),
  billing_frequency: Joi.string().valid('monthly', 'quarterly', 'semi-annual', 'annual'),
  billing_amount: Joi.number().integer().min(0),
  billing_method: Joi.string().max(50),
  signup_date: Joi.string().isoDate(),
  next_billing_date: Joi.string().isoDate().allow(null, ''),
}).min(1);

adminRouter.put('/tenants/:id', requirePermission('*:*'), validate(updateTenantSchema), async (req: Request, res: Response) => {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);
    if (!tenant) {
      error(res, 'Tenant not found', 'NOT_FOUND', 404);
      return;
    }

    // Separate tenant fields from owner fields
    const { owner_email, owner_first_name, owner_last_name, ...tenantFields } = req.body;

    // Check slug uniqueness if changing
    if (tenantFields.slug && tenantFields.slug !== tenant.slug) {
      const { rows: existing } = await adminPool.query(
        'SELECT id FROM tenants WHERE slug = $1 AND id != $2',
        [tenantFields.slug, req.params.id],
      );
      if (existing.length > 0) {
        error(res, 'A tenant with this slug already exists', 'SLUG_EXISTS', 409);
        return;
      }
    }

    // Update tenant record
    const tenantEntries = Object.entries(tenantFields);
    if (tenantEntries.length > 0) {
      // Auto-calculate next_billing_date if frequency or signup_date changed but next_billing_date wasn't explicitly set
      if (!tenantFields.next_billing_date && (tenantFields.billing_frequency || tenantFields.signup_date)) {
        const lastBilling = tenant.last_billing_date;
        const signupDt = tenantFields.signup_date || tenant.signup_date;
        const freq = tenantFields.billing_frequency || tenant.billing_frequency || 'monthly';
        const nextBilling = calculateNextBillingDate(lastBilling, signupDt, freq);
        if (nextBilling && !tenantEntries.find(([k]) => k === 'next_billing_date')) {
          tenantEntries.push(['next_billing_date', nextBilling]);
        }
      }

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, val] of tenantEntries) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
      fields.push('updated_at = NOW()');
      values.push(req.params.id);
      await adminPool.query(
        `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx}`,
        values,
      );
    }

    // Update owner user if any owner fields provided
    if (owner_email || owner_first_name || owner_last_name) {
      const ownerFields: string[] = [];
      const ownerValues: any[] = [];
      let oidx = 1;
      if (owner_email) { ownerFields.push(`email = $${oidx++}`); ownerValues.push(owner_email); }
      if (owner_first_name) { ownerFields.push(`first_name = $${oidx++}`); ownerValues.push(owner_first_name); }
      if (owner_last_name) { ownerFields.push(`last_name = $${oidx++}`); ownerValues.push(owner_last_name); }
      ownerFields.push(`updated_at = NOW()`);
      ownerValues.push(req.params.id);
      await adminPool.query(
        `UPDATE users SET ${ownerFields.join(', ')} WHERE tenant_id = $${oidx} AND role = 'business_owner'`,
        ownerValues,
      );
    }

    // Return updated tenant with owner
    const updated = await tenantService.getTenantById(req.params.id);
    const { rows: ownerRows } = await adminPool.query(
      `SELECT id, email, first_name, last_name FROM users WHERE tenant_id = $1 AND role = 'business_owner' ORDER BY created_at ASC LIMIT 1`,
      [req.params.id],
    );
    success(res, { ...updated, owner: ownerRows[0] || null });
  } catch (err: any) {
    error(res, 'Failed to update tenant', 'INTERNAL_ERROR', 500);
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

// --- Businesses (Tenant Owner) ---

// GET /api/v1/admin/businesses — List businesses for current tenant
adminRouter.get('/businesses', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      'SELECT id, name, slug, status, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, created_at, updated_at FROM businesses WHERE tenant_id = $1 ORDER BY name',
      [authReq.tenantId],
    );
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to list businesses', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/admin/businesses — Create a business
adminRouter.post('/businesses', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, slug, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, signup_date, next_billing_date } = req.body;
    if (!name) { error(res, 'Name is required', 'VALIDATION_ERROR', 400); return; }
    const businessSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const freq = billing_frequency || 'monthly';
    const signupDt = signup_date || new Date().toISOString().split('T')[0];
    const nextBilling = next_billing_date || calculateNextBillingDate(null, signupDt, freq);
    const { rows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, signup_date, next_billing_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [authReq.tenantId, name, businessSlug, email || null, phone || null, address || null, default_language || 'en', currency || 'EUR', timezone || 'UTC', primary_color || '#C9A96E', freq, billing_amount ?? 0, billing_method || 'tbd', signupDt, nextBilling],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('unique') || err.code === '23505') {
      error(res, 'A business with this URL alias already exists', 'SLUG_EXISTS', 409);
    } else {
      error(res, 'Failed to create business', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/admin/businesses/:id — Update a business
adminRouter.put('/businesses/:id', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, slug, email, phone, address, default_language, currency, timezone, primary_color, status, billing_frequency, billing_amount, billing_method } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (slug !== undefined) { fields.push(`slug = $${idx++}`); values.push(slug); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (address !== undefined) { fields.push(`address = $${idx++}`); values.push(address); }
    if (default_language !== undefined) { fields.push(`default_language = $${idx++}`); values.push(default_language); }
    if (currency !== undefined) { fields.push(`currency = $${idx++}`); values.push(currency); }
    if (timezone !== undefined) { fields.push(`timezone = $${idx++}`); values.push(timezone); }
    if (primary_color !== undefined) { fields.push(`primary_color = $${idx++}`); values.push(primary_color); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (billing_frequency !== undefined) { fields.push(`billing_frequency = $${idx++}`); values.push(billing_frequency); }
    if (billing_amount !== undefined) { fields.push(`billing_amount = $${idx++}`); values.push(billing_amount); }
    if (billing_method !== undefined) { fields.push(`billing_method = $${idx++}`); values.push(billing_method); }
    if (req.body.signup_date !== undefined) { fields.push(`signup_date = $${idx++}`); values.push(req.body.signup_date); }
    if (req.body.next_billing_date !== undefined) { fields.push(`next_billing_date = $${idx++}`); values.push(req.body.next_billing_date); }
    // Auto-calculate next_billing_date if frequency or signup_date changed but next_billing_date wasn't explicitly set
    if (req.body.next_billing_date === undefined && (req.body.billing_frequency || req.body.signup_date)) {
      // Fetch current record to get the full context
      const { rows: currentRows } = await adminPool.query('SELECT signup_date, billing_frequency, last_billing_date FROM businesses WHERE id = $1 AND tenant_id = $2', [req.params.id, authReq.tenantId]);
      if (currentRows.length > 0) {
        const lastBilling = currentRows[0].last_billing_date;
        const signupDt = req.body.signup_date || currentRows[0].signup_date;
        const freq = req.body.billing_frequency || currentRows[0].billing_frequency;
        const nextBilling = calculateNextBillingDate(lastBilling, signupDt, freq);
        if (nextBilling) { fields.push(`next_billing_date = $${idx++}`); values.push(nextBilling); }
      }
    }
    if (fields.length === 0) { error(res, 'No fields to update', 'VALIDATION_ERROR', 400); return; }
    fields.push('updated_at = NOW()');
    values.push(req.params.id, authReq.tenantId);
    const { rows } = await adminPool.query(
      `UPDATE businesses SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      values,
    );
    if (rows.length === 0) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      error(res, 'A business with this URL alias already exists', 'SLUG_EXISTS', 409);
    } else {
      error(res, 'Failed to update business', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/admin/businesses/:id — Archive a business
adminRouter.delete('/businesses/:id', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `UPDATE businesses SET status = 'archived', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id, name, status`,
      [req.params.id, authReq.tenantId],
    );
    if (rows.length === 0) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to archive business', 'INTERNAL_ERROR', 500);
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
    const authReq = req as AuthenticatedRequest;
    await adminPool.query(
      'UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2',
      [req.body.enabled, req.params.key],
    );
    featureFlagService.invalidateFlagCache();
    await logAudit({
      tenantId: authReq.user.tid || 'system',
      userId: authReq.user.sub,
      action: 'feature_flag.updated',
      resourceType: 'feature_flag',
      details: { key: req.params.key, enabled: req.body.enabled, scope: 'global' },
    });
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
    const { rows } = await adminPool.query('SELECT id FROM feature_flags WHERE key = $1', [req.params.key]);
    if (rows.length === 0) {
      error(res, 'Feature flag not found', 'NOT_FOUND', 404);
      return;
    }

    await adminPool.query(
      `INSERT INTO feature_flag_overrides (flag_id, tenant_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (flag_id, tenant_id) DO UPDATE SET enabled = $3`,
      [rows[0].id, authReq.tenantId, req.body.enabled],
    );
    featureFlagService.invalidateFlagCache();
    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'feature_flag.override',
      resourceType: 'feature_flag',
      details: { key: req.params.key, enabled: req.body.enabled, scope: 'tenant' },
    });
    success(res, { key: req.params.key, enabled: req.body.enabled, scope: 'tenant' });
  } catch (err: any) {
    error(res, 'Failed to update feature flag override', 'INTERNAL_ERROR', 500);
  }
});


// --- Audit Log ---

// GET /api/v1/admin/audit-log — Query audit log
adminRouter.get('/audit-log', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await queryAuditLog(authReq.tenantId, {
      userId: req.query.user_id as string,
      action: req.query.action as string,
      resourceType: req.query.resource_type as string,
      startDate: req.query.start_date as string,
      endDate: req.query.end_date as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    success(res, result.entries, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) {
    error(res, 'Failed to query audit log', 'INTERNAL_ERROR', 500);
  }
});
