import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as customerService from '../services/customer.service';
import * as lifecycleService from '../services/customer-lifecycle.service';
import { logAudit } from '../services/audit.service';
import * as consentService from '../services/consent.service';
import * as identityService from '../services/person-identity.service';

export const customersRouter = Router();

// All customer routes require auth + tenant context + customers permission
customersRouter.use(authenticate);
customersRouter.use(tenantContext);

// --- Validation schemas ---

// A person needs a first name and at least one way to reach them (email or phone). Surname and
// email are optional: a front desk can save someone who only gave a phone number (Phase 46 R2).
const createCustomerSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).allow('', null),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().max(100).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null),
  gender: Joi.string().max(20).allow('', null),
  preferred_language: Joi.string().max(5).default('en'),
  country: Joi.string().max(100).allow('', null),
  source: Joi.string().valid('manual', 'walk_in', 'referral').default('manual'),
  source_detail: Joi.string().max(200).allow('', null),
  business_id: Joi.string().uuid().required(),
});

const updateCustomerSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).allow('', null),
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().max(100).allow(''),
  owner_user_id: Joi.string().uuid().allow('', null),
  source_detail: Joi.string().max(200).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null, ''),
  gender: Joi.string().max(20).allow('', null),
  preferred_language: Joi.string().max(5),
  country: Joi.string().max(100).allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  status: Joi.string().valid('active', 'archived'),
  lifecycle_stage: Joi.string().valid('lead', 'trial', 'active', 'at_risk', 'churned', 'winback'),
}).min(1);

// --- Routes ---

// POST /api/v1/customers — Create customer
customersRouter.post('/', requirePermission('customers:*'), validate(createCustomerSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(req.body.email || '').trim() && !(req.body.phone || '').trim()) {
      error(res, 'An email address or a phone number is required', 'CONTACT_POINT_REQUIRED', 400);
      return;
    }
    const result = await customerService.createCustomer({
      businessId: req.body.business_id,
      tenantId: authReq.tenantId,
      email: req.body.email,
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      phone: req.body.phone,
      dateOfBirth: req.body.date_of_birth,
      gender: req.body.gender,
      preferredLanguage: req.body.preferred_language,
      country: req.body.country,
      source: req.body.source,
      sourceDetail: req.body.source_detail,
      createdBy: authReq.user.sub,
    });

    if (result.duplicate) {
      // The person already exists: hand back who it is so the screen can open them.
      const byPhone = result.matchedBy === 'phone';
      res.status(409).json({
        error: byPhone
          ? 'This phone number already belongs to a person in this business'
          : 'A customer with this email already exists in this business',
        code: byPhone ? 'DUPLICATE_PHONE' : 'DUPLICATE_EMAIL',
        details: { existing_id: result.existingId, existing_name: result.customer?.display_name, matched_by: result.matchedBy },
      });
      return;
    }

    success(res, result.customer, undefined, 201);
  } catch (err: any) {
    if (err?.code === 'CONTACT_POINT_REQUIRED') { error(res, err.message, err.code, 400); return; }
    console.error('[customers] Create customer failed:', err.message, err.stack);
    error(res, 'Failed to create customer', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers — List/search customers
customersRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.getCustomers(businessId, {
      search: req.query.search as string,
      lifecycle_stage: req.query.lifecycle_stage as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
      sort: req.query.sort as string,
      order: req.query.order as 'asc' | 'desc',
      ref: req.query.ref as string,
      first_name: req.query.first_name as string,
      last_name: req.query.last_name as string,
      email: req.query.email as string,
      phone: req.query.phone as string,
      created_from: req.query.created_from as string,
      created_to: req.query.created_to as string,
      ...peopleFilters(req),
    });

    success(res, result.customers, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    console.error('Failed to list customers', err?.message || err);
    error(res, 'Failed to list customers', 'INTERNAL_ERROR', 500);
  }
});

/** The Phase 46 list filters, read once so the list, the counts and bulk actions agree. */
function peopleFilters(req: Request) {
  const q = req.query;
  const owner = q.owner as string | undefined;
  return {
    view: q.view as string | undefined,
    source: q.source as string | undefined,
    owner: owner === 'me' ? (req as AuthenticatedRequest).user.sub : owner,
    incomplete: q.incomplete === 'true',
    segment_id: q.segment_id as string | undefined,
    include_archived: q.include_archived === 'true',
    last_activity_from: q.last_activity_from as string | undefined,
    last_activity_to: q.last_activity_to as string | undefined,
  };
}

// GET /api/v1/customers/view-counts — People in each system view (must be before /:id)
customersRouter.get('/view-counts', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    success(res, await customerService.getViewCounts(businessId));
  } catch (err: any) {
    console.error('Failed to get view counts', err?.message || err);
    error(res, 'Failed to get view counts', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/owners — Staff who can be set as a person's owner (must be before /:id)
customersRouter.get('/owners', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      `SELECT id, first_name, last_name FROM usr_users
        WHERE tenant_id = $1 AND business_id = $2 AND status = 'active' AND persona = 'business'
        ORDER BY first_name, last_name`,
      [authReq.tenantId, businessId],
    );
    success(res, rows);
  } catch (err: any) {
    console.error('Failed to list owners', err?.message || err);
    error(res, 'Failed to list owners', 'INTERNAL_ERROR', 500);
  }
});

// --- Bulk actions ---

