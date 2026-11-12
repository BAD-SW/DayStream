import { apiClient } from './client';

/**
 * Which screen Bookings opens on for staff (spec 51, gap 3): the calendar, or the list with the
 * Waiting list. The business sets a default; a staff member's profile may choose differently.
 */
export type BookingsView = 'calendar' | 'list';

export const BOOKINGS_VIEW_OPTIONS: { value: BookingsView; label: string }[] = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'list', label: 'List with Waiting list' },
];

export interface BookingsViewChoice {
  /** The business default. */
  business: BookingsView;
  /** The signed-in person's own choice, or null to follow the business. */
  mine: BookingsView | null;
  /** What Bookings opens on for them. */
  view: BookingsView;
}

export async function getBookingsView(businessId: string): Promise<BookingsViewChoice> {
  const res = await apiClient.get('/v1/bookings-view', { params: { business_id: businessId } });
  return res.data.data;
}

export async function saveBusinessBookingsView(businessId: string, view: BookingsView): Promise<void> {
  await apiClient.put('/v1/bookings-view', { business_id: businessId, view });
}
