import { apiClient } from './client';

export interface Event {
  id: string; tenant_id: string; event_type_id: string; title: string;
  slug: string; description: string | null; start_time: string; end_time: string;
  location_name: string | null; capacity: number; status: string;
  cover_image_path: string | null; tags: string[]; registrations_count: number;
  event_type_name: string;
}

export async function getEvents(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/events', { params });
  return { data: res.data.data as Event[], meta: res.data.meta };
}
export async function createEvent(data: Record<string, any>) {
  const res = await apiClient.post('/v1/events', data); return res.data.data;
}
export async function getEvent(id: string) {
  const res = await apiClient.get(`/v1/events/${id}`); return res.data.data as Event;
}
export async function updateEvent(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/${id}`, data); return res.data.data;
}
export async function publishEvent(id: string) {
  const res = await apiClient.put(`/v1/events/${id}/publish`); return res.data.data;
}
export async function cancelEvent(id: string) {
  const res = await apiClient.put(`/v1/events/${id}/cancel`); return res.data.data;
}
export async function getEventTypes() {
  const res = await apiClient.get('/v1/events/types'); return res.data.data;
}
export async function getTiers(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/tickets`); return res.data.data;
}
export async function createTier(eventId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/events/${eventId}/tickets`, data); return res.data.data;
}
export async function getRegistrations(eventId: string, params?: Record<string, any>) {
  const res = await apiClient.get(`/v1/events/${eventId}/registrations`, { params });
  return { data: res.data.data, meta: res.data.meta };
}
export async function registerForEvent(eventId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/events/${eventId}/register`, data); return res.data.data;
}
export async function getWaitlist(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/waitlist`); return res.data.data;
}
export async function getAttendees(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/attendees`); return res.data.data;
}
export async function checkInQr(eventId: string, referenceNumber: string) {
  const res = await apiClient.post(`/v1/events/${eventId}/check-in/qr`, { reference_number: referenceNumber });
  return res.data.data;
}
export async function getEventReport(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/reports`); return res.data.data;
}
export async function getEventsSummary(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/events/reports/summary', { params }); return res.data.data;
}
export async function getSeries() {
  const res = await apiClient.get('/v1/events/series'); return res.data.data;
}
export async function getRecurringTemplates() {
  const res = await apiClient.get('/v1/events/recurring'); return res.data.data;
}
export async function getCommunications(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/communications`); return res.data.data;
}
export async function sendCommunication(eventId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/events/${eventId}/communications`, data); return res.data.data;
}

// Export attendees
export async function exportAttendees(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/attendees/export`, { responseType: 'blob' });
  return res.data;
}

// Facilitators
export async function getFacilitators(eventId: string) {
  const res = await apiClient.get(`/v1/events/${eventId}/facilitators`); return res.data.data;
}
export async function addFacilitator(eventId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/events/${eventId}/facilitators`, data); return res.data.data;
}
export async function removeFacilitator(eventId: string, facilitatorId: string) {
  await apiClient.delete(`/v1/events/${eventId}/facilitators/${facilitatorId}`);
}

// Ticket CRUD
export async function updateTier(eventId: string, tierId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/${eventId}/tickets/${tierId}`, data); return res.data.data;
}
export async function deleteTier(eventId: string, tierId: string) {
  await apiClient.delete(`/v1/events/${eventId}/tickets/${tierId}`);
}

// Recurring events
export async function getRecurringEvent(id: string) {
  const res = await apiClient.get(`/v1/events/recurring/${id}`); return res.data.data;
}
export async function updateRecurringEvent(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/recurring/${id}`, data); return res.data.data;
}
export async function deleteRecurringEvent(id: string) {
  await apiClient.delete(`/v1/events/recurring/${id}`);
}
export async function generateRecurringInstances(id: string) {
  const res = await apiClient.post(`/v1/events/recurring/${id}/generate`); return res.data.data;
}
export async function cancelRecurringEvent(id: string) {
  const res = await apiClient.put(`/v1/events/recurring/${id}/cancel`); return res.data.data;
}

// Registration actions
export async function cancelRegistration(registrationId: string) {
  const res = await apiClient.put(`/v1/events/registrations/${registrationId}/cancel`); return res.data.data;
}
export async function checkInRegistration(registrationId: string) {
  const res = await apiClient.put(`/v1/events/registrations/${registrationId}/check-in`); return res.data.data;
}
export async function transferRegistration(registrationId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/registrations/${registrationId}/transfer`, data); return res.data.data;
}

