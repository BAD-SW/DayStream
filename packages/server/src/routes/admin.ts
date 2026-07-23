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
import { hashPassword } from '../services/auth.service';
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
  slug: Joi.string().allow('').max(100).pattern(/^[a-z0-9-]+$/),
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
    // Fetch owner (first tenant_owner user for this tenant)
    const { rows: ownerRows } = await adminPool.query(
      `SELECT id, email, first_name, last_name FROM usr_users WHERE tenant_id = $1 AND role = 'tenant_owner' ORDER BY created_at ASC LIMIT 1`,
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
        'SELECT id FROM sys_tenants WHERE slug = $1 AND id != $2',
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
        `UPDATE sys_tenants SET ${fields.join(', ')} WHERE id = $${idx}`,
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
        `UPDATE usr_users SET ${ownerFields.join(', ')} WHERE tenant_id = $${oidx} AND role = 'tenant_owner'`,
        ownerValues,
      );
    }

    // Return updated tenant with owner
    const updated = await tenantService.getTenantById(req.params.id);
    const { rows: ownerRows } = await adminPool.query(
      `SELECT id, email, first_name, last_name FROM usr_users WHERE tenant_id = $1 AND role = 'tenant_owner' ORDER BY created_at ASC LIMIT 1`,
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
      'SELECT id, name, slug, status, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, created_at, updated_at FROM sys_businesses WHERE tenant_id = $1 ORDER BY name',
      [authReq.tenantId],
    );
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to list businesses', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/admin/businesses — Create a business (with owner user)
adminRouter.post('/businesses', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, slug, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, signup_date, next_billing_date, owner_email, owner_first_name, owner_last_name, owner_password } = req.body;
    if (!name) { error(res, 'Name is required', 'VALIDATION_ERROR', 400); return; }
    if (!owner_email || !owner_first_name || !owner_last_name || !owner_password) {
      error(res, 'Owner details (email, first name, last name, password) are required', 'VALIDATION_ERROR', 400);
      return;
    }
    if (owner_password.length < 10) {
      error(res, 'Owner password must be at least 10 characters', 'VALIDATION_ERROR', 400);
      return;
    }

    const tenantId = authReq.tenantId;
    const businessSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const freq = billing_frequency || 'monthly';
    const signupDt = signup_date || new Date().toISOString().split('T')[0];
    const nextBilling = next_billing_date || calculateNextBillingDate(null, signupDt, freq);

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      // Create the business
      const { rows: bizRows } = await client.query(
        `INSERT INTO sys_businesses (tenant_id, name, slug, email, phone, address, default_language, currency, timezone, primary_color, billing_frequency, billing_amount, billing_method, signup_date, next_billing_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [tenantId, name, businessSlug, email || null, phone || null, address || null, default_language || 'en', currency || 'EUR', timezone || 'UTC', primary_color || '#C9A96E', freq, billing_amount ?? 0, billing_method || 'tbd', signupDt, nextBilling],
      );
      const business = bizRows[0];

      // Check owner email uniqueness
      const { rows: existingUser } = await client.query(
        'SELECT id FROM usr_users WHERE email = $1 AND tenant_id = $2',
        [owner_email, tenantId],
      );
      if (existingUser.length > 0) {
        await client.query('ROLLBACK');
        error(res, 'A user with this email already exists in this tenant', 'EMAIL_EXISTS', 409);
        return;
      }

      // Create business owner user
      const passwordHash = await hashPassword(owner_password);
      const { rows: userRows } = await client.query(
        `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'business_owner', 'business', 'active')
         RETURNING id, email, first_name, last_name, role, persona`,
        [tenantId, business.id, owner_email, owner_first_name, owner_last_name, passwordHash],
      );
      const owner = userRows[0];

      // Assign Business Owner role
      const { rows: roleRows } = await client.query(
        "SELECT id FROM usr_roles WHERE tenant_id = $1 AND name = 'Business Owner'",
        [tenantId],
      );
      if (roleRows.length > 0) {
        await client.query(
          'INSERT INTO usr_user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [owner.id, roleRows[0].id, tenantId],
        );
      }

      // Create staff profile for the business owner
      const { rows: staffRefRows } = await client.query(
        'SELECT COUNT(*)::int AS cnt FROM stf_profiles WHERE tenant_id = $1',
        [tenantId],
      );
      const staffRef = `STF-${String((staffRefRows[0].cnt || 0) + 1).padStart(3, '0')}`;
      await client.query(
        `INSERT INTO stf_profiles (tenant_id, user_id, staff_ref, first_name, last_name, email, employment_type, status, show_on_directory, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'full_time', 'active', true, $2)`,
        [tenantId, owner.id, staffRef, owner_first_name, owner_last_name, owner_email],
      );

      // Auto-create default location
      await client.query(
        `INSERT INTO sys_locations (business_id, name, slug, status, is_primary, timezone)
         VALUES ($1, $2, $3, 'active', true, $4)`,
        [business.id, name, businessSlug, timezone || 'UTC'],
      );

      await client.query('COMMIT');

      success(res, { ...business, owner }, undefined, 201);
    } catch (innerErr) {
      await client.query('ROLLBACK');
      throw innerErr;
    } finally {
      client.release();
    }
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
      const { rows: currentRows } = await adminPool.query('SELECT signup_date, billing_frequency, last_billing_date FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [req.params.id, authReq.tenantId]);
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
      `UPDATE sys_businesses SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
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
      `UPDATE sys_businesses SET status = 'archived', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id, name, status`,
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
      'UPDATE sys_feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2',
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
    const { rows } = await adminPool.query('SELECT id FROM sys_feature_flags WHERE key = $1', [req.params.key]);
    if (rows.length === 0) {
      error(res, 'Feature flag not found', 'NOT_FOUND', 404);
      return;
    }

    await adminPool.query(
      `INSERT INTO sys_feature_flag_overrides (flag_id, tenant_id, enabled)
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

// --- Tenant Billing Self-Service ---

// GET /api/v1/admin/my-billing — Tenant views their own billing info (read-only terms + editable payment method)
adminRouter.get('/my-billing', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `SELECT billing_frequency, billing_amount, billing_method, currency, signup_date, next_billing_date, last_billing_date,
              payment_bank_name, payment_account_holder, payment_account_number, payment_routing_number, payment_iban,
              payment_card_last4, payment_card_brand, payment_card_exp
       FROM sys_tenants WHERE id = $1`,
      [authReq.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to get billing info', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/my-billing/payment-method — Tenant updates their own payment method
adminRouter.put('/my-billing/payment-method', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { payment_bank_name, payment_account_holder, payment_account_number, payment_routing_number, payment_iban, payment_card_last4, payment_card_brand, payment_card_exp } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (payment_bank_name !== undefined) { fields.push(`payment_bank_name = $${idx++}`); values.push(payment_bank_name); }
    if (payment_account_holder !== undefined) { fields.push(`payment_account_holder = $${idx++}`); values.push(payment_account_holder); }
    if (payment_account_number !== undefined) { fields.push(`payment_account_number = $${idx++}`); values.push(payment_account_number); }
    if (payment_routing_number !== undefined) { fields.push(`payment_routing_number = $${idx++}`); values.push(payment_routing_number); }
    if (payment_iban !== undefined) { fields.push(`payment_iban = $${idx++}`); values.push(payment_iban); }
    if (payment_card_last4 !== undefined) { fields.push(`payment_card_last4 = $${idx++}`); values.push(payment_card_last4); }
    if (payment_card_brand !== undefined) { fields.push(`payment_card_brand = $${idx++}`); values.push(payment_card_brand); }
    if (payment_card_exp !== undefined) { fields.push(`payment_card_exp = $${idx++}`); values.push(payment_card_exp); }
    if (fields.length === 0) { error(res, 'No fields to update', 'VALIDATION_ERROR', 400); return; }
    fields.push('updated_at = NOW()');
    values.push(authReq.tenantId);
    await adminPool.query(`UPDATE sys_tenants SET ${fields.join(', ')} WHERE id = $${idx}`, values);
    success(res, { message: 'Payment method updated' });
  } catch (err: any) {
    error(res, 'Failed to update payment method', 'INTERNAL_ERROR', 500);
  }
});


// --- Tenant Reports ---

// GET /api/v1/admin/reports/tenant-revenue
adminRouter.get('/reports/tenant-revenue', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows: bizRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND status = 'active'",
      [authReq.tenantId],
    );
    // Placeholder: real revenue would come from payment/billing ledger
    // Calculate expected remaining revenue for the current month
    // Businesses whose next_billing_date is this month (haven't been billed yet)
    const { rows: expectedMtdRows } = await adminPool.query(
      `SELECT COALESCE(SUM(billing_amount), 0) as expected_remaining_mtd
       FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' AND billing_amount > 0
       AND next_billing_date >= date_trunc('month', NOW())
       AND next_billing_date < date_trunc('month', NOW()) + INTERVAL '1 month'`,
      [authReq.tenantId],
    );
    // Calculate expected remaining revenue for the year
    const { rows: expectedRows } = await adminPool.query(
      `SELECT COALESCE(SUM(
        billing_amount * (
          CASE billing_frequency
            WHEN 'monthly' THEN (12 - EXTRACT(MONTH FROM NOW())::int)
            WHEN 'quarterly' THEN GREATEST(0, 4 - CEIL(EXTRACT(MONTH FROM NOW()) / 3.0)::int)
            WHEN 'semi-annual' THEN GREATEST(0, 2 - CEIL(EXTRACT(MONTH FROM NOW()) / 6.0)::int)
            WHEN 'annual' THEN CASE WHEN EXTRACT(MONTH FROM next_billing_date) > EXTRACT(MONTH FROM NOW()) THEN 1 ELSE 0 END
            ELSE 0
          END
        )
      ), 0) as expected_remaining
       FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' AND billing_amount > 0`,
      [authReq.tenantId],
    );
    success(res, {
      total_revenue_ytd: 0,
      total_revenue_ytd_prior: 0,
      month_revenue: 0,
      month_revenue_prior: 0,
      active_businesses: parseInt(bizRows[0].count),
      expected_remaining: parseInt(expectedRows[0].expected_remaining),
      expected_remaining_mtd: parseInt(expectedMtdRows[0].expected_remaining_mtd),
    });
  } catch (err: any) {
    error(res, 'Failed to get revenue report', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-customers
adminRouter.get('/reports/tenant-customers', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Active businesses
    const { rows: activeRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND status = 'active'",
      [authReq.tenantId],
    );
    // Active businesses same time prior year
    const { rows: activePriorRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' AND created_at <= (NOW() - INTERVAL '1 year')",
      [authReq.tenantId],
    );
    // New this month
    const { rows: newRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())",
      [authReq.tenantId],
    );
    // New same month prior year
    const { rows: newPriorRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 year') AND created_at < date_trunc('month', NOW() - INTERVAL '1 year') + INTERVAL '1 month'",
      [authReq.tenantId],
    );
    // Churned this month (status changed to archived/suspended this month)
    const { rows: churnedRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND status != 'active' AND updated_at >= date_trunc('month', NOW())",
      [authReq.tenantId],
    );
    // Churned same month prior year
    const { rows: churnedPriorRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE tenant_id = $1 AND status != 'active' AND updated_at >= date_trunc('month', NOW() - INTERVAL '1 year') AND updated_at < date_trunc('month', NOW() - INTERVAL '1 year') + INTERVAL '1 month'",
      [authReq.tenantId],
    );
    success(res, {
      active_businesses: parseInt(activeRows[0].count),
      active_businesses_prior: parseInt(activePriorRows[0].count),
      new_this_month: parseInt(newRows[0].count),
      new_this_month_prior: parseInt(newPriorRows[0].count),
      churned_this_month: parseInt(churnedRows[0].count),
      churned_this_month_prior: parseInt(churnedPriorRows[0].count),
    });
  } catch (err: any) {
    error(res, 'Failed to get business report', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-bookings
adminRouter.get('/reports/tenant-bookings', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Get business IDs for this tenant
    const { rows: bizRows } = await adminPool.query(
      'SELECT id FROM sys_businesses WHERE tenant_id = $1',
      [authReq.tenantId],
    );
    const bizIds = bizRows.map((r: any) => r.id);
    if (bizIds.length === 0) {
      success(res, { total_bookings: 0, month_bookings: 0, completed: 0, cancellation_rate: 0 });
      return;
    }
    const { rows: totalRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = ANY($1)`,
      [bizIds],
    );
    const { rows: monthRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = ANY($1) AND created_at >= date_trunc('month', NOW())`,
      [bizIds],
    );
    const { rows: completedRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = ANY($1) AND status = 'completed'`,
      [bizIds],
    );
    const { rows: cancelledRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = ANY($1) AND status = 'cancelled'`,
      [bizIds],
    );
    const total = parseInt(totalRows[0].count);
    const cancelled = parseInt(cancelledRows[0].count);
    success(res, {
      total_bookings: total,
      month_bookings: parseInt(monthRows[0].count),
      completed: parseInt(completedRows[0].count),
      cancellation_rate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
    });
  } catch (err: any) {
    error(res, 'Failed to get booking report', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-memberships
adminRouter.get('/reports/tenant-memberships', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows: bizRows } = await adminPool.query(
      'SELECT id FROM sys_businesses WHERE tenant_id = $1',
      [authReq.tenantId],
    );
    const bizIds = bizRows.map((r: any) => r.id);
    if (bizIds.length === 0) {
      success(res, { active_members: 0, new_this_month: 0, monthly_revenue: 0, churn_rate: 0 });
      return;
    }
    const { rows: activeRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM mem_memberships WHERE business_id = ANY($1) AND status = 'active'`,
      [bizIds],
    );
    const { rows: newRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM mem_memberships WHERE business_id = ANY($1) AND status = 'active' AND created_at >= date_trunc('month', NOW())`,
      [bizIds],
    );
    success(res, {
      active_members: parseInt(activeRows[0].count),
      new_this_month: parseInt(newRows[0].count),
      monthly_revenue: 0, // Placeholder: would sum from billing records
      churn_rate: 0, // Placeholder: would calculate from cancellations
    });
  } catch (err: any) {
    error(res, 'Failed to get membership report', 'INTERNAL_ERROR', 500);
  }
});


// --- Tenant Report Details ---

// GET /api/v1/admin/reports/tenant-revenue/detail
adminRouter.get('/reports/tenant-revenue/detail', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = req.query.type as string;
    if (type === 'businesses') {
      const { rows } = await adminPool.query(
        "SELECT name, status, created_at FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' ORDER BY name",
        [authReq.tenantId],
      );
      success(res, rows);
    } else if (type === 'expected') {
      const { rows } = await adminPool.query(
        `SELECT name, billing_amount, billing_frequency,
          billing_amount * (
            CASE billing_frequency
              WHEN 'monthly' THEN (12 - EXTRACT(MONTH FROM NOW())::int)
              WHEN 'quarterly' THEN GREATEST(0, 4 - CEIL(EXTRACT(MONTH FROM NOW()) / 3.0)::int)
              WHEN 'semi-annual' THEN GREATEST(0, 2 - CEIL(EXTRACT(MONTH FROM NOW()) / 6.0)::int)
              WHEN 'annual' THEN CASE WHEN EXTRACT(MONTH FROM next_billing_date) > EXTRACT(MONTH FROM NOW()) THEN 1 ELSE 0 END
              ELSE 0
            END
          ) as expected_remaining
         FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' AND billing_amount > 0
         ORDER BY expected_remaining DESC`,
        [authReq.tenantId],
      );
      success(res, rows);
    } else if (type === 'expected_mtd') {
      const { rows } = await adminPool.query(
        `SELECT name, billing_amount, next_billing_date
         FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' AND billing_amount > 0
         AND next_billing_date >= date_trunc('month', NOW())
         AND next_billing_date < date_trunc('month', NOW()) + INTERVAL '1 month'
         ORDER BY next_billing_date`,
        [authReq.tenantId],
      );
      success(res, rows);
    } else {
      // Revenue per business YTD - placeholder until payment ledger exists
      const { rows } = await adminPool.query(
        "SELECT name, 0 as revenue FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' ORDER BY name",
        [authReq.tenantId],
      );
      success(res, rows);
    }
  } catch (err: any) {
    error(res, 'Failed to get revenue detail', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-customers/detail
adminRouter.get('/reports/tenant-customers/detail', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = req.query.type as string;
    let query = 'SELECT name, status, created_at, updated_at FROM sys_businesses WHERE tenant_id = $1';
    if (type === 'active') {
      query += " AND status = 'active'";
    } else if (type === 'new') {
      query += " AND created_at >= date_trunc('month', NOW())";
    } else if (type === 'churned') {
      query += " AND status != 'active' AND updated_at >= date_trunc('month', NOW())";
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const { rows } = await adminPool.query(query, [authReq.tenantId]);
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to get business detail', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-bookings/detail
adminRouter.get('/reports/tenant-bookings/detail', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = req.query.type as string;
    const { rows: bizRows } = await adminPool.query('SELECT id FROM sys_businesses WHERE tenant_id = $1', [authReq.tenantId]);
    const bizIds = bizRows.map((r: any) => r.id);
    if (bizIds.length === 0) { success(res, []); return; }

    let query = `SELECT b.id, b.status, b.start_time, b.created_at,
                   COALESCE(u.first_name || ' ' || u.last_name, 'Unknown') as customer_name,
                   COALESCE(s.name, 'Unknown') as service_name
                 FROM apt_bookings b
                 LEFT JOIN usr_users u ON b.customer_id = u.id
                 LEFT JOIN svc_services s ON b.service_id = s.id
                 WHERE b.business_id = ANY($1)`;
    if (type === 'month') {
      query += " AND b.created_at >= date_trunc('month', NOW())";
    }
    query += ' ORDER BY b.created_at DESC LIMIT 100';
    const { rows } = await adminPool.query(query, [bizIds]);
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to get booking detail', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/tenant-memberships/detail
adminRouter.get('/reports/tenant-memberships/detail', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = req.query.type as string;
    const { rows: bizRows } = await adminPool.query('SELECT id FROM sys_businesses WHERE tenant_id = $1', [authReq.tenantId]);
    const bizIds = bizRows.map((r: any) => r.id);
    if (bizIds.length === 0) { success(res, []); return; }

    let query = `SELECT m.id, m.status, m.created_at,
                   COALESCE(u.first_name || ' ' || u.last_name, 'Unknown') as customer_name,
                   COALESCE(mp.name, 'Unknown') as plan_name
                 FROM mem_memberships m
                 LEFT JOIN usr_users u ON m.customer_id = u.id
                 LEFT JOIN mem_plans mp ON m.plan_id = mp.id
                 WHERE m.business_id = ANY($1)`;
    if (type === 'active') {
      query += " AND m.status = 'active'";
    } else if (type === 'new') {
      query += " AND m.status = 'active' AND m.created_at >= date_trunc('month', NOW())";
    }
    query += ' ORDER BY m.created_at DESC LIMIT 100';
    const { rows } = await adminPool.query(query, [bizIds]);
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to get membership detail', 'INTERNAL_ERROR', 500);
  }
});


// --- System KPIs ---

// GET /api/v1/admin/reports/system-kpis
adminRouter.get('/reports/system-kpis', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rows: tenantRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_tenants WHERE status = 'active'",
    );
    const { rows: bizRows } = await adminPool.query(
      "SELECT COUNT(*) as count FROM sys_businesses WHERE status = 'active'",
    );
    // Expected MTD: tenants whose next_billing_date is this month
    const { rows: expectedMtdRows } = await adminPool.query(
      `SELECT COALESCE(SUM(billing_amount), 0) as total
       FROM sys_tenants WHERE status = 'active' AND billing_amount > 0
       AND next_billing_date >= date_trunc('month', NOW())
       AND next_billing_date < date_trunc('month', NOW()) + INTERVAL '1 month'`,
    );
    // Platform revenue YTD and MTD - placeholder until billing ledger exists
    success(res, {
      total_tenants: parseInt(tenantRows[0].count),
      total_businesses: parseInt(bizRows[0].count),
      platform_revenue_ytd: 0,
      platform_revenue_ytd_prior: 0,
      platform_revenue_mtd: 0,
      platform_revenue_mtd_prior: 0,
      expected_remaining_mtd: parseInt(expectedMtdRows[0].total),
    });
  } catch (err: any) {
    error(res, 'Failed to get system KPIs', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/reports/system-revenue/detail
adminRouter.get('/reports/system-revenue/detail', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string;
    if (type === 'ytd' || type === 'mtd') {
      // Revenue per tenant - placeholder until payment ledger exists
      const { rows } = await adminPool.query(
        "SELECT name, 0 as revenue FROM sys_tenants WHERE status = 'active' ORDER BY name",
      );
      success(res, rows);
    } else if (type === 'expected_mtd') {
      const { rows } = await adminPool.query(
        `SELECT name, billing_amount, next_billing_date
         FROM sys_tenants WHERE status = 'active' AND billing_amount > 0
         AND next_billing_date >= date_trunc('month', NOW())
         AND next_billing_date < date_trunc('month', NOW()) + INTERVAL '1 month'
         ORDER BY next_billing_date`,
      );
      success(res, rows);
    } else {
      success(res, []);
    }
  } catch (err: any) {
    error(res, 'Failed to get system revenue detail', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// --- User Management (Super Admin only) ---
// ============================================================

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PLATFORM_BUSINESS_ID = '00000000-0000-0000-0000-000000000002';

// GET /api/v1/admin/users — List system and tenant-level users
adminRouter.get('/users', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const persona = req.query.persona as string; // 'system' | 'tenant' | undefined (all)
    const tenantId = req.query.tenant_id as string;

    let query = `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.persona, u.status, u.tenant_id, u.business_id, u.created_at,
                        t.name as tenant_name
                 FROM usr_users u
                 LEFT JOIN sys_tenants t ON u.tenant_id = t.id
                 WHERE u.persona IN ('system', 'tenant')`;
    const params: any[] = [];
    let idx = 1;

    if (persona) {
      query += ` AND u.persona = $${idx++}`;
      params.push(persona);
    }
    if (tenantId) {
      query += ` AND u.tenant_id = $${idx++}`;
      params.push(tenantId);
    }

    query += ' ORDER BY u.persona, u.last_name, u.first_name';

    const { rows } = await adminPool.query(query, params);
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to list users', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/admin/users/:id — Get user detail
adminRouter.get('/users/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.persona, u.status, u.tenant_id, u.business_id, u.created_at, u.updated_at,
              t.name as tenant_name, b.name as business_name
       FROM usr_users u
       LEFT JOIN sys_tenants t ON u.tenant_id = t.id
       LEFT JOIN sys_businesses b ON u.business_id = b.id
       WHERE u.id = $1 AND u.persona IN ('system', 'tenant')`,
      [req.params.id],
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

// POST /api/v1/admin/users — Create a system or tenant user
const createUserSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  password: Joi.string().min(10).required(),
  persona: Joi.string().valid('system', 'tenant').required(),
  role: Joi.string().valid('system_admin', 'system_support', 'tenant_owner', 'tenant_manager').required(),
  tenant_id: Joi.string().uuid().when('persona', { is: 'tenant', then: Joi.required(), otherwise: Joi.forbidden() }),
});

adminRouter.post('/users', requirePermission('*:*'), validate(createUserSchema), async (req: Request, res: Response) => {
  try {
    const { email, first_name, last_name, password, persona, role, tenant_id } = req.body;

    // Determine tenant and business assignment
    let assignedTenantId: string;
    let assignedBusinessId: string;

    if (persona === 'system') {
      // System users belong to the platform tenant/business
      assignedTenantId = PLATFORM_TENANT_ID;
      assignedBusinessId = PLATFORM_BUSINESS_ID;
    } else {
      // Tenant users belong to specified tenant + its default business
      assignedTenantId = tenant_id;
      const { rows: bizRows } = await adminPool.query(
        "SELECT id FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1",
        [tenant_id],
      );
      if (bizRows.length === 0) {
        error(res, 'Tenant has no active business. Create a business first.', 'VALIDATION_ERROR', 400);
        return;
      }
      assignedBusinessId = bizRows[0].id;
    }

    // Check email uniqueness within tenant
    const { rows: existing } = await adminPool.query(
      'SELECT id FROM usr_users WHERE email = $1 AND tenant_id = $2',
      [email, assignedTenantId],
    );
    if (existing.length > 0) {
      error(res, 'A user with this email already exists in this tenant', 'EMAIL_EXISTS', 409);
      return;
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const { rows: userRows } = await adminPool.query(
      `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING id, email, first_name, last_name, role, persona, tenant_id, business_id, status, created_at`,
      [assignedTenantId, assignedBusinessId, email, first_name, last_name, passwordHash, role, persona],
    );
    const user = userRows[0];

    // Assign appropriate role
    const roleMapping: Record<string, string> = {
      system_admin: '00000000-0000-0000-0000-000000000100', // Super Admin
      system_support: '00000000-0000-0000-0000-000000000100', // Super Admin (can refine later)
      tenant_owner: '00000000-0000-0000-0000-000000000101', // Business Owner (system role)
      tenant_manager: '00000000-0000-0000-0000-000000000102', // Manager (system role)
    };
    const roleId = roleMapping[role];
    if (roleId) {
      await adminPool.query(
        'INSERT INTO usr_user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [user.id, roleId, assignedTenantId],
      );
    }

    const authReq = req as AuthenticatedRequest;
    await logAudit({
      tenantId: assignedTenantId,
      userId: authReq.user.sub,
      action: 'user.created',
      resourceType: 'user',
      resourceId: user.id,
      details: { email, role, persona },
    });

    success(res, user, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create user', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/users/:id — Update a system or tenant user
const updateUserSchema = Joi.object({
  email: Joi.string().email({ tlds: false }),
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
  role: Joi.string().valid('system_admin', 'system_support', 'tenant_owner', 'tenant_manager'),
  status: Joi.string().valid('active', 'inactive'),
  password: Joi.string().min(10),
}).min(1);

adminRouter.put('/users/:id', requirePermission('*:*'), validate(updateUserSchema), async (req: Request, res: Response) => {
  try {
    // Verify user exists and is system/tenant level
    const { rows: existingRows } = await adminPool.query(
      "SELECT * FROM usr_users WHERE id = $1 AND persona IN ('system', 'tenant')",
      [req.params.id],
    );
    if (existingRows.length === 0) {
      error(res, 'User not found', 'NOT_FOUND', 404);
      return;
    }

    const { email, first_name, last_name, role, status, password } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (first_name !== undefined) { fields.push(`first_name = $${idx++}`); values.push(first_name); }
    if (last_name !== undefined) { fields.push(`last_name = $${idx++}`); values.push(last_name); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (password) {
      const passwordHash = await hashPassword(password);
      fields.push(`password_hash = $${idx++}`);
      values.push(passwordHash);
    }

    fields.push('updated_at = NOW()');
    values.push(req.params.id);

    const { rows } = await adminPool.query(
      `UPDATE usr_users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, first_name, last_name, role, persona, status, tenant_id, business_id, updated_at`,
      values,
    );

    success(res, rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      error(res, 'A user with this email already exists', 'EMAIL_EXISTS', 409);
    } else {
      error(res, 'Failed to update user', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/admin/users/:id — Deactivate a system or tenant user
adminRouter.delete('/users/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    // Prevent self-deletion
    if (req.params.id === authReq.user.sub) {
      error(res, 'Cannot deactivate your own account', 'VALIDATION_ERROR', 400);
      return;
    }

    const { rows } = await adminPool.query(
      `UPDATE usr_users SET status = 'inactive', updated_at = NOW()
       WHERE id = $1 AND persona IN ('system', 'tenant')
       RETURNING id, email, status`,
      [req.params.id],
    );
    if (rows.length === 0) {
      error(res, 'User not found', 'NOT_FOUND', 404);
      return;
    }

    await logAudit({
      tenantId: PLATFORM_TENANT_ID,
      userId: authReq.user.sub,
      action: 'user.deactivated',
      resourceType: 'user',
      resourceId: req.params.id,
      details: { email: rows[0].email },
    });

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to deactivate user', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// --- Tenant User Management (Tenant Owner) ---
// ============================================================

// GET /api/v1/admin/tenant-users — List users in current tenant
adminRouter.get('/tenant-users', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, persona, status, business_id, created_at
       FROM usr_users WHERE tenant_id = $1 AND persona = 'tenant'
       ORDER BY last_name, first_name`,
      [authReq.tenantId],
    );
    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to list tenant users', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/admin/tenant-users — Create a user in current tenant
const createTenantUserSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  password: Joi.string().min(10).required(),
});

adminRouter.post('/tenant-users', tenantContext, requirePermission('settings:*'), validate(createTenantUserSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { email, first_name, last_name, password } = req.body;
    const tenantId = authReq.tenantId;

    // Get default business for this tenant
    const { rows: bizRows } = await adminPool.query(
      "SELECT id FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1",
      [tenantId],
    );
    if (bizRows.length === 0) {
      error(res, 'No active business found for this tenant', 'VALIDATION_ERROR', 400);
      return;
    }
    const businessId = bizRows[0].id;

    // Check email uniqueness within tenant
    const { rows: existing } = await adminPool.query(
      'SELECT id FROM usr_users WHERE email = $1 AND tenant_id = $2',
      [email, tenantId],
    );
    if (existing.length > 0) {
      error(res, 'A user with this email already exists', 'EMAIL_EXISTS', 409);
      return;
    }

    // Create user with tenant_owner role
    const passwordHash = await hashPassword(password);
    const { rows: userRows } = await adminPool.query(
      `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'tenant_owner', 'tenant', 'active')
       RETURNING id, email, first_name, last_name, role, persona, status, business_id, created_at`,
      [tenantId, businessId, email, first_name, last_name, passwordHash],
    );
    const user = userRows[0];

    // Assign Tenant Owner role from tenant-specific roles
    const { rows: roleRows } = await adminPool.query(
      "SELECT id FROM usr_roles WHERE tenant_id = $1 AND name = 'Tenant Owner'",
      [tenantId],
    );
    if (roleRows.length > 0) {
      await adminPool.query(
        'INSERT INTO usr_user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [user.id, roleRows[0].id, tenantId],
      );
    }

    await logAudit({
      tenantId,
      userId: authReq.user.sub,
      action: 'tenant_user.created',
      resourceType: 'user',
      resourceId: user.id,
      details: { email, role: 'tenant_owner' },
    });

    success(res, user, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create user', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/admin/tenant-users/:id — Update a tenant user
const updateTenantUserSchema = Joi.object({
  email: Joi.string().email({ tlds: false }),
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
  status: Joi.string().valid('active', 'inactive'),
  password: Joi.string().min(10),
}).min(1);

adminRouter.put('/tenant-users/:id', tenantContext, requirePermission('settings:*'), validate(updateTenantUserSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    // Verify user belongs to this tenant
    const { rows: existingRows } = await adminPool.query(
      "SELECT * FROM usr_users WHERE id = $1 AND tenant_id = $2 AND persona = 'tenant'",
      [req.params.id, authReq.tenantId],
    );
    if (existingRows.length === 0) {
      error(res, 'User not found', 'NOT_FOUND', 404);
      return;
    }

    const { email, first_name, last_name, status, password } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (first_name !== undefined) { fields.push(`first_name = $${idx++}`); values.push(first_name); }
    if (last_name !== undefined) { fields.push(`last_name = $${idx++}`); values.push(last_name); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (password) {
      const passwordHash = await hashPassword(password);
      fields.push(`password_hash = $${idx++}`);
      values.push(passwordHash);
    }

    fields.push('updated_at = NOW()');
    values.push(req.params.id, authReq.tenantId);

    const { rows } = await adminPool.query(
      `UPDATE usr_users SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, email, first_name, last_name, role, persona, status, business_id, updated_at`,
      values,
    );

    success(res, rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      error(res, 'A user with this email already exists', 'EMAIL_EXISTS', 409);
    } else {
      error(res, 'Failed to update user', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/admin/tenant-users/:id — Deactivate a tenant user
adminRouter.delete('/tenant-users/:id', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    // Prevent self-deactivation
    if (req.params.id === authReq.user.sub) {
      error(res, 'Cannot deactivate your own account', 'VALIDATION_ERROR', 400);
      return;
    }

    const { rows } = await adminPool.query(
      `UPDATE usr_users SET status = 'inactive', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND persona = 'tenant'
       RETURNING id, email, status`,
      [req.params.id, authReq.tenantId],
    );
    if (rows.length === 0) {
      error(res, 'User not found', 'NOT_FOUND', 404);
      return;
    }

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'tenant_user.deactivated',
      resourceType: 'user',
      resourceId: req.params.id,
      details: { email: rows[0].email },
    });

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to deactivate user', 'INTERNAL_ERROR', 500);
  }
});
