# E2E Run Log

One entry per run, newest first. Each entry records what was run, against which commit, and the outcome of every script that did not pass.

## Entry template

```
## Run {RUN} — {scope: smoke | full | suites …}
- Commit: <sha> · Migrations at: <latest number> · Processor mode: mock | stripe-test
- Result: <passed> passed · <failed> failed · <blocked> blocked · <skipped> skipped (of <total>)
- Duration: <minutes>

### Failures
| Script | Step | Expected | Actual | Evidence | Verdict |
|---|---|---|---|---|---|
| BKG-004 | 3 | … | … | screenshot / response | product defect · script wrong · environment |

### Blocked / skipped
| Script | Reason |

### Script corrections made after this run
| Script | What changed and why |

### Leftover test data
What was not cleaned up, if anything.
```

"Verdict" matters: a **product defect** is reported and left failing; a **script wrong** result means the script is corrected and the correction is listed; an **environment** result means the run is repeated after the environment is fixed.

---

## Runs

## Run 20261012-6 — full run (in progress)
- Commit at start: `2a62bc8` · Migrations at end so far: 141 · Processor mode: Stripe test (platform, seed tenant, seed business); mock for the E2E tenant
- Method: each script is driven through the API by a repeatable script (kept in the session scratchpad: `r00`, `r02`, `r02b`, `r03`, `r05`, `r06`, `r07`, `r08`, `r09`), with the browser used for screens, menus and typed addresses. Data is created in a dedicated tenant `E2E 20261012-6 SysTenant` and its business `E2E 20261012-6 Biz` (time zone Europe/Madrid)
- A script is marked `Verified` when every check passed after fixes. Scripts whose remaining part is purely visual are noted below

### Progress
| Suite | Result | Not yet run |
|---|---|---|
| 00 Preflight & smoke | 19 of 20 pass | SMK-11 (theme toggle) to be re-checked in suite 16 |
| 02 Auth, access, isolation | 17 run, all pass after fixes | AUTH-07 (tenant menu, to re-check after the role fix), AUTH-12 (context switcher, browser) |
| 03 System admin | 13 pass after fixes | SYS-04, SYS-07, SYS-14 (map screen), SYS-15 (needs a Google Places key) |
| 04 Tenant admin | 10 pass after fixes | TEN-06 (context switcher), TEN-08 (prospect filters) |
| 05 Billing layers | 16 of 16 pass after fixes, with real Stripe test charges | BILL-03 card entry in the hosted fields was replaced by a server-side confirmation with Stripe test methods |
| 06 Business setup, schedule, clock | 16 of 16 pass after fixes | Screens themselves only covered by the smoke tour |
| 07 Offerings & pricing | 14 of 15 pass after fixes | OFF-05 (image upload, browser) |
| 08 People | 24 pass after fixes (plus CUS-18 from run 4) | CUS-09 (360 tabs), CUS-10 (quick actions), CUS-27 (column choice) need the screen; their API parts pass |
| 09 Bookings, calendar, check-in | 21 pass after fixes | BKG-08 (KI-1), BKG-17 and BKG-20 (calendar visuals), CHK-04 (late arrival, membership) |
| 01, 10 to 17 | pending | |

