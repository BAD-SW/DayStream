import { apiClient } from './client';

export interface Resource {
  id: string;
  tenant_id: string;
  resource_type_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  capacity: number;
  status: string;
  photo_path: string | null;
  display_order: number;
  buffer_minutes: number;
  is_24_7: boolean;
  custom_attributes: Record<string, any>;
  type_name: string;
  category: string;
  created_at: string;
}

export interface ResourceType {
  id: string;
  name: string;
  category: string;
  description: string | null;
  is_system: boolean;
  resource_count: number;
}

// Resource Types
export async function getResourceTypes() {
  const res = await apiClient.get('/v1/resources/types');
  return res.data.data as ResourceType[];
}

export async function createResourceType(data: Record<string, any>) {
  const res = await apiClient.post('/v1/resources/types', data);
  return res.data.data;
}

// Resources CRUD
export async function getResources(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/resources', { params });
  return { data: res.data.data as Resource[], meta: res.data.meta };
}

export async function createResource(data: Record<string, any>) {
  const res = await apiClient.post('/v1/resources', data);
  return res.data.data;
}

export async function getResource(id: string) {
  const res = await apiClient.get(`/v1/resources/${id}`);
  return res.data.data as Resource;
}

export async function updateResource(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/resources/${id}`, data);
  return res.data.data;
}

export async function deactivateResource(id: string) {
  const res = await apiClient.put(`/v1/resources/${id}/deactivate`);
  return res.data.data;
}

// Schedules
export async function getSchedules(resourceId: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/schedule`);
  return res.data.data;
}

export async function createSchedule(resourceId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/resources/${resourceId}/schedule`, data);
  return res.data.data;
}

// Bookings
export async function getResourceBookings(resourceId: string, startDate: string, endDate: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/bookings`, { params: { start_date: startDate, end_date: endDate } });
  return res.data.data;
}

export async function createResourceBooking(resourceId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/resources/${resourceId}/bookings`, data);
  return res.data.data;
}

// Calendar
export async function getResourceCalendar(resourceId: string, startDate: string, endDate: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/calendar`, { params: { start_date: startDate, end_date: endDate } });
  return res.data.data;
}

export async function getTimeline(startDate: string, endDate: string, params?: Record<string, any>) {
  const res = await apiClient.get('/v1/resources/calendar/timeline', { params: { start_date: startDate, end_date: endDate, ...params } });
  return res.data.data;
}

// Utilization
export async function getUtilization(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/resources/utilization', { params });
  return res.data.data;
}

export async function getResourceUtilization(resourceId: string, startDate: string, endDate: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/utilization`, { params: { start_date: startDate, end_date: endDate } });
  return res.data.data;
}

// Maintenance
export async function getMaintenance(resourceId: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/maintenance`);
  return res.data.data;
}

export async function createMaintenance(resourceId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/resources/${resourceId}/maintenance`, data);
  return res.data.data;
}

// Dependencies
export async function getDependencies(resourceId: string) {
  const res = await apiClient.get(`/v1/resources/${resourceId}/dependencies`);
  return res.data.data;
}

export async function addDependency(resourceId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/resources/${resourceId}/dependencies`, data);
  return res.data.data;
}

// Find available
export async function findAvailableResource(data: Record<string, any>) {
  const res = await apiClient.post('/v1/resources/find-available', data);
  return res.data.data;
}
