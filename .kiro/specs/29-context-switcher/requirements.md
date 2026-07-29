# Requirements Document

## Introduction

DayStream users who hold elevated personas (system, tenant) currently see only the view that matches their persona after login. Some users legitimately need to drill down into lower-level contexts — a system admin inspecting a specific tenant, or a tenant owner reviewing one of their businesses — without logging out and back in. The Context Switcher provides a persistent UI control that lets authorised users change their **active context** (which tenant or business they are currently scoped to) while keeping their persona and JWT-derived permissions unchanged.

Context switching is scope narrowing, not privilege escalation. A system admin who enters a business context still carries system-level permissions; the switch changes only which data scope the UI renders and which `business_id` is attached to outbound API requests.

## Glossary

- **Persona**: The fixed access tier assigned to a user at account creation and encoded in the JWT (`system` | `tenant` | `business` | `customer`). Immutable during a session.
- **Context**: The active data scope a user is currently viewing. Can be narrowed from the user's default persona scope to a specific tenant or business without re-authentication.
- **Context_Manager**: The React context provider responsible for tracking, persisting, and updating the active context and exposing it to all consumers.
- **Context_Switcher_Component**: The UI dropdown control in the app header that lists accessible contexts and triggers context switches.
- **Context_Breadcrumb**: The read-only path display in the header showing the full hierarchy of the active context (e.g. `DayStream › Transcend Health › Transcend Mallorca`).
- **Module_Registry**: The module registry (`moduleRegistry.ts`) that maps modules to personas and permissions; extended to also filter by active context level.
- **API_Client**: The shared Axios instance (`packages/client/src/api/client.ts`) used for all API calls; extended to inject context scope identifiers.
- **Theme_Manager**: The subsystem responsible for applying CSS custom property overrides based on the active context's branding configuration.
- **contextLevel**: The tier of the currently active context: `system`, `tenant`, or `business`.
- **tenantId**: The UUID of the tenant currently in scope; `null` when contextLevel is `system`.
- **businessId**: The UUID of the business currently in scope; `null` when contextLevel is `system` or `tenant`.
- **Accessible Contexts List**: The set of context targets a user is permitted to switch into, loaded from authenticated API endpoints and enforced server-side.
- **Permission Escalation**: Gaining access to actions or data beyond what the JWT role grants. The Context Switcher must never cause permission escalation.

## Goals

- Allow users to switch active context (tenant / business scope) without re-authentication
- Render the correct theme, branding, and module set for the active context
- Attach the correct scope identifiers (`tenant_id`, `business_id`) to all API requests when context changes
- Display the current context in a permanent breadcrumb so users always know where they are
- Never allow a context switch to expand the user's permissions beyond what the JWT grants
- Follow DayStream's CSS-variable design system and WCAG 2.1 AA accessibility requirements

## Requirements

---

### Requirement 1: Context State Model

**User Story:** As a multi-context user, I want the application to maintain a clear concept of my active context so that every screen I see reflects the correct scope.

#### Acceptance Criteria

1. THE Context_Manager SHALL define an active context record containing: `contextLevel` (one of `system` | `tenant` | `business`), `tenantId` (nullable), `businessId` (nullable), and `displayName`.
2. THE Context_Manager SHALL initialise the active context from the JWT persona on every login: system persona defaults to `contextLevel: "system"`; tenant persona defaults to `contextLevel: "tenant"` with `tenantId` from the token; business persona defaults to `contextLevel: "business"` with `tenantId` and `businessId` from the token.
3. WHEN the active context is updated, THE Context_Manager SHALL persist the new context to `sessionStorage` so that a page refresh within the same session restores the last active context.
4. IF the stored session context references a `tenantId` or `businessId` that is not present in the user's accessible contexts list, THEN THE Context_Manager SHALL discard the stored context and fall back to the persona default.
5. THE Context_Manager SHALL expose the active context as a React context value consumable by any descendant component without prop drilling.

---

### Requirement 2: Accessible Contexts List

**User Story:** As a system admin or tenant owner, I want the application to know which contexts I am allowed to switch into so that only valid targets appear in the switcher.

#### Acceptance Criteria

