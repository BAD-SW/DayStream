import { adminPool } from '../db/pool';

/**
 * Service add-ons (spec 51, gap 15; design 15). An add-on belongs to its service, like an option:
 * a name, a description and a price, added on the service (owner, 24 Nov 2026). It enhances the
 * service and adds no time. An add-on taken off a service is archived, so appointments that have
 * it keep it.
 */

export class AddonError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'INVALID') { super(message); this.name = 'AddonError'; }
}

/** An add-on of a service. (`addon_id` is the same as `id`, the name the booking screens use.) */
export interface ServiceAddon {
  id: string;
  addon_id: string;
  service_id: string;
  name: string;
  description: string | null;
  price: number;
  display_order: number;
}

/** A service's add-ons that can be chosen now, in its order. */
export async function serviceAddons(serviceId: string, businessId: string): Promise<ServiceAddon[]> {
  const { rows } = await adminPool.query(
    `SELECT a.id, a.id AS addon_id, a.service_id, a.name, a.description, a.price, a.display_order
       FROM svc_addons a JOIN svc_services s ON s.id = a.service_id
      WHERE a.service_id = $1 AND s.business_id = $2 AND a.status = 'active'
      ORDER BY a.display_order, a.created_at`,
    [serviceId, businessId],
  );
  return rows;
}

/**
 * Save a service's add-ons as listed: one with an id is updated, one without is added, and one
 * left out is archived (appointments that have it keep it, at the price it had).
 */