### Defects found and fixed in this run
| Id | Severity | Summary |
|---|---|---|
| D-23 | Critical | Any signed-in user could read and change another tenant's customers, services and bookings by passing that business's id. The server never checked that the caller could reach the business named in a request |
| D-24 | Critical | A tenant owner passed every platform-only check (`requirePermission('*:*')`): all tenants, all users, platform configuration, platform billing |
| D-25 | Critical | The Query Editor gave a tenant owner the whole database (it was described as tenant-scoped; it has no tenant filter) |
| D-26 | High | Tenant-level endpoints were open to business owners (`settings:*`): create tenant users as full tenant owners, create and archive businesses, tenant reports and billing, prospects, own billing plan and credits, the tenant's billing run and bank details |
| D-27 | High | A suspended tenant's users, a deactivated user and users of an archived business could still sign in and keep using open sessions |
| D-28 | High | Seed tenant owner (and tenant owners of older tenants) held the Business Owner role and became business users after a page reload; staff created from Business Setup had no role and signed in as "customer" with no permissions (migration 138) |
| D-29 | High | Booking times were compared with opening hours and staff availability on the UTC clock, not in the business's local time. Outside UTC, offered slots were shifted and could be refused when booked |
| D-30 | High | DATE columns travelled as the previous day on a server outside UTC (holiday closures and day overrides never matched; date fields drifted) |
| D-31 | High | Service / location assignments on the staff page and those the booking engine reads were two unconnected lists (migration 140) |
| D-32 | High | Resources required by a service, and their maintenance windows, were never applied to slots or bookings |
| D-33 | High | A declined platform or tenant charge could not be collected after the card was replaced (processor idempotency key reused with a new card) |
| D-34 | Medium | Manual "Run now" billing runs did not appear in Billing Activity |
| D-35 | Medium | A customer login could ask for another customer's saved payment methods; method endpoints did not check the owner level |
| D-36 | Medium | Platform and tenant screens, and modules outside a staff role's permissions, opened as empty shells when the address was typed |
| D-37 | Medium | Managers were refused the list of locations on the Schedule screen |
| D-38 | Medium | Sign-ins, lock-outs and password resets were not in the audit log |
| D-39 | Medium | Events and Community could not be switched on: their feature flags did not exist (migration 139) |
| D-40 | Medium | Daily booking limit per provider stored but never enforced; checked-in bookings did not block their provider or resource in conflict checks; deactivated staff still offered as providers and still able to sign in |
| D-41 | Medium | Second staff member with an existing email accepted (second profile on one login); leave could be requested for another person; overlapping and out-of-hours shifts accepted |
| D-42 | Low | Tenant contract end date before start accepted; business edits not audited; duplicate prospects accepted; staff metrics failed; time clock refused unusual email endings; a system admin could deactivate themselves |
| D-43 | Critical | Two requests for the same slot at the same moment could both be saved (the checks and the insert were separate steps); the second one failed only by accident, on the booking reference. Bookings of a business are now decided one at a time |
| D-44 | Critical | The booking edit screen wrote the new time, provider, service and variant straight to the record: no conflict, opening-hours, availability, resource or capacity check, and the end time and price kept the old variant's values. Rescheduling checked only the provider's and customer's other bookings. Both now go through the same rules as a new booking |
| D-45 | High | Day and week calendar views failed (server error) on any day that had a booking of a shared or group service |
| D-46 | High | A shared session disappeared from the offered slots as soon as it had one booking; remaining places were not reported unless the service had its own availability rule. Capacity counted bookings, not people |
| D-47 | High | Check-in covered every business of the tenant (dashboard, no-shows, reports, check-in by booking or code). It is now limited to one business; "today" and report dates are the business's days |
| D-48 | High | A refused check-in (wrong day, cancelled, already in) still answered "ok" and saved a check-in record, which then blocked the real check-in. Walk-in check-in failed for every service (written against columns that do not exist). A kiosk could not work without a staff login |
| D-49 | High | Recurring series read their time as UTC (15:00 became 16:00 or 17:00 in Madrid) and skipped opening hours, provider availability and capacity |
| D-50 | High | A new business got no chart of accounts, so none of its sales reached the ledger (migration 141 repairs existing ones) |
| D-51 | High | Discount codes could be created but not used at checkout; neither codes nor promotions counted their uses, so limits never applied |
| D-52 | Medium | The profile listed every tag of the business as the person's tags; a first booking or visit never moved the lifecycle stage; archived people could be booked; name search missed accented names; importing a known person did not fill in their missing details |
| D-53 | Medium | A paused or draft service could be booked and an inactive plan sold; a category with services could be archived; price changes were not written to the price history; a refused booking said only "Failed to create booking" |
| D-54 | Medium | A no-show without a fee was not recorded (missing from the person's record and the report); the booking horizon was shown but not applied; a freed place was never offered to the waitlist and confirming an offer made no booking; a person could not rejoin a waitlist |
| — | — | 635 API handlers answered "server error" without recording the cause; they now log it |

### Observations (not changed)
- Adding a tenant user always creates a full tenant owner; there is no lesser tenant role in the form.
- A business owner can change tenant-wide feature overrides and tenant configuration values (`settings:*`). The business Settings screen relies on some of these keys.
- The audit log is read per tenant: a system admin sees another tenant's entries only after switching context into it.
- A password-reset email goes to a fake mailbox locally (Ethereal), so the link cannot be read back; the token rules were checked with a known-value token.
- Punches made at the time clock are never rewritten; a correction is a manual entry.
- The receiving bank account is shown back to the tenant in full (it is their own data, not a credential).
- A booking carries one resource, so only the first "required" resource requirement of a service is applied.
- A promotion changes a price only through its code at checkout; prices shown while booking change through pricing rules.
- "Reset" on a booking means "undo check-in"; a completed booking cannot be reopened.
- Check-in settings (grace period, walk-ins on or off) are shared by all businesses of a tenant.
- The waitlist has no screen yet; it works through the API only.
- A customer login cannot create bookings on the staff endpoint; customers book through the widget and portal.

### Leftover test data
Tenant `E2E 20261012-6 SysTenant B` with business `E2E 20261012-6 Biz B`: three staff, a location, a room and a sauna cabin, services (Svc, Svc2, Massage, Sauna), about 60 people, bookings in the weeks of 19 and 26 October 2026 and a few on the day of the run, promotions, pricing rules, discount codes, a kiosk registration, billing plans and Stripe test charges. Seed business: staff login `e2e-20261012-6-reset@daystream.test`.

---

## Run 20261012-5 — remaining People screens (spec 46), exploratory
- Commit: `5d7937d` plus local changes · Migrations at: 136 · As: business owner, seed business
- Scope: the screens built in this round. Not a suite run

| Checked | Result |
|---|---|
| Segments: starter set listed in plain words, labelled Rules / Fixed list | Pass |
| Create a fixed list ("E2E VIP list") | Pass |
| Create a segment with a rule; live count before saving ("3 people match right now") | Pass |
| People list: hide Phone and Added columns; their filters go too; choice remembered | Pass |
| Tick all three people, bulk "Add to a fixed list", confirmation states "3 people", result "3 people changed" | Pass |
| Campaign form: audience picker; email "0 of 3 will receive it" (nobody agreed), SMS "1 of 3" with the reasons for the rest | Pass |
| Profile Financial Summary in euros (balance due, lifetime value, account credit) | Pass |

### Findings
| Id | Severity | Summary | State |
|---|---|---|---|
| D-21 | Low | Profile Financial Summary showed fixed placeholders | Fixed, test added |
| D-22 | High | A campaign could not be given an audience from the screen, so none could be sent since the segment became mandatory | Fixed |

Not exercised in the browser: bulk tag / owner / stage / archive (covered by unit tests), removing a person from a fixed list, editing an existing segment, reception seeing no bulk controls (CUS-27 cross-check).

### Leftover test data
In the seed business: fixed list `E2E VIP list` (3 people), segment `E2E leads`.

---

## Run 20261012-4 — People screens (spec 46), exploratory
- Commit: `37aad94` plus the uncommitted spec 46 work · Migrations at: 136 · As: business owner, seed business
- Scope: not a suite run. First look in the browser at screens that until now were covered only by unit tests
- Result: all screens work after four fixes

| Checked | Result |
|---|---|
| Menu and list named "People"; view tabs All / Leads / Customers / At risk / Former with counts; Source, Owner, Last activity columns | Pass |
| Add person with a phone number and no email (CUS-18) | Pass: saved as CUST-0003, source "Added by staff", marked Incomplete |
| Add person whose phone already exists | Pass: refused with "Open their profile" |
| Profile: fact strip, owner picker, stage | Pass (badge layout fixed) |
| Consent tab: switching SMS marketing on asks for a reason and shows it in the history | Pass (after D-20) |
| Possible-duplicate banner, merge preview, merge; old link redirects to the surviving person | Pass (after D-18) |
| Segments page lists the eight starter segments | Pass |

### Findings
| Id | Severity | Summary | State |
|---|---|---|---|
| D-17 | High | A refused "add person" filled in the existing person's empty details (an email was attached to someone else's record) | Fixed, test added |
| D-18 | High | After a merge the profile form kept its old values and offered them as unsaved changes | Fixed |
| D-19 | Medium | Date of birth did not show in the profile form and lost a day per save on a server outside UTC | Fixed |
| D-20 | Low | Consent reason asked through a browser pop-up; replaced by an inline field | Fixed |
| — | Low | Profile header badges stretched across the card; style warning on the view tabs; timeline not refreshed after a merge | Fixed |
| D-21 | Low | Profile Financial Summary shows fixed "$0.00 / Good" placeholders | Open |

