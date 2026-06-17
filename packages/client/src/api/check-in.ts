import { apiClient } from './client';

export async function checkInByQr(code: string, method?: string) {
  const res = await apiClient.post('/v1/check-in/qr', { code, method }); return res.data.data;
}
export async function checkInReception(bookingId: string) {
  const res = await apiClient.post('/v1/check-in/reception', { booking_id: bookingId }); return res.data.data;
}
export async function checkInKiosk(data: Record<string, any>) {
  const res = await apiClient.post('/v1/check-in/kiosk', data); return res.data.data;
}
export async function walkInCheckIn(data: Record<string, any>) {
  const res = await apiClient.post('/v1/check-in/walk-in', data); return res.data.data;
}
export async function validateBooking(bookingId: string) {
  const res = await apiClient.get(`/v1/check-in/validate/${bookingId}`); return res.data.data;
}
export async function getBookingQr(bookingId: string) {
  const res = await apiClient.get(`/v1/check-in/qr-code/booking/${bookingId}`); return res.data.data;
}
export async function getCustomerQr(customerId: string) {
  const res = await apiClient.get(`/v1/check-in/qr-code/customer/${customerId}`); return res.data.data;
}
export async function regenerateCustomerQr(customerId: string) {
  const res = await apiClient.post(`/v1/check-in/qr-code/customer/${customerId}/regenerate`); return res.data.data;
}
export async function getDashboard(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/dashboard', { params }); return res.data.data;
}
export async function getUpcoming(limit?: number) {
  const res = await apiClient.get('/v1/check-in/dashboard/upcoming', { params: { limit } }); return res.data.data;
}
export async function getNoShows(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/no-shows', { params }); return res.data.data;
}
export async function waiveNoShow(id: string, reason: string) {
  const res = await apiClient.put(`/v1/check-in/no-shows/${id}/waive`, { reason }); return res.data.data;
}
export async function getConfig() {
  const res = await apiClient.get('/v1/check-in/config'); return res.data.data;
}
export async function updateConfig(data: Record<string, any>) {
  const res = await apiClient.put('/v1/check-in/config', data); return res.data.data;
}
export async function getAttendanceReport(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/reports/attendance', { params }); return res.data.data;
}
export async function getNoShowReport(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/reports/no-shows', { params }); return res.data.data;
}
export async function getPeakTimes(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/reports/peak-times', { params }); return res.data.data;
}
export async function getMethodBreakdown(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/check-in/reports/methods', { params }); return res.data.data;
}
