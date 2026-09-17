# Implementation Plan: Classic Theme

## Overview

Pure CSS and JSON packaging work — no component logic changes, no visual changes. Tasks create the Classic theme CSS file, create the token JSON file, register the import, and update `ThemeProvider.tsx` to accept the two new Classic variant identifiers.

## Tasks

- [ ] 1. Create the Classic token definition file
  - Create `packages/client/src/design-system/tokens/theme-classic.json`
  - Include `meta` block: `name: "Classic"`, `id: "classic"`, `description`, `version: "1.0.0"`
  - Include all 14 tokens from design.md Data Models section with `value`, `label`, and `configurable` fields
  - Schema must be identical to `theme-bold-business.json`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 2. Create the Classic theme CSS file
  - [ ] 2.1 Create `packages/client/src/design-system/themes/classic.css` with the `[data-theme='classic']` dark block
    - Copy values from `:root` in `colors.css` exactly — do not alter any value
    - Include `color-scheme: dark`
    - Declare all tokens from the dark block in design.md §2.1
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17_
  - [ ] 2.2 Append the `[data-theme='classic-light']` block to classic.css
    - Copy values from `[data-theme='light']` in `light.css` exactly — do not alter any value
    - Include `color-scheme: light`
    - Declare all tokens from the light block in design.md §2.1 including all six stage pill pairs
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15_

- [ ] 3. Register the CSS import in main.tsx
  - Add `import './design-system/themes/classic.css';` to `packages/client/src/main.tsx` after `bold-business.css` and before `theme-lock.css`
  - _Requirements: 4.4_

- [ ] 4. Update ThemeProvider to accept Classic variants
  - In `packages/client/src/design-system/themes/ThemeProvider.tsx`:
    - Widen the mode type union to include `'classic'` and `'classic-light'`
    - Update the validation guard in `detectSystemPreference()` to accept both new values without falling back to the default
    - Do NOT change the fallback default — Classic must not become the new default theme
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.6_

- [ ] 5. Checkpoint — Visual verification
  - Manually set `localStorage.setItem('theme-mode', 'classic')` in browser devtools and reload — confirm the UI looks identical to the current default dark mode
  - Manually set `localStorage.setItem('theme-mode', 'classic-light')` and reload — confirm the UI looks identical to the current warm ivory light mode
  - Verify switching to `bold-business`, `dark`, and `light` all continue to work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Verify source files are unmodified
  - Confirm `packages/client/src/design-system/tokens/colors.css` has no changes
  - Confirm `packages/client/src/design-system/themes/light.css` has no changes
  - Confirm no page, component, layout, or route `.tsx` / `.ts` file was modified
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 7. Write smoke tests for file structure and schema
  - Assert `classic.css` exists at the expected path
  - Assert all `[data-theme='classic']` declarations are inside that selector only (not leaking into global scope)
  - Assert all `[data-theme='classic-light']` declarations are inside that selector only
  - Assert `main.tsx` contains the `classic.css` import line
  - Assert `theme-classic.json` is valid JSON with `meta.name === 'Classic'`, `meta.id === 'classic'`, and ≥ 10 tokens each having `value`, `label`, `configurable`
  - Assert `colors.css` and `light.css` content is unchanged
  - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.4, 5.4, 5.5_

- [ ]* 8. Write example-based CSS token and contrast tests
  - Assert `--color-background` and `--color-primary` computed values under `data-theme='classic'`
  - Assert `--color-background`, `--color-primary`, and `--color-sidebar-bg` computed values under `data-theme='classic-light'`
  - Assert WCAG contrast: `#F5F5F3` on `#1A1A1A` ≥ 4.5:1
  - Assert WCAG contrast: `#2C2C2C` on `#F8F5EE` ≥ 4.5:1
  - Assert each of the 6 classic-light lifecycle stage pill pairs meets ≥ 4.5:1 contrast
  - Assert `ThemeProvider` restores `'classic'` from localStorage without fallback
  - Assert `ThemeProvider` restores `'classic-light'` from localStorage without fallback
  - Assert that when localStorage is empty, the default theme is not `'classic'`
  - _Requirements: 4.1, 4.2, 4.3, 5.6, 6.1, 6.2, 6.3_

- [ ]* 9. Write integration tests for theme coexistence
  - Set `data-theme='classic'` and verify a representative token (`--color-primary`) matches expected value
  - Set `data-theme='classic-light'` and verify a representative token (`--color-background`) matches expected value
  - Switch from `classic` to `dark` and assert dark defaults are active
  - Switch from `classic` to `bold-business` and assert bold-business tokens are active
  - Assert `ThemeManager.applyTheme({ colorPrimary: '#FF0000' })` overrides `--color-primary` on top of the Classic base
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- No page or component `.tsx` files are modified by this feature — all changes are in CSS, JSON, and `ThemeProvider.tsx`
- The token JSON values record the dark-variant (Classic) defaults; light-variant values are only in `classic.css`
- The fallback default in `ThemeProvider.tsx` must NOT be changed to `'classic'` — Classic is a selectable option, not the new default
- `colors.css` and `light.css` must remain bit-for-bit identical after this feature ships

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4"] },
    { "wave": 4, "tasks": ["5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7", "8", "9"] },
    { "wave": 7, "tasks": ["10"] }
  ]
}
```
