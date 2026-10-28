import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { findOrCreatePerson } from './person-identity.service';
import { getCancelSettings, customerCancelWindow } from './customer-cancellation.service';
import { promoteFromWaitlist } from './event-waitlist.service';

/**
 * Events for customers (THE-20): the organisation's published events, registering and
 * paying for them (online by card or at reception), the customer's own registrations,
 * and cancelling within the limits the hosting business sets.
 *
 * Events belong to the organisation; money belongs to a business. A paid ticket is sold
 * by the business that hosts the event: the business of the event's location, or, for
 * an event without a location, the business of the member of staff who created it. When
 * the customer belongs to another business of the organisation, a customer record is
 * found or created for them in the hosting business (matched by email), so the sale, the
 * receipt and any refund live there.
 */

export class CustomerEventError extends Error {
  constructor(message: string, public status = 400, public code = 'VALIDATION_ERROR') { super(message); }
}

/** A registration that takes a place: confirmed, or pending and still held. */
export const HOLDS_PLACE = `(r.status = 'confirmed' OR (r.status = 'pending' AND (r.hold_expires_at IS NULL OR r.hold_expires_at > NOW())))`;

/** Minutes an online payment holds the place before it is released. */
export const ONLINE_HOLD_MINUTES = 10;

/**
 * Release online payments that were started but not finished in time: the registration
 * is cancelled, its open order voided, and the next person on the waitlist offered the
 * place. A place to be paid at reception stays held until the event starts (and after,
 * so reception can still take the payment at the door).
 */
export async function releaseExpiredOnlineHolds(eventId?: string): Promise<number> {
  const { rows } = await adminPool.query(
    `UPDATE evt_registrations SET status = 'cancelled', cancelled_at = NOW()
      WHERE status = 'pending' AND pay_at = 'online' AND hold_expires_at IS NOT NULL AND hold_expires_at <= NOW()
        ${eventId ? 'AND event_id = $1' : ''}
      RETURNING id, order_id, event_id`,
    eventId ? [eventId] : [],
  );
  for (const r of rows) {
    if (r.order_id) await adminPool.query(`UPDATE fin_orders SET status = 'voided', updated_at = NOW() WHERE id = $1 AND status = 'open'`, [r.order_id]);
  }
  for (const id of new Set(rows.map((r: any) => r.event_id as string))) await promoteFromWaitlist(id).catch(() => undefined);
  return rows.length;
}

/** The business that hosts (and sells) an event; null when none can be told. */
export async function hostBusinessId(eventId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(l.business_id, u.business_id) AS business_id
       FROM evt_events e
       LEFT JOIN sys_locations l ON l.id = e.location_id
       LEFT JOIN usr_users u ON u.id = e.created_by
      WHERE e.id = $1`,
    [eventId],
  );
  return rows[0]?.business_id ?? null;
}

async function hostTaxRate(eventId: string, hostId: string | null): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(
        (SELECT tc.rate FROM evt_events e JOIN svc_tax_categories tc ON tc.id = e.tax_category_id WHERE e.id = $1),
        (SELECT rate FROM svc_tax_categories WHERE business_id = $2 AND is_default = true LIMIT 1),
        0) AS rate`,
    [eventId, hostId],
  );
  return Number(rows[0]?.rate || 0);
}

/** Customers with an active membership at the hosting business may choose "members only" tickets. */
async function hasActiveMembership(customerIds: string[], businessId: string | null): Promise<boolean> {
  if (!businessId || customerIds.length === 0) return false;
  const { rows } = await adminPool.query(
    `SELECT 1 FROM mbr_enrollments WHERE business_id = $1 AND customer_id = ANY($2) AND status = 'active' LIMIT 1`,
    [businessId, customerIds],
  );
  return rows.length > 0;
}

/**
 * First-time customers (David, 2026-10-22): no earlier completed visit (appointment) and no
 * earlier purchase (completed order) at the hosting business.
 */
async function isFirstTimeCustomer(customerIds: string[], businessId: string | null): Promise<boolean> {
  if (!businessId) return false;
  if (customerIds.length === 0) return true;
  const { rows } = await adminPool.query(
    `SELECT 1 FROM apt_bookings WHERE business_id = $1 AND customer_id = ANY($2) AND status = 'completed'
     UNION ALL
     SELECT 1 FROM fin_orders WHERE business_id = $1 AND customer_id = ANY($2) AND status IN ('completed', 'partially_refunded', 'refunded')
     LIMIT 1`,
    [businessId, customerIds],
  );
  return rows.length === 0;
}

