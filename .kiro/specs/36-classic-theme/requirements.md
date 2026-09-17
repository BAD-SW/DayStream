# Requirements Document

## Introduction

Formally package the existing DayStream dark-first warm gold/ivory design as the "Classic" theme — a named, selectable theme alongside Bold Business and any future themes. The Classic theme is the current UI; no visual changes are made. The work consists of creating a `classic.css` file that re-declares the existing token values under a `[data-theme='classic']` selector, creating a companion JSON token file, and registering "Classic" as a selectable option in `ThemeProvider.tsx`. The existing `colors.css` (dark defaults) and `light.css` (warm ivory overrides) remain unchanged and continue to serve as `:root` fallbacks.

## Glossary

- **Classic_Theme**: The named theme identified by `data-theme='classic'`, representing the existing dark-first warm gold/ivory palette
- **Classic_CSS_File**: The new CSS file at `packages/client/src/design-system/themes/classic.css` containing explicit `[data-theme='classic']` token declarations
- **Classic_Token_File**: The JSON file at `packages/client/src/design-system/tokens/theme-classic.json` defining the Classic theme's configurable tokens
- **Theme_Provider**: The React component at `packages/client/src/design-system/themes/ThemeProvider.tsx` that sets `data-theme` on `document.documentElement`
- **Dark_Variant**: The dark mode of the Classic theme — warm gold on near-black (`#C9A96E` on `#1A1A1A`), sourced from the existing `:root` defaults in `colors.css`
- **Light_Variant**: The light mode of the Classic theme — warm gold on warm ivory (`#C89B3C` on `#F8F5EE`), sourced from the existing `[data-theme='light']` block in `light.css`
- **Bold_Business_Theme**: The existing blue SaaS theme registered in spec 35, which Classic must coexist with without conflict
- **WCAG_AA**: Web Content Accessibility Guidelines 2.1 Level AA — minimum 4.5:1 contrast for normal text

## Requirements

### Requirement 1: Classic Theme CSS File

**User Story:** As a developer, I want a `classic.css` file that explicitly declares the Classic theme tokens under `[data-theme='classic']`, so that the theme can be selected by name without relying on implicit `:root` fallback values.

#### Acceptance Criteria

1. THE Classic_CSS_File SHALL be located at `packages/client/src/design-system/themes/classic.css`
2. THE Classic_CSS_File SHALL declare all token overrides inside a single `[data-theme='classic']` selector block
3. THE Classic_CSS_File SHALL NOT require hardcoded colour values in any component file — all overrides MUST be CSS custom property declarations
4. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-background` with `#1A1A1A`
5. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-surface` with `#242424`
6. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-primary` with `#C9A96E`
7. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-primary-hover` with `#D4B87F`
8. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-primary-contrast` with `#1A1A1A`
9. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-text` with `#F5F5F3`
10. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-text-secondary` with `#B0B0B0`
11. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-border` with `#333333`
12. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-sidebar-bg` with `#1A1A1A`
13. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-header-bg` with `#1A1A1A`
14. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-nav-active-bg` with `rgba(201, 169, 110, 0.15)`
15. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--color-nav-active-text` with `#C9A96E`
16. WHEN `data-theme='classic'` is set on `document.documentElement`, THE Classic_CSS_File SHALL override `--row-hover-bg` with `rgba(201, 169, 110, 0.08)`
17. THE Classic_CSS_File SHALL include `color-scheme: dark` in the `[data-theme='classic']` block to inform the browser of the colour scheme

### Requirement 2: Classic Light Variant CSS

**User Story:** As a developer, I want a `[data-theme='classic-light']` block in `classic.css` that mirrors the values from `light.css`, so that the Classic theme has an explicit light variant that can be activated by name.

#### Acceptance Criteria

