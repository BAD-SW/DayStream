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
/** A closing time of 23:59 means "until the end of the day", so a slot may end at midnight. */
export const endOfDayMinutes = (t: string) => { const m = minutes(t); return m >= 23 * 60 + 59 ? 24 * 60 : m; };

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

/**
 * When resources can be used (Resources → a resource → Schedule, and its closures). The rules:
 * - a closure (holiday, closure block) on the date closes the resource for the whole day or the
 *   blocked hours, also for a resource marked "Available 24/7";
 * - "Available 24/7" otherwise overrides the schedule: no limit;
 * - no schedule in force on the date: no limit (nothing has been set up);
 * - a schedule in force: only its hours that weekday (none that weekday = not available that day).
 */
export interface ResourceHours {
  is24: Set<string>;
  schedules: Array<{ resource_id: string; effective_from: string; effective_to: string | null; slots: Array<{ day_of_week: number; start: number; end: number }> }>;
  blocks: Array<{ resource_id: string; block_date: string; start: number | null; end: number | null }>;
}

export async function loadResourceHours(resourceIds: string[]): Promise<ResourceHours> {
  const out: ResourceHours = { is24: new Set(), schedules: [], blocks: [] };
  if (resourceIds.length === 0) return out;
  const { rows: res } = await adminPool.query('SELECT id FROM res_resources WHERE id = ANY($1) AND is_24_7 = true', [resourceIds]);
  for (const r of res) out.is24.add(r.id);
  const { rows: scheds } = await adminPool.query(
    `SELECT s.id, s.resource_id, to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to
       FROM res_schedules s WHERE s.resource_id = ANY($1)`, [resourceIds],
  );
  const { rows: slots } = scheds.length
    ? await adminPool.query('SELECT schedule_id, day_of_week, start_time, end_time FROM res_schedule_slots WHERE schedule_id = ANY($1)', [scheds.map((s: any) => s.id)])
    : { rows: [] as any[] };
  out.schedules = scheds.map((s: any) => ({
    resource_id: s.resource_id, effective_from: s.effective_from, effective_to: s.effective_to,
    slots: slots.filter((x: any) => x.schedule_id === s.id).map((x: any) => ({ day_of_week: x.day_of_week, start: minutes(x.start_time), end: endOfDayMinutes(x.end_time) })),
  }));
  const { rows: blocks } = await adminPool.query(
    `SELECT resource_id, to_char(block_date, 'YYYY-MM-DD') AS block_date, start_time, end_time FROM res_schedule_blocks WHERE resource_id = ANY($1)`, [resourceIds],
  );
  out.blocks = blocks.map((b: any) => ({ resource_id: b.resource_id, block_date: b.block_date, start: b.start_time ? minutes(b.start_time) : null, end: b.end_time ? minutes(b.end_time) : null }));
  return out;
}

/** Whether a resource can be used for the whole of a slot (wall-clock times where the business is). */
export function resourceOpen(hours: ResourceHours, resourceId: string, start: Date, end: Date, timeZone: string): boolean {
  const slot = localSlotMinutes(start, end, timeZone);
  const closed = hours.blocks.some((b) => b.resource_id === resourceId && b.block_date === slot.date
    && (b.start == null || b.end == null || (slot.startMinutes < b.end && slot.endMinutes > b.start)));
  if (closed) return false;
  if (hours.is24.has(resourceId)) return true;
  const inForce = hours.schedules
    .filter((s) => s.resource_id === resourceId && s.effective_from <= slot.date && (!s.effective_to || s.effective_to >= slot.date))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (!inForce) return true;
  return inForce.slots.some((x) => x.day_of_week === slot.dayOfWeek && slot.startMinutes >= x.start && slot.endMinutes <= x.end);
}

/** Whether a resource is under maintenance at any point of a slot. */
export function underMaintenance(windows: MaintenanceWindow[], resourceId: string, start: Date, end: Date, timeZone: string): boolean {
  const slot = localSlotMinutes(start, end, timeZone);
  return windows.some((w) =>
    w.resource_id === resourceId
    && (w.maintenance_type === 'recurring' ? (w.day_of_week == null || w.day_of_week === slot.dayOfWeek) : w.specific_date === slot.date)
    && slot.startMinutes < w.end_minutes && slot.endMinutes > w.start_minutes);
}
