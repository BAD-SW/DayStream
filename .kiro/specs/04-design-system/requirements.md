# Phase 04: Design System - Requirements

## Overview

This phase establishes the reusable UI component library, theming infrastructure, and per-business branding system for the DayStream platform. The design system provides the visual foundation for all customer-facing and admin interfaces while supporting business-level customization. The initial aesthetic is a premium wellness look (dark-first, Scandinavian minimal), but the system must be flexible enough to accommodate any business type's brand identity.

## Goals

- Create a themeable component library that supports per-business branding
- Define design tokens (colors, typography, spacing, shadows) as a configurable system
- Build core UI components used across all platform pages
- Establish dark and light theme support
- Implement per-business theme customization driven by database configuration
- Ensure accessibility compliance (WCAG 2.1 AA)
- Ensure mobile-first responsive design throughout

## Glossary

- **Design_Token**: A named value (color, size, font, spacing) used consistently across the UI
- **Theme**: A complete set of Design_Tokens that define the visual appearance
- **Component_Library**: The collection of reusable React UI components
- **Tenant_Theme**: A per-tenant override of the default Theme, stored in the database
- **Business_Theme**: A per-business override of the default Theme, stored in the database (branding happens at business level)
- **Breakpoint**: A screen width threshold at which the layout adapts
- **Design_System**: The combination of tokens, themes, components, and documentation

## Requirements

### Requirement 1: Design Token System

**User Story:** As a developer, I want a centralized token system, so that visual values are consistent and changeable from a single source.

#### Acceptance Criteria

1. THE Design_System SHALL define tokens for: colors, typography, spacing, border-radius, shadows, z-index, and transitions
2. THE Design_System SHALL implement tokens as CSS custom properties (variables)
3. THE Design_System SHALL organize color tokens into semantic categories: primary, secondary, accent, background, surface, text, border, success, warning, error, info
4. THE Design_System SHALL define a type scale with at least 6 levels (xs, sm, base, lg, xl, 2xl) plus heading levels (h1–h6)
5. THE Design_System SHALL define a spacing scale based on a consistent base unit (e.g., 4px grid)
6. THE Design_System SHALL export tokens as TypeScript constants for use in component logic
7. THE Design_System SHALL support overriding any token value at the business level

### Requirement 2: Theme Engine

**User Story:** As a business owner, I want my booking portal to match my brand colors and style, so that customers have a seamless experience between my website and the platform.

#### Acceptance Criteria

1. THE Theme_Engine SHALL support a default theme (dark-first, premium wellness aesthetic)
2. THE Theme_Engine SHALL support dark and light mode variants
3. THE Theme_Engine SHALL load Business_Theme overrides from the business_configurations table
4. THE Theme_Engine SHALL apply business overrides by setting CSS custom properties at the root level
5. THE Theme_Engine SHALL support overriding: primary color, secondary color, accent color, logo, font family, border-radius style
6. THE Theme_Engine SHALL allow users to toggle between dark and light mode (respecting system preference as default)
7. THE Theme_Engine SHALL persist user's theme mode preference
8. THE Theme_Engine SHALL apply theme changes without requiring a page reload
9. THE Theme_Engine SHALL validate that business color overrides meet contrast ratio requirements (WCAG AA)

### Requirement 3: Core Layout Components

**User Story:** As a developer, I want layout primitives, so that I can compose pages with consistent structure and responsive behavior.

#### Acceptance Criteria

1. THE Component_Library SHALL provide a `PageShell` component with header, sidebar, and content area
2. THE Component_Library SHALL provide a `Container` component with max-width and responsive padding
3. THE Component_Library SHALL provide a `Grid` component for responsive column layouts
4. THE Component_Library SHALL provide a `Stack` component for vertical and horizontal spacing
5. THE Component_Library SHALL provide a `Sidebar` component that collapses on mobile
6. THE Component_Library SHALL provide a `Header` component with navigation, user menu, and tenant logo
7. THE Component_Library SHALL be mobile-first, using the following breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
8. THE Component_Library SHALL provide separate layout variants for admin and customer-facing views

### Requirement 3A: Persona-Based Dashboard Layouts

**User Story:** As a user, I want to see a dashboard tailored to my role after logging in, so that I immediately have access to the information and actions most relevant to me.

#### Acceptance Criteria

