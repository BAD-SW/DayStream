import { apiClient } from './client';

/** The signed-in person's own screen settings, kept on the server (follows them to any browser). */
export type PreferenceKey = 'reports.category_order';

export async function getPreference<T>(key: PreferenceKey): Promise<T | null> {
  const res = await apiClient.get(`/v1/profile/preferences/${key}`);
  return (res.data.data ?? null) as T | null;
}

/** Save a setting; null removes it, so the screen goes back to its default. */
export async function setPreference<T>(key: PreferenceKey, value: T | null): Promise<void> {
  await apiClient.put(`/v1/profile/preferences/${key}`, { value });
}
