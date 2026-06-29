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
