import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, ownCustomerIds } from '../auth/tenant-context';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as inbox from '../services/inbox.service';
import * as segments from '../services/customer-segments.service';

/**
 * Inbox (THE-18). Staff routes need an Inbox role (owner, manager, front desk) in the business;
 * customer routes (`/customer/...`) are the in-app messages of the logged-in customer.
 * The bell (`/notifications`) is for every staff login.
 */
export const inboxRouter = Router();
inboxRouter.use(authenticate);
inboxRouter.use(tenantContext);

function fail(res: Response, err: any, what: string) {
  if (err instanceof inbox.InboxError) { error(res, err.message, err.code, err.status); return; }
  console.error(`Inbox: ${what}`, err?.message || err);
  error(res, `Failed to ${what}`, 'INTERNAL_ERROR', 500);
}

/** The business of the request, if the caller may work in it. */
async function businessOf(req: Request): Promise<string | null> {
  const authReq = req as AuthenticatedRequest;
  const businessId = (req.query.business_id || req.body?.business_id) as string;
  if (!businessId) return null;
  const { rows } = await adminPool.query(
    `SELECT b.id, u.persona, u.business_id AS own FROM sys_businesses b, usr_users u WHERE b.id = $1 AND b.tenant_id = $2 AND u.id = $3`,
    [businessId, authReq.tenantId, authReq.user.sub],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.persona === 'business' && r.own && r.own !== businessId) return null;
  return businessId;
}

/** Staff with an Inbox role in the business (owner, manager, front desk). */
async function requireInbox(req: Request, res: Response, next: NextFunction) {
  try {
    const businessId = await businessOf(req);
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const role = await inbox.inboxRoleOfUser((req as AuthenticatedRequest).user.sub);
    const perms = (req as AuthenticatedRequest).user.permissions || [];
    if (role === 'staff' && !perms.includes('*:*')) { error(res, 'The Inbox is for owners, managers and front desk', 'FORBIDDEN', 403); return; }
    (req as any).businessId = businessId;
    (req as any).inboxRole = role;
    next();
  } catch (err: any) { fail(res, err, 'check access'); }
}

/** Owners and managers change the Inbox settings. */
function requireManager(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).inboxRole as inbox.InboxRole;
  if (role !== 'owner' && role !== 'manager') { error(res, 'Only owners and managers can change the Inbox settings', 'FORBIDDEN', 403); return; }
  next();
}

// --- Customer: in-app messages ------------------------------------------------------------

async function ownCustomerIn(req: Request): Promise<{ businessId: string; customerId: string } | null> {
  const businessId = req.query.business_id as string || req.body?.business_id;
  if (!businessId) return null;
  const ids = await ownCustomerIds(req);
  if (!ids.length) return null;
  const { rows } = await adminPool.query(`SELECT id FROM cus_customers WHERE id = ANY($1::uuid[]) AND business_id = $2 LIMIT 1`, [ids, businessId]);
  return rows[0] ? { businessId, customerId: rows[0].id } : null;
}

inboxRouter.get('/customer/messages', async (req: Request, res: Response) => {
  try {
    const me = await ownCustomerIn(req);
    if (!me) { success(res, []); return; }
    success(res, await inbox.customerThread(me.businessId, me.customerId));
  } catch (err: any) { fail(res, err, 'load messages'); }
});

inboxRouter.post('/customer/messages', async (req: Request, res: Response) => {
  try {
    const me = await ownCustomerIn(req);
    if (!me) { error(res, 'You are not a customer of this business', 'NOT_FOUND', 404); return; }
    success(res, await inbox.receiveMessage({ businessId: me.businessId, customerId: me.customerId, channel: 'in_app', body: req.body.body }), undefined, 201);
  } catch (err: any) { fail(res, err, 'send the message'); }
});

// --- The bell (any staff login) -------------------------------------------------------------

inboxRouter.get('/notifications', async (req: Request, res: Response) => {
  try { success(res, await inbox.myNotifications((req as AuthenticatedRequest).user.sub)); } catch (err: any) { fail(res, err, 'load notifications'); }
});
inboxRouter.put('/notifications/read', async (req: Request, res: Response) => {
  try { await inbox.markNotificationsRead((req as AuthenticatedRequest).user.sub, req.body?.ids); success(res, { ok: true }); } catch (err: any) { fail(res, err, 'mark notifications read'); }
});

// --- Staff ---------------------------------------------------------------------------------