1. THE Classic_CSS_File SHALL contain a second selector block `[data-theme='classic-light']` beneath the dark block
2. THE `[data-theme='classic-light']` block SHALL include `color-scheme: light`
3. THE `[data-theme='classic-light']` block SHALL override `--color-background` with `#F8F5EE`
4. THE `[data-theme='classic-light']` block SHALL override `--color-surface` with `rgba(255,255,255,0.7)`
5. THE `[data-theme='classic-light']` block SHALL override `--color-primary` with `#C89B3C`
6. THE `[data-theme='classic-light']` block SHALL override `--color-primary-hover` with `#B88A2E`
7. THE `[data-theme='classic-light']` block SHALL override `--color-primary-contrast` with `#FFFFFF`
8. THE `[data-theme='classic-light']` block SHALL override `--color-text` with `#2C2C2C`
9. THE `[data-theme='classic-light']` block SHALL override `--color-text-secondary` with `#666666`
10. THE `[data-theme='classic-light']` block SHALL override `--color-border` with `#E5DDCD`
11. THE `[data-theme='classic-light']` block SHALL override `--color-sidebar-bg` with `#F7F3EA`
12. THE `[data-theme='classic-light']` block SHALL override `--color-header-bg` with `#FFFFFF`
13. THE `[data-theme='classic-light']` block SHALL override `--color-nav-active-bg` with `#F1E7D0`
14. THE `[data-theme='classic-light']` block SHALL override `--color-nav-active-text` with `#A77D22`
15. THE `[data-theme='classic-light']` block SHALL override all lifecycle stage pill tokens (`--stage-*-bg`, `--stage-*-fg`) with the same values currently declared in `light.css`

### Requirement 3: Token Definition File

**User Story:** As a developer building the theme-switching system, I want a structured JSON token file for the Classic theme, so that I have a machine-readable record of all configurable values following the same schema as `theme-bold-business.json`.

#### Acceptance Criteria

1. THE Classic_Token_File SHALL be located at `packages/client/src/design-system/tokens/theme-classic.json`
2. THE Classic_Token_File SHALL be valid JSON
3. THE Classic_Token_File SHALL contain a top-level `meta` object with fields `name`, `id`, `description`, and `version`
4. THE Classic_Token_File `meta.name` field SHALL be `"Classic"`
5. THE Classic_Token_File `meta.id` field SHALL be `"classic"`
6. THE Classic_Token_File SHALL contain a top-level `tokens` object mapping each CSS custom property name (without `--`) to an entry with `value`, `label`, and `configurable` fields
7. THE Classic_Token_File SHALL include at minimum 10 tokens covering: `color-background`, `color-surface`, `color-primary`, `color-primary-hover`, `color-text`, `color-text-secondary`, `color-border`, `color-sidebar-bg`, `color-header-bg`, and `color-nav-active-bg`
8. THE Classic_Token_File SHALL mark approximately 10 user-adjustable tokens with `"configurable": true` and all derived or system-defined tokens with `"configurable": false`
9. THE Classic_Token_File schema SHALL be identical in structure to `theme-bold-business.json` — same field names, same nesting depth, same field types

### Requirement 4: Theme Registration in ThemeProvider

**User Story:** As a user, I want to be able to select "Classic" as a named theme in DayStream, so that I can explicitly choose the warm gold/ivory design rather than relying on a default fallback.

#### Acceptance Criteria

1. THE Theme_Provider SHALL accept `'classic'` and `'classic-light'` as valid `data-theme` values in its mode type and validation guard
2. WHEN `data-theme='classic'` is stored in `localStorage`, THE Theme_Provider SHALL restore it on page load without falling back to a different value
3. WHEN `data-theme='classic-light'` is stored in `localStorage`, THE Theme_Provider SHALL restore it on page load without falling back to a different value
4. THE `classic.css` file SHALL be imported in `main.tsx` alongside the existing theme files
5. THE Theme_Provider SHALL list `'classic'` as one of the available named themes alongside `'bold-business'`

### Requirement 5: Backwards Compatibility

