import { BuiltInThemeId, ThemeListItem } from '@daystream/shared';

// CSS-custom-property tokens — applied via style.setProperty on the client.
export const TYPOGRAPHY_TOKEN_KEYS = [
  '--font-family',
  '--font-size-title',
  '--font-size-subtitle',
  '--font-size-body',
  '--font-size-small',
  '--font-weight-normal',
  '--font-weight-medium',
  '--font-weight-bold',
  '--color-text-title',
  '--color-text-body',
  '--color-text-secondary',
  '--color-text-muted',
] as const;

export const COLOR_TOKEN_KEYS = [
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-contrast',
  '--color-secondary',
  '--color-secondary-hover',
  '--color-secondary-contrast',
  '--color-background',
  '--color-surface',
  '--color-border',
  '--color-divider',
  '--color-sidebar-bg',
  '--color-header-bg',
  '--color-nav-active-bg',
  '--color-nav-active-text',
  '--color-accent',
  '--color-success',
  '--color-warning',
  '--color-error',
] as const;

export const CONFIGURABLE_TOKEN_KEYS = [...TYPOGRAPHY_TOKEN_KEYS, ...COLOR_TOKEN_KEYS] as const;
export type ConfigurableTokenKey = typeof CONFIGURABLE_TOKEN_KEYS[number];

// Non-CSS branding values — applied via direct DOM updates, never style.setProperty.
export const BRANDING_TOKEN_KEYS = ['logo-url', 'favicon-url', 'app-icon-url', 'brand-name'] as const;
export type BrandingTokenKey = typeof BRANDING_TOKEN_KEYS[number];

export const TOKEN_LABELS: Record<ConfigurableTokenKey | BrandingTokenKey, string> = {
  '--font-family':              'Font family',
  '--font-size-title':          'Title size',
  '--font-size-subtitle':       'Subtitle size',
  '--font-size-body':           'Body text size',
  '--font-size-small':          'Small text size',
  '--font-weight-normal':       'Normal weight',
  '--font-weight-medium':       'Medium weight',
  '--font-weight-bold':         'Bold weight',
  '--color-text-title':         'Title colour',
  '--color-text-body':          'Body text colour',
  '--color-text-secondary':     'Secondary text colour (sidebar, labels, subtext)',
  '--color-text-muted':         'Muted text colour',
  '--color-primary':            'Primary colour',
  '--color-primary-hover':      'Primary hover',
  '--color-primary-contrast':   'Primary text',
  '--color-secondary':          'Secondary colour',
  '--color-secondary-hover':    'Secondary hover',
  '--color-secondary-contrast': 'Secondary text',
  '--color-background':         'Page background',
  '--color-surface':            'Card surface',
  '--color-border':             'Border',
  '--color-divider':            'Divider',
  '--color-sidebar-bg':         'Sidebar background',
  '--color-header-bg':          'Header background',
  '--color-nav-active-bg':      'Active nav background',
  '--color-nav-active-text':    'Active nav text',
  '--color-accent':             'Accent colour',
  '--color-success':            'Success colour',
  '--color-warning':            'Warning colour',
  '--color-error':              'Error colour',
  'logo-url':                   'Logo',
  'favicon-url':                'Favicon',
  'app-icon-url':                'App icon',
  'brand-name':                  'Brand name override',
};

