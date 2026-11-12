import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Inbox (THE-18, David 2026-11-04). One conversation per person per business; messages are
 * inbound (from the customer), outbound (staff), internal notes or automatic messages (what the
 * system sent, recorded for context). Channels: email and in-app now; SMS and WhatsApp when their
 * providers are connected (THE-19).
 *
 * Who sees it: business owners, managers and front desk (reception). Therapists, trainers and
 * other staff do not (Inbox spec, decided 2026-10-12).
 */

export type InboxRole = 'owner' | 'manager' | 'front_desk' | 'staff';
export type InboxChannel = 'email' | 'in_app' | 'sms' | 'whatsapp';
export const CONNECTED_CHANNELS: InboxChannel[] = ['email', 'in_app'];

export class InboxError extends Error {
  constructor(message: string, public status = 400, public code = 'VALIDATION_ERROR') { super(message); }
}

/** A login's Inbox role, from its role label. */
export function roleOf(label: string | null | undefined): InboxRole {
  const r = String(label || '').toLowerCase();
  if (r === 'business_owner' || r === 'tenant_owner' || r === 'system_admin' || r === 'super_admin') return 'owner';
  if (r === 'business_manager' || r === 'manager') return 'manager';
  if (r === 'reception' || r === 'front_desk') return 'front_desk';
  return 'staff';
}

export async function inboxRoleOfUser(userId: string): Promise<InboxRole> {
  const { rows } = await adminPool.query('SELECT role FROM usr_users WHERE id = $1', [userId]);
  return roleOf(rows[0]?.role);
}

// ---------------------------------------------------------------------------------------------
// Notification settings
// ---------------------------------------------------------------------------------------------

export type InboxEvent = 'new_unassigned' | 'assigned_message' | 'assigned_to_me' | 'mentioned' | 'unanswered' | 'delivery_failed' | 'new_lead' | 'daily_summary' | 'customer_arrived';
export const INBOX_EVENTS: InboxEvent[] = ['new_unassigned', 'assigned_message', 'assigned_to_me', 'mentioned', 'unanswered', 'delivery_failed', 'new_lead', 'daily_summary', 'customer_arrived'];
/** Events a user cannot switch off for themselves (assignments and mentions). */
export const ALWAYS_IN_APP: InboxEvent[] = ['assigned_to_me', 'mentioned'];

type Rule = { roles: Record<InboxRole, boolean>; in_app: boolean; email: boolean };
export type InboxNotificationSettings = Record<InboxEvent, Rule>;

const r = (owner: boolean, manager: boolean, front: boolean, staff: boolean, inApp: boolean, email: boolean): Rule =>
  ({ roles: { owner, manager, front_desk: front, staff }, in_app: inApp, email });

/** The defaults David approved (Inbox Proposals, part 2). */
export const DEFAULT_INBOX_NOTIFICATIONS: InboxNotificationSettings = {
  new_unassigned: r(true, true, true, false, true, true),
  assigned_message: r(true, true, true, true, true, true),
  assigned_to_me: r(true, true, true, true, true, true),
  mentioned: r(true, true, true, true, true, true),
  unanswered: r(true, true, false, false, false, true),
  delivery_failed: r(false, true, true, false, true, false),
  new_lead: r(true, true, true, false, true, true),
  daily_summary: r(true, true, false, false, false, true),
  // A customer has checked in (spec 51, gap 3); the booked practitioner is always included.
  customer_arrived: r(true, true, true, false, true, false),
};

