import { canContact } from './contactability.service';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { isKnownArtifactType } from '@daystream/shared';
import { resolveArtifactKey, resolveAndRender } from './document-branding-resolver.service';
import { sendEmail as sendEmailTransport } from './email.service';

interface NotificationData {
  businessId: string;
  type: string;
  channel?: string;
  recipientId: string;
  recipientEmail?: string;
  data: Record<string, unknown>;
  scheduledFor?: Date;
}

/**
 * Queue a notification for async delivery.
 */
export async function queueNotification(input: NotificationData): Promise<any> {
  const { rows } = await adminPool.query(
    `INSERT INTO apt_notification_queue (business_id, type, channel, recipient_id, recipient_email, data, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.businessId,
      input.type,
      input.channel || 'email',
      input.recipientId,
      input.recipientEmail || null,
      JSON.stringify(input.data),
      input.scheduledFor ? input.scheduledFor.toISOString() : new Date().toISOString(),
    ],
  );
  return rows[0];
}

/**
 * Queue a booking confirmation notification.
 */
export async function queueBookingConfirmation(booking: any, customerEmail: string): Promise<void> {
  await queueNotification({
    businessId: booking.business_id,
    type: 'booking.confirmation',
    recipientId: booking.customer_id,
    recipientEmail: customerEmail,
    data: {
      booking_reference: booking.booking_reference,
      service_name: booking.service_name || '',
      variant_name: booking.variant_name || '',
      start_time: booking.start_time,
      end_time: booking.end_time,
      staff_name: booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name}`.trim() : null,
      price: booking.price,
      // Recipient identity + the Appointment template's tokens. The resolver maps
      // appointment_date/appointment_time from start_time; customer fields come
      // from the hydrated booking (getBookingById joins the customer).
      customer_name: [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ').trim() || null,
      customer_email: booking.customer_email || customerEmail || null,
    },
  });
}

/**
 * Queue a booking cancellation notification.
 */
export async function queueBookingCancellation(booking: any, customerEmail: string, reason?: string): Promise<void> {
  await queueNotification({
    businessId: booking.business_id,
    type: 'booking.cancellation',
    recipientId: booking.customer_id,
    recipientEmail: customerEmail,
    data: {
      booking_reference: booking.booking_reference,
      service_name: booking.service_name || '',
      start_time: booking.start_time,
      reason: reason || 'Cancelled',
    },
  });
}

/**
 * Queue a booking reschedule notification.
 */
export async function queueBookingReschedule(booking: any, customerEmail: string, oldStartTime: string): Promise<void> {
  await queueNotification({
    businessId: booking.business_id,
    type: 'booking.reschedule',
    recipientId: booking.customer_id,
    recipientEmail: customerEmail,
    data: {
      booking_reference: booking.booking_reference,
      service_name: booking.service_name || '',
      old_start_time: oldStartTime,
      new_start_time: booking.start_time,
    },
  });
}

/**
 * Queue booking reminder(s).
 */