/** What the customer qualifies for at the hosting business. */
interface Standing { member: boolean; firstTime: boolean }

async function standingAt(customerIds: string[], businessId: string | null): Promise<Standing> {
  return { member: await hasActiveMembership(customerIds, businessId), firstTime: await isFirstTimeCustomer(customerIds, businessId) };
}

/**
 * Ticket types offered to customers: everyone, members only, first-time customers only.
 * "Custom" is not defined, so customers are not offered it (David, 2026-10-22).
 */
const OFFERED_ELIGIBILITY = ['all', 'members_only', 'first_time'];

function tierState(t: any, who: Standing, now = new Date()) {
  const eligibility = t.eligibility_type || 'all';
  const left = t.quantity_available ? Math.max(t.quantity_available - Number(t.taken || 0), 0) : null;
  let unavailable: string | null = null;
  if (t.availability_start && new Date(t.availability_start) > now) unavailable = 'Not on sale yet';
  else if (t.availability_end && new Date(t.availability_end) < now) unavailable = 'No longer on sale';
  else if (left === 0) unavailable = 'Sold out';
  else if (eligibility === 'members_only' && !who.member) unavailable = 'Members only';
  else if (eligibility === 'first_time' && !who.firstTime) unavailable = 'First-time customers only';
  return {
    id: t.id, name: t.name, description: t.description, price: t.price,
    eligibility, places_left: left, available: !unavailable, unavailable_reason: unavailable,
  };
}

async function eventRows(where: string, params: any[]) {
  const { rows } = await adminPool.query(
    `SELECT e.id, e.slug, e.title, e.description, e.start_time, e.end_time, e.location_name, e.capacity,
            e.status, e.cover_image_path, et.name AS event_type_name,
            COALESCE(l.business_id, u.business_id) AS host_business_id, b.name AS host_business_name, b.timezone AS host_timezone,
            b.currency AS currency,
            (SELECT COALESCE(SUM(r.group_size), 0)::int FROM evt_registrations r WHERE r.event_id = e.id AND ${HOLDS_PLACE}) AS taken
       FROM evt_events e
       LEFT JOIN evt_types et ON et.id = e.event_type_id
       LEFT JOIN sys_locations l ON l.id = e.location_id
       LEFT JOIN usr_users u ON u.id = e.created_by
       LEFT JOIN sys_businesses b ON b.id = COALESCE(l.business_id, u.business_id)
      WHERE ${where}
      ORDER BY e.start_time ASC`,
    params,
  );
  return rows;
}

async function tiersOf(eventIds: string[]) {
  if (eventIds.length === 0) return [] as any[];
  const { rows } = await adminPool.query(
    `SELECT tt.*,
            (SELECT COALESCE(SUM(r.group_size), 0)::int FROM evt_registrations r WHERE r.ticket_tier_id = tt.id AND ${HOLDS_PLACE}) AS taken
       FROM evt_ticket_tiers tt
      WHERE tt.event_id = ANY($1) AND COALESCE(tt.eligibility_type, 'all') = ANY($2)
      ORDER BY tt.display_order ASC, tt.created_at ASC`,
    [eventIds, OFFERED_ELIGIBILITY],
  );
  return rows;
}

async function myRegistrations(customerIds: string[], eventIds?: string[]) {
  if (customerIds.length === 0) return { regs: [] as any[], waits: [] as any[] };
  const { rows: regs } = await adminPool.query(
    `SELECT r.id, r.event_id, r.status, r.pay_at, r.group_size, r.amount_paid, r.reference_number, r.order_id,
            r.hold_expires_at, r.created_at, r.cancelled_at, r.refund_amount, tt.name AS tier_name, tt.price AS tier_price,
            o.status AS order_status, o.total_amount AS order_total, o.order_number
       FROM evt_registrations r
       LEFT JOIN evt_ticket_tiers tt ON tt.id = r.ticket_tier_id
       LEFT JOIN fin_orders o ON o.id = r.order_id
      WHERE r.customer_id = ANY($1) ${eventIds ? 'AND r.event_id = ANY($2)' : ''}
      ORDER BY r.created_at DESC`,
    eventIds ? [customerIds, eventIds] : [customerIds],
  );
  const { rows: waits } = await adminPool.query(
    `SELECT w.id, w.event_id, w.status, w.position, w.expires_at, w.created_at
       FROM evt_waitlist w
      WHERE w.customer_id = ANY($1) AND w.status IN ('waiting', 'notified') ${eventIds ? 'AND w.event_id = ANY($2)' : ''}`,
    eventIds ? [customerIds, eventIds] : [customerIds],
  );
  return { regs, waits };
}

