# Context Switcher — Implementation Tasks

## Overview

Implement the Context Switcher feature end-to-end: shared types, ContextManager provider, ThemeManager, API client interceptor, module registry extension, ContextSwitcher dropdown, ContextBreadcrumb, AppLayout integration, and the localStorage migration shim removal. Tasks follow the dependency order from the design — foundation first, UI last.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. TypeScript types and shared interfaces

- [ ] 1.1 Create `ActiveContext` and `SwitchableContext` interfaces in `packages/shared/src/types/context.ts`
  - `ActiveContext`: `contextLevel`, `tenantId`, `businessId`, `displayName`, `logoUrl?`
  - `SwitchableContext`: `id`, `type`, `parentId?`, `displayName`, `logoUrl?`
  - `ContextState` interface covering all fields `ContextProvider` exposes
  - `ContextSwitchAuditEntry` interface
  - Export all types from the shared package barrel
  - _Requirements: 1.1, 9.6_

- [ ]* 1.2 Write unit tests for type guards and persona-default helper
  - Test `resolvePersonaDefault` returns correct `contextLevel`, `tenantId`, `businessId` for every JWT role mapping in the design
  - Test that `contextLevel`/`tenantId`/`businessId` invariant holds for all three context levels (Property 1)
  - _Requirements: 1.2 — Property 1_

---

## 2. ContextManager — provider, hook, contextRef, sessionStorage, audit log

- [ ] 2.1 Create `packages/client/src/context/ContextManager.tsx` with `ContextProvider` and `useContextManager` hook
  - Implement `ContextManagerContext` with all `ContextState` fields
  - Implement `resolvePersonaDefault(user)` to build the default `ActiveContext` from JWT role
  - Implement `init()`: read `sessionStorage.getItem('ds_active_context')`, parse, validate against accessible contexts, fall back to persona default
  - Expose `contextRef: { current: ActiveContext | null }` at module level for the API interceptor
  - Keep `isInitialising` flag true until init completes; expose request-queue flush mechanism
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 7.5_

- [ ] 2.2 Implement `switchContext(target: SwitchableContext)` inside `ContextProvider`
  - Validate target exists in `accessibleContexts` — reject with `INVALID_CONTEXT_TARGET` if not (Req 9.2)
  - Set `isSwitching = true`
  - Save `prev` context before mutation; update `activeContext`, persist to `sessionStorage`
  - Write one `ContextSwitchAuditEntry` to `contextSwitchAuditLog` (module-level array, cap at 100)
  - Expose `window.__ds_context_audit` in development
  - Re-fetch accessible contexts for new scope; apply theme via `ThemeManager`
  - Set `isSwitching = false`; call `navigate('/dashboard')`
  - On any error: revert `activeContext` and `sessionStorage` to `prev`, show toast "Context switch failed — please try again"
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 9.2, 9.3, 9.6_

- [ ] 2.3 Implement `resetToPersonaDefault()` and logout cleanup
  - `resetToPersonaDefault()` rebuilds default context from current `user` and calls `switchContext`-like state update (no navigation)
  - On logout: call `sessionStorage.removeItem('ds_active_context')`
  - _Requirements: 10.1, 10.4_

- [ ] 2.4 Implement accessible contexts loading for each persona
  - `system` persona: `GET /api/v1/admin/tenants` → populate switchable tenant list
  - `system` persona with active `tenantId`: additionally `GET /api/v1/admin/businesses` for businesses under that tenant
  - `tenant` persona: `GET /api/v1/admin/businesses` filtered by JWT `tenant_id`
  - `business` persona: set `accessibleContexts = []`
  - On API failure: retain current context, set `accessibleContextsError` flag; surface "Could not load available contexts" in the UI (non-blocking, no logout)
  - Re-fetch after every successful `switchContext` call
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ]* 2.5 Write property tests for ContextManager state logic (`ContextManager.test.tsx`)
  - **Property 1**: Generate all three context types; assert `tenantId`/`businessId` null invariant
  - **Property 2**: Generate random `ActiveContext` values; verify sessionStorage round-trip produces equal object — _Validates: Requirements 1.3, 10.2_
  - **Property 3**: Generate stored contexts whose IDs are absent from accessible list; assert init falls back to persona default — _Validates: Requirement 1.4_
  - **Property 4**: Generate business-persona users; assert `accessibleContexts.length === 0` — _Validates: Requirement 2.4_
  - **Property 19**: Generate `SwitchableContext` targets not in accessible list; assert `switchContext` rejects and `activeContext` unchanged — _Validates: Requirement 9.2_
  - **Property 20**: Assert `localStorage.getItem('access_token')` identical before and after any switch — _Validates: Requirement 9.3_
  - **Property 21**: Assert audit log length +1 after each switch; verify entry fields — _Validates: Requirement 9.6_
  - **Property 22**: Simulate React Router `navigate` calls; assert `activeContext` unchanged — _Validates: Requirement 10.1_
  - **Property 23**: Assert `sessionStorage.getItem('ds_active_context') === null` after logout — _Validates: Requirement 10.4_
  - _Requirements: 1.1–1.5, 5.1–5.7, 9.2, 9.3, 9.6, 10.1, 10.4_

