/**
 * Design tokens exported as TypeScript constants.
 * Use these when you need token values in component logic (rare).
 * Prefer CSS variables directly in styles.
 */

export const tokens = {
  color: {
    primary: 'var(--color-primary)',
    primaryHover: 'var(--color-primary-hover)',
    primaryContrast: 'var(--color-primary-contrast)',
    background: 'var(--color-background)',
    surface: 'var(--color-surface)',
    surfaceHover: 'var(--color-surface-hover)',
    text: 'var(--color-text)',
    textSecondary: 'var(--color-text-secondary)',
    textDisabled: 'var(--color-text-disabled)',
    border: 'var(--color-border)',
    borderFocus: 'var(--color-border-focus)',
    accent: 'var(--color-accent)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    error: 'var(--color-error)',
    info: 'var(--color-info)',
  },
  space: {
    xs: 'var(--space-xs)',
    sm: 'var(--space-sm)',
    md: 'var(--space-md)',
    lg: 'var(--space-lg)',
    xl: 'var(--space-xl)',
    '2xl': 'var(--space-2xl)',
    '3xl': 'var(--space-3xl)',
  },
  radius: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
    full: 'var(--radius-full)',
  },
  font: {
    family: 'var(--font-family)',
    mono: 'var(--font-family-mono)',
  },
  shadow: {
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)',
    xl: 'var(--shadow-xl)',
    focus: 'var(--shadow-focus)',
  },
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;
