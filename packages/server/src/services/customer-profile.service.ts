import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { storage } from './storage.service';
import { createActivity } from './customer-activity.service';
import { canContact } from './contactability.service';
import { queueNotification } from './booking-notifications.service';

/**
 * Customer profile (Linear THE-16): the figures, Timeline, referrals, reviews, tasks,
 * documents, photo and "send personal data" behind the redesigned People profile.
 *
 * Every function takes the business and checks the person belongs to it, so an id from
 * another business is "not found". Files are stored under the storage root's private/
 * prefix, which the public /storage route refuses to serve.
 */

export class ProfileError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

interface PersonRow { id: string; tenant_id: string; business_id: string; email: string | null; first_name: string; last_name: string; user_id: string | null; status: string }

async function person(customerId: string, businessId: string): Promise<PersonRow> {
  const { rows } = await adminPool.query(
    `SELECT id, tenant_id, business_id, email, first_name, last_name, user_id, status
       FROM cus_customers WHERE id = $1 AND business_id = $2`,
    [customerId, businessId],
  );
  if (!rows[0]) throw new ProfileError('Person not found', 'NOT_FOUND');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Figures: visits, appointments, events, session credits
// ---------------------------------------------------------------------------

export async function getFigures(customerId: string, businessId: string) {
  await person(customerId, businessId);
  const { rows } = await adminPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM apt_bookings
         WHERE customer_id = $1 AND business_id = $2 AND status IN ('checked_in', 'in_progress', 'completed')) AS appointments,
       (SELECT COUNT(*)::int FROM evt_registrations r JOIN evt_events e ON e.id = r.event_id
         WHERE r.customer_id = $1 AND r.checked_in_at IS NOT NULL) AS events,
       (SELECT COALESCE(SUM(GREATEST(i.quantity - COALESCE((
            SELECT SUM(rd.quantity_redeemed) FROM pkg_redemptions rd
             WHERE rd.purchase_id = pp.id AND rd.package_item_id = i.id), 0), 0)), 0)::int
          FROM pkg_purchases pp JOIN pkg_package_items i ON i.package_id = pp.package_id
         WHERE pp.customer_id = $1 AND pp.business_id = $2 AND pp.status = 'active'
           AND (pp.expires_at IS NULL OR pp.expires_at > NOW())
           AND COALESCE(i.redemption_type, 'sessions') <> 'minutes') AS session_credits`,
    [customerId, businessId],
  );
  const r = rows[0];
  return { visits: r.appointments + r.events, appointments: r.appointments, events: r.events, session_credits: r.session_credits };
}

// ---------------------------------------------------------------------------
// Timeline: every interaction of the person with the business, in one list
// ---------------------------------------------------------------------------

export const TIMELINE_KINDS = ['booking', 'membership', 'pack', 'payment', 'lifecycle', 'profile_change', 'message'] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];

export interface TimelineItem {
  id: string;
  kind: string;
  description: string;
  actor_name: string;
  at: string;
  upcoming: boolean;
  /** What the line points at, so the screen can open it (an order's receipt, a payment). */
  link?: { type: 'order' | 'transaction'; id: string } | null;
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Card', cash: 'Cash', bank_transfer: 'Bank transfer', bank_draw: 'Direct debit', transfer: 'Transfer', check: 'Cheque',
  gift_card: 'Gift card', account_credit: 'Account credit', google_pay: 'Google Pay', apple_pay: 'Apple Pay', other: 'Other',
};

const CHANNEL_LABELS: Record<string, string> = { email: 'Email', sms: 'SMS', push: 'Notification', whatsapp: 'WhatsApp' };

const MESSAGE_LABELS: Record<string, string> = {
  'booking.confirmation': 'Booking confirmation', 'booking.cancellation': 'Booking cancellation',
  'booking.reschedule': 'Booking change', 'booking.reminder': 'Booking reminder',
  'payment.receipt': 'Payment receipt', 'charge.succeeded': 'Payment receipt', 'payment.refund_confirmation': 'Refund confirmation',
  'payment.credit_note': 'Credit note', 'invoice.issued': 'Invoice', 'invoice.paid': 'Invoice paid',
  'membership.payment_failed': 'Failed membership payment', 'gift_card.issued': 'Gift card',
  'customer.task_reminder': 'Task reminder', 'waitlist.offer': 'Waitlist offer',
  'event.registration_confirmed': 'Event registration', 'event.registration_reserved': 'Event place reserved',
  'event.registration_cancelled': 'Event registration cancelled',
};

function money(cents: number, currency: string) {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

/**
 * The Timeline for one person, newest first; items still to come (future bookings, the
 * next membership renewal) are marked `upcoming`. Payments come from the payment ledger
 * (one line each), packs from pack purchases and sessions used; the rest from the
 * activity log, messages from the emails and campaigns sent to the person.
 */
export async function getTimeline(customerId: string, businessId: string, kind?: string, limit = 100): Promise<TimelineItem[]> {
  await person(customerId, businessId);
  const want = (k: TimelineKind) => !kind || kind === 'all' || kind === k;
  const cap = Math.min(Math.max(limit, 1), 300);
  const items: TimelineItem[] = [];

  // Activity log (bookings, memberships, lifecycle, profile changes, and other activity on "All").
  // Payment activities are left out: the ledger below is the one line per payment.
  const logKinds = TIMELINE_KINDS.filter((k) => !['pack', 'payment', 'message'].includes(k) && want(k));
  if (logKinds.length > 0 || !kind || kind === 'all') {
    const allKinds = !kind || kind === 'all';
    const { rows } = await adminPool.query(
      `SELECT ca.id, ca.activity_type, ca.description, ca.created_at,
              CASE WHEN ca.created_by IS NULL THEN 'System'
                   ELSE COALESCE(NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), 'Unknown user') END AS actor_name
         FROM cus_activities ca LEFT JOIN usr_users u ON u.id = ca.created_by
        WHERE ca.customer_id = $1 AND ca.business_id = $2 AND ca.activity_type <> 'payment'
          AND ($3::boolean OR ca.activity_type = ANY($4::text[]))
        ORDER BY ca.created_at DESC LIMIT $5`,
      [customerId, businessId, allKinds, logKinds, cap],
    );
    for (const r of rows) {
      items.push({ id: `a-${r.id}`, kind: r.activity_type, description: r.description, actor_name: r.actor_name, at: r.created_at.toISOString(), upcoming: false });
    }
  }

  if (want('booking')) {
    const { rows } = await adminPool.query(
      `SELECT b.id, b.start_time, b.status, b.booking_reference, s.name AS service_name,
              NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS staff_name
         FROM apt_bookings b
         LEFT JOIN svc_services s ON s.id = b.service_id
         LEFT JOIN usr_users u ON u.id = b.staff_id
        WHERE b.customer_id = $1 AND b.business_id = $2 AND b.start_time > NOW()
          AND b.status IN ('pending', 'confirmed')
        ORDER BY b.start_time LIMIT 50`,
      [customerId, businessId],
    );
    for (const r of rows) {
      items.push({
        id: `b-${r.id}`, kind: 'booking',
        description: `Booked: ${r.service_name || 'appointment'}${r.staff_name ? ` with ${r.staff_name}` : ''}${r.booking_reference ? ` (${r.booking_reference})` : ''}`,
        actor_name: '—', at: r.start_time.toISOString(), upcoming: true,
      });
    }
  }

  if (want('membership')) {
    const { rows } = await adminPool.query(
      `SELECT e.id, e.next_billing_date, p.name, p.price
         FROM mbr_enrollments e JOIN mbr_plans p ON p.id = e.plan_id
        WHERE e.customer_id = $1 AND e.business_id = $2 AND e.status IN ('active', 'renewing')
          AND e.cancelled_at IS NULL AND e.next_billing_date IS NOT NULL AND e.next_billing_date >= CURRENT_DATE`,
      [customerId, businessId],
    );
    const { rows: biz } = await adminPool.query('SELECT currency FROM sys_businesses WHERE id = $1', [businessId]);
    for (const r of rows) {
      items.push({
        id: `m-${r.id}`, kind: 'membership',
        description: `Renewal due: ${r.name} · ${money(Number(r.price), biz[0]?.currency)}`,
        actor_name: 'System', at: new Date(r.next_billing_date).toISOString(), upcoming: true,
      });
    }
  }

  if (want('pack')) {
    const { rows: bought } = await adminPool.query(
      `SELECT pp.id, pp.purchased_at, pp.created_at, p.name FROM pkg_purchases pp JOIN pkg_packages p ON p.id = pp.package_id
        WHERE pp.customer_id = $1 AND pp.business_id = $2 ORDER BY pp.created_at DESC LIMIT $3`,
      [customerId, businessId, cap],
    );
    for (const r of bought) {
      items.push({ id: `p-${r.id}`, kind: 'pack', description: `Pack bought: ${r.name}`, actor_name: '—', at: (r.purchased_at || r.created_at).toISOString(), upcoming: false });
    }
    const { rows: used } = await adminPool.query(
      `SELECT rd.id, rd.redeemed_at, rd.quantity_redeemed, rd.minutes_redeemed, p.name
         FROM pkg_redemptions rd JOIN pkg_purchases pp ON pp.id = rd.purchase_id JOIN pkg_packages p ON p.id = pp.package_id
        WHERE pp.customer_id = $1 AND pp.business_id = $2 ORDER BY rd.redeemed_at DESC LIMIT $3`,
      [customerId, businessId, cap],
    );
    for (const r of used) {
      const amount = r.minutes_redeemed ? `${r.minutes_redeemed} min` : `${r.quantity_redeemed || 1} session${(r.quantity_redeemed || 1) === 1 ? '' : 's'}`;
      items.push({ id: `pr-${r.id}`, kind: 'pack', description: `Used from pack ${r.name}: ${amount}`, actor_name: '—', at: r.redeemed_at.toISOString(), upcoming: false });
    }
  }

  if (want('payment')) {
    const { rows } = await adminPool.query(
      `SELECT t.id, t.type, t.amount, t.currency, t.payment_method, t.card_last4, t.description, t.created_at, t.order_id,
              o.order_number,
              CASE WHEN t.processed_by IS NULL THEN 'System'
                   ELSE COALESCE(NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), 'Unknown user') END AS actor_name
         FROM pay_transactions t
         LEFT JOIN fin_orders o ON o.id = t.order_id
         LEFT JOIN usr_users u ON u.id = t.processed_by
        WHERE t.customer_id = $1 AND t.business_id = $2 AND t.status = 'completed'
        ORDER BY t.created_at DESC LIMIT $3`,
      [customerId, businessId, cap],
    );
    for (const r of rows) {
      const verb = r.type === 'refund' ? 'Refund' : r.type === 'credit' ? 'Credit' : r.type === 'debit' ? 'Debit' : 'Payment received';
      const method = METHOD_LABELS[r.payment_method] || r.payment_method;
      const card = r.card_last4 ? ` •••• ${r.card_last4}` : '';
      const what = r.description || (r.order_number ? `order ${r.order_number}` : '');
      items.push({
        id: `t-${r.id}`, kind: 'payment',
        description: `${verb} ${money(Math.abs(Number(r.amount)), r.currency)} · ${method}${card}${what ? ` · ${what}` : ''}`,
        actor_name: r.actor_name, at: r.created_at.toISOString(), upcoming: false,
        link: r.order_id ? { type: 'order', id: r.order_id } : { type: 'transaction', id: r.id },
      });
    }
  }

  if (want('message')) {
    // Messages sent to the person (David, THE-16): sent ones only, those of the same kind on
    // the same day (business local time) on one line. Received messages stay in the Messages tab.
    const { rows } = await adminPool.query(
      `WITH sent AS (
         SELECT q.type AS kind, q.channel, COALESCE(q.sent_at, q.created_at) AS at, NULL::text AS name
           FROM apt_notification_queue q
          WHERE q.recipient_id = $1 AND q.business_id = $2 AND q.status = 'sent'
         UNION ALL
         SELECT 'campaign', COALESCE(c.channel, 'email'), cr.sent_at, c.name
           FROM mkt_campaign_recipients cr JOIN mkt_campaigns c ON c.id = cr.campaign_id
          WHERE cr.customer_id = $1 AND c.business_id = $2 AND cr.sent_at IS NOT NULL
            AND cr.status IN ('sent', 'delivered', 'opened', 'clicked')
       )
       SELECT s.kind, s.channel, (s.at AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date::text AS day,
              MAX(s.at) AS at, COUNT(*)::int AS n, ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.name), NULL) AS names
         FROM sent s CROSS JOIN sys_businesses b WHERE b.id = $2
        GROUP BY s.kind, s.channel, day ORDER BY MAX(s.at) DESC LIMIT $3`,
      [customerId, businessId, cap],
    );
    for (const r of rows) {
      const channel = CHANNEL_LABELS[r.channel] || r.channel;
      const what = r.kind === 'campaign'
        ? `Campaign${r.names.length ? `: ${r.names.join(', ')}` : ''}`
        : MESSAGE_LABELS[r.kind] || r.kind;
      items.push({
        id: `msg-${r.kind}-${r.channel}-${r.day}`, kind: 'message',
        description: r.n === 1 ? `${channel} sent: ${what}` : `${r.n} ${channel.toLowerCase()}s sent: ${what}`,
        actor_name: 'System', at: r.at.toISOString(), upcoming: false,
      });
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, cap);
}

// ---------------------------------------------------------------------------
// Referrals and reviews
// ---------------------------------------------------------------------------

export async function getReferrals(customerId: string, businessId: string) {
  const p = await person(customerId, businessId);
  const { rows: codes } = await adminPool.query(
    `SELECT id, code, referrals_count, is_active FROM eng_referral_codes WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
    [customerId, p.tenant_id],
  );
  const { rows: referred } = await adminPool.query(
    `SELECT r.id, r.status, r.created_at, c.id AS customer_id, c.first_name, c.last_name, c.lifecycle_stage
       FROM eng_referrals r JOIN eng_referral_codes rc ON rc.id = r.referral_code_id
       JOIN cus_customers c ON c.id = r.referred_customer_id
      WHERE rc.customer_id = $1 AND rc.tenant_id = $2 ORDER BY r.created_at DESC`,
    [customerId, p.tenant_id],
  );
  const { rows: by } = await adminPool.query(
    `SELECT c.id AS customer_id, c.first_name, c.last_name, rc.code
       FROM eng_referrals r JOIN eng_referral_codes rc ON rc.id = r.referral_code_id
       JOIN cus_customers c ON c.id = rc.customer_id
      WHERE r.referred_customer_id = $1 AND rc.tenant_id = $2 LIMIT 1`,
    [customerId, p.tenant_id],
  );
  return { codes, referred, referred_by: by[0] || null };
}

