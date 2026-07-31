import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { useContextManager } from '../../context/ContextManager';
import { applyTheme, resetToDefault, ThemeConfig } from '../../context/ThemeManager';

interface BusinessTheme {
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  fontFamily?: string;
  borderRadius?: 'sharp' | 'rounded' | 'pill';
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
        // Tenant-level layer: brand.* config for the active tenant (the apiClient interceptor
        // injects X-Context-Tenant-Id automatically when this differs from the caller's own JWT tenant).
        const configRes = await apiClient.get('/v1/admin/config');
        const config = configRes.data.data || {};
        const merged: ThemeConfig = {
          colorPrimary: config['brand.primary_color'] || undefined,
          logoUrl: config['brand.logo_url'] || undefined,
        };

        // Business-level layer: overrides the tenant color when a business is in scope.
        if (activeContext.contextLevel === 'business' && activeContext.businessId) {
          try {
            const bizRes = await apiClient.get('/v1/admin/my-context', { params: { business_id: activeContext.businessId } });
            const business = bizRes.data.data?.business;
            if (business?.primary_color) merged.colorPrimary = business.primary_color;
          } catch {
            // Fall back to the tenant-level color only
          }
        }

        if (cancelled) return;
        setBusinessTheme({ primaryColor: merged.colorPrimary, logoUrl: merged.logoUrl });
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
