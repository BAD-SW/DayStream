/**
 * WCAG contrast ratio utilities.
 * Used to validate business theme color overrides meet AA requirements.
 */

/**
 * Parse a hex color to RGB values.
 */
function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return [r, g, b];
}

/**
 * Calculate relative luminance of a color (WCAG 2.1 formula).
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two hex colors.
 * Returns a ratio >= 1 (e.g., 4.5 for AA normal text).
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a color combination meets WCAG AA requirements.
 * Normal text: 4.5:1, Large text (18px+ or 14px+ bold): 3:1
 */
export function meetsWcagAA(foreground: string, background: string, isLargeText = false): boolean {
  const ratio = getContrastRatio(foreground, background);
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

/**
 * Validate a business theme's primary color against backgrounds.
 * Returns warnings for any failing combinations.
 */
export function validateThemeContrast(primaryColor: string): string[] {
  const warnings: string[] = [];
  const darkBg = '#1A1A1A';
  const lightBg = '#FFFFFF';
  const darkSurface = '#242424';
  const lightSurface = '#F9F9F9';

  if (!meetsWcagAA(primaryColor, darkBg, true)) {
    warnings.push(`Primary color ${primaryColor} has insufficient contrast against dark background (${getContrastRatio(primaryColor, darkBg).toFixed(1)}:1, need 3:1)`);
  }
  if (!meetsWcagAA(primaryColor, lightBg, true)) {
    warnings.push(`Primary color ${primaryColor} has insufficient contrast against light background (${getContrastRatio(primaryColor, lightBg).toFixed(1)}:1, need 3:1)`);
  }

  return warnings;
}
