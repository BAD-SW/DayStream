# Implementation Plan: 37 — Theme Setup

## Overview

Implement the Theme Setup module across backend (Express + raw SQL) and frontend (React + CSS custom properties). Tasks follow the dependency order: database schema → backend service and API → frontend gallery → frontend editor → apply dialog → permission enforcement → tests.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Migration

### 1.1 Create `cfg_themes` table
- [ ] Create `packages/server/src/db/migrations/106_cfg_themes.sql`
- [ ] Add `cfg_themes` table with all columns: `id`, `tenant_id`, `name`, `base_theme`, `tokens`, `scope`, `scope_id`, `is_active`, `deleted_at`, `created_at`, `updated_at`
- [ ] Add CHECK constraints: `base_theme IN ('bold-business', 'classic')`, `scope IN ('system', 'tenant', 'business')`
- [ ] Add unique index on `(tenant_id, scope, scope_id, name) WHERE deleted_at IS NULL`
- [ ] Add lookup index on `(tenant_id, scope, scope_id) WHERE deleted_at IS NULL`
- [ ] Add RLS policy: `tenant_id = current_setting('app.current_tenant_id', true)::uuid`
- [ ] Grant SELECT, INSERT, UPDATE, DELETE to `app_user`

### 1.2 Add assignment columns and system config key
- [ ] Add `active_custom_theme_id UUID REFERENCES cfg_themes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED` to `sys_businesses`
- [ ] Add `active_custom_theme_id UUID REFERENCES cfg_themes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED` to `sys_tenants`
- [ ] Insert `theme.system_active_theme_id` key into `sys_configurations` with NULL value
- [ ] Run `npm run migrate:dev` to apply and verify

---

## 2. Shared Types

### 2.1 Theme TypeScript interfaces
- [ ] Create `packages/shared/src/types/theme.ts`
- [ ] Define: `ThemeScope`, `BuiltInThemeId`, `CfgTheme`, `ThemeListItem`, `ResolvedTheme`
- [ ] Define: `CreateThemeDto`, `UpdateThemeDto`, `ApplyThemeDto`, `ApplyThemeResponse`
- [ ] Export all types from `packages/shared/src/index.ts`

---

## 3. Backend — Built-in Theme Constants

### 3.1 Create `themeTokens.ts` service
- [ ] Create `packages/server/src/services/themeTokens.ts`
- [ ] Define `TYPOGRAPHY_TOKEN_KEYS` (11 keys) and `COLOR_TOKEN_KEYS` (18 keys) arrays of CSS custom property names; `CONFIGURABLE_TOKEN_KEYS` = their concatenation (29 keys)
- [ ] Define `BRANDING_TOKEN_KEYS` array (4 non-CSS keys: `logo-url`, `favicon-url`, `app-icon-url`, `brand-name`)
- [ ] Define `TOKEN_LABELS` map covering all 33 keys (`ConfigurableTokenKey | BrandingTokenKey`) to human-readable labels
- [ ] Define `BUILT_IN_TOKENS` with all 29 `CONFIGURABLE_TOKEN_KEYS` values for both `'bold-business'` and `'classic'` — branding keys are intentionally absent (they default to blank/inherited, never a built-in value)
- [ ] Define `BUILT_IN_THEME_LIST_ITEMS` array with the two virtual `ThemeListItem` entries (never stored in DB)
- [ ] Export `getBaseTokens(baseTheme: BuiltInThemeId): Record<string, string>` helper
- [ ] Export `stripDefaultTokens(baseTheme: BuiltInThemeId, tokens: Record<string, string>): Record<string, string>` — removes keys matching base defaults (branding keys never stripped, since they have no base default to match)

---

## 4. Backend — Theme Service

