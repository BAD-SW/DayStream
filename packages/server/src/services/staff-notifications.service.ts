import { adminPool } from '../db/pool';

type NotificationEvent =
  | 'new_booking'
  | 'cancellation'
  | 'leave_status'
  | 'schedule_change'
  | 'cert_expiry';

/**
 * Get notification preferences for a staff member.
 */
export async function getNotificationPreferences(staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM stf_notification_preferences WHERE staff_id = $1 ORDER BY event_type`,
    [staffId],
  );
  return rows;
}

/**
 * Set notification preferences for a staff member.
 */
export async function setNotificationPreferences(staffId: string, preferences: Array<{
  eventType: string;
  channelEmail: boolean;
  channelInApp: boolean;
  channelSms: boolean;
}>) {
  const results: any[] = [];

  for (const pref of preferences) {
    const { rows } = await adminPool.query(
      `INSERT INTO stf_notification_preferences (staff_id, event_type, channel_email, channel_in_app, channel_sms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (staff_id, event_type)
       DO UPDATE SET channel_email = $3, channel_in_app = $4, channel_sms = $5
       RETURNING *`,
      [staffId, pref.eventType, pref.channelEmail, pref.channelInApp, pref.channelSms],
    );
    results.push(rows[0]);
  }

  return results;
}

/**
 * Send a notification to a staff member (routes through configured channels).
 * This is a fire-and-forget operation — errors are logged but don't block.
 */
export async function notifyStaff(staffId: string, event: NotificationEvent, data: {
  title: string;
  message: string;
  metadata?: Record<string, any>;
}) {
  // Get preferences for this event type
  const { rows: prefs } = await adminPool.query(
    `SELECT * FROM stf_notification_preferences WHERE staff_id = $1 AND event_type = $2`,
    [staffId, event],
  );

  // Default to email + in-app if no preferences set
  const preference = prefs[0] || { channel_email: true, channel_in_app: true, channel_sms: false };

  // Get staff contact info
  const { rows: staffRows } = await adminPool.query(
    `SELECT email, mobile_phone FROM stf_profiles WHERE id = $1`,
    [staffId],
  );
  if (staffRows.length === 0) return;

  const staff = staffRows[0];

  // In-app notification (store in a simple notifications concept — for now just log)
  if (preference.channel_in_app) {
    // Future: Store in notifications table for in-app display
    // For now, this is a placeholder
  }

  // Email notification
  if (preference.channel_email && staff.email) {
    // Future: Use email.service.ts to send
    // For now, this is a placeholder
  }

  // SMS notification (optional)
  if (preference.channel_sms && staff.mobile_phone) {
    // Future: Use SMS service
    // For now, this is a placeholder
  }
}

/**
 * Notify about a new booking assignment.
 */
export async function notifyNewBooking(staffId: string, bookingDetails: {
  serviceName: string;
  customerName: string;
  startTime: string;
}) {
  await notifyStaff(staffId, 'new_booking', {
    title: 'New Booking',
    message: `New booking: ${bookingDetails.serviceName} with ${bookingDetails.customerName} at ${bookingDetails.startTime}`,
    metadata: bookingDetails,
  });
}

/**
 * Notify about a booking cancellation.
 */
export async function notifyBookingCancellation(staffId: string, bookingDetails: {
  serviceName: string;
  customerName: string;
  startTime: string;
}) {
  await notifyStaff(staffId, 'cancellation', {
    title: 'Booking Cancelled',
    message: `Cancelled: ${bookingDetails.serviceName} with ${bookingDetails.customerName} at ${bookingDetails.startTime}`,
    metadata: bookingDetails,
  });
}

/**
 * Notify about leave request status change.
 */
export async function notifyLeaveStatus(staffId: string, status: string, leaveType: string, startDate: string, endDate: string) {
  await notifyStaff(staffId, 'leave_status', {
    title: `Leave ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    message: `Your ${leaveType} leave request (${startDate} to ${endDate}) has been ${status}.`,
    metadata: { status, leaveType, startDate, endDate },
  });
}

/**
 * Notify about certification expiry.
 */
export async function notifyCertExpiry(staffId: string, qualificationName: string, expiryDate: string) {
  await notifyStaff(staffId, 'cert_expiry', {
    title: 'Certification Expiring',
    message: `Your certification "${qualificationName}" expires on ${expiryDate}.`,
    metadata: { qualificationName, expiryDate },
  });
}
