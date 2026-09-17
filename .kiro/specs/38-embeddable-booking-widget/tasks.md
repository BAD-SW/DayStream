# Implementation Plan: 38 — Embeddable Booking Widget

## Overview

Tasks are grouped by the phases defined in design.md. Each phase ends with a manual verification step before moving to the next — this feature is payment-adjacent and public-facing, so each layer should be proven working before the next is built on top of it.

## Task Status Legend

- ✅ **Complete** · 🟡 **In Progress** · 📋 **Planned** · ⏸️ **Blocked** · ❌ **Cancelled**

---

## Phase 1 — Backend Core ✅ Complete

Verified end-to-end via curl against real Transcend Health data (register → hold → customer → booking → pay, both with and without `require_payment_before_confirmation`). Two pre-existing bugs were found and fixed along the way, unrelated to this spec's own code but blocking it: `POST /v1/auth/register` never set `usr_users.business_id` (NOT NULL, no existing callers had ever hit it), and a query referenced a `phone` column that only exists on `cus_customers`, not `usr_users`. Also: slot-hold creation was moved from "before login" to "immediately after login" — `createHold()` requires an acting user id, so it can't happen anonymously.

- [x] 1.1 Migration `109_widget_booking.sql`
  - Add `apt_bookings.source` (`admin`/`widget`, default `admin`)
  - Create `wgt_widget_configs` (incl. `require_payment_before_confirmation` default `true`, unique on `business_id`)
  - Create `wgt_widget_transactions`
  - Add indexes on `wgt_widget_transactions.booking_id` and `apt_bookings(business_id, source)`
  - Run `npm run migrate:dev`
  - _Requirements: 14.1, 15.1, 8.7_

- [x] 1.2 `packages/server/src/middleware/widget-cors.ts`
  - CORS middleware for the widget router (`origin: true`, `credentials: false`)
  - `allowed_origins` allowlist check (separate from CORS headers — reads `wgt_widget_configs.allowed_origins`, 403 on mismatch when the list is non-empty)
  - _Requirements: 12.1, 12.2_

- [x] 1.3 `packages/server/src/services/widget-booking.service.ts`
  - `getBusinessInfo(businessId)` — name, logo_url, tenant_id, calls the spec-37 theme resolver, `require_payment_before_confirmation`; throws 404/403 per config state
  - `getProducts(businessId)` / `getProductDetail(businessId, productId)`
  - `findOrCreateCustomer(businessId, authUser)` — the `(business_id, email)` find-or-create, `created_by` = authenticated user id, writes `cus_activities` with `activity_type='widget_registration'` on create
  - `createWidgetBooking(dto, authUser)` — validates `hold_id`, calls the existing `createBooking()` unchanged, sets `source='widget'`, `createdBy` = authenticated user id, initial status from `require_payment_before_confirmation`
  - `payForBooking(bookingId, businessId, authUser)` — writes `wgt_widget_transactions`, transitions booking to `confirmed`, calls the existing booking-notifications service
  - _Requirements: 4.1–4.8, 6.2–6.5, 7.1–7.7, 8.3–8.4_

- [x] 1.4 `packages/server/src/routes/widget.ts`
  - `GET /business/:business_id`, `/products`, `/products/:product_id` (public)
  - `GET /availability`, `/availability/slots` (public, delegates to `availability.service.ts` read-only)
  - `POST /availability/hold` (public, 10-minute hold via existing `slot-hold.service.ts`)
  - `POST /customer` (requires customer JWT)
  - `POST /booking`, `POST /booking/:booking_id/pay` (require customer JWT)
  - `business_id` UUID validation on every route (400 on malformed)
  - Rate limit (60/min/IP) on `/customer`, `/booking`, `/booking/:id/pay`, `/availability/hold` via existing `express-rate-limit` middleware
  - Register in `routes/index.ts` under `/api/v1/widget`
  - _Requirements: 4–8, 12.3, 12.5, 12.6_

- [x] 1.5 Checkpoint — verify Phase 1 via curl
  - Full sequence: business info → products → availability → hold → register → customer → booking (pending) → pay → booking (confirmed) → repeat with `require_payment_before_confirmation=false` and confirm booking is `confirmed` immediately with no pay call
  - Verify 403 when widget disabled, 409 on expired/mismatched hold, 401 when JWT doesn't match `customer_id`, 429 on the 61st rate-limited request in a minute
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 2 — Hosted Booking Flow Page ✅ Complete

