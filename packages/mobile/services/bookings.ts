import { apiClient } from './client';

export async function getMyBookings() {
  const res = await apiClient.get('/v1/bookings?status=confirmed&sort=start_time&order=asc');
  return res.data.data.map((b: any) => ({
    id: b.id, serviceName: b.service_name || 'Service', startTime: b.start_time,
    endTime: b.end_time, status: b.status, staffName: b.staff_name,
  }));
}

export async function getNextBooking() {
  const res = await apiClient.get('/v1/bookings?status=confirmed&sort=start_time&order=asc&limit=1');
  const b = res.data.data[0];
  if (!b) return null;
  return { id: b.id, serviceName: b.service_name || 'Service', startTime: b.start_time, staffName: b.staff_name };
}

export async function cancelBooking(id: string) {
  const res = await apiClient.put(`/v1/bookings/${id}/cancel`);
  return res.data.data;
}