export async function getNotificationSettings(businessId: string): Promise<{ events: InboxNotificationSettings; unanswered_hours: number }> {
  const { rows } = await adminPool.query(
    `SELECT key, value FROM sys_business_configurations WHERE business_id = $1 AND key IN ('inbox.notifications', 'inbox.unanswered_hours')`,
    [businessId],
  );
  let saved: any = {};
  try { saved = JSON.parse(rows.find((x) => x.key === 'inbox.notifications')?.value || '{}'); } catch { saved = {}; }
  const events = {} as InboxNotificationSettings;
  for (const e of INBOX_EVENTS) {
    const d = DEFAULT_INBOX_NOTIFICATIONS[e];
    const s = saved[e] || {};
    events[e] = { roles: { ...d.roles, ...(s.roles || {}) }, in_app: s.in_app ?? d.in_app, email: s.email ?? d.email };
  }
  const hours = Number(rows.find((x) => x.key === 'inbox.unanswered_hours')?.value ?? 4);
  return { events, unanswered_hours: Number.isFinite(hours) && hours > 0 ? hours : 4 };
}

export async function setNotificationSettings(businessId: string, userId: string, input: { events?: Partial<InboxNotificationSettings>; unanswered_hours?: number }) {
  const current = await getNotificationSettings(businessId);
  const events = { ...current.events };
  for (const e of INBOX_EVENTS) if (input.events?.[e]) events[e] = { ...events[e], ...input.events[e], roles: { ...events[e].roles, ...(input.events[e]!.roles || {}) } };
  const upsert = (key: string, value: string) => adminPool.query(
    `INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (business_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [businessId, key, value, userId],
  );
  await upsert('inbox.notifications', JSON.stringify(events));
  if (input.unanswered_hours !== undefined) await upsert('inbox.unanswered_hours', String(Math.max(1, Math.round(input.unanswered_hours))));
  return getNotificationSettings(businessId);
}

/** What a user switched off for themselves; missing rows mean "as the business set it". */
export async function getUserPrefs(userId: string): Promise<Record<string, { in_app: boolean; email: boolean }>> {
  const { rows } = await adminPool.query('SELECT event, in_app, email FROM inbox_user_prefs WHERE user_id = $1', [userId]);
  return Object.fromEntries(rows.map((x) => [x.event, { in_app: x.in_app, email: x.email }]));
}

export async function setUserPrefs(userId: string, prefs: Record<string, { in_app?: boolean; email?: boolean }>) {
  for (const [event, p] of Object.entries(prefs)) {
    if (!INBOX_EVENTS.includes(event as InboxEvent)) continue;
    const inApp = ALWAYS_IN_APP.includes(event as InboxEvent) ? true : p.in_app !== false;
    await adminPool.query(
      `INSERT INTO inbox_user_prefs (user_id, event, in_app, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, event) DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email`,
      [userId, event, inApp, p.email !== false],
    );
  }
  return getUserPrefs(userId);
}

/** The business's staff logins with Inbox roles. */
async function businessUsers(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT id, email, first_name, last_name, role FROM usr_users
      WHERE business_id = $1 AND persona = 'business' AND COALESCE(status, 'active') = 'active'`,
    [businessId],
  );
  return rows.map((u) => ({ ...u, inboxRole: roleOf(u.role) }));
}

/**
 * Tell staff about an Inbox event, as the business set it and each user allows: an in-app
 * notification (the bell) and / or an email. `to` limits it to given users (the assignee, the
 * people mentioned); otherwise every user whose role gets the event. The actor is never told.
 */