### Leftover test data
In the seed business: `E2E PhoneOnly` (CUST-0003, SMS consent recorded) with two merged records behind it (CUST-0004, CUST-0005). The 17 stray people left by earlier test runs were removed.

---

## Run 20261012-3 — smoke (suite 00), after the second round of fixes
- Commit: `417c0e6` plus uncommitted local fixes · Migrations at: 135 · Processor mode: stripe-test
- Result: 20 passed · 0 failed · 0 blocked (of 20). SMK-11 (theme toggle) carried over from run 2; everything else re-executed
- Duration: about 20 minutes for the smoke part
- Method: as before, in the Chrome session chosen by the user

### What changed since run 2
| Area | Change |
|---|---|
| D-7 | Processor configuration is limited to the caller's own level (AUTH-21 verified through the API for owner, tenant and system) |
| D-8 | New `GET /bookings/filters`; Bookings list, booking create / edit and the calendar take the business time zone from it; login stores the currency for managers and staff. Reception now sees filled filters and no failed calls on `/bookings`; a booking stored at 10:00 UTC shows as 12:00 PM (business in Europe/Madrid) |
| PRE-08 | Server 895 of 895, client 186 of 186, shared 12 of 12, twice in a row |
| SMK-06 | Staff, resource and location detail open, using the E2E dummy records |
| SMK-08 | Widget lists "Fire & Ice · 1 hr 30 min · €80.00" for the seed business |

