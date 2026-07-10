import { apiClient } from './client';

// --- Types ---

export interface Booking {
  id: string;
  booking_reference: string;
  service_name: string;
  variant_name?: string;
  customer_first_name: string;
  customer_last_name: string;
  staff_first_name?: string;
  staff_last_name?: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_type: string;
  price: number;
  notes?: string;
  created_at: string;
  recurring_series_id?: string;
  waitlist_entry_id?: string;
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
  duration: number;
  available_staff: Array<{ id: string; first_name: string; last_name: string }>;
  capacity_remaining?: number;
}

export interface CalendarDay {
  date: string;
  count: number;
}

// --- Availability ---

export async function getAvailability(businessId: string, serviceId: string, dateFrom: string, dateTo: string, staffId?: string, variantId?: string) {
  const params = new URLSearchParams({ business_id: businessId, service_id: serviceId, date_from: dateFrom, date_to: dateTo });
  if (staffId) params.set('staff_id', staffId);
  if (variantId) params.set('variant_id', variantId);
  const res = await apiClient.get(`/v1/bookings/availability?${params}`);
  return res.data.data as AvailableSlot[];
}

// --- Booking CRUD ---

export async function createBooking(data: {
  business_id: string; customer_id: string; service_id: string; variant_id: string;
  staff_id?: string; start_time: string; notes?: string; override_rules?: boolean;
}) {
  const res = await apiClient.post('/v1/bookings', data);
  return res.data.data;
}

export async function getBookings(businessId: string, filters?: { status?: string; customer_id?: string; staff_id?: string; date_from?: string; date_to?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.customer_id) params.set('customer_id', filters.customer_id);
  if (filters?.staff_id) params.set('staff_id', filters.staff_id);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/bookings?${params}`);
  return res.data;
}

export async function getBooking(id: string, businessId: string): Promise<Booking> {
  const res = await apiClient.get(`/v1/bookings/${id}?business_id=${businessId}`);
  return res.data.data;
}

// --- Lifecycle ---

export async function confirmBooking(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/confirm?business_id=${businessId}`);
  return res.data.data;
}

export async function cancelBooking(id: string, businessId: string, reason?: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/cancel?business_id=${businessId}`, { reason });
  return res.data.data;
}

export async function checkInBooking(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/check-in?business_id=${businessId}`);
  return res.data.data;
}

export async function completeBooking(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/complete?business_id=${businessId}`);
  return res.data.data;
}

export async function noShowBooking(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/no-show?business_id=${businessId}`);
  return res.data.data;
}

export async function rescheduleBooking(id: string, businessId: string, startTime: string, staffId?: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/reschedule?business_id=${businessId}`, { start_time: startTime, staff_id: staffId });
  return res.data.data;
}

export async function updateBooking(id: string, businessId: string, data: {
  service_id?: string; variant_id?: string; staff_id?: string | null;
  start_time?: string; notes?: string | null; customer_id?: string;
}) {
  const res = await apiClient.put(`/v1/bookings/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

// --- Slot Holds ---

export async function holdSlot(data: { business_id: string; service_id: string; variant_id: string; staff_id?: string; start_time: string; end_time: string }) {
  const res = await apiClient.post('/v1/bookings/hold', data);
  return res.data.data;
}

export async function releaseHold(holdId: string) {
  await apiClient.delete(`/v1/bookings/hold/${holdId}`);
}

// --- Calendar ---

export async function getCalendar(businessId: string, view: 'day' | 'week' | 'month', date: string, filters?: { staff_id?: string; service_id?: string }) {
  const params = new URLSearchParams({ business_id: businessId, view, date });
  if (filters?.staff_id) params.set('staff_id', filters.staff_id);
  if (filters?.service_id) params.set('service_id', filters.service_id);
  const res = await apiClient.get(`/v1/bookings/calendar?${params}`);
  return res.data.data;
}

// --- Rules ---

export async function getBookingRules(businessId: string, serviceId: string) {
  const res = await apiClient.get(`/v1/bookings/rules?business_id=${businessId}&service_id=${serviceId}`);
  return res.data.data;
}

// --- Recurring Series ---

export async function getRecurringSeries(seriesId: string, businessId: string) {
  const res = await apiClient.get(`/v1/bookings/recurring/${seriesId}?business_id=${businessId}`);
  return res.data.data;
}

export async function cancelRecurringSeries(seriesId: string, businessId: string, reason?: string) {
  const res = await apiClient.put(`/v1/bookings/recurring/${seriesId}/cancel?business_id=${businessId}`, { reason });
  return res.data.data;
}

// --- Waitlist ---

export async function confirmWaitlistEntry(entryId: string, businessId: string) {
  const res = await apiClient.put(`/v1/bookings/waitlist/${entryId}/confirm?business_id=${businessId}`);
  return res.data.data;
}
