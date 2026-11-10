import { adminPool } from '../db/pool';
import { encrypt, decrypt } from '../utils/encryption';
import { completeCheckIn, CheckInRefused, findTodaysBookingByContact, BOOKING_IS_TODAY } from './checkin.service';
import type { BookingRef } from './checkin.service';
import { validateQrCode, isLinkCode } from './checkin-qr.service';
import { getCustomerFormStatus } from './form-status.service';
import { createRequest } from './form-completion.service';

/**
 * Self check-in with forms (spec 51, design 1.11a): a customer checks themselves in on the
 * front-desk kiosk or from their own phone, then sees every form that applies to the visit.
 *
 * Check-in comes first and is never held back by a form. Everything here is scoped to ONE booking,
 * carried in a SelfContext: from the personal link's code (phone) or from a short-lived encrypted
 * session handed to the kiosk after it identified the customer.
 */

export interface SelfContext {
  tenantId: string;
  businessId: string;
  customerId: string;
  bookingId: string;
}

const SESSION_MS = 30 * 60 * 1000;
const CHECKED_IN_STATUSES = ['checked_in', 'in_progress'];

// --- The kiosk session: encrypted, so it cannot be read or changed by the tablet ---

export function createSession(ctx: SelfContext): string {
  return encrypt(JSON.stringify({ ...ctx, exp: Date.now() + SESSION_MS }));
}

export function readSession(token: unknown): SelfContext | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 2000) return null;
  try {
    const p = JSON.parse(decrypt(token)) as Partial<SelfContext> & { exp?: number };
    if (!p.exp || p.exp < Date.now() || !p.tenantId || !p.businessId || !p.customerId || !p.bookingId) return null;
    return { tenantId: p.tenantId, businessId: p.businessId, customerId: p.customerId, bookingId: p.bookingId };
  } catch {
    return null;
  }
}

// --- Who is it? ---

async function contextOf(b: { id: string; customer_id: string | null; business_id: string }, tenantId: string): Promise<SelfContext | null> {
  if (!b.customer_id) return null;
  return { tenantId, businessId: b.business_id, customerId: b.customer_id, bookingId: b.id };
}