1. WHEN a user with `system` persona is authenticated, THE Context_Manager SHALL load all tenants from `GET /api/v1/admin/tenants` as the list of switchable tenant contexts.
2. WHEN a user with `system` persona has an active `tenantId`, THE Context_Manager SHALL load all businesses under that tenant from `GET /api/v1/admin/businesses` as the list of switchable business contexts.
3. WHEN a user with `tenant` persona is authenticated, THE Context_Manager SHALL load all businesses belonging to their token `tenant_id` from `GET /api/v1/admin/businesses` as the list of switchable business contexts.
4. WHEN a user with `business` persona is authenticated, THE Context_Manager SHALL present an empty switchable list because business-persona users cannot switch to other contexts.
5. IF an API call to load the accessible contexts list fails, THEN THE Context_Manager SHALL retain the currently active context and display a non-blocking error notification rather than logging the user out.
6. THE Context_Manager SHALL re-fetch the accessible contexts list after any context switch to ensure the downstream list reflects the newly active scope.

---

### Requirement 3: Context Switcher UI Component

**User Story:** As a multi-context user, I want a persistent, discoverable control in the app header so that I can view and change my active context at any time.

#### Acceptance Criteria

1. THE Context_Switcher_Component SHALL render in the top-left area of the `AppLayout` header, positioned immediately to the right of the sidebar toggle button and before the DayStream wordmark.
2. THE Context_Switcher_Component SHALL display the active context's display name and a chevron-down icon when closed.
3. WHEN the active context is `system`-level, THE Context_Switcher_Component SHALL display the DayStream platform name and a platform icon as the display name.
4. WHEN a user clicks the Context_Switcher_Component trigger, THE Context_Switcher_Component SHALL open a dropdown panel listing all accessible contexts grouped by hierarchy level (System, Tenants, Businesses).
5. WHEN a user with `business` persona views the Context_Switcher_Component, THE Context_Switcher_Component SHALL render as a static non-interactive label showing only the current business name without a dropdown.
6. WHEN a user selects a context entry from the dropdown, THE Context_Switcher_Component SHALL close the dropdown and invoke the context switch operation.
7. THE Context_Switcher_Component SHALL close the dropdown when the user clicks outside the component or presses the Escape key.
8. THE Context_Switcher_Component SHALL indicate the currently active context entry within the dropdown with a visual highlight distinct from hover state.
9. THE Context_Switcher_Component SHALL be keyboard navigable: Tab to focus the trigger, Enter/Space to open, arrow keys to move between options, Enter to select, Escape to close.
10. THE Context_Switcher_Component SHALL comply with WCAG 2.1 AA: minimum 4.5:1 text contrast ratio, visible focus indicators, and ARIA roles (`role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-activedescendant`).
11. WHERE a context entry has an associated logo or avatar, THE Context_Switcher_Component SHALL render it alongside the display name at 24×24px.

---

### Requirement 4: Context Breadcrumb

**User Story:** As a multi-context user, I want a persistent breadcrumb trail in the header so that I always know which scope I am currently viewing.

#### Acceptance Criteria

1. THE Context_Breadcrumb SHALL render in the `AppLayout` header, directly following the Context_Switcher_Component.
2. THE Context_Breadcrumb SHALL display the full ancestry path of the active context using the format: `DayStream` for system level; `DayStream › {TenantName}` for tenant level; `DayStream › {TenantName} › {BusinessName}` for business level.
3. WHEN the active context is the user's default persona context (no switch has occurred), THE Context_Breadcrumb SHALL still display the appropriate path so users always see their current scope.
4. WHEN the user's persona is `business`, THE Context_Breadcrumb SHALL display only the business name segment without ancestor links, because system and tenant context navigation is not available to that persona.
5. THE Context_Breadcrumb SHALL truncate segment labels exceeding 24 characters with an ellipsis and display the full name in a tooltip on hover/focus.
6. THE Context_Breadcrumb SHALL not render on screen widths below 640px; on those viewports the active context display name on the Context_Switcher_Component trigger is sufficient.

---

### Requirement 5: Context Switch Operation

**User Story:** As a multi-context user, I want the application to update all relevant state atomically when I switch context so that I never see a mix of data from two different contexts.

#### Acceptance Criteria

1. WHEN a context switch is initiated, THE Context_Manager SHALL update the active context record, clear any cached context-specific data (module visibility list, theme overrides, pending API results scoped to the previous context), and then trigger a re-render of all consumers before any new API requests are dispatched.
2. WHEN switching to a `tenant` context, THE Context_Manager SHALL set `businessId` to `null` in the active context record.
3. WHEN switching to a `business` context, THE Context_Manager SHALL set both `tenantId` and `businessId` in the active context record.
4. WHEN switching back to the `system` context, THE Context_Manager SHALL set both `tenantId` and `businessId` to `null` in the active context record.
5. THE Context_Manager SHALL redirect the user to `/dashboard` after every context switch so they land on a context-appropriate entry point rather than a potentially invalid prior route.
6. WHEN a context switch is in progress, THE Context_Switcher_Component SHALL render a loading indicator on the trigger button and disable further interaction until the switch completes.
7. IF a context switch operation fails (e.g. network error during data reload), THEN THE Context_Manager SHALL revert to the previous active context and display a descriptive error message.