const bulkFiltersSchema = Joi.object({
  view: Joi.string(), search: Joi.string().allow(''), lifecycle_stage: Joi.string(), source: Joi.string(),
  owner: Joi.string(), incomplete: Joi.boolean(), segment_id: Joi.string().uuid(), include_archived: Joi.boolean(),
  ref: Joi.string(), first_name: Joi.string(), last_name: Joi.string(), email: Joi.string(), phone: Joi.string(),
  created_from: Joi.string(), created_to: Joi.string(), last_activity_from: Joi.string(), last_activity_to: Joi.string(),
});

const bulkSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  // Either the people ticked on screen, or "everyone matching these filters".
  ids: Joi.array().items(Joi.string().uuid()).max(5000),
  filters: bulkFiltersSchema,
  action: Joi.string().valid('add_tag', 'remove_tag', 'assign_owner', 'change_stage', 'add_to_list', 'archive'),
  payload: Joi.object({
    tag_id: Joi.string().uuid(),
    owner_user_id: Joi.string().uuid().allow(null),
    stage: Joi.string().valid('lead', 'trial', 'active', 'at_risk', 'churned', 'winback'),
    segment_id: Joi.string().uuid(),
  }).default({}),
}).xor('ids', 'filters');

/** Above this many people a bulk action runs in the background. */
const BULK_BACKGROUND_THRESHOLD = 5000;

function bulkTarget(req: Request) {
  const filters = req.body.filters ? { ...req.body.filters } : undefined;
  if (filters?.owner === 'me') filters.owner = (req as AuthenticatedRequest).user.sub;
  return { ids: req.body.ids, filters };
}

// POST /api/v1/customers/bulk/preview — How many people a bulk action would touch
customersRouter.post('/bulk/preview', requirePermission('customers:*'), validate(bulkSchema), async (req: Request, res: Response) => {
  try {
    const ids = await customerService.resolveBulkTarget(req.body.business_id, bulkTarget(req));
    success(res, { count: ids.length });
  } catch (err: any) {
    console.error('Failed to preview the bulk action', err?.message || err);
    error(res, 'Failed to preview the bulk action', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/bulk — Apply one change to many people
customersRouter.post('/bulk', requirePermission('customers:*'), validate(bulkSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!req.body.action) { error(res, 'action is required', 'VALIDATION_ERROR', 400); return; }
    // A very large change (only possible through "everyone matching the filters") is not made to
    // wait for: it runs in the background and is recorded in the audit log when it finishes.
    const target = bulkTarget(req);
    const ids = await customerService.resolveBulkTarget(req.body.business_id, target);
    if (ids.length > BULK_BACKGROUND_THRESHOLD) {
      const { business_id, action, payload } = req.body;
      setImmediate(() => {
        customerService.runBulkAction(business_id, authReq.tenantId, { ids }, action, payload, authReq.user.sub)
          .catch((err) => console.error('[customers] Background bulk action failed:', err.message));
      });
      success(res, { affected: null, background: true, count: ids.length }, undefined, 202);
      return;
    }
    const result = await customerService.runBulkAction(
      req.body.business_id, authReq.tenantId, { ids }, req.body.action, req.body.payload, authReq.user.sub,
    );
    success(res, result);
  } catch (err: any) {
    error(res, err.message || 'Failed to run the bulk action', 'VALIDATION_ERROR', 400);
  }
});

// GET /api/v1/customers/lifecycle-summary — Counts per lifecycle stage (must be before /:id)
customersRouter.get('/lifecycle-summary', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const summary = await lifecycleService.getLifecycleSummary(businessId);
    success(res, summary);
  } catch (err: any) {
    console.error('Failed to get lifecycle summary', err?.message || err);
    error(res, 'Failed to get lifecycle summary', 'INTERNAL_ERROR', 500);
  }
});

// --- Lifecycle Config & Scheduled Jobs (must be before /:id) ---
import { getAvailableJobTypes } from '../jobs/job-registry';
import { computeNextRunUtc } from '../jobs/schedule-time';

customersRouter.get('/lifecycle-config', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(`SELECT key, value FROM sys_business_configurations WHERE business_id = $1 AND key LIKE 'lifecycle.%'`, [businessId]);
    const config: Record<string, any> = { enabled: true, at_risk_days: 30, churned_days: 60, run_time: '02:00' };
    for (const row of rows) {
      if (row.key === 'lifecycle.enabled') config.enabled = row.value === 'true';
      if (row.key === 'lifecycle.at_risk_days') config.at_risk_days = parseInt(row.value);
      if (row.key === 'lifecycle.churned_days') config.churned_days = parseInt(row.value);
      if (row.key === 'lifecycle.run_time') config.run_time = row.value;
    }
    success(res, config);
  } catch (err: any) { console.error('Failed to get lifecycle config', err?.message || err); error(res, 'Failed to get lifecycle config', 'INTERNAL_ERROR', 500); }
});