---

## 3. ThemeManager

- [ ] 3.1 Create `packages/client/src/context/ThemeManager.ts` with `applyTheme` and `resetToDefault`
  - `applyTheme(config: ThemeConfig | null)`: inject CSS custom properties onto `document.documentElement` using `setProperty` / `removeProperty`
  - `resetToDefault()`: remove all context-supplied custom properties, restoring platform defaults
  - Cascade order: business overrides → tenant overrides → platform defaults; clearing business-level when switching to tenant context
  - Transition: set `root.style.transition` to `250ms cubic-bezier(0.4, 0, 0.2, 1)` on applicable properties, clear after 300ms; skip transition entirely when `prefers-reduced-motion` is `reduce`
  - Never touch `document.documentElement.dataset.theme` (light/dark mode is owned by `ThemeProvider`)
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ]* 3.2 Write property tests for ThemeManager (`ThemeManager.test.ts`)
  - **Property 16**: Generate sparse `ThemeConfig` objects; assert each present key is set as CSS custom property; absent keys retain prior value — _Validates: Requirements 8.1–8.4_
  - **Property 17**: Vary `data-theme` attribute and `ThemeConfig`; assert `data-theme` is unchanged after `applyTheme` — _Validates: Requirement 8.6_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

---

## 4. API client — interceptor update and request queue

- [ ] 4.1 Update `packages/client/src/api/client.ts` request interceptor to read from `contextRef`
  - Import `contextRef` from `ContextManager.tsx`
  - When `contextRef.current.businessId` is non-null: set `config.params.business_id` if not already present; do NOT read `business_id` from `localStorage`
  - When `contextRef.current.tenantId` differs from the JWT `tenant_id` claim: inject `X-Context-Tenant-Id` header
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 4.2 Implement the request queue for pre-init requests
  - When `isInitialising` is true, hold outgoing requests in an array of `{ resolve, reject }` pairs
  - Flush queue (dispatch all held requests) once `isInitialising` flips to false
  - Cap queue at 20 items; reject excess with `CONTEXT_INIT_TIMEOUT`
  - _Requirements: 7.5_

- [ ]* 4.3 Write property tests for the API client interceptor (`apiClient.test.ts`)
  - **Property 14**: Generate `contextRef` values with non-null `businessId`; assert `config.params.business_id` equals `contextRef.businessId`; assert no `localStorage` read — _Validates: Requirements 7.1, 7.4_
  - **Property 15**: Generate system-admin contexts where `tenantId ≠ JWT tenant_id`; assert `X-Context-Tenant-Id` header present and correct — _Validates: Requirement 7.2_
  - _Requirements: 7.1, 7.2, 7.4, 7.5_

---

## 5. Module registry — contextLevel parameter

- [ ] 5.1 Extend `getVisibleModules` in `moduleRegistry.ts` to accept an optional `contextLevel` parameter
  - Signature: `getVisibleModules(persona, permissions, featureFlags, contextLevel?: 'system' | 'tenant' | 'business')`
  - When `contextLevel` is provided and differs from persona's natural level, apply context-level filter:
    - `contextLevel === 'system'` → only modules with `personas: ['system']`
    - `contextLevel === 'tenant'` → only modules with `personas: ['tenant']`
    - `contextLevel === 'business'` → only modules with `personas` containing `'business'` or `'customer'`
  - Existing persona + permission checks still run unchanged; no permission escalation
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ]* 5.2 Write property tests for module registry extension (`moduleRegistry.test.ts`)
  - **Property 13**: Generate `(persona, permissions, contextLevel)` triples with fast-check; assert output never includes a module whose `permission` field is not satisfied by the permissions array, and that all returned modules belong to the contextLevel-appropriate persona group — _Validates: Requirements 6.1–6.5_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

---

## 6. ContextSwitcher component