**User Story:** As a developer, I want the existing dark mode toggle, light mode toggle, and Bold Business theme to continue working exactly as before after the Classic theme is introduced, so that no existing user sessions or functionality are broken.

#### Acceptance Criteria

1. WHEN `data-theme='dark'` is set, THE Theme_Provider SHALL continue to apply the existing dark.css overrides without interference from classic.css
2. WHEN `data-theme='light'` is set, THE Theme_Provider SHALL continue to apply the existing light.css overrides without interference from classic.css
3. WHEN `data-theme='bold-business'` is set, THE Theme_Provider SHALL continue to apply the bold-business.css overrides without interference from classic.css
4. THE existing `:root` defaults in `colors.css` SHALL remain unchanged — they continue to serve as the implicit dark-mode fallback
5. THE existing `[data-theme='light']` block in `light.css` SHALL remain unchanged
6. WHEN no `data-theme` value is stored in `localStorage`, THE Theme_Provider SHALL apply its existing default theme unchanged — Classic is a selectable option, not the new default

### Requirement 6: Accessibility

**User Story:** As a user with visual accessibility needs, I want the Classic theme to meet WCAG AA contrast standards in both its dark and light variants, so that all text and interactive elements remain readable.

#### Acceptance Criteria

1. THE Classic dark variant SHALL provide a minimum 4.5:1 contrast ratio for all normal body text (`#F5F5F3` on `#1A1A1A` = 16.1:1 — passes WCAG AAA)
2. THE Classic light variant SHALL provide a minimum 4.5:1 contrast ratio for all normal body text (`#2C2C2C` on `#F8F5EE` = 12.47:1 — passes WCAG AAA)
3. THE Classic light variant lifecycle stage pill token pairs SHALL each meet a minimum 4.5:1 contrast ratio, consistent with the existing values in `light.css`
4. THE Classic_CSS_File SHALL NOT alter any ARIA labels, roles, or semantic HTML structure in component files

---

## Dependencies

- Spec 35 (Bold Business Theme): The `[data-theme]` CSS architecture, `ThemeProvider.tsx` mode type pattern, and `theme-bold-business.json` schema that Classic mirrors

## Success Criteria

- `classic.css` exists and all declarations are inside `[data-theme='classic']` or `[data-theme='classic-light']` selector blocks
- `theme-classic.json` is valid JSON with correct `meta` and ≥ 10 tokens following the spec 35 schema
- `main.tsx` imports `classic.css` alongside other theme files
- `ThemeProvider.tsx` accepts `'classic'` and `'classic-light'` as valid mode values
- Switching to `classic` theme produces visually identical results to the current default dark mode
- Switching to `classic-light` theme produces visually identical results to the current `[data-theme='light']` warm ivory mode
- All existing theme toggles (`dark`, `light`, `bold-business`) continue to work without regression

## Out of Scope

- Visual redesign of the Classic theme — values must match the existing `:root` defaults exactly
- A UI picker or settings page for selecting between Classic and Bold Business — this spec only registers Classic as a valid option
- Removing or deprecating the `[data-theme='light']` block from `light.css` — it remains as the explicit light fallback
- Removing the `:root` dark defaults from `colors.css` — they remain as the implicit dark fallback
- Making Classic the new default theme — the existing default behaviour is preserved unchanged

## Notes

- The Classic theme CSS file re-declares values that already exist in `colors.css` and `light.css`. This is intentional: explicit `[data-theme='classic']` selectors allow Classic to be selected by name with the same specificity as all other named themes. The originals remain as fallbacks for any environment that does not set a `data-theme` attribute.
- The `[data-theme='classic-light']` variant mirrors `[data-theme='light']` values rather than reusing that selector, keeping theme identity explicit and consistent with the Bold Business pattern.
- No new `.config.kiro` specId should clash with spec 35 — each spec has a unique UUID.

---

**Status**: 📋 Planned
**Dependencies**: Spec 35 (Bold Business Theme)
**Next Phase**: Implementation via tasks.md
