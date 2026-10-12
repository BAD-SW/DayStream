# DayStream — End-to-End Test Book

**Owner:** Claude (maintained in every working session) · **Created:** 2026-10-12
**Synced through commit:** `417c0e6` (feat(payments): accounting hardening, bank-draw reconciliation, and billing UX)
**Script count:** 298 across 18 suites · **Verified by execution:** 24 · **Failing:** 0 · **Blocked:** 31, of which 29 await specs 47–48 (KI-13) (last full smoke run 20261012-3: 20 of 20 passed; runs 20261012-4 and -5 covered the People screens — see [RUN-LOG.md](./RUN-LOG.md))

This is the living end-to-end (E2E) regression book for DayStream. It exists for two goals:

- **A. Everything is tested end-to-end**, not only in isolation: a change in one module is proven through the modules that depend on it (service → booking → check-in → checkout → payment → ledger → reports).
- **B. Stability**: nothing breaks when we add our own work or pull Bill's changes.

It complements, and does not replace, the automated Vitest suites in `packages/*/tests` (unit and API-integration level). Those prove each piece; this book proves the pieces work together through the real UI, API and database.

---

## 1. How to ask for a run

| You say | What gets executed |
|---|---|
| "Run the smoke tests" | Suite 00 only (about 20 checks). Use after every pull and before every push. |
| "Run end-to-end tests" | Everything: suite 00, then 01 (journeys), then 02–17. |
| "Run the journeys" | Suite 01 only: the cross-module business flows. |
| "Run suite 09" / "Run the booking tests" | One suite. |
| "Run impacted tests" | Smoke + the suites mapped to the files changed since the last run (section 7). |

Every run ends with a report in chat and a new entry in [RUN-LOG.md](./RUN-LOG.md): pass / fail / blocked / skipped per script, with evidence for each failure. A failure is reported as found; a script is never edited to make it pass unless the product behaviour it describes has legitimately changed (and then the change is recorded in section 9).

---

## 2. Suites

| # | Suite | Prefix | Scripts | Covers (specs) |
|---|---|---|---|---|
| 00 | [Preflight & smoke](./suites/00-preflight-smoke.md) | PRE, SMK | 20 | 00, 03 |
| 01 | [Cross-module journeys](./suites/01-journeys.md) | JNY | 16 | all |
| 02 | [Auth, access & isolation](./suites/02-auth-access.md) | AUTH | 21 | 02, 03, 29 |
| 03 | [System admin](./suites/03-system-admin.md) | SYS | 17 | 03, 24, 31, 37 |
| 04 | [Tenant admin](./suites/04-tenant-admin.md) | TEN | 12 | 03, 31, 35-reporting |
| 05 | [Billing layers A & B](./suites/05-billing-layers.md) | BILL | 16 | 10 (0, A, B) |
| 06 | [Business setup, schedule & time clock](./suites/06-business-setup.md) | SET | 16 | 12, 13 |
| 07 | [Offerings & pricing](./suites/07-offerings.md) | OFF | 15 | 06, 08, 09, 28 |
| 08 | [People (CRM)](./suites/08-customers.md) | CUS | 28 | 05, 46 |
| 09 | [Bookings, calendar & check-in](./suites/09-bookings-calendar.md) | BKG, CHK | 25 | 07, 15, 32, 33, 34 |
| 10 | [Checkout & customer payments](./suites/10-checkout-payments.md) | PAY | 18 | 10 (C), 26, 28 |
| 11 | [Accounting & payroll](./suites/11-accounting-payroll.md) | ACC | 14 | 11 |
| 12 | [Reports](./suites/12-reports.md) | REP | 8 | 17, 35-reporting |
| 13 | [Marketing & leads](./suites/13-marketing.md) | MKT | 20 | 16, 48 |
| 14 | [Website, CMS & booking widget](./suites/14-website-widget.md) | WEB | 13 | 18, 38 |
| 15 | [Events, community & integrations](./suites/15-events-community-integrations.md) | EVT, COM, INT | 12 | 14, 20, 22 |
| 16 | [UI cross-cutting](./suites/16-ui-crosscutting.md) | UIX | 11 | 04, 30 |
| 17 | [Inbox](./suites/17-inbox.md) | INB | 16 | 47 |