export async function notify(businessId: string, event: InboxEvent, n: { title: string; body?: string; link?: string; to?: string[]; alsoTo?: string[]; actorId?: string | null }) {
  try {
    const { events } = await getNotificationSettings(businessId);
    const rule = events[event];
    const users = (await businessUsers(businessId)).filter((u) => u.id !== n.actorId && (n.to ? n.to.includes(u.id) : (rule.roles[u.inboxRole as InboxRole] || !!n.alsoTo?.includes(u.id))));
    if (!users.length) return 0;
    const { sendEmail } = await import('./email.service');
    let told = 0;
    for (const u of users) {
      const pref = (await getUserPrefs(u.id))[event] || { in_app: true, email: true };
      const inApp = rule.in_app && (pref.in_app || ALWAYS_IN_APP.includes(event));
      const email = rule.email && pref.email && !!u.email;
      if (inApp) {
        await adminPool.query(
          `INSERT INTO usr_notifications (user_id, business_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5, $6)`,
          [u.id, businessId, `inbox.${event}`, n.title, n.body || null, n.link || null],
        );
      }
      if (email) {
        sendEmail({ to: u.email, subject: n.title, text: `${n.body || ''}\n\nOpen the Inbox in DayStream to answer.`, html: `<p>${escapeHtml(n.body || '')}</p><p>Open the Inbox in DayStream to answer.</p>` })
          .catch((e: any) => logger.warn(`Inbox email to ${u.email} not sent: ${e?.message || e}`));
      }
      if (inApp || email) told++;
    }
    return told;
  } catch (e: any) {
    logger.warn(`Inbox notification ${event} failed: ${e?.message || e}`);
    return 0;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------

const preview = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 140);
const personName = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || c.phone || 'Someone';

/** The person's conversation, created when it doesn't exist yet. New ones go to the person's owner. */
export async function conversationFor(businessId: string, customerId: string) {
  const { rows: cust } = await adminPool.query('SELECT id, tenant_id, owner_user_id FROM cus_customers WHERE id = $1 AND business_id = $2', [customerId, businessId]);
  if (!cust[0]) throw new InboxError('Person not found', 404, 'NOT_FOUND');
  const { rows } = await adminPool.query(
    `INSERT INTO inbox_conversations (tenant_id, business_id, customer_id, assignee_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_id, customer_id) DO UPDATE SET updated_at = inbox_conversations.updated_at
     RETURNING *, (xmax = 0) AS created`,
    [cust[0].tenant_id, businessId, customerId, cust[0].owner_user_id],
  );
  return rows[0];
}

export interface ListOptions { view?: 'open' | 'mine' | 'unassigned' | 'closed' | 'all'; search?: string; channel?: string; unread?: boolean; customerIds?: string[] | null; userId: string }

export async function listConversations(businessId: string, o: ListOptions) {
  const where = ['ic.business_id = $1', 'ic.last_message_at IS NOT NULL'];
  const params: any[] = [businessId];
  const p = (v: any) => { params.push(v); return `$${params.length}`; };
  const view = o.view || 'open';
  if (view === 'open') where.push(`ic.status = 'open'`);
  if (view === 'closed') where.push(`ic.status = 'closed'`);
  if (view === 'mine') where.push(`ic.status = 'open' AND ic.assignee_user_id = ${p(o.userId)}`);
  if (view === 'unassigned') where.push(`ic.status = 'open' AND ic.assignee_user_id IS NULL`);
  if (o.channel) where.push(`ic.last_channel = ${p(o.channel)}`);
  if (o.unread) where.push('ic.unread');
  if (o.customerIds) where.push(`ic.customer_id = ANY(${p(o.customerIds)}::uuid[])`);
  if (o.search?.trim()) {
    const q = p(`%${o.search.trim()}%`);
    where.push(`(c.first_name ILIKE ${q} OR c.last_name ILIKE ${q} OR c.email ILIKE ${q} OR c.phone ILIKE ${q}
      OR CONCAT(c.first_name, ' ', c.last_name) ILIKE ${q}
      OR EXISTS (SELECT 1 FROM inbox_messages m WHERE m.conversation_id = ic.id AND m.direction <> 'note' AND (m.body ILIKE ${q} OR m.subject ILIKE ${q})))`);
  }
  const { rows } = await adminPool.query(
    `SELECT ic.id, ic.customer_id, ic.status, ic.unread, ic.last_message_at, ic.last_preview, ic.last_channel, ic.assignee_user_id,
            c.first_name, c.last_name, c.email, c.phone, c.lifecycle_stage,
            TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS assignee_name
       FROM inbox_conversations ic
       JOIN cus_customers c ON c.id = ic.customer_id
       LEFT JOIN usr_users a ON a.id = ic.assignee_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY ic.unread DESC, ic.last_message_at DESC
      LIMIT 200`,
    params,
  );
  const { rows: counts } = await adminPool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
            COUNT(*) FILTER (WHERE status = 'open' AND assignee_user_id = $2)::int AS mine,
            COUNT(*) FILTER (WHERE status = 'open' AND assignee_user_id IS NULL)::int AS unassigned,
            COUNT(*) FILTER (WHERE unread)::int AS unread
       FROM inbox_conversations WHERE business_id = $1 AND last_message_at IS NOT NULL`,
    [businessId, o.userId],
  );
  return { conversations: rows.map((x) => ({ ...x, name: personName(x) })), counts: counts[0] };
}

/** Unread conversations, for the badge on the Inbox menu entry. */
export async function unreadCount(businessId: string): Promise<number> {
  const { rows } = await adminPool.query(`SELECT COUNT(*)::int AS n FROM inbox_conversations WHERE business_id = $1 AND unread AND status = 'open'`, [businessId]);
  return rows[0].n;
}

/** A conversation with its messages and the person's context (the right pane). */
export async function getConversation(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT ic.*, TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS assignee_name FROM inbox_conversations ic
       LEFT JOIN usr_users a ON a.id = ic.assignee_user_id WHERE ic.id = $1 AND ic.business_id = $2`,
    [id, businessId],
  );
  const conv = rows[0];
  if (!conv) return null;
  const { rows: messages } = await adminPool.query(
    `SELECT m.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS sender_name FROM inbox_messages m
       LEFT JOIN usr_users u ON u.id = m.sender_user_id WHERE m.conversation_id = $1 ORDER BY m.created_at`,
    [id],
  );
  return { ...conv, messages, person: await personContext(conv.customer_id, businessId) };
}

