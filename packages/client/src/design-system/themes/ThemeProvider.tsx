import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

function detectSystemPreference(): 'dark' | 'light' {
  const stored = localStorage.getItem('theme-mode');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'dark' | 'light'>(detectSystemPreference);
  const [businessTheme, setBusinessTheme] = useState<BusinessTheme | null>(null);
  const { user } = useAuth();

  // Apply theme mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme-mode', mode);
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
    setMode((m) => (m === 'dark' ? 'light' : 'dark'));
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
