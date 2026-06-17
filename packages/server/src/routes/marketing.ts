import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as templatesService from '../services/marketing-templates.service';
import * as campaignsService from '../services/marketing-campaigns.service';
import * as sequencesService from '../services/marketing-sequences.service';
import * as analyticsService from '../services/marketing-analytics.service';
import * as consentService from '../services/marketing-consent.service';
import * as funnelsService from '../services/marketing-funnels.service';

export const marketingRouter = Router();

// ============================================================
// Public routes (lead funnels, unsubscribe)
// ============================================================

marketingRouter.get('/funnels/:slug', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const funnel = await funnelsService.getFunnelBySlug(tenantId, req.params.slug);
    if (!funnel) { error(res, 'Funnel not found', 'NOT_FOUND', 404); return; }
    await funnelsService.incrementPageViews(funnel.id);
    success(res, funnel);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

marketingRouter.post('/funnels/:slug/submit', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const funnel = await funnelsService.getFunnelBySlug(tenantId, req.params.slug);
    if (!funnel) { error(res, 'Funnel not found', 'NOT_FOUND', 404); return; }
    const result = await funnelsService.submitForm(funnel.id, req.body);
    success(res, result, undefined, 201);
  } catch (err: any) { error(res, err.message || 'Submission failed', 'INTERNAL_ERROR', 500); }
});

marketingRouter.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { tenant_id, customer_id, channel, category } = req.body;
    if (!tenant_id || !customer_id || !channel) { error(res, 'Missing fields', 'VALIDATION_ERROR', 400); return; }
    await consentService.processUnsubscribe(tenant_id, customer_id, channel, category);
    success(res, { unsubscribed: true });
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Authenticated routes
// ============================================================

marketingRouter.use(authenticate);
marketingRouter.use(tenantContext);

// --- Templates ---
marketingRouter.get('/templates', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const data = await templatesService.getTemplates(authReq.tenantId, req.query.channel as string); success(res, data); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/templates', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const t = await templatesService.createTemplate(authReq.tenantId, req.body); success(res, t, undefined, 201); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/templates/:id', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const t = await templatesService.getTemplateById(req.params.id, authReq.tenantId); if (!t) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, t); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.put('/templates/:id', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const t = await templatesService.updateTemplate(req.params.id, authReq.tenantId, req.body); if (!t) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, t); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/templates/:id/preview', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await templatesService.renderTemplate(req.params.id, authReq.tenantId, req.body); success(res, r); }
  catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.delete('/templates/:id', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await templatesService.deleteTemplate(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Campaigns ---
marketingRouter.get('/campaigns', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await campaignsService.getCampaigns(authReq.tenantId, { channel: req.query.channel as string, status: req.query.status as string, page: req.query.page ? parseInt(req.query.page as string, 10) : 1, limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 25 }); success(res, r.campaigns, { page: r.page, limit: r.limit, total: r.total }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/campaigns', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const c = await campaignsService.createCampaign(authReq.tenantId, { ...req.body, createdBy: authReq.user.sub }); success(res, c, undefined, 201); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/campaigns/:id', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const c = await campaignsService.getCampaignById(req.params.id, authReq.tenantId); if (!c) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, c); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.put('/campaigns/:id', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const c = await campaignsService.updateCampaign(req.params.id, authReq.tenantId, req.body); if (!c) { error(res, 'Not found or not editable', 'NOT_FOUND', 404); return; } success(res, c); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/campaigns/:id/schedule', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const c = await campaignsService.scheduleCampaign(req.params.id, authReq.tenantId, req.body.scheduled_at); if (!c) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, c); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/campaigns/:id/send', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const c = await campaignsService.sendCampaign(req.params.id, authReq.tenantId); success(res, c); }
  catch (err: any) { error(res, err.message || 'Failed', 'VALIDATION_ERROR', 400); }
});
marketingRouter.post('/campaigns/:id/test', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await campaignsService.sendTestEmail(req.params.id, authReq.tenantId, req.body.email); success(res, r); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/campaigns/:id/analytics', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const a = await analyticsService.getCampaignAnalytics(req.params.id); success(res, a); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/campaigns/:id/recipients', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const r = await analyticsService.getRecipientList(req.params.id, { status: req.query.status as string, page: req.query.page ? parseInt(req.query.page as string, 10) : 1 }); success(res, r.recipients, { page: r.page, limit: r.limit, total: r.total }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Sequences ---
marketingRouter.get('/sequences/templates', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const t = await sequencesService.getSequenceTemplates(authReq.tenantId); success(res, t); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/sequences', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await sequencesService.getSequences(authReq.tenantId, { status: req.query.status as string, page: req.query.page ? parseInt(req.query.page as string, 10) : 1 }); success(res, r.sequences, { page: r.page, limit: r.limit, total: r.total }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/sequences', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await sequencesService.createSequence(authReq.tenantId, req.body); success(res, s, undefined, 201); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/sequences/:id', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await sequencesService.getSequenceById(req.params.id, authReq.tenantId); if (!s) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, s); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.put('/sequences/:id', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await sequencesService.updateSequence(req.params.id, authReq.tenantId, req.body); if (!s) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, s); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/sequences/:id/activate', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await sequencesService.activateSequence(req.params.id, authReq.tenantId); if (!s) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, s); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/sequences/:id/pause', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await sequencesService.pauseSequence(req.params.id, authReq.tenantId); if (!s) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, s); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/sequences/:id/validate', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const v = await sequencesService.validateSequence(req.params.id, authReq.tenantId); success(res, v); }
  catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/sequences/:id/enrollments', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const r = await sequencesService.getEnrollments(req.params.id, { status: req.query.status as string }); success(res, r.enrollments, { total: r.total }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Consent ---
marketingRouter.get('/preferences/:customerId', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const p = await consentService.getPreferences(authReq.tenantId, req.params.customerId); success(res, p); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.put('/preferences/:customerId', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const p = await consentService.updatePreferences(authReq.tenantId, req.params.customerId, req.body.preferences || []); success(res, p); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Funnels (admin) ---
marketingRouter.get('/funnels', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const f = await funnelsService.getFunnels(authReq.tenantId); success(res, f); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.post('/funnels', requirePermission('marketing:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const f = await funnelsService.createFunnel(authReq.tenantId, req.body); success(res, f, undefined, 201); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
marketingRouter.get('/funnels/:id/analytics', requirePermission('marketing:read'), async (req: Request, res: Response) => {
  try { const a = await funnelsService.getFunnelAnalytics(req.params.id); success(res, a); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Webhooks ---
marketingRouter.post('/webhooks/email', async (req: Request, res: Response) => {
  // Placeholder: process email provider webhook events
  success(res, { received: true });
});
marketingRouter.post('/webhooks/sms', async (req: Request, res: Response) => {
  // Placeholder: process SMS provider webhook events
  success(res, { received: true });
});