/** Who the conversation is with: the facts the front desk needs without leaving it. */
export async function personContext(customerId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.lifecycle_stage, c.source, c.last_visit_at, c.created_at, c.status,
            TRIM(CONCAT(o.first_name, ' ', o.last_name)) AS owner_name,
            (SELECT json_build_object('start_time', b.start_time, 'service', s.name) FROM apt_bookings b LEFT JOIN svc_services s ON s.id = b.service_id
              WHERE b.customer_id = c.id AND b.start_time > NOW() AND b.status NOT IN ('cancelled', 'no_show') ORDER BY b.start_time LIMIT 1) AS next_booking,
            (SELECT json_agg(p.name ORDER BY p.name) FROM mbr_enrollments e JOIN mbr_plans p ON p.id = e.plan_id WHERE e.customer_id = c.id AND e.status = 'active') AS memberships,
            (SELECT json_agg(t.name ORDER BY t.name) FROM cus_customer_tags ct JOIN cus_tags t ON t.id = ct.tag_id WHERE ct.customer_id = c.id) AS tags
       FROM cus_customers c LEFT JOIN usr_users o ON o.id = c.owner_user_id
      WHERE c.id = $1 AND c.business_id = $2`,
    [customerId, businessId],
  );
  const c = rows[0];
  return c ? { ...c, name: personName(c), memberships: c.memberships || [], tags: c.tags || [] } : null;
}

async function addMessage(convId: string, m: { direction: string; channel: string; subject?: string | null; body: string; senderId?: string | null; status?: string; failure?: string | null; mentions?: string[] }) {
  const { rows } = await adminPool.query(
    `INSERT INTO inbox_messages (conversation_id, direction, channel, subject, body, sender_user_id, status, failure_reason, mentions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [convId, m.direction, m.channel, m.subject || null, m.body, m.senderId || null, m.status || 'sent', m.failure || null, m.mentions || []],
  );
  return rows[0];
}

