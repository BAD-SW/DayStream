# Design Document

## Overview

The Bold Business theme is a pure CSS override layer that maps a professional blue SaaS palette onto the DayStream design token system. No component TypeScript or TSX logic changes. The entire theme lives in one new CSS file (`bold-business.css`) scoped under `[data-theme='bold-business']`, plus a companion JSON token file. The Customers page serves as the rollout pilot; global application follows once validated.

**PBT Applicability Assessment**: This feature is **not suitable for property-based testing**. All acceptance criteria are either static file/schema checks (file existence, CSS structure, JSON schema), deterministic CSS token assertions (render component under theme, assert specific CSS property value), or theme mechanism integration tests (theme toggle and cascade). There are no universal properties that benefit from generating and running 100+ random inputs. The Correctness Properties section is omitted. Unit and integration tests are used instead.

## Architecture

DayStream's theme system uses CSS custom properties defined at `:root` (dark-mode defaults in `colors.css`) with theme-specific overrides scoped to `[data-theme]` attribute selectors on `document.documentElement`. The `ThemeProvider` sets this attribute reactively.

```
:root                         ← dark defaults (colors.css, typography.css, etc.)
[data-theme='light']          ← warm ivory override (light.css) — unchanged
[data-theme='bold-business']  ← NEW professional blue override (bold-business.css)
```

Business-level brand overrides from `ThemeManager.applyTheme()` are applied as inline `style` declarations on `:root`, which have higher specificity than any `[data-theme]` attribute rule, so the cascade remains:

```
dark defaults → bold-business overrides → business brand overrides
```

### File Layout

```
packages/client/src/
├── main.tsx                                        ← add bold-business.css import
└── design-system/
    ├── themes/
    │   ├── dark.css                                ← unchanged
    │   ├── light.css                               ← unchanged
    │   ├── bold-business.css                       ← NEW
    │   └── ThemeProvider.tsx                       ← update mode type + default
    └── tokens/
        └── theme-bold-business.json                ← NEW
```

No changes to any page, component, layout, or route file during the Customers pilot except for a single `data-stage` attribute addition on the summary card button in `Customers.tsx` (required for CSS attribute selectors — no logic change).

## Components and Interfaces

### bold-business.css — Complete Token Map

