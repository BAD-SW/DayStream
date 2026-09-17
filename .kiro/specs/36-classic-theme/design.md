# Design Document: Classic Theme

**Date**: 2026-07-02
**Status**: 🎨 Design Phase
**Dependencies**: Spec 35 (Bold Business Theme)

---

## Overview

The Classic theme packages DayStream's existing dark-first warm gold/ivory design as a formal named theme. There are no visual changes — the work is entirely additive documentation and packaging work. A new `classic.css` file re-declares the existing token values under explicit `[data-theme='classic']` and `[data-theme='classic-light']` selector blocks, a companion `theme-classic.json` token file is created following the same schema as `theme-bold-business.json`, and `ThemeProvider.tsx` is updated to recognise `'classic'` and `'classic-light'` as valid mode values.

**PBT Applicability Assessment**: This feature is **not suitable for property-based testing**. Every acceptance criterion is either a static file/schema check, a deterministic CSS token value assertion, a contrast ratio calculation against known fixed colour pairs, or a theme coexistence integration test. There are no universal properties that benefit from generating and running 100+ random inputs. The Correctness Properties section is omitted. Smoke tests, example-based unit tests, and integration tests are used instead.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Components and Interfaces](#components-and-interfaces)
3. [Data Models](#data-models)
4. [Error Handling](#error-handling)
5. [Testing Strategy](#testing-strategy)

---

## Architecture

DayStream's theme system uses CSS custom properties defined at `:root` (dark defaults in `colors.css`) with named overrides scoped to `[data-theme]` attribute selectors on `document.documentElement`. `ThemeProvider.tsx` sets this attribute reactively based on the active mode.

After this feature, the selector cascade is:

```
:root                         ← dark defaults (colors.css) — unchanged, serves as fallback
[data-theme='dark']           ← explicit dark override (dark.css) — unchanged
[data-theme='light']          ← warm ivory override (light.css) — unchanged
[data-theme='bold-business']  ← blue SaaS override (bold-business.css) — from spec 35, unchanged
[data-theme='classic']        ← NEW: same values as :root dark defaults, explicit selection
[data-theme='classic-light']  ← NEW: same values as [data-theme='light'], explicit selection
```

Business-level brand overrides from `ThemeManager.applyTheme()` are applied as inline `style` declarations on `:root`, which have higher specificity than any `[data-theme]` attribute rule. The cascade for Classic-themed sessions is therefore:

```
:root dark defaults → classic token overrides → business brand overrides
```

### File Layout

```
packages/client/src/
├── main.tsx                                        ← add classic.css import
└── design-system/
    ├── themes/
    │   ├── dark.css                                ← unchanged
    │   ├── light.css                               ← unchanged
    │   ├── bold-business.css                       ← unchanged (spec 35)
    │   ├── classic.css                             ← NEW
    │   └── ThemeProvider.tsx                       ← update mode type + valid values
    └── tokens/
        ├── colors.css                              ← unchanged
        └── theme-classic.json                      ← NEW
```

No changes to any page, component, layout, or route file. No changes to `colors.css` or `light.css`.

### Why Two Selectors in One File?

The dark variant (`[data-theme='classic']`) and light variant (`[data-theme='classic-light']`) live in the same `classic.css` file rather than two separate files. This mirrors how themes are discussed conceptually (Classic is one theme with two modes) and keeps the number of CSS files manageable. The Bold Business theme uses a single file with a single selector because it is a light-only theme; Classic needs both selectors to cover both modes.

Alternative considered: use a single `[data-theme='classic']` selector and rely on a second dimension (e.g. a `data-mode` attribute) to select dark vs. light. This adds complexity to `ThemeProvider.tsx` without benefit — the existing `data-theme` approach already works well for Bold Business and the pattern is consistent. The two-selector approach in one file is simpler and requires fewer ThemeProvider changes.

---

## Components and Interfaces

### 2.1 classic.css — Complete Token Map

```css
/* Classic Theme — DayStream's original dark-first warm gold/ivory design
 * Dark variant: warm gold (#C9A96E) on near-black (#1A1A1A)
 * Light variant: warm gold (#C89B3C) on warm ivory (#F8F5EE)
 *
 * Values are identical to:
 *   Dark  → :root defaults in tokens/colors.css
 *   Light → [data-theme='light'] in themes/light.css
 *
 * These blocks exist to make Classic explicitly selectable by name.
 * The originals in colors.css and light.css remain unchanged as fallbacks.
 */

/* ─── Classic Dark Variant ─────────────────────────────────────────────────── */

[data-theme='classic'] {
  color-scheme: dark;

  /* Primary */
  --color-primary: #C9A96E;
  --color-primary-hover: #D4B87F;
  --color-primary-active: #B8945A;
  --color-primary-contrast: #1A1A1A;

  /* Background & Surface */
  --color-background: #1A1A1A;
  --color-surface: #242424;
  --color-surface-hover: #2D2D2D;
  --color-surface-active: #333333;
  --color-surface-modal: #2A2A2A;

  /* Row hover */
  --row-hover-bg: rgba(201, 169, 110, 0.08);

  /* Text */
  --color-text: #F5F5F3;
  --color-text-secondary: #B0B0B0;
  --color-text-disabled: #8A8A8A;
  --color-text-inverse: #1A1A1A;

  /* Border */
  --color-border: #333333;
  --color-border-hover: #4A4A4A;
  --color-border-focus: #C9A96E;

  /* Accent */
  --color-accent: #4A90A4;
  --color-accent-hover: #6BA8BC;
  --color-accent-contrast: #FFFFFF;

  /* Semantic — Success */
  --color-success: #2E7D32;
  --color-success-light: #66BB6A;
  --color-success-dark: #1B5E20;
  --color-success-bg: rgba(46, 125, 50, 0.1);

  /* Semantic — Warning */
  --color-warning: #E6A817;
  --color-warning-light: #FFD54F;
  --color-warning-dark: #C49000;
  --color-warning-bg: rgba(230, 168, 23, 0.1);

  /* Semantic — Error */
  --color-error: #D32F2F;
  --color-error-light: #EF5350;
  --color-error-dark: #C62828;
  --color-error-bg: rgba(211, 47, 47, 0.1);

  /* Semantic — Info */
  --color-info: #4A90A4;
  --color-info-light: #6BA8BC;
  --color-info-dark: #3A7A8E;
  --color-info-bg: rgba(74, 144, 164, 0.1);

  /* Capacity override */
  --color-capacity-override: #8B5CF6;
  --color-capacity-override-bg: rgba(139, 92, 246, 0.1);

  /* Customer lifecycle stage pills */
  --stage-lead-bg: rgba(150, 150, 140, 0.16);
  --stage-lead-fg: #C9C9BE;
  --stage-trial-bg: rgba(111, 160, 216, 0.18);
  --stage-trial-fg: #8FB8E8;
  --stage-active-bg: rgba(143, 191, 134, 0.18);
  --stage-active-fg: #A9D49E;
  --stage-at-risk-bg: rgba(224, 164, 104, 0.18);
  --stage-at-risk-fg: #E8B77E;
  --stage-churned-bg: rgba(212, 122, 96, 0.18);
  --stage-churned-fg: #E29B82;
  --stage-winback-bg: rgba(169, 138, 209, 0.18);
  --stage-winback-fg: #C4A8E8;

  /* Sidebar */
  --color-sidebar-bg: #1A1A1A;
  --color-sidebar-border: rgba(255, 255, 255, 0.08);

  /* Header */
  --color-header-bg: #1A1A1A;

  /* Navigation */
  --color-nav-active-bg: rgba(201, 169, 110, 0.15);
  --color-nav-active-text: #C9A96E;

  /* Background gradient */
  --color-background-gradient: none;

  /* Overlay */
  --color-overlay: rgba(0, 0, 0, 0.5);
}


/* ─── Classic Light Variant ────────────────────────────────────────────────── */

[data-theme='classic-light'] {
  color-scheme: light;

  /* Main backgrounds */
  --color-background: #F8F5EE;
  --color-background-gradient: radial-gradient(ellipse at bottom right, rgba(200,155,60,0.03), transparent 35%), linear-gradient(180deg, #FAF8F2 0%, #F5F1E8 100%);
  --color-surface: rgba(255,255,255,0.7);
  --color-surface-hover: #F5F0E6;
  --color-surface-active: #EDE7D9;
  --color-surface-elevated: #FDFBF7;
  --color-surface-modal: #FFFFFF;
  --row-hover-bg: #F3EEE1;

  /* Sidebar */
  --color-sidebar-bg: #F7F3EA;
  --color-sidebar-border: #E5DDCD;

  /* Header */
  --color-header-bg: #FFFFFF;

  /* Navigation */
  --color-nav-active-bg: #F1E7D0;
  --color-nav-active-text: #A77D22;

  /* Text */
  --color-text: #2C2C2C;
  --color-text-secondary: #666666;
  --color-text-muted: #999999;
  --color-text-inverse: #F5F5F3;

  /* Brand / Primary */
  --color-primary: #C89B3C;
  --color-primary-hover: #B88A2E;
  --color-primary-active: #A67B28;
  --color-primary-contrast: #FFFFFF;

  /* Borders */
  --color-border: #E5DDCD;
  --color-border-hover: #D8CEBA;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.05);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.08);

  /* Status colors */
  --color-success: #16a34a;
  --color-error: #dc2626;
  --color-warning: #d97706;
  --color-info: #2563eb;
  --color-capacity-override: #7C3AED;

  /* Customer lifecycle stage pills (identical to light.css) */
  --stage-lead-bg: #EDE7D8;
  --stage-lead-fg: #5B5B54;
  --stage-trial-bg: #E4EEF7;
  --stage-trial-fg: #33587F;
  --stage-active-bg: #E9F0E5;
  --stage-active-fg: #4B6B45;
  --stage-at-risk-bg: #FBE8D3;
  --stage-at-risk-fg: #9A5B23;
  --stage-churned-bg: #F5E3DE;
  --stage-churned-fg: #8B4A3A;
  --stage-winback-bg: #EDE8F6;
  --stage-winback-fg: #5B4E8A;
}
```

### 2.2 ThemeProvider.tsx — Required Changes

The mode type union and validation guard need to accept the two new Classic variant identifiers:

```tsx
// Before (spec 35 state):
type ThemeMode = 'dark' | 'light' | 'bold-business';

// After:
type ThemeMode = 'dark' | 'light' | 'bold-business' | 'classic' | 'classic-light';

// Update the guard in detectSystemPreference():
function detectSystemPreference(): ThemeMode {
  const stored = safeGetItem('theme-mode');
  if (
    stored === 'dark' ||
    stored === 'light' ||
    stored === 'bold-business' ||
    stored === 'classic' ||
    stored === 'classic-light'
  ) return stored;
  // existing fallback unchanged — Classic does NOT become the new default
  return 'bold-business';
}
```

No other logic in `ThemeProvider.tsx` requires changes — the `useEffect` that calls `document.documentElement.setAttribute('data-theme', mode)` works identically for any string value.

### 2.3 main.tsx — Import Addition

```tsx
import './design-system/themes/dark.css';
import './design-system/themes/light.css';
import './design-system/themes/bold-business.css';
import './design-system/themes/classic.css';        // ← add here
import './design-system/themes/theme-lock.css';
import './design-system/themes/transitions.css';
```

Import order is not significant for CSS custom property overrides (specificity is equal; the active `[data-theme]` attribute determines which block applies), but placing `classic.css` after `bold-business.css` is clean and consistent with file creation order.

---

## Data Models

### theme-classic.json

```json
{
  "meta": {
    "name": "Classic",
    "id": "classic",
    "description": "DayStream's original dark-first warm gold and ivory design — understated luxury for wellness and lifestyle brands",
    "version": "1.0.0"
  },
  "tokens": {
    "color-background":       { "label": "Page Background",              "value": "#1A1A1A",                    "configurable": true  },
    "color-surface":          { "label": "Card / Table Surface",         "value": "#242424",                    "configurable": true  },
    "color-primary":          { "label": "Primary Brand Colour",         "value": "#C9A96E",                    "configurable": true  },
    "color-primary-hover":    { "label": "Primary Hover",                "value": "#D4B87F",                    "configurable": false },
    "color-text":             { "label": "Primary Text",                 "value": "#F5F5F3",                    "configurable": true  },
    "color-text-secondary":   { "label": "Secondary Text",               "value": "#B0B0B0",                    "configurable": false },
    "color-border":           { "label": "Default Border",               "value": "#333333",                    "configurable": false },
    "color-sidebar-bg":       { "label": "Sidebar Background",           "value": "#1A1A1A",                    "configurable": true  },
    "color-header-bg":        { "label": "Top Bar Background",           "value": "#1A1A1A",                    "configurable": true  },
    "color-nav-active-bg":    { "label": "Active Navigation Background", "value": "rgba(201, 169, 110, 0.15)",  "configurable": true  },
    "color-nav-active-text":  { "label": "Active Navigation Text",       "value": "#C9A96E",                    "configurable": false },
    "color-accent":           { "label": "Accent / Recovery Blue",       "value": "#4A90A4",                    "configurable": true  },
    "color-success":          { "label": "Success Accent",               "value": "#2E7D32",                    "configurable": false },
    "color-error":            { "label": "Error Accent",                 "value": "#D32F2F",                    "configurable": false }
  }
}
```

Token file conventions (same as `theme-bold-business.json`):
- Property names match the CSS custom property name without the `--` prefix
- `configurable: true` tokens are user-adjustable in a future theme editor
- `configurable: false` tokens are derived or system-defined
- The `value` field records the dark-variant default; light-variant values live in `classic.css`

---

## Error Handling

**Missing CSS import**: If `classic.css` is not imported in `main.tsx`, setting `data-theme='classic'` has no visual effect — the app renders with `:root` dark defaults (which happen to be the same values). Visually correct by coincidence, but the theme is not explicitly applied. The smoke test for the import line catches this before deployment.

**Unknown classic variant stored in localStorage**: If a user somehow has `'classic'` or `'classic-light'` stored in localStorage before the feature ships (impossible in practice), the pre-feature ThemeProvider validation guard would fall through to the default. After this feature ships, both values are accepted. There is no migration needed.

**Specificity collision with light.css**: Both `[data-theme='classic-light']` and `[data-theme='light']` are attribute selectors with equal specificity. When `data-theme='classic-light'` is active, only the `[data-theme='classic-light']` block matches — the `[data-theme='light']` block does not match. There is no collision in practice because a single `data-theme` value is set at any time.

**Contrast on business overrides**: Business-level brand overrides via `ThemeManager.applyTheme()` can override `--color-primary` to any arbitrary value. A low-contrast brand colour would break WCAG compliance. This is pre-existing behaviour shared with all other themes and is out of scope for this feature.

---

## Testing Strategy

PBT does not apply to this feature (see Overview). All acceptance criteria are static file checks, deterministic CSS token assertions, or theme coexistence integration tests. The test suite uses three layers:

### Smoke Tests — File Structure

| Test | What it checks |
|------|----------------|
| `classic.css` exists at `packages/client/src/design-system/themes/classic.css` | File created |
| `classic.css` dark block is scoped to `[data-theme='classic']` only | CSS structure |
| `classic.css` light block is scoped to `[data-theme='classic-light']` only | CSS structure |
| `main.tsx` contains the `classic.css` import line | Import added |
| `theme-classic.json` parses as valid JSON | File integrity |
| `theme-classic.json` has `meta.name === 'Classic'` and `meta.id === 'classic'` | Schema |
| `theme-classic.json` `tokens` has ≥ 10 entries each with `value`, `label`, `configurable` | Schema |
| `colors.css` content is unchanged (hash or string comparison) | Non-regression |
| `light.css` content is unchanged (hash or string comparison) | Non-regression |
| No `.tsx` or `.ts` component files were modified by this change | Scope constraint |

### Example-Based Unit Tests — CSS Token Values and Contrast

| Test | Assertion |
|------|-----------|
| `--color-background` under `classic` | `#1A1A1A` |
| `--color-primary` under `classic` | `#C9A96E` |
| `--color-sidebar-bg` under `classic` | `#1A1A1A` |
| `--color-nav-active-text` under `classic` | `#C9A96E` |
| `--color-background` under `classic-light` | `#F8F5EE` |
| `--color-primary` under `classic-light` | `#C89B3C` |
| `--color-sidebar-bg` under `classic-light` | `#F7F3EA` |
| WCAG contrast: `#F5F5F3` on `#1A1A1A` (classic dark body text) | ≥ 4.5:1 (actual ≈ 16.1:1) |
| WCAG contrast: `#2C2C2C` on `#F8F5EE` (classic-light body text) | ≥ 4.5:1 (actual ≈ 12.47:1) |
| All 6 classic-light stage pill pairs | ≥ 4.5:1 each |
| `ThemeProvider` accepts `'classic'` without fallback | Mode restored correctly |
| `ThemeProvider` accepts `'classic-light'` without fallback | Mode restored correctly |
| No `data-theme` stored → default is unchanged (not `'classic'`) | Non-regression |

### Integration Tests — Theme Coexistence

| Test | Assertion |
|------|-----------|
| Set `data-theme='classic'` → correct dark tokens applied | Integration |
| Set `data-theme='classic-light'` → correct light tokens applied | Integration |
| Switch from `classic` to `dark` → dark.css tokens active | Coexistence |
| Switch from `classic` to `bold-business` → bold-business tokens active | Coexistence |
| Switch from `classic-light` to `light` → light.css tokens active | Coexistence |
| `ThemeManager.applyTheme({ colorPrimary: '#FF0000' })` overrides `--color-primary` above classic | Cascade priority |

Tools: **Vitest** + **@testing-library/react**, WCAG contrast formula (relative luminance per WCAG 2.1 §1.4.3).
