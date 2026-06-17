import { apiClient } from './client';

export async function getServices(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/catalog', { params });
  return { services: res.data.data || [] };
}

export async function getServiceById(id: string) {
  const res = await apiClient.get(`/v1/catalog/${id}`);
  return res.data.data;
}