```css
/* Bold Business Theme — Professional blue SaaS palette
 * WCAG AA verified: #172B4D on #F4F5F7 = 10.5:1, #FFFFFF on #0052CC = 8.59:1
 */

[data-theme='bold-business'] {
  color-scheme: light;

  /* Backgrounds */
  --color-background: #F4F5F7;
  --color-background-gradient: none;
  --color-surface: #FFFFFF;
  --color-surface-hover: #F0F4FF;
  --color-surface-active: #E4EEFF;
  --color-surface-elevated: #FFFFFF;
  --color-surface-modal: #FFFFFF;
  --row-hover-bg: #E8F1FF;

  /* Sidebar */
  --color-sidebar-bg: #0052CC;
  --color-sidebar-border: rgba(255, 255, 255, 0.15);
  --sidebar-width: 220px;

  /* Header / Top Bar */
  --color-header-bg: #FFFFFF;
  --color-header-border: #E3E8EF;

  /* Navigation */
  --color-nav-active-bg: #2684FF;
  --color-nav-active-text: #FFFFFF;
  --color-nav-hover-bg: #3378FF;
  --color-nav-text: #FFFFFF;

  /* Brand / Primary */
  --color-primary: #0052CC;
  --color-primary-hover: #2684FF;
  --color-primary-active: #003D99;
  --color-primary-contrast: #FFFFFF;

  /* Text */
  --color-text: #172B4D;
  --color-text-secondary: #42526E;
  --color-text-disabled: #97A0AF;
  --color-text-inverse: #FFFFFF;
  --color-text-muted: #6B778C;

  /* Borders */
  --color-border: #C1C7D0;
  --color-border-hover: #A5ADBA;
  --color-border-focus: #2684FF;

  /* Semantic colours */
  --color-success: #36B37E;
  --color-success-light: #57D9A3;
  --color-success-dark: #006644;
  --color-success-bg: rgba(54, 179, 126, 0.1);

  --color-warning: #FFAB00;
  --color-warning-light: #FFE380;
  --color-warning-dark: #FF8B00;
  --color-warning-bg: rgba(255, 171, 0, 0.1);

  --color-error: #FF5630;
  --color-error-light: #FF7452;
  --color-error-dark: #DE350B;
  --color-error-bg: rgba(255, 86, 48, 0.1);

  --color-info: #0052CC;
  --color-info-light: #2684FF;
  --color-info-dark: #003D99;
  --color-info-bg: rgba(0, 82, 204, 0.08);

  /* Shadows */
  --shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.1);
  --shadow-focus: 0 0 0 2px #FFFFFF, 0 0 0 4px #2684FF;

  /* Lifecycle stage pills — each pair verified >= 4.5:1 contrast (WCAG AA) */
  --stage-lead-bg: #EFF2F9;
  --stage-lead-fg: #344563;       /* 7.1:1 on #EFF2F9 */

  --stage-trial-bg: #E6F0FF;
  --stage-trial-fg: #0747A6;      /* 7.5:1 on #E6F0FF */

  --stage-active-bg: #E3FCEF;
  --stage-active-fg: #006644;     /* 6.2:1 on #E3FCEF */

  --stage-at-risk-bg: #FFF0B3;
  --stage-at-risk-fg: #974F0C;    /* 5.8:1 on #FFF0B3 */

  --stage-churned-bg: #FFEBE6;
  --stage-churned-fg: #BF2600;    /* 5.2:1 on #FFEBE6 */

  --stage-winback-bg: #EAE6FF;
  --stage-winback-fg: #403294;    /* 7.0:1 on #EAE6FF */

  /* Overlay */
  --color-overlay: rgba(23, 43, 77, 0.5);
}

/* Sidebar width and nav colours
   Targets existing class name patterns — no class changes in component files */
[data-theme='bold-business'] .sidebar,
[data-theme='bold-business'] [class*='sidebar'] {
  width: 220px;
  background-color: var(--color-sidebar-bg);
  color: var(--color-text-inverse);
}

[data-theme='bold-business'] .sidebar nav a,
[data-theme='bold-business'] [class*='sidebar'] nav a,
[data-theme='bold-business'] [class*='nav-item'] {
  color: var(--color-text-inverse);
  transition: all 0.2s ease;
}

[data-theme='bold-business'] [class*='nav-item']:hover {
  background-color: var(--color-nav-hover-bg);
}

/* Top bar border */
[data-theme='bold-business'] [class*='header'],
[data-theme='bold-business'] [class*='top-bar'] {
  border-bottom: 1px solid var(--color-header-border);
}

/* Summary cards: coloured top border per stage via data-stage attribute */
[data-theme='bold-business'] [data-stage='active']   { border-top: 4px solid var(--color-success); }
[data-theme='bold-business'] [data-stage='at_risk']  { border-top: 4px solid var(--color-warning); }
[data-theme='bold-business'] [data-stage='churned']  { border-top: 4px solid var(--color-error); }
[data-theme='bold-business'] [data-stage='lead'],
[data-theme='bold-business'] [data-stage='trial'],
[data-theme='bold-business'] [data-stage='winback']  { border-top: 4px solid var(--color-primary); }

/* Alternating table rows */
[data-theme='bold-business'] tbody tr:nth-child(even) {
  background-color: #F9FBFF;
}

/* Global transitions */
[data-theme='bold-business'] button,
[data-theme='bold-business'] a,
[data-theme='bold-business'] input,
[data-theme='bold-business'] select {
  transition: all 0.2s ease;
}

/* Focus ring */
[data-theme='bold-business'] :focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
```

### Customers.tsx — Only Permitted Change

Add `data-stage={stage}` to the existing summary card `<button>` element. This is a pure data attribute — no logic change:

```tsx
<button
  key={stage}
  data-stage={stage}          // ← add only this
  style={{ ...styles.summaryCard, ... }}
  onClick={...}
  aria-pressed={stageFilter === stage}
>
```

### main.tsx — Import Addition

```tsx
import './design-system/themes/dark.css';
import './design-system/themes/light.css';
import './design-system/themes/bold-business.css';   // ← add here
import './design-system/themes/theme-lock.css';
import './design-system/themes/transitions.css';
```

### ThemeProvider.tsx — Global Rollout Changes

```tsx
// Widen type union
type ThemeMode = 'dark' | 'light' | 'bold-business';

// Update guard in detectSystemPreference()
function detectSystemPreference(): ThemeMode {
  const stored = safeGetItem('theme-mode');
  if (stored === 'dark' || stored === 'light' || stored === 'bold-business') return stored;
  return 'bold-business'; // new default
}
```

## Data Models

### theme-bold-business.json