function summary(e: any, tiers: any[], who: Standing) {
  const own = tiers.filter((t) => t.event_id === e.id).map((t) => tierState(t, who));
  // "From" is the lowest ticket this customer can choose (as in the approved canvas); when
  // none is open to them, the lowest ticket of the event.
  const open = own.filter((t) => t.available);
  const prices = (open.length ? open : own).map((t) => t.price);
  return {
    id: e.id, slug: e.slug, title: e.title, description: e.description,
    start_time: e.start_time, end_time: e.end_time, location_name: e.location_name,
    event_type_name: e.event_type_name, host_business_id: e.host_business_id, host_business_name: e.host_business_name,
    timezone: e.host_timezone || 'UTC', currency: e.currency || 'EUR',
    capacity: e.capacity, places_left: Math.max(e.capacity - Number(e.taken || 0), 0),
    from_price: prices.length ? Math.min(...prices) : null,
    tiers: own,
  };
}

function registrationView(r: any, event: { start_time: string }, settings: Awaited<ReturnType<typeof getCancelSettings>>) {
  const active = r.status === 'confirmed' || r.status === 'pending';
  const window = customerCancelWindow(settings, event.start_time);
  const paid = r.order_status === 'completed' || r.order_status === 'partially_refunded';
  return {
    id: r.id, status: r.status, pay_at: r.pay_at, group_size: r.group_size, tier_name: r.tier_name,
    reference_number: r.reference_number, order_number: r.order_number, paid,
    amount: paid ? r.order_total : (r.tier_price || 0) * r.group_size,
    awaiting_payment: r.status === 'pending' ? (r.pay_at === 'online' ? 'online' : 'reception') : null,
    hold_expires_at: r.status === 'pending' && r.pay_at === 'online' ? r.hold_expires_at : null,
    can_cancel: active && window.allowed,
    cancel_until: active ? window.until : null,
    cancel_blocked_reason: active && !window.allowed ? window.reason : null,
    refund_to: paid ? settings.cancel_refund_to : null,
  };
}

/** Upcoming published events of the organisation, with the customer's own status. */
export async function listForCustomer(tenantId: string, customerIds: string[]) {
  await releaseExpiredOnlineHolds();
  const events = await eventRows(`e.tenant_id = $1 AND e.status = 'published' AND e.start_time > NOW() AND e.deleted_at IS NULL`, [tenantId]);
  const tiers = await tiersOf(events.map((e) => e.id));
  const { regs, waits } = await myRegistrations(customerIds, events.map((e) => e.id));
  const standing = new Map<string, Standing>();
  for (const hostId of new Set(events.map((e) => e.host_business_id).filter(Boolean))) {
    standing.set(hostId, await standingAt(customerIds, hostId));
  }
  return events.map((e) => {
    const mine = regs.find((r) => r.event_id === e.id && (r.status === 'confirmed' || r.status === 'pending'));
    const wait = waits.find((w) => w.event_id === e.id);
    return {
      ...summary(e, tiers, standing.get(e.host_business_id) || { member: false, firstTime: false }),
      my_status: mine ? (mine.status === 'pending' ? 'awaiting_payment' : 'registered') : wait ? 'waitlisted' : null,
    };
  });
}