### 4.1 Implement core service logic
- [ ] Create `packages/server/src/services/theme.service.ts`
- [ ] Implement `resolveForBusiness(businessId, pool)`: three-step cascade (business FK → tenant FK → system config → Bold Business code default) per design §1.3
- [ ] Implement `listForCaller(caller, businessId, pool)`: prepend built-in entries, query cfg_themes with persona-based scope filter, mark is_active correctly
- [ ] Implement `create(body, caller, pool)`: validate name non-empty ≤100 chars, validate token keys, strip default-value tokens, INSERT; throw 409 on unique violation
- [ ] Implement `update(id, body, caller, pool)`: reject built-in string IDs with 403; UPDATE name/tokens; strip default-value tokens before storing
- [ ] Implement `softDelete(id, caller, pool)`: reject if built-in ID; reject if `is_active = true` with 409; set `deleted_at = NOW()`
- [ ] Implement `applyToScope(themeId, dto, caller, pool)`: in one transaction — clear previous active, set new active, update assignment pointer (sys_businesses / sys_tenants / sys_configurations), return resolved theme

### 4.2 Property tests for theme service
- [ ] Write property tests for cascade resolution (Properties 1, 2, 3) using fast-check
- [ ] Write property test for at-most-one-active invariant (Property 7)
- [ ] Write property test for built-in themes always present in listing (Property 4)
- [ ] Write property test for persona-scoped listing containment (Property 5)
- [ ] Write property test for token delta minimisation (Property 14)

---

## 5. Backend — Permission Middleware

### 5.1 Implement write-permission guard
- [ ] Create `packages/server/src/middleware/themePermission.ts`
- [ ] Implement `requireThemeWritePermission()`: system persona passes all; tenant persona rejects scope=system; business persona rejects scope≠business or scope_id≠caller's businessId
- [ ] Return HTTP 403 with descriptive error message on rejection

### 5.2 Property tests for permission middleware
- [ ] Write property test for business persona rejection across all non-permitted scopes (Property 8)
- [ ] Write property test for delete-permission by scope (Property 10)

---

## 6. Backend — Theme API Routes

### 6.1 Create route file and register
- [ ] Create `packages/server/src/routes/themes.ts`
- [ ] Register `GET /resolve` **before** `/:id` routes to prevent parameter collision
- [ ] Register `GET /` — calls `listForCaller`; requires JWT
- [ ] Register `POST /` — validates body, calls `create`; requires JWT + write guard
- [ ] Register `PUT /:id` — validates body, calls `update`; requires JWT + write guard
- [ ] Register `DELETE /:id` — calls `softDelete`; requires JWT + write guard
- [ ] Register `POST /:id/apply` — validates body, calls `applyToScope`; requires JWT + write guard
- [ ] Register `GET /resolve` — calls `resolveForBusiness`; **no auth**; return 400 if `business_id` missing
- [ ] Apply `tenantContext` middleware to all authenticated routes
- [ ] Register `themesRouter` in `packages/server/src/routes/index.ts` under `/v1/themes`

### 6.2 Integration tests for theme routes
- [ ] Test `POST /api/v1/themes`: happy path 201, name conflict 409, invalid base_theme 400, unknown token key 400
- [ ] Test `DELETE /api/v1/themes/:id`: active theme 409, built-in 403
- [ ] Test `POST /api/v1/themes/:id/apply`: cross-scope permission for Business/Tenant/System personas, response includes resolved tokens
- [ ] Test `GET /api/v1/themes/resolve`: missing business_id 400, unknown business_id returns Bold Business 200, unauthenticated call returns 200

### 6.3 Property tests for route layer
- [ ] Write property test for create/retrieve round trip (Property 6)
- [ ] Write property test for built-in immutability (Property 9)

---

## 7. Frontend — API Client

### 7.1 Create typed API functions
- [ ] Create `packages/client/src/api/themes.ts`
- [ ] Implement `fetchThemes(): Promise<{ themes: ThemeListItem[] }>`
- [ ] Implement `createTheme(dto: CreateThemeDto): Promise<CfgTheme>`
- [ ] Implement `updateTheme(id: string, dto: UpdateThemeDto): Promise<CfgTheme>`
- [ ] Implement `deleteTheme(id: string): Promise<void>`
- [ ] Implement `applyTheme(id: string, dto: ApplyThemeDto): Promise<ApplyThemeResponse>`
- [ ] Implement `resolveTheme(businessId: string): Promise<ResolvedTheme>`
- [ ] Use shared `apiClient` instance; add correct TypeScript return types

---

## 8. Frontend — ThemeProvider Update

