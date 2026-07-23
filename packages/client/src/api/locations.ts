import { apiClient } from './client';

export interface Location {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  status: string;
  is_primary: boolean;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  description?: string;
  photo_url?: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  // Summary fields (from detail endpoint)
  staff_count?: number;
  service_count?: number;
  resource_count?: number;
}

export async function getLocations(businessId: string, filters?: { status?: string; search?: string }): Promise<Location[]> {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  const res = await apiClient.get(`/v1/locations?${params}`);
  return res.data.data;
}

export async function getLocation(id: string, businessId: string): Promise<Location> {
  const res = await apiClient.get(`/v1/locations/${id}?business_id=${businessId}`);
  return res.data.data;
}

export async function createLocation(data: {
  business_id: string;
  name: string;
  is_primary?: boolean;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  description?: string;
  display_order?: number;
}): Promise<Location> {
  const res = await apiClient.post('/v1/locations', data);
  return res.data.data;
}

export async function updateLocation(id: string, businessId: string, data: Partial<Location>): Promise<Location> {
  const res = await apiClient.put(`/v1/locations/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deactivateLocation(id: string, businessId: string): Promise<void> {
  await apiClient.put(`/v1/locations/${id}/deactivate?business_id=${businessId}`);
}

// --- Location Hours ---

export interface LocationHours {
  id?: string;
  location_id: string;
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

export async function getLocationHours(locationId: string): Promise<LocationHours[]> {
  const res = await apiClient.get(`/v1/locations/${locationId}/hours`);
  return res.data.data;
}

export async function setLocationHours(locationId: string, hours: Array<{ day_of_week: number; is_closed: boolean; open_time?: string | null; close_time?: string | null }>): Promise<LocationHours[]> {
  const res = await apiClient.put(`/v1/locations/${locationId}/hours`, { hours });
  return res.data.data;
}

// --- Location Hour Overrides ---

export interface LocationHourOverride {
  id?: string;
  location_id: string;
  override_date: string;
  label: string | null;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

export async function getLocationHourOverrides(locationId: string, year?: number): Promise<LocationHourOverride[]> {
  const params: Record<string, any> = {};
  if (year) params.year = year;
  const res = await apiClient.get(`/v1/locations/${locationId}/hours/overrides`, { params });
  return res.data.data;
}

export async function saveLocationHourOverride(locationId: string, data: { override_date: string; label?: string; is_closed: boolean; open_time?: string; close_time?: string }): Promise<LocationHourOverride> {
  const res = await apiClient.post(`/v1/locations/${locationId}/hours/overrides`, data);
  return res.data.data;
}

export async function deleteLocationHourOverride(locationId: string, overrideId: string): Promise<void> {
  await apiClient.delete(`/v1/locations/${locationId}/hours/overrides/${overrideId}`);
}

export async function getLocationHourOverrideYears(locationId: string): Promise<number[]> {
  const res = await apiClient.get(`/v1/locations/${locationId}/hours/overrides/years`);
  return res.data.data;
}

// --- Location Staff Assignments ---

export interface LocationStaff {
  id: string;
  staff_id: string;
  first_name: string;
  last_name: string;
  staff_ref: string;
}

export async function getLocationStaff(locationId: string): Promise<LocationStaff[]> {
  const res = await apiClient.get(`/v1/locations/${locationId}/staff`);
  return res.data.data;
}

export async function assignStaffToLocation(locationId: string, staffId: string): Promise<void> {
  await apiClient.post(`/v1/locations/${locationId}/staff`, { staff_id: staffId });
}

export async function removeStaffFromLocation(locationId: string, staffId: string): Promise<void> {
  await apiClient.delete(`/v1/locations/${locationId}/staff/${staffId}`);
}
