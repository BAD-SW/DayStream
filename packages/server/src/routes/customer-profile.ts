import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as profile from '../services/customer-profile.service';

/**
 * Customer profile (Linear THE-16): figures, Timeline, referrals, reviews, tasks, documents,
 * photo, password reset and "send personal data". Mounted under /v1/customers next to the
 * customers router; every route takes ?business_id=, which tenantContext checks.
 */
export const customerProfileRouter = Router();
customerProfileRouter.use(authenticate);
customerProfileRouter.use(tenantContext);

const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: profile.MAX_DOCUMENT_BYTES } });
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: profile.MAX_PHOTO_BYTES } });

const STATUS: Record<string, number> = {
  NOT_FOUND: 404, INVALID_STAFF: 400, INVALID_EVENT: 400, INVALID_FILE_TYPE: 400, FILE_TOO_LARGE: 400,
  FILE_MISSING: 404, NO_ACCOUNT: 409, NO_EMAIL: 409, ANONYMIZED: 409, INVALID_LINK: 410,
};

function fail(res: Response, err: any, fallback: string) {
  if (err instanceof profile.ProfileError && STATUS[err.code]) { error(res, err.message, err.code, STATUS[err.code]); return; }
  if (err?.code === 'LIMIT_FILE_SIZE') { error(res, 'The file is too large', 'FILE_TOO_LARGE', 400); return; }
  console.error(fallback, err?.message || err);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

function biz(req: Request, res: Response): string | null {
  const businessId = req.query.business_id as string;
  if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return null; }
  return businessId;
}

/** Runs multer and turns its errors (e.g. too large) into a 400 instead of a 500. */
function withUpload(mw: (req: Request, res: Response, cb: (err?: any) => void) => void) {
  return (req: Request, res: Response, next: () => void) => mw(req, res, (err: any) => (err ? fail(res, err, 'Upload failed') : next()));
}

// --- Figures, Timeline, referrals, reviews ---

customerProfileRouter.get('/:id/figures', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.getFigures(req.params.id, businessId)); } catch (e) { fail(res, e, 'Failed to load figures'); }
});

customerProfileRouter.get('/:id/timeline', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  const kind = (req.query.kind as string) || 'all';
  if (kind !== 'all' && !(profile.TIMELINE_KINDS as readonly string[]).includes(kind)) { error(res, 'Unknown timeline filter', 'VALIDATION_ERROR', 400); return; }
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) || 100 : 100;
  try { success(res, await profile.getTimeline(req.params.id, businessId, kind, limit)); } catch (e) { fail(res, e, 'Failed to load the timeline'); }
});

customerProfileRouter.get('/:id/referrals', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.getReferrals(req.params.id, businessId)); } catch (e) { fail(res, e, 'Failed to load referrals'); }
});

customerProfileRouter.get('/:id/reviews', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.getReviews(req.params.id, businessId)); } catch (e) { fail(res, e, 'Failed to load reviews'); }
});

// --- Tasks ---

const taskSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().max(5000).allow('', null),
  due_at: Joi.string().isoDate().allow(null, ''),
  staff_ids: Joi.array().items(Joi.string().uuid()).min(1).max(20).required(),
  send_reminder: Joi.boolean().default(false),
  event_id: Joi.string().uuid().allow(null, ''),
});

customerProfileRouter.get('/:id/tasks', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.listTasks(req.params.id, businessId)); } catch (e) { fail(res, e, 'Failed to load tasks'); }
});

customerProfileRouter.post('/:id/tasks', requirePermission('customers:*'), validate(taskSchema), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try {
    const b = req.body;
    const task = await profile.createTask(req.params.id, businessId, {
      title: b.title, description: b.description || null, dueAt: b.due_at || null,
      staffIds: b.staff_ids, sendReminder: b.send_reminder, eventId: b.event_id || null,
    }, (req as AuthenticatedRequest).user.sub);
    success(res, task, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to create the task'); }
});

customerProfileRouter.put('/:id/tasks/:taskId/status', requirePermission('customers:*'), validate(Joi.object({ done: Joi.boolean().required() })), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.setTaskStatus(req.params.id, businessId, req.params.taskId, req.body.done, (req as AuthenticatedRequest).user.sub)); }
  catch (e) { fail(res, e, 'Failed to update the task'); }
});

