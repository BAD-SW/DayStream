import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as webhooksService from '../services/integration-webhooks.service';
import * as apiKeysService from '../services/integration-apikeys.service';
import * as icalService from '../services/integration-ical.service';
import * as syncService from '../services/integration-sync.service';
import * as oauthService from '../services/integration-oauth.service';
import * as marketplaceService from '../services/integration-marketplace.service';

export const integrationsRouter = Router();

// Public iCal feed (no auth, token-based)
integrationsRouter.get('/ical/:token', async (req: Request, res: Response) => {
  try {
    const content = await icalService.generateIcalContent(req.params.token);
    if (!content) { error(res, 'Feed not found', 'NOT_FOUND', 404); return; }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(content);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// Authenticated routes
integrationsRouter.use(authenticate);
integrationsRouter.use(tenantContext);

// --- Marketplace ---
integrationsRouter.get('/marketplace', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await marketplaceService.getMarketplaceWithStatus(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Connections ---
integrationsRouter.get('/', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await syncService.getConnections(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/connect', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await oauthService.initiateOAuth(authReq.tenantId, req.body.provider, req.body.redirect_uri); success(res, r); } catch (err: any) { error(res, err.message || 'Failed', 'VALIDATION_ERROR', 400); }
});
integrationsRouter.get('/callback', async (req: Request, res: Response) => {
  try { const r = await oauthService.handleCallback(req.query.state as string, req.query.code as string); success(res, r); } catch (err: any) { error(res, err.message || 'Failed', 'VALIDATION_ERROR', 400); }
});
integrationsRouter.delete('/:id', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await syncService.disconnectConnection(req.params.id, authReq.tenantId); if (!r) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, r); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.get('/:id/logs', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { success(res, await syncService.getSyncLog(req.params.id)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/:id/sync', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { success(res, await syncService.triggerSync(req.params.id)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Webhooks ---
integrationsRouter.get('/webhooks', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await webhooksService.getSubscriptions(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/webhooks', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await webhooksService.createSubscription(authReq.tenantId, { url: req.body.url, eventTypes: req.body.event_types }); success(res, s, undefined, 201); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.put('/webhooks/:id', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await webhooksService.updateSubscription(req.params.id, authReq.tenantId, req.body); if (!s) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, s); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.delete('/webhooks/:id', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await webhooksService.deleteSubscription(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/webhooks/:id/test', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await webhooksService.testWebhook(req.params.id, authReq.tenantId); success(res, r); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.get('/webhooks/:id/deliveries', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { success(res, await webhooksService.getDeliveries(req.params.id)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- API Keys ---
integrationsRouter.get('/api-keys', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await apiKeysService.getApiKeys(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/api-keys', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const k = await apiKeysService.createApiKey(authReq.tenantId, { name: req.body.name, scopes: req.body.scopes, rateLimit: req.body.rate_limit, createdBy: authReq.user.sub }); success(res, k, undefined, 201); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.delete('/api-keys/:id', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await apiKeysService.deleteApiKey(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- iCal Feeds ---
integrationsRouter.get('/ical/staff', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const feed = await icalService.getOrCreateFeed(authReq.tenantId, { userId: authReq.user.sub, feedType: 'staff' }); success(res, feed); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.get('/ical/customer', requirePermission('integrations:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const feed = await icalService.getOrCreateFeed(authReq.tenantId, { customerId: req.query.customer_id as string, feedType: 'customer' }); success(res, feed); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
integrationsRouter.post('/ical/regenerate', requirePermission('integrations:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const feed = await icalService.regenerateFeed(authReq.tenantId, req.body.feed_id); if (!feed) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, feed); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