- [ ] 6.1 Create `packages/client/src/components/ContextSwitcher.tsx` — static label variant for `business` persona
  - Render a non-interactive `<span>` containing the business `displayName`
  - No button, no dropdown, no chevron
  - _Requirements: 3.1, 3.5_

- [ ] 6.2 Implement interactive trigger + dropdown panel for `system` / `tenant` persona
  - Outer wrapper: `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-label="Active context"`, `aria-activedescendant`
  - Trigger `<button>`: logo `<img>` at 24×24px (if `logoUrl`), `displayName` span, chevron SVG (or loading spinner when `isSwitching`)
  - Dropdown `<div>`: `role="listbox"`, grouped by `type` with `role="group"` + `aria-labelledby`
  - Each option `<div>`: `role="option"`, `aria-selected` (true for active context), `id` for `aria-activedescendant`
  - Show logo at 24×24px per option when `logoUrl` is present; `alt="{name} logo"` or `alt=""` if decorative
  - Visual highlight on the currently active option distinct from hover state
  - _Requirements: 3.2, 3.3, 3.4, 3.6, 3.8, 3.10, 3.11_

- [ ] 6.3 Implement keyboard navigation and focus management
  - `Tab` focuses trigger; `Enter`/`Space` opens panel
  - `ArrowDown` / `ArrowUp` cycle through options (wraps at ends); update `aria-activedescendant`
  - `Enter` on a focused option calls `switchContext` and closes panel
  - `Escape` closes panel and returns focus to trigger
  - Click outside (document `mousedown` listener) closes panel
  - Focus trapped inside panel while open
  - _Requirements: 3.7, 3.9_

- [ ] 6.4 Create `packages/client/src/components/ContextSwitcher.css`
  - All colour values use CSS custom properties (`var(--color-*)`)
  - Styles for: `.context-switcher`, `.context-switcher__trigger`, `.context-switcher__panel`, `.context-switcher__group`, `.context-switcher__group-label`, `.context-switcher__option`, `.context-switcher__option--active`, `.context-switcher__option--focused`, `.context-switcher__chevron`
  - Visible focus indicator on trigger and options meeting 4.5:1 contrast
  - Responsive: hide dropdown below 640px width if necessary
  - _Requirements: 3.10_

- [ ]* 6.5 Write property and unit tests for ContextSwitcher (`ContextSwitcher.test.tsx`)
  - **Property 6**: Generate random `ActiveContext` values; render component; assert trigger text contains `displayName` — _Validates: Requirements 3.2, 3.3_
  - **Property 7**: Generate `accessibleContexts` arrays; open dropdown; assert every item appears under correct group, no extras — _Validates: Requirement 3.4_
  - **Property 8**: Render with `business` persona; assert no `<button>` with dropdown behaviour — _Validates: Requirement 3.5_
  - **Property 9**: Generate contexts with `logoUrl`; assert rendered `<img>` has `width="24"` and `height="24"` — _Validates: Requirement 3.11_
  - ARIA smoke: assert `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded` toggles on open/close
  - _Requirements: 3.2, 3.4, 3.5, 3.8, 3.9, 3.10, 3.11_

---

## 7. Checkpoint — core logic complete

- [ ] Ensure all tests written to this point pass. Ask the user if anything is unclear before proceeding to UI integration.

---

## 8. ContextBreadcrumb component

- [ ] 8.1 Extract pure `formatBreadcrumb(context: ActiveContext, persona: Persona): string[]` helper function
  - `system` persona at system level → `['DayStream']`
  - system/tenant persona at tenant level → `['DayStream', tenantName]`
  - system/tenant persona at business level → `['DayStream', tenantName, businessName]`
  - `business` persona → `[businessName]` only
  - _Requirements: 4.2, 4.3, 4.4_

- [ ] 8.2 Create `packages/client/src/components/ContextBreadcrumb.tsx`
  - `<nav aria-label="Context hierarchy">` wrapping an `<ol>`
  - Each segment: `<li>` containing `<span class="context-breadcrumb__segment" title="{fullName}">{displayLabel}</span>`
  - Separator `<li aria-hidden>›</li>` between segments
  - Truncate segment labels exceeding 24 characters with CSS `text-overflow: ellipsis`; full name in `title` attribute
  - CSS: `display: none` at viewport widths below 640px (`@media (max-width: 639px)`)
  - Add breadcrumb styles to `ContextSwitcher.css` under `.context-breadcrumb` namespace
  - _Requirements: 4.1, 4.5, 4.6_

