import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

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
  const { user } = useAuth();
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply theme mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    safeSetItem('theme-mode', mode);
  }, [mode]);

  // Load business theme when user context changes
  useEffect(() => {
    if (user && (user.role === 'business_owner' || user.role === 'business_manager' || user.role === 'business_staff' || user.role === 'customer')) {
      loadBusinessTheme();
    } else {
      // System/Tenant users get default theme
      clearBusinessOverrides();
      setBusinessTheme(null);
    }
  }, [user]);

  // Apply business theme CSS overrides
  useEffect(() => {
    const root = document.documentElement;
    if (businessTheme) {
      if (businessTheme.primaryColor) root.style.setProperty('--color-primary', businessTheme.primaryColor);
      if (businessTheme.accentColor) root.style.setProperty('--color-accent', businessTheme.accentColor);
      if (businessTheme.fontFamily) root.style.setProperty('--font-family', businessTheme.fontFamily);
      if (businessTheme.borderRadius) {
        const radiusMap = { sharp: '2px', rounded: '8px', pill: '9999px' };
        root.style.setProperty('--radius-md', radiusMap[businessTheme.borderRadius]);
      }
    }
  }, [businessTheme]);

  async function loadBusinessTheme() {
    try {
      const res = await apiClient.get('/v1/admin/config');
      const config = res.data.data;
      setBusinessTheme({
        primaryColor: config['brand.primary_color'] || undefined,
        logoUrl: config['brand.logo_url'] || undefined,
      });
    } catch {
      // Non-critical — use defaults
    }
  }

  function clearBusinessOverrides() {
    const root = document.documentElement;
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-accent');
    root.style.removeProperty('--font-family');
    root.style.removeProperty('--radius-md');
  }

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
