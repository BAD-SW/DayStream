import { describe, it, expect, afterEach } from 'vitest';
import { applyBaseTheme } from '../src/context/ThemeManager';
import { CURATED_FONTS, fontStackFor } from '../src/design-system/themes/ThemeProvider';

afterEach(() => document.documentElement.removeAttribute('data-base-theme'));

describe('Navy base theme (THE-6)', () => {
  it('sets data-base-theme="navy" and clears it again for Classic', () => {
    applyBaseTheme('navy');
    expect(document.documentElement.getAttribute('data-base-theme')).toBe('navy');
    applyBaseTheme('classic');
    expect(document.documentElement.hasAttribute('data-base-theme')).toBe(false);
  });

  it('offers Plus Jakarta Sans in the curated font list', () => {
    expect(CURATED_FONTS).toContain('Plus Jakarta Sans');
  });
});

describe('fontStackFor', () => {
  it('maps a curated label to a full stack with fallbacks', () => {
    expect(fontStackFor('Plus Jakarta Sans')).toMatch(/^'Plus Jakarta Sans', .*sans-serif$/);
  });

  it('maps "System Default" to a real system stack instead of an unknown font name', () => {
    const stack = fontStackFor('System Default')!;
    expect(stack).not.toContain('System Default');
    expect(stack).toMatch(/sans-serif$/);
  });

  it('passes unknown labels through and leaves empty values unset', () => {
    expect(fontStackFor('Georgia')).toBe('Georgia');
    expect(fontStackFor(undefined)).toBeUndefined();
  });
});
