---
inclusion: auto
description: UI/UX style guide for Booking Manager - defines design system, colors, typography, and component specifications
---

# Booking Manager - UI/UX Style Guide

## Overview

This style guide defines the visual design system, UI components, and interaction patterns for the Booking Manager platform. The design system ensures consistency across the platform while providing a premium, wellness-focused, and accessible user experience. The default aesthetic is inspired by high-end wellness and recovery brands (dark-first, Scandinavian minimalism), but all values are themeable per tenant.

## Design Principles

1. **Premium Feel** - Visual design should convey luxury, calm, and quality
2. **Clarity** - Information should be easy to understand and navigate
3. **Mobile-First** - All design starts at mobile and scales up to desktop
4. **Accessibility** - The platform should be usable by everyone (WCAG 2.1 AA)
5. **Consistency** - Similar elements should look and behave the same way
6. **Personalization** - Per-tenant branding must be first-class, not an afterthought
7. **Simplicity** - Wellness customers prefer calm, uncluttered interfaces

## Color Palette

### Default Theme (Dark-First, Premium Wellness)

**Primary Colors** - Core brand identity
- Primary: `#1A1A1A` (near black)
- Primary Light: `#2D2D2D` (charcoal)
- Primary Dark: `#0D0D0D` (deep black)
- Primary Contrast Text: `#FFFFFF`

**Secondary Colors** - Supporting palette
- Secondary: `#F5F5F3` (warm off-white)
- Secondary Light: `#FFFFFF` (white)
- Secondary Dark: `#E8E8E6` (light gray)
- Secondary Contrast Text: `#1A1A1A`

**Accent Colors** - Highlights and calls-to-action
- Accent: `#C9A96E` (warm gold)
- Accent Light: `#D4B87F` (light gold)
- Accent Dark: `#B8945A` (bronze)
- Accent Contrast Text: `#1A1A1A`

**Recovery Blue** - Wellness-specific accent
- Recovery: `#4A90A4` (recovery blue)
- Recovery Light: `#6BA8BC` (light recovery blue)
- Recovery Dark: `#3A7A8E` (deep recovery blue)
- Recovery Contrast Text: `#FFFFFF`

### Neutral Colors

**Grays** - Used for text, borders, backgrounds
- Gray 900 (Text Primary Dark): `#1A1A1A` (rgb(26, 26, 26))
- Gray 800 (Text Primary Light): `#F5F5F3` (rgb(245, 245, 243))
- Gray 700 (Text Secondary Dark): `#4A4A4A` (rgb(74, 74, 74))
- Gray 600 (Text Secondary Light): `#B0B0B0` (rgb(176, 176, 176))
- Gray 500 (Disabled): `#8A8A8A` (rgb(138, 138, 138))
- Gray 400 (Borders Dark): `#333333` (rgb(51, 51, 51))
- Gray 300 (Borders Light): `#E0E0E0` (rgb(224, 224, 224))
- Gray 200 (Surface Dark): `#242424` (rgb(36, 36, 36))
- Gray 100 (Surface Light): `#F9F9F9` (rgb(249, 249, 249))

### Semantic Colors

**Success**
- Success: `#2E7D32` (rgb(46, 125, 50))
- Success Light: `#66BB6A` (rgb(102, 187, 106))
- Success Dark: `#1B5E20` (rgb(27, 94, 32))

**Warning**
- Warning: `#E6A817` (rgb(230, 168, 23))
- Warning Light: `#FFD54F` (rgb(255, 213, 79))
- Warning Dark: `#C49000` (rgb(196, 144, 0))

**Error**
- Error: `#D32F2F` (rgb(211, 47, 47))
- Error Light: `#EF5350` (rgb(239, 83, 80))
- Error Dark: `#C62828` (rgb(198, 40, 40))

**Info**
- Info: `#4A90A4` (same as Recovery Blue)
- Info Light: `#6BA8BC`
- Info Dark: `#3A7A8E`

### Theme Modes

- **Dark Mode (default)**: Primary background `#1A1A1A`, text `#F5F5F3`, surface `#242424`
- **Light Mode**: Primary background `#FFFFFF`, text `#1A1A1A`, surface `#F9F9F9`

### Tenant Overridable Tokens

The following tokens can be overridden per tenant via the Configuration Engine:
- `--color-primary`
- `--color-accent`
- `--color-background`
- `--color-surface`
- `--color-text`
- `--font-family`
- `--border-radius-base`
- `--logo-url`

## Typography

### Font Families

**Primary Font: Inter**
- Used for UI elements, body text, and most content
- Fallback: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif

**Display Font: Inter**
- Used for large headings and hero text (same family, different weight/size)
- Weight: 300 (Light) for large display text, 600 (Semi-Bold) for headings

**Monospace Font: JetBrains Mono**
- Used for codes, reference numbers, technical content
- Fallback: "Courier New", Courier, monospace

### Font Sizes

- **display**: 48px / 3rem (Hero headings)
- **h1**: 32px / 2rem (Page titles)
- **h2**: 24px / 1.5rem (Section headers)
- **h3**: 20px / 1.25rem (Subsection headers)
- **h4**: 18px / 1.125rem (Card titles)
- **h5**: 16px / 1rem (Small headers)
- **h6**: 14px / 0.875rem (Tiny headers)
- **body1**: 16px / 1rem (Primary body text)
- **body2**: 14px / 0.875rem (Secondary body text)
- **caption**: 12px / 0.75rem (Captions, helper text)
- **button**: 14px / 0.875rem (Button text)

### Font Weights

- **Light**: 300 (display text, large headings)
- **Regular**: 400 (body text)
- **Medium**: 500 (emphasis, labels)
- **Semi-Bold**: 600 (headings, buttons)
- **Bold**: 700 (strong emphasis only)

### Line Heights

- **Headings**: 1.2
- **Body**: 1.5
- **Tight**: 1.3 (cards, compact areas)

## Spacing System

Base unit: 4px. Use multiples of the base unit for all spacing.

- **xs**: 4px (0.25rem)
- **sm**: 8px (0.5rem)
- **md**: 16px (1rem)
- **lg**: 24px (1.5rem)
- **xl**: 32px (2rem)
- **2xl**: 48px (3rem)
- **3xl**: 64px (4rem)
- **4xl**: 96px (6rem)

### Content Width

- **Max content width**: 1280px
- **Narrow content**: 768px (blog posts, forms)
- **Page padding (mobile)**: 16px
- **Page padding (desktop)**: 32px

## Border Radius

- **none**: 0px (sharp edges, rarely used)
- **sm**: 4px (small elements, badges)
- **md**: 8px (buttons, inputs, cards)
- **lg**: 12px (modals, large cards)
- **xl**: 16px (hero sections, feature cards)
- **full**: 9999px (pills, avatars, circular)

## Shadows

- **sm**: `0 1px 2px rgba(0, 0, 0, 0.05)` (subtle lift)
- **md**: `0 4px 6px rgba(0, 0, 0, 0.07)` (cards, dropdowns)
- **lg**: `0 10px 15px rgba(0, 0, 0, 0.1)` (modals, elevated panels)
- **xl**: `0 20px 25px rgba(0, 0, 0, 0.15)` (popovers, floating elements)

In dark mode, shadows are less visible; use subtle border instead: `1px solid rgba(255, 255, 255, 0.08)`

## Breakpoints

- **sm**: 640px (large phones)
- **md**: 768px (tablets)
- **lg**: 1024px (small laptops)
- **xl**: 1280px (desktops)

## Component Specifications

### Buttons

**Variants:**
- **Primary**: Accent background (`#C9A96E`), dark text — used for main CTAs
- **Secondary**: Outlined, border color matches theme text — used for secondary actions
- **Ghost**: No background, text-only hover effect — used for tertiary actions
- **Destructive**: Error color background — used for delete/cancel actions

**Sizes:**
- **sm**: height 32px, padding 8px 12px, font 12px
- **md**: height 40px, padding 10px 16px, font 14px
- **lg**: height 48px, padding 12px 24px, font 16px

**States:**
- Default, Hover (slight lighten/darken), Active (pressed), Disabled (50% opacity), Loading (spinner replaces text)

**Rules:**
- Minimum touch target: 44×44px on mobile
- Buttons use `font-weight: 600`
- Icon buttons are square (same height and width)
- Button text is sentence case (not ALL CAPS)

### Input Fields

**Styling:**
- Border: 1px solid gray-400 (dark) / gray-300 (light)
- Border radius: md (8px)
- Padding: 10px 12px
- Font size: body1 (16px) — prevents iOS zoom on focus
- Focus: accent color border, subtle glow
- Error: error color border, error text below

**Rules:**
- Labels above inputs (not inside/placeholder-as-label)
- Helper text below input (gray-600)
- Error text replaces helper text on validation failure
- Required indicator: subtle asterisk after label
- Disabled: reduced opacity (50%), no pointer events

### Cards

**Variants:**
- **Default**: Surface background, subtle border, border-radius lg
- **Elevated**: Surface background, shadow md, border-radius lg
- **Interactive**: Hover effect (slight lift/scale), cursor pointer
- **Outlined**: Transparent background, visible border