export async function queueBookingReminder(booking: any, customerEmail: string, hoursBeforeList: number[]): Promise<void> {
  const startTime = new Date(booking.start_time);

  // A reminder is not sent to someone who switched reminders off, has no usable email, or is
  // archived / merged (Phase 46 R10). Confirmations and cancellations are not affected.
  if (booking.customer_id && booking.business_id) {
    const decision = await canContact(booking.customer_id, booking.business_id, 'email', 'transactional', { reminder: true });
    if (!decision.allowed) {
      logger.info('Booking reminder not queued', { booking: booking.booking_reference, reason: decision.reason });
      return;
    }
  }

  for (const hoursBefore of hoursBeforeList) {
    const scheduledFor = new Date(startTime.getTime() - hoursBefore * 60 * 60 * 1000);

    // Only queue if scheduled time is in the future
    if (scheduledFor <= new Date()) continue;

    await queueNotification({
      businessId: booking.business_id,
      type: 'booking.reminder',
      recipientId: booking.customer_id,
      recipientEmail: customerEmail,
      data: {
        booking_reference: booking.booking_reference,
        service_name: booking.service_name || '',
        start_time: booking.start_time,
        staff_name: booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name}` : null,
        hours_before: hoursBefore,
      },
      scheduledFor,
    });
  }
}

/**
 * Queue a waitlist promotion notification.
 */
export async function queueWaitlistPromotion(entry: any, customerEmail: string, expiresAt: string): Promise<void> {
  await queueNotification({
    businessId: entry.business_id,
    type: 'waitlist.promotion',
    recipientId: entry.customer_id,
    recipientEmail: customerEmail,
    data: {
      service_id: entry.service_id,
      slot_start_time: entry.slot_start_time,
      expires_at: expiresAt,
      position: entry.position,
    },
  });
}

/**
 * Process pending notifications that are due for delivery.
 */
const MAX_ATTEMPTS = 4;
const STALE_CLAIM_MS = 5 * 60 * 1000;   // reclaim a crashed worker's rows after 5 min
const WORKER_ID = `mail-${process.pid}`;

/**
 * Drain the notification queue (the single system-email dispatch path).
 *
 * Multi-instance safe: due rows are claimed atomically by flipping to 'processing'
 * with FOR UPDATE SKIP LOCKED, so parallel workers never grab the same row. Stale
 * 'processing' rows (a crashed worker) are reclaimed after STALE_CLAIM_MS.
 *
 * Rate-limited: honours the platform-wide per-hour ceiling from the Email Server
 * config. The batch size for this run is min(remaining-this-hour, hard cap), so a
 * burst drains steadily and never exceeds the relay's ceiling. 0 = unlimited.
 *
 * Retry with backoff: a failed send goes back to 'pending' with next_attempt_at
 * pushed out (exponential), up to MAX_ATTEMPTS, then 'failed'.
 */
export async function processNotificationQueue(): Promise<{ sent: number; failed: number }> {
  const { getRateLimitPerHour } = await import('./email.service');
  const limit = await getRateLimitPerHour();

  // How many we may still send this rolling hour (when a limit is set).
  let batchCap = 50;   // hard per-cycle cap regardless of rate limit
  if (limit > 0) {
    const { rows: sentRows } = await adminPool.query(
      `SELECT COUNT(*)::int AS n FROM apt_notification_queue
        WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '1 hour'`,
    );
    const remaining = Math.max(0, limit - sentRows[0].n);
    if (remaining === 0) {
      logger.info('Notification queue: hourly rate limit reached; deferring', { limit });
      return { sent: 0, failed: 0 };
    }
    batchCap = Math.min(batchCap, remaining);
  }

  // Claim a batch atomically: pending + due (or retry-due) rows → 'processing'.
  // Also reclaim rows stuck in 'processing' past the stale window.
  const { rows: claimed } = await adminPool.query(
    `UPDATE apt_notification_queue
     SET status = 'processing', claimed_at = NOW(), claimed_by = $1
     WHERE id IN (
       SELECT id FROM apt_notification_queue
       WHERE (
         (status = 'pending' AND scheduled_for <= NOW()
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
         OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '${STALE_CLAIM_MS} milliseconds')
       )
       ORDER BY scheduled_for
       LIMIT ${batchCap}
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [WORKER_ID],
  );

  let sent = 0;
  let failed = 0;

  for (const notification of claimed) {
    try {
      if (notification.channel === 'email') {
        await sendEmail(notification);
      }
      await adminPool.query(
        `UPDATE apt_notification_queue
         SET status = 'sent', sent_at = NOW(), claimed_at = NULL, claimed_by = NULL WHERE id = $1`,
        [notification.id],
      );
      sent++;
    } catch (err: any) {
      const attempts = (notification.attempts ?? 0) + 1;
      const backoffMin = Math.min(60, 2 ** attempts);   // 2,4,8,16… minutes, capped
      await adminPool.query(
        `UPDATE apt_notification_queue
         SET status = CASE WHEN $2 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
             attempts = $2, error = $3,
             next_attempt_at = NOW() + INTERVAL '${1} minute' * $4,
             claimed_at = NULL, claimed_by = NULL
         WHERE id = $1`,
        [notification.id, attempts, String(err?.message || err), backoffMin],
      );
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    logger.info('Notification queue processed', { sent, failed, claimed: claimed.length });
  }

  return { sent, failed };
}

/**
 * Send an email notification.
 *
 * For BRANDED customer-facing payment artifacts (invoice.issued, payment.receipt,
 * and the rest of the document-branding catalog — plus aliased types like
 * invoice.paid), this resolves the business's template, renders a branded HTML
 * email, and sends it through the real transport. The resolver falls back to a
 * platform-default render when the business has no template, so mail still goes
 * out either way.
 *
 * Non-branded types (booking.*, etc.) keep the prior log-only behavior — a
 * dedicated email engine (next planned work) will own those; this change
 * deliberately does not start sending booking mail that wasn't sent before.
 */
async function sendEmail(notification: any): Promise<void> {
  const type: string = notification.type;
  const artifactKey = resolveArtifactKey(type);

  const recipient: string | null = notification.recipient_email || null;
  if (!recipient) {
    logger.warn('Notification has no recipient email; skipping', { type, id: notification.id });
    return;
  }

  // `data` is JSON — parsed object (jsonb) or string (text column). Handle both.
  let data: Record<string, unknown> = {};
  try {
    data = typeof notification.data === 'string' ? JSON.parse(notification.data) : (notification.data ?? {});
  } catch { data = {}; }

  if (isKnownArtifactType(artifactKey)) {
    // Branded catalog document — resolve the business's template and render it.
    // Build the {{details_table}} line-item table from the queued data so the
    // email draws it where the marker sits (receipt/invoice/adjustment).
    const language = typeof data.language === 'string' ? data.language : null;
    const { buildDetailsTableForNotification } = await import('./document-send.service');
    const detailsTable = await buildDetailsTableForNotification(notification.business_id, type, data).catch(() => null);
    const rendered = await resolveAndRender(notification.business_id, type, data, language, detailsTable);
    await sendEmailTransport({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(rendered.senderName ? { from: rendered.senderName } : {}),
      ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
    });
    logger.info('Branded document email sent', { type, recipient });
    return;
  }

  // Non-catalog type (e.g. booking.reminder/.reschedule/.cancellation) — send a
  // clean default email so it is actually delivered rather than only logged.
  // (A branded template for these can be added to the catalog later.)
  const rendered = renderDefaultEmail(type, data);
  await sendEmailTransport({ to: recipient, subject: rendered.subject, html: rendered.html, text: rendered.text });
  logger.info('Default email sent', { type, recipient });
}

/**
 * Minimal, safe default email for notification types that don't (yet) have a
 * branded catalog template. Produces a plain, readable message from the queued
 * data so transactional mail still goes out. HTML-escaped throughout.
 */
function renderDefaultEmail(type: string, data: Record<string, unknown>): { subject: string; html: string; text: string } {
  const esc = (s: unknown): string => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const titles: Record<string, string> = {
    'booking.confirmation': 'Your appointment is confirmed',
    'booking.reschedule': 'Your appointment has been rescheduled',
    'booking.cancellation': 'Your appointment has been cancelled',
    'booking.reminder': 'Appointment reminder',
  };
  const subject = titles[type] || 'Notification';
  const name = esc((data.customer_name as string) || '').split(' ')[0] || 'there';
  const service = esc(data.service_name);
  const when = data.start_time ? new Date(String(data.start_time)).toLocaleString() : '';
  const lines: string[] = [`<p>Hi ${name},</p>`, `<p>${esc(subject)}.</p>`];
  if (service) lines.push(`<p>Service: ${service}</p>`);
  if (when) lines.push(`<p>When: ${esc(when)}</p>`);
  if (data.booking_reference) lines.push(`<p>Reference: ${esc(data.booking_reference)}</p>`);
  const html = lines.join('\n');
  const text = lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n');
  return { subject, html, text };
}

/**
 * Generate an iCal (.ics) string for a booking.
 */
export function generateICal(booking: {
  booking_reference: string;
  service_name: string;
  start_time: string;
  end_time: string;
  staff_name?: string;
  location?: string;
}): string {
  const startDate = new Date(booking.start_time);
  const endDate = new Date(booking.end_time);

  const formatDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayStream//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${formatDate(startDate)}`,
    `DTEND:${formatDate(endDate)}`,
    `SUMMARY:${booking.service_name}`,
    `UID:${booking.booking_reference}@daystream.app`,
    `DESCRIPTION:Booking Reference: ${booking.booking_reference}${booking.staff_name ? `\\nProvider: ${booking.staff_name}` : ''}`,
    booking.location ? `LOCATION:${booking.location}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.join('\r\n');
}

/**
 * Schedule reminders for all confirmed bookings happening in the next 48 hours.
 */
export async function scheduleUpcomingReminders(): Promise<number> {
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000);

  // Find confirmed bookings in the next 48h that don't already have a reminder queued
  const { rows: bookings } = await adminPool.query(
    `SELECT b.id, b.business_id, b.customer_id, b.booking_reference, b.start_time, b.end_time,
            s.name AS service_name, c.email AS customer_email,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
     JOIN cus_customers c ON c.id = b.customer_id
     LEFT JOIN usr_users u ON u.id = b.staff_id
     WHERE b.status = 'confirmed'
       AND b.start_time > NOW()
       AND b.start_time <= $1
       AND NOT EXISTS (
         SELECT 1 FROM apt_notification_queue nq
         WHERE nq.type = 'booking.reminder'
           AND nq.recipient_id = b.customer_id
           AND nq.data->>'booking_reference' = b.booking_reference
           AND nq.status IN ('pending', 'sent')
       )`,
    [cutoff.toISOString()],
  );

  let queued = 0;
  for (const booking of bookings) {
    await queueBookingReminder(booking, booking.customer_email, [24, 2]);
    queued++;
  }

  if (queued > 0) {
    logger.info('Reminders scheduled', { count: queued });
  }

  return queued;
}
