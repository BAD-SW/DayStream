export type ThemeScope = 'system' | 'tenant' | 'business';
export type BuiltInThemeId = 'bold-business' | 'classic';

export interface CfgTheme {
  id: string;
  tenant_id: string | null; // NULL for scope='system' rows — platform-wide, not tenant-owned
  name: string;
  base_theme: BuiltInThemeId;
  tokens: Record<string, string>; // delta overrides — CSS-var keys (--) and branding keys (no --)
  scope: ThemeScope;
  scope_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThemeListItem {
  id: string; // UUID for saved themes; 'bold-business' | 'classic' for built-ins
  name: string;
  base_theme: BuiltInThemeId;
  scope: ThemeScope;
  scope_id: string | null;
  is_built_in: boolean;
  is_active: boolean;
  preview_tokens: Record<string, string>; // small subset for swatch rendering
}

export interface ResolvedTheme {
  base_theme: BuiltInThemeId;
  tokens: Record<string, string>; // fully merged token set (typography + colors + branding)
  source: 'business' | 'tenant' | 'system' | 'default';
}

export interface CreateThemeDto {
  name: string;
  base_theme: BuiltInThemeId;
  scope: ThemeScope;
  scope_id: string | null;
  tokens?: Record<string, string>;
}

export interface UpdateThemeDto {
  name?: string;
  tokens?: Record<string, string>;
}

export interface ApplyThemeDto {
  scope: ThemeScope;
  scope_id: string | null;
}

export interface ApplyThemeResponse {
  resolved: ResolvedTheme;
}