export async function getReviews(customerId: string, businessId: string) {
  const p = await person(customerId, businessId);
  const { rows } = await adminPool.query(
    `SELECT r.id, r.rating, r.content, r.status, r.created_at, s.name AS service_name
       FROM eng_reviews r LEFT JOIN svc_services s ON s.id = r.service_id
      WHERE r.customer_id = $1 AND r.tenant_id = $2 ORDER BY r.created_at DESC`,
    [customerId, p.tenant_id],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskInput {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  staffIds: string[];
  sendReminder?: boolean;
  eventId?: string | null;
}

async function assertStaff(userIds: string[], tenantId: string) {
  if (userIds.length === 0) return;
  const { rows } = await adminPool.query(
    `SELECT id FROM usr_users WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND persona <> 'customer' AND status = 'active'`,
    [userIds, tenantId],
  );
  if (rows.length !== new Set(userIds).size) throw new ProfileError('Every assigned person must be an active staff member', 'INVALID_STAFF');
}

export async function listTasks(customerId: string, businessId: string) {
  await person(customerId, businessId);
  const { rows } = await adminPool.query(
    `SELECT t.*, e.title AS event_title, e.start_time AS event_start,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) ORDER BY u.first_name)
                        FROM cus_task_staff ts JOIN usr_users u ON u.id = ts.user_id WHERE ts.task_id = t.id), '[]') AS staff
       FROM cus_tasks t LEFT JOIN evt_events e ON e.id = t.event_id
      WHERE t.customer_id = $1 AND t.business_id = $2
      ORDER BY (t.status = 'done'), t.due_at NULLS LAST, t.created_at DESC`,
    [customerId, businessId],
  );
  return rows;
}

/**
 * Create a task. With `sendReminder`, the reminder email goes to the customer at once
 * (when the task is created), through the email queue, which respects their consent.
 */
export async function createTask(customerId: string, businessId: string, input: TaskInput, userId: string) {
  const p = await person(customerId, businessId);
  await assertStaff(input.staffIds, p.tenant_id);
  if (input.eventId) {
    const { rows } = await adminPool.query('SELECT id FROM evt_events WHERE id = $1 AND tenant_id = $2', [input.eventId, p.tenant_id]);
    if (!rows[0]) throw new ProfileError('Event not found', 'INVALID_EVENT');
  }
  const client = await adminPool.connect();
  let task: any;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO cus_tasks (tenant_id, business_id, customer_id, title, description, due_at, event_id, send_reminder, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [p.tenant_id, businessId, customerId, input.title.trim(), input.description || null, input.dueAt || null, input.eventId || null, !!input.sendReminder, userId],
    );
    task = rows[0];
    for (const staffId of new Set(input.staffIds)) {
      await client.query('INSERT INTO cus_task_staff (task_id, user_id) VALUES ($1, $2)', [task.id, staffId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (task.send_reminder) {
    const decision = await canContact(customerId, businessId, 'email', 'transactional');
    if (decision.allowed && decision.address) {
      await queueNotification({
        businessId, type: 'customer.task_reminder', channel: 'email', recipientId: customerId, recipientEmail: decision.address,
        data: { customer_name: `${p.first_name} ${p.last_name}`.trim(), task_title: task.title, task_description: task.description, due_at: task.due_at },
        scheduledFor: new Date(),
      });
      await adminPool.query('UPDATE cus_tasks SET reminder_queued_at = NOW() WHERE id = $1', [task.id]);
    } else {
      await adminPool.query('UPDATE cus_tasks SET reminder_skipped_reason = $2 WHERE id = $1', [task.id, decision.message || 'Cannot be emailed']);
    }
  }
  return (await listTasks(customerId, businessId)).find((t) => t.id === task.id);
}

export async function setTaskStatus(customerId: string, businessId: string, taskId: string, done: boolean, userId: string) {
  await person(customerId, businessId);
  const { rows } = await adminPool.query(
    `UPDATE cus_tasks SET status = $4::varchar, completed_at = CASE WHEN $4::varchar = 'done' THEN NOW() ELSE NULL END,
            completed_by = CASE WHEN $4::varchar = 'done' THEN $5::uuid ELSE NULL END, updated_at = NOW()
      WHERE id = $1 AND customer_id = $2 AND business_id = $3 RETURNING id`,
    [taskId, customerId, businessId, done ? 'done' : 'open', userId],
  );
  if (!rows[0]) throw new ProfileError('Task not found', 'NOT_FOUND');
  return (await listTasks(customerId, businessId)).find((t) => t.id === taskId);
}

export async function deleteTask(customerId: string, businessId: string, taskId: string) {
  const { rowCount } = await adminPool.query('DELETE FROM cus_tasks WHERE id = $1 AND customer_id = $2 AND business_id = $3', [taskId, customerId, businessId]);
  if (!rowCount) throw new ProfileError('Task not found', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Documents and photo (private storage)
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** File signatures, so a renamed file of another kind is refused. */
function looksLike(mime: string, data: Buffer): boolean {
  if (mime === 'application/pdf') return data.slice(0, 4).toString('latin1') === '%PDF';
  if (mime === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8;
  if (mime === 'image/png') return data.slice(1, 4).toString('latin1') === 'PNG';
  if (mime === 'image/webp') return data.slice(8, 12).toString('latin1') === 'WEBP';
  return false;
}

function safeName(name: string): string {
  return (name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
}

export async function listDocuments(customerId: string, businessId: string) {
  await person(customerId, businessId);
  const { rows } = await adminPool.query(
    `SELECT d.id, d.file_name, d.mime_type, d.size_bytes, d.created_at,
            NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS uploaded_by_name
       FROM cus_documents d LEFT JOIN usr_users u ON u.id = d.uploaded_by
      WHERE d.customer_id = $1 AND d.business_id = $2 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
    [customerId, businessId],
  );
  return rows;
}

export async function uploadDocument(customerId: string, businessId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, userId: string) {
  const p = await person(customerId, businessId);
  const ext = DOCUMENT_TYPES[file.mimetype];
  if (!ext || !looksLike(file.mimetype, file.buffer)) throw new ProfileError('Only PDF, JPG and PNG files can be uploaded', 'INVALID_FILE_TYPE');
  if (file.size > MAX_DOCUMENT_BYTES) throw new ProfileError('The file is larger than 10 MB', 'FILE_TOO_LARGE');
  const storagePath = `private/customer-documents/${businessId}/${customerId}/${crypto.randomUUID()}.${ext}`;
  await storage.save(storagePath, file.buffer);
  const { rows } = await adminPool.query(
    `INSERT INTO cus_documents (tenant_id, business_id, customer_id, file_name, mime_type, size_bytes, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, file_name, mime_type, size_bytes, created_at`,
    [p.tenant_id, businessId, customerId, safeName(file.originalname), file.mimetype, file.size, storagePath, userId],
  );
  await createActivity({ customerId, businessId, activityType: 'document', description: `Document added: ${rows[0].file_name}`, createdBy: userId });
  return rows[0];
}

export async function readDocument(customerId: string, businessId: string, documentId: string) {
  const { rows } = await adminPool.query(
    `SELECT file_name, mime_type, storage_path FROM cus_documents
      WHERE id = $1 AND customer_id = $2 AND business_id = $3 AND deleted_at IS NULL`,
    [documentId, customerId, businessId],
  );
  if (!rows[0]) throw new ProfileError('Document not found', 'NOT_FOUND');
  const data = await storage.read(rows[0].storage_path);
  if (!data) throw new ProfileError('The file is missing from storage', 'FILE_MISSING');
  return { fileName: rows[0].file_name as string, mimeType: rows[0].mime_type as string, data };
}

export async function deleteDocument(customerId: string, businessId: string, documentId: string, userId: string) {
  const { rows } = await adminPool.query(
    `UPDATE cus_documents SET deleted_at = NOW(), deleted_by = $4
      WHERE id = $1 AND customer_id = $2 AND business_id = $3 AND deleted_at IS NULL RETURNING file_name, storage_path`,
    [documentId, customerId, businessId, userId],
  );
  if (!rows[0]) throw new ProfileError('Document not found', 'NOT_FOUND');
  await storage.delete(rows[0].storage_path).catch((err) => logger.warn('Document file could not be removed', { err: String(err) }));
  await createActivity({ customerId, businessId, activityType: 'document', description: `Document deleted: ${rows[0].file_name}`, createdBy: userId });
}

export async function savePhoto(customerId: string, businessId: string, file: { mimetype: string; size: number; buffer: Buffer }, userId: string) {
  await person(customerId, businessId);
  const ext = PHOTO_TYPES[file.mimetype];
  if (!ext || !looksLike(file.mimetype, file.buffer)) throw new ProfileError('The photo must be a JPG, PNG or WebP image', 'INVALID_FILE_TYPE');
  if (file.size > MAX_PHOTO_BYTES) throw new ProfileError('The photo is larger than 5 MB', 'FILE_TOO_LARGE');
  const { rows: old } = await adminPool.query('SELECT photo_path FROM cus_customers WHERE id = $1', [customerId]);
  const storagePath = `private/customer-photos/${businessId}/${customerId}/${crypto.randomUUID()}.${ext}`;
  await storage.save(storagePath, file.buffer);
  await adminPool.query('UPDATE cus_customers SET photo_path = $2, updated_at = NOW() WHERE id = $1', [customerId, storagePath]);
  if (old[0]?.photo_path) await storage.delete(old[0].photo_path).catch(() => {});
  await createActivity({ customerId, businessId, activityType: 'profile_change', description: 'Photo changed', createdBy: userId });
}

export async function readPhoto(customerId: string, businessId: string) {
  const { rows } = await adminPool.query('SELECT photo_path FROM cus_customers WHERE id = $1 AND business_id = $2', [customerId, businessId]);
  if (!rows[0]?.photo_path) throw new ProfileError('No photo', 'NOT_FOUND');
  const data = await storage.read(rows[0].photo_path);
  if (!data) throw new ProfileError('No photo', 'NOT_FOUND');
  const ext = rows[0].photo_path.split('.').pop();
  return { data, mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

export async function deletePhoto(customerId: string, businessId: string, userId: string) {
  const { rows } = await adminPool.query(
    'UPDATE cus_customers c SET photo_path = NULL, updated_at = NOW() FROM (SELECT photo_path FROM cus_customers WHERE id = $1) old WHERE c.id = $1 AND c.business_id = $2 RETURNING old.photo_path',
    [customerId, businessId],
  );
  if (!rows[0]) throw new ProfileError('Person not found', 'NOT_FOUND');
  if (rows[0].photo_path) await storage.delete(rows[0].photo_path).catch(() => {});
  await createActivity({ customerId, businessId, activityType: 'profile_change', description: 'Photo removed', createdBy: userId });
}

// ---------------------------------------------------------------------------
// Password reset requested by staff
// ---------------------------------------------------------------------------

export async function requestPasswordReset(customerId: string, businessId: string, userId: string) {
  const p = await person(customerId, businessId);
  if (!p.user_id) throw new ProfileError('This person has no account to reset', 'NO_ACCOUNT');
  const { rows } = await adminPool.query(`SELECT id, email, status FROM usr_users WHERE id = $1`, [p.user_id]);
  const user = rows[0];
  if (!user || user.status !== 'active') throw new ProfileError('This person\'s account is not active', 'NO_ACCOUNT');
  const { createPasswordResetToken } = await import('./auth.service');
  const { sendPasswordResetEmail } = await import('./email.service');
  const token = await createPasswordResetToken(user.id);
  await sendPasswordResetEmail(user.email, token);
  await createActivity({ customerId, businessId, activityType: 'profile_change', description: `Password reset link sent to ${user.email}`, createdBy: userId });
  return { sent_to: user.email };
}

// ---------------------------------------------------------------------------
// Send personal data (GDPR): a password-protected PDF behind an emailed 24-hour link
// ---------------------------------------------------------------------------

export const EXPORT_VALID_HOURS = 24;

/** A readable password (no 0/O, 1/l/I), shown once to the staff member who sends the data. */
function newPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

async function gatherPersonalData(customerId: string, businessId: string) {
  const { exportGDPR } = await import('./customer-import.service');
  const base: any = await exportGDPR(customerId, businessId);
  const q = async (sql: string) => (await adminPool.query(sql, [customerId, businessId])).rows;
  const [cust] = await q(`SELECT c.address_line, c.city, c.postal_code, c.region, l.name AS home_location
                            FROM cus_customers c LEFT JOIN sys_locations l ON l.id = c.home_location_id WHERE c.id = $1 AND c.business_id = $2`);
  return {
    ...base,
    address: cust,
    bookings: await q(`SELECT b.booking_reference, b.start_time, b.status, s.name AS service FROM apt_bookings b LEFT JOIN svc_services s ON s.id = b.service_id
                        WHERE b.customer_id = $1 AND b.business_id = $2 ORDER BY b.start_time DESC`),
    payments: await q(`SELECT created_at, type, amount, currency, payment_method, reference_number, description FROM pay_transactions
                        WHERE customer_id = $1 AND business_id = $2 AND status = 'completed' ORDER BY created_at DESC`),
    memberships: await q(`SELECT p.name, e.status, e.start_date, e.cancelled_at FROM mbr_enrollments e JOIN mbr_plans p ON p.id = e.plan_id
                           WHERE e.customer_id = $1 AND e.business_id = $2 ORDER BY e.start_date DESC`),
    documents: await q(`SELECT file_name, created_at FROM cus_documents WHERE customer_id = $1 AND business_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`),
    tasks: await q(`SELECT title, status, due_at, created_at FROM cus_tasks WHERE customer_id = $1 AND business_id = $2 ORDER BY created_at DESC`),
  };
}

function renderPersonalDataPdf(data: any, businessName: string, password: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 50,
      userPassword: password,
      ownerPassword: crypto.randomBytes(16).toString('hex'),
      permissions: { printing: 'highResolution', copying: true, modifying: false },
      info: { Title: 'Personal data', Author: businessName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const value = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v instanceof Date ? v.toISOString() : String(v));
    doc.fontSize(18).text('Your personal data', { underline: false });
    doc.moveDown(0.3).fontSize(10).fillColor('#4F596D').text(`${businessName} · produced ${new Date().toISOString().slice(0, 10)}`).fillColor('#000000');
    const section = (title: string, body: unknown) => {
      doc.moveDown(1).fontSize(13).text(title);
      doc.moveDown(0.3).fontSize(9);
      if (Array.isArray(body)) {
        if (body.length === 0) { doc.text('None'); return; }
        for (const row of body) doc.text(Object.entries(row).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${value(v)}`).join('  ·  ')).moveDown(0.2);
      } else if (body && typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) doc.text(`${k.replace(/_/g, ' ')}: ${typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : value(v)}`);
      } else doc.text(value(body));
    };
    section('Personal details', data.personal_data);
    section('Address', data.address);
    for (const key of Object.keys(data).filter((k) => !['export_date', 'format', 'personal_data', 'address'].includes(k))) {
      section(key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), data[key]);
    }
    doc.end();
  });
}

/**
 * Build the file, store it privately, email the person a link valid for 24 hours, and
 * return the file's password once, for the staff member to pass on however they choose.
 */
export async function sendPersonalData(customerId: string, businessId: string, userId: string, ip?: string) {
  const p = await person(customerId, businessId);
  if (!p.email) throw new ProfileError('This person has no email address to send the link to', 'NO_EMAIL');
  if (p.status === 'anonymized') throw new ProfileError('This person has been anonymised', 'ANONYMIZED');
  const { rows: biz } = await adminPool.query('SELECT name FROM sys_businesses WHERE id = $1', [businessId]);
  const password = newPassword();
  const pdf = await renderPersonalDataPdf(await gatherPersonalData(customerId, businessId), biz[0]?.name || 'DayStream', password);
  const storagePath = `private/data-exports/${businessId}/${crypto.randomUUID()}.pdf`;
  await storage.save(storagePath, pdf);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await adminPool.query(
    `INSERT INTO cus_data_exports (tenant_id, business_id, customer_id, token_hash, storage_path, sent_to, expires_at, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${EXPORT_VALID_HOURS} hours', $7) RETURNING id, expires_at`,
    [p.tenant_id, businessId, customerId, tokenHash, storagePath, p.email, userId],
  );
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:4000';
  const link = `${baseUrl}/personal-data?token=${token}`;
  const { sendEmail } = await import('./email.service');
  await sendEmail({
    to: p.email,
    subject: `${biz[0]?.name || 'DayStream'} — your personal data`,
    html: `<p>Hi ${String(p.first_name || '').replace(/[<>&"]/g, '')},</p>
           <p>As requested, here is a file with the personal data ${String(biz[0]?.name || '').replace(/[<>&"]/g, '')} keeps about you.</p>
           <p><a href="${link}">Download your personal data</a></p>
           <p>The link works for ${EXPORT_VALID_HOURS} hours. The file is protected with a password, which the business gives you separately.</p>`,
    text: `As requested, here is a file with the personal data kept about you: ${link}\n\nThe link works for ${EXPORT_VALID_HOURS} hours. The file is protected with a password, which the business gives you separately.`,
  });
  const { logAudit } = await import('./audit.service');
  await logAudit({ tenantId: p.tenant_id, userId, action: 'customer.personal_data_sent', resourceType: 'customer', resourceId: customerId, details: { sent_to: p.email, export_id: rows[0].id }, ipAddress: ip } as any);
  await createActivity({ customerId, businessId, activityType: 'profile_change', description: `Personal data sent to ${p.email} (link valid ${EXPORT_VALID_HOURS} hours)`, createdBy: userId });
  return { sent_to: p.email, expires_at: rows[0].expires_at, password };
}

/** The file behind an emailed link, while the link is valid. Public: the token is the key. */
export async function downloadPersonalData(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token || '')) throw new ProfileError('This link is not valid', 'INVALID_LINK');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await adminPool.query(
    `UPDATE cus_data_exports SET downloaded_at = COALESCE(downloaded_at, NOW()), download_count = download_count + 1
      WHERE token_hash = $1 AND expires_at > NOW() RETURNING storage_path`,
    [tokenHash],
  );
  if (!rows[0]) throw new ProfileError('This link has expired or is not valid. Ask the business to send it again.', 'INVALID_LINK');
  const data = await storage.read(rows[0].storage_path);
  if (!data) throw new ProfileError('The file is no longer available. Ask the business to send it again.', 'INVALID_LINK');
  return data;
}