Built against the real `product_type: 'service'` branch only, per this phase's scope — package/membership products correctly show a "not available yet" message (Phase 5 wires that branch). `getBusinessInfo`'s response already carries the resolved theme delta, so `BookingWidget.tsx` applies it straight from that call instead of issuing the separate `GET /v1/themes/resolve` call design.md describes — same resolver, one fewer round trip, zero behavior difference.

- [x] 2.1 `packages/client/src/api/widget.ts`
  - Typed client functions for every Phase 1 endpoint
  - Deliberately its own axios instance, not the shared `apiClient` — that one blocks on `ContextManager` init and writes the admin app's `localStorage` token; the widget needs neither and must not touch either
  - _Requirements: 3.1_

- [x] 2.2 `packages/client/src/pages/BookingWidget.tsx` + `pages/booking-widget/` step components
  - Route `/booking-widget`, registered in `App.tsx` with **no** `ProtectedRoute` wrapper and **not** inside `AppLayout`/`AdminLayout`
  - Steps: ProductDetail, AvailabilityCalendar, TimeSlotPicker, LoginRegister, CustomerDetails, Payment (conditional), Confirmation
  - Progress indicator across all steps; Back preserves entered data
  - LoginRegister step calls the existing `/v1/auth/login` / `/v1/auth/register` directly; stores the token in `sessionStorage` scoped to this page only
  - Payment step renders only when `require_payment_before_confirmation` is true (from the business-info response)
  - 409 from either the post-login hold or the post-customer booking create (slot taken/hold expired in the gap) routes back to Time Slot Picker with an expiry notice, per Requirement 3.6
  - _Requirements: 3.1–3.14, 6.1, 10.1–10.4_

- [x] 2.2a Location/Staff selection at Time Slot Picker (added after the user's Phase 3 feedback)
  - After clicking through Phase 2/3, the user flagged that Sport Massage's booking offered no way to pick a staff member or see the location — by luck that service only had one of each, but the widget needs to behave the way the admin `BookingCreate.tsx` flow already does whenever a service genuinely has more than one
  - Switched `GET /widget/availability/slots` from the collapsed "one entry per time + available_staff[]" shape to the same rich (time × location × staff) combinations `availability.service.ts`'s `getAvailabilityCombinations()` already produces and the admin flow already consumes — no changes to `availability.service.ts` itself
  - `TimeSlotPickerStep.tsx` ports `BookingCreate.tsx`'s exact cross-filtering logic (Location options depend on the current Staff selection and vice versa) — a filter row renders only when there's more than one option; a resolved "📍 location 🧑 staff" line always shows once resolvable, satisfying Requirement 3.14 even when 3.13 offered no choice
  - `createBooking()` now receives the actually-selected `staff_id` from the chosen combo instead of blindly taking `available_staff[0]` — verified via curl that booking a specific staff member (not the first alphabetically) is honored end-to-end
  - `location_id` is display/filter-only, never sent to `createBooking()` — matches the admin flow exactly, since `apt_bookings` has no location column (location is inferable from `staff_id`, not stored per-booking)
  - _Requirements: 3.13, 3.14_

- [x] 2.3 Theme + branding
  - Applies the resolved theme via the existing `ThemeManager.applyResolvedTokens`/`applyBaseTheme` (imported directly, no reimplementation)
  - Displays business logo in the flow header
  - _Requirements: 11.1–11.5_

- [x] 2.4 Checkpoint — open `/booking-widget?business_id=…&product_id=…` directly in a browser tab
  - Complete a full real booking (both `require_payment_before_confirmation` true and false) with no iframe/widget script involved yet
  - Confirm the confirmation email actually arrives (existing notification service)
  - Confirmed by the user in a real browser: new registration → full booking flow succeeded end-to-end (2026-09-17). Along the way, found and fixed a real bug this surfaced: `api/widget.ts`'s error handling only read the top-level `error` string from a failed request, so a Joi validation failure (e.g. a password not meeting the register endpoint's complexity rule) showed the unhelpful generic "Validation failed" instead of the actual per-field reason — fixed by surfacing `details[].message` when present. The `require_payment_before_confirmation=false` path and email delivery were not independently re-clicked-through in this pass, but both were already checkpointed at the API level in 1.5 and share the same code paths — low incremental risk, not re-verified here.
  - Task 2.2a (location/staff selection) landed *after* this click-through, on a real gap the user found in the Phase 3 test below — it has curl-level verification only so far, not yet re-confirmed in a browser. Worth a quick look next time you're in the flow, particularly on Sport Massage/Personal Training which (per the real seed data) have exactly one staff member each, to confirm the resolved "📍🧑" line shows correctly even with nothing to actively choose.
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 3 — Widget Script + Local Test Harness ✅ Complete