### 8.1 Add resolve-on-load effect
- [ ] Update `packages/client/src/design-system/themes/ThemeProvider.tsx`
- [ ] Add `useEffect` that fires when `activeContext.businessId` changes from null to a value
- [ ] On trigger: call `resolveTheme(businessId)` from `api/themes.ts`
- [ ] On success: call `applyBaseTheme(result.base_theme)` and `applyTheme(cssVarsToThemeConfig(result.tokens))`
- [ ] On failure: call `applyBaseTheme('bold-business')` and `resetToDefault()`; log error
- [ ] Implement `cssVarsToThemeConfig()` utility that maps `'--color-primary'` keys to `ThemeConfig` shape expected by `ThemeManager.applyTheme`

### 8.2 Unit tests for ThemeProvider resolve path
- [ ] Mock `resolveTheme` to return a fixed `ResolvedTheme`; verify `applyBaseTheme` and `applyTheme` called with correct values
- [ ] Mock `resolveTheme` to throw; verify fallback to Bold Business is applied

---

## 9. Frontend — Theme Gallery Page

### 9.1 Build gallery page
- [ ] Create `packages/client/src/pages/settings/ThemeGallery.tsx` and `ThemeGallery.css`
- [ ] Fetch themes via `fetchThemes()` on mount; show loading skeleton and error state with Retry button
- [ ] Render one card per theme: name, base theme label ("Built-in" / "Custom"), colour swatch strip using `preview_tokens` (5 colours), "Active" badge if `is_active = true`
- [ ] Each card: "Apply" button (opens Apply Dialog), "Edit" button (navigates to editor — hidden on built-ins), "Delete" button (visible only for custom themes at or below caller's scope — hidden on built-ins)
- [ ] "New Theme" button in page header navigates to `/settings/themes/new`
- [ ] All styles use CSS custom properties; no hardcoded hex values

### 9.2 Unit tests for Theme Gallery
- [ ] Verify both built-in cards always render regardless of `cfg_themes` contents
- [ ] Verify "Active" badge appears on the correct card (one with `is_active = true`)
- [ ] Verify "Edit" and "Delete" buttons absent on built-in cards
- [ ] Verify "Delete" button absent on themes owned by a higher scope than the current persona

---

## 10. Frontend — Apply Theme Dialog

### 10.1 Build Apply Dialog component
- [ ] Create `packages/client/src/pages/settings/ApplyThemeDialog.tsx`
- [ ] Accept `theme: ThemeListItem` and `onClose: () => void` and `onApplied: () => void` props
- [ ] Business_Persona: single "This Business" target pre-selected, no scope selector shown
- [ ] Tenant_Persona: show scope radio (Tenant / Business); when Business selected, show business selector populated from tenant's businesses API
- [ ] System_Persona: show scope radio (System / Tenant / Business) with tenant and business selectors
- [ ] On confirm: call `applyTheme(theme.id, { scope, scope_id })`; on success show toast and call `onApplied()`
- [ ] On cancel: close dialog without any API call

### 10.2 Unit tests for Apply Dialog
- [ ] Business_Persona: only one scope option shown; no tenant/business selectors
- [ ] Tenant_Persona: two scope options shown; System scope option absent
- [ ] System_Persona: all three scope options shown
- [ ] Cancel does not call `applyTheme`

---

## 11. Frontend — Theme Editor Page

### 11.1 Build editor page
- [ ] Create `packages/client/src/pages/settings/ThemeEditor.tsx` and `ThemeEditor.css`
- [ ] Route: `/settings/themes/new` (create mode) and `/settings/themes/:id/edit` (edit mode)
- [ ] "Base Theme" select with Bold Business and Classic options; on change reload all 29 `CONFIGURABLE_TOKEN_KEYS` defaults (branding fields are unaffected by base-theme switch — they're independent of the base palette)
- [ ] Render three collapsible sections — **Typography** (11 controls: font family select, 4 size selects, 3 weight selects, 3 colour pickers), **Colors** (18 colour pickers), **Branding** (4 controls: logo/favicon/app-icon file-or-URL inputs, brand-name text input) — each control labelled via `TOKEN_LABELS`
- [ ] Live preview panel: scoped `<div>` with all 29 `CONFIGURABLE_TOKEN_KEYS` values as inline CSS properties, plus the logo/brand-name branding values rendered directly (not as CSS vars); contains sidebar strip, header bar, primary button, card, table row
- [ ] On any control change: update inline style (or preview logo/brand-name) on preview `<div>` within the React render cycle (no debounce required — synchronous)
- [ ] "Reset to Base" button: restores all Typography/Colors picker values to `BUILT_IN_TOKENS[baseTheme]` defaults; clears Branding fields to blank (branding has no base-theme default)
- [ ] "Save Theme" button: validates name non-empty and ≤ 100 chars; calls `createTheme` or `updateTheme`; on 409 shows inline error below name field; on success navigates back to gallery
- [ ] Token changes must not modify `document.documentElement` — only the preview container

### 11.2 Property tests for Theme Editor
- [ ] Write property test for preview isolation: any token change updates preview container inline style only, never `document.documentElement` (Property 12)
- [ ] Write property test for reset restores defaults: any combination of changed Typography/Colors values → reset → all equal `BUILT_IN_TOKENS[base_theme]` (Property 13)

### 11.3 Unit tests for Theme Editor
- [ ] Control count is exactly 11 (Typography) + 18 (Colors) + 4 (Branding) = 33 for both base themes
- [ ] 409 response shows inline name field error (not a toast)
- [ ] Switching base theme reloads the 29 Typography/Colors defaults but leaves Branding fields untouched

---

## 12. Frontend — ThemeManager Token Application

### 12.1 Property test for token containment
- [ ] Write property test in `packages/client/src/context/ThemeManager.test.ts`
- [ ] Generate random `ResolvedTheme` objects with valid and invalid token keys, including a mix of `CONFIGURABLE_TOKEN_KEYS` and `BRANDING_TOKEN_KEYS`
- [ ] Call `applyTheme`; assert `setProperty` is called only for keys in `CONFIGURABLE_TOKEN_KEYS`, and that `BRANDING_TOKEN_KEYS` are routed to the DOM-update path (logo/favicon/app-icon/brand-name) instead (Property 11)

---

## 13. Routing and Navigation

### 13.1 Register frontend routes and settings link
- [ ] Add routes in `packages/client/src/App.tsx`:
  - `/settings/themes` → `ThemeGallery` (protected)
  - `/settings/themes/new` → `ThemeEditor` (protected)
  - `/settings/themes/:id/edit` → `ThemeEditor` (protected)
- [ ] Add "Themes" navigation link in the Settings section — visible for Business, Tenant, and System personas
- [ ] Follow existing navigation patterns in the settings sidebar; no new navigation components

---

## 14. Final Verification

### 14.1 End-to-end smoke check
- [ ] Run all tests: `npm run test`
- [ ] Verify `GET /api/v1/themes/resolve` returns correct cascade result for a business with and without an assigned custom theme
- [ ] Verify a Business_Persona gets HTTP 403 when attempting to apply a theme at tenant scope
- [ ] Verify Bold Business and Classic cards appear in the gallery with no Edit/Delete buttons
- [ ] Verify theme token overrides appear on `document.documentElement` after apply + page reload
- [ ] Verify preview panel changes during editing do not affect the live application UI

---

## Notes

- Migration 106 is the next available number (105 is already used by `105_theme_base_and_favicon.sql`)
- Built-in themes are never stored in `cfg_themes`; they are virtual entries assembled in `themeTokens.ts`
- The `tokens` JSONB column stores only the delta (overrides versus base defaults); the resolve endpoint merges with `BUILT_IN_TOKENS` before returning
- `active_custom_theme_id` (not `active_theme_id`) avoids naming collision with the `base_theme` string column already on `sys_businesses`
- The route `/api/v1/themes/resolve` must be registered before `/:id` in the Express router
- The resolve endpoint requires no auth — it returns only CSS token values, no sensitive data
- CSS token keys use the full CSS custom property name format including `--` prefix (e.g. `'--color-primary'`); the 4 branding keys (`logo-url`, `favicon-url`, `app-icon-url`, `brand-name`) deliberately do not, since they're never passed to `style.setProperty`
- Layout/spacing tokens, per-component styling, and custom CSS injection are out of scope for this phase — see requirements.md Out of Scope
- Do NOT modify `availability.service.ts` or any booking/calendar files
