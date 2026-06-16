# Implementation Plan: Dark/Light Mode Switch

## Overview

This plan enhances the existing theme infrastructure to deliver a polished dark/light mode toggle. Work proceeds in layers: first update CSS tokens and add new theme stylesheets, then enhance the ThemeProvider and toggle component, migrate AppLayout away from inline styles, add dashboard tile theme-lock and KPI glass styling, and finally wire everything together with tests.

## Tasks

- [x] 1. Update CSS tokens and light mode stylesheet
  - [x] 1.1 Rewrite `light.css` with the premium warm ivory palette
    - Replace all current light mode values in `packages/client/src/design-system/themes/light.css`
    - Add new tokens: `--color-background-gradient`, `--color-sidebar-bg`, `--color-sidebar-border`, `--color-header-bg`, `--color-nav-active-bg`, `--color-nav-active-text`
    - Set `--color-background` to `#F8F5EE`, `--color-text` to `#2C2C2C`, `--color-text-secondary` to `#666666`
    - Set `--color-primary` to `#C89B3C`, `--color-primary-hover` to `#B88A2E`
    - Set borders: `--color-border` to `#E5DDCD`, `--color-border-hover` to `#D8CEBA`
    - Set shadows: `--shadow-sm` to `0 1px 3px rgba(0,0,0,0.04)`, `--shadow-md` to `0 4px 12px rgba(0,0,0,0.05)`, `--shadow-lg` to `0 8px 24px rgba(0,0,0,0.08)`
    - Ensure no pure white (#FFFFFF) is used as a layout surface background
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 8.1, 8.2, 8.3_

  - [x] 1.2 Add missing dark-mode tokens to `colors.css`
    - Add `--color-sidebar-bg`, `--color-sidebar-border`, `--color-header-bg`, `--color-nav-active-bg`, `--color-nav-active-text` with dark-appropriate values to `:root` in `packages/client/src/design-system/tokens/colors.css`
    - Ensure both themes define the same full set of custom properties
    - _Requirements: 2.4_

  - [x] 1.3 Create `themes/theme-lock.css` for dashboard tile opt-out
    - Create `packages/client/src/design-system/themes/theme-lock.css`
    - Define `[data-theme-lock="dark"]` selector that re-declares dark token values (background `#222222`, text `#F5F5F3`)
    - Ensure these values override regardless of the active `data-theme`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 1.4 Add theme transition CSS
    - Add a `.theme-transitioning` utility class (can be in `light.css` or a new `themes/transitions.css`)
    - Apply `transition: background-color 200ms ease, color 200ms ease` on `*` or relevant selectors when `.theme-transitioning` is present on `<html>`
    - _Requirements: 10.1_

- [ ] 2. Enhance ThemeProvider with transition orchestration and API persistence
  - [x] 2.1 Add transition class management to ThemeProvider
    - In `packages/client/src/design-system/themes/ThemeProvider.tsx`, add `.theme-transitioning` class to `document.documentElement` before changing `data-theme`
    - Remove `.theme-transitioning` after `transitionend` fires or a 300ms fallback timeout
    - _Requirements: 2.3, 10.1_

  - [x] 2.2 Add optional API persistence (fire-and-forget)
    - After writing to localStorage, PUT to `/v1/users/preferences` with `{ theme_mode: mode }` (async, catch errors silently)
    - Only call if user is authenticated
    - _Requirements: 3.4_

  - [x] 2.3 Add validation for stored localStorage value
    - On initialization, if `localStorage.getItem('theme-mode')` is not `'dark'` or `'light'`, discard it and fall through to OS detection
    - Wrap localStorage access in try/catch for private browsing environments
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 2.4 Write property test: Toggle produces opposite mode (Property 1)
    - **Property 1: Toggle produces opposite mode**
    - Use `fast-check` to generate arbitrary starting modes and N toggle invocations, assert resulting mode matches parity
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 2.5 Write property test: DOM attribute matches mode state (Property 2)
    - **Property 2: DOM attribute matches mode state**
    - For any sequence of mode changes, assert `document.documentElement.getAttribute('data-theme')` equals the provider's mode
    - **Validates: Requirements 2.4**

  - [ ]* 2.6 Write property test: localStorage persistence round-trip (Property 3)
    - **Property 3: localStorage persistence round-trip**
    - Write an arbitrary valid mode to localStorage, re-initialize provider, assert initial mode matches stored value
    - **Validates: Requirements 3.1, 3.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Enhance ThemeModeToggle component
  - [x] 4.1 Replace emoji icons with inline SVGs
    - Replace `☀️` / `🌙` with inline SVG sun/moon icons in `packages/client/src/design-system/themes/ThemeModeToggle.tsx`
    - Add CSS transition on the icon for smooth swap (opacity or transform)
    - Ensure the icon container has fixed dimensions to prevent layout shift
    - _Requirements: 1.3, 10.2_

  - [x] 4.2 Style the toggle button with CSS variables
    - Remove inline `styles` object from the component
    - Use a CSS module or plain CSS class that references `var(--color-border)`, `var(--color-text)` etc.
    - _Requirements: 1.3, 9.1, 9.3_

  - [ ]* 4.3 Write property test: Accessible label reflects available action (Property 6)
    - **Property 6: Accessible label reflects available action**
    - For any current mode, assert the `aria-label` contains the name of the opposite mode
    - **Validates: Requirements 9.2**

  - [ ]* 4.4 Write unit tests for ThemeModeToggle
    - Test keyboard accessibility: Enter and Space trigger toggle
    - Test tab focusability
    - Test icon rendering: dark mode shows sun, light mode shows moon
    - _Requirements: 9.1, 9.3, 1.3_

- [x] 5. Refactor AppLayout to use CSS custom properties and add toggle
  - [x] 5.1 Migrate AppLayout inline styles to CSS variables
    - Replace all hardcoded color values in `packages/client/src/components/AppLayout.tsx` `styles` object with CSS variable references
    - `backgroundColor: '#1A1A1A'` → `var(--color-background)`, `color: '#F5F5F3'` → `var(--color-text)`, etc.
    - Update borders and hover states to use `var(--color-border)`, `var(--color-sidebar-bg)`, `var(--color-header-bg)`
    - _Requirements: 2.3, 4.1, 4.2, 4.3_

  - [x] 5.2 Insert ThemeModeToggle in the AppLayout header
    - Import `ThemeModeToggle` in `AppLayout.tsx`
    - Render it in the `headerRight` div between `<LanguageSwitcher />` and the user name span
    - Only render when user is authenticated
    - _Requirements: 1.1, 1.2_

  - [ ]* 5.3 Write unit tests for AppLayout toggle placement
    - Verify ThemeModeToggle is rendered in header when user is authenticated
    - Verify it sits between LanguageSwitcher and user name
    - _Requirements: 1.1, 1.2_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Dashboard tile theme-lock and KPI card glass effect
  - [x] 7.1 Add `data-theme-lock="dark"` attribute to dashboard tile components
    - Locate the dashboard tile/module components and add the data attribute to their wrapper element
    - Import and ensure `theme-lock.css` is loaded in the application
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Add KPI card glass-morphism styling for light mode
    - Add a `[data-theme='light'] .kpiCard` (or equivalent selector) rule
    - Set `background: rgba(255,255,255,0.7); backdrop-filter: blur(12px); border: 1px solid rgba(229,221,205,0.6);`
    - Ensure dark mode retains `var(--color-surface)` background
    - Add CSS fallback for browsers that don't support `backdrop-filter`
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 7.3 Write property test: Dashboard tile background invariant (Property 4)
    - **Property 4: Dashboard tile background invariant**
    - For any theme mode, assert elements with `data-theme-lock="dark"` resolve background to `#222222`
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 7.4 Write property test: No pure white layout backgrounds in light mode (Property 5)
    - **Property 5: No pure white layout backgrounds in light mode**
    - For any layout surface CSS variable in light mode, assert its resolved value is not `#FFFFFF`
    - **Validates: Requirements 8.1**

  - [ ]* 7.5 Write unit tests for KPI card styling
    - Verify glass-morphism is applied in light mode
    - Verify standard surface styling in dark mode
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Integration wiring and final verification
  - [x] 8.1 Import new CSS files in the application entry point
    - Ensure `theme-lock.css` and any new transition CSS are imported in the app's CSS import chain
    - Verify CSS load order: tokens → dark → light → theme-lock → transitions
    - _Requirements: 2.3, 6.3_

  - [x] 8.2 Verify contrast ratio meets WCAG requirements
    - Calculate contrast between `#2C2C2C` text and `#F8F5EE` background (should be ≥ 4.5:1)
    - Add a unit test asserting the contrast ratio
    - _Requirements: 9.4_

  - [ ]* 8.3 Write integration test for full theme toggle cycle
    - Mount app with ThemeProvider, toggle mode, verify CSS variables applied to computed styles
    - Mock API endpoint, verify PUT is called with correct payload on toggle
    - _Requirements: 2.1, 2.2, 3.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript with React, Vitest, and fast-check for property-based testing
- Existing ThemeProvider and ThemeModeToggle are enhanced rather than rewritten

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "4.1", "4.2"] },
    { "id": 2, "tasks": ["2.4", "2.5", "2.6", "4.3", "4.4", "5.1"] },
    { "id": 3, "tasks": ["5.2", "7.1", "7.2", "8.1"] },
    { "id": 4, "tasks": ["5.3", "7.3", "7.4", "7.5", "8.2"] },
    { "id": 5, "tasks": ["8.3"] }
  ]
}
```
