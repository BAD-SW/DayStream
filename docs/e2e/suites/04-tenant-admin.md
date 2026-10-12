# Suite 04 — Tenant Admin (portfolio of businesses)

Persona: `tenant@daystream.test`. Covers spec 03 (businesses, users), spec 31 (prospects), the tenant Reports / Processes / Settings pages. Billing of businesses by the tenant is in suite 05. Conventions: [README](../README.md).

Reminder: in the tenant UI, "customers" are **businesses**.

---

### TEN-01 · Create a business with its owner
`P0` `regression` · Spec 03 R2 · Status: Draft
1. At `/admin/businesses` create `E2E {RUN} Biz` with owner `e2e-{RUN}-bizowner@daystream.test`, currency, timezone.
**Expect:** the business appears as active. Its window is a wide tabbed modal: Overview, Settings, Billing, Charge History, Audit Trail.
**Cross-check:** the owner can log in, lands in that business, and exists as a staff member there; the business has default accepted payment methods (KI-6).

### TEN-02 · Edit business settings and appearance
`P1` `regression` · Status: Draft
1. In the Settings tab change name, contact details and timezone; upload a logo.
**Expect:** changes persist; the logo appears in that business's header when its owner logs in.
**Cross-check:** Audit Trail tab lists the edits with from → to.

### TEN-03 · Archive and re-activate a business
`P0` `regression` `guarded` · Status: Draft
**Pre:** `E2E {RUN} Biz` only.
1. Archive from Overview. 2. Try to log in as its owner and to open its public widget. 3. Activate.
**Expect:** archived business is out of the active list, its users cannot operate it, its widget stops taking bookings; activation restores everything.

### TEN-04 · Tenant users: invite, change role, remove
`P0` `regression` · Spec 02 R4 · Status: Draft
1. At `/admin/tenant-users` add `e2e-{RUN}-tmgr@daystream.test` as a tenant manager; change role; remove.
**Expect:** each change shows in the list; a removed user cannot log in; the last tenant owner cannot be removed or demoted.

### TEN-05 · A tenant sees only its own portfolio
`P0` `negative` · Spec 02 R5 · Status: Draft
1. Compare the business list with the system-level list of all businesses.
2. Request another tenant's business id via `GET /api/v1/admin/businesses/{id}/settings` and `/api/v1/pay/tenant-billing/{businessId}/plan`.
**Expect:** only own businesses listed; foreign ids return 403 / 404 (`requireOwnedBusiness`).

### TEN-06 · Look into a business with the context switcher
`P1` `regression` · Spec 29 · Status: Draft
1. Switch context into `E2E {RUN} Biz`; open Customers and Offerings; switch back.
**Expect:** business modules appear and show that business's data; switching back restores the tenant modules.

### TEN-07 · Prospects: view territory and list
`P1` `regression` · Spec 31 R6 · Status: Draft
1. Open `/admin/prospects`.
**Expect:** the tenant's territory summary is shown (or an explicit "no territory assigned" state); the prospect list loads with paging and sorting.

### TEN-08 · Prospects: filter by city and category
`P1` `regression` · Spec 31 R6 · Status: Draft
1. Filter by a city; then add a category filter; clear filters.
**Expect:** results narrow to matching rows only; the count updates; clearing restores the full list.

### TEN-09 · Prospects: add manually, edit, dismiss
`P1` `regression` · Spec 31 R6, R7 · Status: Draft
1. Add prospect `E2E {RUN} Prospect` with address and category. 2. Edit its status / notes. 3. Dismiss it.
**Expect:** it appears, updates, and leaves the active list when dismissed; adding the same business twice is flagged as a duplicate.

### TEN-10 · Prospects: export
`P2` `regression` · Spec 31 R8 · Status: Draft
1. Apply a filter and export.
**Expect:** the file downloads and contains exactly the filtered rows with the visible columns.

### TEN-11 · Tenant reports hub
`P1` `regression` · Spec 35-reporting R1, R2; spec 10 task 3.5 · Status: Draft
1. Open `/admin/tenant-reports`; run each catalogued report (Billing Activity first) for a date range.
2. Open the older `/admin/reports` page.
**Expect:** every report opens in the runner and returns rows or an explicit empty state; revenue, customers, bookings and memberships figures cover only this tenant's businesses.
**Cross-check:** the tenant revenue total equals the sum of the per-business revenue reports for the same range (compare with suite 12 readings for the demo business when it is the tenant's only active business).

### TEN-12 · Tenant settings and processes
`P1` `regression` · Spec 10 task 3.5 · Status: Draft
1. Open `/admin/tenant-settings`: check every tab, including Payment Processors and Business Billing (receiving account).
2. Save bank details in Business Billing; reload.
3. Open `/admin/tenant-processes`: view the business billing run schedule; change the time; save; restore.
**Expect:** values persist; secrets are masked on reload and kept when the field is left blank on re-save; the schedule saves without creating a duplicate schedule row.
**Cross-check:** `GET /api/v1/pay/tenant-billing-account` and `/tenant-billing-schedule` return the saved values.
