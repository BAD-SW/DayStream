import { apiClient } from './client';

// --- Types ---

export interface Service {
  id: string;
  name: string;
  slug: string;
  description?: string;
  short_description?: string;
  booking_type: string;
  status: string;
  default_duration: number;
  buffer_before: number;
  buffer_after: number;
  max_capacity: number;
  online_booking_enabled: boolean;
  display_order: number;
  category_id: string;
  category_name?: string;
  created_at: string;
  variants?: ServiceVariant[];
  images?: ServiceImage[];
  staff?: ServiceStaff[];
  availability?: AvailabilityRule[];
}

export interface ServiceVariant {
  id: string;
  name: string;
  duration: number;
  price: number;
  pricing_model: string;
  billing_interval?: string;
  included_sessions?: number;
  sessions_rollover?: boolean;
  capacity_override?: number;
  display_order: number;
  status: string;
}

export interface ServiceImage {
  id: string;
  file_path: string;
  filename: string;
  alt_text?: string;
  is_primary: boolean;
  display_order: number;
  urls?: { original: string; large: string; medium: string; thumbnail: string };
}

export interface ServiceStaff {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  is_primary: boolean;
  variant_id?: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  parent_id?: string;
  display_order: number;
  status: string;
  service_count: number;
}

export interface AvailabilityRule {
  id: string;
  rule_type: string;
  days_of_week?: number[];
  start_time?: string;
  end_time?: string;
  effective_from?: string;
  effective_to?: string;
  blocked_dates?: string[];
  description?: string;
}

export interface CancellationPolicy {
  id: string;
  name: string;
  is_default: boolean;
  free_cancellation_hours: number;
  late_cancel_fee_type: string;
  late_cancel_fee_value: number;
  noshow_fee_type: string;
  noshow_fee_value: number;
}

export interface TaxCategory {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
}

// --- Categories ---

export async function getCategories(businessId: string): Promise<ServiceCategory[]> {
  const res = await apiClient.get(`/v1/services/categories?business_id=${businessId}`);
  return res.data.data;
}

export async function createCategory(data: { business_id: string; name: string; description?: string; icon?: string; parent_id?: string }) {
  const res = await apiClient.post('/v1/services/categories', data);
  return res.data.data;
}

