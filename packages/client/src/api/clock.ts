import { apiClient } from './client';

export type ClockEventType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type ClockState = 'clocked_out' | 'working' | 'on_break';

export interface ClockEvent {
  id: string;
  business_id: string;
  user_id: string;
  event_type: ClockEventType;
  event_at: string;
  source: 'clock' | 'manual';
  created_by: string | null;
  note: string | null;
  staff?: string;
}

export interface ClockStateResult {
  state: ClockState;
  since: string | null;
  allowed: ClockEventType[];
  staff: { first_name: string; last_name: string };
}

export interface DayHours {
  date: string;
  worked_minutes: number;
  break_minutes: number;
}

// --- Shared clock screen (PIN-authenticated) ---

export async function getClockState(businessId: string, email: string, pin: string): Promise<ClockStateResult> {
  const res = await apiClient.post('/v1/clock/state', { business_id: businessId, email, pin });
  return res.data.data;
}

export async function punch(
  businessId: string,
  email: string,
  pin: string,
  eventType: ClockEventType,
): Promise<{ event: ClockEvent; state: ClockState; staff: { first_name: string; last_name: string } }> {
  const res = await apiClient.post('/v1/clock/punch', {
    business_id: businessId, email, pin, event_type: eventType,
  });
  return res.data.data;
}

// --- PIN management (manager/owner) ---

export async function setClockPin(staffProfileId: string, businessId: string, pin: string): Promise<void> {
  await apiClient.put(`/v1/clock/staff/${staffProfileId}/pin`, { business_id: businessId, pin });
}

// --- Self-service PIN (the signed-in employee's own PIN) ---

export interface MyPinStatus { hasProfile: boolean; hasPin: boolean; staffRef: string | null; }

export async function getMyPinStatus(): Promise<MyPinStatus> {
  const res = await apiClient.get('/v1/clock/my-pin');
  return res.data.data;
}

export async function setMyPin(pin: string): Promise<void> {
  await apiClient.put('/v1/clock/my-pin', { pin });
}

// --- Self-service records (the signed-in employee's own entries, read-only) ---

export async function getMyClockEvents(start: string, end: string): Promise<ClockEvent[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiClient.get(`/v1/clock/my-events?${params}`);
  return res.data.data;
}

export async function getMyClockHours(start: string, end: string): Promise<DayHours[]> {
  const params = new URLSearchParams({ start, end });
  const res = await apiClient.get(`/v1/clock/my-hours?${params}`);
  return res.data.data;
}

// --- Manager views + corrections ---

export async function getClockEvents(businessId: string, userId: string, start: string, end: string): Promise<ClockEvent[]> {
  const params = new URLSearchParams({ business_id: businessId, user_id: userId, start, end });
  const res = await apiClient.get(`/v1/clock/events?${params}`);
  return res.data.data;
}

export async function getClockHours(businessId: string, userId: string, start: string, end: string): Promise<DayHours[]> {
  const params = new URLSearchParams({ business_id: businessId, user_id: userId, start, end });
  const res = await apiClient.get(`/v1/clock/hours?${params}`);
  return res.data.data;
}

export async function createClockEvent(data: {
  business_id: string; user_id: string; event_type: ClockEventType; event_at: string; note?: string;
}): Promise<ClockEvent> {
  const res = await apiClient.post('/v1/clock/events', data);
  return res.data.data;
}

export async function updateClockEvent(id: string, data: {
  business_id: string; event_type?: ClockEventType; event_at?: string; note?: string;
}): Promise<ClockEvent> {
  const res = await apiClient.put(`/v1/clock/events/${id}`, data);
  return res.data.data;
}

export async function deleteClockEvent(id: string, businessId: string): Promise<void> {
  await apiClient.delete(`/v1/clock/events/${id}?business_id=${businessId}`);
}
