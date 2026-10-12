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