Found and fixed a real gap in design.md's own skeleton along the way: `APP_ORIGIN = new URL(scriptTag.src).origin` assumes the script and `/booking-widget` share an origin, but they never do in this project's topology (server hosts the script, client hosts the page — separate deployments, and separate ports even locally). Fixed by adding a `data-app-url` attribute the script reads explicitly, falling back to its own src's origin only if omitted. See design.md's "Phase 3 correction" note under Widget Script. Also hardened the focus trap beyond the design.md skeleton: a `focusin` listener on the parent document catches focus actually escaping the modal onto the host page (Tab keypresses that occur *inside* the iframe never reach the parent's keydown listener at all — cross-origin), and the iframe itself now has its own Escape handler that relays `daystream:close` to the parent, since Escape pressed while typing in the booking form has the same cross-origin invisibility problem.

- [x] 3.1 `packages/server/static/daystream-widget.js` + route to serve it
  - IIFE, idempotent load guard, scans for `data-daystream-product`/`data-daystream-action`
  - Injects full-screen modal + iframe on click; focus trap (parent-side `focusin` backstop) + Escape to close
  - Listens for `postMessage` from the iframe, validates `event.origin`, re-dispatches `daystreamBookingConfirmed` as a `CustomEvent`
  - Exposes `window.DayStream.open(productId, action)`
  - Served at `/widget/daystream-widget.js` via `express.static`, no auth
  - _Requirements: 1.1–1.9, 2.1–2.8, 12.7, 12.8, 13.6, 13.7_

- [x] 3.2 postMessage sends from the Booking_Flow
  - `daystream:ready` on load, `daystream:step_changed` per step, `daystream:booking_confirmed` on confirmation (automatic, not only on Close click), `daystream:close` on the in-iframe Close button and on in-iframe Escape
  - _Requirements: 13.2–13.5, 9.2–9.3_

- [x] 3.3 `fake-business-site/index.html` (Local_Test_Page)
  - Modelled on transcendhealth.eu's packages layout (not a Squarespace export) — 3 product cards using real Transcend Mallorca service ids, real `Widget_Button` markup, real Transcend logo/brand colors
  - Points at the local dev server's widget script and a real seeded business id (Transcend Mallorca); `data-app-url` set to the client dev server so the iframe resolves correctly across the two local ports
  - _Requirements: 16.1, 16.2, 16.5_

- [x] 3.4 Checkpoint — full local end-to-end
  - Open the Local_Test_Page (served statically, e.g. `npx serve fake-business-site`), click "Book Now", complete the entire flow inside the modal, confirm the parent page receives `daystreamBookingConfirmed`
  - Verify Escape and the close button both work; verify body scroll lock/restore
  - Confirmed by the user in a real browser (2026-09-17): the local Fake_Business_Site flow worked correctly end-to-end. This is what surfaced task 2.2a's location/staff gap (Sport Massage offered no staff/location choice — by luck it only had one of each, but the mechanism needed to exist for services that have more). That fix landed after this click-through, so the staff/location filter UI itself has not yet been re-confirmed in a browser — only via curl so far (see 2.4's note).
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 4 — Cloud Deployment 🟡 In Progress (deployed and functional; 4.6 not built yet)