/** One event as a customer sees it: tickets they can choose, totals with tax, and their own registration. */
export async function eventForCustomer(tenantId: string, eventId: string, customerIds: string[]) {
  await releaseExpiredOnlineHolds(eventId);
  const [e] = await eventRows(`e.tenant_id = $1 AND e.id = $2 AND e.status IN ('published', 'completed', 'cancelled') AND e.deleted_at IS NULL`, [tenantId, eventId]);
  if (!e) throw new CustomerEventError('Event not found', 404, 'NOT_FOUND');
  const tiers = await tiersOf([e.id]);
  const who = await standingAt(customerIds, e.host_business_id);
  const settings = await getCancelSettings(e.host_business_id, 'events');
  const { regs, waits } = await myRegistrations(customerIds, [e.id]);
  const taxRate = await hostTaxRate(e.id, e.host_business_id);
  const online = await canPayOnline(e.host_business_id);
  return {
    ...summary(e, tiers, who),
    status: e.status,
    open_for_registration: e.status === 'published' && new Date(e.start_time) > new Date(),
    is_member: who.member,
    is_first_time: who.firstTime,
    tax_rate: taxRate,
    pay_options: { online, reception: true },
    cancellation: {
      allowed: settings.customer_cancel_enabled,
      hours_before: settings.customer_cancel_enabled ? settings.customer_cancel_hours : null,
      refund_to: settings.cancel_refund_to,
    },
    my_registrations: regs.map((r) => registrationView(r, e, settings)),
    my_waitlist: waits.map((w) => ({ id: w.id, status: w.status, position: w.position, expires_at: w.expires_at })),
  };
}

/** The customer's own registrations and waitlist places, upcoming first. */
export async function myEvents(tenantId: string, customerIds: string[]) {
  await releaseExpiredOnlineHolds();
  const { regs, waits } = await myRegistrations(customerIds);
  const ids = Array.from(new Set([...regs.map((r) => r.event_id), ...waits.map((w) => w.event_id)]));
  if (ids.length === 0) return [];
  const events = await eventRows(`e.tenant_id = $1 AND e.id = ANY($2)`, [tenantId, ids]);
  const settingsOf = new Map<string, any>();
  for (const e of events) if (!settingsOf.has(e.host_business_id)) settingsOf.set(e.host_business_id, await getCancelSettings(e.host_business_id, 'events'));
  const out: any[] = [];
  for (const e of events) {
    const base = {
      event_id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time, location_name: e.location_name,
      host_business_name: e.host_business_name, timezone: e.host_timezone || 'UTC', currency: e.currency || 'EUR', event_status: e.status,
      upcoming: new Date(e.start_time) > new Date(),
    };
    for (const r of regs.filter((x) => x.event_id === e.id)) out.push({ ...base, kind: 'registration', ...registrationView(r, e, settingsOf.get(e.host_business_id)) });
    for (const w of waits.filter((x) => x.event_id === e.id)) out.push({ ...base, kind: 'waitlist', id: w.id, status: w.status, position: w.position, expires_at: w.expires_at });
  }
  // Upcoming first, soonest first; then past events, latest first.
  return out.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    const diff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    return a.upcoming ? diff : -diff;
  });
}

/** Whether the hosting business takes card payments online (a connected processor). */
export async function canPayOnline(businessId: string | null): Promise<boolean> {
  if (!businessId) return false;
  const { resolveConnectedAccount } = await import('./payment-methods.service');
  return !!(await resolveConnectedAccount({ ownerLevel: 'customer', businessId }).catch(() => null));
}

/**
 * The customer's record at the hosting business: one of their own records there, or a
 * new one made from the record they registered with (matched by email).
 */
export async function hostCustomerId(hostId: string, customerId: string, userId: string): Promise<string> {
  const { rows: src } = await adminPool.query(
    `SELECT c.id, c.business_id, c.tenant_id, c.first_name, c.last_name, c.email, c.phone FROM cus_customers c WHERE c.id = $1`, [customerId]);
  const me = src[0];
  if (!me) throw new CustomerEventError('Customer not found', 404, 'NOT_FOUND');
  if (me.business_id === hostId) return me.id;
  const { rows: there } = await adminPool.query(
    `SELECT id FROM cus_customers
      WHERE business_id = $1 AND status = 'active'
        AND (user_id = $2 OR (LOWER(email) = LOWER($3) AND $3 <> ''))
      ORDER BY (user_id = $2) DESC NULLS LAST LIMIT 1`,
    [hostId, userId, me.email || ''],
  );
  if (there[0]) return there[0].id;
  if (!me.email && !me.phone) throw new CustomerEventError('Add an email address to your profile to register for this event', 400);
  const made = await findOrCreatePerson({
    businessId: hostId, tenantId: me.tenant_id, email: me.email, phone: me.phone,
    firstName: me.first_name, lastName: me.last_name, source: 'online_registration',
    sourceDetail: 'Event registration', userId, actorUserId: userId,
  });
  await adminPool.query('UPDATE cus_customers SET user_id = COALESCE(user_id, $2) WHERE id = $1', [made.person.id, userId]);
  return made.person.id;
}

