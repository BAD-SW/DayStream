# Suite 03 — System Admin (platform operators)

Persona: `system@daystream.test`. Covers specs 03 (tenants, configuration, feature flags), 24 (query editor), 31 (prospect categories, coverage map, territories), 37 (themes), and the system Reports / Processes pages added with spec 10. Platform billing has its own suite (05). Conventions: [README](../README.md).

---

### SYS-01 · Create and edit a tenant
`P0` `regression` · Spec 03 R2 · Status: Verified
1. At `/admin/tenants`, create `E2E {RUN} SysTenant` with all required fields, an owner `e2e-{RUN}-sys@daystream.test`, currency and contract start/end dates.
2. Reopen it; in the Settings tab change the name and a locale field; save.
**Expect:** the tenant window opens as a wide tabbed modal: Overview, Settings, Billing, Charge History, Audit Trail. Edits persist after reload. Required fields are enforced with inline messages.
**Cross-check:** the Audit Trail tab lists the edit with field-level from → to and the acting user.

### SYS-02 · Tenant contract dates validate
`P1` `regression` · Commit `b4c704f` · Status: Verified
1. Set a contract end date before the start date. 2. Clear the dates. 3. Set valid dates.
**Expect:** step 1 is refused; steps 2–3 follow the rules in the form (record whether dates are mandatory). The removed legacy billing fields (frequency / amount) no longer appear anywhere in the tenant window.

### SYS-03 · Suspend and re-activate a tenant
`P0` `regression` `guarded` · Spec 03 R2 · Status: Verified
**Pre:** `E2E {RUN} SysTenant` only. Never the seeded tenants.
1. Suspend from the Overview tab. 2. Try to log in as that tenant's owner. 3. Activate. 4. Log in again.
**Expect:** while suspended the owner cannot use the app (login refused or a suspended notice); after activation access returns with data intact.
**Cross-check:** Audit Trail shows one clean entry per status change (not duplicated).

### SYS-04 · Manage businesses from the system level
`P1` `regression` · Spec 03 R2 · Status: Draft
1. Using the context switcher, enter the E2E tenant; create a business; edit it; archive it.
**Expect:** the business appears, updates and is archived (not hard-deleted); archived businesses are excluded from active lists.

### SYS-05 · System users: create, edit, deactivate
`P0` `regression` · Spec 02 R4 · Status: Verified
1. At `/admin/users` create a user `e2e-{RUN}-admin@daystream.test`; change their role; deactivate/delete them.
**Expect:** list reflects each change; the deactivated user cannot log in; a system admin cannot remove their own last admin access.

### SYS-06 · Configuration tabs load and save
`P1` `regression` · Spec 03 R7 · Status: Verified
1. At `/admin/config`, open every tab (email, storage, notifications, platform billing / receiving account, payment processors, API keys, prospects, logs, query history).
2. Change one harmless value (for example a notification toggle), save, reload, then restore it.
**Expect:** every tab renders; the change persists and is restored. Secrets are shown masked and are never returned in clear by `GET /api/v1/admin/system-config/*`.

### SYS-07 · Email and storage "test" actions report honestly
`P2` `regression` · Status: Draft
1. Press the test action on the email and storage tabs.
**Expect:** a clear success or a clear, specific failure. Never a silent no-op. (Email test must target a `.test` address.)

### SYS-08 · Feature flag turns a module on and off
`P0` `regression` · Spec 03 R8 · As: system, then owner · Status: Verified
1. Record the state of `feature.events` for the demo business. Turn it on (global or per-tenant override).
2. As owner, reload: check the sidebar. 3. Turn it off; as owner reload.
4. Restore the original state.
**Expect:** the Events module appears in step 2 and disappears in step 3; with the flag off, `/events` typed directly does not expose the feature.
**Note:** the seed defines flags for memberships, packages, waitlist, online booking, loyalty points, advanced reporting and two-way SMS, but not `feature.events` / `feature.community`. If those keys do not exist, record that the modules are unreachable and treat it as a finding.

