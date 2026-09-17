import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useContextManager } from '../../context/ContextManager';
import { applyBaseTheme, applyResolvedTokens, resetToDefault } from '../../context/ThemeManager';
import { resolveTheme, resolveThemeForTenant, resolveThemeForSystem } from '../../api/themes';
import { ResolvedTheme } from '@daystream/shared';

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
  /** The last theme resolved via GET /v1/themes/resolve for the active business context
   * (Theme Setup module) — null while browsing at tenant/system level with no business
   * selected, since resolution is always business-scoped. Used by the Theme Gallery to
   * mark the correct card "Active" without a separate fetch. */
  resolvedTheme: ResolvedTheme | null;
  /** Re-resolves and re-applies the theme for the current context. Call this after
   * successfully applying a theme (Theme Setup module) so the change shows up live —
   * applying only writes the database; nothing else re-triggers the resolve-on-load
   * effect, since the active context itself hasn't changed. */
  refreshTheme: () => Promise<void>;
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
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme | null>(null);
  const { activeContext } = useContextManager();
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply theme mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    safeSetItem('theme-mode', mode);
  }, [mode]);

  // Resolve and apply the active theme (Theme Setup module) for the active context —
  // business-scoped when a business is selected, tenant-scoped when only a tenant is
  // selected, and platform-scoped otherwise, so the admin chrome itself (which has no
  // business in view) still reflects a theme applied at tenant or system scope.
  // A generation counter (not a plain effect-cleanup flag) guards against a stale
  // in-flight request winning a race against a newer one, since refreshTheme is also
  // called imperatively (not just from the effect) after a manual "Apply" action.
  const requestGenerationRef = useRef(0);

  const refreshTheme = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      const resolved = activeContext.contextLevel === 'business' && activeContext.businessId
        ? await resolveTheme(activeContext.businessId)
        : activeContext.contextLevel === 'tenant' && activeContext.tenantId
          ? await resolveThemeForTenant(activeContext.tenantId)
          : await resolveThemeForSystem();
      if (requestGenerationRef.current !== generation) return;
      setResolvedTheme(resolved);
      applyBaseTheme(resolved.base_theme === 'bold-business' ? 'bold-business' : null);
      applyResolvedTokens(resolved.tokens);
      const fontFamilyLabel = resolved.tokens['--font-family'];
      if (fontFamilyLabel && fontFamilyLabel !== 'System Default') loadGoogleFont(fontFamilyLabel);
    } catch {
      if (requestGenerationRef.current !== generation) return;
      setResolvedTheme(null);
      applyBaseTheme(null);
      resetToDefault();
    }
  }, [activeContext.contextLevel, activeContext.tenantId, activeContext.businessId]);

  useEffect(() => {
    refreshTheme();
  }, [refreshTheme]);

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
    <ThemeContext.Provider value={{ mode, toggleMode, resolvedTheme, refreshTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