/**
 * Staff send a message on a channel (email or in-app), or leave an internal note (channel
 * 'internal', never sent to the person; people mentioned are told). A reply closes nothing; the
 * conversation stays open until someone marks it done.
 */
export async function sendMessage(args: { conversationId: string; businessId: string; userId: string; channel: InboxChannel | 'internal'; subject?: string; body: string; mentions?: string[] }) {
  const body = (args.body || '').trim();
  if (!body) throw new InboxError('Write a message first');
  const conv = await getConversation(args.conversationId, args.businessId);
  if (!conv) throw new InboxError('Conversation not found', 404, 'NOT_FOUND');
  const person = conv.person;
  if (!person || ['anonymized', 'merged', 'archived'].includes(person.status)) throw new InboxError('This person can no longer be contacted');

  if (args.channel === 'internal') {
    const note = await addMessage(conv.id, { direction: 'note', channel: 'internal', body, senderId: args.userId, mentions: args.mentions || [] });
    if (args.mentions?.length) {
      await notify(args.businessId, 'mentioned', { title: `You were mentioned about ${person.name}`, body: preview(body), link: `/inbox?c=${conv.id}`, to: args.mentions, actorId: args.userId });
    }
    return note;
  }
  if (!CONNECTED_CHANNELS.includes(args.channel)) throw new InboxError(`${args.channel === 'sms' ? 'SMS' : 'WhatsApp'} is not connected yet`);
  if (args.channel === 'email' && !person.email) throw new InboxError('This person has no email address');
  if (args.channel === 'email' && !args.subject?.trim()) throw new InboxError('An email needs a subject');

  let status = 'sent'; let failure: string | null = null;
  if (args.channel === 'email') {
    try {
      const { sendEmail } = await import('./email.service');
      await sendEmail({ to: person.email, subject: args.subject!.trim(), text: body, html: body.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('') });
    } catch (e: any) {
      status = 'failed'; failure = e?.message || 'The email could not be sent';
    }
  }
  const msg = await addMessage(conv.id, { direction: 'out', channel: args.channel, subject: args.subject?.trim() || null, body, senderId: args.userId, status, failure });
  await adminPool.query(
    `UPDATE inbox_conversations SET last_message_at = NOW(), last_outbound_at = NOW(), last_preview = $2, last_channel = $3, unread = false, reminded_at = NULL, updated_at = NOW() WHERE id = $1`,
    [conv.id, preview(body), args.channel],
  );
  await adminPool.query(`UPDATE cus_customers SET last_activity_at = NOW() WHERE id = $1`, [person.id]);
  if (status === 'failed') {
    await notify(args.businessId, 'delivery_failed', { title: `A message to ${person.name} was not delivered`, body: failure || '', link: `/inbox?c=${conv.id}`, actorId: null });
  }
  return msg;
}

/**
 * A message from the person (in-app from the portal today; email, SMS and WhatsApp when inbound
 * handling is connected). It reopens the conversation and marks it unread; staff are told.
 */
export async function receiveMessage(args: { businessId: string; customerId: string; channel: InboxChannel; subject?: string; body: string; newLead?: boolean }) {
  const body = (args.body || '').trim();
  if (!body) throw new InboxError('Write a message first');
  const conv = await conversationFor(args.businessId, args.customerId);
  const msg = await addMessage(conv.id, { direction: 'in', channel: args.channel, subject: args.subject || null, body, status: 'received' });
  const { rows } = await adminPool.query(
    `UPDATE inbox_conversations SET status = 'open', unread = true, last_message_at = NOW(), last_inbound_at = NOW(), last_preview = $2, last_channel = $3, updated_at = NOW()
      WHERE id = $1 RETURNING assignee_user_id`,
    [conv.id, preview(body), args.channel],
  );
  await adminPool.query(`UPDATE cus_customers SET last_activity_at = NOW() WHERE id = $1`, [args.customerId]);
  const person = await personContext(args.customerId, args.businessId);
  const name = person?.name || 'Someone';
  const link = `/inbox?c=${conv.id}`;
  const assignee = rows[0]?.assignee_user_id;
  if (args.newLead) await notify(args.businessId, 'new_lead', { title: `New lead: ${name}`, body: preview(body), link });
  else if (assignee) await notify(args.businessId, 'assigned_message', { title: `New message from ${name}`, body: preview(body), link, to: [assignee] });
  else await notify(args.businessId, 'new_unassigned', { title: `New message from ${name}`, body: preview(body), link });
  return msg;
}

