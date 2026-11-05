import { describe, it, expect, beforeAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import { resetBusinessData } from './helpers/test-business';
import * as checkout from '../src/services/checkout.service';
import { refundOrderLines } from '../src/services/order-refund.service';
import { customerCancelWindow, getCancelSettings, setCancelSettings, DEFAULT_CANCEL_SETTINGS } from '../src/services/customer-cancellation.service';
import { computeOrderCommissionLines, setRefundClawbackEnabled } from '../src/services/commission.service';
import { hostBusinessId, hostCustomerId } from '../src/services/customer-events.service';

// Customer events and cancellation settings (Linear THE-20) and commission after a refund (THE-21).

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let OTHER_BUSINESS_ID: string;
let CUSTOMER_ID: string;
let STAFF_USER_ID: string;
let PRODUCT_ID: string;
let TAX_ID: string;

async function biz(name: string, slug: string) {
  const id = (await adminPool.query(
    `INSERT INTO sys_businesses (tenant_id, name, slug, status, timezone) VALUES ($1, $2, $3, 'active', 'Europe/Madrid')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_ID, name, slug],
  )).rows[0].id;
  await resetBusinessData(id);
  await adminPool.query('SELECT seed_chart_of_accounts($1)', [id]);
  return id;
}

async function paidOrder(lines: Array<{ itemType: any; itemId?: string; name: string; qty: number; price: number }>) {
  const order = await checkout.createOrder({ businessId: BUSINESS_ID, customerId: CUSTOMER_ID, checkedOutBy: STAFF_USER_ID, creditedTo: STAFF_USER_ID });
  for (const l of lines) {
    await checkout.addItem(order.id, { itemType: l.itemType, itemId: l.itemId, itemName: l.name, quantity: l.qty, unitPrice: l.price, creditedTo: STAFF_USER_ID });
  }
  await checkout.completeOrder(order.id, BUSINESS_ID, { paymentMethod: 'cash', checkedOutBy: STAFF_USER_ID });
  return (await checkout.getOrder(order.id))!;
}

async function journalLines(referenceType: string, referenceId: string) {
  const { rows } = await adminPool.query(
    `SELECT a.code, l.debit, l.credit FROM fin_journal_entries je
       JOIN fin_journal_entry_lines l ON l.journal_entry_id = je.id
       JOIN fin_chart_of_accounts a ON a.id = l.account_id
      WHERE je.reference_type = $1 AND je.reference_id = $2 AND je.is_void = false`,
    [referenceType, referenceId],
  );
  return rows;
}

describe('Customer events and cancellations (THE-20), commission after a refund (THE-21)', () => {
  beforeAll(async () => {
    BUSINESS_ID = await biz('Customer Events Test Biz', 'customer-events-test-biz');
    OTHER_BUSINESS_ID = await biz('Customer Events Other Biz', 'customer-events-other-biz');
    STAFF_USER_ID = (await adminPool.query(
      `SELECT id FROM usr_users WHERE tenant_id = $1 AND persona <> 'customer' AND status = 'active' ORDER BY created_at LIMIT 1`,
      [TENANT_ID],
    )).rows[0].id;
    CUSTOMER_ID = (await adminPool.query(
      `INSERT INTO cus_customers (business_id, tenant_id, email, first_name, last_name, reference_number)
       VALUES ($1, $2, 'cev-customer@example.test', 'Carla', 'Events', 'CEV-0001') RETURNING id`,
      [BUSINESS_ID, TENANT_ID],
    )).rows[0].id;
    PRODUCT_ID = (await adminPool.query(
      `INSERT INTO prd_merchandise (business_id, name, price, status) VALUES ($1, 'Test Oil', 1000, 'active') RETURNING id`,
      [BUSINESS_ID],
    )).rows[0].id;
    TAX_ID = (await adminPool.query(
      `INSERT INTO svc_tax_categories (business_id, name, rate, is_default) VALUES ($1, 'Reduced 10%', 1000, false) RETURNING id`,
      [BUSINESS_ID],
    )).rows[0].id;
  });

  describe('cancellation window', () => {
    const start = new Date('2026-11-10T10:00:00Z');

    it('refuses when customers may not cancel', () => {
      const w = customerCancelWindow(DEFAULT_CANCEL_SETTINGS, start, new Date('2026-11-01T10:00:00Z'));
      expect(w.allowed).toBe(false);
      expect(w.until).toBeNull();
    });

    it('allows until N hours before the start, then refuses', () => {
      const s = { customer_cancel_enabled: true, customer_cancel_hours: 48, cancel_refund_to: 'card' as const };
      expect(customerCancelWindow(s, start, new Date('2026-11-08T09:59:00Z')).allowed).toBe(true);
      const late = customerCancelWindow(s, start, new Date('2026-11-08T10:01:00Z'));
      expect(late.allowed).toBe(false);
      expect(late.until).toBe('2026-11-08T10:00:00.000Z');
    });

    it('keeps events and appointments separate per business', async () => {
      await setCancelSettings(BUSINESS_ID, 'events', { customer_cancel_enabled: true, customer_cancel_hours: 24, cancel_refund_to: 'credit' });
      await setCancelSettings(BUSINESS_ID, 'appointments', { customer_cancel_enabled: true, customer_cancel_hours: 72, cancel_refund_to: 'card' });
      expect(await getCancelSettings(BUSINESS_ID, 'events')).toEqual({ customer_cancel_enabled: true, customer_cancel_hours: 24, cancel_refund_to: 'credit', change_refund_days: 7 });
      expect(await getCancelSettings(BUSINESS_ID, 'appointments')).toEqual({ customer_cancel_enabled: true, customer_cancel_hours: 72, cancel_refund_to: 'card', change_refund_days: 7 });
      expect(await getCancelSettings(OTHER_BUSINESS_ID, 'events')).toEqual(DEFAULT_CANCEL_SETTINGS);
    });
  });

  describe('event ticket sale', () => {
    it('is taxed at the event tax category and posts to 4700 Event Revenue', async () => {
      const typeId = (await adminPool.query(`SELECT id FROM evt_types WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID])).rows[0]?.id
        ?? (await adminPool.query(`INSERT INTO evt_types (tenant_id, name, slug) VALUES ($1, 'Workshop', 'workshop-cev') RETURNING id`, [TENANT_ID])).rows[0].id;
      const eventId = (await adminPool.query(
        `INSERT INTO evt_events (tenant_id, event_type_id, title, slug, start_time, end_time, capacity, status, tax_category_id, created_by)
         VALUES ($1, $2, 'CEV Ticket Test', 'cev-ticket-test-' || floor(random() * 1e9)::text, NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 2 hours', 10, 'published', $3, $4)
         RETURNING id`,
        [TENANT_ID, typeId, TAX_ID, STAFF_USER_ID],
      )).rows[0].id;
      const order = await paidOrder([{ itemType: 'event', itemId: eventId, name: 'CEV Ticket Test', qty: 2, price: 2500 }]);
      const line = order.items[0];
      expect(line.item_type).toBe('event');
      expect(line.tax_amount).toBe(500); // 10% of 5000
      const gl = await journalLines('order', order.id);
      expect(gl.find((l: any) => l.code === '4700')?.credit).toBe(5000);
      await adminPool.query('DELETE FROM evt_events WHERE id = $1', [eventId]);
    });
  });

  describe('refund to account credit', () => {
    it('moves no money: the customer gets drawable credit and the GL credits 2500 instead of cash', async () => {
      const order = await paidOrder([{ itemType: 'product', itemId: PRODUCT_ID, name: 'Test Oil', qty: 1, price: 1000 }]);
      const out = await refundOrderLines({
        businessId: BUSINESS_ID, tenantId: TENANT_ID, orderId: order.id, reason: 'Cancelled in time',
        lines: [{ orderItemId: order.items[0].id, quantity: 1 }], processedBy: STAFF_USER_ID, refundTo: 'account_credit',
      });
      expect(out.status).toBe('completed');
      const { rows: txn } = await adminPool.query('SELECT payment_method, is_processed FROM pay_transactions WHERE id = $1', [out.refundTransactionId]);
      expect(txn[0].payment_method).toBe('account_credit');
      const { rows: credit } = await adminPool.query('SELECT remaining_cents, status FROM pay_account_credits WHERE source_transaction_id = $1', [out.refundTransactionId]);
      expect(credit[0]).toMatchObject({ remaining_cents: out.amountCents, status: 'available' });
      const gl = await journalLines('order_refund', out.refundTransactionId);
      expect(gl.find((l: any) => l.code === '2500')?.credit).toBe(out.amountCents);
      expect(gl.some((l: any) => l.code === '1100')).toBe(false);
    });

    it('does not refund a service line unless it is a visit cancelled in advance', async () => {
      const order = await paidOrder([{ itemType: 'service', name: 'Massage', qty: 1, price: 6000 }]);
      await expect(refundOrderLines({
        businessId: BUSINESS_ID, tenantId: TENANT_ID, orderId: order.id, reason: 'x',
        lines: [{ orderItemId: order.items[0].id, quantity: 1 }], processedBy: STAFF_USER_ID,
      })).rejects.toThrow(/not refundable/);
      const out = await refundOrderLines({
        businessId: BUSINESS_ID, tenantId: TENANT_ID, orderId: order.id, reason: 'Appointment cancelled by the customer',
        lines: [{ orderItemId: order.items[0].id, quantity: 1 }], processedBy: STAFF_USER_ID, allowServiceLines: true,
      });
      expect(out.orderStatus).toBe('refunded');
    });
  });

  describe('hosting business', () => {
    it('is the business of the event location; a customer of another business gets a record there, matched by email', async () => {
      const locId = (await adminPool.query(
        `INSERT INTO sys_locations (business_id, name, slug, status) VALUES ($1, 'CEV Studio', 'cev-studio-' || floor(random() * 1e9)::text, 'active') RETURNING id`,
        [OTHER_BUSINESS_ID],
      )).rows[0].id;
      const typeId = (await adminPool.query(`SELECT id FROM evt_types WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID])).rows[0].id;
      const eventId = (await adminPool.query(
        `INSERT INTO evt_events (tenant_id, event_type_id, title, slug, start_time, end_time, capacity, status, location_id)
         VALUES ($1, $2, 'CEV Hosted', 'cev-hosted-' || floor(random() * 1e9)::text, NOW() + INTERVAL '3 days', NOW() + INTERVAL '3 days 1 hour', 5, 'published', $3)
         RETURNING id`,
        [TENANT_ID, typeId, locId],
      )).rows[0].id;
      expect(await hostBusinessId(eventId)).toBe(OTHER_BUSINESS_ID);
      const there = await hostCustomerId(OTHER_BUSINESS_ID, CUSTOMER_ID, STAFF_USER_ID);
      const again = await hostCustomerId(OTHER_BUSINESS_ID, CUSTOMER_ID, STAFF_USER_ID);
      expect(there).not.toBe(CUSTOMER_ID);
      expect(again).toBe(there);
      const { rows } = await adminPool.query('SELECT business_id, email FROM cus_customers WHERE id = $1', [there]);
      expect(rows[0]).toEqual({ business_id: OTHER_BUSINESS_ID, email: 'cev-customer@example.test' });
      expect(await hostCustomerId(BUSINESS_ID, CUSTOMER_ID, STAFF_USER_ID)).toBe(CUSTOMER_ID);
      await adminPool.query('DELETE FROM evt_events WHERE id = $1', [eventId]);
    });
  });

  describe('commission after a refund (THE-21)', () => {
    it('takes the commission on the refunded part back on the day of the refund, or keeps it', async () => {
      await adminPool.query(
        `INSERT INTO fin_compensation_rules (business_id, user_id, rule_type, rate, effective_from) VALUES ($1, $2, 'commission', 1000, '2020-01-01')`,
        [BUSINESS_ID, STAFF_USER_ID],
      );
      const order = await paidOrder([{ itemType: 'product', itemId: PRODUCT_ID, name: 'Test Oil', qty: 2, price: 1000 }]);
      await refundOrderLines({
        businessId: BUSINESS_ID, tenantId: TENANT_ID, orderId: order.id, reason: 'Returned one',
        lines: [{ orderItemId: order.items[0].id, quantity: 1 }], processedBy: STAFF_USER_ID,
      });
      const today = new Date().toLocaleDateString('sv-SE');
      const mine = async () => (await computeOrderCommissionLines({ businessId: BUSINESS_ID, start: today, end: today }))
        .filter((l) => l.order_id === order.id);

      const takeBack = await mine(); // default: take back
      expect(takeBack.map((l) => [l.entry, l.commission])).toEqual(expect.arrayContaining([['Sale', 200], ['Refund', -100]]));
      expect(takeBack.reduce((n, l) => n + l.commission, 0)).toBe(100);

      await setRefundClawbackEnabled(BUSINESS_ID, false);
      const keep = await mine();
      expect(keep.map((l) => [l.entry, l.commission])).toEqual([['Sale', 200]]);
      await setRefundClawbackEnabled(BUSINESS_ID, true);
    });
  });
});
