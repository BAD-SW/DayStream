import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Theme {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    card: string;
  };
}

const defaultTheme: Theme = {
  colors: {
    primary: '#1a1a2e',
    secondary: '#16213e',
    accent: '#0f3460',
    background: '#f5f5f5',
    text: '#1a1a1a',
    card: '#ffffff',
  },
};

const ThemeContext = createContext<Theme>(defaultTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    // Load cached branding
    AsyncStorage.getItem('tenant_branding').then((cached) => {
      if (cached) {
        try {
          const branding = JSON.parse(cached);
          setTheme({
            colors: {
              primary: branding.primaryColor || defaultTheme.colors.primary,
              secondary: branding.secondaryColor || defaultTheme.colors.secondary,
              accent: branding.accentColor || defaultTheme.colors.accent,
              background: defaultTheme.colors.background,
              text: defaultTheme.colors.text,
              card: defaultTheme.colors.card,
            },
          });
        } catch {}
      }
    });
  }, []);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