Suite 01 is the heart of goal A. Suites 02–17 go deep per feature. Suite 00 is the fast gate for goal B.

---

## 3. Script format

```
### BKG-04 · Edit and reschedule
`P1` `regression` · Spec 07 R6 · As: reception · Status: Draft
**Pre:** a confirmed booking (BKG-02).
1. Step …
2. Step …
**Expect:** observable result in the UI.
**Cross-check:** the same fact seen from another module, the API, or the database.
```

- **ID** is permanent. A retired script keeps its ID and is marked `Retired` with the reason; IDs are never reused.
- **Priority:** `P0` money, security, data isolation, or the app is unusable · `P1` core flow of a module · `P2` secondary behaviour.
- **Tags:** `smoke`, `regression`, `journey`, `negative` (must be refused), `guarded` (destructive or money-moving: read section 5 first), `known-issue` (expected to fail; linked to the issue), `needs-config` (requires something not set up locally, e.g. Stripe test keys).
- **Status:** `Draft` written from specs and code, not yet executed · `Verified` passed as written at least once · `Failing` last run failed (see run log) · `Blocked` cannot run (reason given) · `Retired`.
- **Cross-check** is what makes a script end-to-end. A script that only checks the screen it acted on is an isolated test.

Scripts describe behaviour, not CSS selectors, so they survive UI redesigns. Where a label is quoted (for example the **Charge now** button) it comes from the code or the spec.

**All scripts are currently `Draft`.** They were written from the requirements, design and task files, the route table (`packages/client/src/App.tsx`), the module registry and the API route files, without executing the app. The first full run will calibrate them: steps that do not match the real screens get corrected, and genuine product defects get reported.

---

## 4. Environment and preflight

| Item | Value |
|---|---|
| Client | `http://localhost:{CLIENT_PORT}` from the repo-root `.env` (currently 3000; `CLAUDE.md` and `AGENTS.md` still say 4000) |
| API | `http://localhost:{SERVER_PORT}` (currently 3001), routes under `/api/v1`, docs at `/api/docs` |
| Database | local PostgreSQL on 5432 |
| Start | `npm run dev` from the repo root |
| After a pull | `npm install`, then `npm run migrate:dev` |
| Password (all test accounts) | `password123` |

Accounts (from `packages/server/src/db/seed.ts`):

| Short name | Email | Persona / role |
|---|---|---|
| system | `system@daystream.test` | system · platform admin |
| tenant | `tenant@daystream.test` | tenant · Tenant Owner (`*:*`) |
| biz-thin | `business@daystream.test` | business · owner (thin dataset) |
| cust-thin | `customer@daystream.test` | customer |
| owner | `owner@transcend.test` | business · Business Owner |
| manager | `manager@transcend.test` | business · Manager |
| reception | `reception@transcend.test` | business · Staff |
| therapist | `therapist@transcend.test` | business · Staff (provider) |
| trainer | `trainer@transcend.test` | business · Staff (provider) |
| customer | `customer@transcend.test` | customer |

Seeded role permissions, used by the access tests:

| Role | Permissions |
|---|---|
| Tenant Owner | `*:*` |
| Business Owner | `services:*` `bookings:*` `staff:*` `reports:*` `settings:*` `customers:*` `resources:*` `marketing:*` `cms:*` `integrations:*` `checkin:*` `events:*` `community:*` |
| Manager | `services:read` `bookings:*` `staff:read` `reports:read` `customers:*` `schedule:*` `checkin:*` `events:read` |
| Staff | `bookings:read` `bookings:update` `customers:read` `schedule:read` `checkin:*` `events:read` |
| Customer | `bookings:create` `bookings:read` `profile:update` |

Local data quirks to expect (not defects of the run):

