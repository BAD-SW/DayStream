# Phase 04: Design System - Design Document

**Date**: June 12, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 03

---

## Overview

This document describes the technical design for the DayStream design system — the token architecture, theme engine, component library structure, persona-based dashboard layouts, and implementation approach.

---

## Table of Contents

1. [Technology Decisions](#1-technology-decisions)
2. [Design Token Architecture](#2-design-token-architecture)
3. [Theme Engine](#3-theme-engine)
4. [Component Library Structure](#4-component-library-structure)
5. [Persona-Based Dashboard](#5-persona-based-dashboard)
6. [Layout Components](#6-layout-components)
7. [Form Components](#7-form-components)
8. [Data Display Components](#8-data-display-components)
9. [Feedback & Overlay Components](#9-feedback--overlay-components)
10. [Navigation Components](#10-navigation-components)
11. [Action Components](#11-action-components)
12. [Icon System](#12-icon-system)
13. [Accessibility Approach](#13-accessibility-approach)
14. [Responsive Strategy](#14-responsive-strategy)

---

## 1. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CSS approach | CSS custom properties + utility classes | Runtime theming without JS re-renders; no heavy framework dependency |
| Component foundation | Custom components (no Radix/shadcn) | Full control; simpler dependency tree; colleague drives aesthetics |
| Icon library | Lucide React | Consistent style, tree-shakeable, good React support, MIT license |
| Styling method | CSS Modules + tokens | Scoped styles per component, tokens as CSS variables |
| Documentation | Storybook | Industry standard; browse/test components in isolation |

---

## 2. Design Token Architecture

### File Structure

```
packages/client/src/design-system/
├── tokens/
│   ├── colors.css          # Color tokens (semantic + palette)
│   ├── typography.css      # Font families, sizes, weights, line-heights
│   ├── spacing.css         # Spacing scale (4px base)
│   ├── borders.css         # Border radius, widths
│   ├── shadows.css         # Elevation shadows
│   ├── transitions.css     # Timing and easing
│   ├── z-index.css         # Stacking layers
│   └── index.css           # Imports all token files
├── themes/
│   ├── dark.css            # Dark mode overrides
│   ├── light.css           # Light mode overrides
│   └── index.ts            # Theme switching logic
```

### Token Naming Convention

```css
/* Category-property-variant */
--color-primary: #C9A96E;
--color-primary-hover: #D4B87F;
--color-background: #1A1A1A;
--color-surface: #242424;
--color-text: #F5F5F3;
--color-text-secondary: #B0B0B0;

--font-family: 'Inter', sans-serif;
--font-size-sm: 0.875rem;
--font-size-base: 1rem;
--font-size-lg: 1.25rem;

--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;

--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-full: 9999px;

--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.07);
--shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
```

### TypeScript Token Export

```typescript
// packages/client/src/design-system/tokens/index.ts
export const tokens = {
  color: {
    primary: 'var(--color-primary)',
    background: 'var(--color-background)',
    surface: 'var(--color-surface)',
    text: 'var(--color-text)',
    // ...
  },
  space: {
    xs: 'var(--space-xs)',
    sm: 'var(--space-sm)',
    md: 'var(--space-md)',
    // ...
  },
  // ...
} as const;
```

---

## 3. Theme Engine

### Theme Application Flow

```
1. User logs in → persona + business_id resolved
2. If Customer or Business User → load Business_Theme from business_configurations
3. Apply theme: set CSS custom properties on <html> element
4. User toggles dark/light → override mode-specific tokens
5. Preference persisted to localStorage
```

### ThemeProvider Component

```typescript
interface ThemeContext {
  mode: 'dark' | 'light';
  toggleMode: () => void;
  businessTheme: Partial<BusinessTheme> | null;
}

interface BusinessTheme {
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  fontFamily: string;
  borderRadius: 'sharp' | 'rounded' | 'pill';
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('theme-mode');
    if (stored) return stored as 'dark' | 'light';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  const { user } = useAuth();
  const businessTheme = useBusinessTheme(user?.business_id);

  useEffect(() => {
    // Apply mode
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme-mode', mode);

    // Apply business overrides
    if (businessTheme) {
      const root = document.documentElement;
      if (businessTheme.primaryColor) root.style.setProperty('--color-primary', businessTheme.primaryColor);
      if (businessTheme.accentColor) root.style.setProperty('--color-accent', businessTheme.accentColor);
      if (businessTheme.fontFamily) root.style.setProperty('--font-family', businessTheme.fontFamily);
    }
  }, [mode, businessTheme]);

  return (
    <ThemeContext.Provider value={{ mode, toggleMode: () => setMode(m => m === 'dark' ? 'light' : 'dark'), businessTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

### Theme Resolution Order

1. **System User / Tenant User** → DayStream default theme (no business override)
2. **Business User** → Business theme loaded from `business_configurations`
3. **Customer** → Business theme of the business they're currently viewing

---

## 4. Component Library Structure

```
packages/client/src/design-system/
├── tokens/              # Design tokens (CSS + TS exports)
├── themes/              # Dark/light mode, theme provider
├── components/
│   ├── layout/          # PageShell, Container, Grid, Stack, Sidebar, Header
│   ├── dashboard/       # DashboardShell, KpiCard, ModuleTile
│   ├── forms/           # Input, Textarea, Select, Checkbox, Switch, DatePicker, etc.
│   ├── data/            # Table, Card, Badge, Avatar, Stat, EmptyState, Skeleton
│   ├── feedback/        # Modal, Drawer, Toast, Alert, ConfirmDialog, Tooltip
│   ├── navigation/      # Tabs, Breadcrumbs, Pagination, Steps, NavMenu
│   ├── actions/         # Button, IconButton, ButtonGroup, Dropdown, SearchInput
│   └── icons/           # Icon wrapper component
├── hooks/               # useTheme, useMediaQuery, useToast, etc.
├── utils/               # cn() class helper, accessibility helpers
└── index.ts             # Barrel export
```

### Component Naming Conventions

- PascalCase for components: `Button`, `KpiCard`, `DashboardShell`
- Props interfaces named: `ButtonProps`, `KpiCardProps`
- CSS module files match component: `Button.module.css`
- Each component folder contains: `ComponentName.tsx`, `ComponentName.module.css`, `index.ts`

---

## 5. Persona-Based Dashboard

### DashboardShell Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header                                                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                  │
│  │ KPI  │  │ KPI  │  │ KPI  │  │ KPI  │  (scrollable)    │
│  │ Card │  │ Card │  │ Card │  │ Card │                   │
│  └──────┘  └──────┘  └──────┘  └──────┘                  │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                   │
│  │ Module  │  │ Module  │  │ Module  │                    │
│  │  Tile   │  │  Tile   │  │  Tile   │                    │
│  │         │  │         │  │         │                    │
│  └─────────┘  └─────────┘  └─────────┘                   │
│                                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                   │
│  │ Module  │  │ Module  │  │ Module  │                    │
│  │  Tile   │  │  Tile   │  │  Tile   │                    │
│  │         │  │         │  │         │                    │
│  └─────────┘  └─────────┘  └─────────┘                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### KPI Card Component

```typescript
interface KpiCardProps {
  icon: string;          // Lucide icon name
  label: string;         // Localized via i18n key
  value: string | number;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    percentage: number;
    period: string;      // e.g., "vs last week"
  };
  color?: string;        // Accent color for the icon/value
}
```

### Module Tile Component

```typescript
interface ModuleTileProps {
  id: string;            // Module identifier (e.g., 'bookings', 'customers')
  icon: string;          // Lucide icon name
  title: string;         // Localized
  description: string;   // Localized
  path: string;          // Route to navigate to
  badge?: string;        // Optional count/notification badge
  disabled?: boolean;    // Grayed out if feature not enabled
}
```

### Tile Ordering

Users can drag-and-drop tiles to reorder their dashboard. The order is persisted per user:

```typescript
// Stored in a user_preferences table or as JSON in user profile
interface UserDashboardPreferences {
  tileOrder: string[];   // Array of module IDs in user's preferred order
}

// On render:
// 1. Get available tiles (filtered by persona + permissions + feature flags)
// 2. Load user's saved tile order
// 3. Sort tiles by saved order (unsaved tiles appear at end in default order)
// 4. On drag-drop, save new order via API
```

### Dashboard Content Per Persona

| Persona | KPIs | Module Tiles |
|---|---|---|
| System | Total tenants, total businesses, total revenue, system health | Tenant management, Platform config, Audit logs, System monitoring |
| Tenant | Businesses count, aggregate revenue, active customers, new signups | Business management, Billing, Reports, Support |
| Business | Today's bookings, weekly revenue, new customers, staff online | Bookings, Services, Customers, Staff, Reports, Payments, Marketing |
| Customer | Upcoming bookings, membership status, loyalty points, last visit | Book service, My bookings, My account, Payments, Rewards |

### Module Registry

```typescript
// Modules are registered and filtered by persona + permissions
interface ModuleDefinition {
  id: string;
  phase: number;         // Which phase implements this
  icon: string;
  titleKey: string;      // i18n key
  descriptionKey: string;
  path: string;
  personas: Persona[];   // Which personas see this tile
  permission?: string;   // Required permission (optional)
  featureFlag?: string;  // Gated by feature flag (optional)
}

const MODULE_REGISTRY: ModuleDefinition[] = [
  { id: 'customers', phase: 5, icon: 'Users', titleKey: 'modules.customers', descriptionKey: 'modules.customers_desc', path: '/customers', personas: ['business'], permission: 'customers:read' },
  { id: 'services', phase: 6, icon: 'Briefcase', titleKey: 'modules.services', descriptionKey: 'modules.services_desc', path: '/services', personas: ['business'], permission: 'services:read' },
  { id: 'bookings', phase: 7, icon: 'Calendar', titleKey: 'modules.bookings', descriptionKey: 'modules.bookings_desc', path: '/bookings', personas: ['business', 'customer'] },
  // ... Phases 8–22
];
```

---

## 6. Layout Components

### PageShell

Top-level layout wrapper that provides header + sidebar + content:

```typescript
interface PageShellProps {
  children: ReactNode;
  sidebar?: boolean;     // Show sidebar (default: true for business/tenant)
  header?: boolean;      // Show header (default: true)
}
```

### Container

Constrains content width with responsive padding:

```typescript
interface ContainerProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full'; // 640px, 768px, 1280px, 100%
}
```

### Grid

Responsive column grid:

```typescript
interface GridProps {
  children: ReactNode;
  cols?: { sm?: number; md?: number; lg?: number; xl?: number };
  gap?: 'sm' | 'md' | 'lg';
}
```

### Stack

Flex-based vertical/horizontal spacing:

```typescript
interface StackProps {
  children: ReactNode;
  direction?: 'vertical' | 'horizontal';
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  align?: 'start' | 'center' | 'end' | 'stretch';
}
```

---

## 7. Form Components

All form components follow a consistent pattern:

```typescript
interface BaseFieldProps {
  label: string;
  name: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
}

// Example: Input
interface InputProps extends BaseFieldProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  leading?: ReactNode;   // Icon or prefix
  trailing?: ReactNode;  // Icon or suffix
}
```

### Form Integration Pattern

```typescript
// Hook that connects Joi schema to form state
function useForm<T>(schema: Joi.ObjectSchema, initialValues: T) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function validate(): boolean { /* ... */ }
  function setField(name: string, value: any): void { /* ... */ }
  function getFieldProps(name: string): BaseFieldProps { /* ... */ }

  return { values, errors, touched, validate, setField, getFieldProps };
}
```

---

## 8. Data Display Components

### Table

Supports sorting, pagination, responsive:

```typescript
interface TableColumn<T> {
  key: keyof T;
  header: string;
  sortable?: boolean;
  render?: (value: any, row: T) => ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  pagination?: PaginationParams;
  onSort?: (key: string, order: 'asc' | 'desc') => void;
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
  mobileCardMode?: boolean; // Switch to cards on mobile
}
```

### Card

```typescript
interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'interactive';
  padding?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}
```

---

## 9. Feedback & Overlay Components

### Toast System

```typescript
// Global toast manager
function useToast() {
  return {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
  };
}
```

### Modal

```typescript
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
  footer?: ReactNode;
}
```

---

## 10. Navigation Components

### Tabs

```typescript
interface TabsProps {
  items: { id: string; label: string; content: ReactNode }[];
  defaultTab?: string;
  orientation?: 'horizontal' | 'vertical';
}
```

### Breadcrumbs

Auto-generated from route, with manual override:

```typescript
interface BreadcrumbsProps {
  items?: { label: string; path?: string }[];
  autoGenerate?: boolean; // Derive from current route
}
```

---

## 11. Action Components

### Button

```typescript
interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: string;         // Lucide icon name
  iconPosition?: 'leading' | 'trailing';
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
}
```

---

## 12. Icon System

```typescript
import { icons } from 'lucide-react';

interface IconProps {
  name: keyof typeof icons;
  size?: 'sm' | 'md' | 'lg'; // 16px, 20px, 24px
  color?: string;
  className?: string;
  'aria-label'?: string;     // Required when informational
}

// Usage:
<Icon name="Calendar" size="md" />
<Icon name="AlertCircle" size="sm" aria-label="Warning" />
```

---

## 13. Accessibility Approach

- All interactive elements are keyboard accessible (Tab, Enter, Space, Escape)
- Focus indicators use `--color-primary` outline with 2px offset
- ARIA attributes applied via component props (role, aria-label, aria-describedby)
- Modals and drawers trap focus and restore on close
- `prefers-reduced-motion` disables all transitions
- Color contrast validated programmatically for business theme overrides
- Screen reader testing with NVDA during development

---

## 14. Responsive Strategy

### Breakpoints

```css
--breakpoint-sm: 640px;
--breakpoint-md: 768px;
--breakpoint-lg: 1024px;
--breakpoint-xl: 1280px;
```

### Responsive Patterns

| Component | Mobile (<768px) | Desktop (≥768px) |
|---|---|---|
| Sidebar | Hidden (hamburger toggle) | Visible, collapsible |
| Table | Card layout | Full table |
| Modal | Full-screen | Centered with max-width |
| Grid | 1 column | 2–4 columns |
| Dashboard KPIs | Horizontal scroll | Full row |
| Module Tiles | 2 columns | 3–4 columns |

### useMediaQuery Hook

```typescript
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// Convenience hooks
const useIsMobile = () => useMediaQuery('(max-width: 767px)');
const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
```

---

**Last Updated**: June 12, 2026
