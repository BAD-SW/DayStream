# Design Document: 37 — Theme Setup

**Date**: July 2026
**Status**: 🎨 Design Phase
**Dependencies**: Spec 35 (Bold Business Theme), Spec 36 (Classic Theme)

---

## Overview

Theme Setup introduces a database-backed theme management layer on top of the existing CSS variable cascade. The design has three pillars:

1. **Persistence** — a `cfg_themes` table stores named custom themes as delta overrides against a built-in base.
2. **Resolution** — a lightweight resolve endpoint rebuilds the effective token map for a business at app load by walking the inheritance chain.
3. **UI** — a Theme Gallery page + Theme Editor + Apply Dialog give admin personas a self-service way to browse, customise, and deploy themes without touching code.

The existing `ThemeManager.applyTheme()` and `data-theme` / CSS variable mechanism are preserved exactly. Theme Setup is the management surface, not a new rendering engine.

Built-in themes (Bold Business and Classic) are **code constants only** — they are never stored as database rows. The `[data-base-theme='bold-business']` CSS in `bold-business.css` and the `[data-theme]` CSS in `light.css`/`dark.css` remain the authoritative rendering definitions.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Components and Interfaces](#components-and-interfaces)
3. [Data Models](#data-models)
4. [Correctness Properties](#correctness-properties)
5. [Error Handling](#error-handling)
6. [Testing Strategy](#testing-strategy)

---

## Architecture

### Database Schema — Migration `106_cfg_themes.sql`

Migration 106 is the next available number (105 is already taken by `105_theme_base_and_favicon.sql`).

```sql
-- cfg_themes: stores named saved theme variants as token-delta overrides
CREATE TABLE cfg_themes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  base_theme   VARCHAR(50)  NOT NULL CHECK (base_theme IN ('bold-business', 'classic')),
  tokens       JSONB        NOT NULL DEFAULT '{}',
  scope        VARCHAR(20)  NOT NULL CHECK (scope IN ('system', 'tenant', 'business')),
  scope_id     UUID,
  -- NULL for scope='system'; tenant.id for scope='tenant'; business.id for scope='business'
  is_active    BOOLEAN      NOT NULL DEFAULT false,
  deleted_at   TIMESTAMPTZ,               -- soft-delete; NULL = not deleted
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unique theme name per (tenant, scope, scope_id) — prevents collisions within a scope
CREATE UNIQUE INDEX cfg_themes_name_uidx
  ON cfg_themes (tenant_id, scope, scope_id, name)
  WHERE deleted_at IS NULL;

-- Fast lookup for the resolve query and gallery listings
CREATE INDEX cfg_themes_scope_idx
  ON cfg_themes (tenant_id, scope, scope_id)
  WHERE deleted_at IS NULL;

-- RLS: each row is only visible to its own tenant
ALTER TABLE cfg_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfg_themes_tenant_isolation ON cfg_themes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- GRANT the app role access
GRANT SELECT, INSERT, UPDATE, DELETE ON cfg_themes TO app_user;

-- Assignment pointer: which saved theme is active at each scope level
-- DEFERRABLE so the apply TX can set is_active and update the pointer atomically
ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS active_custom_theme_id UUID
    REFERENCES cfg_themes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE sys_tenants
  ADD COLUMN IF NOT EXISTS active_custom_theme_id UUID
    REFERENCES cfg_themes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- System-level default: stored in sys_configurations
-- NULL value means "use Bold Business built-in code default"
INSERT INTO sys_configurations (key, value, description)
VALUES (
  'theme.system_active_theme_id',
  NULL,
  'UUID of the system-level active custom theme; NULL means use Bold Business built-in default'
) ON CONFLICT (key) DO NOTHING;
```

**Schema notes:**
- `tokens` stores **only the overridden values** (a delta). Example: `{"--color-primary": "#E63946"}`. The keys are the full CSS custom property names prefixed with `--`.
- `scope_id` is nullable because `scope = 'system'` has no single owner entity.
- The `DEFERRABLE INITIALLY DEFERRED` FK allows the apply endpoint to set `is_active = true` and update the assignment pointer in the same transaction without a circular FK problem.
- All reads filter `WHERE deleted_at IS NULL`.
- The column is `active_custom_theme_id` (not `active_theme_id`) to avoid confusion with the existing `base_theme` column on `sys_businesses` (which stores `'classic'` or `'bold-business'` as a string).

### Built-in Theme Constants

Built-in themes are defined as TypeScript constants in `packages/server/src/services/themeTokens.ts`. The token values are extracted from the CSS files at dev time and embedded as plain objects — the server does NOT read the CSS files at runtime.

The configurable token set spans three groups — **Typography** and **Colors** are CSS custom properties (applied via `style.setProperty`); **Branding** is four non-CSS values (applied via direct DOM updates — `<img src>`, `<link href>`, manifest entry, text nodes). Layout/spacing tokens, per-component styling, and custom CSS injection are explicitly out of scope for this phase (see requirements.md Out of Scope).

```typescript
export const TYPOGRAPHY_TOKEN_KEYS = [
  '--font-family',
  '--font-size-title',
  '--font-size-subtitle',
  '--font-size-body',
  '--font-size-small',
  '--font-weight-normal',
  '--font-weight-medium',
  '--font-weight-bold',
  '--color-text-title',
  '--color-text-body',
  '--color-text-muted',
] as const;

export const COLOR_TOKEN_KEYS = [
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-contrast',
  '--color-secondary',
  '--color-secondary-hover',
  '--color-secondary-contrast',
  '--color-background',
  '--color-surface',
  '--color-border',
  '--color-divider',
  '--color-sidebar-bg',
  '--color-header-bg',
  '--color-nav-active-bg',
  '--color-nav-active-text',
  '--color-accent',
  '--color-success',
  '--color-warning',
  '--color-error',
] as const;

// CSS-custom-property tokens only — everything style.setProperty is allowed to touch
export const CONFIGURABLE_TOKEN_KEYS = [...TYPOGRAPHY_TOKEN_KEYS, ...COLOR_TOKEN_KEYS] as const;
export type ConfigurableTokenKey = typeof CONFIGURABLE_TOKEN_KEYS[number];

// Non-CSS branding values — applied via direct DOM updates, never style.setProperty.
// success/warning/error default to "not overridden" (omitted from BUILT_IN_TOKENS below;
// the Theme Editor renders them collapsed/off by default per requirements.md §3.2).
export const BRANDING_TOKEN_KEYS = ['logo-url', 'favicon-url', 'app-icon-url', 'brand-name'] as const;
export type BrandingTokenKey = typeof BRANDING_TOKEN_KEYS[number];

// Token labels shown in the Theme Editor UI, grouped to match the three editor sections
export const TOKEN_LABELS: Record<ConfigurableTokenKey | BrandingTokenKey, string> = {
  '--font-family':           'Font family',
  '--font-size-title':       'Title size',
  '--font-size-subtitle':    'Subtitle size',
  '--font-size-body':        'Body text size',
  '--font-size-small':       'Small text size',
  '--font-weight-normal':    'Normal weight',
  '--font-weight-medium':    'Medium weight',
  '--font-weight-bold':      'Bold weight',
  '--color-text-title':      'Title colour',
  '--color-text-body':       'Body text colour',
  '--color-text-muted':      'Muted text colour',
  '--color-primary':          'Primary colour',
  '--color-primary-hover':    'Primary hover',
  '--color-primary-contrast': 'Primary text',
  '--color-secondary':        'Secondary colour',
  '--color-secondary-hover':  'Secondary hover',
  '--color-secondary-contrast': 'Secondary text',
  '--color-background':       'Page background',
  '--color-surface':          'Card surface',
  '--color-border':           'Border',
  '--color-divider':          'Divider',
  '--color-sidebar-bg':       'Sidebar background',
  '--color-header-bg':        'Header background',
  '--color-nav-active-bg':    'Active nav background',
  '--color-nav-active-text':  'Active nav text',
  '--color-accent':           'Accent colour',
  '--color-success':          'Success colour',
  '--color-warning':          'Warning colour',
  '--color-error':            'Error colour',
  'logo-url':                 'Logo',
  'favicon-url':               'Favicon',
  'app-icon-url':              'App icon',
  'brand-name':                'Brand name override',
};

// Default configurable token values extracted from the CSS files. Branding keys are
// intentionally absent — they default to "inherit from parent scope / platform" (blank),
// never to a built-in value, since a logo/favicon can't have a generic sensible default.
export const BUILT_IN_TOKENS: Record<BuiltInThemeId, Record<ConfigurableTokenKey, string>> = {
  'classic': {
    '--font-family':           'System Default',
    '--font-size-title':       '28px',
    '--font-size-subtitle':    '20px',
    '--font-size-body':        '15px',
    '--font-size-small':       '13px',
    '--font-weight-normal':    '400',
    '--font-weight-medium':    '500',
    '--font-weight-bold':      '700',
    '--color-text-title':      '#F5F5F3',
    '--color-text-body':       '#F5F5F3',
    '--color-text-muted':      '#8A8A8A',
    '--color-primary':          '#C9A96E',
    '--color-primary-hover':    '#D4B87F',
    '--color-primary-contrast': '#1A1A1A',
    '--color-secondary':        '#4A7FB5',
    '--color-secondary-hover':  '#6B9AC8',
    '--color-secondary-contrast': '#FFFFFF',
    '--color-background':       '#1A1A1A',
    '--color-surface':          '#242424',
    '--color-border':           '#333333',
    '--color-divider':          '#333333',
    '--color-sidebar-bg':       '#1A1A1A',
    '--color-header-bg':        '#1A1A1A',
    '--color-nav-active-bg':    'rgba(201, 169, 110, 0.15)',
    '--color-nav-active-text':  '#C9A96E',
    '--color-accent':           '#4A90A4',
    '--color-success':          '#2E7D32',
    '--color-warning':          '#E6A817',
    '--color-error':            '#D32F2F',
  },
  'bold-business': {
    '--font-family':           'System Default',
    '--font-size-title':       '28px',
    '--font-size-subtitle':    '20px',
    '--font-size-body':        '15px',
    '--font-size-small':       '13px',
    '--font-weight-normal':    '400',
    '--font-weight-medium':    '500',
    '--font-weight-bold':      '700',
    '--color-text-title':      '#172B4D',
    '--color-text-body':       '#172B4D',
    '--color-text-muted':      '#97A0AF',
    '--color-primary':          '#0052CC',
    '--color-primary-hover':    '#2684FF',
    '--color-primary-contrast': '#FFFFFF',
    '--color-secondary':        '#00A3BF',
    '--color-secondary-hover':  '#33B8CC',
    '--color-secondary-contrast': '#FFFFFF',
    '--color-background':       '#F4F5F7',
    '--color-surface':          '#FFFFFF',
    '--color-border':           '#C1C7D0',
    '--color-divider':          '#E3E8EF',
    '--color-sidebar-bg':       '#0052CC',
    '--color-header-bg':        '#FFFFFF',
    '--color-nav-active-bg':    '#2684FF',
    '--color-nav-active-text':  '#FFFFFF',
    '--color-accent':           '#4A90A4',
    '--color-success':          '#36B37E',
    '--color-warning':          '#FFAB00',
    '--color-error':            '#FF5630',
  },
};

// Virtual ThemeListItem entries for built-ins — never stored in cfg_themes
export const BUILT_IN_THEME_LIST_ITEMS: ThemeListItem[] = [
  {
    id:             'bold-business',
    name:           'Bold Business',
    base_theme:     'bold-business',
    scope:          'system',
    scope_id:       null,
    is_built_in:    true,
    is_active:      false,  // overwritten at runtime by the resolver
    preview_tokens: {
      '--color-primary':    '#0052CC',
      '--color-sidebar-bg': '#0052CC',
      '--color-background': '#F4F5F7',
      '--color-surface':    '#FFFFFF',
      '--color-text':       '#172B4D',
    },
  },
  {
    id:             'classic',
    name:           'Classic',
    base_theme:     'classic',
    scope:          'system',
    scope_id:       null,
    is_built_in:    true,
    is_active:      false,
    preview_tokens: {
      '--color-primary':    '#C9A96E',
      '--color-sidebar-bg': '#1A1A1A',
      '--color-background': '#1A1A1A',
      '--color-surface':    '#242424',
      '--color-text':       '#F5F5F3',
    },
  },
];
```

### Theme Resolution Flow

```
App load (ThemeProvider effect — runs when activeContext.businessId is set)
  │
  ├── GET /api/v1/themes/resolve?business_id=X          (no auth required)
  │     │
  │     └── ThemeService.resolveForBusiness(businessId, pool)
  │           │
  │           ├─ Step 1: SELECT b.active_custom_theme_id, b.tenant_id
  │           │            FROM sys_businesses b WHERE b.id = $businessId
  │           │          If active_custom_theme_id IS NOT NULL:
  │           │            → SELECT * FROM cfg_themes WHERE id = $id
  │           │            → merge BUILT_IN_TOKENS[base_theme] with tokens delta
  │           │            → return { base_theme, tokens: merged, source: 'business' }
  │           │
  │           ├─ Step 2: SELECT t.active_custom_theme_id
  │           │            FROM sys_tenants t WHERE t.id = $tenantId
  │           │          If active_custom_theme_id IS NOT NULL:
  │           │            → SELECT * FROM cfg_themes WHERE id = $id
  │           │            → merge → return { ..., source: 'tenant' }
  │           │
  │           ├─ Step 3: SELECT value FROM sys_configurations
  │           │            WHERE key = 'theme.system_active_theme_id'
  │           │          If value IS NOT NULL:
  │           │            → SELECT * FROM cfg_themes WHERE id = $value
  │           │            → merge → return { ..., source: 'system' }
  │           │
  │           └─ Fallback: return {
  │                base_theme: 'bold-business',
  │                tokens:     BUILT_IN_TOKENS['bold-business'],
  │                source:     'default'
  │              }
  │
  └── ThemeProvider receives ResolvedTheme
        ├── applyBaseTheme(result.base_theme)    — sets data-base-theme attribute
        └── ThemeManager.applyTheme(             — applies individual token overrides
              convertTokensToThemeConfig(result.tokens)
            )
```

**Token merge formula:**

```typescript
const merged = { ...BUILT_IN_TOKENS[row.base_theme], ...row.tokens };
// Returns full configurable token set; base provides defaults, delta provides overrides
```

The API response returns the fully merged token map so the frontend needs no knowledge of the base theme defaults.

### Permission Guard

```typescript
// packages/server/src/middleware/themePermission.ts
export function requireThemeWritePermission(): RequestHandler {
  return (req, res, next) => {
    const { persona, businessId, tenantId } = req.user;
    const targetScope: ThemeScope  = req.body?.scope  ?? req.params?.scope;
    const targetScopeId: string    = req.body?.scope_id ?? req.params?.scope_id;

    if (persona === 'system') return next();

    if (persona === 'tenant') {
      if (targetScope === 'system')
        return res.status(403).json({ error: 'Tenant personas cannot manage system-scope themes' });
      // Must own the target tenant or business
      return next();
    }

    if (persona === 'business') {
      const allowed = targetScope === 'business' && targetScopeId === businessId;
      if (!allowed)
        return res.status(403).json({ error: 'Business personas can only manage their own business theme' });
      return next();
    }

    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}
```

The `GET /themes` (listing) and `GET /themes/resolve` endpoints do NOT use this guard — listing applies scope filtering in the service, and resolve is unauthenticated.

---

## Components and Interfaces

### Backend Components

| File | Responsibility |
|---|---|
| `packages/server/src/db/migrations/106_cfg_themes.sql` | Schema migration |
| `packages/server/src/services/themeTokens.ts` | Built-in constants: `BUILT_IN_TOKENS`, `CONFIGURABLE_TOKEN_KEYS`, `TOKEN_LABELS`, `BUILT_IN_THEME_LIST_ITEMS` |
| `packages/server/src/services/theme.service.ts` | All theme CRUD and resolution business logic |
| `packages/server/src/middleware/themePermission.ts` | Write-permission guard middleware |
| `packages/server/src/routes/themes.ts` | Express route handlers for all `/api/v1/themes` endpoints |

### Frontend Components

| File | Responsibility |
|---|---|
| `packages/client/src/api/themes.ts` | Typed Axios API call functions |
| `packages/client/src/pages/settings/ThemeGallery.tsx` | Browse and select themes |
| `packages/client/src/pages/settings/ThemeGallery.css` | Styles for gallery page |
| `packages/client/src/pages/settings/ThemeEditor.tsx` | Create/edit custom themes with live preview |
| `packages/client/src/pages/settings/ThemeEditor.css` | Styles for editor page |
| `packages/client/src/pages/settings/ApplyThemeDialog.tsx` | Choose scope to apply a theme |
| `packages/shared/src/types/theme.ts` | All shared TypeScript interfaces |

### 2.3 Modified Files

| File | Modification |
|---|---|
| `packages/client/src/design-system/themes/ThemeProvider.tsx` | Add resolve-on-load effect |
| `packages/server/src/routes/index.ts` | Register `themesRouter` under `/api/v1/themes` |
| `packages/client/src/App.tsx` | Add gallery and editor routes under `/settings/themes` |

### 2.4 API Endpoints

All routes are under `/api/v1/themes`. Write routes require JWT auth and `tenantContext` middleware.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/themes` | JWT | List all themes visible to caller |
| `POST` | `/api/v1/themes` | JWT + write guard | Create a custom theme |
| `PUT` | `/api/v1/themes/:id` | JWT + write guard | Update a custom theme's name or tokens |
| `DELETE` | `/api/v1/themes/:id` | JWT + write guard | Soft-delete a custom theme |
| `POST` | `/api/v1/themes/:id/apply` | JWT + write guard | Apply a theme to a scope level |
| `GET` | `/api/v1/themes/resolve` | **None** | Resolve active theme for a business |

**IMPORTANT**: The route `/api/v1/themes/resolve` must be registered **before** `/:id` routes to prevent Express matching `resolve` as a UUID parameter.

#### `GET /api/v1/themes` — Response 200

```json
{
  "themes": [
    {
      "id": "bold-business",
      "name": "Bold Business",
      "base_theme": "bold-business",
      "scope": "system",
      "scope_id": null,
      "is_built_in": true,
      "is_active": false,
      "preview_tokens": {
        "--color-primary": "#0052CC",
        "--color-sidebar-bg": "#0052CC",
        "--color-background": "#F4F5F7",
        "--color-surface": "#FFFFFF",
        "--color-text": "#172B4D"
      }
    },
    {
      "id": "classic",
      "name": "Classic",
      "base_theme": "classic",
      "scope": "system",
      "scope_id": null,
      "is_built_in": true,
      "is_active": true,
      "preview_tokens": {
        "--color-primary": "#C9A96E",
        "--color-sidebar-bg": "#1A1A1A",
        "--color-background": "#1A1A1A",
        "--color-surface": "#242424",
        "--color-text": "#F5F5F3"
      }
    },
    {
      "id": "uuid-...",
      "name": "Transcend Teal",
      "base_theme": "bold-business",
      "scope": "business",
      "scope_id": "business-uuid",
      "is_built_in": false,
      "is_active": false,
      "preview_tokens": { "--color-primary": "#00897B" }
    }
  ]
}
```

The listing service:
1. Starts with `BUILT_IN_THEME_LIST_ITEMS` (always present, in this order: Bold Business, Classic).
2. Sets `is_active = true` on the built-in whose id matches the resolved `source` when no custom theme is active.
3. Queries `cfg_themes` with persona-based scope filter (see §1.4 for scope rules).
4. Appends saved custom themes to the list.

#### `POST /api/v1/themes` — Request body

```json
{
  "name": "Transcend Teal",
  "base_theme": "bold-business",
  "scope": "business",
  "scope_id": "uuid-of-business",
  "tokens": {
    "--color-primary": "#00897B",
    "--color-sidebar-bg": "#004D40",
    "--font-family": "Inter",
    "--font-size-title": "30px",
    "logo-url": "https://cdn.example.com/transcend-logo.svg",
    "favicon-url": "https://cdn.example.com/transcend-favicon.png"
  }
}
```

Responses: 201 (created `CfgTheme`), 400 (validation), 409 (name conflict).

The service validates that every key in `tokens` is in `CONFIGURABLE_TOKEN_KEYS` and strips any keys that match the base theme default (storing only the true delta).

#### `PUT /api/v1/themes/:id` — Request body

```json
{
  "name": "New Name",
  "tokens": { "--color-primary": "#00897B" }
}
```

Responses: 200 (updated `CfgTheme`), 400, 403 (built-in ID), 404, 409 (name conflict).

#### `DELETE /api/v1/themes/:id`

Responses: 204, 403 (built-in or wrong persona), 404, 409 (currently active — cannot delete).

#### `POST /api/v1/themes/:id/apply` — Request body

```json
{ "scope": "business", "scope_id": "uuid-of-business" }
```

Responses: 200 `{ "resolved": ResolvedTheme }`, 403 (permission), 404 (not found).

The apply operation runs in a **single transaction**:
1. `UPDATE cfg_themes SET is_active = false WHERE scope = $scope AND scope_id = $scopeId AND tenant_id = $tenantId`
2. `UPDATE cfg_themes SET is_active = true, updated_at = NOW() WHERE id = $id`
3. Update the assignment pointer on `sys_businesses`, `sys_tenants`, or `sys_configurations` as appropriate.
4. Call `resolveForBusiness` and include the result in the response.

#### `GET /api/v1/themes/resolve?business_id=X` — Response 200

```json
{
  "base_theme": "bold-business",
  "tokens": {
    "--color-primary": "#00897B",
    "--color-primary-hover": "#2684FF",
    "--color-primary-contrast": "#FFFFFF",
    "--color-background": "#F4F5F7",
    "--color-surface": "#FFFFFF",
    "--color-text": "#172B4D",
    "--color-text-secondary": "#42526E",
    "--color-border": "#C1C7D0",
    "--color-sidebar-bg": "#004D40",
    "--color-header-bg": "#FFFFFF",
    "--color-nav-active-bg": "#2684FF",
    "--color-nav-active-text": "#FFFFFF",
    "--color-accent": "#4A90A4",
    "--font-family": "Inter",
    "--font-size-title": "30px",
    "--font-size-subtitle": "20px",
    "--font-size-body": "15px",
    "--font-size-small": "13px",
    "--color-text-title": "#172B4D",
    "logo-url": "https://cdn.example.com/transcend-logo.svg",
    "favicon-url": "https://cdn.example.com/transcend-favicon.png",
    "app-icon-url": "",
    "brand-name": ""
  },
  "source": "business"
}
```

`tokens` mixes CSS-var keys (applied via `style.setProperty`) and branding keys (applied via DOM update) in one flat map — the frontend splits them by checking membership in `CONFIGURABLE_TOKEN_KEYS` vs `BRANDING_TOKEN_KEYS`.

Returns HTTP 200 with Bold Business defaults when `business_id` is unknown. Returns HTTP 400 only when `business_id` query parameter is missing entirely.

---

## Data Models

### 3.1 Shared TypeScript Interfaces (`packages/shared/src/types/theme.ts`)

```typescript
export type ThemeScope = 'system' | 'tenant' | 'business';
export type BuiltInThemeId = 'bold-business' | 'classic';

export interface CfgTheme {
  id: string;
  tenant_id: string;
  name: string;
  base_theme: BuiltInThemeId;
  tokens: Record<string, string>;      // delta overrides only — CSS var keys (--) from
                                        // CONFIGURABLE_TOKEN_KEYS, plus non-CSS branding
                                        // keys from BRANDING_TOKEN_KEYS in the same map
  scope: ThemeScope;
  scope_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThemeListItem {
  id: string;                           // UUID for saved; 'bold-business'|'classic' for built-ins
  name: string;
  base_theme: BuiltInThemeId;
  scope: ThemeScope;
  scope_id: string | null;
  is_built_in: boolean;
  is_active: boolean;
  preview_tokens: Record<string, string>;  // 5 key tokens for swatch rendering
}

export interface ResolvedTheme {
  base_theme: BuiltInThemeId;
  tokens: Record<string, string>;       // full merged configurable token set
  source: 'business' | 'tenant' | 'system' | 'default';
}

export interface CreateThemeDto {
  name: string;                         // non-empty, ≤ 100 chars
  base_theme: BuiltInThemeId;
  scope: ThemeScope;
  scope_id: string | null;
  tokens?: Record<string, string>;      // CSS var keys; unknown keys stripped
}

export interface UpdateThemeDto {
  name?: string;
  tokens?: Record<string, string>;
}

export interface ApplyThemeDto {
  scope: ThemeScope;
  scope_id: string | null;
}

export interface ApplyThemeResponse {
  resolved: ResolvedTheme;
}
```

### 3.2 Theme Service Interface

```typescript
// packages/server/src/services/theme.service.ts
export interface ThemeService {
  resolveForBusiness(businessId: string, pool: Pool): Promise<ResolvedTheme>;
  listForCaller(caller: AuthUser, businessId: string, pool: Pool): Promise<{ themes: ThemeListItem[] }>;
  create(body: CreateThemeDto, caller: AuthUser, pool: Pool): Promise<CfgTheme>;
  update(id: string, body: UpdateThemeDto, caller: AuthUser, pool: Pool): Promise<CfgTheme>;
  softDelete(id: string, caller: AuthUser, pool: Pool): Promise<void>;
  applyToScope(themeId: string, dto: ApplyThemeDto, caller: AuthUser, pool: Pool): Promise<ResolvedTheme>;
}
```

### 3.3 Frontend Hook

```typescript
// Used within ThemeGallery.tsx and ThemeEditor.tsx
interface ThemeGalleryState {
  themes: ThemeListItem[];
  loading: boolean;
  error: string | null;
}

interface ThemeEditorState {
  baseTheme: BuiltInThemeId;
  tokenValues: Record<string, string>;  // current control values — 11 typography + 18 colour
                                          // (CONFIGURABLE_TOKEN_KEYS) + 4 branding (BRANDING_TOKEN_KEYS)
  name: string;
  nameError: string | null;
  saving: boolean;
}
```

### 3.4 ThemeProvider Extension

```typescript
// Addition to ThemeProvider.tsx
async function loadResolvedTheme(businessId: string): Promise<void> {
  try {
    const resolved = await resolveTheme(businessId);  // from api/themes.ts
    applyBaseTheme(resolved.base_theme);              // ThemeManager — sets data-base-theme
    // Convert CSS-var-keyed tokens to ThemeManager.ThemeConfig shape
    const config = cssVarsToThemeConfig(resolved.tokens);
    applyTheme(config);
  } catch {
    console.error('[ThemeProvider] resolve failed, using built-in default');
    applyBaseTheme('bold-business');
    resetToDefault();
  }
}

// cssVarsToThemeConfig maps '--color-primary' → { colorPrimary: value }
// Only keys present in ThemeManager.TOKEN_MAP are passed through
```

### 3.5 Live Preview Implementation

The Theme Editor preview panel is a **scoped container** — a self-contained `<div>` that receives token overrides as inline styles, isolating it from `document.documentElement`:

```tsx
// ThemeEditor.tsx
<div
  className="theme-editor__preview"
  ref={previewRef}
  style={Object.fromEntries(
    Object.entries(tokenValues).map(([k, v]) => [k, v])
  ) as React.CSSProperties}
>
  {/* Sidebar strip, header bar, primary button, card, table row */}
  <PreviewSidebar />
  <PreviewContent />
</div>
```

The preview's children use `var(--color-primary)` etc. which resolve against the nearest ancestor with an inline style — the preview container — rather than `:root`. This matches Requirement 8.3.

When a colour picker changes, the state update triggers a React re-render of the preview container's inline style object — no direct DOM manipulation needed, and the update is synchronous within the React render cycle (well under 100ms).

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Theme cascade — business scope wins

*For any* business that has `active_custom_theme_id` set in `sys_businesses`, the resolve service SHALL return the token map for that saved theme, regardless of what theme (if any) is assigned at the tenant or system level.

**Validates: Requirements 4.1, 4.2**

### Property 2: Theme cascade — tenant fallback

*For any* business that has no `active_custom_theme_id`, but whose parent tenant has `active_custom_theme_id` set in `sys_tenants`, the resolve service SHALL return the token map for that tenant-level saved theme.

**Validates: Requirements 4.1, 4.3**

### Property 3: Theme cascade — Bold Business default

*For any* business and tenant pair where neither has an `active_custom_theme_id`, and no system-level theme is configured, the resolve service SHALL return the fully merged Bold Business built-in token set with `source: 'default'`.

**Validates: Requirements 4.1, 4.4, 4.5, 6.5**

### Property 4: Built-in themes always present in listing

*For any* authenticated caller with any persona, the `GET /api/v1/themes` response SHALL always contain exactly two entries with `id = 'bold-business'` and `id = 'classic'`, in that order, at the start of the list.

**Validates: Requirements 1.1, 6.4**

### Property 5: Persona-scoped listing containment

*For any* Business_Persona caller, every custom theme in the listing response SHALL satisfy: `scope = 'business' AND scope_id = caller.businessId` OR `scope = 'tenant' AND tenant_id = caller.tenantId` OR `scope = 'system'`. No themes from other businesses or tenants SHALL appear.

**Validates: Requirements 1.4, 5.5**

### Property 6: Custom theme create/retrieve round trip

*For any* valid `CreateThemeDto` submitted by an authorised caller, after a successful `POST /api/v1/themes` (HTTP 201), a subsequent `GET /api/v1/themes` response SHALL contain an entry whose `name`, `base_theme`, `scope`, and `scope_id` match the submitted values.

**Validates: Requirements 3.6**

### Property 7: Apply enforces at-most-one-active invariant

*For any* scope level (system / tenant / business), after calling `POST /api/v1/themes/:id/apply`, exactly one `cfg_themes` row with that `(scope, scope_id)` combination SHALL have `is_active = true`; all other rows for the same `(scope, scope_id)` SHALL have `is_active = false`.

**Validates: Requirements 2.6, 7.5**

### Property 8: Permission boundary — business persona write rejection

*For any* Business_Persona caller, any write operation (POST, PUT, DELETE, apply) that specifies a `scope` other than `'business'` with the caller's own `business_id` as `scope_id` SHALL be rejected with HTTP 403.

**Validates: Requirements 5.1, 5.4**

### Property 9: Built-in theme immutability

*For any* request (PUT, DELETE, or apply) that uses the string identifier `'bold-business'` or `'classic'` as the target `id` or `base_theme` to attempt modification, the API SHALL respond with HTTP 403 or 400, and no data in `cfg_themes` SHALL be modified.

**Validates: Requirements 6.2, 6.3**

### Property 10: Delete-permission is per-scope

*For any* Custom_Theme, the Delete action SHALL be rejected with HTTP 403 if the caller's persona does not have write permission at the theme's `scope`. The Delete action SHALL succeed only for themes at or below the caller's highest permitted scope.

**Validates: Requirements 1.8**

### Property 11: Token application containment

*For any* resolved theme applied to `document.documentElement`, `style.setProperty` SHALL be called only with CSS custom property keys present in `CONFIGURABLE_TOKEN_KEYS` (Typography + Colors). Keys in `BRANDING_TOKEN_KEYS` SHALL NEVER be passed to `style.setProperty` — they SHALL be applied only via the DOM-update path (logo `<img>`, favicon `<link>`, app-icon manifest, brand-name text nodes). No other CSS properties or tokens SHALL be set or removed.

**Validates: Requirements 8.1, 8.5**

### Property 12: Preview panel isolation

*For any* set of token changes made in the Theme Editor, the changes SHALL be reflected via inline styles on the preview container element, and SHALL NOT be set on `document.documentElement`.

**Validates: Requirements 8.3**

### Property 13: Reset restores base theme defaults

*For any* state of the Theme Editor (any combination of changed token values), after calling "Reset to Base", every token picker value SHALL equal the corresponding default value from `BUILT_IN_TOKENS[currentBaseTheme]`.

**Validates: Requirements 3.8**

### Property 14: Token delta minimisation

*For any* custom theme saved with a `tokens` payload, the stored JSONB in `cfg_themes.tokens` SHALL contain only keys whose values differ from `BUILT_IN_TOKENS[base_theme]`. Keys whose submitted value equals the base default SHALL be stripped before insert/update.

**Validates: Requirements 7.6**

---

## Error Handling

### 5.1 API Error Responses

| Scenario | HTTP Status | Response body |
|---|---|---|
| Missing `business_id` on resolve | 400 | `{ "error": "business_id query parameter is required" }` |
| Unknown `business_id` on resolve | 200 | Bold Business default token set (never 404) |
| Name conflict on create | 409 | `{ "error": "A theme named '...' already exists at this scope" }` |
| Delete an active theme | 409 | `{ "error": "Cannot delete the currently active theme; apply another theme first" }` |
| Modify or delete a built-in | 403 | `{ "error": "Built-in themes cannot be modified or deleted" }` |
| Insufficient persona scope | 403 | `{ "error": "Insufficient permissions to manage themes at scope '...'" }` |
| Theme not found | 404 | `{ "error": "Theme not found" }` |
| Invalid `base_theme` value | 400 | `{ "error": "base_theme must be 'bold-business' or 'classic'" }` |
| Unknown token key in `tokens` | 400 | `{ "error": "Unknown token key(s): '--color-unknown'. Valid keys: ..." }` |

### 5.2 Frontend Error Handling

- **409 name conflict on save:** Inline error below the name field in Theme Editor; do not use a toast for this.
- **403 permission denied:** Toast notification: "You don't have permission to do that."
- **404 not found:** Toast: "Theme not found. It may have been deleted."
- **Resolve endpoint failure at app load:** Silent fallback to `applyBaseTheme('bold-business')` + `resetToDefault()`; log error to console.
- **Theme listing network error:** Error state in Theme Gallery with a Retry button; no redirect.
- **Apply failure:** Toast with error message; gallery state is not changed (re-fetch to get current state).

---

## Testing Strategy

### 6.1 Approach

Theme resolution logic and permission guards are pure service-layer concerns — they are well-suited to property-based testing. UI interactions and ThemeProvider integration use example-based tests.

**PBT library:** [fast-check](https://github.com/dubzzz/fast-check) (TypeScript-native, Vitest integration).

Each property test MUST run a minimum of **100 iterations** via `fc.assert(fc.property(...))`.

Tag format for every property test comment: `// Feature: 37-theme-setup, Property N: <title>`

### 6.2 Property Tests

**`packages/server/src/services/theme.service.test.ts`**

- **Properties 1–3 (cascade):** Mock the database pool to return configurable business/tenant/system assignment states. Generate random combinations of assignments at each level. Assert the resolver always follows the business → tenant → system → default priority.
- **Property 4 (built-ins always present):** Generate random callers with any persona; call `listForCaller`; assert the first two entries always have `id = 'bold-business'` and `id = 'classic'`.
- **Property 5 (listing containment):** Generate a Business_Persona caller and a random set of cfg_themes rows at various scopes/tenant IDs. Assert every row in the listing result belongs to an accessible scope.
- **Property 7 (at-most-one-active):** Seed N themes at a scope; call `applyToScope` for each in a random order. After each apply, query the mock DB and assert exactly one row has `is_active = true`.
- **Property 14 (delta minimisation):** Generate `CreateThemeDtos` where some token values equal the base defaults. Assert the stored `tokens` object omits those equal-to-default keys.

**`packages/server/src/middleware/themePermission.test.ts`**

- **Property 8 (business persona rejection):** Generate all `ThemeScope` values (system, tenant, and business + non-matching scope_id); assert `requireThemeWritePermission` returns 403 for all non-permitted combinations.
- **Property 10 (delete-permission):** Generate custom themes at all three scopes; assert Business_Persona gets 403 when deleting tenant or system scope themes.

**`packages/server/src/routes/themes.route.test.ts`**

- **Property 6 (create/retrieve):** Generate random valid `CreateThemeDto` values (random names, both base_theme values, all three scopes). POST then GET; verify the entry appears in the listing with matching fields.
- **Property 9 (built-in immutability):** Attempt PUT and DELETE with IDs `'bold-business'` and `'classic'`; assert 403 every time.

**`packages/client/src/pages/settings/ThemeEditor.test.tsx`**

- **Property 12 (preview isolation):** Simulate token changes; assert `document.documentElement.style.setProperty` is never called; assert the preview div's inline style IS updated.
- **Property 13 (reset restores defaults):** Generate arbitrary token value changes for any combination of tokens; call reset; assert all values match `BUILT_IN_TOKENS[base_theme]`.

**`packages/client/src/context/ThemeManager.test.ts`**

- **Property 11 (token containment):** Generate random `ResolvedTheme` objects with keys from `CONFIGURABLE_TOKEN_KEYS`; call `applyTheme`; assert `setProperty` called exactly for each key and nothing else.

### 6.3 Example-Based Unit Tests

- **Theme Gallery:** Two built-in cards always render; "Active" badge on correct card; no Edit/Delete on built-in cards; persona-appropriate Delete visibility.
- **Apply Dialog:** Business_Persona sees only one scope option; Tenant_Persona sees two; System_Persona sees three.
- **Theme Editor:** Renders 3 sections (Typography, Colors, Branding) with 11 + 18 + 4 = 33 controls total; 409 response shows inline name error not a toast; "Base Theme" selector switching reloads defaults.
- **ThemeProvider:** `resolveTheme` called when `businessId` becomes available; `applyBaseTheme` + `applyTheme` called with resolve result; fallback to Bold Business on resolve failure.

### 6.4 Integration Tests (supertest)

- `POST /api/v1/themes`: happy path (201); name conflict (409); invalid `base_theme` (400); unknown token key (400).
- `DELETE /api/v1/themes/:id`: active theme returns 409; built-in returns 403.
- `POST /api/v1/themes/:id/apply`: each persona's cross-scope permission; response includes resolved token set.
- `GET /api/v1/themes/resolve`: missing `business_id` (400); unknown `business_id` returns Bold Business defaults (200); cascade verification at business, tenant, and system levels.
- `GET /api/v1/themes/resolve` without auth header: 200 (unauthenticated access permitted).
