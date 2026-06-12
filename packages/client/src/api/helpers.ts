import { apiClient } from './client';

/**
 * Typed API helper functions.
 * All responses follow the { data: T } structure.
 */

export async function apiGet<T>(path: string, params?: Record<string, any>): Promise<T> {
  const res = await apiClient.get(path, { params });
  return res.data.data ?? res.data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.post(path, body);
  return res.data.data ?? res.data;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.put(path, body);
  return res.data.data ?? res.data;
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await apiClient.delete(path);
  return res.data.data ?? res.data;
}
