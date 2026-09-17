# Requirements Document

## Introduction

Introduce a "Bold Business" CSS theme as a professional blue-based SaaS light theme for DayStream. The theme overrides the existing CSS custom properties via a new `[data-theme='bold-business']` block, keeping the existing dark and warm-ivory light themes fully intact. The Customers page serves as the pilot before global rollout. A JSON token file is created alongside the CSS to support the future user-customizable theme-switching system.

## Glossary

- **Theme_File**: The CSS file at `packages/client/src/design-system/themes/bold-business.css` containing all Bold Business token overrides
- **Token_File**: The JSON file at `packages/client/src/design-system/tokens/theme-bold-business.json` defining configurable tokens
- **Theme_Application**: The mechanism in `ThemeProvider.tsx` that sets `data-theme` on `document.documentElement`
- **Sidebar**: The left-side navigation panel component
- **Top_Bar**: The horizontal header/navigation bar at the top of the admin layout
- **Customers_Page**: The page at `/customers` listing customers with lifecycle summary cards and a data table
- **Dark_Theme**: The existing `[data-theme='dark']` CSS overrides in `dark.css`
- **Warm_Ivory_Light_Theme**: The existing `[data-theme='light']` CSS overrides in `light.css`
- **WCAG_AA**: Web Content Accessibility Guidelines 2.1 Level AA — minimum 4.5:1 contrast for normal text
- **Bold_Business**: The new theme variant identified by `data-theme='bold-business'`

## Requirements

### Requirement 1: Bold Business CSS Theme File

**User Story:** As a developer, I want a new `bold-business` theme CSS file that overrides CSS custom properties, so that the app can render a professional blue SaaS palette by switching the `data-theme` attribute.

#### Acceptance Criteria

1. THE Theme_File SHALL be located at `packages/client/src/design-system/themes/bold-business.css`
2. THE Theme_File SHALL declare all overrides inside a single `[data-theme='bold-business']` selector block
3. THE Theme_File SHALL NOT require hardcoded colour values in any component file — all overrides MUST be CSS custom property declarations
4. THE Theme_File SHALL override `--color-background` with `#F4F5F7`
5. THE Theme_File SHALL override `--color-surface` with `#FFFFFF`
6. THE Theme_File SHALL override `--color-surface-hover` with `#F0F4FF`
7. THE Theme_File SHALL override `--color-primary` with `#0052CC`
8. THE Theme_File SHALL override `--color-primary-hover` with `#2684FF`
9. THE Theme_File SHALL override `--color-primary-contrast` with `#FFFFFF`
10. THE Theme_File SHALL override `--color-text` with `#172B4D`
11. THE Theme_File SHALL override `--color-text-secondary` with `#42526E`
12. THE Theme_File SHALL override `--color-border` with `#C1C7D0`
13. THE Theme_File SHALL override `--color-border-focus` with `#2684FF`
14. THE Theme_File SHALL override `--color-sidebar-bg` with `#0052CC`
15. THE Theme_File SHALL override `--color-header-bg` with `#FFFFFF`
16. THE Theme_File SHALL override `--color-nav-active-bg` with `#2684FF`
17. THE Theme_File SHALL override `--color-nav-active-text` with `#FFFFFF`
18. THE Theme_File SHALL override `--color-success` with `#36B37E`
19. THE Theme_File SHALL override `--color-warning` with `#FFAB00`
20. THE Theme_File SHALL override `--color-error` with `#FF5630`
21. THE Theme_File SHALL override `--row-hover-bg` with `#E8F1FF`
22. THE Theme_File SHALL override `--shadow-sm` with `0 2px 6px rgba(0,0,0,0.05)`
23. THE Theme_File SHALL override `--shadow-md` with `0 2px 8px rgba(0,0,0,0.08)`
24. WHEN the Bold Business theme is active, THE Theme_File SHALL provide lifecycle stage pill tokens (`--stage-*-bg` and `--stage-*-fg`) with blue-palette equivalents that meet WCAG_AA contrast

### Requirement 2: Token Definition File

**User Story:** As a developer building the future theme-switching system, I want a structured JSON token file for the Bold Business theme, so that I have a machine-readable record of all configurable values.

#### Acceptance Criteria