customersRouter.put('/lifecycle-config', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { enabled, at_risk_days, churned_days, run_time } = req.body;
    const entries = [
      { key: 'lifecycle.enabled', value: String(enabled ?? true) },
      { key: 'lifecycle.at_risk_days', value: String(at_risk_days ?? 30) },
      { key: 'lifecycle.churned_days', value: String(churned_days ?? 60) },
      { key: 'lifecycle.run_time', value: run_time || '02:00' },
    ];
    for (const entry of entries) {
      await adminPool.query(
        `INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (business_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
        [businessId, entry.key, entry.value, authReq.user.sub],
      );
    }
    success(res, { enabled, at_risk_days, churned_days, run_time });
  } catch (err: any) { console.error('Failed to save lifecycle config', err?.message || err); error(res, 'Failed to save lifecycle config', 'INTERNAL_ERROR', 500); }
});

customersRouter.get('/scheduled-jobs/types', requirePermission('settings:*'), async (_req: Request, res: Response) => {
  success(res, getAvailableJobTypes());
});

customersRouter.get('/scheduled-jobs', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      `SELECT id, job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month, enabled, next_run_at, last_run_at, last_run_status, last_run_duration_ms, last_error, consecutive_failures FROM sys_scheduled_jobs WHERE business_id = $1 ORDER BY job_type`,
      [businessId],
    );
    success(res, rows);
  } catch (err: any) { console.error('Failed to get scheduled jobs', err?.message || err); error(res, 'Failed to get scheduled jobs', 'INTERNAL_ERROR', 500); }
});

customersRouter.post('/scheduled-jobs', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month, enabled } = req.body;
    if (!job_type) { error(res, 'job_type required', 'VALIDATION_ERROR', 400); return; }
    const time = schedule_time || '02:00';
    // Timezone-correct next run: "HH:MM" means that wall clock in schedule_timezone,
    // not the server's local zone. (Was: new Date().setHours — server-zone bug.)
    const nextRun = computeNextRunUtc({
      scheduleTime: time, timezone: schedule_timezone || 'UTC',
      frequency: frequency || 'daily', dayOfWeek: day_of_week ?? null, dayOfMonth: day_of_month ?? null,
    });
    // These are business-scoped jobs. The uniqueness is a PARTIAL index
    // (business_id, job_type) WHERE scope_level = 'business' (migration 117), so the
    // ON CONFLICT must carry that same predicate to match the index.
    const { rows } = await adminPool.query(
      `INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month, enabled, next_run_at)
       VALUES ('business', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (business_id, job_type) WHERE scope_level = 'business'
       DO UPDATE SET schedule_time = $4, schedule_timezone = $5, frequency = $6, day_of_week = $7, day_of_month = $8, enabled = $9, next_run_at = $10, updated_at = NOW() RETURNING *`,
      [businessId, authReq.tenantId, job_type, time, schedule_timezone || 'UTC', frequency || 'daily', day_of_week ?? null, day_of_month ?? null, enabled !== false, nextRun],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { console.error('Failed to create scheduled job', err?.message || err); error(res, 'Failed to create scheduled job', 'INTERNAL_ERROR', 500); }
});

customersRouter.put('/scheduled-jobs/:id/toggle', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(`UPDATE sys_scheduled_jobs SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING id, enabled`, [req.params.id]);
    if (rows.length === 0) { error(res, 'Job not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { console.error('Failed to toggle job', err?.message || err); error(res, 'Failed to toggle job', 'INTERNAL_ERROR', 500); }
});

customersRouter.delete('/scheduled-jobs/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rowCount } = await adminPool.query('DELETE FROM sys_scheduled_jobs WHERE id = $1', [req.params.id]);
    if (rowCount === 0) { error(res, 'Job not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { console.error('Failed to delete job', err?.message || err); error(res, 'Failed to delete job', 'INTERNAL_ERROR', 500); }
});

customersRouter.get('/scheduled-jobs/:id/history', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT id, started_at, completed_at, status, duration_ms, result, error FROM sys_job_executions WHERE job_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [req.params.id],
    );
    success(res, rows);
  } catch (err: any) { console.error('Failed to get job history', err?.message || err); error(res, 'Failed to get job history', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/customers/scheduled-jobs/run — Run a process by type (no DB record needed)
customersRouter.post('/scheduled-jobs/run', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { job_type, date_from, date_to, posting_date } = req.body;
    if (!job_type) { error(res, 'job_type required', 'VALIDATION_ERROR', 400); return; }

    const { jobRegistry } = await import('../jobs/job-registry');
    const handler = jobRegistry[job_type];
    if (!handler) { error(res, `Unknown process type: ${job_type}`, 'VALIDATION_ERROR', 400); return; }

    // Get tenant_id for context
    const authReq = req as AuthenticatedRequest;
    const startTime = Date.now();

    let result: any;
    // For revenue_recognition, support date range and posting date
    if (job_type === 'revenue_recognition' && date_from) {
      const { recognizeRevenue } = await import('../services/revenue-recognition.service');
      result = await recognizeRevenue(businessId, date_from, date_to || date_from, posting_date || undefined);
    } else if (job_type === 'billing_process' && date_from) {
      // Manual recurring-charge run with a selected From..To range: honor it — only
      // enrollments whose billing date falls inside the range are charged, rather
      // than sweeping everything overdue as the scheduled job does.
      const { runBusinessBillingNow } = await import('../services/membership-renewal.service');
      const run = await runBusinessBillingNow(businessId, date_from, date_to || date_from);
      result = { status: 'processed', auto_resumed: run.autoResumed, renewals: run.renewals, dunning: run.dunning };
    } else {
      result = await handler({ scopeLevel: 'business', businessId, tenantId: authReq.tenantId || '', config: {} });
    }

    const durationMs = Date.now() - startTime;
    success(res, { status: 'success', duration_ms: durationMs, result });
  } catch (err: any) { error(res, `Process failed: ${err.message}`, 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/customers/scheduled-jobs/:id/run — Manual trigger with optional date range
customersRouter.post('/scheduled-jobs/:id/run', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    // Load the job to get type and business context
    const { rows: jobRows } = await adminPool.query(
      'SELECT id, scope_level, business_id, tenant_id, job_type, config FROM sys_scheduled_jobs WHERE id = $1',
      [req.params.id],
    );
    if (jobRows.length === 0) { error(res, 'Job not found', 'NOT_FOUND', 404); return; }
    const job = jobRows[0];

    const { date_from, date_to } = req.body || {};

    // Record execution start
    const { rows: execRows } = await adminPool.query(
      `INSERT INTO sys_job_executions (job_id, business_id, job_type, started_at, status)
       VALUES ($1, $2, $3, NOW(), 'running') RETURNING id`,
      [job.id, job.business_id, job.job_type],
    );
    const executionId = execRows[0].id;
    const startTime = Date.now();

    try {
      let result: any;

      // For revenue_recognition, support date range override
      if (job.job_type === 'revenue_recognition' && date_from) {
        const { recognizeRevenue } = await import('../services/revenue-recognition.service');
        result = await recognizeRevenue(job.business_id, date_from, date_to || date_from);
      } else {
        // Default: run the registered handler
        const { jobRegistry } = await import('../jobs/job-registry');
        const handler = jobRegistry[job.job_type];
        if (!handler) { throw new Error(`Unknown job type: ${job.job_type}`); }
        result = await handler({ scopeLevel: job.scope_level || 'business', businessId: job.business_id, tenantId: job.tenant_id, config: job.config || {} });
      }

      const durationMs = Date.now() - startTime;

      // Record success
      await adminPool.query(
        `UPDATE sys_job_executions SET completed_at = NOW(), status = 'success', duration_ms = $1, result = $2 WHERE id = $3`,
        [durationMs, JSON.stringify(result || {}), executionId],
      );
      await adminPool.query(
        `UPDATE sys_scheduled_jobs SET last_run_at = NOW(), last_run_status = 'success', last_run_duration_ms = $1, last_error = NULL, updated_at = NOW() WHERE id = $2`,
        [durationMs, job.id],
      );

      success(res, { executionId, status: 'success', duration_ms: durationMs, result });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await adminPool.query(
        `UPDATE sys_job_executions SET completed_at = NOW(), status = 'failed', duration_ms = $1, error = $2 WHERE id = $3`,
        [durationMs, err.message, executionId],
      ).catch(() => {});
      await adminPool.query(
        `UPDATE sys_scheduled_jobs SET last_run_at = NOW(), last_run_status = 'failed', last_run_duration_ms = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
        [durationMs, err.message, job.id],
      ).catch(() => {});
      error(res, `Job failed: ${err.message}`, 'INTERNAL_ERROR', 500);
    }
  } catch (err: any) { console.error('Failed to run job', err?.message || err); error(res, 'Failed to run job', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/customers/export — Export to CSV (must be before /:id)
customersRouter.get('/export', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const { exportCustomers, exportGDPR } = await import('../services/customer-import.service');
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const format = req.query.format as string;

    if (format === 'gdpr' && req.query.customer_id) {
      const data = await exportGDPR(req.query.customer_id as string, businessId);
      if (!data) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="gdpr-export.json"');
      res.json(data);
      return;
    }

    const csv = await exportCustomers(businessId, {
      lifecycle_stage: req.query.lifecycle_stage as string,
      search: req.query.search as string,
      ref: req.query.ref as string,
      first_name: req.query.first_name as string,
      last_name: req.query.last_name as string,
      email: req.query.email as string,
      phone: req.query.phone as string,
      created_from: req.query.created_from as string,
      created_to: req.query.created_to as string,
      sort: req.query.sort as string,
      order: req.query.order as 'asc' | 'desc',
    }, ['reference_number', 'first_name', 'last_name', 'email', 'phone', 'lifecycle_stage', 'created_at']);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="customers-export.csv"');
    res.send(csv);
  } catch (err: any) {
    console.error('Failed to export customers', err?.message || err);
    error(res, 'Failed to export customers', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id/financial-summary — Balance due, lifetime value and account credit
customersRouter.get('/:id/financial-summary', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400); return; }
    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    success(res, await customerService.getFinancialSummary(req.params.id, businessId));
  } catch (err: any) {
    console.error('Failed to get the financial summary', err?.message || err);
    error(res, 'Failed to get the financial summary', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id — Get customer detail
customersRouter.get('/:id', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    if (customer.status === 'merged' && customer.merged_into_id) {
      // An old link to a merged record: tell the screen where the person lives now.
      success(res, { id: customer.id, status: 'merged', merged_into_id: customer.merged_into_id });
      return;
    }

    success(res, customer);
  } catch (err: any) {
    console.error('Failed to get customer', err?.message || err);
    error(res, 'Failed to get customer', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id — Update customer
customersRouter.put('/:id', requirePermission('customers:*'), validate(updateCustomerSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const customer = await customerService.updateCustomer(req.params.id, businessId, req.body, authReq.user.sub);
    if (!customer) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, customer);
  } catch (err: any) {
    if (err?.code === 'CONTACT_POINT_REQUIRED') { error(res, err.message, err.code, 400); return; }
    if (err?.code === 'EMAIL_IN_USE') {
      res.status(409).json({ error: err.message, code: err.code, details: { existing_id: err.existingId } });
      return;
    }
    if (/Owner must be/.test(err?.message || '')) { error(res, err.message, 'VALIDATION_ERROR', 400); return; }
    error(res, 'Failed to update customer', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id/archive — Archive customer
customersRouter.put('/:id/archive', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.archiveCustomer(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, result);
  } catch (err: any) {
    console.error('Failed to archive customer', err?.message || err);
    error(res, 'Failed to archive customer', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id/reactivate — Reactivate an archived customer
customersRouter.put('/:id/reactivate', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const { rows } = await adminPool.query(
      "UPDATE cus_customers SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'archived' RETURNING *",
      [req.params.id, businessId],
    );

    if (rows.length === 0) {
      error(res, 'Customer not found or not archived', 'NOT_FOUND', 404);
      return;
    }

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.reactivated',
      resourceType: 'customer',
      resourceId: req.params.id,
    });

    success(res, rows[0]);
  } catch (err: any) {
    console.error('Failed to reactivate customer', err?.message || err);
    error(res, 'Failed to reactivate customer', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/:id/anonymize — GDPR anonymization
customersRouter.post('/:id/anonymize', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.anonymizeCustomer(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, result);
  } catch (err: any) {
    console.error('Failed to anonymize customer', err?.message || err);
    error(res, 'Failed to anonymize customer', 'INTERNAL_ERROR', 500);
  }
});

// --- Notes ---
import * as notesService from '../services/customer-notes.service';

const createNoteSchema = Joi.object({
  category: Joi.string().min(1).max(50).required(),
  content: Joi.string().min(1).required(),
  is_sensitive: Joi.boolean().default(false),
});

const createCategorySchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  is_sensitive: Joi.boolean().default(false),
  customer_visible: Joi.boolean().default(false),
});

// POST /api/v1/customers/:id/notes — Add note
customersRouter.post('/:id/notes', requirePermission('customers:*'), validate(createNoteSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const note = await notesService.createNote({
      customerId: req.params.id,
      businessId,
      tenantId: authReq.tenantId,
      category: req.body.category,
      content: req.body.content,
      isSensitive: req.body.is_sensitive,
      createdBy: authReq.user.sub,
    });

    success(res, note, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('does not exist')) {
      error(res, err.message, 'INVALID_CATEGORY', 400);
    } else {
      error(res, 'Failed to create note', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/customers/:id/notes — List notes
customersRouter.get('/:id/notes', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await notesService.getNotes({
      customerId: req.params.id,
      businessId,
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      userRole: authReq.user.role,
      category: req.query.category as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 10,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
    });

    success(res, result.notes, { total: result.total, limit: result.limit, offset: result.offset });
  } catch (err: any) {
    console.error('Failed to get notes', err?.message || err);
    error(res, 'Failed to get notes', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/:id/notes/:noteId — Delete a note
customersRouter.delete('/:id/notes/:noteId', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await notesService.deleteNote(req.params.noteId, businessId);
    if (!deleted) { error(res, 'Note not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete note', err?.message || err);
    error(res, 'Failed to delete note', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/note-categories — List categories for business
customersRouter.get('/note-categories/list', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const categories = await notesService.getCategories(businessId);
    success(res, categories);
  } catch (err: any) {
    console.error('Failed to get categories', err?.message || err);
    error(res, 'Failed to get categories', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/note-categories — Create category
customersRouter.post('/note-categories', requirePermission('settings:*'), validate(createCategorySchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const category = await notesService.createCategory(
      businessId, req.body.name, req.body.is_sensitive, req.body.customer_visible,
    );

    success(res, category, undefined, 201);
  } catch (err: any) {
    console.error('Failed to create category', err?.message || err);
    error(res, 'Failed to create category', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/note-categories/:id — Delete category
customersRouter.delete('/note-categories/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await notesService.deleteCategory(req.params.id, businessId);
    if (!deleted) { error(res, 'Category not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete category', err?.message || err);
    error(res, 'Failed to delete category', 'INTERNAL_ERROR', 500);
  }
});

// --- Tags ---
import * as tagsService from '../services/customer-tags.service';

const createTagSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#8A8A8A'),
});

const updateTagSchema = Joi.object({
  name: Joi.string().min(1).max(50),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
}).min(1);

const assignTagSchema = Joi.object({
  tag_id: Joi.string().uuid().required(),
});

// GET /api/v1/customers/tags — List business tags
customersRouter.get('/tags/list', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tags = await tagsService.getTags(businessId);
    success(res, tags);
  } catch (err: any) {
    console.error('Failed to get tags', err?.message || err);
    error(res, 'Failed to get tags', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/tags — Create tag
customersRouter.post('/tags', requirePermission('customers:*'), validate(createTagSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tag = await tagsService.createTag(businessId, req.body.name, req.body.color);
    success(res, tag, undefined, 201);
  } catch (err: any) {
    console.error('Failed to create tag', err?.message || err);
    error(res, 'Failed to create tag', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/tags/:tagId — Update tag
customersRouter.put('/tags/:tagId', requirePermission('customers:*'), validate(updateTagSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tag = await tagsService.updateTag(req.params.tagId, businessId, req.body);
    if (!tag) { error(res, 'Tag not found', 'NOT_FOUND', 404); return; }
    success(res, tag);
  } catch (err: any) {
    console.error('Failed to update tag', err?.message || err);
    error(res, 'Failed to update tag', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/tags/:tagId — Delete tag
customersRouter.delete('/tags/:tagId', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const deleted = await tagsService.deleteTag(req.params.tagId, businessId);
    if (!deleted) { error(res, 'Tag not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete tag', err?.message || err);
    error(res, 'Failed to delete tag', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/:id/tags — Assign tag to customer
customersRouter.post('/:id/tags', requirePermission('customers:*'), validate(assignTagSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await tagsService.assignTag(req.params.id, req.body.tag_id, authReq.user.sub);

    // Log in timeline
    const businessId = req.query.business_id as string;
    if (businessId) {
      await adminPool.query(
        `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by)
         VALUES ($1, $2, 'profile_change', 'Tag assigned', $3, $4)`,
        [req.params.id, businessId, JSON.stringify({ tag_id: req.body.tag_id }), authReq.user.sub],
      );
    }

    success(res, { assigned: true }, undefined, 201);
  } catch (err: any) {
    console.error('Failed to assign tag', err?.message || err);
    error(res, 'Failed to assign tag', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/:id/tags/:tagId — Remove tag from customer
customersRouter.delete('/:id/tags/:tagId', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    await tagsService.removeTag(req.params.id, req.params.tagId);
    success(res, { removed: true });
  } catch (err: any) {
    console.error('Failed to remove tag', err?.message || err);
    error(res, 'Failed to remove tag', 'INTERNAL_ERROR', 500);
  }
});

// --- Lifecycle ---

const lifecycleOverrideSchema = Joi.object({
  lifecycle_stage: Joi.string().valid('lead', 'trial', 'active', 'at_risk', 'churned', 'winback').required(),
});

// PUT /api/v1/customers/:id/lifecycle — Manual lifecycle stage override
customersRouter.put('/:id/lifecycle', requirePermission('customers:*'), validate(lifecycleOverrideSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.manualOverride(
      req.params.id, businessId, req.body.lifecycle_stage, authReq.user.sub,
    );

    if (!result.success) {
      if (result.error === 'Customer not found') {
        error(res, 'Customer not found', 'NOT_FOUND', 404);
      } else {
        error(res, result.error || 'Failed to update lifecycle', 'VALIDATION_ERROR', 400);
      }
      return;
    }

    success(res, { from: result.from, to: result.to });
  } catch (err: any) {
    console.error('Failed to update lifecycle stage', err?.message || err);
    error(res, 'Failed to update lifecycle stage', 'INTERNAL_ERROR', 500);
  }
});

// --- Activity Timeline ---
import * as activityService from '../services/customer-activity.service';

// GET /api/v1/customers/:id/activities — Get timeline
customersRouter.get('/:id/activities', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await activityService.getActivities({
      customerId: req.params.id,
      businessId,
      activityType: req.query.activity_type as string,
      startDate: req.query.start_date as string,
      endDate: req.query.end_date as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });

    success(res, result.activities, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    console.error('Failed to get activities', err?.message || err);
    error(res, 'Failed to get activities', 'INTERNAL_ERROR', 500);
  }
});

// --- Import/Export ---
import * as importService from '../services/customer-import.service';

const importValidateSchema = Joi.object({
  csv_text: Joi.string().min(1).required(),
  mapping: Joi.object().pattern(Joi.string(), Joi.string()).required(),
  business_id: Joi.string().uuid().required(),
});

const importExecuteSchema = Joi.object({
  csv_text: Joi.string().min(1).required(),
  mapping: Joi.object().pattern(Joi.string(), Joi.string()).required(),
  business_id: Joi.string().uuid().required(),
});

// POST /api/v1/customers/import/validate — Dry-run validation
customersRouter.post('/import/validate', requirePermission('customers:*'), validate(importValidateSchema), async (req: Request, res: Response) => {
  try {
    const result = await importService.validateImport(req.body.csv_text, req.body.mapping, req.body.business_id);
    success(res, result);
  } catch (err: any) {
    console.error('Failed to validate import', err?.message || err);
    error(res, 'Failed to validate import', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/import — Execute import
customersRouter.post('/import', requirePermission('customers:*'), validate(importExecuteSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await importService.executeImport(
      req.body.csv_text,
      req.body.mapping,
      req.body.business_id,
      authReq.tenantId,
      authReq.user.sub,
    );
    success(res, result);
  } catch (err: any) {
    console.error('Failed to execute import', err?.message || err);
    error(res, 'Failed to execute import', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/export is registered above (before /:id) to avoid route conflict

// --- Duplicate Detection & Merge ---
import * as duplicateService from '../services/customer-duplicates.service';

const mergeSchema = Joi.object({
  primary_id: Joi.string().uuid().required(),
  secondary_id: Joi.string().uuid().required(),
  keep_fields: Joi.object().pattern(Joi.string(), Joi.string().valid('primary', 'secondary')).default({}),
  business_id: Joi.string().uuid().required(),
});

// POST /api/v1/customers/merge/preview — What a merge would move, and anything that would stop it
customersRouter.post('/merge/preview', requirePermission('customers:*'), validate(mergeSchema), async (req: Request, res: Response) => {
  try {
    const result = await duplicateService.previewMerge(req.body.primary_id, req.body.secondary_id, req.body.business_id);
    if (result.error) { error(res, result.error, 'VALIDATION_ERROR', 400); return; }
    success(res, result.preview);
  } catch (err: any) {
    console.error('Failed to preview the merge', err?.message || err);
    error(res, 'Failed to preview the merge', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id/duplicates — Possible duplicates flagged for this person
customersRouter.get('/:id/duplicates', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    success(res, await identityService.getDuplicateFlags(req.params.id, businessId));
  } catch (err: any) {
    console.error('Failed to get possible duplicates', err?.message || err);
    error(res, 'Failed to get possible duplicates', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/:id/duplicates/:flagId/dismiss — "These are different people"
customersRouter.post('/:id/duplicates/:flagId/dismiss', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const businessId = (req.query.business_id || req.body.business_id) as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const done = await identityService.dismissDuplicateFlag(req.params.flagId, businessId);
    if (!done) { error(res, 'Flag not found', 'NOT_FOUND', 404); return; }
    success(res, { dismissed: true });
  } catch (err: any) {
    console.error('Failed to dismiss', err?.message || err);
    error(res, 'Failed to dismiss', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/merge — Merge two customers
customersRouter.post('/merge', requirePermission('customers:*'), validate(mergeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await duplicateService.mergeCustomers(
      req.body.primary_id,
      req.body.secondary_id,
      req.body.business_id,
      req.body.keep_fields,
      authReq.user.sub,
      authReq.tenantId,
    );

    if (!result.success) {
      error(res, result.error || 'Merge failed', 'VALIDATION_ERROR', 400);
      return;
    }

    success(res, result.customer);
  } catch (err: any) {
    console.error('Failed to merge customers', err?.message || err);
    error(res, 'Failed to merge customers', 'INTERNAL_ERROR', 500);
  }
});

// --- Communication Preferences ---

const updatePreferencesSchema = Joi.object({
  email_marketing: Joi.boolean(),
  sms_marketing: Joi.boolean(),
  push_notifications: Joi.boolean(),
  booking_reminders: Joi.boolean(),
  // How the consent was obtained. Needed when staff switch a marketing channel ON.
  evidence: Joi.string().max(500).allow('', null),
}).or('email_marketing', 'sms_marketing', 'push_notifications', 'booking_reminders');

const setConsentSchema = Joi.object({
  channel: Joi.string().valid('email', 'sms', 'whatsapp', 'in_app', 'push').required(),
  category: Joi.string().valid('marketing', 'reminders').default('marketing'),
  given: Joi.boolean().required(),
  evidence: Joi.string().max(500).allow('', null),
});

// GET /api/v1/customers/:id/consent — Current consent per channel
customersRouter.get('/:id/consent', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    success(res, await consentService.getConsent(req.params.id));
  } catch (err: any) {
    console.error('Failed to get consent', err?.message || err);
    error(res, 'Failed to get consent', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id/consent/history — Every consent change, newest first
customersRouter.get('/:id/consent/history', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    success(res, await consentService.getConsentHistory(req.params.id));
  } catch (err: any) {
    console.error('Failed to get consent history', err?.message || err);
    error(res, 'Failed to get consent history', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id/consent — Record one consent change (staff)
customersRouter.put('/:id/consent', requirePermission('customers:*'), validate(setConsentSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    await consentService.setConsent({
      customerId: req.params.id, channel: req.body.channel, category: req.body.category, given: req.body.given,
      method: 'staff_entry', evidence: req.body.evidence, actorUserId: authReq.user.sub, ipAddress: req.ip,
    });
    success(res, await consentService.getConsent(req.params.id));
  } catch (err: any) {
    if (err instanceof consentService.ConsentEvidenceRequiredError) { error(res, err.message, err.code, 400); return; }
    error(res, 'Failed to record consent', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id/preferences — Get preferences
customersRouter.get('/:id/preferences', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    // Verify customer belongs to business
    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }

    success(res, await consentService.getLegacyPreferences(req.params.id));
  } catch (err: any) {
    console.error('Failed to get preferences', err?.message || err);
    error(res, 'Failed to get preferences', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id/preferences — Update preferences
customersRouter.put('/:id/preferences', requirePermission('customers:*'), validate(updatePreferencesSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }

    const { evidence, ...changes } = req.body;
    const updated = await consentService.setLegacyPreferences(req.params.id, changes, {
      method: 'staff_entry', evidence, actorUserId: authReq.user.sub, ipAddress: req.ip,
    });

    // Audit log
    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.preferences_updated',
      resourceType: 'customer',
      resourceId: req.params.id,
      details: req.body,
    });

    success(res, updated);
  } catch (err: any) {
    if (err instanceof consentService.ConsentEvidenceRequiredError) { error(res, err.message, err.code, 400); return; }
    error(res, 'Failed to update preferences', 'INTERNAL_ERROR', 500);
  }
});


// PUT /api/v1/customers/:id/lifecycle-stage — Change lifecycle stage
const lifecycleStageSchema = Joi.object({
  stage: Joi.string().valid('lead', 'trial', 'active', 'at_risk', 'churned', 'winback').required(),
  business_id: Joi.string().uuid().required(),
});

customersRouter.put('/:id/lifecycle-stage', requirePermission('customers:*'), validate(lifecycleStageSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { stage, business_id } = req.body;
    const customerId = req.params.id;

    // Verify customer exists
    const customer = await customerService.getCustomerById(customerId, business_id);
    if (!customer) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    // Update lifecycle stage
    await adminPool.query(
      `UPDATE cus_customers
          SET lifecycle_stage = $1, updated_at = NOW(),
              lifecycle_changed_at = CASE WHEN lifecycle_stage IS DISTINCT FROM $1 THEN NOW() ELSE lifecycle_changed_at END
        WHERE id = $2 AND business_id = $3`,
      [stage, customerId, business_id],
    );

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.lifecycle_changed',
      resourceType: 'customer',
      resourceId: customerId,
      details: { previous_stage: customer.lifecycle_stage, new_stage: stage },
    });

    success(res, { ...customer, lifecycle_stage: stage });
  } catch (err: any) {
    console.error('Failed to update lifecycle stage', err?.message || err);
    error(res, 'Failed to update lifecycle stage', 'INTERNAL_ERROR', 500);
  }
});


// --- Lifecycle Settings ---

// GET /api/v1/customers/lifecycle-config — Get lifecycle configuration for business
customersRouter.get('/lifecycle-config', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const { rows } = await adminPool.query(
      `SELECT key, value FROM sys_business_configurations WHERE business_id = $1 AND key LIKE 'lifecycle.%'`,
      [businessId],
    );

    const config: Record<string, any> = {
      enabled: true,
      at_risk_days: 30,
      churned_days: 60,
      run_time: '02:00',
    };

    for (const row of rows) {
      if (row.key === 'lifecycle.enabled') config.enabled = row.value === 'true';
      if (row.key === 'lifecycle.at_risk_days') config.at_risk_days = parseInt(row.value);
      if (row.key === 'lifecycle.churned_days') config.churned_days = parseInt(row.value);
      if (row.key === 'lifecycle.run_time') config.run_time = row.value;
    }

    success(res, config);
  } catch (err: any) {
    console.error('Failed to get lifecycle config', err?.message || err);
    error(res, 'Failed to get lifecycle config', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/lifecycle-config — Update lifecycle configuration
customersRouter.put('/lifecycle-config', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const { enabled, at_risk_days, churned_days, run_time } = req.body;

    const entries = [
      { key: 'lifecycle.enabled', value: String(enabled ?? true) },
      { key: 'lifecycle.at_risk_days', value: String(at_risk_days ?? 30) },
      { key: 'lifecycle.churned_days', value: String(churned_days ?? 60) },
      { key: 'lifecycle.run_time', value: run_time || '02:00' },
    ];

    for (const entry of entries) {
      await adminPool.query(
        `INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (business_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
        [businessId, entry.key, entry.value, authReq.user.sub],
      );
    }

    success(res, { enabled, at_risk_days, churned_days, run_time });
  } catch (err: any) {
    console.error('Failed to save lifecycle config', err?.message || err);
    error(res, 'Failed to save lifecycle config', 'INTERNAL_ERROR', 500);
  }
});


// --- Scheduled Jobs Management ---

// GET /api/v1/customers/scheduled-jobs/types — Get available job types
customersRouter.get('/scheduled-jobs/types', requirePermission('settings:*'), async (req: Request, res: Response) => {
  success(res, getAvailableJobTypes());
});

// GET /api/v1/customers/scheduled-jobs — Get jobs for this business
customersRouter.get('/scheduled-jobs', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const { rows } = await adminPool.query(
      `SELECT id, job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month,
              enabled, next_run_at, last_run_at, last_run_status, last_run_duration_ms, last_error, consecutive_failures
       FROM sys_scheduled_jobs WHERE business_id = $1 ORDER BY job_type`,
      [businessId],
    );
    success(res, rows);
  } catch (err: any) {
    console.error('Failed to get scheduled jobs', err?.message || err);
    error(res, 'Failed to get scheduled jobs', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/scheduled-jobs — Create/upsert a scheduled job
customersRouter.post('/scheduled-jobs', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const { job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month, enabled } = req.body;
    if (!job_type) { error(res, 'job_type required', 'VALIDATION_ERROR', 400); return; }

    // Calculate initial next_run_at — timezone-correct (HH:MM in schedule_timezone).
    const tz = schedule_timezone || 'UTC';
    const time = schedule_time || '02:00';
    const nextRun = computeNextRunUtc({
      scheduleTime: time, timezone: tz,
      frequency: frequency || 'daily', dayOfWeek: day_of_week ?? null, dayOfMonth: day_of_month ?? null,
    });

    // Business-scoped jobs: match the PARTIAL unique index (business_id, job_type)
    // WHERE scope_level = 'business' (migration 117) by repeating its predicate.
    const { rows } = await adminPool.query(
      `INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month, enabled, next_run_at)
       VALUES ('business', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (business_id, job_type) WHERE scope_level = 'business'
       DO UPDATE SET schedule_time = $4, schedule_timezone = $5, frequency = $6, day_of_week = $7, day_of_month = $8, enabled = $9, next_run_at = $10, updated_at = NOW()
       RETURNING *`,
      [businessId, authReq.tenantId, job_type, time, tz, frequency || 'daily', day_of_week ?? null, day_of_month ?? null, enabled !== false, nextRun],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) {
    console.error('Failed to create scheduled job', err?.message || err);
    error(res, 'Failed to create scheduled job', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/scheduled-jobs/:id/toggle — Enable/disable a job
customersRouter.put('/scheduled-jobs/:id/toggle', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `UPDATE sys_scheduled_jobs SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING id, enabled`,
      [req.params.id],
    );
    if (rows.length === 0) { error(res, 'Job not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) {
    console.error('Failed to toggle job', err?.message || err);
    error(res, 'Failed to toggle job', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/scheduled-jobs/:id — Delete a scheduled job
customersRouter.delete('/scheduled-jobs/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rowCount } = await adminPool.query('DELETE FROM sys_scheduled_jobs WHERE id = $1', [req.params.id]);
    if (rowCount === 0) { error(res, 'Job not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete job', err?.message || err);
    error(res, 'Failed to delete job', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/scheduled-jobs/:id/history — Get execution history
customersRouter.get('/scheduled-jobs/:id/history', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT id, started_at, completed_at, status, duration_ms, result, error
       FROM sys_job_executions WHERE job_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [req.params.id],
    );
    success(res, rows);
  } catch (err: any) {
    console.error('Failed to get job history', err?.message || err);
    error(res, 'Failed to get job history', 'INTERNAL_ERROR', 500);
  }
});