export async function setServiceAddons(
  serviceId: string, businessId: string,
  items: Array<{ addon_id?: string | null; name: string; description?: string | null; price: number }>,
  userId: string | null = null,
): Promise<ServiceAddon[]> {
  const { rows: svc } = await adminPool.query(
    'SELECT b.tenant_id FROM svc_services s JOIN sys_businesses b ON b.id = s.business_id WHERE s.id = $1 AND s.business_id = $2', [serviceId, businessId]);
  if (!svc[0]) throw new AddonError('Service not found', 'NOT_FOUND');
  for (const i of items) {
    if (!i.name || !i.name.trim()) throw new AddonError('Each add-on needs a name.', 'INVALID');
    if (!Number.isInteger(i.price) || i.price < 0) throw new AddonError('A price must be zero or more.', 'INVALID');
  }
  const keptIds = items.map((i) => i.addon_id).filter((id): id is string => !!id);
  if (keptIds.length > 0) {
    const { rows: own } = await adminPool.query('SELECT id FROM svc_addons WHERE service_id = $1 AND id = ANY($2::uuid[])', [serviceId, keptIds]);
    if (own.length !== new Set(keptIds).size) throw new AddonError('One or more add-ons are not this service\'s.', 'INVALID');
  }
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE svc_addons SET status = 'archived', updated_at = NOW()
        WHERE service_id = $1 AND status = 'active' AND NOT (id = ANY($2::uuid[]))`, [serviceId, keptIds]);
    for (const [n, i] of items.entries()) {
      if (i.addon_id) {
        await client.query(
          `UPDATE svc_addons SET name = $2, description = $3, price = $4, display_order = $5, status = 'active', updated_at = NOW() WHERE id = $1`,
          [i.addon_id, i.name.trim(), i.description?.trim() || null, i.price, n]);
      } else {
        await client.query(
          `INSERT INTO svc_addons (tenant_id, business_id, service_id, name, description, price, display_order, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [svc[0].tenant_id, businessId, serviceId, i.name.trim(), i.description?.trim() || null, i.price, n, userId]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
  return serviceAddons(serviceId, businessId);
}

/** The business's add-ons, with their service (for a package's included items). */
export async function businessAddons(businessId: string): Promise<Array<ServiceAddon & { service_name: string }>> {
  const { rows } = await adminPool.query(
    `SELECT a.id, a.id AS addon_id, a.service_id, a.name, a.description, a.price, a.display_order, s.name AS service_name
       FROM svc_addons a JOIN svc_services s ON s.id = a.service_id
      WHERE a.business_id = $1 AND a.status = 'active' AND s.status <> 'archived'
      ORDER BY lower(s.name), a.display_order`,
    [businessId],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// An appointment's add-ons (design 15.2)
// ---------------------------------------------------------------------------------------------

export interface BookingAddon {
  id: string; booking_id: string; addon_id: string; name: string; price: number;
  /** Paid already (on a completed order): it cannot be removed from the appointment. */
  paid: boolean;
}

/** The add-ons an appointment has now (not removed), in the order they were chosen. */
export async function bookingAddons(bookingId: string): Promise<BookingAddon[]> {
  const { rows } = await adminPool.query(
    `SELECT ba.id, ba.booking_id, ba.addon_id, ba.name, ba.price,
            EXISTS (SELECT 1 FROM fin_order_items oi JOIN fin_orders o ON o.id = oi.order_id
                     WHERE oi.booking_addon_id = ba.id AND o.status IN ('completed', 'refunded', 'partially_refunded')) AS paid
       FROM apt_booking_addons ba
      WHERE ba.booking_id = $1 AND ba.status = 'active'
      ORDER BY ba.created_at, ba.name`,
    [bookingId],
  );
  return rows;
}

/**
 * Set an appointment's add-ons (svc_addons ids). Each new one must be an add-on of the appointment's
 * service; one kept keeps the price it had when it was chosen; a new one gets its price now; one
 * left out is removed, unless it was already paid. Returns what changed.
 */
export async function setBookingAddons(bookingId: string, businessId: string, addonIds: string[], userId: string | null): Promise<{ added: string[]; removed: string[] }> {
  const ids = [...new Set(addonIds)];
  const { rows: bk } = await adminPool.query(
    `SELECT b.service_id, biz.tenant_id FROM apt_bookings b JOIN sys_businesses biz ON biz.id = b.business_id
      WHERE b.id = $1 AND b.business_id = $2`, [bookingId, businessId]);
  if (!bk[0]) throw new AddonError('Booking not found', 'NOT_FOUND');
  const current = await bookingAddons(bookingId);
  const keep = new Set(ids);
  const toRemove = current.filter((c) => !keep.has(c.addon_id));
  const paid = toRemove.filter((c) => c.paid);
  if (paid.length > 0) {
    throw new AddonError(`${paid.map((p) => p.name).join(', ')} ${paid.length === 1 ? 'is' : 'are'} already paid: remove it on its own, choosing how it is refunded.`, 'INVALID');
  }
  const newIds = ids.filter((id) => !current.some((c) => c.addon_id === id));
  const offered = newIds.length > 0 ? await serviceAddons(bk[0].service_id, businessId) : [];
  const toAdd = newIds.map((id) => {
    const o = offered.find((x) => x.id === id);
    if (!o) throw new AddonError('An add-on chosen is not one of this service\'s.', 'INVALID');
    return o;
  });
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    for (const r of toRemove) {
      await client.query(`UPDATE apt_booking_addons SET status = 'removed', removed_at = NOW(), removed_by = $2 WHERE id = $1`, [r.id, userId]);
    }
    for (const a of toAdd) {
      await client.query(
        `INSERT INTO apt_booking_addons (tenant_id, business_id, booking_id, addon_id, name, price, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [bk[0].tenant_id, businessId, bookingId, a.id, a.name, a.price, userId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
  return { added: toAdd.map((a) => a.name), removed: toRemove.map((r) => r.name) };
}

/**
 * After the appointment's service changed: the add-ons of the old service are removed (those
 * already paid stay). Returns the names removed, so the screen can say so.
 */
export async function dropUnofferedAddons(bookingId: string, businessId: string, userId: string | null): Promise<string[]> {
  const { rows: bk } = await adminPool.query('SELECT service_id FROM apt_bookings WHERE id = $1 AND business_id = $2', [bookingId, businessId]);
  if (!bk[0]) return [];
  const { rows: ofService } = await adminPool.query('SELECT id FROM svc_addons WHERE service_id = $1', [bk[0].service_id]);
  const current = await bookingAddons(bookingId);
  const gone = current.filter((c) => !c.paid && !ofService.some((o: { id: string }) => o.id === c.addon_id));
  for (const g of gone) {
    await adminPool.query(`UPDATE apt_booking_addons SET status = 'removed', removed_at = NOW(), removed_by = $2 WHERE id = $1`, [g.id, userId]);
  }
  return gone.map((g) => g.name);
}

/** Before a booking is made: every add-on chosen is one of the service's. */
export async function assertOffered(serviceId: string, businessId: string, addonIds: string[]): Promise<void> {
  if (addonIds.length === 0) return;
  const offered = await serviceAddons(serviceId, businessId);
  if (addonIds.some((id) => !offered.some((o) => o.id === id))) {
    throw new AddonError('An add-on chosen is not one of this service\'s.', 'INVALID');
  }
}
