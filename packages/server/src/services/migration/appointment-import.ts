import { adminPool } from '../../db/pool';
import {
  ImportResult, RowFailure, emptyResult, matchCustomer, noCustomerReason,
  matchByName, parseDateCell, fileDateOrder, customerMatchInput, DateOrder,
} from './import-core';
import { localToUtc } from '../../utils/business-time';

/**
 * Appointment import (spec 50, Wave 3). Brings across a customer's appointment history and
 * any already-booked future sessions. The split is the whole safety story:
 *
 *   FUTURE (start time ahead of now) → a real `apt_bookings` row (source 'import'), so it's a
 *     live, manageable booking. Written DIRECTLY, not through `createBooking`, so NONE of the
 *     booking rules run — availability, staff hours, lead time, capacity, conflicts are all
 *     skipped (the legacy data is brought in as-is; constraints apply only on a later edit) —
 *     and no confirmation email is sent. Status 'confirmed'.
 *
 *   PAST (start time at or before now) → a `cus_activities` timeline entry (activityType
 *     'booking') ONLY. No `apt_bookings` row, so it never touches availability, capacity or
 *     reporting. The entry's `created_at` is backdated to the appointment time so the timeline
 *     reads chronologically.
 *
 *   PACKAGE FULFILLMENT (past appointments only): if the customer holds an imported package
 *     purchase that covers this service and is still inside its validity window, a matching
 *     `pkg_redemptions` row is inserted so the remaining balance reflects history. Packages are
 *     imported before appointments (locked order), so the purchase already exists. Remaining
 *     balance is computed (quantity − SUM redeemed), so we never over-redeem — a used-up or
 *     expired package is skipped with a warning rather than driving the balance negative.
 *
 * No import ever sends an email; this path calls no notification code.
 */

interface MappedRow { [field: string]: string }

interface ServiceRow {
  id: string; name: string; status: string; booking_type: string;
  buffer_before: number; buffer_after: number;
}
interface VariantRow { id: string; duration: number; price: number }
interface StaffRow { name: string; user_id: string }
interface PackageItemRow {
  purchase_id: string; package_item_id: string; redemption_type: string;
  quantity: number; purchased_at: string; expires_at: string | null; package_name: string;
}

/** Appointment statuses that count as a completed/attended visit for fulfillment purposes. */
const ATTENDED = new Set(['completed', 'checked_in', 'in_progress', 'attended', 'done', 'fulfilled']);

/** Parse an optional time-of-day ("14:30", "2:30 PM", "0900") to minutes past midnight, or null. */
function parseTimeOfDay(value: string | null | undefined): number | null {
  const s = (value || '').trim();
  if (!s) return null;
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i) || s.match(/^(\d{1,2})\s*([ap]m)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[3] !== undefined ? Number(ampm[2]) : 0;
    const mer = (ampm[3] ?? ampm[2]).toLowerCase();
    if (h === 12) h = 0;
    if (mer === 'pm') h += 12;
    return h * 60 + min;
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const compact = s.match(/^(\d{2})(\d{2})$/);
  if (compact) return Number(compact[1]) * 60 + Number(compact[2]);
  return null;
}

/**
 * The appointment's start instant: the file's date and time are the business's own wall-clock
 * time (what the legacy calendar showed), so they're read in the business's time zone. Reading
 * them as UTC put a Madrid 14:30 booking at 15:30 or 16:30 local. Blank time = noon local.
 */
export function appointmentStart(dateStr: string, minutes: number | null, timeZone: string | null | undefined): Date {
  const m = minutes ?? 12 * 60;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return localToUtc(dateStr, hhmm, timeZone || 'UTC');
}

/**
 * Statuses meaning the appointment did not / will not happen. A FUTURE row with one of these is
 * not a live booking: it's recorded on the timeline as history instead of being booked.
 */
const NOT_HAPPENING = new Set([
  'cancelled', 'canceled', 'cancel', 'late cancel', 'late cancelled', 'late cancellation',
  'no show', 'noshow', 'missed', 'declined', 'rejected', 'void', 'voided',
]);