- [ ]* 8.3 Write property tests for ContextBreadcrumb (`breadcrumb.test.ts`)
  - **Property 10**: Generate `ActiveContext` + persona combinations; assert `formatBreadcrumb` output matches the four format rules — _Validates: Requirements 4.2, 4.3, 4.4_
  - **Property 11**: Generate `displayName` strings longer than 24 characters; render `ContextBreadcrumb`; assert segment is visually truncated and `title` attribute equals full name — _Validates: Requirement 4.5_
  - _Requirements: 4.2, 4.3, 4.4, 4.5_

---

## 9. AppLayout integration

- [ ] 9.1 Update `packages/client/src/main.tsx` to wrap the app in `ContextProvider`
  - Insert `<ContextProvider>` inside `<AuthProvider>` and outside `<BrowserRouter>` per design
  - Ensure `ContextProvider` receives `useAuth()` data correctly (it calls `useAuth` internally)
  - _Requirements: 1.5_

- [ ] 9.2 Update `packages/client/src/components/AppLayout.tsx` to render `ContextSwitcher` and `ContextBreadcrumb` in the header
  - Import and call `useContextManager` to obtain `activeContext`, `contextLevel`, and `isSwitching`
  - Position `ContextSwitcher` immediately right of the sidebar toggle button, before the DayStream wordmark
  - Position `ContextBreadcrumb` immediately after `ContextSwitcher`
  - Pass `contextLevel` (from `useContextManager`) to `getVisibleModules` in the sidebar
  - Remove the inline `resolvePersona` and `getPermissionsFromRole` logic; derive persona from `useContextManager` / `useAuth`
  - _Requirements: 3.1, 4.1, 6.6_

---

## 10. Integration tests

- [ ]* 10.1 Write integration tests covering cross-component data flow (`ContextManager.test.tsx` / dedicated integration file)
  - Req 2.1/2.2/2.3: Assert correct API endpoint called for each persona on `ContextProvider` mount (mock Axios)
  - Req 2.5: Mock Axios error on contexts fetch; assert context retained and error notification shown
  - **Property 5**: Mock Axios and count calls; assert contexts endpoint called at least once after each `switchContext` — _Validates: Requirement 2.6_
  - Req 6.6: Use React Testing Library async utilities to assert sidebar module list updates before route re-renders
  - Req 8.1: Assert CSS custom properties on `document.documentElement` updated after a context switch
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 6.6, 8.1_

---

## 11. Migration — remove legacy localStorage business_id reads

- [ ] 11.1 Update `packages/client/src/context/AuthContext.tsx` to stop reading `business_id` from `localStorage` into the `user` object
  - Remove `business_id: localStorage.getItem('business_id') || undefined` from the token-restore block in `useEffect`
  - Remove the `business_id` field from the `User` interface (or mark deprecated with a comment pointing to `ContextManager`)
  - Add a `// TODO: remove localStorage.setItem('business_id', ...)` comment in `login()` for the follow-up cleanup task
  - _Requirements: 7.4_

- [ ] 11.2 Audit all call sites that read `business_id` from `localStorage` or `user.business_id` directly and replace with `useContextManager().activeContext.businessId`
  - Search `packages/client/src` for `localStorage.getItem('business_id')` and `user\.business_id`
  - Update each call site; remove direct `localStorage` reads
  - _Requirements: 7.4_

---

## 12. Final checkpoint

- [ ] Ensure all tests pass. Confirm breadcrumb is hidden on narrow viewports. Ask the user if questions arise before closing the feature.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `contextRef` is a module-level plain object (not a React ref) so the API client interceptor can read it without a hook
- The `ThemeManager` must never mutate `data-theme` — light/dark mode is owned separately by `ThemeProvider`
- `ContextProvider` must be inside `AuthProvider` but outside `BrowserRouter` (it calls `useAuth` and `useNavigate`)
- Accessible contexts are always server-authorised; the client must never construct switch targets from local state alone
- The `business_id` localStorage key is a migration shim — removal is tracked in task 11; do not remove `localStorage.setItem` in `login()` until `ContextManager` is fully live

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "4.1", "5.2"] },
    { "id": 3, "tasks": ["2.5", "4.2", "6.1", "8.1"] },
    { "id": 4, "tasks": ["4.3", "6.2", "6.3", "8.2"] },
    { "id": 5, "tasks": ["6.4", "6.5", "8.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["10.1", "11.1"] },
    { "id": 9, "tasks": ["11.2"] }
  ]
}
```