/** Something the system sent the person (a booking email, a campaign): shown in the thread, collapsed; it marks nothing unread. */
export async function recordAutomatic(args: { businessId: string; customerId: string; channel: InboxChannel; subject?: string; body: string }) {
  try {
    const conv = await conversationFor(args.businessId, args.customerId);
    await addMessage(conv.id, { direction: 'auto', channel: args.channel, subject: args.subject || null, body: args.body || args.subject || '' });
    await adminPool.query(
      `UPDATE inbox_conversations SET last_message_at = COALESCE(last_message_at, NOW()), last_outbound_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conv.id],
    );
  } catch (e: any) {
    logger.warn(`Automatic message not recorded for ${args.customerId}: ${e?.message || e}`);
  }
}

export async function assign(id: string, businessId: string, assigneeId: string | null, actorId: string) {
  const conv = await getConversation(id, businessId);
  if (!conv) throw new InboxError('Conversation not found', 404, 'NOT_FOUND');
  if (assigneeId) {
    const users = await businessUsers(businessId);
    const u = users.find((x) => x.id === assigneeId);
    if (!u || u.inboxRole === 'staff') throw new InboxError('Choose someone who uses the Inbox');
  }
  await adminPool.query(`UPDATE inbox_conversations SET assignee_user_id = $2, updated_at = NOW() WHERE id = $1`, [id, assigneeId]);
  const assigneeName = assigneeId ? (await adminPool.query(`SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS n FROM usr_users WHERE id = $1`, [assigneeId])).rows[0]?.n : null;
  await addMessage(id, { direction: 'event', channel: 'internal', body: assigneeId ? `Assigned to ${assigneeName}` : 'Unassigned', senderId: actorId });
  if (assigneeId) await notify(businessId, 'assigned_to_me', { title: `${conv.person?.name || 'A conversation'} was assigned to you`, link: `/inbox?c=${id}`, to: [assigneeId], actorId });
  return getConversation(id, businessId);
}

export async function setStatus(id: string, businessId: string, status: 'open' | 'closed', actorId: string) {
  const { rowCount } = await adminPool.query(`UPDATE inbox_conversations SET status = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`, [id, businessId, status]);
  if (!rowCount) throw new InboxError('Conversation not found', 404, 'NOT_FOUND');
  await addMessage(id, { direction: 'event', channel: 'internal', body: status === 'closed' ? 'Marked done' : 'Reopened', senderId: actorId });
  return getConversation(id, businessId);
}

export async function setUnread(id: string, businessId: string, unread: boolean) {
  await adminPool.query(`UPDATE inbox_conversations SET unread = $3 WHERE id = $1 AND business_id = $2`, [id, businessId, unread]);
}

/** Staff who can be assigned or mentioned (Inbox roles only). */
export async function inboxUsers(businessId: string) {
  return (await businessUsers(businessId)).filter((u) => u.inboxRole !== 'staff')
    .map((u) => ({ id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email, role: u.inboxRole }));
}

// ---------------------------------------------------------------------------------------------
// Customer portal (in-app messages)
// ---------------------------------------------------------------------------------------------

/** The customer's own thread with the business: no internal notes, no assignment events. */
export async function customerThread(businessId: string, customerId: string) {
  const { rows } = await adminPool.query(`SELECT id FROM inbox_conversations WHERE business_id = $1 AND customer_id = $2`, [businessId, customerId]);
  if (!rows[0]) return [];
  const { rows: msgs } = await adminPool.query(
    `SELECT m.id, m.direction, m.channel, m.subject, m.body, m.created_at, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS sender_name
       FROM inbox_messages m LEFT JOIN usr_users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = $1 AND m.direction IN ('in', 'out') AND m.channel = 'in_app' ORDER BY m.created_at`,
    [rows[0].id],
  );
  return msgs;
}

// ---------------------------------------------------------------------------------------------
// Staff notifications (the bell)
// ---------------------------------------------------------------------------------------------

export async function myNotifications(userId: string) {
  const { rows } = await adminPool.query(
    `SELECT id, type, title, body, link, read_at, created_at FROM usr_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [userId],
  );
  const { rows: c } = await adminPool.query(`SELECT COUNT(*)::int AS n FROM usr_notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return { notifications: rows, unread: c[0].n };
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  await adminPool.query(
    `UPDATE usr_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL ${ids?.length ? 'AND id = ANY($2::uuid[])' : ''}`,
    ids?.length ? [userId, ids] : [userId],
  );
}

// ---------------------------------------------------------------------------------------------
// Reminders (platform job every 15 minutes)
// ---------------------------------------------------------------------------------------------

/**
 * Unanswered conversations (the person wrote last, more than X hours ago, still open) are reported
 * once to the roles that get "unanswered"; and once a day after 08:00 business time, a summary of
 * open, unassigned and overdue conversations.
 */
export async function runReminders(now = new Date()) {
  let unanswered = 0; let summaries = 0;
  const { rows: businesses } = await adminPool.query(
    `SELECT DISTINCT b.id, COALESCE(b.timezone, 'UTC') AS tz FROM inbox_conversations ic JOIN sys_businesses b ON b.id = ic.business_id WHERE ic.status = 'open'`,
  );
  for (const b of businesses) {
    const { unanswered_hours: hours } = await getNotificationSettings(b.id);
    const { rows: late } = await adminPool.query(
      `UPDATE inbox_conversations ic SET reminded_at = NOW()
         FROM cus_customers c
        WHERE c.id = ic.customer_id AND ic.business_id = $1 AND ic.status = 'open' AND ic.reminded_at IS NULL
          AND ic.last_inbound_at IS NOT NULL AND (ic.last_outbound_at IS NULL OR ic.last_outbound_at < ic.last_inbound_at)
          AND ic.last_inbound_at < $2::timestamptz - make_interval(hours => $3::int)
        RETURNING ic.id, c.first_name, c.last_name, c.email`,
      [b.id, now.toISOString(), hours],
    );
    for (const x of late) {
      await notify(b.id, 'unanswered', { title: `${personName(x)} has waited more than ${hours} hours for an answer`, link: `/inbox?c=${x.id}` });
      unanswered++;
    }
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: b.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const part = (t: string) => local.find((p) => p.type === t)?.value || '';
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    if (Number(part('hour')) >= 8) {
      const { rowCount } = await adminPool.query(`INSERT INTO inbox_summary_log (business_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [b.id, day]);
      if (rowCount) {
        const { rows: c } = await adminPool.query(
          `SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE assignee_user_id IS NULL)::int AS unassigned,
                  COUNT(*) FILTER (WHERE last_inbound_at IS NOT NULL AND (last_outbound_at IS NULL OR last_outbound_at < last_inbound_at))::int AS waiting
             FROM inbox_conversations WHERE business_id = $1 AND status = 'open' AND last_message_at IS NOT NULL`,
          [b.id],
        );
        if (c[0].open > 0) {
          await notify(b.id, 'daily_summary', { title: `Inbox today: ${c[0].open} open, ${c[0].unassigned} unassigned, ${c[0].waiting} waiting for an answer`, link: '/inbox' });
          summaries++;
        }
      }
    }
  }
  return { unanswered, summaries };
}