### Product bugs found by repairing the unit tests, all fixed
| # | Bug |
|---|---|
| 1 | Creating an API key always failed (12-character prefix into a 10-character column) |
| 2 | Staff and customer calendar-feed routes were unreachable (shadowed by the public token route) and feed content queried a column that does not exist |
| 3 | Financial report failed: AP / AR aging queries invalid; AR read a non-existent booking column (now aged from invoices); payroll total read non-existent columns |
| 4 | Memberships report, daily membership metrics and membership export read the retired membership tables |
| 5 | Daily check-in metrics read a table renamed in July (`check_in_records`) |
| 6 | Resource lookup for a service read a table renamed in July (`service_resource_requirements`) |
| 7 | Saving an active pay rule without retyping its dates failed (date object sent as text) |
| 8 | System accounts in the chart of accounts could be archived |
| 9 | Enrolling a customer who already has a membership returned a server error instead of a clear "already enrolled" (409) |
| 10 | Community reactions and reviews always failed (login id used as customer id) |
| 11 | Staff reference numbers collided once past STF-999, so creating staff failed |
| 12 | Unit tests wiped tenant-wide data in the development database on every run (staff, resources, events, check-in records) |

### New findings, open
| Id | Severity | Summary |
|---|---|---|
| D-10 | Medium | Reception / therapist on `/bookings/calendar`: 403 on `/locations` and `/services` |
| D-11 | Low | `/check-in` logs a React duplicate-key warning |
| D-12 | Low | Seeded service "Fire & Ice" references a deleted resource (404 on booking edit, page still works) |
| D-13 | Medium | Community: challenges, points, badges and courses still use the login id as customer id |
| KI-12 | Gap | No way to configure the booking widget from the product |

### Leftover test data
Kept on purpose in the seed business `…0002`: customer James Wilson and booking `BK-2026-0004` (2026-10-20), `E2E Therapist` (login `e2e.therapist@daystream.test`), `E2E Treatment Room`, `E2E Main Location`, time zone Europe/Madrid, widget enabled.

---

## Run 20261012-2 — smoke (suite 00), after fixes
- Commit: `417c0e6` plus uncommitted local fixes · Migrations at: 135 · Processor mode: stripe-test (sandbox connection saved at platform, tenant and business level; connection test passed)
- Result: 17 passed · 1 failed · 2 blocked · 0 skipped (of 20). PRE-01 to PRE-07 and PRE-09 carried over from run 1 except PRE-02 (135 = 135), PRE-07 (now test mode) and PRE-09 (server 0, client 30 type errors), which were re-checked
- Duration: about 25 minutes
- Method: as run 1, in the Chrome session chosen by the user; screenshots taken for the query editor, "Customer not found" and the customer's My Bookings screen

