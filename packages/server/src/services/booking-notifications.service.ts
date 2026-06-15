import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

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
    `INSERT INTO notification_queue (business_id, type, channel, recipient_id, recipient_email, data, scheduled_for)
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
      staff_name: booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name}` : null,
      price: booking.price,
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
export async function processNotificationQueue(): Promise<{ sent: number; failed: number }> {
  const { rows } = await adminPool.query(
    `SELECT * FROM notification_queue
     WHERE status = 'pending' AND scheduled_for <= NOW()
     ORDER BY scheduled_for
     LIMIT 50`,
  );

  let sent = 0;
  let failed = 0;

  for (const notification of rows) {
    try {
      // Dispatch based on channel
      if (notification.channel === 'email') {
        await sendEmail(notification);
      }
      // Mark as sent
      await adminPool.query(
        "UPDATE notification_queue SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [notification.id],
      );
      sent++;
    } catch (err: any) {
      // Mark as failed, increment attempts
      await adminPool.query(
        "UPDATE notification_queue SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, attempts = attempts + 1, error = $2 WHERE id = $1",
        [notification.id, err.message],
      );
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    logger.info('Notification queue processed', { sent, failed });
  }

  return { sent, failed };
}

/**
 * Send an email notification (uses existing email infrastructure).
 */
async function sendEmail(notification: any): Promise<void> {
  // In production, this would use nodemailer or an email service
  // For now, just log it
  logger.info('Email notification dispatched', {
    type: notification.type,
    recipient: notification.recipient_email,
    data: notification.data,
  });
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
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN customers c ON c.id = b.customer_id
     LEFT JOIN users u ON u.id = b.staff_id
     WHERE b.status = 'confirmed'
       AND b.start_time > NOW()
       AND b.start_time <= $1
       AND NOT EXISTS (
         SELECT 1 FROM notification_queue nq
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
