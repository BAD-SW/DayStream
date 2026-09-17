# Requirements Document

## Introduction

The Theme Setup module gives authorised personas the ability to view, select, customise, and apply themes in DayStream. Themes are scoped to three levels — System, Tenant, and Business — and resolve through an inheritance chain so that each level can override the level above, or fall back to it when no override is set. Two built-in themes (Bold Business and Classic) are code-defined and ship as read-only defaults. Users can save named custom themes on top of any built-in. The active theme is resolved at app load for every business and applied as CSS custom properties with no page refresh required.

## Glossary

- **Theme_Setup_Module**: The feature described in this document — UI and backend for viewing, selecting, customising, and applying themes
- **Theme_Gallery**: The UI page that lists all available themes (built-ins + saved custom themes) with previews
- **Theme_Editor**: The UI panel where a user customises colour tokens on top of a base theme and saves the result as a named custom theme
- **Apply_Dialog**: The modal or inline form shown when a user clicks Apply on a theme, where they choose the scope level at which to apply it
- **Theme_Resolver**: The backend service that determines the active theme for a given business by walking the inheritance chain (business → tenant → system)
- **Resolve_Endpoint**: The API endpoint (`GET /api/v1/themes/resolve`) called at app load to return the active theme token set for the current business
- **Built_In_Theme**: A theme defined in code (not a database record) — currently Bold Business and Classic. Read-only; cannot be deleted or modified
- **Custom_Theme**: A theme created by a user in the Theme_Editor, saved as a row in `cfg_themes`
- **cfg_themes**: The database table that stores custom and applied theme configuration records
- **Token_Set**: The collection of values that define a theme's visual appearance, grouped into Typography (~11 tokens: font family, per-role font sizes, font weights, text colors), Colors (~18 CSS custom properties), and Branding (~4 non-CSS values — logo/favicon/app-icon URLs and a brand-name override, applied via DOM updates rather than `style.setProperty`)
- **Scope**: The organisational level at which a theme is applied — one of `system`, `tenant`, or `business`
- **Scope_ID**: The UUID identifying the entity at a given scope (`system` has no scope_id; `tenant` uses `tenant_id`; `business` uses `business_id`)
- **Inheritance_Chain**: The ordered lookup used during resolution — business override → tenant override → system default → code-default (Bold Business)
- **System_Persona**: A DayStream platform admin; can manage themes at all scopes
- **Tenant_Persona**: A tenant owner/manager; can manage themes for their tenant and all businesses under it
- **Business_Persona**: A business owner/manager/staff; can manage themes for their own business only
- **Bold_Business**: The built-in professional blue SaaS theme (spec 35) — the platform default
- **Classic**: The built-in warm gold/ivory theme (spec 36)
- **Preview_Panel**: The live preview shown in the Theme_Editor as token values are adjusted
- **WCAG_AA**: Web Content Accessibility Guidelines 2.1 Level AA — minimum 4.5:1 contrast ratio for normal body text

---

## Requirements

### Requirement 1: Theme Gallery

**User Story:** As a user with theme management permissions, I want to see all available themes in a gallery with previews, so that I can choose a theme to apply or customise.

#### Acceptance Criteria

1. THE Theme_Gallery SHALL display all Built_In_Themes and all Custom_Themes saved at or above the user's current scope as selectable cards
2. WHEN a theme card is displayed, THE Theme_Gallery SHALL show a thumbnail preview, the theme name, a source label ("Built-in" or "Custom"), and two action buttons: "Apply" and "Customize"
3. THE Theme_Gallery SHALL mark the currently active theme for the user's current business scope with a visible "Active" indicator on its card
4. WHEN a Business_Persona views the Theme_Gallery, THE Theme_Gallery SHALL display Built_In_Themes and all Custom_Themes saved at the business, tenant, or system scope — but SHALL NOT show a "Delete" action for Custom_Themes owned by a higher scope
5. WHEN a Tenant_Persona views the Theme_Gallery, THE Theme_Gallery SHALL display Built_In_Themes and all Custom_Themes saved at the tenant or system scope
6. WHEN a System_Persona views the Theme_Gallery, THE Theme_Gallery SHALL display all Built_In_Themes and all Custom_Themes across all scopes
7. THE Theme_Gallery SHALL NOT display a "Delete" button on any Built_In_Theme card
8. THE Theme_Gallery SHALL display a "Delete" button only on Custom_Theme cards that were created at or below the user's highest permitted scope

---

### Requirement 2: Theme Selection and Application