/** From the personal link of a phone (a long booking code). */
export async function contextFromLinkCode(code: string): Promise<SelfContext | null> {
  if (!isLinkCode(code)) return null;
  const qr = await validateQrCode(code);
  if (!qr || qr.code_type !== 'booking' || !qr.booking_id) return null;
  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.business_id, bus.tenant_id
       FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE b.id = $1 AND bus.tenant_id = $2`,
    [qr.booking_id, qr.tenant_id],
  );
  return rows[0] ? contextOf(rows[0], rows[0].tenant_id) : null;
}

/**
 * At the kiosk: a scanned QR code, or the phone number or email address on the booking. Never a
 * name. Someone already checked in today is found too, so they can come back for their forms.
 */
export async function contextFromKioskInput(
  input: { code?: string; phone?: string; email?: string },
  tenantId: string,
  businessId: string,
): Promise<{ ctx: SelfContext | null; ambiguous: boolean }> {
  if (input.code) {
    const qr = await validateQrCode(String(input.code).trim());
    if (qr && qr.tenant_id === tenantId) {
      const { rows } = await adminPool.query(
        `SELECT b.id, b.customer_id, b.business_id
           FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
          WHERE bus.tenant_id = $1 AND b.business_id = $2 AND b.status = ANY($3::text[]) AND ${BOOKING_IS_TODAY}
            AND (($4::uuid IS NOT NULL AND b.id = $4) OR ($5::uuid IS NOT NULL AND b.customer_id = $5))
          ORDER BY (b.status = 'confirmed') DESC, b.start_time ASC
          LIMIT 1`,
        [tenantId, businessId, ['confirmed', ...CHECKED_IN_STATUSES], qr.booking_id || null, qr.customer_id || null],
      );
      return { ctx: rows[0] ? await contextOf(rows[0], tenantId) : null, ambiguous: false };
    }
    return { ctx: null, ambiguous: false };
  }
  const found = await findTodaysBookingByContact({ phone: input.phone, email: input.email }, tenantId, businessId, { includeCheckedIn: true });
  return { ctx: found.booking ? await contextOf(found.booking, tenantId) : null, ambiguous: found.ambiguous };
}

// --- The visit and its forms ---

export interface SelfForm {
  groupId: string;
  name: string;
  /** missing and out_of_date need completing; done is ticked. */
  status: 'missing' | 'out_of_date' | 'done';
}

export interface SelfView {
  first_name: string;
  service_name: string;
  start_time: string;
  timezone: string;
  /** confirmed (not yet checked in), checked_in, or something that cannot be checked in. */
  status: string;
  checked_in: boolean;
}

export async function selfView(ctx: SelfContext): Promise<SelfView | null> {
  const { rows } = await adminPool.query(
    `SELECT b.status, b.start_time, s.name AS service_name, c.first_name, bus.timezone
       FROM apt_bookings b
       JOIN sys_businesses bus ON bus.id = b.business_id
       JOIN svc_services s ON s.id = b.service_id
       JOIN cus_customers c ON c.id = b.customer_id
      WHERE b.id = $1 AND b.customer_id = $2 AND bus.tenant_id = $3 AND b.business_id = $4`,
    [ctx.bookingId, ctx.customerId, ctx.tenantId, ctx.businessId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    first_name: r.first_name,
    service_name: r.service_name,
    start_time: r.start_time,
    timezone: r.timezone || 'UTC',
    status: r.status,
    checked_in: CHECKED_IN_STATUSES.includes(r.status),
  };
}

/** Every form that applies to the visit: those still to complete, and those already done. */
export async function selfForms(ctx: SelfContext): Promise<SelfForm[]> {
  const all = await getCustomerFormStatus(ctx.businessId, ctx.customerId, ctx.bookingId);
  return all
    .filter((f) => f.status === 'missing' || f.status === 'out_of_date' || f.status === 'done')
    .map((f) => ({ groupId: f.groupId, name: f.name, status: f.status as SelfForm['status'] }));
}

/**
 * Check the customer in. Already checked in is fine (they came back for their forms). A refused
 * check-in (too early, cancelled...) throws CheckInRefused with a message for the customer.
 */
export async function selfCheckIn(
  ctx: SelfContext, method: 'kiosk' | 'qr_self', locationId?: string,
): Promise<{ checkedInNow: boolean }> {
  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.business_id, b.status
       FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE b.id = $1 AND b.customer_id = $2 AND b.business_id = $3 AND bus.tenant_id = $4`,
    [ctx.bookingId, ctx.customerId, ctx.businessId, ctx.tenantId],
  );
  const booking = rows[0] as BookingRef | undefined;
  if (!booking) throw new CheckInRefused('We could not find your booking. Please see the front desk.');
  if (CHECKED_IN_STATUSES.includes(booking.status)) return { checkedInNow: false };
  await completeCheckIn(booking, { tenantId: ctx.tenantId, method, locationId, auditAction: 'checkin.self' });
  return { checkedInNow: true };
}

/**
 * Start one form for this visit on the device in the customer's hands. The customer's request is
 * created when they tap, not when the list is shown, so showing the list never cancels a form
 * someone is already filling in. Returns the path of the one-use form page.
 */
export async function startSelfForm(ctx: SelfContext, groupId: string): Promise<{ path: string }> {
  const forms = await selfForms(ctx);
  const form = forms.find((f) => f.groupId === groupId);
  if (!form || form.status === 'done') throw new CheckInRefused('That form is already complete.');
  const r = await createRequest({
    businessId: ctx.businessId, customerId: ctx.customerId, groupId, channel: 'device',
    bookingId: ctx.bookingId, createdBy: null,
  });
  if (!r.url) throw new CheckInRefused('The form could not be started. Please see the front desk.');
  return { path: new URL(r.url).pathname };
}

/**
 * What a kiosk or phone screen shows for one visit: a greeting, the visit and the list of forms.
 * No contact details and no ids of the person; only the first name.
 */
export async function selfScreen(ctx: SelfContext): Promise<SelfView & { forms: SelfForm[] }> {
  const view = await selfView(ctx);
  if (!view) throw new CheckInRefused('We could not find your booking. Please see the front desk.');
  return { ...view, forms: await selfForms(ctx) };
}
