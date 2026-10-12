import { adminPool } from '../db/pool';
import { localSlotMinutes } from '../utils/business-time';

/**
 * The resources a service needs, as set on the Resources page ("service requirements").
 *
 * Those requirements used to be stored and shown but never applied: the booking engine only
 * knew the resources named in a service's own availability rules. A room required by a
 * service could therefore be double-booked, and its maintenance windows did not block
 * anything.
 *
 * A booking carries one resource, so one requirement is applied: the first "required" row for
 * the service (or for the variant being booked). It names either one resource or a type; a
 * type means any active resource of that type in the business will do.
 */
export async function requiredResourceAlternatives(serviceId: string, variantId: string | null | undefined, businessId: string): Promise<string[]> {
  const { rows } = await adminPool.query(
    `SELECT resource_id, resource_type_id FROM svc_resource_requirements
      WHERE service_id = $1 AND requirement_type = 'required' AND (variant_id IS NULL OR variant_id = $2)
      ORDER BY (variant_id IS NULL), created_at LIMIT 1`,
    [serviceId, variantId || null],
  );
  const requirement = rows[0];
  if (!requirement) return [];
  const { rows: resources } = requirement.resource_id
    ? await adminPool.query(`SELECT id FROM res_resources WHERE id = $1 AND status = 'active'`, [requirement.resource_id])
    : await adminPool.query(
      `SELECT id FROM res_resources WHERE resource_type_id = $1 AND business_id = $2 AND status = 'active' ORDER BY display_order, name`,
      [requirement.resource_type_id, businessId],
    );
  return resources.map((r: any) => r.id);
}

export interface MaintenanceWindow {
  resource_id: string;
  maintenance_type: 'recurring' | 'one_time';
  day_of_week: number | null;
  specific_date: string | null; // YYYY-MM-DD
  start_minutes: number;
  end_minutes: number;
}

const minutes = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

/** Maintenance windows of these resources (wall-clock times where the business is). */
export async function loadMaintenance(resourceIds: string[]): Promise<MaintenanceWindow[]> {
  if (resourceIds.length === 0) return [];
  const { rows } = await adminPool.query(
    `SELECT resource_id, maintenance_type, day_of_week, to_char(specific_date, 'YYYY-MM-DD') AS specific_date, start_time, end_time
       FROM res_maintenance WHERE resource_id = ANY($1) AND start_time IS NOT NULL AND end_time IS NOT NULL`,
    [resourceIds],
  );
  return rows.map((r: any) => ({ ...r, start_minutes: minutes(r.start_time), end_minutes: minutes(r.end_time) }));
}

/** Whether a resource is under maintenance at any point of a slot. */
export function underMaintenance(windows: MaintenanceWindow[], resourceId: string, start: Date, end: Date, timeZone: string): boolean {
  const slot = localSlotMinutes(start, end, timeZone);
  return windows.some((w) =>
    w.resource_id === resourceId
    && (w.maintenance_type === 'recurring' ? w.day_of_week === slot.dayOfWeek : w.specific_date === slot.date)
    && slot.startMinutes < w.end_minutes && slot.endMinutes > w.start_minutes);
}