**User Story:** As a user with theme management permissions, I want to apply a theme at a specific scope level, so that the selected theme becomes active for the businesses at that level.

#### Acceptance Criteria

1. WHEN a user clicks "Apply" on a theme card, THE Apply_Dialog SHALL open showing a scope selector with only the scope levels the user has permission to manage
2. WHEN a Business_Persona opens the Apply_Dialog, THE Apply_Dialog SHALL show only their own business as a selectable scope target
3. WHEN a Tenant_Persona opens the Apply_Dialog, THE Apply_Dialog SHALL show their tenant level and each business under their tenant as selectable scope targets
4. WHEN a System_Persona opens the Apply_Dialog, THE Apply_Dialog SHALL show system level, all tenants, and all businesses as selectable scope targets
5. WHEN a user confirms a theme application, THE Theme_Setup_Module SHALL write a record to `cfg_themes` with the selected theme id, the selected scope, and the scope_id
6. WHEN a theme is applied at a scope, THE Theme_Setup_Module SHALL set any previously active theme record at that same scope to inactive
7. WHEN a theme application is saved, THE Theme_Setup_Module SHALL return the resolved Token_Set for the affected business without requiring a full page reload
8. IF the user cancels the Apply_Dialog without confirming, THEN THE Theme_Setup_Module SHALL make no changes to `cfg_themes`

---

### Requirement 3: Theme Customisation

**User Story:** As a user with theme management permissions, I want to create a custom theme by adjusting colour tokens on top of a base theme, so that I can match the platform's appearance to my brand.

#### Acceptance Criteria

1. WHEN a user clicks "Customize" on a theme card, THE Theme_Editor SHALL open with that theme pre-loaded as the base theme
2. THE Theme_Editor SHALL present a labelled control for each configurable token in the Token_Set, grouped into three sections — Typography, Colors, and Branding — at minimum:
   - **Typography**: `font-family` (curated list), `font-size-title`, `font-size-subtitle`, `font-size-body`, `font-size-small`, `font-weight-normal`, `font-weight-medium`, `font-weight-bold`, `color-text-title`, `color-text-body`, `color-text-muted`
   - **Colors**: `color-primary`, `color-primary-hover`, `color-primary-contrast`, `color-secondary`, `color-secondary-hover`, `color-secondary-contrast`, `color-background`, `color-surface`, `color-border`, `color-divider`, `color-sidebar-bg`, `color-header-bg`, `color-nav-active-bg`, `color-nav-active-text`, `color-accent`, and (optional, off by default) `color-success`, `color-warning`, `color-error`
   - **Branding**: `logo-url`, `favicon-url`, `app-icon-url`, `brand-name` (overrides the displayed product name; blank means "use the platform/tenant name")
3. WHEN a user changes a token value in the Theme_Editor, THE Preview_Panel SHALL update to reflect the new value within 100ms without requiring any save action
4. THE Preview_Panel SHALL display a representative sample of the application UI including at minimum: sidebar, top bar, a card, a button, and a data table row
5. WHEN a user saves a custom theme, THE Theme_Editor SHALL require a non-empty, unique-within-scope theme name before saving
6. WHEN a user saves a custom theme, THE Theme_Setup_Module SHALL persist the custom theme to `cfg_themes` with the base theme id, all modified token values in a JSONB `tokens` column, the theme name, and the target scope
7. IF a user attempts to save a Custom_Theme with a name that already exists at their target scope, THEN THE Theme_Editor SHALL display a validation error and SHALL NOT save
8. THE Theme_Editor SHALL provide a "Reset to Base" action that restores all token pickers to the base theme's values
9. WHEN a user saves an edit to an existing Custom_Theme, THE Theme_Setup_Module SHALL update the existing `cfg_themes` record rather than inserting a new row
10. THE Theme_Editor SHALL NOT allow modifications to Built_In_Theme token values — the "Customize" action on a Built_In_Theme always creates a new Custom_Theme based on it

---

### Requirement 4: Theme Inheritance Resolution

**User Story:** As a developer, I want the active theme for any business to be resolved consistently from the inheritance chain at app load, so that theme overrides at each level are respected without manual configuration per page.

#### Acceptance Criteria

