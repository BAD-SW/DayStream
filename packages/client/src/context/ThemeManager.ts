export interface ThemeConfig {
  colorPrimary?: string;
  colorSecondary?: string;
  colorAccent?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
  colorTitle?: string;
  fontFamily?: string;
  /** Root font-size in px (e.g. "15px") — every --font-size-* token is defined in `rem`,
   * so scaling the document root scales the whole type scale proportionally. Applied
   * directly to `documentElement.style.fontSize`, not as a custom property (see below). */
  fontSizeBase?: string;
  borderRadiusBase?: string;
  logoUrl?: string;
}

const TOKEN_MAP: Record<keyof Omit<ThemeConfig, 'logoUrl' | 'fontSizeBase'>, string> = {
  colorPrimary: '--color-primary',
  colorSecondary: '--color-secondary',
  colorAccent: '--color-accent',
  colorBackground: '--color-background',
  colorSurface: '--color-surface',
  colorText: '--color-text',
  colorTitle: '--color-text-title',
  fontFamily: '--font-family',
  borderRadiusBase: '--radius-md',
};

const MANAGED_PROPERTIES = Object.values(TOKEN_MAP);

/**
 * Applies (or clears) CSS custom property overrides on :root for the active context's theme.
 * Absent keys are left untouched — callers are responsible for passing the fully merged
 * cascade (business overrides layered over tenant overrides layered over platform defaults).
 * Never touches `data-theme` — light/dark mode is owned exclusively by ThemeProvider's toggle.
 */
export function applyTheme(config: ThemeConfig | null): void {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    const transitionProps = MANAGED_PROPERTIES.map((p) => `${p} 250ms cubic-bezier(0.4, 0, 0.2, 1)`).join(', ');
    root.style.transition = transitionProps;
    setTimeout(() => {
      root.style.transition = '';
    }, 300);
  }

  (Object.keys(TOKEN_MAP) as Array<keyof typeof TOKEN_MAP>).forEach((key) => {
    const cssVar = TOKEN_MAP[key];
    const value = config?.[key];
    if (value) {
      root.style.setProperty(cssVar, value);
    } else {
      root.style.removeProperty(cssVar);
    }
  });

  if (config?.fontSizeBase) {
    root.style.fontSize = config.fontSizeBase;
  } else {
    root.style.fontSize = '';
  }
}

/** Removes all context-supplied overrides, restoring platform default styling. */
export function resetToDefault(): void {
  applyTheme(null);
}

const VALID_BASE_THEMES = ['bold-business'];

/**
 * Selects a base palette (Theme Setup) via a dedicated `data-base-theme` attribute —
 * independent from `data-theme`, which stays exclusively owned by the dark/light toggle
 * (see ThemeProvider.tsx). 'classic' (the existing default look) and any unrecognized
 * value simply clear the attribute, since Classic has no override CSS of its own.
 */
export function applyBaseTheme(baseTheme: string | null | undefined): void {
  const root = document.documentElement;
  if (baseTheme && VALID_BASE_THEMES.includes(baseTheme)) {
    root.setAttribute('data-base-theme', baseTheme);
  } else {
    root.removeAttribute('data-base-theme');
  }
}

// Mirrors packages/server/src/services/themeTokens.ts CONFIGURABLE_TOKEN_KEYS — the client
// can't import server source, so the CSS-var allowlist is duplicated here deliberately.
const CONFIGURABLE_TOKEN_KEYS = [
  '--font-family', '--font-size-title', '--font-size-subtitle', '--font-size-body', '--font-size-small',
  '--font-weight-normal', '--font-weight-medium', '--font-weight-bold',
  '--color-text-title', '--color-text-body', '--color-text-secondary', '--color-text-muted',
  '--color-primary', '--color-primary-hover', '--color-primary-contrast',
  '--color-secondary', '--color-secondary-hover', '--color-secondary-contrast',
  '--color-background', '--color-surface', '--color-border', '--color-divider',
  '--color-sidebar-bg', '--color-header-bg', '--color-nav-active-bg', '--color-nav-active-text',
  '--color-accent', '--color-success', '--color-warning', '--color-error',
] as const;

const BRANDING_TOKEN_KEYS = ['logo-url', 'favicon-url', 'app-icon-url', 'brand-name'] as const;

/**
 * Applies a resolved theme's full token map (Theme Setup module — GET /v1/themes/resolve).
 * CSS-var keys (CONFIGURABLE_TOKEN_KEYS) are set as inline style overrides on :root.
 * Branding keys (BRANDING_TOKEN_KEYS) are routed to applyBranding() instead — they are
 * never passed to style.setProperty (see design.md Property 11).
 */
export function applyResolvedTokens(tokens: Record<string, string> | null | undefined): void {
  const root = document.documentElement;
  const branding: Partial<Record<typeof BRANDING_TOKEN_KEYS[number], string>> = {};

  for (const key of CONFIGURABLE_TOKEN_KEYS) {
    const value = tokens?.[key];
    if (value) root.style.setProperty(key, value);
    else root.style.removeProperty(key);
  }
  for (const key of BRANDING_TOKEN_KEYS) {
    if (tokens?.[key]) branding[key] = tokens[key];
  }
  applyBranding(branding);
}

/**
 * Applies branding tokens via direct DOM update rather than CSS custom properties.
 * logo-url/app-icon-url/brand-name have no consuming UI surface yet (the topbar uses a
 * fixed platform wordmark, not a swappable per-business logo) — they're stored as data
 * attributes on <html> so the resolved value is real and inspectable, ready for a future
 * component to read. favicon-url is fully wired (updates the actual <link rel="icon">).
 */
export function applyBranding(branding: Partial<Record<'logo-url' | 'favicon-url' | 'app-icon-url' | 'brand-name', string>>): void {
  applyFavicon(branding['favicon-url'] ?? null);
  const root = document.documentElement;
  const setOrClear = (attr: string, value: string | undefined) => {
    if (value) root.dataset[attr] = value; else delete root.dataset[attr];
  };
  setOrClear('themeLogoUrl', branding['logo-url']);
  setOrClear('themeAppIconUrl', branding['app-icon-url']);
  setOrClear('themeBrandName', branding['brand-name']);
}

/** Swaps the browser-tab favicon, falling back to the platform default when unset. */
export function applyFavicon(url: string | null | undefined): void {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (url) {
    link.removeAttribute('type'); // let the browser sniff the uploaded file's actual type
    link.href = url;
  } else {
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
  }
}
