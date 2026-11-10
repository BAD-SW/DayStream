import axios from 'axios';
import { apiClient } from './client';

/**
 * Self check-in (spec 51, design 1.11a): the front-desk kiosk and a customer's phone. These pages
 * have no login, so they use a plain request (no staff token): the kiosk sends its device token,
 * the phone page its personal code.
 */
const API = `${import.meta.env.VITE_API_URL || ''}/api/v1`;

export interface SelfForm {
  groupId: string;
  name: string;
  /** missing and out_of_date still need completing; done is ticked. */
  status: 'missing' | 'out_of_date' | 'done';
}

export interface SelfVisit {
  first_name: string;
  service_name: string;
  start_time: string;
  timezone: string;
  status: string;
  checked_in: boolean;
  checked_in_now?: boolean;
  forms: SelfForm[];
  /** Kiosk only: what the screen sends back to list or start a form. */
  session?: string;
}

export interface UpcomingAppointment {
  service_name: string;
  start_time: string;
  timezone: string;
  status: string;
}

/** The message the server wrote for the customer, or a plain fallback. */
export function selfCheckInError(err: unknown, fallback: string): {
  message: string; code: string | null; upcoming: UpcomingAppointment[];
} {
  const data = (err as { response?: { data?: { error?: string; code?: string; details?: { upcoming?: UpcomingAppointment[] } } } })?.response?.data;
  return { message: data?.error || fallback, code: data?.code ?? null, upcoming: data?.details?.upcoming ?? [] };
}

// --- Kiosk (device token) ---

const kioskHeaders = (token: string) => ({ headers: { 'X-Kiosk-Token': token } });

/** Whether the kiosk's key is still good. Rejects with KIOSK_OFF (switched off) or KIOSK_UNKNOWN (deleted). */
export async function kioskStatus(token: string): Promise<{ device_name: string }> {
  const res = await axios.get(`${API}/check-in/kiosk/status`, kioskHeaders(token));
  return res.data.data;
}

export async function kioskCheckIn(token: string, who: { phone?: string; email?: string; code?: string }): Promise<SelfVisit> {
  const res = await axios.post(`${API}/check-in/kiosk`, who, kioskHeaders(token));
  return res.data.data;
}

export async function kioskForms(token: string, session: string): Promise<SelfVisit> {
  const res = await axios.post(`${API}/check-in/kiosk/forms`, { session }, kioskHeaders(token));
  return res.data.data;
}

export async function kioskStartForm(token: string, session: string, groupId: string): Promise<{ path: string }> {
  const res = await axios.post(`${API}/check-in/kiosk/forms/start`, { session, group_id: groupId }, kioskHeaders(token));
  return res.data.data;
}

// --- Phone (personal link) ---

export async function phoneVisit(code: string): Promise<SelfVisit> {
  const res = await axios.get(`${API}/public/check-in/${encodeURIComponent(code)}`);
  return res.data.data;
}

export async function phoneCheckIn(code: string): Promise<SelfVisit> {
  const res = await axios.post(`${API}/public/check-in/${encodeURIComponent(code)}`);
  return res.data.data;
}

export async function phoneStartForm(code: string, groupId: string): Promise<{ path: string }> {
  const res = await axios.post(`${API}/public/check-in/${encodeURIComponent(code)}/forms/start`, { group_id: groupId });
  return res.data.data;
}

// --- Staff ---

export async function getSelfCheckInLink(businessId: string, bookingId: string): Promise<string> {
  const res = await apiClient.get(`/v1/check-in/self-link/${bookingId}`, { params: { business_id: businessId } });
  return res.data.data.url;
}

export interface KioskDevice {
  id: string;
  device_name: string;
  is_active: boolean;
  last_activity_at: string | null;
  created_at: string;
  location_id: string;
  location_name: string;
}

export async function listKioskDevices(businessId: string): Promise<KioskDevice[]> {
  const res = await apiClient.get('/v1/check-in/kiosk/devices', { params: { business_id: businessId } });
  return res.data.data;
}

export async function registerKioskDevice(businessId: string, deviceName: string, locationId: string): Promise<{ id: string; token: string }> {
  const res = await apiClient.post('/v1/check-in/kiosk/register', { business_id: businessId, device_name: deviceName, location_id: locationId });
  return res.data.data;
}

export async function switchOffKiosk(businessId: string, kioskId: string): Promise<void> {
  await apiClient.put(`/v1/check-in/kiosk/${kioskId}/off`, { business_id: businessId });
}

export async function switchOnKiosk(businessId: string, kioskId: string): Promise<void> {
  await apiClient.put(`/v1/check-in/kiosk/${kioskId}/on`, { business_id: businessId });
}

export async function deleteKioskDevice(businessId: string, kioskId: string): Promise<void> {
  await apiClient.delete(`/v1/check-in/kiosk/${kioskId}`, { params: { business_id: businessId } });
}

/** The address to open on the tablet, so it can be shown again after registering. */
export async function getKioskLink(businessId: string, kioskId: string): Promise<string> {
  const res = await apiClient.get(`/v1/check-in/kiosk/${kioskId}/link`, { params: { business_id: businessId } });
  return `${window.location.origin}/kiosk?token=${res.data.data.token}`;
}