- `owner@transcend.test` belongs to the business ending `…0002`, which is named "DayStream" on this machine. "Transcend Health" belongs to tenant "Spain DMA SRL".
- **Populated demo data:** log in as `system`, then use the context switcher to enter tenant "Spain DMA SRL" → business "Transcend Health" (services, resources, packages, memberships, customers). The seed business `…0002` holds almost nothing, so scripts that need existing data either switch there or create their own.
- **Stripe sandbox:** since 2026-10-12 a Stripe **test-mode** connection is saved at platform, tenant `…0001` and business `…0002` level (keys are stored encrypted in the app, not in this repo). `needs-config` payment scripts can run in the seed business. Test instruments are listed in rule 3 of section 5.
- **Customer login has a customer record:** `customer@transcend.test` is matched by email to customer "James Wilson" in business `…0002`, with one booking on 2026-10-20 (created in run 20261012-2).
- The local database is set to English error messages (`ALTER DATABASE … SET lc_messages='C'`); the server matches on English text such as "duplicate key", so a Spanish-locale PostgreSQL turns duplicate errors into 500s.
- If the header shows the wrong business, clear `sessionStorage.ds_active_context` (Linear THE-13).
- `AGENTS.md` lists `admin@daystream.app`; that account is not in the current seed. Use `system@daystream.test`.

---

## 5. Execution rules

1. **Preflight first.** If any `PRE-*` script fails, stop and report: results from a broken environment are noise.
2. **Local only.** Scripts run against `localhost`. If the base URL is anything else, stop.
3. **Money safety.** Before any `guarded` payment script, confirm the processor in use is the mock adapter or Stripe **test** mode (PRE-07). If a live key is detected, stop. Only Stripe test instruments are used: card `4242 4242 4242 4242`, SEPA IBAN `DE89 3704 0044 0532 0130 00`, ACH routing `110000000` / account `000123456789`.
4. **No real emails.** SMTP is configured in `.env`. Every address created by a script must end in `@daystream.test` or `@transcend.test` (the `.test` domain cannot receive mail). Never use a real address.
5. **Login budget.** Auth endpoints allow 10 requests per minute per IP (`middleware/rate-limit.ts`). Rejected and malformed requests count too, and the window is a fixed minute. API logins need `tenant_id` `00000000-0000-0000-0000-000000000001` in the body. Log in once per persona and reuse the session; AUTH-17 (the rate-limit test) runs last in its suite and is followed by a 60-second wait.
6. **Own your data.** Each run has a run id `{RUN}` = `yyyyMMdd-HHmm`. Everything a script creates is named `E2E {RUN} …` (emails `e2e-{RUN}-…@daystream.test`). Scripts assert on their own records, never on counts of pre-existing data.
7. **Clean up by archiving.** DayStream soft-deletes business data, so cleanup means archive / cancel / void / deactivate. Each suite ends with a cleanup script. Leftover `E2E …` records from an aborted run are harmless and are swept by the next cleanup.
8. **Guarded scripts** (tenant suspend, GDPR anonymize, billing "Run now", data deletion) act only on records the run created. If the only available target is real demo data, mark the script `Blocked` instead of running it.
9. **Evidence.** A failure records: the step, expected vs actual, a screenshot or the API response, and browser console / network errors.
10. **Read-only on source.** A test run never edits code, specs or migrations. Defects are reported, then fixed in a separate, requested piece of work.

How scripts are driven: UI steps through the browser, as the named persona; `Cross-check` steps through a second screen, the REST API (endpoints listed per script), or a read-only SQL query.

---

## 6. Coverage by spec