1. THE Theme_Resolver SHALL resolve the active Token_Set for a business by checking, in order: a business-level override in `cfg_themes` → a tenant-level override in `cfg_themes` → a system-level override in `cfg_themes` → the Bold_Business built-in code default
2. WHEN a business has an active theme record in `cfg_themes`, THE Theme_Resolver SHALL return that theme's Token_Set without consulting higher scope records
3. WHEN a business has no active theme record but its tenant does, THE Theme_Resolver SHALL return the tenant's active theme Token_Set
4. WHEN neither the business nor its tenant has an active theme record, THE Theme_Resolver SHALL check for a system-level active theme record and return it if present
5. WHEN no active theme record exists at any scope, THE Theme_Resolver SHALL return the Bold_Business built-in Token_Set
6. THE Resolve_Endpoint SHALL accept a `business_id` query parameter and return the resolved Token_Set as a JSON object mapping CSS custom property names to their values
7. THE Resolve_Endpoint SHALL return a response within 200ms under normal database load
8. THE Resolve_Endpoint SHALL be callable without authentication for public-facing pages that need theming before login
9. WHEN the Resolve_Endpoint is called with an invalid or unknown `business_id`, THE Resolve_Endpoint SHALL return the Bold_Business built-in Token_Set as the safe default

---

### Requirement 5: Permission Enforcement

**User Story:** As a platform operator, I want theme management actions to be restricted by persona, so that users cannot modify theme settings beyond their permitted scope.

#### Acceptance Criteria

1. THE Theme_Setup_Module SHALL reject any theme write request (apply, create, update, delete) from a Business_Persona that targets a scope other than that user's own `business_id`
2. THE Theme_Setup_Module SHALL reject any theme write request from a Tenant_Persona that targets a scope outside that user's `tenant_id` or the businesses under it
3. WHEN a System_Persona submits a theme write request, THE Theme_Setup_Module SHALL permit writes at system, tenant, or business scope without restriction
4. THE Theme_Setup_Module SHALL return HTTP 403 for any write request that violates scope permission rules
5. WHEN a Business_Persona loads the Theme_Gallery, THE Theme_Setup_Module SHALL return only themes relevant to that business — it SHALL NOT expose theme records belonging to other businesses or tenants
6. THE Theme_Setup_Module SHALL validate the `scope` and `scope_id` of every write request against the authenticated user's JWT claims before executing any database operation

---

### Requirement 6: Built-in Theme Protection

**User Story:** As a platform operator, I want the two built-in themes to be permanently available and unmodifiable, so that users always have a reliable baseline to fall back to.

#### Acceptance Criteria

1. THE Theme_Setup_Module SHALL define Bold_Business and Classic as code-defined constants — neither SHALL be stored as rows in `cfg_themes`
2. WHEN a user attempts to delete Bold_Business or Classic, THE Theme_Setup_Module SHALL return an error and SHALL NOT modify any data
3. WHEN a user attempts to edit the token values of Bold_Business or Classic directly, THE Theme_Setup_Module SHALL reject the request and SHALL NOT modify any data
4. THE Theme_Gallery SHALL always display Bold_Business and Classic regardless of the contents of `cfg_themes`
5. WHEN all custom themes are deleted from a scope, THE Theme_Resolver SHALL still resolve a valid Token_Set by falling back through the Inheritance_Chain to the Bold_Business built-in default
6. THE built-in theme code definitions SHALL serve as the authoritative source of token values for Bold_Business and Classic — the `cfg_themes` table SHALL NOT contain canonical rows for them

---

### Requirement 7: Database Persistence

**User Story:** As a developer, I want custom theme data and scope-level theme assignments persisted in a dedicated table, so that theme configuration survives server restarts and is queryable per scope.

#### Acceptance Criteria