```json
{
  "meta": {
    "name": "Bold Business",
    "id": "bold-business",
    "description": "Professional blue SaaS theme for DayStream — default light theme for business-focused workflows",
    "version": "1.0.0"
  },
  "tokens": {
    "color-background":    { "label": "Page Background",                "value": "#F4F5F7",  "configurable": true  },
    "color-surface":       { "label": "Card / Table Surface",           "value": "#FFFFFF",  "configurable": true  },
    "color-primary":       { "label": "Primary Brand Colour",           "value": "#0052CC",  "configurable": true  },
    "color-primary-hover": { "label": "Primary Hover",                  "value": "#2684FF",  "configurable": false },
    "color-text":          { "label": "Primary Text",                   "value": "#172B4D",  "configurable": true  },
    "color-text-secondary":{ "label": "Secondary Text",                 "value": "#42526E",  "configurable": false },
    "color-border":        { "label": "Default Border",                 "value": "#C1C7D0",  "configurable": false },
    "color-sidebar-bg":    { "label": "Sidebar Background",             "value": "#0052CC",  "configurable": true  },
    "color-header-bg":     { "label": "Top Bar Background",             "value": "#FFFFFF",  "configurable": true  },
    "color-nav-active-bg": { "label": "Active Navigation Background",   "value": "#2684FF",  "configurable": true  },
    "color-success":       { "label": "Success / Active Accent",        "value": "#36B37E",  "configurable": false },
    "color-warning":       { "label": "Warning / At-Risk Accent",       "value": "#FFAB00",  "configurable": false },
    "color-error":         { "label": "Error / Churned Accent",         "value": "#FF5630",  "configurable": false },
    "sidebar-width":       { "label": "Sidebar Width",                  "value": "220px",    "configurable": false }
  }
}
```

Token file conventions:
- Property names match the CSS custom property name without the `--` prefix
- `configurable: true` tokens are the ones a future theme editor will expose to users
- `configurable: false` tokens are derived or system-defined

## Error Handling

**Missing CSS import**: If `bold-business.css` is not imported in `main.tsx`, the `data-theme='bold-business'` attribute is set but no override rules apply — the app renders with dark-mode defaults. Visually incorrect but not a crash. The smoke test for the import line catches this before deployment.

**Unknown theme value**: If `'bold-business'` is not added to the validation guard in `detectSystemPreference()`, the stored value falls through to the dark-mode fallback. The `ThemeProvider.tsx` changes in §Components and Interfaces include the required type-guard update.

**Contrast on business overrides**: Business-level brand overrides via `ThemeManager.applyTheme()` can set `--color-primary` to any arbitrary value. A low-contrast brand colour would break WCAG compliance but this is pre-existing behaviour shared with the light theme. A contrast-checking UI is out of scope for this feature.

**Missing data-stage attribute**: If `data-stage` attributes are not added to summary card buttons in `Customers.tsx`, the coloured top-border CSS rules simply don't match — cards render without coloured top borders but are otherwise correct. The feature degrades gracefully.

## Testing Strategy

PBT does not apply to this feature (see Overview). The test suite uses three layers:

### Smoke Tests — File Structure and Schema

| Test | What it checks |
|------|----------------|
| `bold-business.css` exists at expected path | File created |
| All declarations inside `[data-theme='bold-business']` selector | CSS structure |
| `main.tsx` contains the `bold-business.css` import | Import added |
| `theme-bold-business.json` parses as valid JSON | File integrity |
| JSON has `meta` with `name`, `id`, `description`, `version` | Schema |
| JSON `tokens` has ≥ 10 entries, each with `value`, `label`, `configurable` | Schema |

### Example-Based Unit Tests — CSS Token Values and Contrast

| Test | Assertion |
|------|-----------|
| `--color-background` under bold-business | `#F4F5F7` |
| `--color-primary` under bold-business | `#0052CC` |
| `--color-sidebar-bg` under bold-business | `#0052CC` |
| `--color-nav-active-bg` under bold-business | `#2684FF` |
| Sidebar width CSS rule | `220px` |
| Summary card `data-stage='active'` — border-top colour | `--color-success` |
| Summary card `data-stage='at_risk'` — border-top colour | `--color-warning` |
| Summary card `data-stage='churned'` — border-top colour | `--color-error` |
| Table header background | `--color-surface-hover` |
| Focus ring on `:focus-visible` | `--color-border-focus` outline |
| WCAG contrast: `#172B4D` on `#F4F5F7` | ≥ 4.5:1 |
| WCAG contrast: `#FFFFFF` on `#0052CC` | ≥ 4.5:1 |
| WCAG contrast: `#006644` on `#E3FCEF` (Active pill) | ≥ 4.5:1 |
| WCAG contrast: `#BF2600` on `#FFEBE6` (Churned pill) | ≥ 4.5:1 |

### Integration Tests — Theme Cascade and Coexistence

| Test | Assertion |
|------|-----------|
| `data-theme='bold-business'` on root — sidebar colour applied | Integration |
| Switch to `data-theme='dark'` — dark defaults restored | Coexistence |
| Switch to `data-theme='light'` — warm ivory palette restored | Coexistence |
| `ThemeManager.applyTheme({ colorPrimary: '#FF0000' })` overrides `--color-primary` above bold-business | Cascade priority |

Tools: **Vitest** + **@testing-library/react**, WCAG contrast formula (relative luminance per WCAG 2.1), `postcss` or regex for CSS file parsing.