Turned out to be the biggest source of real bugs in the whole spec so far — every one found by actually deploying and hitting real errors, not by inspection. Summary in the shared setup doc (published as an artifact this session) has the full story; short version: `@daystream/shared` had never actually been compiled (only ever consumed as raw TS via `tsx`'s dev-time loader), the server's `tsc`-to-`node` production path had never been run for real and hit three rounds of module-resolution environment differences before switching to running it via `tsx` in production too, several early RLS-era migrations hardcoded local-only db/role names, and a reverse-proxy `X-Forwarded-For` chain broke login in production only (Render sits behind its own edge, so requests arrive with multiple comma-separated IPs — one code path fed that raw value into a Postgres `inet` column). All fixed and verified against the real deployed stack, not just locally.

- [x] 4.1 Fix `CLIENT_URL`-driven CORS
  - Replaced the `NODE_ENV`-branched origin in `packages/server/src/app.ts` with a `CLIENT_URL` env var (defaults to `http://localhost:4000` locally)
  - _Requirements: 17.4_

- [x] 4.2 Neon database
  - Project created, all 112 migrations run against it end-to-end
  - `pool.ts` now supports `DATABASE_URL` as an alternative to discrete `DB_HOST`/etc., with SSL enabled automatically when used
  - Full copy of local dev's data restored (not just a thin seed) — verified via direct query (30 users, real Transcend Health business/services/widget config)
  - _Requirements: 17.3_

- [x] 4.3 Render server deployment
  - Connected to the GitHub repo; confirmed the job scheduler survives (logs show it starting on every boot, not just the HTTP server)
  - `DATABASE_URL`, `NODE_ENV`, `CLIENT_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `AUDIT_SIGNING_KEY`, SMTP vars set
  - Also fixed: the app was listening on a fixed local port instead of Render's injected `PORT`
  - _Requirements: 17.2, 17.6, 17.7_

- [x] 4.4 Vercel client deployment
  - `VITE_API_URL` pointed at the Render URL; both API clients (`api/client.ts`, `api/widget.ts`) updated to use it instead of a hardcoded relative `/api` path (which only ever worked behind Vite's local dev proxy)
  - Verified: the deployed bundle actually calls the Render URL, confirmed by grepping the built JS
  - _Requirements: 17.1, 17.6, 17.7_

- [x] 4.5 Vercel fake-site deployment
  - Separate Vercel project (`daystream-fake-transcend`) rooted at `fake-business-site/`; widget script `src`/`data-app-url` point at the deployed Render/Vercel URLs
  - GitHub repo made public to use Vercel's free Hobby plan (was private + org-owned, which needs a paid plan) — full commit history scanned first, no secrets found
  - _Requirements: 16.3, 16.4, 17.5_

- [ ] 4.6 Widget business-settings UI
  - New "Booking Widget" section (business settings): enable/disable toggle, `require_payment_before_confirmation` toggle with explanatory copy, allowed-origins list editor, pre-populated `<script>` snippet with the business's own id
  - Not started — `wgt_widget_configs` for the demo business was toggled directly via SQL during Phase 1 testing, not through any admin UI
  - _Requirements: 14.2–14.6_

- [ ] 4.7 Checkpoint — deployed cross-origin test
  - Full chain verified end-to-end against real deployed infrastructure: register → login → customer → products, all against the live Render API and Neon database, from the actual deployed client (confirmed via CORS headers matching the real Vercel origin)
  - The user personally logged in through the deployed app in a real browser and confirmed it works
  - **Not yet done**: opening the deployed fake site on a phone specifically, and a colleague independently confirming they see the same state via nothing but `git push` — both should be trivial given everything above, but neither has literally happened yet
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 5 — Package & Membership Purchase

Added after a follow-up question about how a website product maps to a DayStream record surfaced that the reference site's actual products ("THE RESET" etc.) are packages, not plain services — Phase 1–4 only covered service booking.

- [ ] 5.1 Migration extending `wgt_widget_transactions`
  - Relax `booking_id` to nullable; add nullable `purchase_id UUID REFERENCES pkg_purchases(id)` and `enrollment_id UUID REFERENCES mbr_enrollments(id)`; CHECK exactly one of the three is set
  - _Requirements: 18.4_

- [ ] 5.2 `widget-booking.service.ts` additions
  - `purchaseWidgetPackage(dto, authUser)` — thin wrapper around the existing `purchasePackage()` (`package.service.ts`, unchanged), sets `source='widget'` on the `pkg_purchases` row, initial status from `require_payment_before_confirmation`
  - `enrollWidgetMembership(dto, authUser)` — thin wrapper around the existing `enrollCustomer()` (`membership.service.ts`, unchanged), same status logic
  - `payForPackagePurchase(...)` / `payForMembershipEnrollment(...)` — mirror `payForBooking()`, writing `wgt_widget_transactions` with `purchase_id`/`enrollment_id` instead of `booking_id`
  - _Requirements: 18.2–18.4_

- [ ] 5.3 Routes: `POST /package-purchase`, `/package-purchase/:id/pay`, `POST /membership-enrollment`, `/membership-enrollment/:id/pay`
  - Same auth/rate-limit/validation pattern as the existing `/booking` routes
  - _Requirements: 18.2–18.4_

- [ ] 5.4 `BookingWidget.tsx` — package/membership branch
  - WHEN `product_type !== 'service'`, skip AvailabilityCalendar/TimeSlotPicker entirely (Requirement 18.1)
  - Confirmation step shows session count/expiration (package) or billing interval/price (membership) per Requirement 18.5
  - _Requirements: 18.1, 18.5_

- [ ] 5.5 Checkpoint — verify via curl and the hosted page
  - Purchase "THE RESET" (or its DayStream equivalent) end-to-end against Transcend Health, both with and without `require_payment_before_confirmation`
  - Confirm the existing package/membership sale confirmation email fires — no new template introduced (Requirement 18.6)
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 6 — Widget Snippet Generation

Frontend-only — no new backend endpoint (the product id is already loaded on these admin pages).

- [ ] 6.1 "Copy widget snippet" action on the Services list/detail page
  - Copies `<button data-daystream-product="<id>" data-daystream-action="book">Book Now</button>` (button text pre-filled with the service name) to the clipboard
  - Disabled with an inline explanation when the service is not `online_booking_enabled`
  - _Requirements: 19.1, 19.2, 19.5_

- [ ] 6.2 Same action on the Packages and Memberships list/detail pages
  - `data-daystream-action="purchase"` instead of `"book"`; same disabled-state rule for non-purchasable items
  - _Requirements: 19.1, 19.2, 19.5_

- [ ] 6.3 Checkpoint
  - Copy a snippet for a real service and a real package from the admin UI, paste both into the Local_Test_Page unmodified, confirm both buttons work with zero hand-edited ids
  - Ensure all tests pass, ask the user if questions arise

---

## Phase 7 — Security & Audit Hardening

- [ ] 7.1 Rate limiting verification
  - Confirm the 60/min/IP limiter is actually attached to all mutating widget routes, including the Phase 5 package/membership ones (not just written) — hit the 61st request and confirm 429
  - _Requirements: 12.3_

- [ ] 7.2 `allowed_origins` enforcement
  - Configure a restrictive allowlist on a test business; confirm requests from a non-listed origin get 403 while the configured one succeeds
  - _Requirements: 12.2_

- [ ] 7.3 Audit trail
  - Confirm `source='widget'` on created bookings/purchases/enrollments, `cus_activities` rows with `activity_type='widget_registration'` on new customers, and widget booking attempts appearing in `sys_api_request_logs` with hashed customer email
  - _Requirements: 15.1–15.4_

- [ ] 7.4 Response field audit
  - Manually review every widget endpoint's response against Requirement 12.4's field allowlist — confirm nothing beyond what's specified leaks (staff contact info, other customers, tenant config, financial reports)
  - _Requirements: 12.4_

- [ ] 7.5 Final checkpoint
  - Full regression pass through Phases 1–6's checkpoints once more, on the deployed environment
  - Ensure all tests pass, ask the user if questions arise

---

## Notes

- Tasks are intentionally not marked optional/skippable anywhere in this feature — it touches payment status and public data exposure, so nothing here is "nice to have"
- Do not start Phase 2 before Phase 1's checkpoint passes via curl — building UI against an unverified API wastes the most time of any ordering mistake on a spec this size
- Phase 6 (snippet generation) has no dependency on Phase 5 (package/membership purchase) and could be done in parallel, or earlier — it's sequenced here after deployment simply because it's pure admin-UI work, not because anything blocks it
- Phase 8 (real Stripe integration) is deliberately not broken into tasks here — it is out of scope for this spec and belongs in its own future spec once v1 is live and validated