customerProfileRouter.delete('/:id/tasks/:taskId', requirePermission('customers:*'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { await profile.deleteTask(req.params.id, businessId, req.params.taskId); success(res, { deleted: true }); }
  catch (e) { fail(res, e, 'Failed to delete the task'); }
});

// --- Documents ---

customerProfileRouter.get('/:id/documents', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.listDocuments(req.params.id, businessId)); } catch (e) { fail(res, e, 'Failed to load documents'); }
});

customerProfileRouter.post('/:id/documents', requirePermission('customers:*'), withUpload(documentUpload.single('file')), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  if (!req.file) { error(res, 'Choose a file to upload', 'VALIDATION_ERROR', 400); return; }
  try { success(res, await profile.uploadDocument(req.params.id, businessId, req.file, (req as AuthenticatedRequest).user.sub), undefined, 201); }
  catch (e) { fail(res, e, 'Failed to upload the document'); }
});

customerProfileRouter.get('/:id/documents/:docId/file', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try {
    const doc = await profile.readDocument(req.params.id, businessId, req.params.docId);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(doc.data);
  } catch (e) { fail(res, e, 'Failed to download the document'); }
});

customerProfileRouter.delete('/:id/documents/:docId', requirePermission('customers:*'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { await profile.deleteDocument(req.params.id, businessId, req.params.docId, (req as AuthenticatedRequest).user.sub); success(res, { deleted: true }); }
  catch (e) { fail(res, e, 'Failed to delete the document'); }
});

// --- Photo ---

customerProfileRouter.get('/:id/photo', requirePermission('customers:read'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try {
    const photo = await profile.readPhoto(req.params.id, businessId);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.data);
  } catch (e) { fail(res, e, 'Failed to load the photo'); }
});

customerProfileRouter.post('/:id/photo', requirePermission('customers:*'), withUpload(photoUpload.single('photo')), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  if (!req.file) { error(res, 'Choose a photo', 'VALIDATION_ERROR', 400); return; }
  try { await profile.savePhoto(req.params.id, businessId, req.file, (req as AuthenticatedRequest).user.sub); success(res, { has_photo: true }, undefined, 201); }
  catch (e) { fail(res, e, 'Failed to save the photo'); }
});

customerProfileRouter.delete('/:id/photo', requirePermission('customers:*'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { await profile.deletePhoto(req.params.id, businessId, (req as AuthenticatedRequest).user.sub); success(res, { has_photo: false }); }
  catch (e) { fail(res, e, 'Failed to remove the photo'); }
});

// --- Password reset and personal data ---

customerProfileRouter.post('/:id/password-reset', requirePermission('customers:*'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try { success(res, await profile.requestPasswordReset(req.params.id, businessId, (req as AuthenticatedRequest).user.sub)); }
  catch (e) { fail(res, e, 'Failed to send the password reset'); }
});

customerProfileRouter.post('/:id/personal-data', requirePermission('customers:*'), async (req, res) => {
  const businessId = biz(req, res); if (!businessId) return;
  try {
    // The password is in this response only, for the staff member to pass on; it is not stored.
    res.setHeader('Cache-Control', 'no-store');
    success(res, await profile.sendPersonalData(req.params.id, businessId, (req as AuthenticatedRequest).user.sub, req.ip), undefined, 201);
  } catch (e) { fail(res, e, 'Failed to send the personal data'); }
});

// --- Public: the file behind the emailed link (no login; the token is the key) ---

export const personalDataPublicRouter = Router();

personalDataPublicRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const data = await profile.downloadPersonalData(req.params.token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="personal-data.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  } catch (e) { fail(res, e, 'Failed to download'); }
});