1. THE Design_System SHALL provide a `DashboardShell` component with a KPI summary area (top half) and a module tile grid (bottom half)
2. THE Design_System SHALL provide a System Dashboard layout for System Users showing platform-wide KPIs and admin module tiles
3. THE Design_System SHALL provide a Tenant Dashboard layout for Tenant Users showing tenant-level KPIs and tenant management module tiles
4. THE Design_System SHALL provide a Business Dashboard layout for Business Users showing business-level KPIs and business operation module tiles
5. THE Design_System SHALL provide a Customer Dashboard layout for Customers showing personal KPIs (upcoming bookings, membership status) and customer action tiles
6. THE DashboardShell SHALL determine which layout to render based on the authenticated user's persona
7. THE KPI summary area SHALL support configurable KPI cards (icon, label, value, trend indicator)
8. THE module tile grid SHALL only display tiles for modules the user has permission to access
9. THE module tiles SHALL be defined by Phases 5–22 and registered dynamically as those phases are implemented

### Requirement 4: Form Components

**User Story:** As a developer, I want form components with built-in validation and accessibility, so that all forms across the platform are consistent and user-friendly.

#### Acceptance Criteria

1. THE Component_Library SHALL provide: Input, Textarea, Select, Checkbox, RadioGroup, Switch, DatePicker, TimePicker, FileUpload
2. THE Form components SHALL support labels, helper text, and error messages
3. THE Form components SHALL integrate with Joi validation schemas from `packages/shared`
4. THE Form components SHALL display validation errors inline below the field
5. THE Form components SHALL support disabled and read-only states
6. THE Form components SHALL support required field indicators
7. THE Form components SHALL associate labels with inputs via `htmlFor`/`id` for accessibility
8. THE Form components SHALL support localized placeholder text and labels via i18next

### Requirement 5: Data Display Components

**User Story:** As a developer, I want data display components, so that lists, tables, and details are presented consistently.

#### Acceptance Criteria

1. THE Component_Library SHALL provide: Table, Card, Badge, Avatar, Stat, EmptyState, Skeleton
2. THE Table component SHALL support sorting, pagination, and row selection
3. THE Table component SHALL be responsive (horizontal scroll or card view on mobile)
4. THE Card component SHALL support variants: default, elevated, outlined, interactive (clickable)
5. THE Badge component SHALL support status variants: success, warning, error, info, neutral
6. THE Avatar component SHALL support image, initials fallback, and size variants
7. THE Skeleton component SHALL provide loading placeholders matching the shape of content being loaded
8. THE EmptyState component SHALL support icon, title, description, and action button

### Requirement 6: Feedback and Overlay Components

**User Story:** As a developer, I want feedback and overlay components, so that user interactions (confirmations, notifications, loading) are handled consistently.

#### Acceptance Criteria

1. THE Component_Library SHALL provide: Modal, Drawer, Toast/Notification, Alert, ConfirmDialog, Tooltip, Popover
2. THE Modal component SHALL support sizes (sm, md, lg, full) and trap focus within while open
3. THE Drawer component SHALL support left and right positions and be dismissible
4. THE Toast system SHALL support stacking multiple notifications with auto-dismiss
5. THE Toast system SHALL support variants: success, warning, error, info
6. THE ConfirmDialog SHALL require explicit confirmation for destructive actions
7. THE Tooltip component SHALL appear on hover/focus and support configurable placement
8. All overlay components SHALL be dismissible via Escape key
9. All overlay components SHALL manage focus correctly for screen readers

### Requirement 7: Navigation Components

**User Story:** As a developer, I want navigation components, so that users can move through the application intuitively.

#### Acceptance Criteria

1. THE Component_Library SHALL provide: Tabs, Breadcrumbs, Pagination, Steps/Stepper, NavMenu
2. THE Tabs component SHALL support horizontal and vertical orientations
3. THE Breadcrumbs component SHALL auto-generate from the current route path
4. THE Pagination component SHALL display page numbers, previous/next, and items-per-page selector
5. THE Steps component SHALL support completed, active, and upcoming step states
6. THE NavMenu component SHALL highlight the active route and support nested menu items
7. THE NavMenu component SHALL collapse into a hamburger menu on mobile

### Requirement 8: Action Components

**User Story:** As a developer, I want action components, so that buttons and interactive elements are consistent across the platform.

#### Acceptance Criteria

1. THE Component_Library SHALL provide: Button, IconButton, ButtonGroup, Dropdown, SearchInput
2. THE Button component SHALL support variants: primary, secondary, outline, ghost, destructive
3. THE Button component SHALL support sizes: sm, md, lg
4. THE Button component SHALL support loading state (spinner replaces content)
5. THE Button component SHALL support icons (leading, trailing, or icon-only)
6. THE Dropdown component SHALL support menu items with icons, dividers, and disabled states
7. THE SearchInput component SHALL support debounced input with clear button