---

### Requirement 6: Module Registry Filtering by Context

**User Story:** As a multi-context user, I want the sidebar to show only the modules relevant to my active context so that the navigation is not cluttered with inaccessible routes.

#### Acceptance Criteria

1. THE Module_Registry SHALL be filtered by both the user's JWT persona and the active context level; a system-persona user viewing a `business` context SHALL see business-level modules scoped to their system permissions, not system-level admin modules.
2. WHEN the active context is `system`-level, THE Module_Registry SHALL expose system-persona modules only.
3. WHEN the active context is `tenant`-level (regardless of JWT persona), THE Module_Registry SHALL expose tenant-level modules only.
4. WHEN the active context is `business`-level (regardless of JWT persona), THE Module_Registry SHALL expose business-level modules only.
5. THE Module_Registry filter function SHALL continue to apply permission checks from the JWT; a system admin entering a business context does not automatically receive all business permissions that exceed what their JWT role grants.
6. WHEN the active context changes, THE Module_Registry SHALL recompute visible modules synchronously before the dashboard re-renders to prevent a flash of incorrect navigation items.

---

### Requirement 7: Context-Aware API Requests

**User Story:** As a developer building features on DayStream, I want all API requests to automatically carry the correct scope identifiers for the active context so that data isolation is never broken by context switching.

#### Acceptance Criteria

