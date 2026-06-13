import { describe, it, expect } from 'vitest';
import { getContrastRatio, meetsWcagAA, validateThemeContrast } from '../src/design-system/utils/contrast';

describe('Contrast utilities', () => {
  it('black on white has 21:1 ratio', () => {
    const ratio = getContrastRatio('#000000', '#FFFFFF');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('white on white has 1:1 ratio', () => {
    const ratio = getContrastRatio('#FFFFFF', '#FFFFFF');
    expect(ratio).toBeCloseTo(1, 0);
  });

  it('meetsWcagAA returns true for high contrast', () => {
    expect(meetsWcagAA('#000000', '#FFFFFF')).toBe(true);
  });

  it('meetsWcagAA returns false for low contrast', () => {
    expect(meetsWcagAA('#777777', '#888888')).toBe(false);
  });

  it('meetsWcagAA large text has lower threshold', () => {
    // 3:1 is enough for large text
    expect(meetsWcagAA('#767676', '#FFFFFF', true)).toBe(true);
  });

  it('validateThemeContrast returns no warnings for gold on dark', () => {
    const warnings = validateThemeContrast('#C9A96E');
    // Gold on dark (#1A1A1A) should pass for large text
    expect(warnings.filter(w => w.includes('dark'))).toHaveLength(0);
  });

  it('validateThemeContrast flags very light colors on light bg', () => {
    const warnings = validateThemeContrast('#EEEEEE');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('light background'))).toBe(true);
  });
});