// Default configurable token values. Branding keys are intentionally absent — they
// default to "inherit / blank", never to a built-in value.
export const BUILT_IN_TOKENS: Record<BuiltInThemeId, Record<ConfigurableTokenKey, string>> = {
  classic: {
    '--font-family':              'System Default',
    '--font-size-title':          '28px',
    '--font-size-subtitle':       '20px',
    '--font-size-body':           '15px',
    '--font-size-small':          '13px',
    '--font-weight-normal':       '400',
    '--font-weight-medium':       '500',
    '--font-weight-bold':         '700',
    '--color-text-title':         '#F5F5F3',
    '--color-text-body':          '#F5F5F3',
    '--color-text-secondary':     '#B0B0B0',
    '--color-text-muted':         '#8A8A8A',
    '--color-primary':            '#C9A96E',
    '--color-primary-hover':      '#D4B87F',
    '--color-primary-contrast':   '#1A1A1A',
    '--color-secondary':          '#4A7FB5',
    '--color-secondary-hover':    '#6B9AC8',
    '--color-secondary-contrast': '#FFFFFF',
    '--color-background':         '#1A1A1A',
    '--color-surface':            '#242424',
    '--color-border':             '#333333',
    '--color-divider':            '#333333',
    '--color-sidebar-bg':         '#1A1A1A',
    '--color-header-bg':          '#1A1A1A',
    '--color-nav-active-bg':      'rgba(201, 169, 110, 0.15)',
    '--color-nav-active-text':    '#C9A96E',
    '--color-accent':             '#4A90A4',
    '--color-success':            '#2E7D32',
    '--color-warning':            '#E6A817',
    '--color-error':              '#D32F2F',
  },
  'bold-business': {
    '--font-family':              'System Default',
    '--font-size-title':          '28px',
    '--font-size-subtitle':       '20px',
    '--font-size-body':           '15px',
    '--font-size-small':          '13px',
    '--font-weight-normal':       '400',
    '--font-weight-medium':       '500',
    '--font-weight-bold':         '700',
    '--color-text-title':         '#172B4D',
    '--color-text-body':          '#172B4D',
    '--color-text-secondary':     '#42526E',
    '--color-text-muted':         '#97A0AF',
    '--color-primary':            '#0052CC',
    '--color-primary-hover':      '#2684FF',
    '--color-primary-contrast':   '#FFFFFF',
    '--color-secondary':          '#00A3BF',
    '--color-secondary-hover':    '#33B8CC',
    '--color-secondary-contrast': '#FFFFFF',
    '--color-background':         '#F4F5F7',
    '--color-surface':            '#FFFFFF',
    '--color-border':             '#C1C7D0',
    '--color-divider':            '#E3E8EF',
    '--color-sidebar-bg':         '#0052CC',
    '--color-header-bg':          '#FFFFFF',
    '--color-nav-active-bg':      '#2684FF',
    '--color-nav-active-text':    '#FFFFFF',
    '--color-accent':             '#4A90A4',
    '--color-success':            '#36B37E',
    '--color-warning':            '#FFAB00',
    '--color-error':              '#FF5630',
  },
};

export const BUILT_IN_THEME_LIST_ITEMS: ThemeListItem[] = [
  {
    id: 'bold-business',
    name: 'Bold Business',
    base_theme: 'bold-business',
    scope: 'system',
    scope_id: null,
    is_built_in: true,
    is_active: false,
    preview_tokens: {
      '--color-primary': '#0052CC',
      '--color-sidebar-bg': '#0052CC',
      '--color-background': '#F4F5F7',
      '--color-surface': '#FFFFFF',
      '--color-text-body': '#172B4D',
    },
  },
  {
    id: 'classic',
    name: 'Classic',
    base_theme: 'classic',
    scope: 'system',
    scope_id: null,
    is_built_in: true,
    is_active: false,
    preview_tokens: {
      '--color-primary': '#C9A96E',
      '--color-sidebar-bg': '#1A1A1A',
      '--color-background': '#1A1A1A',
      '--color-surface': '#242424',
      '--color-text-body': '#F5F5F3',
    },
  },
];

export function isBuiltInThemeId(id: string): id is BuiltInThemeId {
  return id === 'bold-business' || id === 'classic';
}

export function getBaseTokens(baseTheme: BuiltInThemeId): Record<string, string> {
  return { ...BUILT_IN_TOKENS[baseTheme] };
}

/** Removes keys from `tokens` whose value equals the base theme's default — keeps stored deltas minimal. */
export function stripDefaultTokens(baseTheme: BuiltInThemeId, tokens: Record<string, string>): Record<string, string> {
  const defaults = BUILT_IN_TOKENS[baseTheme] as Record<string, string>;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (defaults[key] !== value) result[key] = value;
  }
  return result;
}

/** Validates that every key in `tokens` is a recognised configurable or branding token. */
export function validateTokenKeys(tokens: Record<string, string>): string[] {
  const validKeys = new Set<string>([...CONFIGURABLE_TOKEN_KEYS, ...BRANDING_TOKEN_KEYS]);
  return Object.keys(tokens).filter((k) => !validKeys.has(k));
}