| Spec | Suites | Notes |
|---|---|---|
| 00 infrastructure | 00 | Health, migrations, seed, API docs |
| 01 cicd-pipeline | — | Not built (0 of 117 tasks). No E2E surface yet |
| 02 security-compliance | 02 | OAuth and MFA not built; covered: login, reset, RBAC, isolation, sessions, audit, rate limit, GDPR |
| 03 core-platform | 00, 02, 03 | Tenancy, provisioning, config, feature flags |
| 04 design-system | 16 | Layout, tables, forms, responsive, accessibility |
| 05 customer-management | 08, 01 | |
| 06 service-management | 07, 01 | |
| 07 booking-engine | 09, 01 | |
| 08 membership-engine | 07, 10, 01 | |
| 09 pricing-engine | 07, 10 | |
| 10 payment-platform | 05, 10, 01 | Phases 1–4 built; Phase 5 (net-collections feed, payment reports), 6 (document branding), 7 (hardening) not built: see section 8 |
| 11 accounts-payable | 11, 01 | Includes payroll |
| 12 staff-management | 06, 01 | |
| 13 resource-management | 06, 09 | |
| 14 events-workshops | 15 | Behind `feature.events` |
| 15 check-in-system | 09, 01 | |
| 16 marketing-automation | 13 | |
| 17 reporting-analytics | 12, 01 | |
| 18 website-cms | 14 | |
| 19 mobile-app | — | No mobile package under `packages/` in this version |
| 20 integrations | 15 | External providers are not connected locally; webhooks, API keys and iCal are covered |
| 21 ai-features | — | Requirements only |
| 22 community-engagement | 15 | Behind `feature.community` |
| 23 hosted-infrastructure | — | Requirements only |
| 24 query-editor | 03 | |
| 26 invoicing-ar | 10 | Requirements only; the invoicing built under spec 10 C5 is covered |
| 28 products-and-services | 07, 10 | Merchandise, packages, promotions, orders |
| 29 context-switcher | 02 | |
| 30 dark-light-mode-switch | 16 | |
| 31 prospect-management | 03, 04 | |
| 32 smart-booking-flow | 09 | |
| 33 calendar-redesign | 09 | |
| 34 capacity-aware-calendar | 09 | |
| 35 bold-business-theme, 36 classic-theme | — | Not built |
| 35 reporting-framework | 12, 04, 03 | Report catalog and runner exist; spec tasks unticked |
| 37 theme-setup | 03 | Themes API exists (`/v1/themes`); one script, to grow |
| 38 embeddable-booking-widget | 14 | |
| 39–45 | — | Placeholders ("to be defined"). Scripts are added when requirements land |
| 46 people-foundation | 08, 01 | Requirements, design and tasks written 2026-10-12; not built. CUS-17 to CUS-28, JNY-15 |
| 47 inbox | 17, 01 | Draft spec; not built. INB-01 to INB-15 run on the mock message adapter. Adds the Front Desk role (INB-13) |
| 48 marketing-module | 13, 01 | Draft spec; not built. MKT-09 to MKT-20 |
| 49 custom-lead-stages | — | Requirements only, not scheduled. Scripts are added when the phase is picked up |

---

## 7. Keeping this book in sync

This book is updated in the same session as the change that makes it stale. Two triggers:

**A. After every `git pull` (Bill's changes)**

1. `git log --oneline <synced commit>..HEAD` and `git diff --stat <synced commit>..HEAD`.
2. Map each changed path to suites with the table below.
3. Read changed spec files (`requirements.md`, `design.md`, `tasks.md`) for new or altered acceptance criteria.
4. Add scripts for new behaviour, update scripts whose expected result changed, retire scripts for removed behaviour.
5. Update "Synced through commit" at the top, the script counts, and the change log (section 9).
6. Offer to run smoke + impacted suites.

**B. After every change we make ourselves**

The change is not done until the scripts that cover it are added or updated, and the impacted suites plus smoke have been offered or run.

**Path → suite impact map**

| Changed path (under `packages/`) | Suites |
|---|---|
| `server/src/db/migrations/*`, `server/src/app.ts`, `routes/index.ts`, `middleware/*` | 00 + every suite whose tables or routes are touched |
| `routes/auth.ts`, `ProtectedRoute`, `AuthContext`, `ContextManager`, `ContextSwitcher`, `moduleRegistry.ts` | 00, 02 |
| `routes/admin.ts`, `system-config.ts`, `query-editor.ts`, `themes.ts`, `pages/Admin*`, `Tenants`, `System*`, `AuditLog` | 03 |
| `routes/prospects.ts`, `*territory*`, `google-places*`, `pages/Prospects`, `CoverageMap`, `ProspectCategories` | 03, 04 |
| `pages/Tenant*`, `tenant.service.ts` | 04 |
| `platform-billing*`, `tenant-billing*`, `payments/*` adapters, `processor-config*`, `payment-methods*`, `jobs/*` | 05, 10, JNY-09, JNY-10 |
| `routes/staff.ts`, `resources.ts`, `locations.ts`, `schedule.ts`, `clock.ts` and their pages | 06, 09 |
| `routes/services.ts`, `merchandise.ts`, `packages.ts`, `promotions.ts`, `memberships.ts`, `pricing.ts` and their pages | 07, 09, 10 |
| `routes/customers.ts`, `segments.ts`, `customer-portal.ts`, `pages/Customer*`, `person-identity*`, `contactability*`, `consent*`, `customer-duplicates*` | 08, 10, 13, 17, JNY-15 |
| role seeds (`seed.ts`, `seed-config.sql`, `tenant.service.ts` roles, role migrations) | 02, 17 (INB-13), and the role table in section 4 |
| `routes/inbox.ts`, `message.service*`, `conversation*`, channel adapters, `pages/Inbox`, `components/inbox/*` | 17, 08, 13, JNY-15 |
| `routes/leads.ts`, `lead.service*`, `audience*`, `marketing-funnels*`, `pages/marketing/*` | 13, 08, JNY-15 |
| `routes/bookings.ts`, `availability*`, `check-in.ts`, `pages/Booking*`, `Schedule`, `CheckIn` | 09, 01, 14 |
| `routes/checkout.ts`, `payments.ts`, `payment-platform.ts` (customer part), `customer-payment*`, `refund*`, `invoice*`, `gift-card*`, `voucher*`, `dunning*`, `membership-renewal*`, `payment-journal*` | 10, 11, 12 |
| `routes/payroll.ts`, `accounts-payable.ts`, `pages/Payroll`, `AccountsPayable` | 11 |
| `routes/reports.ts`, `pages/Report*`, `pages/reports/*` | 12 |
| `routes/marketing.ts` and pages | 13, 17 |
| `routes/cms.ts`, `widget.ts`, `catalog.ts`, `pages/CMS*`, `BookingWidget` | 14 |
| `routes/events.ts`, `community.ts`, `integrations.ts` and pages | 15 |
| `design-system/*`, `components/AppLayout`, `AdminLayout`, theme files | 16, 00 |
| `packages/shared/*` | 00 + 01 |

When in doubt, run more: any change to shared layout, auth, or migrations triggers the full book.

---

## 8. Known issues and gaps

| Ref | What | Effect on scripts |
|---|---|---|
| KI-1 | Availability for resource-type services with **no staff assigned** has a pre-existing bug in the staff-list handling (`availability.service.ts`) | BKG-08 tagged `known-issue` |
| KI-2 | Stale active context in `sessionStorage` can show the wrong business (Linear THE-13) | Workaround in section 4; AUTH-12 watches for it |
| KI-3 | Spec 10 task 2.3 / 3.2 / 5.1: net-collections feed (C → B → A) not built, so percentage-based platform and tenant billing computes on zero | BILL-05 and BILL-12 assert the flat part only; JNY-10 is `Blocked` until 5.1 lands |
| KI-4 | Spec 10 Phase 7: `/pay/methods` routes are context-scoped without an explicit permission check; payment-method add/remove is not audited | AUTH-16 records current behaviour; tighten when Phase 7 lands |
| KI-5 | Spec 10 task 3.6 and 4.11 checkpoints (tenant billing, customer payments) are not yet validated by Bill | Suites 05 and 10 are the first full pass over this code: expect findings |
| KI-6 | Businesses created after migration 045 have no default accepted payment methods (spec 10 task 1.6 follow-up) | PAY-01 checks and reports it |
| KI-7 | Apple Pay cannot render on `http://localhost`; Google Pay needs a wallet-enabled browser | Wallet capture is not scripted locally |
| KI-8 | Staff pages are not migrated to the design system (Tailwind remnants) | UIX scripts skip visual consistency on Staff pages |
| KI-9 | The seed logins belong to business `…0002` "DayStream". It now holds E2E dummy data (customer James Wilson with a booking, `E2E Therapist`, `E2E Treatment Room`, `E2E Main Location`, time zone `Europe/Madrid`, widget enabled, Stripe test connection). The larger demo data set is in another tenant ("Spain DMA SRL" → "Transcend Health") | Reach it as `system` through the context switcher (section 4). Rule: when a script lacks data, create `E2E …` data rather than marking it `Blocked` |
| KI-10 | Unit tests share `daystream_dev`. Until 2026-10-12 several of them deleted tenant-wide data on every run (all staff profiles, resources, events and check-in records of the seed tenant) — the reason the seed business was empty. They now clean only their own test businesses (`tests/helpers/test-business.ts`), and all pass: server 895, client 186, shared 12 | Still open: tests create about 70 `… Test Biz` businesses that stay in the dev database; a separate test database would be cleaner |
| KI-11 | Open defects: **D-5** in production `trust proxy` still trusts every hop until `TRUST_PROXY` is set to the real hop count (a deployment setting, not code); **D-12** in the local database only, the service "Fire & Ice" points at a resource that no longer exists (booking edit logs a 404; page works; not in the seed files). Fixed on 2026-10-12: D-1 to D-4, D-6, D-7, D-8, the product bugs listed in run 20261012-3, and in a third round **D-10** (the booking calendar now reads time zone, opening hours and services from `/bookings/filters`, which staff roles may read), **D-11** (check-in list keys) and **D-13** (Community challenges, points, badges, streaks, video progress and courses now use the customer record, not the login id) | D-10 and D-13 re-checked through the API as reception (200 on filters and on the community endpoints); D-10 and D-11 not yet re-checked on screen: BKG and CHK suites will do it |
| KI-12 | Spec 38 R14 / R19: there is no screen or API to configure the booking widget (enable it, require payment, allowed origins). `wgt_widget_configs` is only readable; rows are inserted by hand | WEB-13 is `Blocked` until it is built |
| KI-13 | Spec 46 (People Foundation) is built except for the items marked **Open** in `.kiro/specs/46-people-foundation/tasks.md`: contactability in the sequence engine and booking reminders, the prompt for missing details at first booking, a background job for bulk actions above 5,000 people, and section 6 (business scope for campaigns, sequences, funnels, templates), which is deferred to spec 48. Specs 47 (Inbox) and 48 (Marketing Module) are drafts, not built | INB-01 to INB-15 and INB-99, MKT-09 to MKT-20 and JNY-15 are `Blocked`. CUS-17 to CUS-28 are unblocked (`Draft`, CUS-18 `Verified`) |
| KI-14 | Fixed by the spec 46 work (2026-10-12): **D-14** lead form submissions now create a lead in a business; **D-15** merging moves everything that points at the person and keeps the second record as `merged`; **D-16** consent has one store with a history. Also fixed: sending a campaign made every active person of the whole tenant a recipient, ignoring segment and consent (it now needs a segment and respects consent); customer reference numbers failed once a `CUS-…` style reference existed. Found by the browser check (run 20261012-4) and fixed: **D-17** a refused "add person" (already exists) silently filled in the existing person's details; **D-18** after a merge the profile form showed stale values as unsaved changes, so Save would have wiped merged details; **D-19** date of birth never showed in the profile form and moved back a day on each save when the server is not in UTC; **D-20** the consent reason was asked through a browser pop-up (now an inline field). Fixed in run 20261012-5: **D-21** the profile's Financial Summary showed fixed "$0.00 / Good" placeholders; it now shows balance due, lifetime value and account credit in the business currency. **D-22** a campaign could not be given an audience from the screen (the form had no segment picker, and sending needs one); the form now has an audience picker with a "who will receive it" line | CUS-13, CUS-18, CUS-21, CUS-23 and MKT-07 exercise these. Merge behaviour to expect: the second record is kept with status `merged` and old links redirect; staff switching marketing consent on must give a reason; a campaign needs a segment |
| KI-15 | `packages/shared` is consumed by the server from its built `dist/`, which is not in git | After every pull that touches `packages/shared`, run `npm run build -w packages/shared` before starting the app or the tests |
| KI-16 | People created before migration 136 have no international phone number stored, so they cannot be matched by phone | Run `npx tsx scripts/backfill-phone-e164.ts` in `packages/server` once per database (done locally on 2026-10-12; still to do on Render) |

Gaps in the test approach itself:

- The book is executed by Claude through the browser and the API. It is thorough but slow, and it only runs when asked. The natural next step is to automate suite 00 and suite 01 with Playwright so they run on every pull without being asked. Not started: awaiting a decision.
- Scheduled jobs are exercised through their "Run now" buttons, not by waiting for the clock.
- Email and SMS delivery is checked up to the point the message is queued or logged, not in an inbox.

---

## 9. Change log

| Date | Commit range | Change to the book |
|---|---|---|
| 2026-10-12 | up to `417c0e6` | Book created: 17 suites, 254 scripts, all `Draft`. Includes Bill's payment platform work (spec 10 phases 1–4), system/tenant Reports and Processes pages, tenant contract dates, territory composition and system-level prospect generation |
| 2026-10-12 | `417c0e6` | First run (20261012-1, smoke). Suite 00 statuses set from execution; PRE-06, PRE-07, PRE-08, PRE-09 and SMK-08 corrected; KI-9 to KI-11 added |
| 2026-10-12 | `417c0e6` + local fixes | Fixes for D-1 to D-6 (migration 135, logout, customer navigation and booking scope, `TRUST_PROXY`). Run 20261012-2 (smoke) re-verified them. Added AUTH-19, AUTH-20, AUTH-21; updated AUTH-08, AUTH-09, AUTH-16, SMK-07, PRE-07; role table, demo-data route and Stripe sandbox noted in section 4 |
| 2026-10-12 | `417c0e6` + local fixes | D-7 and D-8 fixed. Unit-test suite repaired (7 obsolete membership files replaced by one for the current engine, the rest updated; destructive clean-ups scoped) and 12 product bugs it exposed fixed. Dummy data created in the seed business, widget enabled. Run 20261012-3: smoke 20 of 20. AUTH-21 verified, WEB-13 blocked (KI-12), KI-9 to KI-12 rewritten |
| 2026-10-12 | `417c0e6` + local | Specs 46 (People Foundation), 47 (Inbox, draft) and 48 (Marketing Module, draft) written. Added CUS-17 to CUS-28, MKT-09 to MKT-20, JNY-15 and new suite 17 (INB-01 to INB-14, INB-99): 40 scripts, all `Blocked` until built (KI-13). MKT-07 and CUS-13 tagged `known-issue` (D-14, D-15); KI-14 added. Suite 08 renamed People (CRM). No code changed, nothing executed |
| 2026-10-12 | `417c0e6` + local | Product decisions applied to spec 47: thread viewable whole or per channel (new INB-15), channel order email → WhatsApp → SMS → in-app (task references on INB-06 and INB-10 updated), Front Desk role for reception (INB-13 rewritten). Spec 49 (custom lead stages) written as requirements only; no scripts yet |
| 2026-10-12 | `417c0e6` + local | D-10, D-11, D-13 fixed; KI-11 rewritten. Unit tests after the fixes: server 895 of 895, client 186 of 186; type check: server 0 errors, client 30 (unchanged baseline). Spec 48 renamed Marketing Module (Leads is its first section); stage `trial` is shown as "New customer" |
| 2026-10-12 | `37aad94` + local | Spec 46 People Foundation built (migration 136). Run 20261012-4: People list, add person, profile, consent, duplicate banner and merge checked in the browser; D-17 to D-20 found and fixed, D-21 logged. CUS-17 to CUS-26 unblocked (CUS-18 verified); CUS-27 and CUS-28 stay blocked on their screens. KI-13, KI-14 rewritten, KI-15 added. Registration test no longer leaves people in the seed business. Unit tests: server 945, client 186 |
| 2026-10-12 | `5d7937d` + local | Remaining spec 46 screens built: column chooser, bulk actions, segment editing and fixed lists, campaign audience picker with summary, real Financial Summary. Run 20261012-5 checked them in the browser. CUS-27 and CUS-28 unblocked; D-21 and D-22 fixed; KI-13 rewritten, KI-16 added; spec 46 `tasks.md` ticked (63 done, 15 open). Unit tests: server 946, client 186 |
