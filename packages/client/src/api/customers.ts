import { apiClient } from './client';

export interface Customer {
  id: string;
  reference_number: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
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

  const res = await apiClient.get(`/v1/customers?${params}`);
  return res.data;
}

export async function getCustomer(id: string, businessId: string): Promise<Customer> {
  const res = await apiClient.get(`/v1/customers/${id}?business_id=${businessId}`);
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
