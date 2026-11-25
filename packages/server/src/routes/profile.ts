import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { isSupportedLanguage } from '@daystream/shared';
import { msg } from '../i18n';

export const profileRouter = Router();

// All profile routes require authentication and tenant context
profileRouter.use(authenticate);
profileRouter.use(tenantContext);

// GET /api/v1/profile — Get current user's profile
profileRouter.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, status, preferred_language, created_at, updated_at
       FROM usr_users WHERE id = $1 AND tenant_id = $2`,
      [authReq.user.sub, authReq.tenantId],
    );

    if (rows.length === 0) {
      error(res, msg('errors:profile.profileNotFound'), 'NOT_FOUND', 404);
      return;
    }

    success(res, rows[0]);
  } catch (err: any) {
    console.error('Failed to get profile', err?.message || err);
    error(res, msg('errors:profile.failedToGetProfile'), 'INTERNAL_ERROR', 500);
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
      `UPDATE usr_users SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}`,
      values,
    );

    // Return updated profile
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, role, status, preferred_language, created_at, updated_at
       FROM usr_users WHERE id = $1 AND tenant_id = $2`,
      [authReq.user.sub, authReq.tenantId],
    );

    success(res, rows[0]);
  } catch (err: any) {
    console.error('Failed to update profile', err?.message || err);
    error(res, msg('errors:profile.failedToUpdateProfile'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/profile/language — { language } (Phase 44, requirement 2): the language chosen in the menu
// bar, saved on the account so it follows the person to every device. Not for the System persona, whose
// screens are always in English. A customer's choice also sets the language on their customer record in
// the business they are using, so their emails match (criterion 9).
profileRouter.put('/language', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const language = req.body?.language;
    if (!isSupportedLanguage(language)) { error(res, msg('errors:profile.unsupportedLanguage'), 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      `UPDATE usr_users SET preferred_language = $1, updated_at = NOW()
       WHERE id = $2 AND persona <> 'system'
       RETURNING persona, email, tenant_id`,
      [language, authReq.user.sub],
    );
    if (rows.length === 0) { error(res, msg('errors:profile.theLanguageCannotBeChangedFor'), 'FORBIDDEN', 403); return; }
    const businessId = typeof req.query.business_id === 'string' ? req.query.business_id : null;
    if (rows[0].persona === 'customer' && businessId) {
      await adminPool.query(
        `UPDATE cus_customers SET preferred_language = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND business_id = $3 AND LOWER(email) = LOWER($4) AND status <> 'anonymized'`,
        [language, rows[0].tenant_id, businessId, rows[0].email],
      );
    }
    success(res, { preferred_language: language });
  } catch (err) {
    console.error('Failed to save language', (err as Error).message);
    error(res, msg('errors:profile.failedToSaveTheLanguage'), 'INTERNAL_ERROR', 500);
  }
});
// ---------------------------------------------------------------------------------------------
// The person's own screen settings (owner, 19 Nov 2026), kept on the server so they follow them to
// any browser. Only known keys are accepted, each with its own shape.
// ---------------------------------------------------------------------------------------------

const PREFERENCE_SCHEMAS: Record<string, Joi.Schema> = {
  // The Reports page's category order: category ids, first to last.
  'reports.category_order': Joi.array().items(Joi.string().pattern(/^[a-z0-9_-]{1,40}$/)).max(50).unique().required(),
};

// GET /api/v1/profile/preferences/:key — the saved value, or null when none is saved
profileRouter.get('/preferences/:key', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!PREFERENCE_SCHEMAS[req.params.key]) { error(res, msg('errors:profile.unknownPreference'), 'NOT_FOUND', 404); return; }
    const { rows } = await adminPool.query(
      'SELECT value FROM usr_preferences WHERE user_id = $1 AND key = $2', [authReq.user.sub, req.params.key]);
    success(res, rows[0]?.value ?? null);
  } catch (err) { console.error('Failed to load preference', (err as Error).message); error(res, msg('errors:profile.failedToLoadTheSetting'), 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/profile/preferences/:key — { value }; null removes it (back to the default)
profileRouter.put('/preferences/:key', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const schema = PREFERENCE_SCHEMAS[req.params.key];
    if (!schema) { error(res, msg('errors:profile.unknownPreference'), 'NOT_FOUND', 404); return; }
    const value = req.body?.value ?? null;
    if (value === null) {
      await adminPool.query('DELETE FROM usr_preferences WHERE user_id = $1 AND key = $2', [authReq.user.sub, req.params.key]);
      success(res, null);
      return;
    }
    const { error: invalid } = schema.validate(value);
    if (invalid) { error(res, invalid.message, 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      `INSERT INTO usr_preferences (tenant_id, user_id, key, value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING value`,
      [authReq.user.tid, authReq.user.sub, req.params.key, JSON.stringify(value)]);
    success(res, rows[0].value);
  } catch (err) { console.error('Failed to save preference', (err as Error).message); error(res, msg('errors:profile.failedToSaveTheSetting'), 'INTERNAL_ERROR', 500); }
});