/**
 * One person, one place per event (David, 2026-10-22): a person who already holds a place
 * (confirmed, or held for payment) or a waitlist place for the event cannot register again,
 * by themselves or through staff. To bring others, they choose more people when registering.
 * A person is matched across their customer records of the organisation by login or email.
 */
export async function assertNotAlreadyRegistered(eventId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `WITH me AS (SELECT tenant_id, user_id, LOWER(NULLIF(email, '')) AS email FROM cus_customers WHERE id = $2),
          person AS (
            SELECT c.id FROM cus_customers c, me
             WHERE c.tenant_id = me.tenant_id
               AND (c.id = $2 OR (me.user_id IS NOT NULL AND c.user_id = me.user_id) OR (me.email IS NOT NULL AND LOWER(c.email) = me.email))
          )
     SELECT 'registered' AS what FROM evt_registrations r
      WHERE r.event_id = $1 AND r.customer_id IN (SELECT id FROM person) AND ${HOLDS_PLACE}
     UNION ALL
     SELECT 'waitlisted' FROM evt_waitlist w
      WHERE w.event_id = $1 AND w.customer_id IN (SELECT id FROM person) AND w.status IN ('waiting', 'notified')
     LIMIT 1`,
    [eventId, customerId],
  );
  if (rows[0]) {
    throw new CustomerEventError(rows[0].what === 'registered'
      ? 'Already registered for this event. To bring others, cancel and register again choosing more people, or contact the business.'
      : 'Already on the waitlist for this event', 409, 'ALREADY_REGISTERED');
  }
}

/** Check a customer may choose this ticket for this event (open, eligible, on sale). */
export async function assertCustomerMayRegister(eventId: string, tierId: string | undefined, customerIds: string[]) {
  const { rows } = await adminPool.query(`SELECT start_time, status FROM evt_events WHERE id = $1`, [eventId]);
  if (!rows[0] || rows[0].status !== 'published') throw new CustomerEventError('This event is not open for registration', 409, 'CONFLICT');
  if (new Date(rows[0].start_time) <= new Date()) throw new CustomerEventError('This event has already started', 409, 'CONFLICT');
  if (!tierId) throw new CustomerEventError('Choose a ticket', 400);
  const { rows: t } = await adminPool.query(`SELECT * FROM evt_ticket_tiers WHERE id = $1 AND event_id = $2`, [tierId, eventId]);
  if (!t[0]) throw new CustomerEventError('Ticket not found', 404, 'NOT_FOUND');
  const eligibility = t[0].eligibility_type || 'all';
  if (!OFFERED_ELIGIBILITY.includes(eligibility)) throw new CustomerEventError('This ticket is not available', 409, 'CONFLICT');
  const now = new Date();
  if (t[0].availability_start && new Date(t[0].availability_start) > now) throw new CustomerEventError('This ticket is not on sale yet', 409, 'CONFLICT');
  if (t[0].availability_end && new Date(t[0].availability_end) < now) throw new CustomerEventError('This ticket is no longer on sale', 409, 'CONFLICT');
  if (eligibility === 'members_only' && !(await hasActiveMembership(customerIds, await hostBusinessId(eventId)))) {
    throw new CustomerEventError('This ticket is for members only: it needs an active membership', 403, 'MEMBERS_ONLY');
  }
  if (eligibility === 'first_time' && !(await isFirstTimeCustomer(customerIds, await hostBusinessId(eventId)))) {
    throw new CustomerEventError('This ticket is for first-time customers only', 403, 'FIRST_TIME_ONLY');
  }
  return t[0];
}

/**
 * Sell the ticket of a registration in the hosting business: an open order with one
 * "event" line (quantity = places, taxed at the event's tax), linked to the registration.
 */
