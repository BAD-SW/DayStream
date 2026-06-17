import { apiClient } from './client';

export async function getMyQrCode() {
  const res = await apiClient.get('/v1/check-in/qr-code/customer/me');
  return res.data.data;
}

export async function getNextBookingForCheckin() {
  const res = await apiClient.get('/v1/bookings?status=confirmed&sort=start_time&order=asc&limit=1');
  const b = res.data.data[0];
  if (!b) return null;
  return { id: b.id, serviceName: b.service_name || 'Service', startTime: b.start_time };
}

export async function selfCheckIn(venueCode: string) {
  const res = await apiClient.post('/v1/check-in/qr', { code: venueCode, method: 'qr_self' });
  return res.data.data;
}
