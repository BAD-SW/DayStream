import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, resetToDefault } from '../src/context/ThemeManager';

const MANAGED_PROPS = ['--color-primary', '--color-accent', '--color-background', '--color-surface', '--color-text', '--font-family', '--radius-md'];

beforeEach(() => {
  MANAGED_PROPS.forEach((p) => document.documentElement.style.removeProperty(p));
  document.documentElement.style.transition = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('applyTheme', () => {
  it('sets each present config key as its corresponding CSS custom property', () => {
    applyTheme({ colorPrimary: '#123456', fontFamily: 'Georgia' });
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--font-family')).toBe('Georgia');
  });

  it('clears properties absent from a sparse config rather than leaving stale values from the previous call', () => {
    applyTheme({ colorPrimary: '#123456', colorAccent: '#abcdef' });
    applyTheme({ colorPrimary: '#654321' }); // colorAccent omitted this time
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#654321');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('');
  });

  it('clears all managed properties when passed null', () => {
    applyTheme({ colorPrimary: '#123456' });
    applyTheme(null);
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
  });

  it('never mutates the data-theme attribute regardless of config', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    applyTheme({ colorPrimary: '#123456', colorBackground: '#000000' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    document.documentElement.setAttribute('data-theme', 'light');
    resetToDefault();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('skips the transition when prefers-reduced-motion is set', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as any;

    applyTheme({ colorPrimary: '#123456' });
    expect(document.documentElement.style.transition).toBe('');

    window.matchMedia = originalMatchMedia;
  });
});

describe('resetToDefault', () => {
  it('is equivalent to applying a null config', () => {
    applyTheme({ colorPrimary: '#123456' });
    resetToDefault();
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
  });
});
