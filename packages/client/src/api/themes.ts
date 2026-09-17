import { apiClient } from './client';
import type {
  ThemeListItem, CfgTheme, ResolvedTheme,
  CreateThemeDto, UpdateThemeDto, ApplyThemeDto, ApplyThemeResponse,
} from '@daystream/shared';

export async function fetchThemes(): Promise<ThemeListItem[]> {
  const res = await apiClient.get('/v1/themes');
  return res.data.data;
}

export async function createTheme(dto: CreateThemeDto): Promise<CfgTheme> {
  const res = await apiClient.post('/v1/themes', dto);
  return res.data.data;
}

export async function updateTheme(id: string, dto: UpdateThemeDto): Promise<CfgTheme> {
  const res = await apiClient.put(`/v1/themes/${id}`, dto);
  return res.data.data;
}

export async function deleteTheme(id: string): Promise<void> {
  await apiClient.delete(`/v1/themes/${id}`);
}

export async function applyTheme(id: string, dto: ApplyThemeDto): Promise<ApplyThemeResponse> {
  const res = await apiClient.post(`/v1/themes/${id}/apply`, dto);
  return res.data.data;
}

export async function resolveTheme(businessId: string): Promise<ResolvedTheme> {
  const res = await apiClient.get('/v1/themes/resolve', { params: { business_id: businessId } });
  return res.data.data;
}

/** For the admin chrome itself at tenant context level (no business selected). */
export async function resolveThemeForTenant(tenantId: string): Promise<ResolvedTheme> {
  const res = await apiClient.get('/v1/themes/resolve', { params: { tenant_id: tenantId } });
  return res.data.data;
}

/** For the admin chrome itself at system context level (no tenant/business selected). */
export async function resolveThemeForSystem(): Promise<ResolvedTheme> {
  const res = await apiClient.get('/v1/themes/resolve');
  return res.data.data;
}

export interface BaseTokensResponse {
  tokens: Record<'bold-business' | 'classic', Record<string, string>>;
  labels: Record<string, string>;
}

export async function fetchBaseTokens(): Promise<BaseTokensResponse> {
  const res = await apiClient.get('/v1/themes/base-tokens');
  return res.data.data;
}
