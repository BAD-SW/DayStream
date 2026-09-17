// Small colour-math helpers for Theme Editor "Quick Setup" — deriving hover/contrast/
// nav shades from just a primary + secondary colour, so a casual user doesn't have to
// hand-pick all 18 colour tokens to get a coherent-looking theme.

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Blends a colour toward white by `amount` (0-1) — used for hover/active shades. */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Picks readable near-black or white text for a background colour. Not a WCAG
 * guarantee — a reasonable starting point; Advanced mode lets the user fix edge cases. */
export function contrastColor(hex: string): string {
  return relativeLuminance(hex) > 0.28 ? '#1A1A1A' : '#FFFFFF';
}

/** Derives the primary/secondary-dependent tokens from two brand colours. Every other
 * token (text, background, surface, borders, status colours, typography) is left to the
 * selected base theme's own defaults — Quick Setup only touches what a brand colour
 * plausibly implies. */
export function deriveFromBrandColors(primary: string, secondary: string): Record<string, string> {
  return {
    '--color-primary': primary,
    '--color-primary-hover': lighten(primary, 0.18),
    '--color-primary-contrast': contrastColor(primary),
    '--color-secondary': secondary,
    '--color-secondary-hover': lighten(secondary, 0.18),
    '--color-secondary-contrast': contrastColor(secondary),
    '--color-sidebar-bg': primary,
    '--color-nav-active-bg': lighten(primary, 0.18),
    '--color-nav-active-text': contrastColor(primary),
    '--color-accent': secondary,
  };
}
