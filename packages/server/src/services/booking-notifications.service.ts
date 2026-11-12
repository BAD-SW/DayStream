import { canContact } from './contactability.service';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { isKnownArtifactType } from '@daystream/shared';
import { resolveArtifactKey, resolveAndRender, selectTemplate } from './document-branding-resolver.service';
import { sendEmail as sendEmailTransport } from './email.service';
import { getConfig } from './config.service';
import { buildIcs, calendarLinksHtml, CALENDAR_LINKS_MARKER } from '../utils/ics';
import { fillCheckInTexts } from '@daystream/shared';
import type { CalendarEvent } from '../utils/ics';

/**
 * Build the From value for a branded document email.
 *
 * A business's template carries a display name (`sender_name`) and a Reply-To
 * address (`reply_to`). To keep the platform identity out of the From line, the
 * Reply-To address doubles as the From address:
 *   - name + address → "Transcend Payments <payments@transcend.eu>"
 *   - address only   → "payments@transcend.eu"
 *   - name only      → the display name (email.service pairs it with the platform
 *                       address — the pre-existing fallback behavior)
 *   - neither        → null (sendEmail uses the platform default From)
 */
function buildBrandedFrom(senderName: string | null, replyTo: string | null): string | undefined {
  const name = senderName?.trim() || '';
  const addr = replyTo?.trim() || '';
  if (addr) return name ? `${name} <${addr}>` : addr;
  return name || undefined;
}

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
 * The customer's personal link to check in from their phone and complete any forms, or null when it
 * cannot be made (the email is then sent without it).
 */
async function personalCheckInLink(booking: any): Promise<string | null> {
  if (!booking.id || !booking.customer_id || !booking.business_id) return null;
  try {
    const { tenantOfBusiness } = await import('../utils/storage-paths');
    const qr = await import('./checkin-qr.service');
    return qr.checkInLinkUrl(await qr.getBookingLinkCode(await tenantOfBusiness(booking.business_id), booking.id));
  } catch (err) {
    logger.warn('Could not make the check-in link', { booking: booking.booking_reference, error: (err as Error).message });
    return null;
  }
}

