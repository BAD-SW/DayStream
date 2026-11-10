import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Register a new kiosk device, creating a session with a unique token.
 */
export async function registerKiosk(tenantId: string, locationId: string, deviceName: string) {
  const token = crypto.randomBytes(32).toString('hex');

  const { rows } = await adminPool.query(
    `INSERT INTO apt_kiosk_sessions (tenant_id, location_id, device_name, token, last_activity_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [tenantId, locationId, deviceName, token],
  );

  await logAudit({
    tenantId,
    action: 'checkin.kiosk_registered',
    resourceType: 'kiosk_session',
    resourceId: rows[0].id,
    details: { location_id: locationId, device_name: deviceName },
  });

  return rows[0];
}

/**
 * Validate a kiosk token and update last_activity_at.
 * Returns the kiosk session if active, null otherwise.
 */
export async function getKioskStatus(token: string) {
  const { rows } = await adminPool.query(
    `UPDATE apt_kiosk_sessions
     SET last_activity_at = NOW()
     WHERE token = $1 AND is_active = true
     RETURNING *`,
    [token],
  );

  return rows[0] || null;
}

/**
 * Deactivate a kiosk session.
 */
export async function deactivateKiosk(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE apt_kiosk_sessions SET is_active = false
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId],
  );

  if (rows.length === 0) throw new Error('Kiosk session not found');

  await logAudit({
    tenantId,
    action: 'checkin.kiosk_deactivated',
    resourceType: 'kiosk_session',
    resourceId: id,
  });

  return rows[0];
}

/**
 * The kiosks registered for a business's locations. The token is never listed: it is shown once,
 * when the kiosk is registered, because it is the device's password.
 */
export async function listKiosks(tenantId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT k.id, k.device_name, k.is_active, k.last_activity_at, k.created_at, l.id AS location_id, l.name AS location_name
       FROM apt_kiosk_sessions k JOIN sys_locations l ON l.id = k.location_id
      WHERE k.tenant_id = $1 AND l.business_id = $2
      ORDER BY k.is_active DESC, k.created_at DESC`,
    [tenantId, businessId],
  );
  return rows;
}

/** Whether a kiosk belongs to a business (through its location). */
export async function kioskInBusiness(kioskId: string, tenantId: string, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM apt_kiosk_sessions k JOIN sys_locations l ON l.id = k.location_id
      WHERE k.id = $1 AND k.tenant_id = $2 AND l.business_id = $3`,
    [kioskId, tenantId, businessId],
  );
  return rows.length > 0;
}

/** Switch a kiosk back on after it was switched off. The tablet works again with the same link. */
export async function activateKiosk(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE apt_kiosk_sessions SET is_active = true WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId],
  );
  if (rows.length === 0) throw new Error('Kiosk session not found');
  await logAudit({ tenantId, action: 'checkin.kiosk_activated', resourceType: 'kiosk_session', resourceId: id });
  return rows[0];
}

/** Delete a kiosk. Its link stops working at once. Past check-ins are kept (they record the location). */
export async function deleteKiosk(id: string, tenantId: string): Promise<void> {
  const { rows } = await adminPool.query(
    `DELETE FROM apt_kiosk_sessions WHERE id = $1 AND tenant_id = $2 RETURNING id, device_name`,
    [id, tenantId],
  );
  if (rows.length === 0) throw new Error('Kiosk session not found');
  await logAudit({
    tenantId, action: 'checkin.kiosk_deleted', resourceType: 'kiosk_session', resourceId: id,
    details: { device_name: rows[0].device_name },
  });
}

/** The tablet's key, so staff can open the kiosk link again. It is the device's password: only shown to staff who manage kiosks. */
export async function getKioskToken(id: string, tenantId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT token FROM apt_kiosk_sessions WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0]?.token ?? null;
}

/** Whether a kiosk key belongs to a kiosk at all, switched on or off. Tells "switched off" from "deleted". */
export async function kioskTokenExists(token: string): Promise<boolean> {
  const { rows } = await adminPool.query(`SELECT 1 FROM apt_kiosk_sessions WHERE token = $1`, [token]);
  return rows.length > 0;
}