inboxRouter.get('/access', requireInbox, async (req: Request, res: Response) => {
  success(res, { role: (req as any).inboxRole, unread: await inbox.unreadCount((req as any).businessId), channels: inbox.CONNECTED_CHANNELS });
});

inboxRouter.get('/conversations', requireInbox, async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    let customerIds: string[] | null = null;
    if (req.query.segment_id) customerIds = await segments.getMemberIds(req.query.segment_id as string, businessId);
    success(res, await inbox.listConversations(businessId, {
      view: req.query.view as any, search: req.query.search as string, channel: req.query.channel as string,
      unread: req.query.unread === 'true', customerIds, userId: (req as AuthenticatedRequest).user.sub,
    }));
  } catch (err: any) { fail(res, err, 'list conversations'); }
});

inboxRouter.get('/users', requireInbox, async (req: Request, res: Response) => {
  try { success(res, await inbox.inboxUsers((req as any).businessId)); } catch (err: any) { fail(res, err, 'list users'); }
});

// Start (or open) the conversation with a person, e.g. from their profile.
inboxRouter.post('/conversations', requireInbox, async (req: Request, res: Response) => {
  try {
    const conv = await inbox.conversationFor((req as any).businessId, req.body.customer_id);
    success(res, await inbox.getConversation(conv.id, (req as any).businessId));
  } catch (err: any) { fail(res, err, 'open the conversation'); }
});

inboxRouter.get('/conversations/:id', requireInbox, async (req: Request, res: Response) => {
  try {
    const businessId = (req as any).businessId;
    const conv = await inbox.getConversation(req.params.id, businessId);
    if (!conv) { error(res, 'Conversation not found', 'NOT_FOUND', 404); return; }
    // Opening it reads it (unless asked not to, e.g. after "mark unread").
    if (conv.unread && req.query.peek !== 'true') { await inbox.setUnread(conv.id, businessId, false); conv.unread = false; }
    success(res, conv);
  } catch (err: any) { fail(res, err, 'load the conversation'); }
});

inboxRouter.post('/conversations/:id/messages', requireInbox, async (req: Request, res: Response) => {
  try {
    success(res, await inbox.sendMessage({
      conversationId: req.params.id, businessId: (req as any).businessId, userId: (req as AuthenticatedRequest).user.sub,
      channel: req.body.channel, subject: req.body.subject, body: req.body.body, mentions: req.body.mentions,
    }), undefined, 201);
  } catch (err: any) { fail(res, err, 'send the message'); }
});

inboxRouter.put('/conversations/:id/assign', requireInbox, async (req: Request, res: Response) => {
  try { success(res, await inbox.assign(req.params.id, (req as any).businessId, req.body.assignee_user_id || null, (req as AuthenticatedRequest).user.sub)); } catch (err: any) { fail(res, err, 'assign'); }
});

inboxRouter.put('/conversations/:id/status', requireInbox, async (req: Request, res: Response) => {
  try {
    const status = req.body.status === 'closed' ? 'closed' : 'open';
    success(res, await inbox.setStatus(req.params.id, (req as any).businessId, status, (req as AuthenticatedRequest).user.sub));
  } catch (err: any) { fail(res, err, 'change the status'); }
});

inboxRouter.put('/conversations/:id/unread', requireInbox, async (req: Request, res: Response) => {
  try { await inbox.setUnread(req.params.id, (req as any).businessId, req.body.unread !== false); success(res, { ok: true }); } catch (err: any) { fail(res, err, 'mark unread'); }
});

// --- Settings ------------------------------------------------------------------------------

inboxRouter.get('/settings', requireInbox, async (req: Request, res: Response) => {
  try {
    success(res, {
      ...(await inbox.getNotificationSettings((req as any).businessId)),
      mine: await inbox.getUserPrefs((req as AuthenticatedRequest).user.sub),
      role: (req as any).inboxRole,
      always_in_app: inbox.ALWAYS_IN_APP,
    });
  } catch (err: any) { fail(res, err, 'load the settings'); }
});

inboxRouter.put('/settings', requireInbox, requireManager, async (req: Request, res: Response) => {
  try { success(res, await inbox.setNotificationSettings((req as any).businessId, (req as AuthenticatedRequest).user.sub, req.body)); } catch (err: any) { fail(res, err, 'save the settings'); }
});

// Each user's own switches ("My notifications").
inboxRouter.put('/settings/mine', requireInbox, async (req: Request, res: Response) => {
  try { success(res, await inbox.setUserPrefs((req as AuthenticatedRequest).user.sub, req.body?.prefs || {})); } catch (err: any) { fail(res, err, 'save your notifications'); }
});