/** The appointment as a calendar entry, for the add-to-calendar links and the attached invite. */
async function calendarEventFor(booking: any): Promise<CalendarEvent | null> {
  if (!booking.start_time || !booking.end_time) return null;
  const { rows } = await adminPool.query('SELECT name, address FROM sys_businesses WHERE id = $1', [booking.business_id]);
  const biz = rows[0];
  const service = booking.service_name || 'Appointment';
  const staffName = booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name || ''}`.trim() : '';
  const staff = staffName ? `with ${staffName}` : '';
  return {
    uid: String(booking.id || booking.booking_reference),
    title: biz?.name ? `${service} at ${biz.name}` : service,
    start: new Date(booking.start_time).toISOString(),
    end: new Date(booking.end_time).toISOString(),
    description: [service, staff, booking.booking_reference ? `Reference ${booking.booking_reference}` : ''].filter(Boolean).join(' · '),
    ...(typeof biz?.address === 'string' && biz.address ? { location: biz.address } : {}),
  };
}

/** The data the appointment template's link placeholders need: check-in page and Add to Calendar. */
async function appointmentLinks(booking: any): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const checkIn = await personalCheckInLink(booking);
  if (checkIn) out.check_in_link = checkIn;
  try {
    const ev = await calendarEventFor(booking);
    if (ev) { out.calendar_event = ev; out.calendar_links = calendarLinksHtml(ev); }
  } catch (err) {
    logger.warn('Could not make the calendar links', { booking: booking.booking_reference, error: (err as Error).message });
  }
  return out;
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
      // Links for the template's placeholders: the personal check-in page and Add to Calendar.
      ...(await appointmentLinks(booking)),
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
    data: buildAppointmentData(booking, customerEmail, { reason: reason || 'Cancelled' }),
  });
}

/**
 * Build the token data bag for an appointment notification (confirmation,
 * cancellation, reschedule). Populates the recipient, staff, service, and
 * appointment-time tokens the branding resolver maps (buildTokenMap):
 *   customer_name / customer_first_name / customer_email, staff_name,
 *   service_name, appointment_date + appointment_time (derived from start_time),
 *   booking_reference.
 *
 * The booking object is expected to come from getBookingById, which already joins
 * the customer and staff names.
 *
 * manage_link / calendar_links are included as null: there is no customer-facing
 * appointment-management URL builder or .ics/calendar-link generator yet (tracked
 * follow-up, same as the other portal links). The tokens resolve empty rather than
 * to a dead link until that work lands.
 */
function buildAppointmentData(
  booking: any, customerEmail: string, extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const customerName = [booking.customer_first_name, booking.customer_last_name]
    .filter(Boolean).join(' ').trim();
  const staffName = [booking.staff_first_name, booking.staff_last_name]
    .filter(Boolean).join(' ').trim();
  return {
    booking_reference: booking.booking_reference,
    service_name: booking.service_name || '',
    start_time: booking.start_time,
    // start_time also drives appointment_date / appointment_time in the resolver.
    staff_name: staffName || null,
    customer_name: customerName || null,
    customer_first_name: booking.customer_first_name || null,
    customer_email: booking.customer_email || customerEmail || null,
    // No URL builders yet — resolve empty rather than a dead link (follow-up).
    manage_link: null,
    calendar_links: null,
    ...extra,
  };
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
export async function queueBookingReminder(booking: any, customerEmail: string, hoursBeforeList: number[]): Promise<number> {
  const startTime = new Date(booking.start_time);

  // A reminder is not sent to someone who switched reminders off, has no usable email, or is
  // archived / merged (Phase 46 R10). Confirmations and cancellations are not affected.
  if (booking.customer_id && booking.business_id) {
    const decision = await canContact(booking.customer_id, booking.business_id, 'email', 'transactional', { reminder: true });
    if (!decision.allowed) {
      logger.info('Booking reminder not queued', { booking: booking.booking_reference, reason: decision.reason });
      return 0;
    }
  }

  // What the Appointment Reminder template's placeholders need: the customer's name, the check-in link and
  // Add to Calendar. A reminder is still sent without the links if they cannot be made.
  const links = await appointmentLinks(booking);

  let queuedCount = 0;
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
        customer_name: [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ').trim() || null,
        customer_first_name: booking.customer_first_name || null,
        customer_email: customerEmail || null,
        ...links,
      },
      scheduledFor,
    });
    queuedCount++;
  }
  return queuedCount;
}

/**
 * Emails a waiting customer that the business is ready for them (spec 51, gap 3), at once. The words are the
 * business's Check-In wording in the customer's language (the greeting, the "ready for you" message and the
 * subject), so there is one place to change them. Returns whether an email was sent.
 */
export async function sendReadyNotification(bookingId: string): Promise<boolean> {
  try {
    const { rows } = await adminPool.query(
      `SELECT b.business_id, b.customer_id, b.start_time, c.first_name, c.email, c.preferred_language,
              bus.name AS business_name, bus.timezone, s.name AS service_name
         FROM apt_bookings b
         JOIN sys_businesses bus ON bus.id = b.business_id
         JOIN svc_services s ON s.id = b.service_id
         JOIN cus_customers c ON c.id = b.customer_id
        WHERE b.id = $1`,
      [bookingId],
    );
    const r = rows[0];
    if (!r?.email) return false;
    const { languageFor, resolveTexts } = await import('./checkin-texts.service');
    const time = new Date(r.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: r.timezone || 'UTC' });
    const wording = fillCheckInTexts(
      await resolveTexts(r.business_id, await languageFor(r.business_id, r.preferred_language)),
      { first_name: r.first_name || '', service_name: r.service_name, time, business_name: r.business_name },
    );
    const subject = wording.readyEmailSubject;
    const lines = [wording.greeting, wording.ready];
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await sendEmailTransport({ to: r.email, subject, html: lines.map((l) => `<p>${esc(l)}</p>`).join('\n'), text: lines.join('\n\n') });
    logger.info('Ready email sent', { booking: bookingId });
    await recordInThread({ recipient_id: r.customer_id, business_id: r.business_id }, subject, lines.join('\n\n'));
    return true;
  } catch (err) {
    logger.warn(`Ready email for booking ${bookingId} not sent: ${(err as Error).message}`);
    return false;
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
/**
 * Emails the "transactional emails" switch covers: confirmations, cancellations, receipts
 * and purchases (David, THE-16), and reminders of a task. Booking and renewal reminders have
 * their own switch; invoices, failed-payment notices and waitlist offers are not covered.
 */
const TRANSACTIONAL_TYPES: ReadonlySet<string> = new Set([
  'booking.confirmation', 'booking.cancellation', 'booking.reschedule',
  'payment.receipt', 'charge.succeeded', 'invoice.paid', 'payment.refund_confirmation',
  'customer.task_reminder',
  'event.registration_confirmed', 'event.registration_reserved', 'event.registration_cancelled',
]);

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
      // A person who switched transactional emails off gets no confirmations, cancellations
      // or receipts at all (THE-16). Checked at sending time, so a change applies to mail
      // already in the queue. The row is kept as 'cancelled' with the reason.
      if (notification.channel === 'email' && TRANSACTIONAL_TYPES.has(notification.type) && notification.recipient_id) {
        const decision = await canContact(notification.recipient_id, notification.business_id, 'email', 'transactional');
        if (decision.reason === 'transactional_off') {
          await adminPool.query(
            `UPDATE apt_notification_queue SET status = 'cancelled', error = $2, claimed_at = NULL, claimed_by = NULL WHERE id = $1`,
            [notification.id, decision.message],
          );
          continue;
        }
      }
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
/** Types that have a template but fall back to the plain email while the business has none. */
const TEMPLATE_OR_PLAIN: ReadonlySet<string> = new Set(['booking.reminder']);

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

  // A reminder uses the business's Appointment Reminder template. A business that has not made one yet
  // still sends the plain reminder (with the check-in link) instead of an almost empty email.
  const templateIfAny = TEMPLATE_OR_PLAIN.has(type)
    ? await selectTemplate(notification.business_id, type, typeof data.language === 'string' ? data.language : null)
    : true;
  if (isKnownArtifactType(artifactKey) && templateIfAny) {
    // Branded catalog document — resolve the business's template and render it.
    // Build the {{details_table}} line-item table from the queued data so the
    // email draws it where the marker sits (receipt/invoice/adjustment).
    const language = typeof data.language === 'string' ? data.language : null;
    const { buildDetailsTableForNotification } = await import('./document-send.service');
    const detailsTable = await buildDetailsTableForNotification(notification.business_id, type, data).catch(() => null);
    const rendered = await resolveAndRender(notification.business_id, type, data, language, detailsTable);
    // Branded From: the template's Reply-To address doubles as the From address so
    // the business identifies itself (e.g. "Transcend Payments <payments@transcend.eu>")
    // instead of exposing the shared platform sender (noreply@daystream.app). We pass
    // a full "Name <addr>" From when the template has a reply-to address; with only a
    // sender name we fall back to a display-name-only override (platform address).
    // Reply-To is still set explicitly so replies route to the branded address.
    // NOTE: deliverability in production requires the reply-to domain to authorize
    // the platform's sending infrastructure (SPF/DKIM) — tracked follow-up.
    const brandedFrom = buildBrandedFrom(rendered.senderName, rendered.replyTo);
    // The calendar invite is attached only when the template uses the Add to Calendar placeholder
    // (its links are in the body); a template without the placeholder gets neither.
    const ev = data.calendar_event as CalendarEvent | undefined;
    const attachments = ev && rendered.html.includes(CALENDAR_LINKS_MARKER)
      ? [{ filename: 'invite.ics', content: Buffer.from(buildIcs(ev), 'utf8'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }]
      : undefined;
    await sendEmailTransport({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(attachments ? { attachments } : {}),
      ...(brandedFrom ? { from: brandedFrom } : {}),
      ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
    });
    logger.info('Branded document email sent', { type, recipient });
    await recordInThread(notification, rendered.subject, rendered.text);
    return;
  }

  // Non-catalog type (e.g. booking.reminder/.reschedule/.cancellation) — send a
  // clean default email so it is actually delivered rather than only logged.
  // (A branded template for these can be added to the catalog later.)
  const rendered = renderDefaultEmail(type, data);
  await sendEmailTransport({ to: recipient, subject: rendered.subject, html: rendered.html, text: rendered.text });
  logger.info('Default email sent', { type, recipient });
  await recordInThread(notification, rendered.subject, rendered.text);
}

/** What the system emailed a customer goes into their Inbox thread as an automatic message (THE-18). */
async function recordInThread(notification: any, subject: string, text: string) {
  if (!notification.recipient_id || !notification.business_id) return;
  const { rows } = await adminPool.query('SELECT 1 FROM cus_customers WHERE id = $1 AND business_id = $2', [notification.recipient_id, notification.business_id]);
  if (!rows[0]) return;
  const { recordAutomatic } = await import('./inbox.service');
  await recordAutomatic({ businessId: notification.business_id, customerId: notification.recipient_id, channel: 'email', subject, body: text });
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
    'customer.task_reminder': 'A reminder from us',
    'event.registration_confirmed': 'You are registered for the event',
    'event.registration_reserved': 'Your place is reserved',
    'event.registration_cancelled': 'Your event registration has been cancelled',
  };
  const subject = titles[type] || 'Notification';
  const name = esc((data.customer_name as string) || '').split(' ')[0] || 'there';
  const service = esc(data.service_name);
  const when = data.start_time ? new Date(String(data.start_time)).toLocaleString() : '';
  const lines: string[] = [`<p>Hi ${name},</p>`, `<p>${esc(subject)}.</p>`];
  if (service) lines.push(`<p>Service: ${service}</p>`);
  if (when) lines.push(`<p>When: ${esc(when)}</p>`);
  if (data.booking_reference) lines.push(`<p>Reference: ${esc(data.booking_reference)}</p>`);
  // Only a link the system made itself (https or http), shown as text and as a link.
  if (typeof data.check_in_link === 'string' && /^https?:\/\//.test(data.check_in_link)) {
    lines.push(`<p>Check in from your phone when you arrive, and complete any forms: <a href="${esc(data.check_in_link)}">${esc(data.check_in_link)}</a></p>`);
  }
  if (data.task_title) lines.push(`<p>${esc(data.task_title)}</p>`);
  if (data.task_description) lines.push(`<p>${esc(data.task_description)}</p>`);
  if (data.due_at) lines.push(`<p>Date: ${esc(new Date(String(data.due_at)).toLocaleString())}</p>`);
  // Events (THE-20): already written in the hosting business's time zone.
  if (data.event_title) lines.push(`<p>Event: ${esc(data.event_title)}</p>`);
  if (data.when_text) lines.push(`<p>When: ${esc(data.when_text)}</p>`);
  if (data.location) lines.push(`<p>Where: ${esc(data.location)}</p>`);
  if (data.ticket_text) lines.push(`<p>Ticket: ${esc(data.ticket_text)}</p>`);
  if (data.amount_text) lines.push(`<p>${esc(data.amount_text)}</p>`);
  if (data.refund_text) lines.push(`<p>${esc(data.refund_text)}</p>`);
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

const DEFAULT_REMINDER_HOURS = [24, 2];

/**
 * When reminders go out before an appointment, in hours (longest first). The business's own setting
 * wins, then the tenant's, then the system default (24 and 2); a value that is not a short list of
 * sensible hours is ignored.
 */
export async function reminderHoursFor(businessId: string, tenantId: string): Promise<number[]> {
  const valid = (v: unknown): number[] | null => {
    if (!Array.isArray(v)) return null;
    const hours = v.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 336);
    return hours.length > 0 && hours.length <= 5 && hours.length === v.length
      ? [...new Set(hours)].sort((x, y) => y - x) : null;
  };
  try {
    const { rows } = await adminPool.query(
      `SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = 'booking.reminder_hours'`,
      [businessId],
    );
    if (rows[0]) {
      const own = valid(JSON.parse(rows[0].value));
      if (own) return own;
    }
  } catch { /* fall through to the tenant and system settings */ }
  try {
    const inherited = valid(await getConfig(tenantId, 'booking.reminder_hours'));
    if (inherited) return inherited;
  } catch { /* use the default */ }
  return DEFAULT_REMINDER_HOURS;
}

/**
 * Queue the reminders of every confirmed appointment coming up (the longest lead time plus a day
 * ahead). Safe to run often: an appointment that already has reminders queued or sent is skipped, and
 * reminders still waiting for an appointment that was moved or is no longer confirmed are cancelled so
 * the right ones are queued instead.
 */
export async function scheduleUpcomingReminders(): Promise<number> {
  // Reminders queued before they carried the customer's name and the calendar links: replace the ones that
  // are not due for a few minutes, so a template's placeholders fill in. (Anything due soon goes as it is.)
  await adminPool.query(
    `UPDATE apt_notification_queue
        SET status = 'cancelled', error = 'Replaced with an updated reminder', claimed_at = NULL, claimed_by = NULL
      WHERE type = 'booking.reminder' AND status = 'pending' AND NOT (data ? 'customer_email')
        AND scheduled_for > NOW() + INTERVAL '5 minutes'`,
  );

  // Reminders that no longer match their appointment.
  await adminPool.query(
    `UPDATE apt_notification_queue nq
        SET status = 'cancelled', error = 'The appointment changed', claimed_at = NULL, claimed_by = NULL
      WHERE nq.type = 'booking.reminder' AND nq.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM apt_bookings b
           WHERE b.business_id = nq.business_id AND b.booking_reference = nq.data->>'booking_reference'
             AND (b.status <> 'confirmed'
                  -- JSON keeps milliseconds, the database microseconds: compare to the second.
                  OR ABS(EXTRACT(EPOCH FROM (b.start_time - (nq.data->>'start_time')::timestamptz))) > 1))`,
  );

  const horizon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { rows: bookings } = await adminPool.query(
    `SELECT b.id, b.business_id, b.customer_id, b.booking_reference, b.start_time, b.end_time,
            s.name AS service_name, c.email AS customer_email, bus.tenant_id,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
     JOIN cus_customers c ON c.id = b.customer_id
     JOIN sys_businesses bus ON bus.id = b.business_id
     LEFT JOIN usr_users u ON u.id = b.staff_id
     WHERE b.status = 'confirmed'
       AND b.start_time > NOW()
       AND b.start_time <= $1
       AND c.email IS NOT NULL AND c.email <> ''
       AND NOT EXISTS (
         SELECT 1 FROM apt_notification_queue nq
         WHERE nq.type = 'booking.reminder'
           AND nq.recipient_id = b.customer_id
           AND nq.data->>'booking_reference' = b.booking_reference
           AND nq.status IN ('pending', 'processing', 'sent')
       )`,
    [horizon.toISOString()],
  );

  const hoursByBusiness = new Map<string, number[]>();
  let queued = 0;
  for (const booking of bookings) {
    let hours = hoursByBusiness.get(booking.business_id);
    if (!hours) { hours = await reminderHoursFor(booking.business_id, booking.tenant_id); hoursByBusiness.set(booking.business_id, hours); }
    // Only appointments that are inside the longest lead time can have their first reminder due.
    if (new Date(booking.start_time).getTime() - Date.now() > (Math.max(...hours) + 24) * 3600 * 1000) continue;
    queued += await queueBookingReminder(booking, booking.customer_email, hours);
  }

  if (queued > 0) {
    logger.info('Reminders scheduled', { count: queued });
  }

  return queued;
}
