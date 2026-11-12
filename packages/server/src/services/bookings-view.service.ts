import { adminPool } from '../db/pool';

/**
 * Which screen Bookings opens on for staff (spec 51, gap 3): the calendar, or the list with the
 * Waiting list. The business sets a default; a staff member's profile may choose differently.
 */
export type BookingsView = 'calendar' | 'list';
export const BOOKINGS_VIEWS: readonly BookingsView[] = ['calendar', 'list'];
const KEY = 'bookings.default_view';
const SYSTEM_DEFAULT: BookingsView = 'calendar';

const asView = (v: unknown): BookingsView | null => (v === 'calendar' || v === 'list' ? v : null);

/** The business's choice, or the system default when it has made none. */
export async function getBusinessView(businessId: string): Promise<BookingsView> {
  const { rows } = await adminPool.query(
    'SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = $2', [businessId, KEY],
  );
  if (asView(rows[0]?.value)) return rows[0].value as BookingsView;
  const { rows: def } = await adminPool.query('SELECT default_value FROM sys_configuration_definitions WHERE key = $1', [KEY]);
  return asView(def[0]?.default_value) ?? SYSTEM_DEFAULT;
}

export async function setBusinessView(businessId: string, view: BookingsView): Promise<BookingsView> {
  await adminPool.query(
    `INSERT INTO sys_business_configurations (business_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (business_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [businessId, KEY, view],
  );
  return view;
}

/** The signed-in person's own choice from their staff profile, or null to follow the business. */
export async function getStaffView(userId: string, tenantId: string): Promise<BookingsView | null> {
  const { rows } = await adminPool.query(
    'SELECT bookings_default_view FROM stf_profiles WHERE user_id = $1 AND tenant_id = $2 LIMIT 1', [userId, tenantId],
  );
  return asView(rows[0]?.bookings_default_view);
}

/** What Bookings opens on for this person: their own choice first, then the business's. */
export async function resolveView(businessId: string, userId: string, tenantId: string) {
  const business = await getBusinessView(businessId);
  const mine = await getStaffView(userId, tenantId);
  return { business, mine, view: mine ?? business };
}
