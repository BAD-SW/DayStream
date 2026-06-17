import { apiClient } from './client';

export async function getUpcomingEvents() {
  const res = await apiClient.get('/v1/events?status=published');
  return res.data.data || [];
}

export async function getEventById(id: string) {
  const res = await apiClient.get(`/v1/events/${id}`);
  return res.data.data;
}

export async function registerForEvent(eventId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/events/${eventId}/register`, data);
  return res.data.data;
}
