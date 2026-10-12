import { apiClient } from './client';

export interface Customer {
  id: string;
  reference_number: string;
  /** A person may be known by phone only (Phase 46). */
  email: string | null;
  first_name: string;
  last_name: string;
  phone?: string;
  // Phase 46 — People Foundation
  /** Name, else email, else phone: what to show when a name is asked for. */
  display_name?: string;
  source?: string;
  source_detail?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  has_account?: boolean;
  incomplete?: boolean;
  last_activity_at?: string | null;
  last_visit_at?: string | null;
  last_login_at?: string | null;
  next_booking_at?: string | null;
  lifecycle_changed_at?: string;
  marketing_consent?: string[];
  merged_into_id?: string | null;
  date_of_birth?: string;
  gender?: string;
  preferred_language?: string;
  country?: string;
  lifecycle_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerFilters {
  search?: string;
  lifecycle_stage?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  ref?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_from?: string;
  created_to?: string;
  // Phase 46
  view?: string;
  source?: string;
  owner?: string;
  incomplete?: boolean;
  segment_id?: string;
}

export type ViewCounts = Record<string, number>;

export interface ConsentState { channel: string; marketing: boolean; marketing_changed_at: string | null; reminders: boolean }

export interface ConsentEvent {
  id: string; channel: string; category: string; previous_state: boolean | null; new_state: boolean;
  method: string; evidence: string | null; created_at: string; actor_name: string | null;
}

export interface DuplicateFlag {
  id: string; match_type: string; other_id: string; other_name: string; other_email: string | null;
  other_phone: string | null; other_reference: string; other_stage: string;
}

export interface MergePreview {
  primary: { id: string; name: string; reference_number: string };
  secondary: { id: string; name: string; reference_number: string };
  moves: Array<{ table: string; label: string; count: number }>;
  blockers: Array<{ table: string; label: string; count: number }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface LifecycleSummary {
  lead: number;
  trial: number;
  active: number;
  at_risk: number;
  churned: number;
  winback: number;
}

export interface Segment {
  id: string;
  name: string;
  rules: { logic: string; rules: any[] };
  is_predefined: boolean;
  /** 'dynamic' follows its rules; 'static' is a fixed, hand-picked list. */
  kind?: 'dynamic' | 'static';
  description?: string | null;
  created_at: string;
}

// --- Customers ---

export async function getCustomers(businessId: string, filters: CustomerFilters = {}): Promise<PaginatedResponse<Customer>> {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters.search) params.set('search', filters.search);
  if (filters.lifecycle_stage) params.set('lifecycle_stage', filters.lifecycle_stage);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);
  if (filters.ref) params.set('ref', filters.ref);
  if (filters.first_name) params.set('first_name', filters.first_name);
  if (filters.last_name) params.set('last_name', filters.last_name);
  if (filters.email) params.set('email', filters.email);
  if (filters.phone) params.set('phone', filters.phone);
  if (filters.created_from) params.set('created_from', filters.created_from);
  if (filters.created_to) params.set('created_to', filters.created_to);
  if (filters.view && filters.view !== 'all') params.set('view', filters.view);
  if (filters.source) params.set('source', filters.source);
  if (filters.owner) params.set('owner', filters.owner);
  if (filters.incomplete) params.set('incomplete', 'true');
  if (filters.segment_id) params.set('segment_id', filters.segment_id);

  const res = await apiClient.get(`/v1/customers?${params}`);
  return res.data;
}

/** People in each system view (All, Leads, Customers, At risk, Former). */
export async function getViewCounts(businessId: string): Promise<ViewCounts> {
  const res = await apiClient.get(`/v1/customers/view-counts?business_id=${businessId}`);
  return res.data.data;
}

/** Staff who can be set as a person's owner. */
export async function getOwners(businessId: string): Promise<Array<{ id: string; first_name: string; last_name: string }>> {
  const res = await apiClient.get(`/v1/customers/owners?business_id=${businessId}`);
  return res.data.data;
}

// --- Consent (Phase 46) ---

export async function getConsent(customerId: string, businessId: string): Promise<ConsentState[]> {
  const res = await apiClient.get(`/v1/customers/${customerId}/consent?business_id=${businessId}`);
  return res.data.data;
}

export async function getConsentHistory(customerId: string, businessId: string): Promise<ConsentEvent[]> {
  const res = await apiClient.get(`/v1/customers/${customerId}/consent/history?business_id=${businessId}`);
  return res.data.data;
}

// --- Duplicates and merge (Phase 46) ---

