# Implementation Plan: Bold Business Theme

## Overview

Pure CSS theming work — no component logic changes. Tasks create the token JSON file, the CSS theme file, wire up the import, make the one permitted TSX data-attribute addition, set the default theme, and verify the result.

## Tasks

- [ ] 1. Create the token definition file
  - Create `packages/client/src/design-system/tokens/theme-bold-business.json` following the schema in design.md Data Models section
  - Include `meta` block with `name`, `id`, `description`, `version`
  - Include all 14 tokens with `value`, `label`, and `configurable` fields
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 2. Create the Bold Business CSS theme file
  - [ ] 2.1 Create `packages/client/src/design-system/themes/bold-business.css` with the `[data-theme='bold-business']` block
    - Declare all CSS custom property overrides from design.md Components section (backgrounds, sidebar, header, nav, primary, text, borders, semantic colours, shadows, stage pills, overlay)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22, 1.23, 1.24_
  - [ ] 2.2 Add targeted CSS element rules below the token block
    - Sidebar width and colour rules targeting existing class name patterns
    - Nav item hover and active state rules
    - Top bar border rule
    - Summary card coloured top-border rules using `[data-stage]` attribute selectors
    - Alternating table row rule (`tbody tr:nth-child(even)`)
    - Global transition rule for interactive elements (`all 0.2s ease`)
    - Focus ring rule (`:focus-visible` with `--color-border-focus`)
    - _Requirements: 3.3, 3.7, 3.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9_

- [ ] 3. Register the CSS import in main.tsx
  - Add `import './design-system/themes/bold-business.css';` to `packages/client/src/main.tsx` after `light.css` and before `theme-lock.css`
  - _Requirements: 3.6_

- [ ] 4. Add data-stage attribute to Customers page summary cards
  - In `packages/client/src/pages/Customers.tsx`, add `data-stage={stage}` to the existing summary card `<button>` element
  - This is the only permitted change to a page/component file — a pure data attribute with no logic impact
  - _Requirements: 3.3_

- [ ] 5. Apply Bold Business as the default theme
  - In `packages/client/src/design-system/themes/ThemeProvider.tsx`:
    - Widen the mode type union to include `'bold-business'`
    - Update the validation guard in `detectSystemPreference()` to accept `'bold-business'`
    - Change the fallback return value in `detectSystemPreference()` to `'bold-business'`
  - _Requirements: 3.1, 4.1, 4.2_

- [ ] 6. Checkpoint — Visual verification
  - Start the dev server and navigate to the Customers page
  - Verify: page background is `#F4F5F7`, sidebar is solid `#0052CC`, top bar is white with bottom divider
  - Verify: summary cards show coloured top borders (green Active, amber At Risk, red Churned, blue Lead/Trial/Winback)
  - Verify: table header is `#F0F4FF`, alternating rows are white and `#F9FBFF`
  - Verify: primary buttons are `#0052CC`; secondary buttons have blue border
  - Verify: switching to dark mode restores dark palette; switching to light restores warm ivory
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Verify existing themes are unaffected
  - Confirm `[data-theme='dark']` and `[data-theme='light']` apply their respective palettes without interference from the new CSS file
  - _Requirements: 4.3, 4.4, 4.5_

- [ ]* 8. Write smoke tests for file structure and schema
  - Assert `bold-business.css` exists and all declarations are inside `[data-theme='bold-business']`
  - Assert `main.tsx` contains the `bold-business.css` import line
  - Assert `theme-bold-business.json` is valid JSON with correct `meta` fields and ≥ 10 tokens each with `value`, `label`, `configurable`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.6_

- [ ]* 9. Write example-based CSS token and contrast tests
  - Assert CSS custom property values under bold-business theme for: `--color-background`, `--color-primary`, `--color-sidebar-bg`, `--color-nav-active-bg`
  - Assert WCAG contrast ratios: `#172B4D` on `#F4F5F7` ≥ 4.5:1 and `#FFFFFF` on `#0052CC` ≥ 4.5:1
  - Assert each lifecycle stage pill pair meets ≥ 4.5:1 contrast
  - _Requirements: 1.4, 1.10, 1.14, 1.16, 6.1, 6.2, 6.4_

- [ ]* 10. Write integration tests for theme cascade and coexistence
  - Verify `data-theme='bold-business'` on root applies sidebar colour correctly
  - Verify switching to `data-theme='dark'` restores dark defaults
  - Verify `ThemeManager.applyTheme()` business overrides take precedence over bold-business base values
  - _Requirements: 4.3, 4.4, 4.5_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4"] },
    { "wave": 4, "tasks": ["5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7"] },
    { "wave": 7, "tasks": ["8", "9", "10"] },
    { "wave": 8, "tasks": ["11"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Task 4 (`data-stage` attribute) is the only permitted change to a page or component file
- All CSS rules in `bold-business.css` target existing class name patterns — no class additions to components
- Global rollout (task 5) applies the bold-business theme across all pages once the pilot is validated in task 6