### Failures
| Script | Step | Expected | Actual | Evidence | Verdict |
|---|---|---|---|---|---|
| PRE-08 | 1 | All Vitest suites pass | Server 220 of 960 fail (34 files); client 3 of 187 fail (`BookingEdit`, `DayPicker`, `ThemeProvider`); `moduleRegistry` now passes (15 of 15) | Test output | Stale tests (KI-10): files unchanged since July while the code moved on |

### Re-verified fixes
| Defect | Check | Result |
|---|---|---|
| D-1 | Owner opens `/marketing`, `/cms`, `/cms/blog`, `/cms/media`, `/integrations`, `/check-in` | Data loads, no failed calls. Reception reaches `/check-in`; reception gets 403 on marketing |
| D-2 | Sign out in the UI, then refresh with the pre-logout token | 401 |
| D-3 | Customer sidebar and routes | Sidebar: Dashboard, Bookings/Orders only. `/customers`, `/clock`, `/admin/tenants` land on `/dashboard`. `/bookings` is "My Bookings", read-only |
| D-4 | Customer token on bookings API | Lists only its own booking; another booking's detail and iCal return 404; calendar returns 403 |
| D-5 | Server start log | No `ERR_ERL_PERMISSIVE_TRUST_PROXY` after the change (local). Production unchanged until `TRUST_PROXY` is set |
| D-6 | Open a non-existent customer | "Customer not found", no unhandled rejection |

### New findings
| Id | Severity | Summary |
|---|---|---|
| D-7 | High (security) | `/pay/processors/config` (read, test, save) checks only `settings:*`: a business owner can address the platform level or another tenant / business. Read confirmed; write not attempted. Not fixed (spec 10 code in progress) |
| D-8 | Medium | Staff (reception, therapist) on `/bookings`: 403 on `/admin/businesses`, `/staff`, `/services`. Filters are empty and the business time zone is never loaded, so times show in UTC. Managers also get 403 on `/admin/businesses`. Not fixed |
| — | Low | A `fulfillment_token` key was present in local storage after logout in this browser profile; origin not traced |

### Blocked / skipped
| Script | Reason |
|---|---|
| SMK-06 | Customer detail, service detail and booking edit open. No staff, resource or location exists in the seed business (KI-9) |
| SMK-08 | Not repeated; the widget is still not enabled for the seed business |

### Script corrections made after this run
| Script | What changed and why |
|---|---|
| PRE-07 | Query parameters are `tenant_id` / `business_id`, not `owner_id` (run 1 queried the wrong scope for tenant and business) |
| SMK-07 | Expectation now describes the customer's read-only "My Bookings" and the redirects |

### Leftover test data
Kept on purpose: customer "James Wilson" (`customer@transcend.test`) in business `…0002` and booking `BK-2026-0004` on 2026-10-20, so the customer login has something of its own to show. The second `npm run test` pass added more test tenants / businesses to `daystream_dev` (KI-10).

---

## Run 20261012-1 — smoke (suite 00)
- Commit: `417c0e6` · Migrations at: 134 (115–134 applied at the start of this run) · Processor mode: mock (no connection configured at platform, tenant or business level; no Stripe keys in `.env`)
- Result: 12 passed · 6 failed · 2 blocked · 0 skipped (of 20)
- Duration: about 45 minutes, including `npm install`, migrations and calibration of the scripts
- Method: API checks with curl; screens toured in Chrome with a probe recording, per screen, the heading, visible error text, failed API calls and console errors. Screens were not all inspected visually.