export async function getDuplicateFlags(customerId: string, businessId: string): Promise<DuplicateFlag[]> {
  const res = await apiClient.get(`/v1/customers/${customerId}/duplicates?business_id=${businessId}`);
  return res.data.data;
}

export async function dismissDuplicateFlag(customerId: string, flagId: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/customers/${customerId}/duplicates/${flagId}/dismiss?business_id=${businessId}`);
}

export async function previewMerge(primaryId: string, secondaryId: string, businessId: string): Promise<MergePreview> {
  const res = await apiClient.post('/v1/customers/merge/preview', { primary_id: primaryId, secondary_id: secondaryId, business_id: businessId });
  return res.data.data;
}

export async function mergeCustomers(primaryId: string, secondaryId: string, businessId: string): Promise<Customer> {
  const res = await apiClient.post('/v1/customers/merge', { primary_id: primaryId, secondary_id: secondaryId, business_id: businessId });
  return res.data.data;
}

export async function getCustomer(id: string, businessId: string): Promise<Customer> {
  const res = await apiClient.get(`/v1/customers/${id}?business_id=${businessId}`);
  return res.data.data;
}

export interface FinancialSummary {
  currency: string;
  balance_due_cents: number;
  open_invoices: number;
  overdue_invoices: number;
  lifetime_value_cents: number;
  account_credit_cents: number;
}

export async function getFinancialSummary(id: string, businessId: string): Promise<FinancialSummary> {
  const res = await apiClient.get(`/v1/customers/${id}/financial-summary?business_id=${businessId}`);
  return res.data.data;
}

export async function createCustomer(data: any): Promise<Customer> {
  const res = await apiClient.post('/v1/customers', data);
  return res.data.data;
}

export async function updateCustomer(id: string, businessId: string, data: any): Promise<Customer> {
  const res = await apiClient.put(`/v1/customers/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function archiveCustomer(id: string, businessId: string): Promise<void> {
  await apiClient.put(`/v1/customers/${id}/archive?business_id=${businessId}`);
}

export async function updateLifecycle(id: string, businessId: string, stage: string): Promise<any> {
  const res = await apiClient.put(`/v1/customers/${id}/lifecycle?business_id=${businessId}`, { lifecycle_stage: stage });
  return res.data.data;
}

export async function getLifecycleSummary(businessId: string): Promise<LifecycleSummary> {
  const res = await apiClient.get(`/v1/customers/lifecycle-summary?business_id=${businessId}`);
  return res.data.data;
}

// --- Activities ---

export async function getActivities(customerId: string, businessId: string, filters?: { activity_type?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.activity_type) params.set('activity_type', filters.activity_type);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/customers/${customerId}/activities?${params}`);
  return res.data;
}

// --- Notes ---

export async function getNotes(customerId: string, businessId: string, filters?: { category?: string; date_from?: string; date_to?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.category) params.set('category', filters.category);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const res = await apiClient.get(`/v1/customers/${customerId}/notes?${params}`);
  return res.data;
}

export async function createNote(customerId: string, businessId: string, data: { category: string; content: string; is_sensitive?: boolean }) {
  const res = await apiClient.post(`/v1/customers/${customerId}/notes?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deleteNote(customerId: string, noteId: string, businessId: string) {
  await apiClient.delete(`/v1/customers/${customerId}/notes/${noteId}?business_id=${businessId}`);
}

// --- Tags ---

export async function getTags(businessId: string) {
  const res = await apiClient.get(`/v1/customers/tags/list?business_id=${businessId}`);
  return res.data.data;
}

export async function assignTag(customerId: string, businessId: string, tagId: string) {
  await apiClient.post(`/v1/customers/${customerId}/tags?business_id=${businessId}`, { tag_id: tagId });
}

export async function removeTag(customerId: string, tagId: string) {
  await apiClient.delete(`/v1/customers/${customerId}/tags/${tagId}`);
}

// --- Preferences ---

export async function getPreferences(customerId: string, businessId: string) {
  const res = await apiClient.get(`/v1/customers/${customerId}/preferences?business_id=${businessId}`);
  return res.data.data;
}

export async function updatePreferences(customerId: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/customers/${customerId}/preferences?business_id=${businessId}`, data);
  return res.data.data;
}

// --- Segments ---

export async function getSegments(businessId: string): Promise<Segment[]> {
  const res = await apiClient.get(`/v1/segments?business_id=${businessId}`);
  return res.data.data;
}

export async function createSegment(data: { name: string; business_id: string; rules: any }) {
  const res = await apiClient.post('/v1/segments', data);
  return res.data.data;
}

export async function getSegmentMembers(segmentId: string, businessId: string, page = 1) {
  const res = await apiClient.get(`/v1/segments/${segmentId}/members?business_id=${businessId}&page=${page}`);
  return res.data;
}

export async function deleteSegment(segmentId: string, businessId: string) {
  await apiClient.delete(`/v1/segments/${segmentId}?business_id=${businessId}`);
}

export async function createFixedList(data: { name: string; business_id: string; description?: string }): Promise<Segment> {
  const res = await apiClient.post('/v1/segments', { ...data, kind: 'static' });
  return res.data.data;
}

export async function updateSegment(segmentId: string, businessId: string, data: { name?: string; description?: string | null; rules?: Segment['rules'] }): Promise<Segment> {
  const res = await apiClient.put(`/v1/segments/${segmentId}`, { ...data, business_id: businessId });
  return res.data.data;
}

/** How many people a set of rules matches right now, before it is saved. */
export async function countSegmentRules(rules: Segment['rules'], businessId: string): Promise<number> {
  const res = await apiClient.post('/v1/segments/count', { rules, business_id: businessId });
  return res.data.data.total;
}

export async function removeSegmentMembers(segmentId: string, businessId: string, customerIds: string[]): Promise<number> {
  const res = await apiClient.delete(`/v1/segments/${segmentId}/members`, { data: { customer_ids: customerIds, business_id: businessId } });
  return res.data.data.removed;
}

export interface AudienceSummary {
  total: number;
  willReceive: number;
  excluded: number;
  excludedByReason: Array<{ reason: string; label: string; count: number }>;
}

/** Who in a segment would receive a marketing message on this channel, and why the rest would not. */
export async function getAudienceSummary(segmentId: string, businessId: string, channel: string): Promise<AudienceSummary> {
  const res = await apiClient.get(`/v1/segments/${segmentId}/audience-summary?business_id=${businessId}&channel=${channel}`);
  return res.data.data;
}

// --- Bulk actions ---

export type BulkAction = 'add_tag' | 'remove_tag' | 'assign_owner' | 'change_stage' | 'add_to_list' | 'archive';
/** Either the people ticked on screen, or everyone matching the list's filters. */
export interface BulkTarget { ids?: string[]; filters?: Record<string, any> }
export interface BulkPayload { tag_id?: string; owner_user_id?: string | null; stage?: string; segment_id?: string }

function bulkBody(businessId: string, target: BulkTarget) {
  if (target.ids) return { business_id: businessId, ids: target.ids };
  // Drop empty filters and the paging / sorting keys the bulk endpoint does not take.
  const filters: Record<string, any> = {};
  for (const [k, v] of Object.entries(target.filters || {})) {
    if (v !== undefined && v !== '' && !['sort', 'order', 'page', 'limit'].includes(k)) filters[k] = v;
  }
  return { business_id: businessId, filters };
}

export async function previewBulk(businessId: string, target: BulkTarget): Promise<number> {
  const res = await apiClient.post('/v1/customers/bulk/preview', bulkBody(businessId, target));
  return res.data.data.count;
}

export async function runBulk(businessId: string, target: BulkTarget, action: BulkAction, payload: BulkPayload): Promise<number> {
  const res = await apiClient.post('/v1/customers/bulk', { ...bulkBody(businessId, target), action, payload });
  return res.data.data.affected;
}

// --- Import ---

export async function validateImport(data: { csv_text: string; mapping: Record<string, string>; business_id: string }) {
  const res = await apiClient.post('/v1/customers/import/validate', data);
  return res.data.data;
}

export async function executeImport(data: { csv_text: string; mapping: Record<string, string>; business_id: string }) {
  const res = await apiClient.post('/v1/customers/import', data);
  return res.data.data;
}

export function getExportUrl(businessId: string, filters?: CustomerFilters): string {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.lifecycle_stage) params.set('lifecycle_stage', filters.lifecycle_stage);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.ref) params.set('ref', filters.ref);
  if (filters?.first_name) params.set('first_name', filters.first_name);
  if (filters?.last_name) params.set('last_name', filters.last_name);
  if (filters?.email) params.set('email', filters.email);
  if (filters?.phone) params.set('phone', filters.phone);
  if (filters?.created_from) params.set('created_from', filters.created_from);
  if (filters?.created_to) params.set('created_to', filters.created_to);
  if (filters?.sort) params.set('sort', filters.sort);
  if (filters?.order) params.set('order', filters.order);
  return `/api/v1/customers/export?${params}`;
}

// --- GDPR ---

export async function anonymizeCustomer(customerId: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/customers/${customerId}/anonymize?business_id=${businessId}`);
}