export async function updateCategory(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/services/categories/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deleteCategory(id: string, businessId: string) {
  await apiClient.delete(`/v1/services/categories/${id}?business_id=${businessId}`);
}

// --- Services ---

export async function getServices(businessId: string, filters?: { category_id?: string; status?: string; search?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.category_id) params.set('category_id', filters.category_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/services?${params}`);
  return res.data;
}

export async function getService(id: string, businessId: string): Promise<Service> {
  const res = await apiClient.get(`/v1/services/${id}?business_id=${businessId}`);
  return res.data.data;
}

export async function createService(data: any): Promise<Service> {
  const res = await apiClient.post('/v1/services', data);
  return res.data.data;
}

export async function updateService(id: string, businessId: string, data: any): Promise<Service> {
  const res = await apiClient.put(`/v1/services/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function archiveService(id: string, businessId: string) {
  await apiClient.put(`/v1/services/${id}/archive?business_id=${businessId}`);
}

export async function pauseService(id: string, businessId: string) {
  await apiClient.put(`/v1/services/${id}/pause?business_id=${businessId}`);
}

export async function activateService(id: string, businessId: string) {
  await apiClient.put(`/v1/services/${id}/activate?business_id=${businessId}`);
}

export async function restoreService(id: string, businessId: string) {
  await apiClient.put(`/v1/services/${id}/restore?business_id=${businessId}`);
}

// --- Variants ---

export async function getVariants(serviceId: string): Promise<ServiceVariant[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/variants`);
  return res.data.data;
}

export async function createVariant(serviceId: string, data: any) {
  const res = await apiClient.post(`/v1/services/${serviceId}/variants`, data);
  return res.data.data;
}

export async function updateVariant(serviceId: string, variantId: string, data: any) {
  const res = await apiClient.put(`/v1/services/${serviceId}/variants/${variantId}`, data);
  return res.data.data;
}

export async function deleteVariant(serviceId: string, variantId: string) {
  await apiClient.delete(`/v1/services/${serviceId}/variants/${variantId}`);
}

// --- Images ---

export async function getImages(serviceId: string): Promise<ServiceImage[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/images`);
  return res.data.data;
}

export async function uploadImage(serviceId: string, businessId: string, file: File, altText?: string) {
  const formData = new FormData();
  formData.append('image', file);
  if (altText) formData.append('alt_text', altText);
  const res = await apiClient.post(`/v1/services/${serviceId}/images?business_id=${businessId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

export async function updateImage(serviceId: string, imageId: string, data: any) {
  const res = await apiClient.put(`/v1/services/${serviceId}/images/${imageId}`, data);
  return res.data.data;
}

export async function deleteImage(serviceId: string, imageId: string) {
  await apiClient.delete(`/v1/services/${serviceId}/images/${imageId}`);
}

// --- Staff ---

export async function getStaff(serviceId: string): Promise<ServiceStaff[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/staff`);
  return res.data.data;
}

export async function assignStaff(serviceId: string, data: { user_id: string; variant_id?: string; is_primary?: boolean }) {
  const res = await apiClient.post(`/v1/services/${serviceId}/staff`, data);
  return res.data.data;
}

export async function removeStaff(serviceId: string, userId: string) {
  await apiClient.delete(`/v1/services/${serviceId}/staff/${userId}`);
}

// --- Availability ---

export async function getAvailability(serviceId: string): Promise<AvailabilityRule[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/availability`);
  return res.data.data;
}

export async function createAvailabilityRule(serviceId: string, data: any) {
  const res = await apiClient.post(`/v1/services/${serviceId}/availability`, data);
  return res.data.data;
}

export async function deleteAvailabilityRule(serviceId: string, ruleId: string) {
  await apiClient.delete(`/v1/services/${serviceId}/availability/${ruleId}`);
}

// --- Cancellation Policies ---

export async function getPolicies(businessId: string): Promise<CancellationPolicy[]> {
  const res = await apiClient.get(`/v1/services/cancellation-policies?business_id=${businessId}`);
  return res.data.data;
}

export async function createPolicy(data: any) {
  const res = await apiClient.post('/v1/services/cancellation-policies', data);
  return res.data.data;
}

export async function updatePolicy(id: string, businessId: string, data: any): Promise<CancellationPolicy> {
  const res = await apiClient.put(`/v1/services/cancellation-policies/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deletePolicy(id: string, businessId: string): Promise<void> {
  await apiClient.delete(`/v1/services/cancellation-policies/${id}?business_id=${businessId}`);
}

// --- Tax Categories ---

export async function getTaxCategories(businessId: string): Promise<TaxCategory[]> {
  const res = await apiClient.get(`/v1/services/tax-categories?business_id=${businessId}`);
  return res.data.data;
}

export async function updateTaxCategory(id: string, businessId: string, data: { name?: string; rate?: number; is_default?: boolean }): Promise<TaxCategory> {
  const res = await apiClient.put(`/v1/services/tax-categories/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

// --- Templates ---

export async function getTemplates(businessType?: string) {
  const params = businessType ? `?business_type=${businessType}` : '';
  const res = await apiClient.get(`/v1/services/templates${params}`);
  return res.data.data;
}

export async function applyTemplate(businessId: string, businessType: string) {
  const res = await apiClient.post('/v1/services/templates/apply', { business_id: businessId, business_type: businessType });
  return res.data.data;
}

// --- Service Locations ---

export async function getServiceLocations(serviceId: string): Promise<string[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/locations`);
  return res.data.data;
}

export async function setServiceLocations(serviceId: string, businessId: string, locationIds: string[]) {
  const res = await apiClient.put(`/v1/services/${serviceId}/locations?business_id=${businessId}`, { location_ids: locationIds });
  return res.data.data;
}
