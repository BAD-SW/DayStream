export interface ThemeConfig {
  colorPrimary?: string;
  colorAccent?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
  fontFamily?: string;
  borderRadiusBase?: string;
  logoUrl?: string;
}

const TOKEN_MAP: Record<keyof Omit<ThemeConfig, 'logoUrl'>, string> = {
  colorPrimary: '--color-primary',
  colorAccent: '--color-accent',
  colorBackground: '--color-background',
  colorSurface: '--color-surface',
  colorText: '--color-text',
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
}

/** Removes all context-supplied overrides, restoring platform default styling. */
export function resetToDefault(): void {
  applyTheme(null);
}