1. THE API_Client SHALL read `businessId` from the active context and attach it as the `business_id` query parameter (or request body field, per each endpoint's existing contract) on every request that targets a business-scoped endpoint.
2. THE API_Client SHALL read `tenantId` from the active context and ensure the outgoing `tenant_id` JWT claim still matches the token; if they diverge (e.g. system admin entered a different tenant context), THE API_Client SHALL include an `X-Context-Tenant-Id` request header containing the active context `tenantId`.
3. WHEN the active context changes, THE API_Client SHALL apply the new context identifiers to all subsequent requests without requiring a page reload.
4. THE API_Client SHALL NOT fall back to a stored `business_id` from `localStorage` when a context is active; the Context_Manager is the single source of truth for scope identifiers while a session is active.
5. IF a request is dispatched before the Context_Manager has finished initialising the active context, THEN THE API_Client SHALL queue the request until initialisation completes rather than sending it with missing scope identifiers.

---

### Requirement 8: Context-Aware Theming

**User Story:** As a user switching into a business context, I want the application's visual theme to reflect that business's branding so that I immediately have a visual confirmation of which context I am in.

#### Acceptance Criteria

1. THE Theme_Manager SHALL apply the CSS custom property overrides for the active context immediately after a context switch completes.
2. WHEN the active context is `system`-level, THE Theme_Manager SHALL apply the DayStream platform default theme (`--color-primary`, `--color-accent`, etc.) at the `:root` element.
3. WHEN the active context is `tenant`-level, THE Theme_Manager SHALL apply the tenant's theme overrides from the tenant configuration record; WHERE no tenant theme is configured, THE Theme_Manager SHALL fall back to the DayStream platform default theme.
4. WHEN the active context is `business`-level, THE Theme_Manager SHALL apply the business's theme overrides; WHERE no business theme is configured, THE Theme_Manager SHALL fall back to the parent tenant's theme; WHERE no tenant theme is configured, THE Theme_Manager SHALL fall back to the DayStream platform default theme.
5. THE Theme_Manager SHALL transition between themes within 250ms using the standard DayStream animation easing `cubic-bezier(0.4, 0, 0.2, 1)` while respecting the user's `prefers-reduced-motion` setting.
6. THE Theme_Manager SHALL NOT modify user-selected light/dark mode preference when applying context theme overrides; the two controls are independent.

---

### Requirement 9: Permission Enforcement on Context Switch

**User Story:** As a security-conscious platform operator, I want to guarantee that no context switch can grant a user access to data or actions beyond what their JWT permits so that the context switcher cannot be weaponised for privilege escalation.

#### Acceptance Criteria

1. THE Context_Manager SHALL derive switchable context targets exclusively from authenticated API responses whose authorisation is enforced server-side; the client SHALL NOT construct context switch targets by manipulating local state directly.
2. WHEN a user initiates a context switch, THE Context_Manager SHALL verify that the target context entry exists in the currently loaded accessible contexts list before proceeding; IF the target is not in the list, THEN THE Context_Manager SHALL reject the switch and log a warning.
3. THE Context_Manager SHALL NOT modify, replace, or re-issue the JWT during a context switch; permissions remain those encoded in the original token for the duration of the session.
4. THE server-side API endpoints SHALL enforce authorisation using the JWT's `role` and `tenant_id` claims independent of any context header sent by the client; context headers are treated as hints for data scoping, not as authority grants.
5. WHEN a system admin enters a business context, THE Module_Registry SHALL not surface modules gated by business-specific permissions that the system admin's JWT role does not include.
6. THE Context_Manager SHALL record each context switch event to the client-side audit trail with: timestamp, user ID, previous context, new context; this trail SHALL be accessible for server-side audit log correlation.

---

### Requirement 10: Context Persistence Across Navigation

**User Story:** As a multi-context user navigating between pages, I want my active context to remain stable so that I do not have to re-select my context every time I move to a different route.

#### Acceptance Criteria

1. THE Context_Manager SHALL preserve the active context across in-app route changes; a navigation event SHALL NOT reset the active context.
2. WHEN the user performs a hard page reload, THE Context_Manager SHALL restore the active context from `sessionStorage` within the same browser session before rendering any context-dependent UI.
3. WHEN the user opens a new browser tab or window, THE Context_Manager SHALL initialise to the persona default context for that new tab; `sessionStorage` is tab-isolated and SHALL NOT be shared across tabs.
4. THE Context_Manager SHALL clear the active context from `sessionStorage` on logout and set the active context to `null`.
5. WHEN a deep-link URL is opened (e.g. bookmarked or shared link to `/customers`), THE Context_Manager SHALL validate that the restored context permits access to the requested route before rendering; IF the context is invalid or absent, THE Context_Manager SHALL redirect to `/login`.

---

## Dependencies

- `AuthContext` — Provides JWT-derived persona, role, and base `tenant_id`; the Context_Manager wraps or composes the AuthContext
- `moduleRegistry.ts` — Must expose a context-aware variant of `getVisibleModules` that accepts `contextLevel` in addition to persona and permissions
- `AppLayout.tsx` — Must be updated to render the Context_Switcher_Component and Context_Breadcrumb in the header
- `apiClient` — Must be updated to read scope identifiers from the Context_Manager rather than directly from localStorage
- Tenant configuration API (`GET /api/v1/admin/tenants/:id`) — Must return theme override tokens for tenant-level theming
- Business configuration API (`GET /api/v1/admin/businesses/:id`) — Must return theme override tokens for business-level theming

## Success Criteria

- A system admin can navigate into any tenant context and then into any business under that tenant without logging out
- A tenant owner can switch between their businesses and the sidebar, data, and branding update immediately to reflect the selected business
- A business-persona user sees no context switcher and experiences no change in behaviour
- Switching context never returns data belonging to a context the user did not select
- Switching context never exposes actions or modules that the user's JWT role does not permit
- The breadcrumb always accurately reflects the active scope hierarchy
- All interactive elements in the Context_Switcher_Component are keyboard-navigable and screen-reader-accessible
- Theme transitions occur within 250ms and respect `prefers-reduced-motion`

## Out of Scope

- Granting new permissions via context switch — permissions are always JWT-derived
- Persistent cross-session context memory (context resets to persona default on new session / new tab)
- Business Group layer — the hierarchy is strictly System → Tenant → Business; no intermediate grouping
- Customer-persona context switching — customers are scoped to a single business and have no context to switch
- Server-side context impersonation tokens — no new JWTs are issued during a context switch

## Notes

- The `business_id` currently stored in `localStorage` is the legacy mechanism. Once the Context_Manager is live, all context-scoped reads should come from the Context_Manager; the localStorage key should be treated as a migration shim only and removed in a follow-up cleanup task.
- The server must never trust client-supplied context headers as authority. The `X-Context-Tenant-Id` header is for data scoping only; all security enforcement remains in the JWT middleware.
- Context switching UX is intentionally modelled after Slack workspaces and GitHub organisation switchers — familiar patterns reduce learning curve.

---

**Status**: 📋 Planned
**Dependencies**: Phase 03 (Core Platform — Auth), Phase 04 (Design System)
**Next Phase**: Design → Tasks
