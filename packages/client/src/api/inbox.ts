import { apiClient } from './client';

// Inbox (THE-18): conversations with leads and customers, internal notes, assignment,
// notifications by role and channel, and the staff bell.

export type InboxChannel = 'email' | 'in_app' | 'sms' | 'whatsapp';
export type InboxRole = 'owner' | 'manager' | 'front_desk' | 'staff';
export interface ConversationRow {
  id: string; customer_id: string; status: 'open' | 'closed'; unread: boolean; name: string;
  last_message_at: string; last_preview: string | null; last_channel: InboxChannel | null;
  assignee_user_id: string | null; assignee_name: string | null; lifecycle_stage: string; email: string | null; phone: string | null;
}
export interface InboxMessage {
  id: string; direction: 'in' | 'out' | 'note' | 'auto' | 'event'; channel: InboxChannel | 'internal';
  subject: string | null; body: string; sender_name: string | null; status: string; failure_reason: string | null; created_at: string;
}
export interface PersonContext {
  id: string; name: string; email: string | null; phone: string | null; lifecycle_stage: string; source: string | null;
  owner_name: string | null; last_visit_at: string | null; next_booking: { start_time: string; service: string | null } | null;
  memberships: string[]; tags: string[];
}
export interface Conversation extends Omit<ConversationRow, 'name' | 'lifecycle_stage' | 'email' | 'phone'> {
  messages: InboxMessage[]; person: PersonContext;
}

const biz = () => localStorage.getItem('business_id') || '';

export async function getAccess() {
  const res = await apiClient.get('/v1/inbox/access', { params: { business_id: biz() } });
  return res.data.data as { role: InboxRole; unread: number; channels: InboxChannel[] };
}
export async function listConversations(params: { view?: string; search?: string; channel?: string; unread?: boolean; segment_id?: string }) {
  const res = await apiClient.get('/v1/inbox/conversations', { params: { business_id: biz(), ...params } });
  return res.data.data as { conversations: ConversationRow[]; counts: { open: number; mine: number; unassigned: number; unread: number } };
}
export async function getConversation(id: string, peek = false) {
  const res = await apiClient.get(`/v1/inbox/conversations/${id}`, { params: { business_id: biz(), ...(peek ? { peek: 'true' } : {}) } });
  return res.data.data as Conversation;
}
export async function openConversation(customerId: string) {
  const res = await apiClient.post('/v1/inbox/conversations', { business_id: biz(), customer_id: customerId });
  return res.data.data as Conversation;
}
export async function sendMessage(id: string, data: { channel: InboxChannel | 'internal'; subject?: string; body: string; mentions?: string[] }) {
  const res = await apiClient.post(`/v1/inbox/conversations/${id}/messages`, { business_id: biz(), ...data });
  return res.data.data as InboxMessage;
}
export async function assign(id: string, assigneeUserId: string | null) {
  const res = await apiClient.put(`/v1/inbox/conversations/${id}/assign`, { business_id: biz(), assignee_user_id: assigneeUserId });
  return res.data.data as Conversation;
}
export async function setStatus(id: string, status: 'open' | 'closed') {
  const res = await apiClient.put(`/v1/inbox/conversations/${id}/status`, { business_id: biz(), status });
  return res.data.data as Conversation;
}
export async function markUnread(id: string) {
  await apiClient.put(`/v1/inbox/conversations/${id}/unread`, { business_id: biz(), unread: true });
}
export async function getInboxUsers() {
  const res = await apiClient.get('/v1/inbox/users', { params: { business_id: biz() } });
  return res.data.data as { id: string; name: string; role: InboxRole }[];
}

// Settings
export type InboxEvent = 'new_unassigned' | 'assigned_message' | 'assigned_to_me' | 'mentioned' | 'unanswered' | 'delivery_failed' | 'new_lead' | 'daily_summary' | 'customer_arrived';
export interface InboxRule { roles: Record<InboxRole, boolean>; in_app: boolean; email: boolean }
export interface InboxSettings {
  events: Record<InboxEvent, InboxRule>; unanswered_hours: number;
  mine: Partial<Record<InboxEvent, { in_app: boolean; email: boolean }>>; role: InboxRole; always_in_app: InboxEvent[];
}
export async function getSettings() {
  const res = await apiClient.get('/v1/inbox/settings', { params: { business_id: biz() } });
  return res.data.data as InboxSettings;
}
export async function saveSettings(data: { events: Record<InboxEvent, InboxRule>; unanswered_hours: number }) {
  const res = await apiClient.put('/v1/inbox/settings', { business_id: biz(), ...data });
  return res.data.data;
}
export async function saveMyPrefs(prefs: Partial<Record<InboxEvent, { in_app: boolean; email: boolean }>>) {
  const res = await apiClient.put('/v1/inbox/settings/mine', { business_id: biz(), prefs });
  return res.data.data;
}

// The bell
export interface StaffNotification { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }
export async function getNotifications() {
  const res = await apiClient.get('/v1/inbox/notifications');
  return res.data.data as { notifications: StaffNotification[]; unread: number };
}
export async function markNotificationsRead(ids?: string[]) {
  await apiClient.put('/v1/inbox/notifications/read', { ids });
}

// Customer portal (in-app messages)
export async function getMyMessages() {
  const res = await apiClient.get('/v1/inbox/customer/messages', { params: { business_id: biz() } });
  return res.data.data as { id: string; direction: 'in' | 'out'; body: string; sender_name: string | null; created_at: string }[];
}
export async function sendMyMessage(body: string) {
  const res = await apiClient.post('/v1/inbox/customer/messages', { business_id: biz(), body });
  return res.data.data;
}

// Column order (one per business)
export async function getColumnOrder() {
  const res = await apiClient.get('/v1/customers/column-order', { params: { business_id: biz() } });
  return (res.data.data?.order || []) as string[];
}
export async function saveColumnOrder(order: string[]) {
  const res = await apiClient.put('/v1/customers/column-order', { order }, { params: { business_id: biz() } });
  return res.data.data.order as string[];
}
