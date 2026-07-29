# Context Switcher — Design Document

**Date**: July 2026
**Status**: 🎨 Design Phase
**Dependencies**: AuthContext, moduleRegistry.ts, AppLayout.tsx, apiClient

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components and Interfaces](#components-and-interfaces)
4. [Data Models](#data-models)
5. [Correctness Properties](#correctness-properties)
6. [Error Handling](#error-handling)
7. [Testing Strategy](#testing-strategy)

---

## Overview

The Context Switcher enables system-admin and tenant-owner users to narrow their active data scope to a specific tenant or business without re-authenticating. It is a scope-narrowing mechanism — permissions always stay bounded by the JWT; the context only changes _which_ data the UI and API requests are scoped to.

The feature introduces three new runtime concepts:

- **ContextManager** — a React context provider that owns the active context state, persists it to `sessionStorage`, and exposes it to all consumers.
- **ContextSwitcher** — the dropdown UI control in the `AppLayout` header.
- **ContextBreadcrumb** — the read-only ancestry path display next to the switcher.

The existing `business_id` stored in `localStorage` is the legacy mechanism. `ContextManager` becomes the authoritative source for scope identifiers once initialised, and `localStorage` reads are removed from all consumers.

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| State storage | `sessionStorage` (not `localStorage`) | Tab-isolated; cleared on window close; matches requirements |
| JWT untouched | No new tokens on switch | Requirements mandate no re-issuance |
| Context init | From JWT claims at login | Single source of truth; no server round-trip needed to determine default |
| API scope header | `X-Context-Tenant-Id` header | Non-standard header avoids collision with JWT `tenant_id` claim |
| Module filtering | `contextLevel` parameter added to `getVisibleModules` | Additive change; existing callers unaffected |
| Theme application | `document.documentElement` CSS custom property injection | Consistent with existing design-system pattern |
| Accessible context list | Server-side API, client does not construct targets | Security requirement 9.1 |

---

## Architecture

### Component Tree

```
<AuthProvider>                    ← unchanged; provides JWT-derived user
  <ContextProvider>               ← NEW; wraps AuthProvider consumers
    <BrowserRouter>
      <App>
        <ProtectedRoute>
          <AppLayout>             ← updated to render switcher + breadcrumb
            header:
              [MenuBtn]
              [ContextSwitcher]   ← NEW
              [ContextBreadcrumb] ← NEW
              [logo "DayStream"]
              [...right side controls]
            sidebar:
              getVisibleModules(persona, perms, flags, contextLevel)  ← updated
            <main>
              {children}
            </main>
          </AppLayout>
        </ProtectedRoute>
      </App>
    </BrowserRouter>
  </ContextProvider>
</AuthProvider>
```

### Data Flow

```
JWT login
  │
  ▼
AuthContext sets user { role, business_id, tenant_id, ... }
  │
  ▼
ContextProvider.init()
  ├─ reads sessionStorage for saved context
  ├─ validates saved context against accessible list (API call)
  ├─ falls back to persona default if invalid
  └─ sets activeContext state
         │
         ├──► ContextSwitcher reads activeContext (display)
         ├──► ContextBreadcrumb reads activeContext (display)
         ├──► getVisibleModules receives contextLevel
         ├──► apiClient interceptor reads activeContext (injects headers)
         └──► ThemeManager applies CSS vars on activeContext change
```

### Context Switch Sequence

```
User selects entry in ContextSwitcher
  │
  ▼
switchContext(target) called
  ├─ validate target is in accessibleContexts list → reject if not
  ├─ set isSwitching = true (loading indicator on trigger)
  ├─ update activeContext (atomically replaces previous state)
  ├─ persist new context to sessionStorage
  ├─ record audit entry (timestamp, userId, prevContext, newContext)
  ├─ re-fetch accessible contexts for new scope
  ├─ apply theme overrides via ThemeManager
  ├─ set isSwitching = false
  └─ navigate('/dashboard')
```

---

## Components and Interfaces

### ContextProvider

**File**: `packages/client/src/context/ContextManager.tsx`

Wraps the application (inside `AuthProvider`, outside `BrowserRouter`) and owns all context state.

```tsx
interface ActiveContext {
  contextLevel: 'system' | 'tenant' | 'business';
  tenantId: string | null;
  businessId: string | null;
  displayName: string;
  logoUrl?: string;
}

interface SwitchableContext {
  id: string;                    // UUID of tenant or business
  type: 'system' | 'tenant' | 'business';
  displayName: string;
  logoUrl?: string;
  parentId?: string;             // tenantId for business entries
}

interface ContextState {
  activeContext: ActiveContext;
  accessibleContexts: SwitchableContext[];
  isSwitching: boolean;
  isInitialising: boolean;
  switchContext: (target: SwitchableContext) => Promise<void>;
  resetToPersonaDefault: () => void;
}
```

**Init logic** (runs once on mount, after `user` is available from `AuthContext`):

1. Determine persona default from `user.role` → `resolvePersonaDefault(user)`
2. Read `sessionStorage.getItem('ds_active_context')` → parse JSON
3. If stored context exists, fetch accessible contexts list
4. Validate stored context id is in accessible list — discard if not
5. Set `activeContext` (stored or default)
6. Load accessible contexts into state

**`switchContext` logic**:

1. Assert `target` is in `accessibleContexts` — throw `INVALID_CONTEXT_TARGET` if not
2. Set `isSwitching = true`
3. Build new `ActiveContext` from target
4. Update state, persist to `sessionStorage`
5. Write audit entry to `contextSwitchAuditLog` (module-level array, capped at 100 entries)
6. Re-fetch accessible contexts for new scope
7. Fetch theme config for new context → apply via `ThemeManager`
8. Set `isSwitching = false`
9. Call `navigate('/dashboard')`

### useContextManager Hook

**File**: `packages/client/src/context/ContextManager.tsx` (exported alongside provider)

```tsx
export function useContextManager(): ContextState {
  const ctx = useContext(ContextManagerContext);
  if (!ctx) throw new Error('useContextManager must be used within ContextProvider');
  return ctx;
}
```

### ContextSwitcher Component

**File**: `packages/client/src/components/ContextSwitcher.tsx`

A custom combobox-style dropdown. Renders differently based on persona:

- **business persona**: static `<span>` with business name only, no dropdown
- **system / tenant persona**: interactive trigger + dropdown

**DOM structure** (interactive variant):

```html
<div class="context-switcher" role="combobox" aria-expanded aria-haspopup="listbox"
     aria-label="Active context" aria-activedescendant>

  <!-- Trigger button -->
  <button class="context-switcher__trigger" aria-expanded>
    <img class="context-switcher__logo" />   <!-- 24×24px, if logoUrl set -->
    <span class="context-switcher__label">{displayName}</span>
    <svg class="context-switcher__chevron" aria-hidden />
    <!-- loading spinner replaces chevron when isSwitching -->
  </button>

  <!-- Dropdown panel -->
  <div class="context-switcher__panel" role="listbox" aria-label="Switch context">

    <!-- System group (system persona only) -->
    <div class="context-switcher__group" role="group" aria-labelledby="ctx-group-system">
      <span id="ctx-group-system" class="context-switcher__group-label">Platform</span>
      <div class="context-switcher__option" role="option" aria-selected id="ctx-opt-system">
        DayStream Platform
      </div>
    </div>

    <!-- Tenant group -->
    <div class="context-switcher__group" role="group" aria-labelledby="ctx-group-tenants">
      <span id="ctx-group-tenants" class="context-switcher__group-label">Tenants</span>
      {tenants.map(t => <div class="context-switcher__option" role="option" ... />)}
    </div>

    <!-- Business group (shown when a tenant is active) -->
    <div class="context-switcher__group" role="group" aria-labelledby="ctx-group-businesses">
      <span id="ctx-group-businesses" class="context-switcher__group-label">Businesses</span>
      {businesses.map(b => <div class="context-switcher__option" role="option" ... />)}
    </div>

  </div>
</div>
```

**Keyboard navigation**:

| Key | Behaviour |
|---|---|
| `Tab` | Focus trigger |
| `Enter` / `Space` | Open panel (when trigger focused) |
| `ArrowDown` | Move focus to next option (wraps) |
| `ArrowUp` | Move focus to previous option (wraps) |
| `Enter` | Select focused option, close panel |
| `Escape` | Close panel, return focus to trigger |
| Click outside | Close panel |

Focus is trapped inside the panel while open. On close, focus returns to the trigger.

**ARIA compliance**:

- `role="combobox"` on the outer wrapper; `aria-expanded` mirrors open state
- `aria-haspopup="listbox"` on the trigger
- `aria-activedescendant` on the combobox tracks the focused option's id
- Each option: `role="option"`, `aria-selected` (true for active context)
- Each group: `role="group"`, `aria-labelledby` referencing the group label span
- Loading state: `aria-busy="true"` on trigger during switch; spinner has `aria-label="Switching context"`
- Logo `<img>` elements have `alt="{tenantName} logo"` or `alt=""` if decorative

### ContextBreadcrumb Component

**File**: `packages/client/src/components/ContextBreadcrumb.tsx`

Read-only, no interaction. Hidden below 640px (CSS `display: none` at `sm` breakpoint).

**Rendered paths**:

| contextLevel | persona | Output |
|---|---|---|
| `system` | system | `DayStream` |
| `tenant` | system or tenant | `DayStream › {TenantName}` |
| `business` | system or tenant | `DayStream › {TenantName} › {BusinessName}` |
| `business` | business | `{BusinessName}` only (no ancestor links) |

Each segment is a `<span>` (not a link — navigating via breadcrumb is out of scope). Long labels (>24 chars) are truncated with CSS `text-overflow: ellipsis` and given a `title` attribute containing the full name for hover tooltip.

**DOM structure**:

```html
<nav class="context-breadcrumb" aria-label="Context hierarchy">
  <ol class="context-breadcrumb__list">
    <li class="context-breadcrumb__item">
      <span class="context-breadcrumb__segment" title="{fullName}">DayStream</span>
    </li>
    <li class="context-breadcrumb__item context-breadcrumb__item--separator" aria-hidden>›</li>
    <li class="context-breadcrumb__item">
      <span class="context-breadcrumb__segment" title="{fullTenantName}">{truncatedName}</span>
    </li>
    ...
  </ol>
</nav>
```

### ThemeManager

**File**: `packages/client/src/context/ThemeManager.ts`

Pure module (no React component) with one public function:

```ts
interface ThemeConfig {
  colorPrimary?: string;
  colorAccent?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
  fontFamily?: string;
  borderRadiusBase?: string;
  logoUrl?: string;
}

/**
 * Apply theme overrides to :root CSS custom properties.
 * Handles cascade: business → tenant → platform defaults.
 * Transitions in 250ms unless prefers-reduced-motion.
 */
export function applyTheme(config: ThemeConfig | null): void
export function resetToDefault(): void
```

**Inheritance cascade** (applied at `:root`):

```
Platform defaults (hardcoded fallbacks)
  ← Tenant overrides (from GET /api/v1/admin/tenants/:id)
    ← Business overrides (from GET /api/v1/admin/businesses/:id)
```

When switching to a tenant context, business overrides are cleared; tenant overrides are applied on top of platform defaults. When switching to system context, all overrides are cleared.

**Transition implementation**:

```ts
const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reducedMotion) {
  root.style.transition = 'background-color 250ms cubic-bezier(0.4, 0, 0.2, 1), color 250ms cubic-bezier(0.4, 0, 0.2, 1)';
  setTimeout(() => { root.style.transition = ''; }, 300);
}
// Apply properties
Object.entries(tokenMap).forEach(([prop, value]) => {
  if (value) root.style.setProperty(prop, value);
  else root.style.removeProperty(prop);
});
```

Light/dark mode (`data-theme` attribute) is managed separately by `ThemeModeToggle` and is never touched by `ThemeManager`.

---

## Data Models

### ActiveContext (runtime state)

```ts
interface ActiveContext {
  contextLevel: 'system' | 'tenant' | 'business';
  tenantId: string | null;      // null when contextLevel === 'system'
  businessId: string | null;    // null when contextLevel !== 'business'
  displayName: string;          // human-readable label for the UI trigger
  logoUrl?: string;             // optional 24×24 avatar/logo URL
}
```

### SwitchableContext (list entry)

```ts
interface SwitchableContext {
  id: string;
  type: 'system' | 'tenant' | 'business';
  displayName: string;
  logoUrl?: string;
  parentId?: string;            // tenantId for business entries
}
```

### sessionStorage schema

Key: `ds_active_context`
Value: JSON-serialised `ActiveContext`

```json
{
  "contextLevel": "business",
  "tenantId": "uuid-here",
  "businessId": "uuid-here",
  "displayName": "Transcend Mallorca",
  "logoUrl": null
}
```

Cleared on logout. Validated against accessible contexts list on restore.

### Persona → context default mapping

| JWT role | Resolved persona | contextLevel default | tenantId | businessId |
|---|---|---|---|---|
| `system_admin`, `system_support` | `system` | `system` | `null` | `null` |
| `tenant_owner`, `tenant_manager` | `tenant` | `tenant` | from JWT `tenant_id` | `null` |
| `business_owner`, `business_manager`, `business_staff` | `business` | `business` | from JWT `tenant_id` | from JWT / localStorage |
| `customer` | `customer` | `business` | — | from JWT |

### Module Registry additions

```ts
// New optional parameter added to getVisibleModules
export function getVisibleModules(
  persona: Persona,
  userPermissions: string[],
  featureFlags: Record<string, boolean>,
  contextLevel?: 'system' | 'tenant' | 'business',  // ← NEW
): ModuleDefinition[]
```

**Context-level filtering logic** (applied after existing persona + permission checks):

```
If contextLevel is provided and differs from persona's natural level:
  - contextLevel === 'system'   → only return modules with personas: ['system']
  - contextLevel === 'tenant'   → only return modules with personas: ['tenant']
  - contextLevel === 'business' → only return modules with personas: ['business', 'customer']
  
  Additionally: permission check still uses JWT-derived permissions (no escalation)
```

### API Client context injection

The `apiClient` request interceptor is extended to read `activeContext` from a module-level ref updated by `ContextProvider`:

```ts
// In ContextManager.tsx — exported for interceptor use
export const contextRef: { current: ActiveContext | null } = { current: null };

// In apiClient interceptor — reads from ref (no React hook needed)
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const ctx = contextRef.current;
  if (ctx) {
    if (ctx.businessId) {
      // Attach to params for GET, body for POST/PATCH/PUT handled per-endpoint
      // Interceptor sets a default query param; endpoints that need body injection do so explicitly
      if (!config.params) config.params = {};
      if (!config.params.business_id) config.params.business_id = ctx.businessId;
    }
    if (ctx.tenantId) {
      // Only inject header when system admin has entered a different tenant context
      const jwtTenantId = getJwtTenantId();
      if (jwtTenantId && ctx.tenantId !== jwtTenantId) {
        config.headers['X-Context-Tenant-Id'] = ctx.tenantId;
      }
    }
  }
  return config;
});
```

**Request queuing during init**: `ContextProvider` sets `isInitialising = true` until `activeContext` is resolved. The interceptor checks this flag; if true, it returns a promise that resolves once `isInitialising` flips to false (implemented with a simple promise queue).

**localStorage migration**: `AuthContext.login()` continues to set `business_id` in localStorage during the migration window. Once `ContextProvider` is in place, `AuthContext` stops reading `business_id` from localStorage for the user object. A comment in the code marks the field for removal in a follow-up cleanup task.

### Context Switch Audit Log

```ts
interface ContextSwitchAuditEntry {
  timestamp: string;          // ISO 8601
  userId: string;
  previousContext: ActiveContext;
  newContext: ActiveContext;
}

// Module-level store in ContextManager, capped at 100 entries
const contextSwitchAuditLog: ContextSwitchAuditEntry[] = [];
```

Accessible as `window.__ds_context_audit` in development for debugging.

---

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: ActiveContext fields invariant

*For any* valid context switch target (system, tenant, or business), the resulting `activeContext` object must have: all four required fields present (`contextLevel`, `tenantId`, `businessId`, `displayName`); `tenantId` null iff `contextLevel === 'system'`; `businessId` null iff `contextLevel !== 'business'`.

**Validates: Requirements 1.1, 1.2, 5.2, 5.3, 5.4**

---

### Property 2: SessionStorage round-trip

*For any* valid `ActiveContext`, after a successful context switch, `JSON.parse(sessionStorage.getItem('ds_active_context'))` should produce an object equivalent to the new `activeContext`.

**Validates: Requirements 1.3, 10.2**

---

### Property 3: Invalid stored context falls back to persona default

*For any* stored `ActiveContext` whose `tenantId` or `businessId` does not appear in the accessible contexts list fetched from the API, the `ContextManager` must discard the stored context and initialise to the persona default context (i.e. the context derived from the JWT claims alone).

**Validates: Requirements 1.4**

---

### Property 4: Business persona always has empty accessible contexts list

*For any* user whose JWT persona is `business`, the `accessibleContexts` list exposed by `ContextManager` must always be empty (length zero).

**Validates: Requirements 2.4**

---

### Property 5: Accessible contexts re-fetched after every switch

*For any* valid context switch, after `switchContext` resolves, the API endpoint for accessible contexts (tenants or businesses) must have been called at least once after the switch was initiated.

**Validates: Requirements 2.6**

---

### Property 6: Context Switcher trigger always shows active displayName

*For any* `ActiveContext`, the text content of the `ContextSwitcher` trigger button must contain the `activeContext.displayName` string.

**Validates: Requirements 3.2, 3.3**

---

### Property 7: Dropdown groups match accessible contexts

*For any* non-empty `accessibleContexts` list, when the `ContextSwitcher` dropdown is opened, every item in `accessibleContexts` must appear in the dropdown under the group corresponding to its `type` (`system`, `tenant`, or `business`), and no extra items must appear.

**Validates: Requirements 3.4**

---

### Property 8: Business persona switcher is non-interactive

*For any* user with `business` persona, the `ContextSwitcher` component must not render an interactive trigger (no `<button>` with dropdown behavior); it must render only a static label.

**Validates: Requirements 3.5**

---

### Property 9: Context entry logo rendered at 24×24px

*For any* `SwitchableContext` entry that has a non-empty `logoUrl`, the corresponding `<img>` rendered in the dropdown must have `width` and `height` attributes equal to `24`.

**Validates: Requirements 3.11**

---

### Property 10: Breadcrumb matches ancestry format

*For any* `ActiveContext`, the `ContextBreadcrumb` must render exactly the segments prescribed by the format rule: `"DayStream"` for system level; `"DayStream › {TenantName}"` for tenant level; `"DayStream › {TenantName} › {BusinessName}"` for business level; and `"{BusinessName}"` only when the user's JWT persona is `business`.

**Validates: Requirements 4.2, 4.3, 4.4**

---

### Property 11: Long breadcrumb segments truncated with full-name tooltip

*For any* context `displayName` whose character length exceeds 24, the rendered breadcrumb segment must be visually truncated (CSS ellipsis or clipped) and the element's `title` attribute must equal the full, untruncated display name.

**Validates: Requirements 4.5**

---

### Property 12: Dashboard redirect after every context switch

*For any* valid context switch, after `switchContext` resolves successfully, the router's `navigate` function must have been called with `'/dashboard'`.

**Validates: Requirements 5.5**

---

### Property 13: Module registry filtered by contextLevel without permission escalation

*For any* combination of (JWT persona, permissions array, featureFlags, contextLevel), `getVisibleModules` must return only modules whose `personas` array contains the contextLevel-appropriate persona, AND only modules for which the user's permissions satisfy the module's `permission` requirement. It must never return a module that the permissions array would not have permitted.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

---

### Property 14: business_id query param matches active context

*For any* outbound API request dispatched when `activeContext.businessId` is non-null, the request must carry a `business_id` query parameter equal to `activeContext.businessId`, and must NOT use any value read directly from `localStorage`.

**Validates: Requirements 7.1, 7.4**

---

### Property 15: X-Context-Tenant-Id header injected for cross-tenant system admin

*For any* outbound request dispatched when the active context `tenantId` differs from the JWT's own `tenant_id` claim (system admin viewing a different tenant), the request must include an `X-Context-Tenant-Id` header whose value equals `activeContext.tenantId`.

**Validates: Requirements 7.2**

---

### Property 16: Theme cascade — overrides applied, absent tokens fall back

*For any* `ThemeConfig` object (possibly sparse), after `applyTheme()` is called, each CSS custom property listed in the config must equal the config value on `:root`; CSS custom properties absent from the config must retain their previous (default or tenant-inherited) values.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

---

### Property 17: Theme application never mutates light/dark mode

*For any* initial `data-theme` attribute value on `document.documentElement` and any `ThemeConfig`, after `applyTheme()` is called, the `data-theme` attribute must be identical to its pre-call value.

**Validates: Requirements 8.6**

---

### Property 18: Accessible contexts sourced exclusively from API response

*For any* mock API response from the tenants/businesses endpoint, the `accessibleContexts` state must equal exactly the set of items returned by the API — no more, no fewer. The client must not augment or replace this list from local state.

**Validates: Requirements 9.1**

---

### Property 19: Reject context switch to unlisted target

*For any* `SwitchableContext` target whose `id` is not present in the current `accessibleContexts` list, calling `switchContext(target)` must reject (throw or return a rejected promise) and leave `activeContext` unchanged.

**Validates: Requirements 9.2**

---

### Property 20: JWT unchanged after context switch

*For any* context switch (valid or invalid), the value of `localStorage.getItem('access_token')` must be identical before and after the switch operation.

**Validates: Requirements 9.3**

---

### Property 21: Audit log gains exactly one entry per switch

*For any* successful context switch, the `contextSwitchAuditLog` array length must increase by exactly one, and the new entry must contain: a valid ISO 8601 timestamp, the correct `userId`, the `previousContext` equal to the context before the switch, and the `newContext` equal to `activeContext` after the switch.

**Validates: Requirements 9.6**

---

### Property 22: Active context preserved across in-app navigation

*For any* sequence of in-app route changes (React Router `navigate` calls), `activeContext` after the navigation must be strictly equal to `activeContext` before the navigation.

**Validates: Requirements 10.1**

---

### Property 23: SessionStorage cleared on logout

*For any* `activeContext` value at logout time, after `logout()` is called, `sessionStorage.getItem('ds_active_context')` must return `null`.

**Validates: Requirements 10.4**

---

## Error Handling

### 6.1 Accessible contexts API failure

- `ContextManager` catches the error, retains the current `activeContext`
- Sets an `accessibleContextsError` flag in state
- `ContextSwitcher` renders a non-blocking inline error message below the trigger: "Could not load available contexts"
- No redirect, no logout

### 6.2 Context switch failure (network error during reload)

- `switchContext` catches the rejection in its `try/catch`
- Reverts `activeContext` to the pre-switch value (saved in a local `prev` variable before the switch)
- Reverts `sessionStorage` to the pre-switch serialised value
- Sets `isSwitching = false`
- Dispatches a toast notification: "Context switch failed — please try again"
- No navigation to `/dashboard`

### 6.3 Invalid stored context on restore

- `ContextManager.init()` catches the validation failure silently
- Falls back to persona default
- No user-visible error (the default is a valid state and the user may not have noticed a context was stored)

### 6.4 Unauthorised target

- If `switchContext` is called with a target not in `accessibleContexts`, it logs a console warning: `[ContextManager] WARN: attempted switch to unlisted target {id}`
- Rejects the promise
- Does not update any state

### 6.5 Request dispatched before ContextManager initialises

- Requests are held in a queue (array of `{ resolve, reject }` pairs)
- Once `isInitialising` flips to false, the queue is flushed — all held requests are dispatched with the now-resolved context headers
- Queue is capped at 20 items; if exceeded, excess requests are rejected with a `CONTEXT_INIT_TIMEOUT` error

---

## Testing Strategy

### 7.1 Overview

This feature has significant

**Library**: [fast-check](https://fast-check.dev/) — TypeScript-native, runs in Vitest, well-suited for object shape and string generators.

**PBT configuration**: minimum 100 iterations per property. Each property test tagged with:

```
// Feature: context-switcher, Property N: {property text}
```

### 7.2 Unit / Property Tests

**ContextManager state logic** (`ContextManager.test.tsx`):
- Property 1: ActiveContext fields invariant — generate all three context types, assert field constraints
- Property 2: SessionStorage round-trip — generate random contexts, serialize/deserialize
- Property 3: Invalid stored context fallback — generate random UUID pairs not in accessible list
- Property 4: Business persona empty accessible contexts — generate business users
- Property 19: Reject invalid switch target — generate targets with random IDs
- Property 20: JWT unchanged — read localStorage before/after switch
- Property 21: Audit log entry — verify entry shape after any switch
- Property 22: Navigation preservation — verify context unchanged after navigate calls
- Property 23: SessionStorage cleared on logout

**getVisibleModules extension** (`moduleRegistry.test.ts`):
- Property 13: Module filtering with contextLevel — generate (persona, permissions, contextLevel) triples; assert output contains only permitted modules

**API client interceptor** (`apiClient.test.ts`):
- Property 14: business_id param injection — generate request configs with various contextRef values
- Property 15: X-Context-Tenant-Id header — generate system-admin contexts with tenant mismatch

**ThemeManager** (`ThemeManager.test.ts`):
- Property 16: Theme cascade — generate sparse ThemeConfig objects; verify CSS custom properties
- Property 17: Light/dark mode untouched — vary data-theme and ThemeConfig; verify data-theme unchanged

**Breadcrumb formatter** (pure function extracted from `ContextBreadcrumb.tsx`) (`breadcrumb.test.ts`):
- Property 10: Ancestry format — generate ActiveContext objects; assert formatted string
- Property 11: Long label truncation — generate displayNames > 24 chars; assert title attribute

**ContextSwitcher component** (`ContextSwitcher.test.tsx`):
- Property 6: Trigger shows displayName — generate random contexts with react-testing-library
- Property 7: Dropdown groups match accessible contexts — generate accessibleContexts arrays
- Property 8: Business persona non-interactive — render with business persona, assert no dropdown button
- Property 9: Logo rendered at 24×24 — generate contexts with logoUrls

### 7.3 Integration Tests

- Requirement 2.1/2.2/2.3: Correct API endpoints called for each persona on mount (mock Axios)
- Requirement 2.5: API failure retains context and shows notification (mock Axios error)
- Property 5: Accessible contexts re-fetched after switch (mock Axios, count calls)
- Requirement 6.6: Modules updated before route re-renders (React Testing Library, async timing)
- Requirement 8.1: CSS custom properties set on document root after switch

### 7.4 Smoke Tests

- Context Switcher renders in AppLayout header
- Keyboard navigation flow (Tab → Enter → ArrowDown → Enter → Escape)
- ARIA attributes: `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded` toggles
- Breadcrumb hidden at viewport < 640px (manual / visual regression)
- Theme transition respects `prefers-reduced-motion` (manual)

### 7.5 Security Validation

- Verify `localStorage.access_token` is unchanged after any switch (covered by Property 20)
- Verify server endpoints still enforce JWT claims regardless of `X-Context-Tenant-Id` header (server-side test, out of client scope but noted for integration test suite)

---

## 8. File Structure

```
packages/client/src/
├── context/
│   ├── AuthContext.tsx           ← existing; minor migration shim removal in follow-up
│   ├── ContextManager.tsx        ← NEW: ContextProvider, useContextManager, contextRef
│   └── ThemeManager.ts           ← NEW: applyTheme(), resetToDefault()
│
├── components/
│   ├── AppLayout.tsx             ← updated: renders ContextSwitcher + ContextBreadcrumb
│   ├── ContextSwitcher.tsx       ← NEW: dropdown component
│   ├── ContextBreadcrumb.tsx     ← NEW: breadcrumb component
│   └── ContextSwitcher.css       ← NEW: CSS custom property styles for both components
│
├── design-system/components/dashboard/
│   └── moduleRegistry.ts         ← updated: getVisibleModules gains contextLevel param
│
└── api/
    └── client.ts                 ← updated: request interceptor reads contextRef

packages/client/src/__tests__/    (or colocated *.test.tsx files)
├── ContextManager.test.tsx
├── moduleRegistry.test.ts
├── apiClient.test.ts
├── ThemeManager.test.ts
├── breadcrumb.test.ts
└── ContextSwitcher.test.tsx
```

### Key integration point — provider wrapping order

```tsx
// packages/client/src/main.tsx
<AuthProvider>
  <ContextProvider>          {/* NEW — must be inside AuthProvider */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ContextProvider>
</AuthProvider>
```

`ContextProvider` reads `useAuth()` internally to determine persona default. It must therefore be a descendant of `AuthProvider`.

---

**Last Updated**: July 2026
