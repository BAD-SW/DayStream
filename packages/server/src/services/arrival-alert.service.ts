import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Tells staff a customer has arrived (spec 51, gap 3): the booked practitioner and the front desk,
 * as the business set it in Settings > Inbox. Never fails a check-in: an alert that cannot be
 * sent is logged and the check-in stands.
 */
export async function notifyArrival(bookingId: string): Promise<void> {
  try {
    const { rows } = await adminPool.query(
      `SELECT b.business_id, b.staff_id, b.start_time, b.walk_in_name, s.name AS service_name,
              c.first_name, bus.timezone
         FROM apt_bookings b
         JOIN svc_services s ON s.id = b.service_id
         JOIN sys_businesses bus ON bus.id = b.business_id
         LEFT JOIN cus_customers c ON c.id = b.customer_id
        WHERE b.id = $1`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) return;
    const who = b.first_name || b.walk_in_name || 'A walk-in customer';
    const time = new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: b.timezone || 'UTC' });
    const { notify } = await import('./inbox.service');
    await notify(b.business_id, 'customer_arrived', {
      title: `${who} has arrived`,
      body: `${b.service_name} at ${time}`,
      link: '/bookings',
      alsoTo: b.staff_id ? [b.staff_id] : [],
    });
  } catch (e) {
    logger.warn(`Arrival alert for booking ${bookingId} failed: ${(e as Error).message}`);
  }
}