/** Normalise a status word: lowercase, underscores and hyphens as spaces, single spaces. */
export function normalizeStatus(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

/** True when a status says the appointment did not or will not happen. */
export function isNotHappening(raw: string | null | undefined): boolean {
  return NOT_HAPPENING.has(normalizeStatus(raw));
}

export async function runAppointmentImport(args: {
  businessId: string;
  tenantId: string;
  userId: string;
  rows: MappedRow[];
  commit: boolean;
  dateOrder?: DateOrder | null;
}): Promise<ImportResult> {
  const { businessId, userId, rows, commit } = args;
  const result = emptyResult();
  result.total = rows.length;
  const warnings: RowFailure[] = [];
  result.warnings = warnings;

  const { rows: services } = await adminPool.query<ServiceRow>(
    `SELECT id, name, status, booking_type, buffer_before, buffer_after FROM svc_services WHERE business_id = $1`,
    [businessId],
  );
  const { rows: staff } = await adminPool.query<{ user_id: string; first_name: string; last_name: string }>(
    `SELECT sp.user_id, sp.first_name, sp.last_name
     FROM stf_profiles sp JOIN usr_users u ON u.id = sp.user_id
     WHERE u.business_id = $1 AND sp.status = 'active'`,
    [businessId],
  );
  const staffCandidates: StaffRow[] = staff.map((s) => ({ name: `${s.first_name} ${s.last_name}`, user_id: s.user_id }));

  const now = new Date();
  const { rows: biz } = await adminPool.query<{ timezone: string | null }>(
    'SELECT timezone FROM sys_businesses WHERE id = $1', [businessId],
  );
  const timeZone = biz[0]?.timezone || 'UTC';
  const dateOrder = await fileDateOrder(businessId, rows, ['date'], args.dateOrder);
  // (customer|service|startISO) already handled in THIS file, so a trial matches the commit.
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const r = rows[i];
    const fail = (field: string, message: string) => {
      result.failed += 1;
      result.failures.push({ row: rowNum, field, message });
    };

    // --- service ---
    const svcMatch = matchByName(services, r.service, 'service');
    if (!svcMatch.match) { fail('service', svcMatch.reason!); continue; }
    const service = svcMatch.match;
    if (service.status === 'archived') {
      fail('service', `The service "${service.name}" is archived and can't take a booking — reactivate it first`);
      continue;
    }

    // --- date/time ---
    const dateStr = parseDateCell(r.date, dateOrder);
    if (!dateStr) {
      fail('date', (r.date || '').trim() ? `"${r.date}" is not a valid date` : 'An appointment date is required');
      continue;
    }
    if ((r.time || '').trim() && parseTimeOfDay(r.time) === null) {
      fail('time', `"${r.time}" is not a time (use something like 14:30, 2:30 PM or 1430)`);
      continue;
    }
    const startTime = appointmentStart(dateStr, parseTimeOfDay(r.time), timeZone);

    // --- customer ---
    const matchInput = customerMatchInput(r);
    const match = await matchCustomer(businessId, matchInput);
    if (!match.customerId) { fail('customer', noCustomerReason(matchInput)); continue; }
    const customerId = match.customerId;

    // --- staff (optional) ---
    let staffUserId: string | null = null;
    if ((r.staff || '').trim()) {
      const staffMatch = matchByName(staffCandidates, r.staff, 'staff member');
      if (!staffMatch.match) { fail('staff', staffMatch.reason!); continue; }
      staffUserId = staffMatch.match.user_id;
    }

    // --- variant: match by stated duration if given, else the first active variant ---
    const { rows: variants } = await adminPool.query<VariantRow>(
      `SELECT id, duration, price FROM svc_variants
       WHERE service_id = $1 AND status = 'active' ORDER BY display_order, price`,
      [service.id],
    );
    if (variants.length === 0) {
      fail('service', `The service "${service.name}" has no bookable option configured — add one in setup first`);
      continue;
    }
    const wantedDuration = Number((r.duration || '').trim());
    const variant = (wantedDuration > 0 && variants.find((v) => v.duration === wantedDuration)) || variants[0];
    const endTime = new Date(startTime.getTime() + variant.duration * 60000);

    // A live booking is a FUTURE appointment that is still going to happen. A future row marked
    // cancelled / no-show is history: it goes on the timeline, never into the calendar.
    const isFuture = startTime.getTime() > now.getTime();
    const isLiveBooking = isFuture && !isNotHappening(r.status);
    const startISO = startTime.toISOString();

    // --- idempotency: customer + service + start time ---
    const key = `${customerId}|${service.id}|${startISO}`;
    if (seen.has(key)) { result.matched += 1; continue; }
    const existing = isLiveBooking
      ? await adminPool.query(
        `SELECT 1 FROM apt_bookings WHERE business_id = $1 AND customer_id = $2 AND service_id = $3 AND start_time = $4 LIMIT 1`,
        [businessId, customerId, service.id, startISO])
      : await adminPool.query(
        `SELECT 1 FROM cus_activities WHERE business_id = $1 AND customer_id = $2 AND activity_type = 'booking'
           AND metadata->>'service_id' = $3 AND metadata->>'start_time' = $4 LIMIT 1`,
        [businessId, customerId, service.id, startISO]);
    seen.add(key);
    if (existing.rows.length > 0) { result.matched += 1; continue; }

    if (!commit) { result.imported += 1; continue; }

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      if (isLiveBooking) {
        // Direct insert — bypasses createBooking's rules and notifications entirely.
        const { rows: refRow } = await client.query(`SELECT generate_booking_reference($1) AS ref`, [businessId]);
        await client.query(
          `INSERT INTO apt_bookings
             (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time,
              buffer_before, buffer_after, status, booking_reference, booking_type, price,
              created_by, participant_count, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,1,'import')`,
          [businessId, customerId, service.id, variant.id, staffUserId, startISO, endTime.toISOString(),
            service.buffer_before, service.buffer_after, refRow[0].ref, service.booking_type, variant.price,
            userId || null],
        );
      } else {
        // Past: timeline entry only, backdated to the appointment time.
        const statusRaw = (r.status || '').trim();
        await client.query(
          `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by, created_at)
           VALUES ($1,$2,'booking',$3,$4,$5,$6)`,
          [customerId, businessId,
            `${service.name}${staffUserId ? '' : ''}${statusRaw ? ` — ${statusRaw}` : ''}`,
            JSON.stringify({
              imported: true, service_id: service.id, service_name: service.name,
              start_time: startISO, staff_id: staffUserId, status: statusRaw || 'completed',
            }),
            userId || null, startISO],
        );

        // Package-fulfillment derivation for attended PAST appointments ("checked in", "checked-in"
        // and "checked_in" all count). A future cancelled row never uses up a session.
        const attended = !isFuture
          && (!statusRaw || ATTENDED.has(normalizeStatus(statusRaw).replace(/ /g, '_')));
        if (attended) {
          const w = await deriveFulfillment(client, { businessId, customerId, service, variant, startISO, rowNum });
          if (w) warnings.push(w);
        }
      }
      await client.query('COMMIT');
      result.imported += 1;
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      fail('general', e?.message || 'Failed to import appointment');
    } finally {
      client.release();
    }
  }

  return result;
}

