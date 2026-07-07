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