// Event series
export async function updateSeries(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/series/${id}`, data); return res.data.data;
}
export async function deleteSeries(id: string) {
  await apiClient.delete(`/v1/events/series/${id}`);
}

// Event types
export async function createEventType(data: Record<string, any>) {
  const res = await apiClient.post('/v1/events/types', data); return res.data.data;
}
export async function updateEventType(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/events/types/${id}`, data); return res.data.data;
}
export async function deleteEventType(id: string) {
  await apiClient.delete(`/v1/events/types/${id}`);
}

// Waitlist
export async function confirmWaitlist(waitlistId: string) {
  const res = await apiClient.put(`/v1/events/waitlist/${waitlistId}/confirm`); return res.data.data;
}

// ── Events for customers (THE-20) ────────────────────────────────────────────

export interface CustomerTier {
  id: string; name: string; description: string | null; price: number; eligibility: string;
  places_left: number | null; available: boolean; unavailable_reason: string | null;
}
export interface CustomerEventSummary {
  id: string; slug: string; title: string; description: string | null;
  start_time: string; end_time: string; location_name: string | null; event_type_name: string | null;
  host_business_id: string | null; host_business_name: string | null; timezone: string; currency: string;
  capacity: number; places_left: number; from_price: number | null; tiers: CustomerTier[];
  my_status?: 'registered' | 'awaiting_payment' | 'waitlisted' | null;
}
export interface CustomerRegistration {
  id: string; status: string; pay_at: 'online' | 'reception' | null; group_size: number; tier_name: string | null;
  reference_number: string; order_number: string | null; paid: boolean; amount: number;
  awaiting_payment: 'online' | 'reception' | null; hold_expires_at: string | null;
  can_cancel: boolean; cancel_until: string | null; cancel_blocked_reason: string | null; refund_to: 'card' | 'credit' | null;
}
export interface CustomerEventDetail extends CustomerEventSummary {
  status: string; open_for_registration: boolean; is_member: boolean; tax_rate: number;
  pay_options: { online: boolean; reception: boolean };
  cancellation: { allowed: boolean; hours_before: number | null; refund_to: 'card' | 'credit' };
  my_registrations: CustomerRegistration[];
  my_waitlist: { id: string; status: string; position: number; expires_at: string | null }[];
}
export interface MyEventRow extends Partial<CustomerRegistration> {
  kind: 'registration' | 'waitlist'; id: string; status: string; event_id: string; title: string;
  start_time: string; end_time: string; location_name: string | null; host_business_name: string | null;
  timezone: string; currency: string; event_status: string; upcoming: boolean; position?: number;
}
export interface OnlinePayment {
  order_id: string; provider_reference: string; client_secret: string | null; publishable_key?: string; amount: number; currency: string;
}

export async function getCustomerEvents() {
  const res = await apiClient.get('/v1/events/customer/events'); return res.data.data as CustomerEventSummary[];
}
export async function getCustomerEvent(id: string) {
  const res = await apiClient.get(`/v1/events/customer/events/${id}`); return res.data.data as CustomerEventDetail;
}
export async function getMyEvents() {
  const res = await apiClient.get('/v1/events/customer/my-events'); return res.data.data as MyEventRow[];
}
export async function payRegistration(registrationId: string, providerReference: string) {
  const res = await apiClient.post(`/v1/events/customer/registrations/${registrationId}/pay`, { provider_reference: providerReference });
  return res.data.data;
}
export async function cancelMyRegistration(registrationId: string) {
  const res = await apiClient.put(`/v1/events/customer/registrations/${registrationId}/cancel`);
  return res.data.data as { refund: { amount: number; to: 'card' | 'credit'; status: string } | null };
}
export async function leaveWaitlist(waitlistId: string) {
  const res = await apiClient.delete(`/v1/events/customer/waitlist/${waitlistId}`); return res.data.data;
}
/** Reception: open the ticket's order so it can be paid through checkout. */
export async function openRegistrationCheckout(registrationId: string) {
  const res = await apiClient.post(`/v1/events/registrations/${registrationId}/checkout`);
  return res.data.data as { order_id: string; business_id: string };
}