/**
 * If an imported package covers this service and still has balance at the appointment date,
 * redeem one unit against the oldest qualifying purchase. Returns a warning when the service
 * is covered by a package the customer holds but none had balance/validity left (so the owner
 * knows history couldn't be fully reconciled); returns null when there's nothing to do.
 */
async function deriveFulfillment(
  client: any,
  args: { businessId: string; customerId: string; service: ServiceRow; variant: VariantRow; startISO: string; rowNum: number },
): Promise<RowFailure | null> {
  const { businessId, customerId, service, variant, startISO, rowNum } = args;

  // Candidate imported purchases covering this service, still valid at the appointment date,
  // oldest first (consume the earliest-bought package before later ones).
  const { rows: items } = await client.query(
    `SELECT pp.id AS purchase_id, pi.id AS package_item_id, pi.redemption_type, pi.quantity,
            pp.purchased_at, pp.expires_at, k.name AS package_name
     FROM pkg_purchases pp
     JOIN pkg_package_items pi ON pi.package_id = pp.package_id
     JOIN pkg_packages k ON k.id = pp.package_id
     WHERE pp.business_id = $1 AND pp.customer_id = $2 AND pp.status = 'active'
       AND pp.source = 'import'
       AND pi.service_id = $3
       AND (pp.expires_at IS NULL OR pp.expires_at >= $4)
       AND pp.purchased_at <= $4
     ORDER BY pp.purchased_at ASC`,
    [businessId, customerId, service.id, startISO],
  ) as { rows: PackageItemRow[] };

  if (items.length === 0) return null; // service isn't covered by any imported package the customer holds

  for (const item of items) {
    if (item.redemption_type === 'minutes') {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(minutes_redeemed),0)::int AS used FROM pkg_redemptions WHERE package_item_id = $1 AND purchase_id = $2`,
        [item.package_item_id, item.purchase_id],
      );
      const remaining = item.quantity - rows[0].used;
      if (remaining >= variant.duration) {
        await client.query(
          `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, minutes_redeemed, redeemed_at, notes)
           VALUES ($1,$2,1,$3,$4,'Imported appointment')`,
          [item.purchase_id, item.package_item_id, variant.duration, startISO],
        );
        return null;
      }
    } else {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(quantity_redeemed),0)::int AS used FROM pkg_redemptions WHERE package_item_id = $1 AND purchase_id = $2`,
        [item.package_item_id, item.purchase_id],
      );
      const remaining = item.quantity - rows[0].used;
      if (remaining >= 1) {
        await client.query(
          `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, redeemed_at, notes)
           VALUES ($1,$2,1,$3,'Imported appointment')`,
          [item.purchase_id, item.package_item_id, startISO],
        );
        return null;
      }
    }
  }

  // Covered, but every qualifying package was already fully redeemed.
  return {
    row: rowNum, field: 'service',
    message: `This ${service.name} appointment looks like it used a package, but the matching package(s) had no sessions/minutes left — imported to the timeline without a redemption`,
  };
}