### Requirement 9: Accessibility Compliance

**User Story:** As a user with accessibility needs, I want the platform to be usable with assistive technology, so that I can access all features regardless of ability.

#### Acceptance Criteria

1. THE Component_Library SHALL meet WCAG 2.1 AA contrast ratio requirements for all text
2. THE Component_Library SHALL support full keyboard navigation for all interactive elements
3. THE Component_Library SHALL use appropriate ARIA attributes (roles, labels, live regions)
4. THE Component_Library SHALL support screen readers (proper heading hierarchy, landmarks, announcements)
5. THE Component_Library SHALL provide visible focus indicators on all focusable elements
6. THE Component_Library SHALL not rely on color alone to convey information
7. THE Component_Library SHALL support reduced motion preferences (`prefers-reduced-motion`)
8. THE Component_Library SHALL test with at least one screen reader (NVDA or VoiceOver) during development

### Requirement 10: Responsive Design System

**User Story:** As a user, I want the platform to work well on any device, so that I can manage bookings from my phone, tablet, or desktop.

#### Acceptance Criteria

1. THE Design_System SHALL follow a mobile-first approach (base styles for mobile, enhanced for larger screens)
2. THE Design_System SHALL define breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
3. THE Layout components SHALL adapt from single-column on mobile to multi-column on desktop
4. THE Navigation SHALL collapse to a mobile-friendly format (hamburger, bottom nav) below md breakpoint
5. THE Table component SHALL switch to a card-based layout on mobile when configured
6. THE Modal component SHALL render full-screen on mobile devices
7. Touch targets SHALL be a minimum of 44x44px on mobile

### Requirement 11: Icon System

**User Story:** As a developer, I want a consistent icon library, so that icons are visually unified and easy to use across the platform.

#### Acceptance Criteria

1. THE Design_System SHALL use a single icon library (Lucide, Heroicons, or similar)
2. THE Design_System SHALL provide an `Icon` component that accepts icon name and size
3. THE Icon component SHALL support sizes matching the type scale (sm, md, lg)
4. THE Icon component SHALL support color inheritance from parent text color
5. THE Icon component SHALL include `aria-hidden="true"` when decorative and `aria-label` when informational
6. THE Design_System SHALL document available icons in a browsable reference

### Requirement 12: Component Documentation

**User Story:** As a developer, I want documented components with examples, so that I can discover, understand, and use components correctly without reading source code.

#### Acceptance Criteria

1. THE Design_System SHALL document all components with usage examples
2. THE documentation SHALL show all component variants and states
3. THE documentation SHALL document all props/parameters with types and defaults
4. THE documentation SHALL include accessibility notes for each component
5. THE documentation SHALL be viewable in-browser (Storybook or similar)
6. THE documentation SHALL be kept in sync with component code

---

## Dependencies

- Phase 00: Infrastructure - Frontend application (React + Vite)
- Phase 03: Core Platform - Configuration_Engine (for loading tenant themes), i18next (for localized labels)

## Success Criteria

- All core components render correctly with the default theme
- Business theme overrides change the visual appearance without code changes
- Dark/light mode toggle works and persists preference
- All components pass WCAG 2.1 AA automated checks
- Components render responsively across mobile, tablet, and desktop
- Component documentation is browsable and accurate
- Frontend developers can build pages using only Component_Library primitives

## Out of Scope

- Transcend-specific branding implementation - This is the system, not one business's theme
- Admin UI for uploading logos/configuring themes - Phase 18 (Website & CMS)
- Animation library selection - Keep transitions simple via CSS; revisit if needed
- Native mobile components - Phase 19 (Mobile App) will have its own component system
- Full Figma design files - Focus is on code components; design assets come from the colleague

## Notes

- Colleague will have a big say in look and feel; this phase creates the system, not the final aesthetic
- The default theme is a starting point (premium wellness dark-first), business overrides customize it
- Component library approach (build from scratch vs. Radix/shadcn base) is a decision to be made with colleague
- CSS custom properties enable runtime theme switching without JS re-renders
- All text content in components comes from i18next — no hardcoded English strings
- Branding (colors, logo, font) is configured at the business level, not tenant level
- System Users and Tenant Users see the DayStream default theme; Business Users and Customers see business-branded theme

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 03
**Next Phase**: Phase 05 (Customer Management)