1. THE Token_File SHALL be located at `packages/client/src/design-system/tokens/theme-bold-business.json`
2. THE Token_File SHALL be valid JSON
3. THE Token_File SHALL contain a top-level `meta` object with fields `name`, `id`, `description`, and `version`
4. THE Token_File SHALL contain a top-level `tokens` object mapping each CSS custom property name (without `--`) to an entry with `value` and `label` fields
5. THE Token_File SHALL include at minimum 10 tokens covering: background, surface, primary, primary-hover, text, text-secondary, border, sidebar-bg, header-bg, and nav-active-bg
6. THE Token_File SHALL include a `configurable` boolean on each token entry indicating whether it is user-adjustable in a future theme editor

### Requirement 3: Customers Page Pilot

**User Story:** As a product owner, I want the Bold Business theme applied to the Customers page first, so that I can validate the look and feel before global rollout.

#### Acceptance Criteria

1. WHEN the application renders, THE Theme_Application SHALL apply `data-theme='bold-business'` to the document root element
2. THE Customers_Page SHALL render all existing components — summary cards, table, badges, buttons — using Bold Business CSS variables without any component TypeScript or TSX logic changes
3. THE Customers_Page summary cards SHALL display a 4px coloured top border per lifecycle stage: success colour for Active, warning for At Risk, error for Churned, and primary for Lead, Trial, and Winback
4. THE Customers_Page table header row SHALL use `--color-surface-hover` as its background
5. THE Customers_Page table rows SHALL alternate between `--color-surface` and `#F9FBFF`
6. THE Theme_File SHALL be imported in `main.tsx` alongside the existing theme files
7. WHEN the Bold Business theme is active, THE Sidebar SHALL render with a solid `--color-sidebar-bg` background and white text and icons
8. WHEN the Bold Business theme is active, THE Top_Bar SHALL render with a white background and a 1px `#E3E8EF` bottom divider

### Requirement 4: Global Rollout

**User Story:** As a developer, I want to apply the Bold Business theme globally after Customers page validation, so that the whole application benefits from the new look.

#### Acceptance Criteria

1. WHEN global rollout is triggered, THE Theme_Application SHALL set `data-theme='bold-business'` on `document.documentElement` at app startup via `ThemeProvider`
2. THE Theme_Application SHALL apply the Bold Business theme as the default when no stored theme preference exists
3. WHEN the Bold Business theme is active, THE Dark_Theme SHALL remain fully functional and togglable by the user
4. WHEN the Bold Business theme is active, THE Warm_Ivory_Light_Theme SHALL remain fully functional
5. THE Theme_Application SHALL preserve any business-level CSS variable overrides applied by `ThemeManager.applyTheme()` on top of the Bold Business base

### Requirement 5: Design System Component Compliance

**User Story:** As a designer, I want all existing design system components to render correctly under the Bold Business theme, so that the visual experience is coherent and professional.

#### Acceptance Criteria

1. THE Button_Primary component SHALL render with `--color-primary` background, `--color-primary-contrast` text, and `--color-primary-hover` on hover at 40px height and 8px border radius
2. THE Button_Secondary component SHALL render with white background, `--color-primary` border and text
3. THE Table component SHALL render with `--color-surface-hover` table header background, alternating row backgrounds, and `--row-hover-bg` on row hover
4. THE Sidebar component SHALL render at 220px width with `--color-sidebar-bg` background and white text
5. THE Sidebar active navigation item SHALL use `--color-nav-active-bg` background and `--color-nav-active-text` text colour
6. THE Sidebar navigation items SHALL display a hover state using `#3378FF` background
7. THE Badge lifecycle stage pill SHALL render using the theme-overridden `--stage-*-bg` and `--stage-*-fg` tokens
8. WHEN the Bold Business theme is active, THE Focus_Ring on interactive elements SHALL use `--color-border-focus` as the outline colour
9. WHEN the Bold Business theme is active, ALL transitions on interactive elements SHALL use `transition: all 0.2s ease`

### Requirement 6: Accessibility

**User Story:** As a user with visual accessibility needs, I want the Bold Business theme to meet WCAG AA contrast standards, so that all text and interactive elements remain readable.

#### Acceptance Criteria

1. THE Theme SHALL provide a minimum 4.5:1 contrast ratio for all normal body text against its background
2. THE Theme SHALL provide a minimum 3:1 contrast ratio for all large text and UI element boundaries
3. THE Theme SHALL provide visible focus indicators on all keyboard-navigable elements
4. THE Sidebar text (white on `#0052CC`) SHALL meet WCAG_AA contrast requirements
5. THE Theme SHALL not alter any ARIA labels, roles, or semantic HTML structure in component files
