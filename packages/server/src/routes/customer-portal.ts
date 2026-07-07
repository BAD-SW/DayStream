import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { logAudit } from '../services/audit.service';
import * as importService from '../services/customer-import.service';
import * as activityService from '../services/customer-activity.service';

export const customerPortalRouter = Router();

customerPortalRouter.use(authenticate);
customerPortalRouter.use(tenantContext);

/**
 * Resolve customer record for the authenticated user.
 * Assumes the customer's user account email matches their customer record email.
 */
async function resolveCustomer(req: Request): Promise<any | null> {
  const authReq = req as AuthenticatedRequest;

  // Look up by user ID first (if linked), then by email
  const { rows } = await adminPool.query(
    `SELECT c.* FROM cus_customers c
     JOIN usr_users u ON u.email = c.email
     WHERE u.id = $1 AND c.status != 'anonymized'
     LIMIT 1`,
    [authReq.user.sub],
  );

  return rows[0] || null;
}

// --- Validation schemas ---

const updateProfileSchema = Joi.object({
  email: Joi.string().email({ tlds: false }),
  phone: Joi.string().max(50).allow('', null),
  preferred_language: Joi.string().max(5),
  country: Joi.string().max(100).allow('', null),
}).min(1);

const updatePreferencesSchema = Joi.object({
  email_marketing: Joi.boolean(),
  sms_marketing: Joi.boolean(),
  push_notifications: Joi.boolean(),
  booking_reminders: Joi.boolean(),
}).min(1);

// --- Routes ---

// GET /api/v1/profile/customer — Customer views own profile
customerPortalRouter.get('/', async (req: Request, res: Response) => {
  try {
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    // Strip internal fields
    const { anonymized_at, anonymized_by, ...profile } = customer;
    success(res, profile);
  } catch (err: any) {
    error(res, 'Failed to get profile', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/profile/customer — Update own contact info
customerPortalRouter.put('/', validate(updateProfileSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const allowedFields = ['email', 'phone', 'preferred_language', 'country'];
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(req.body)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) { success(res, customer); return; }

    fields.push('updated_at = NOW()');
    values.push(customer.id);

    await adminPool.query(
      `UPDATE cus_customers SET ${fields.join(', ')} WHERE id = $${idx}`,
      values,
    );

    await activityService.createActivity({
      customerId: customer.id,
      businessId: customer.business_id,
      activityType: 'profile_change',
      description: 'Profile updated by customer',
      metadata: { fields: Object.keys(req.body), source: 'customer_portal' },
      createdBy: authReq.user.sub,
    });

    const { rows } = await adminPool.query('SELECT * FROM cus_customers WHERE id = $1', [customer.id]);
    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to update profile', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/profile/customer/notes — Visible notes only
customerPortalRouter.get('/notes', async (req: Request, res: Response) => {
  try {
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const { rows } = await adminPool.query(
      `SELECT cn.id, cn.category, cn.created_at FROM cus_notes cn
       JOIN cus_note_categories nc ON nc.business_id = cn.business_id AND nc.name = cn.category
       WHERE cn.customer_id = $1 AND nc.customer_visible = true
       ORDER BY cn.created_at DESC`,
      [customer.id],
    );

    success(res, rows);
  } catch (err: any) {
    error(res, 'Failed to get notes', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/profile/customer/activities — Own timeline
customerPortalRouter.get('/activities', async (req: Request, res: Response) => {
  try {
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await activityService.getActivities({
      customerId: customer.id,
      businessId: customer.business_id,
      page,
      limit,
    });

    success(res, result.activities, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to get activities', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/profile/customer/export — GDPR data export
customerPortalRouter.post('/export', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const data = await importService.exportGDPR(customer.id, customer.business_id);

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.gdpr_export',
      resourceType: 'customer',
      resourceId: customer.id,
    });

    success(res, data);
  } catch (err: any) {
    error(res, 'Failed to export data', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/profile/customer/delete — GDPR deletion request
customerPortalRouter.post('/delete', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    // Log the deletion request (actual anonymization requires staff approval in most cases)
    await activityService.createActivity({
      customerId: customer.id,
      businessId: customer.business_id,
      activityType: 'profile_change',
      description: 'Deletion request submitted by customer',
      metadata: { request_type: 'gdpr_deletion', source: 'customer_portal' },
      createdBy: authReq.user.sub,
    });

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.deletion_requested',
      resourceType: 'customer',
      resourceId: customer.id,
    });

    success(res, { message: 'Deletion request submitted. You will be notified when processed.' });
  } catch (err: any) {
    error(res, 'Failed to submit deletion request', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/profile/customer/preferences — Get own preferences
customerPortalRouter.get('/preferences', async (req: Request, res: Response) => {
  try {
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const { rows } = await adminPool.query(
      'SELECT email_marketing, sms_marketing, push_notifications, booking_reminders, updated_at FROM cus_preferences WHERE customer_id = $1',
      [customer.id],
    );

    success(res, rows[0] || { email_marketing: false, sms_marketing: false, push_notifications: false, booking_reminders: true });
  } catch (err: any) {
    error(res, 'Failed to get preferences', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/profile/customer/preferences — Update own preferences
customerPortalRouter.put('/preferences', validate(updatePreferencesSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const customer = await resolveCustomer(req);
    if (!customer) { error(res, 'Customer profile not found', 'NOT_FOUND', 404); return; }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(req.body)) {
      if (['email_marketing', 'sms_marketing', 'push_notifications', 'booking_reminders'].includes(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(value);
      }
    }

    fields.push('updated_at = NOW()');
    values.push(customer.id);

    await adminPool.query(
      `INSERT INTO cus_preferences (customer_id) VALUES ($${idx})
       ON CONFLICT (customer_id) DO UPDATE SET ${fields.join(', ')}`,
      values,
    );

    await logAudit({
      tenantId: authReq.tenantId,
      userId: authReq.user.sub,
      action: 'customer.preferences_updated',
      resourceType: 'customer',
      resourceId: customer.id,
      details: { ...req.body, source: 'customer_portal' },
    });

    const { rows } = await adminPool.query(
      'SELECT email_marketing, sms_marketing, push_notifications, booking_reminders, updated_at FROM cus_preferences WHERE customer_id = $1',
      [customer.id],
    );

    success(res, rows[0]);
  } catch (err: any) {
    error(res, 'Failed to update preferences', 'INTERNAL_ERROR', 500);
  }
});
