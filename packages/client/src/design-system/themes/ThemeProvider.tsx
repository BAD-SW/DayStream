import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { useContextManager } from '../../context/ContextManager';
import { applyTheme, resetToDefault, ThemeConfig } from '../../context/ThemeManager';

interface BusinessTheme {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  fontFamily?: string;
  fontSizeBase?: string;
  borderRadius?: 'sharp' | 'rounded' | 'pill';
}

/** Curated font list (ui-guidelines-and-theming.md §7) → actual CSS font-family stack. */
export const FONT_STACKS: Record<string, string> = {
  'Inter': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Merriweather': "'Merriweather', Georgia, 'Times New Roman', serif",
  'Source Sans 3': "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const GOOGLE_FONT_HREFS: Record<string, string> = {
  'Inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'Merriweather': 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
  'Source Sans 3': 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap',
};

/** Loads a curated Google Font on demand — only the one selected, never all of them upfront. */
export function loadGoogleFont(fontFamily: string | undefined): void {
  if (!fontFamily || !GOOGLE_FONT_HREFS[fontFamily]) return;
  const id = `google-font-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONT_HREFS[fontFamily];
  document.head.appendChild(link);
}

interface ThemeContextValue {
  mode: 'dark' | 'light';
  toggleMode: () => void;
  businessTheme: BusinessTheme | null;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Safely read from localStorage, returning null on any error
 * (handles private browsing in Safari and other restricted environments).
 */
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safely write to localStorage, silently ignoring errors.
 */
function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently ignore — private browsing or quota exceeded
  }
}

function detectSystemPreference(): 'dark' | 'light' {
  const stored = safeGetItem('theme-mode');
  // Validate stored value is exactly 'dark' or 'light'
  if (stored === 'dark' || stored === 'light') return stored;
  // Invalid or missing — fall through to OS preference detection
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Persist theme preference to user profile API (fire-and-forget).
 * Only calls if user is authenticated (access_token exists).
 */
function persistToApi(mode: 'dark' | 'light'): void {
  try {
    const token = safeGetItem('access_token');
    if (!token) return;

    fetch('/v1/users/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ theme_mode: mode }),
    }).catch(() => {
      // Silently ignore — fire-and-forget
    });
  } catch {
    // Silently ignore any errors
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'dark' | 'light'>(detectSystemPreference);
  const [businessTheme, setBusinessTheme] = useState<BusinessTheme | null>(null);
  const { activeContext } = useContextManager();
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply theme mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    safeSetItem('theme-mode', mode);
  }, [mode]);

  // Load and apply theme overrides for the active context (system → tenant → business cascade).
  // Driven by ContextManager's activeContext rather than raw JWT role, so switching context
  // (not just logging in as a given persona) re-applies the correct branding.
  useEffect(() => {
    let cancelled = false;

    async function loadContextTheme() {
      if (activeContext.contextLevel === 'system') {
        if (!cancelled) {
          setBusinessTheme(null);
          resetToDefault();
        }
        return;
      }

      try {
        // Tenant-level layer: brand.* config for the active tenant. getAllConfig()
        // (server-side) already COALESCEs each key to the platform-wide default from
        // sys_configuration_definitions when the tenant hasn't overridden it, so this one
        // fetch transparently covers both the "system default" and "tenant override" rungs
        // of the cascade (the apiClient interceptor injects X-Context-Tenant-Id automatically
        // when this differs from the caller's own JWT tenant).
        const configRes = await apiClient.get('/v1/admin/config');
        const config = configRes.data.data || {};
        const merged: ThemeConfig = {
          colorPrimary: config['brand.primary_color'] || undefined,
          colorSecondary: config['brand.secondary_color'] || undefined,
          logoUrl: config['brand.logo_url'] || undefined,
          fontSizeBase: config['brand.base_font_size'] ? `${config['brand.base_font_size']}px` : undefined,
        };
        let fontFamilyLabel: string | undefined = config['brand.font_family'] || undefined;

        // Business-level layer: overrides the tenant/system value per-field when a
        // business is in scope and has explicitly customized that field (NULL columns —
        // see 104_theme_cascade.sql — mean "not customized," so they simply don't override).
        if (activeContext.contextLevel === 'business' && activeContext.businessId) {
          try {
            const bizRes = await apiClient.get('/v1/admin/my-context', { params: { business_id: activeContext.businessId } });
            const business = bizRes.data.data?.business;
            if (business?.primary_color) merged.colorPrimary = business.primary_color;
            if (business?.secondary_color) merged.colorSecondary = business.secondary_color;
            if (business?.logo_url) merged.logoUrl = business.logo_url;
            if (business?.base_font_size) merged.fontSizeBase = `${business.base_font_size}px`;
            if (business?.font_family) fontFamilyLabel = business.font_family;
          } catch {
            // Fall back to the tenant-level values only
          }
        }

        if (fontFamilyLabel && fontFamilyLabel !== 'System Default') {
          loadGoogleFont(fontFamilyLabel);
          merged.fontFamily = FONT_STACKS[fontFamilyLabel];
        } else {
          fontFamilyLabel = undefined;
        }

        if (cancelled) return;
        setBusinessTheme({
          primaryColor: merged.colorPrimary,
          secondaryColor: merged.colorSecondary,
          logoUrl: merged.logoUrl,
          fontFamily: fontFamilyLabel,
          fontSizeBase: merged.fontSizeBase,
        });
        applyTheme(merged);
      } catch {
        if (!cancelled) {
          setBusinessTheme(null);
          resetToDefault();
        }
      }
    }

    loadContextTheme();
    return () => { cancelled = true; };
  }, [activeContext.contextLevel, activeContext.tenantId, activeContext.businessId]);

  function toggleMode() {
    const root = document.documentElement;

    // Add transition class BEFORE changing the theme
    root.classList.add('theme-transitioning');

    // Clear any existing timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Switch the mode
    setMode((m) => {
      const newMode = m === 'dark' ? 'light' : 'dark';
      // Fire-and-forget API persistence
      persistToApi(newMode);
      return newMode;
    });

    // Remove transition class after 250ms fallback timeout
    transitionTimeoutRef.current = setTimeout(() => {
      root.classList.remove('theme-transitioning');
      transitionTimeoutRef.current = null;
    }, 250);
  }

  return (
    <ThemeContext.Provider value={{ mode, toggleMode, businessTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