### Failures
| Script | Step | Expected | Actual | Evidence | Verdict |
|---|---|---|---|---|---|
| PRE-08 | 1 | All Vitest suites pass | Client: 8 of 185 tests fail in 4 files (`moduleRegistry` 5, `ThemeProvider` 1, `BookingEdit` 1, `DayPicker` 1). Server: 222 of 960 fail in 35 files (mostly 500 / 404 where 200 / 201 expected, and `Cannot destructure property 'rows'`). Shared: 12 of 12 pass. Root script also exits non-zero because `packages/mobile` has no `test` script | Test output of this run | Not classified: there is no earlier baseline, so it is unknown which failures came with commit `417c0e6` |
| SMK-01 | 1 | Sidebar matches the persona | Customer persona's sidebar shows **Time Clock** and **My Hours** (staff features). Other six personas correct | Sidebar text after login | product defect (D-3) |
| SMK-04 | 1 | Each screen opens cleanly | As owner, `/marketing` and `/cms` render but their API calls return 403 "Insufficient permissions"; the pages show an empty state ("No pages yet") instead of an error | `GET /api/v1/marketing/campaigns`, `/marketing/sequences`, `/cms/site`, `/cms/pages` → 403 | product defect (D-1) |
| SMK-04 | 1 | Customers, Offerings and calendar show seeded data | The seed accounts' business (`…0002` "DayStream") holds 1 customer, 1 service, 3 bookings, no staff, resources or locations. The populated demo data is in another business ("Transcend Health", `83e81f01…`) that none of the seed logins belongs to | Database counts per business | environment (KI-9) |
| SMK-05 | 1 | Each screen opens cleanly | As owner, 403 on `/check-in` (`/check-in/dashboard`), `/cms/blog`, `/cms/media`, `/integrations` (`/integrations/marketplace`). The other 17 screens open cleanly | Probe output | product defect (D-1) |
| SMK-07 | 1 | Customer self-service shows only own data | `/bookings` for a customer is the staff Appointments screen (New Appointment, New Sale, staff filter) and fires three 403 calls (`/admin/businesses`, `/staff`, `/services`). `/customers` also renders for a customer (data refused with 403). Through the API the customer token lists all 3 bookings of the business, none linked to that customer (`customer_id` null) | Screenshot of `/bookings` as James Wilson; `GET /api/v1/bookings` with the customer token | product defect (D-3, D-4) |
| SMK-10 | cross-check | Refresh token no longer works after logout | `POST /api/v1/auth/refresh` with the pre-logout refresh token returns 200. Browser side passes (login page after back, tokens removed from storage) | Response status | product defect (D-2) |

### Defects found
| Id | Severity | Summary |
|---|---|---|
| D-1 | High | The seeded **Business Owner** role has no `marketing:*`, `cms:*`, `integrations:*` or check-in permission, but the sidebar offers Marketing and Website and the routes open. Six owner screens are unusable, and they hide the 403 behind an empty state. |
| D-2 | High (security) | Logout does not revoke the refresh token. Likely cause, not confirmed: `AuthContext.logout()` fires `POST /auth/logout` without waiting and the page reloads at once, cancelling the request. |
| D-3 | High | Customer persona gets staff navigation and staff screens: Time Clock, My Hours, the staff Appointments screen, and an unguarded `/customers` route. |
| D-4 | High (isolation, to confirm) | A customer token can list bookings of the business that do not belong to that customer. Seen with bookings whose `customer_id` is null; AUTH-suite scripts must confirm with bookings owned by another customer. |
| D-5 | Medium | Server start logs `ERR_ERL_PERMISSIVE_TRUST_PROXY`: `trust proxy` is `true`, which lets a client bypass the IP-based login rate limit with a forged header. |
| D-6 | Low | Booking edit for booking `f564aa39…` requests a resource that returns 404; the page still renders. Opening a non-existent customer shows "Customer not found" correctly but logs an unhandled promise rejection. |

### Blocked / skipped
| Script | Reason |
|---|---|
| SMK-06 | Customer detail (all five tabs), service detail and booking edit opened. Staff, resource and location detail could not be opened: the seed accounts' business has none (KI-9) |
| SMK-08 | `/login` and `/forgot-password` pass. The widget answers "Widget is not enabled for this business" (a correct, friendly state); listing offerings needs the widget enabled first |

### Script corrections made after this run
| Script | What changed and why |
|---|---|
| PRE-06 | Login needs `tenant_id` in the body; the persona is not in the token, so the check now reads `user.role` |
| PRE-07 | The endpoint needs `owner_level` (and `owner_id`); "nothing configured" (`data: null`) counts as safe |
| PRE-08 | Warning added: server tests write to `daystream_dev`; the root script fails on `packages/mobile` |
| PRE-09 | Client baseline recorded: 31 type errors |
| SMK-08 | Widget URL needs `business_id` and `product_id`, and the widget must be enabled |

### Leftover test data
The smoke scripts created nothing. PRE-08 (`npm run test`) added 1 tenant and 2 businesses ("Other AP Biz", "Other BK Biz", "Test Provisioning Tenant") to `daystream_dev`, on top of about 65 similar leftovers from earlier test runs. Not removed.