export async function createTicketOrder(registrationId: string, checkedOutBy: string) {
  const { rows } = await adminPool.query(
    `SELECT r.id, r.event_id, r.customer_id, r.group_size, r.order_id, tt.name AS tier_name, tt.price, e.title
       FROM evt_registrations r JOIN evt_ticket_tiers tt ON tt.id = r.ticket_tier_id JOIN evt_events e ON e.id = r.event_id
      WHERE r.id = $1`,
    [registrationId],
  );
  const r = rows[0];
  if (!r) throw new CustomerEventError('Registration not found', 404, 'NOT_FOUND');
  const hostId = await hostBusinessId(r.event_id);
  if (!hostId) throw new CustomerEventError('This event has no hosting business to take the payment', 409, 'CONFLICT');
  if (r.order_id) {
    const { rows: o } = await adminPool.query(`SELECT id, status FROM fin_orders WHERE id = $1`, [r.order_id]);
    if (o[0]?.status === 'open') return { orderId: o[0].id as string, hostId };
  }
  const checkout = await import('./checkout.service');
  const order = await checkout.createOrder({ businessId: hostId, customerId: r.customer_id, checkedOutBy, notes: `Event: ${r.title}` });
  await checkout.addItem(order.id, {
    itemType: 'event', itemId: r.event_id, itemName: r.title, variantName: r.tier_name,
    quantity: r.group_size, unitPrice: r.price,
  });
  await adminPool.query(`UPDATE evt_registrations SET order_id = $2 WHERE id = $1`, [registrationId, order.id]);
  return { orderId: order.id as string, hostId };
}

export type EventEmailKind = 'confirmed' | 'reserved' | 'cancelled';

/**
 * Event emails to the customer (David, 2026-10-22): registration confirmed, place reserved to
 * be paid at reception, registration cancelled. Transactional: queued like a booking
 * confirmation and covered by the "transactional emails" switch. Dates and times are
 * written in the hosting business's time zone. Never fails the action that sends it.
 */