**Structure:**
- Optional image (top, full width)
- Header area (title, subtitle, badge)
- Content area (body text, data)
- Footer area (actions, links)
- Padding: lg (24px) internal

### Navigation

**Top Header:**
- Fixed position (sticky on scroll)
- Height: 64px (desktop), 56px (mobile)
- Contains: logo, main nav links, user menu, "Book Now" CTA
- Dark background matching theme

**Sidebar (Admin):**
- Width: 256px (desktop), collapsed to 64px (icons only) on smaller screens
- Full-height, fixed position
- Active item highlighted with accent color

**Mobile Navigation:**
- Hamburger menu (top right)
- Full-screen overlay on open
- Bottom navigation bar for customer app (4–5 items)

### Tables

**Header:**
- Background: transparent (dark mode) or gray-100 (light mode)
- Text: uppercase, caption size (12px), semi-bold, letter-spacing 0.5px
- Sticky header on scroll

**Rows:**
- Alternating row colors (subtle, 2% opacity difference)
- Hover highlight
- Minimum row height: 48px

**Rules:**
- Sortable columns indicated with arrow icon
- Pagination below table (items per page selector + page numbers)
- Mobile: switch to card layout below md breakpoint
- Numbers right-aligned, text left-aligned

### Modals

- Backdrop: black at 50% opacity (dark mode) or 60% opacity (light mode)
- Modal: surface color, border-radius lg, shadow xl
- Sizes: sm (400px), md (560px), lg (720px), full (95vw)
- Mobile: modals render full-screen (drawer-style from bottom)
- Close: X button top-right + Escape key + backdrop click
- Focus trapped within modal while open

## Imagery and Media

- **Service images**: Landscape aspect ratio (16:9 or 3:2)
- **Avatars**: Circular (border-radius full), sizes 32/40/48/64px
- **Hero images**: Full-width, max height 500px (desktop), 300px (mobile)
- **Gallery**: Grid layout with consistent aspect ratios
- **Image treatment**: Slight overlay gradient for text readability on hero images

## Animation and Transitions

- **Duration**: 150ms (micro-interactions), 250ms (standard), 400ms (large elements)
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` (standard Material easing)
- **Hover transitions**: opacity, transform (translateY, scale)
- **Page transitions**: fade (150ms)
- **Respect `prefers-reduced-motion`**: disable all animation if set

## Accessibility Requirements

- WCAG 2.1 Level AA compliance
- Minimum 4.5:1 contrast ratio for normal text
- Minimum 3:1 contrast ratio for large text and UI elements
- Keyboard navigation for all interactive elements
- Visible focus indicators (accent color outline, 2px offset)
- ARIA labels for custom components
- Proper heading hierarchy (h1 → h2 → h3, no skipping)
- Touch targets minimum 44×44px
- Respect `prefers-reduced-motion` and `prefers-color-scheme`
- Screen reader announcements for dynamic content (ARIA live regions)

## Implementation

- **Framework**: React 18+ with TypeScript
- **Styling**: CSS custom properties (design tokens) + Tailwind CSS utility classes
- **Icons**: TBD (Lucide, Heroicons — decision pending with colleague)
- **Fonts**: Self-hosted (Inter, JetBrains Mono) for performance
- **Theme switching**: CSS custom properties toggled at `:root` level
- **Component approach**: TBD (custom build vs. Radix/shadcn base — decision pending with colleague)

## Tenant Theming

All visual tokens are implemented as CSS custom properties. Per-tenant themes override these at runtime:

```css
:root {
  --color-primary: #1A1A1A;
  --color-accent: #C9A96E;
  --color-background: #1A1A1A;
  --color-surface: #242424;
  --color-text: #F5F5F3;
  --font-family: 'Inter', sans-serif;
  --border-radius-base: 8px;
}

/* Tenant override example (loaded from Configuration Engine) */
[data-tenant="transcend"] {
  --color-accent: #C9A96E;
  --color-primary: #0D0D0D;
}

[data-tenant="yoga-studio"] {
  --color-accent: #7B9E6B;
  --color-primary: #FDFDF9;
  --color-text: #2D2D2D;
}
```

## Decisions Pending (Colleague Input)

- [ ] Icon library selection (Lucide vs. Heroicons vs. other)
- [ ] Component foundation (custom from scratch vs. Radix/shadcn base)
- [ ] Final aesthetic validation (does the dark-first premium feel work for all business types?)
- [ ] Animation library (if any beyond CSS transitions)
- [ ] Specific font pairing approval

---

**Version**: 0.1 (Draft — pending colleague review)
**Last Updated**: June 2026

For detailed component specifications, see Phase 04 (Design System) requirements and future design document.