1. THE Theme_Setup_Module SHALL use a `cfg_themes` table with at minimum the following columns: `id UUID`, `tenant_id UUID NOT NULL`, `business_id UUID` (nullable for system/tenant-scope records), `scope VARCHAR NOT NULL` (values: `system`, `tenant`, `business`), `scope_id UUID` (nullable for system scope), `base_theme_id VARCHAR NOT NULL` (references the built-in theme id or a parent custom theme id), `name VARCHAR NOT NULL`, `tokens JSONB NOT NULL`, `is_active BOOLEAN NOT NULL DEFAULT FALSE`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`
2. THE `cfg_themes` table SHALL have a unique constraint on `(tenant_id, scope, scope_id, name)` to prevent duplicate theme names within a scope
3. THE `cfg_themes` table SHALL enforce Row-Level Security via `tenant_id` consistent with all other DayStream tables
4. THE Theme_Setup_Module SHALL use raw SQL via the `pg` driver for all database operations — no ORM
5. WHEN a theme is set as active at a scope, THE Theme_Setup_Module SHALL execute an atomic operation that sets `is_active = FALSE` on all other records at that scope before setting `is_active = TRUE` on the target record
6. THE `tokens` JSONB column SHALL store only the token keys and values that differ from the base theme — not the full Token_Set — to keep records minimal
7. THE `cfg_themes` migration file SHALL follow the project naming convention (`NNN_cfg_themes.sql`) using the next available migration number

---

### Requirement 8: CSS Variable Application

**User Story:** As a developer, I want the resolved theme applied as CSS custom properties on the document root, so that all components pick up theme values without any component-level changes.

#### Acceptance Criteria

1. WHEN the Resolve_Endpoint returns a Token_Set, THE Theme_Setup_Module frontend code SHALL apply each Typography and Colors token as a CSS custom property on `document.documentElement` using `style.setProperty`, and SHALL apply each Branding token via direct DOM update (logo `<img src>`, favicon `<link href>`, app-icon manifest entry, brand-name text nodes) rather than as a CSS variable
2. THE Theme_Setup_Module SHALL apply theme tokens by merging them onto the active `data-theme` base — it SHALL NOT replace the `data-theme` attribute
3. WHEN the Theme_Editor preview is active, THE Preview_Panel SHALL apply token overrides to a scoped container element rather than `document.documentElement`, so that the rest of the application UI is not affected during editing
4. THE Theme_Setup_Module SHALL apply theme tokens before the first meaningful paint on page load to prevent a flash of unstyled content
5. WHEN theme tokens are applied, THE Theme_Setup_Module SHALL not alter any token outside the defined configurable Token_Set — system tokens (semantic colours, spacing, typography) SHALL remain unchanged unless explicitly included in the theme's token record

---

## Dependencies

- Spec 35 (Bold Business Theme): Provides the `bold-business` CSS theme, JSON token schema, and `ThemeProvider.tsx` architecture that this module builds on
- Spec 36 (Classic Theme): Provides the `classic` CSS theme and confirms the two built-in themes available at launch
- Project auth/JWT middleware: `tenant_id` and persona are required from JWT claims for all permission checks
- `ContextManager.tsx`: Provides `activeContext.businessId` used to call the Resolve_Endpoint at app load

## Success Criteria

- Theme_Gallery renders both built-in themes and any saved custom themes, with correct "Active" indicator for the current business
- Apply_Dialog shows only scope levels the current persona is permitted to manage
- Saving a custom theme persists to `cfg_themes` and is immediately visible in the gallery
- The Resolve_Endpoint correctly returns the business-level theme when set, falls back to tenant, then system, then Bold_Business default
- A Business_Persona receives HTTP 403 when attempting to apply a theme at tenant or system scope
- Bold_Business and Classic cannot be deleted or have their tokens modified via any API call
- All token overrides are applied as CSS custom properties; no component files contain hardcoded colour values
- Resolve_Endpoint responds within 200ms

## Out of Scope

- Theming the customer-facing booking portal — this module covers the admin UI only
- Layout and spacing tokens — border radius, spacing scale, card style (flat/elevated), button shape (rounded/pill/square). Deferred to a future phase; these carry more risk of breaking layout integrity than typography/color/branding tokens
- Per-component styling beyond the colour tokens listed in Requirement 3.2 — e.g. navbar height, sidebar collapsed/expanded behaviour, table zebra-stripe toggles. Deferred to a future phase
- Custom CSS injection — deferred; would need a sandboxing story before it's safe to expose
- Automated theme accessibility scoring — WCAG contrast checking is the author's responsibility when creating custom themes
- Rollback or version history for theme changes
- Theme import/export as downloadable files
- Per-location theme overrides (business is the finest scope in this spec)
- Modifying `availability.service.ts` or any booking/calendar logic

## Notes

- Built-in themes are identified by string IDs (`"bold-business"`, `"classic"`) in the code constants; `cfg_themes.base_theme_id` stores these same string IDs for custom themes derived from them
- The Resolve_Endpoint is deliberately unauthenticated so public-facing pages can load themed content before login; it returns only CSS token values — no sensitive data
- The `tokens` JSONB column stores a diff (only overridden keys), not a full snapshot, to keep the schema forward-compatible as new tokens are added to the base themes
- The Theme_Editor "Customize" action on a Built_In_Theme always produces a new Custom_Theme — it never modifies the built-in's code definition
- Applying a theme at tenant scope does NOT retroactively overwrite existing business-level overrides; inheritance resolution is computed at query time, not stored

---

**Status**: 📋 Planned
**Dependencies**: Spec 35 (Bold Business Theme), Spec 36 (Classic Theme)
**Next Phase**: Design (design.md)
