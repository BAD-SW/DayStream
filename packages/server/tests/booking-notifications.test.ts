import { describe, it, expect, beforeAll } from 'vitest';
import * as notificationService from '../src/services/booking-notifications.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;

describe('Booking Notifications', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Notif Test Biz', 'notif-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Notif Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-NTF01', 'notif-cust@example.com', 'Notif', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Notif'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Clean
    await adminPool.query("DELETE FROM apt_notification_queue WHERE business_id = $1", [BUSINESS_ID]);
  });

  describe('Notification queueing', () => {
    it('queues a booking confirmation', async () => {
      const booking = {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        booking_reference: 'BK-2026-TEST',
        service_name: 'Sports Massage',
        variant_name: '60 min',
        start_time: '2026-07-01T14:00:00Z',
        end_time: '2026-07-01T15:00:00Z',
        staff_first_name: 'Sarah',
        staff_last_name: 'Therapist',
        price: 7500,
      };

      await notificationService.queueBookingConfirmation(booking, 'notif-cust@example.com');

      const { rows } = await adminPool.query(
        "SELECT * FROM apt_notification_queue WHERE business_id = $1 AND type = 'booking.confirmation'",
        [BUSINESS_ID],
      );

      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].recipient_email).toBe('notif-cust@example.com');
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      expect(data.booking_reference).toBe('BK-2026-TEST');
      expect(data.service_name).toBe('Sports Massage');
    });

    it('queues a cancellation notification', async () => {
      const booking = {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        booking_reference: 'BK-2026-CANCEL',
        service_name: 'Float Tank',
        start_time: '2026-07-02T10:00:00Z',
      };

      await notificationService.queueBookingCancellation(booking, 'notif-cust@example.com', 'Customer requested');

      const { rows } = await adminPool.query(
        "SELECT * FROM apt_notification_queue WHERE business_id = $1 AND type = 'booking.cancellation'",
        [BUSINESS_ID],
      );

      expect(rows.length).toBe(1);
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      expect(data.reason).toBe('Customer requested');
    });

    it('queues a reschedule notification', async () => {
      const booking = {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        booking_reference: 'BK-2026-RESCH',
        service_name: 'Sauna',
        start_time: '2026-07-03T16:00:00Z',
      };

      await notificationService.queueBookingReschedule(booking, 'notif-cust@example.com', '2026-07-03T14:00:00Z');

      const { rows } = await adminPool.query(
        "SELECT * FROM apt_notification_queue WHERE business_id = $1 AND type = 'booking.reschedule'",
        [BUSINESS_ID],
      );

      expect(rows.length).toBe(1);
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      expect(data.old_start_time).toBe('2026-07-03T14:00:00Z');
      expect(data.new_start_time).toBe('2026-07-03T16:00:00Z');
    });

    it('queues reminders with correct scheduled_for', async () => {
      const futureBooking = {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        booking_reference: 'BK-2026-REMIND',
        service_name: 'Massage',
        start_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h from now
        staff_first_name: 'John',
        staff_last_name: 'Doe',
      };

      await notificationService.queueBookingReminder(futureBooking, 'notif-cust@example.com', [24, 2]);

      const { rows } = await adminPool.query(
        "SELECT * FROM apt_notification_queue WHERE business_id = $1 AND type = 'booking.reminder' ORDER BY scheduled_for",
        [BUSINESS_ID],
      );

      expect(rows.length).toBe(2);
      // First reminder: 24h before
      const scheduled1 = new Date(rows[0].scheduled_for);
      const scheduled2 = new Date(rows[1].scheduled_for);
      expect(scheduled1 < scheduled2).toBe(true);
    });
  });

  describe('Queue processing', () => {
    it('processes pending notifications', async () => {
      // Insert a notification that's due now
      await adminPool.query(
        `INSERT INTO apt_notification_queue (business_id, type, channel, recipient_id, recipient_email, data, scheduled_for)
         VALUES ($1, 'test.immediate', 'email', $2, 'notif-cust@example.com', '{"test": true}', NOW() - INTERVAL '1 minute')`,
        [BUSINESS_ID, CUSTOMER_ID],
      );

      const result = await notificationService.processNotificationQueue();
      expect(result.sent).toBeGreaterThanOrEqual(1);
    });

    it('does not process future-scheduled notifications', async () => {
      await adminPool.query(
        `INSERT INTO apt_notification_queue (business_id, type, channel, recipient_id, recipient_email, data, scheduled_for, status)
         VALUES ($1, 'test.future', 'email', $2, 'notif-cust@example.com', '{"test": true}', NOW() + INTERVAL '1 hour', 'pending')`,
        [BUSINESS_ID, CUSTOMER_ID],
      );

      // Process queue — future one should not be sent
      await notificationService.processNotificationQueue();

      const { rows } = await adminPool.query(
        "SELECT status FROM apt_notification_queue WHERE business_id = $1 AND type = 'test.future'",
        [BUSINESS_ID],
      );
      expect(rows[0].status).toBe('pending');
    });
  });

  describe('iCal generation', () => {
    it('generates valid iCal format', () => {
      const ical = notificationService.generateICal({
        booking_reference: 'BK-2026-0001',
        service_name: 'Sports Massage',
        start_time: '2026-07-01T14:00:00.000Z',
        end_time: '2026-07-01T15:00:00.000Z',
        staff_name: 'Sarah Therapist',
        location: 'Room 3',
      });

      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('BEGIN:VEVENT');
      expect(ical).toContain('SUMMARY:Sports Massage');
      expect(ical).toContain('LOCATION:Room 3');
      expect(ical).toContain('UID:BK-2026-0001@daystream.app');
      expect(ical).toContain('STATUS:CONFIRMED');
      expect(ical).toContain('END:VCALENDAR');
      expect(ical).toContain('DTSTART:');
      expect(ical).toContain('DTEND:');
    });

    it('works without optional fields', () => {
      const ical = notificationService.generateICal({
        booking_reference: 'BK-2026-0002',
        service_name: 'Float Tank',
        start_time: '2026-07-02T10:00:00.000Z',
        end_time: '2026-07-02T11:00:00.000Z',
      });

      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('SUMMARY:Float Tank');
      expect(ical).not.toContain('LOCATION');
    });
  });
});
