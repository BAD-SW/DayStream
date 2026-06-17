import { adminPool } from '../db/pool';
import crypto from 'crypto';

/**
 * Get an existing feed or create a new one.
 */
export async function getOrCreateFeed(tenantId: string, input: {
  userId?: string;
  customerId?: string;
  feedType: 'staff' | 'customer';
}) {
  // Check for existing active feed
  const { rows: existing } = await adminPool.query(
    `SELECT * FROM ical_feeds
     WHERE tenant_id = $1 AND feed_type = $2 AND is_active = true
       AND user_id IS NOT DISTINCT FROM $3
       AND customer_id IS NOT DISTINCT FROM $4`,
    [tenantId, input.feedType, input.userId || null, input.customerId || null],
  );

  if (existing.length > 0) return existing[0];

  const feedToken = crypto.randomBytes(32).toString('hex');
  const { rows } = await adminPool.query(
    `INSERT INTO ical_feeds (tenant_id, user_id, customer_id, feed_token, feed_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, input.userId || null, input.customerId || null, feedToken, input.feedType],
  );
  return rows[0];
}

/**
 * Regenerate a feed token (deactivates old, creates new).
 */
export async function regenerateFeed(tenantId: string, feedId: string) {
  const { rows: old } = await adminPool.query(
    `UPDATE ical_feeds SET is_active = false WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [feedId, tenantId],
  );
  if (old.length === 0) return null;

  const feed = old[0];
  return getOrCreateFeed(tenantId, {
    userId: feed.user_id,
    customerId: feed.customer_id,
    feedType: feed.feed_type,
  });
}

/**
 * Generate iCalendar content for a feed token.
 */
export async function generateIcalContent(feedToken: string) {
  const { rows: feeds } = await adminPool.query(
    `SELECT * FROM ical_feeds WHERE feed_token = $1 AND is_active = true`,
    [feedToken],
  );
  if (feeds.length === 0) return null;

  const feed = feeds[0];

  // Query bookings based on feed type
  let bookings: any[];
  if (feed.feed_type === 'staff' && feed.user_id) {
    const { rows } = await adminPool.query(
      `SELECT b.*, s.name AS service_name, c.first_name, c.last_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN customers c ON c.id = b.customer_id
       WHERE b.staff_id = $1 AND b.tenant_id = $2
         AND b.start_time >= NOW() - INTERVAL '30 days'
       ORDER BY b.start_time`,
      [feed.user_id, feed.tenant_id],
    );
    bookings = rows;
  } else if (feed.feed_type === 'customer' && feed.customer_id) {
    const { rows } = await adminPool.query(
      `SELECT b.*, s.name AS service_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.customer_id = $1 AND b.tenant_id = $2
         AND b.start_time >= NOW() - INTERVAL '30 days'
       ORDER BY b.start_time`,
      [feed.customer_id, feed.tenant_id],
    );
    bookings = rows;
  } else {
    bookings = [];
  }

  // Build iCalendar content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayStream//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:DayStream ${feed.feed_type === 'staff' ? 'Staff' : 'Customer'} Schedule`,
  ];

  for (const booking of bookings) {
    const dtStart = formatIcalDate(new Date(booking.start_time));
    const dtEnd = formatIcalDate(new Date(booking.end_time));
    const summary = booking.service_name || 'Booking';
    const description = feed.feed_type === 'staff' && booking.first_name
      ? `Client: ${booking.first_name} ${booking.last_name}`
      : '';

    lines.push(
      'BEGIN:VEVENT',
      `UID:${booking.id}@daystream`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
    );
    if (description) lines.push(`DESCRIPTION:${description}`);
    lines.push(
      `STATUS:${booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function formatIcalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
