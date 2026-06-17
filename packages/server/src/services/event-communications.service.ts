import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CommunicationRecord {
  eventId: string;
  registrationId?: string;
  type: string;
  subject: string;
  content: string;
  recipientCount: number;
}

/**
 * Log a communication to the event_communications table.
 */
async function logCommunication(record: CommunicationRecord) {
  const { rows } = await adminPool.query(
    `INSERT INTO event_communications (event_id, communication_type, recipient_type, recipient_id, subject, content, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [
      record.eventId,
      record.type,
      record.registrationId ? 'individual' : 'all',
      record.registrationId || null,
      record.subject,
      record.content,
    ],
  );
  return rows[0];
}

/**
 * Send a registration confirmation to a specific registrant.
 */
export async function sendConfirmation(registrationId: string) {
  const { rows } = await adminPool.query(
    `SELECT er.*, e.title AS event_title, e.start_time, e.location_name, e.tenant_id,
            c.first_name, c.last_name, c.email
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     JOIN customers c ON c.id = er.customer_id
     WHERE er.id = $1`,
    [registrationId],
  );
  if (rows.length === 0) throw new Error('Registration not found');

  const reg = rows[0];
  const subject = `Registration Confirmed: ${reg.event_title}`;
  const content = `Hi ${reg.first_name}, your registration for "${reg.event_title}" on ${new Date(reg.start_time).toLocaleDateString()} is confirmed. Reference: ${reg.reference_number}`;

  // TODO: integrate with actual email/notification service
  const record = await logCommunication({
    eventId: reg.event_id,
    registrationId,
    type: 'confirmation',
    subject,
    content,
    recipientCount: 1,
  });

  return record;
}

/**
 * Send reminders to all confirmed registrants X days before the event.
 */
export async function sendReminder(eventId: string, daysBefore: number) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT * FROM events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];
  const { rows: registrants } = await adminPool.query(
    `SELECT er.*, c.first_name, c.email
     FROM event_registrations er
     JOIN customers c ON c.id = er.customer_id
     WHERE er.event_id = $1 AND er.status = 'confirmed'`,
    [eventId],
  );

  const subject = `Reminder: ${event.title} in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;
  const content = `Don't forget! "${event.title}" is happening on ${new Date(event.start_time).toLocaleDateString()} at ${event.location_name || 'TBD'}.`;

  // TODO: send actual emails via notification service
  const record = await logCommunication({
    eventId,
    type: 'reminder',
    subject,
    content,
    recipientCount: registrants.length,
  });

  return record;
}

/**
 * Send preparation/instructions to all confirmed registrants before the event.
 */
export async function sendPreparation(eventId: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT * FROM events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];
  const { rows: registrants } = await adminPool.query(
    `SELECT er.id FROM event_registrations er WHERE er.event_id = $1 AND er.status = 'confirmed'`,
    [eventId],
  );

  const subject = `Preparation Info: ${event.title}`;
  const content = `Here's what you need to know before "${event.title}".`;

  // TODO: include custom preparation content from event settings
  const record = await logCommunication({
    eventId,
    type: 'preparation',
    subject,
    content,
    recipientCount: registrants.length,
  });

  return record;
}

/**
 * Send follow-up to all attendees after the event.
 */
export async function sendFollowUp(eventId: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT * FROM events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];
  const { rows: attendees } = await adminPool.query(
    `SELECT er.id FROM event_registrations er
     WHERE er.event_id = $1 AND er.checked_in_at IS NOT NULL`,
    [eventId],
  );

  const subject = `Thank You for Attending: ${event.title}`;
  const content = `Thank you for attending "${event.title}". We hope you enjoyed it!`;

  // TODO: integrate with feedback/survey system
  const record = await logCommunication({
    eventId,
    type: 'follow_up',
    subject,
    content,
    recipientCount: attendees.length,
  });

  return record;
}

/**
 * Send a cancellation notice. If registrationId provided, send to one registrant;
 * otherwise send to all confirmed registrants.
 */
export async function sendCancellationNotice(eventId: string, registrationId?: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT * FROM events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];
  let recipientCount = 1;

  if (!registrationId) {
    const { rows: regs } = await adminPool.query(
      `SELECT id FROM event_registrations WHERE event_id = $1 AND status IN ('confirmed','pending')`,
      [eventId],
    );
    recipientCount = regs.length;
  }

  const subject = `Event Cancelled: ${event.title}`;
  const content = `We're sorry to inform you that "${event.title}" scheduled for ${new Date(event.start_time).toLocaleDateString()} has been cancelled.`;

  const record = await logCommunication({
    eventId,
    registrationId,
    type: 'cancellation',
    subject,
    content,
    recipientCount,
  });

  return record;
}

/**
 * Send an ad-hoc communication to all confirmed registrants.
 */
export async function sendAdHoc(eventId: string, subject: string, content: string) {
  const { rows: registrants } = await adminPool.query(
    `SELECT id FROM event_registrations WHERE event_id = $1 AND status = 'confirmed'`,
    [eventId],
  );

  // TODO: send actual emails
  const record = await logCommunication({
    eventId,
    type: 'ad_hoc',
    subject,
    content,
    recipientCount: registrants.length,
  });

  return record;
}

/**
 * Get communication history for an event.
 */
export async function getCommunicationHistory(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM event_communications
     WHERE event_id = $1
     ORDER BY sent_at DESC`,
    [eventId],
  );
  return rows;
}