### SYS-09 · Audit log: filter, page, and trace an action
`P1` `regression` · Spec 02 R9 · Status: Verified
1. Filter the log by action type, by user, and by date range covering this run; page forward and back.
**Expect:** filters combine correctly; the entries from SYS-01 to SYS-08 are present with the right actor.

### SYS-10 · Query editor runs a read query
`P1` `regression` · Spec 24 R5–R8 · Status: Verified
1. At `/query-editor`, browse the schema; run `SELECT id, name FROM sys_tenants LIMIT 5`.
2. Save the query; reopen it from saved queries; export the result.
**Expect:** results render in a table with row count and timing; the query appears in history; the export downloads with the same rows.

### SYS-11 · Query editor refuses anything but reads
`P0` `negative` · Spec 24 R2, R4 · Status: Verified
1. Run in turn: an `UPDATE`, a `DELETE`, a `DROP TABLE`, two statements separated by `;`, a `SELECT` hiding a write (`SELECT 1; DELETE …`, a data-modifying CTE).
2. Run a deliberately heavy query (large cross join).
**Expect:** every write is rejected before execution with a clear reason and no data changes; the heavy query is stopped by the row / time limit or can be cancelled.
**Cross-check:** each attempt, including the rejected ones, is in query history and the audit log (spec 24 R11).

### SYS-12 · Query editor is closed to other personas
`P0` `negative` · Spec 24 R1 · As: owner, reception, customer · Status: Verified
1. Open `/query-editor`; call `POST /api/v1/query-editor/execute`.
**Expect:** denied in the UI and 403 from the API. (Record what a tenant owner gets: the route comment says system admin and tenant owner are allowed, tenant-scoped.)

### SYS-13 · Prospect categories CRUD
`P1` `regression` · Spec 31 R2 · Status: Verified
1. At `/admin/prospect-categories` add category `E2E {RUN} Cat` mapped to a Google Places type; edit it; delete it.
**Expect:** each change is reflected in the list.
**Cross-check:** as tenant, the category is offered as a filter on `/admin/prospects` while it exists.

### SYS-14 · Coverage map and territory assignment
`P1` `regression` · Spec 31 R1, R3; commit `31d1108` · Status: Draft
1. Open `/admin/coverage-map`. 2. Open the E2E tenant's Settings → territory; pick a territory with the territory picker; preview; save.
**Expect:** the map renders (or shows a clear "maps key missing" state, not a crash); the preview shows the territory composition before saving; after saving the map shows the tenant's coverage.
**Cross-check:** `GET /api/v1/prospects/territories/{tenantId}` returns the saved territory; overlapping an already-assigned territory is flagged.

### SYS-15 · System-level prospect generation
`P2` `regression` `needs-config` · Spec 31 R4; commit `31d1108` · Status: Draft
**Pre:** a Google Places API key is configured (Configuration → API keys). Otherwise `Blocked`.
1. For the E2E tenant, preview generation, then generate prospects for one category in its territory.
**Expect:** the preview states how many requests / results to expect before anything is spent; generation creates prospects only inside the territory; running it again does not duplicate them.

### SYS-16 · System reports and processes pages
`P1` `regression` · Spec 10 task 2.6; commit `7f15b06` · Status: Verified
1. Open `/admin/system-reports`; run each report in the catalog with a date range.
2. Open `/admin/processes`; view the Platform Billing Run schedule; change the run time; save; restore.
**Expect:** every catalogued report opens in the runner and returns rows or an explicit empty state; the schedule saves and there is still exactly one platform schedule row afterwards.
**Cross-check:** `GET /api/v1/pay/platform-billing-schedule` returns the saved time and timezone.

### SYS-17 · Themes: list, apply, protect built-ins
`P2` `regression` · Spec 37 R1, R2, R6 · Status: Verified
1. `GET /api/v1/themes`; apply a different theme through the UI if a theme gallery exists (otherwise through the system-theme setting in Configuration); reload; restore.
2. Try to delete a built-in theme.
**Expect:** the applied theme changes the UI tokens after reload and is restored; built-in themes cannot be deleted.