export async function queueEventEmail(registrationId: string, kind: EventEmailKind, refund?: { amount: number; to: 'card' | 'credit' } | null) {
  try {
    const { rows } = await adminPool.query(
      `SELECT r.id, r.reference_number, r.group_size, r.customer_id, r.event_id, tt.name AS tier_name, tt.price,
              o.total_amount, o.status AS order_status,
              e.title, e.start_time, e.end_time, e.location_name,
              c.business_id, c.email, c.first_name, c.last_name
         FROM evt_registrations r
         JOIN evt_events e ON e.id = r.event_id
         JOIN cus_customers c ON c.id = r.customer_id
         LEFT JOIN evt_ticket_tiers tt ON tt.id = r.ticket_tier_id
         LEFT JOIN fin_orders o ON o.id = r.order_id
        WHERE r.id = $1`,
      [registrationId],
    );
    const r = rows[0];
    if (!r || !r.email) return;
    const hostId = (await hostBusinessId(r.event_id)) || r.business_id;
    const { rows: biz } = await adminPool.query('SELECT timezone, currency FROM sys_businesses WHERE id = $1', [hostId]);
    const tz = biz[0]?.timezone || 'UTC';
    const currency = biz[0]?.currency || 'EUR';
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(d);
    const start = new Date(r.start_time);
    const money = (c: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(c / 100);
    const toPay = r.total_amount ?? (r.price || 0) * r.group_size;
    const { queueNotification } = await import('./booking-notifications.service');
    await queueNotification({
      businessId: r.business_id,
      type: `event.registration_${kind}`,
      recipientId: r.customer_id,
      recipientEmail: r.email,
      data: {
        customer_name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null,
        event_title: r.title,
        when_text: `${fmt(start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmt(start, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}–${fmt(new Date(r.end_time), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`,
        location: r.location_name || null,
        ticket_text: `${r.tier_name || 'Ticket'}${r.group_size > 1 ? ` × ${r.group_size}` : ''}`,
        booking_reference: r.reference_number,
        amount_text: kind === 'reserved' && toPay > 0 ? `To pay at reception: ${money(toPay)}` : null,
        refund_text: kind === 'cancelled' && refund && refund.amount > 0
          ? `${money(refund.amount)} ${refund.to === 'credit' ? 'has been added to your account credit' : 'will be refunded to your card'}`
          : null,
      },
    });
  } catch (e: any) {
    logger.warn(`Event email ${kind} for registration ${registrationId} not queued: ${e?.message || e}`);
  }
}

/** Once the ticket's order is paid: the registration is confirmed and records what was paid. */
export async function markRegistrationPaid(registrationId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_registrations r SET status = 'confirmed', hold_expires_at = NULL, amount_paid = o.total_amount
       FROM fin_orders o
      WHERE r.id = $1 AND o.id = r.order_id AND o.status = 'completed' AND r.status IN ('pending', 'confirmed')
      RETURNING r.*`,
    [registrationId],
  );
  if (!rows[0]) throw new CustomerEventError('The payment for this registration was not completed', 409, 'CONFLICT');
  return rows[0];
}

/**
 * Cancel a registration and give the money back as the hosting business set it: to the
 * card, or as account credit. `byCustomer` applies the business's cancellation limits.
 */
export async function cancelOwnRegistration(args: { registrationId: string; tenantId: string; userId: string; byCustomer: boolean }) {
  const { rows } = await adminPool.query(
    `SELECT r.*, e.start_time, e.title, e.tenant_id, o.status AS order_status, o.business_id AS order_business_id
       FROM evt_registrations r JOIN evt_events e ON e.id = r.event_id LEFT JOIN fin_orders o ON o.id = r.order_id
      WHERE r.id = $1 AND e.tenant_id = $2`,
    [args.registrationId, args.tenantId],
  );
  const r = rows[0];
  if (!r) throw new CustomerEventError('Registration not found', 404, 'NOT_FOUND');
  if (!['confirmed', 'pending'].includes(r.status)) throw new CustomerEventError('This registration is already cancelled', 409, 'CONFLICT');
  const hostId = await hostBusinessId(r.event_id);
  const settings = await getCancelSettings(hostId, 'events');
  if (args.byCustomer) {
    const window = customerCancelWindow(settings, r.start_time);
    if (!window.allowed) throw new CustomerEventError(window.reason || 'It can no longer be cancelled online', 409, 'CANCEL_NOT_ALLOWED');
  }

  // Money back first: if the refund fails, the place is kept and nothing changes.
  let refund: any = null;
  if (r.order_id && (r.order_status === 'completed' || r.order_status === 'partially_refunded')) {
    const { rows: lines } = await adminPool.query(
      `SELECT id, quantity - refunded_quantity AS left FROM fin_order_items WHERE order_id = $1 AND item_type = 'event' AND quantity > refunded_quantity`,
      [r.order_id],
    );
    if (lines.length > 0) {
      const { refundOrderLines } = await import('./order-refund.service');
      refund = await refundOrderLines({
        businessId: r.order_business_id, tenantId: args.tenantId, orderId: r.order_id,
        lines: lines.map((l: any) => ({ orderItemId: l.id, quantity: Number(l.left) })),
        reason: `Event registration cancelled${args.byCustomer ? ' by the customer' : ''}: ${r.title}`,
        processedBy: args.userId,
        refundTo: settings.cancel_refund_to === 'credit' ? 'account_credit' : 'original',
      });
      if (refund.status === 'failed') throw new CustomerEventError(refund.failureReason || 'The refund failed', 502, 'REFUND_FAILED');
    }
  } else if (r.order_id && r.order_status === 'open') {
    await adminPool.query(`UPDATE fin_orders SET status = 'voided', updated_at = NOW() WHERE id = $1 AND status = 'open'`, [r.order_id]);
  }

  const { rows: done } = await adminPool.query(
    `UPDATE evt_registrations SET status = 'cancelled', cancelled_at = NOW(), refund_amount = $2
      WHERE id = $1 AND status IN ('confirmed', 'pending') RETURNING *`,
    [r.id, refund?.amountCents ?? 0],
  );
  await promoteFromWaitlist(r.event_id).catch((e) => logger.warn(`Waitlist not promoted after cancelling ${r.id}: ${e?.message || e}`));
  await queueEventEmail(r.id, 'cancelled', refund ? { amount: refund.amountCents, to: settings.cancel_refund_to } : null);
  return {
    ...done[0],
    refund: refund ? { amount: refund.amountCents, to: settings.cancel_refund_to, status: refund.status, reference: refund.referenceNumber } : null,
  };
}
