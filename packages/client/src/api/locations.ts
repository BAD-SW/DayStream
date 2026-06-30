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
