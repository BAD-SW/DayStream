# Design Document: 38 — Embeddable Booking Widget

**Date**: September 2026
**Status**: 🎨 Design Phase
**Dependencies**: Spec 07 (Booking Engine), Spec 37 (Theme Setup)
**Supersedes**: KIRO's initial draft — architecture confirmed, requirements amended (auth-required booking, configurable payment-before-confirmation, deployment, test site)

---

## Overview

Three things ship together here, because none of them is genuinely testable without the others:

1. **The widget itself** — a vanilla-JS snippet + full-screen modal + hosted iframe booking flow, talking to a new public-ish `/api/v1/widget/*` API that wraps existing booking/availability/customer services.
2. **A fake business site** — local and deployed — because the widget's entire point is cross-origin embedding, which `localhost` can't honestly simulate.
3. **Cloud deployment** — client on Vercel, server on Render, database on Neon — because testing "from any device" and sharing with a colleague both require it, and because deploying early means the cross-origin behavior in (2) is tested for real rather than assumed.

The booking flow itself differs from a typical embeddable widget in one deliberate way: **there is no guest checkout.** A visitor must log in or register before a booking is created. This was a specific, explicit decision (not a KIRO carryover) and it simplifies several things that would otherwise need new machinery — most importantly, `createBooking()`'s required `createdBy` field is just the authenticated visitor's own user id, and registration/login reuse the existing `/v1/auth/register` and `/v1/auth/login` endpoints unchanged.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Database Schema](#database-schema)
3. [Product Identity — Snippet Generation](#product-identity--snippet-generation)
4. [Booking Flow Sequence](#booking-flow-sequence)
5. [Package and Membership Purchase Flow](#package-and-membership-purchase-flow)
6. [API Contracts](#api-contracts)
7. [CORS Design](#cors-design)
8. [Widget Script](#widget-script)
9. [postMessage Contract](#postmessage-contract)
10. [Payment-Required Configuration](#payment-required-configuration)
11. [Theme Integration](#theme-integration)
12. [File Layout](#file-layout)
13. [Deployment Topology](#deployment-topology)
14. [Phases](#phases)
15. [Error Handling](#error-handling)
16. [Testing Strategy](#testing-strategy)

---

## Architecture

```
transcendhealth.eu (or the Fake_Business_Site)
  │
  │  <script src=".../widget/daystream-widget.js" data-business-id="…">
  │  <button data-daystream-product="pkg-123" data-daystream-action="purchase">Book Now</button>
  │
  ▼
Widget_Script (IIFE, vanilla JS)
  │  click → injects full-screen modal <div> + <iframe src="…/booking-widget?business_id=…&product_id=…&action=…">
  ▼
Booking_Iframe → DayStream-hosted /booking-widget page (React, standalone route, no AppLayout)
  │
  │  Step 1  Product Detail        GET /api/v1/widget/business/:id/products/:productId
  │  Step 2  Availability Calendar GET /api/v1/widget/availability
  │  Step 3  Time Slot Picker      GET /api/v1/widget/availability/slots
  │                                POST /api/v1/widget/availability/hold  (public, 10 min hold)
  │  Step 4  Login / Register      POST /v1/auth/login  |  POST /v1/auth/register   (existing, unchanged)
  │                                → JWT held in iframe's own sessionStorage only
  │  Step 5  Customer Details      POST /api/v1/widget/customer   (authenticated)
  │  Step 6  Payment (conditional) POST /api/v1/widget/booking    (authenticated) → status pending|confirmed
  │                                POST /api/v1/widget/booking/:id/pay  (authenticated, only if required)
  │  Step 7  Confirmation          postMessage → parent
  ▼
window.parent.postMessage({ type: "daystream:booking_confirmed", ... })
  │
  ▼
Widget_Script re-dispatches window.dispatchEvent(new CustomEvent("daystreamBookingConfirmed", { detail }))
  → the business's own page JS can listen and show a thank-you banner
```

Everything below the iframe boundary is a normal, same-origin DayStream page talking to DayStream's own API — the only genuinely new cross-origin surface is the `Widget_Script` on the business's page and the `/api/v1/widget/*` endpoints it (indirectly, via the iframe) calls.

---

## Database Schema

### Migration `109_widget_booking.sql`

```sql
-- Booking source tracking (does not exist yet)
ALTER TABLE apt_bookings
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'widget'));

-- Per-business widget configuration
CREATE TABLE IF NOT EXISTS wgt_widget_configs (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id                       UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  is_enabled                        BOOLEAN NOT NULL DEFAULT false,
  require_payment_before_confirmation BOOLEAN NOT NULL DEFAULT true,
  allowed_origins                   TEXT[],
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id)
);

-- Simulated payment transactions
CREATE TABLE IF NOT EXISTS wgt_widget_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES apt_bookings(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  currency      VARCHAR(3) NOT NULL DEFAULT 'EUR',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'simulated' CHECK (payment_method IN ('simulated')),
  status        VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wgt_widget_transactions_booking_idx ON wgt_widget_transactions (booking_id);
CREATE INDEX IF NOT EXISTS apt_bookings_source_idx ON apt_bookings (business_id, source);
```

**Schema notes**
- `require_payment_before_confirmation` defaults to `true` — matches Requirement 8's default. A row must exist and `is_enabled = true` before the widget serves anything for that business (Requirement 4.8) — the business settings UI (Phase 4) creates this row on first save; until then, `GET /widget/business/:id` returns 403.
- `wgt_widget_transactions.status` only has `completed`/`failed` (no `pending`) — a simulated payment is synchronous, there's no async processor callback to wait on.
- No RLS policies (matches this project's post-#43 convention of application-level `tenant_id`/`business_id` filtering, not database RLS — see migrations 089+).
- **Phase 5 addendum** (package/membership purchase, added after Phase 1 shipped): `wgt_widget_transactions.booking_id` was `NOT NULL` in migration 109 because only service bookings existed yet. A later migration (numbered whenever Phase 5 starts — migrations are append-only in this project, 109 is not edited retroactively) relaxes it to nullable and adds nullable `purchase_id UUID REFERENCES pkg_purchases(id)` and `enrollment_id UUID REFERENCES mbr_enrollments(id)` columns, plus a CHECK that exactly one of `booking_id`/`purchase_id`/`enrollment_id` is set per row.

---

## Product Identity — Snippet Generation

The question this section answers: *how does a business relate a product card on their own website to a specific DayStream record?* Answer: they never do it by hand. `data-daystream-product` is a DayStream `services`/`pkg_packages`/`mbr_plans` primary key, and the business gets it exclusively by clicking **"Copy widget snippet"** on that item's existing management page in the Offerings admin UI (Requirement 19) — the same place they already set its name, price, and description.

```
Offerings → Services → "Red Light Therapy" → [Copy widget snippet]
  → clipboard: <button data-daystream-product="cc54745c-…" data-daystream-action="book">Red Light Therapy</button>

Offerings → Packages → "THE RESET" → [Copy widget snippet]
  → clipboard: <button data-daystream-product="<pkg id>" data-daystream-action="purchase">THE RESET</button>
```

No new backend endpoint is needed for this — the admin page already has the item's `id` loaded to render the page itself; "Copy widget snippet" is a `navigator.clipboard.writeText(...)` call in the existing React component, templating the id and name it already has in hand. The business pastes the button into their site, replaces the default text/styling with their own, and is done — the widget script (already reading `data-daystream-product`/`data-daystream-action` per Requirement 1.3) needs no changes to support this.

`product_type` (`'service' | 'package' | 'membership'`) is *not* part of the snippet — it's resolved server-side from the id when `GET /widget/business/:id/products/:product_id` is called, which is what determines whether the Booking_Flow takes the service path (Requirement 3) or the package/membership path (Requirement 18).

---

## Booking Flow Sequence

```
Product Detail
   │ visitor picks a variant (duration/price) if the service has more than one
   ▼
Availability Calendar  ──(month view, GET /widget/availability)──▶  Time Slot Picker
   │                                                                      │  optional Location/Staff filter chips
   │                                                                      │  (only rendered when there's an actual
   │                                                                      │  choice — Requirement 3.13); resolved
   │                                                                      │  location/staff always shown regardless
   │                                            visitor picks a slot ◀────┘  (Requirement 3.14)
   ▼
Login / Register   (slot selection — now one specific time+location+staff combo — is remembered client-side; not held yet — createHold() needs an acting user)
   │  "Have an account?" → POST /v1/auth/login { tenant_id, email, password }
   │  "New here?"         → POST /v1/auth/register { tenant_id, email, password, first_name, last_name }
   │  → access_token stored in the IFRAME's own sessionStorage (never touches the parent page)
   ▼
POST /widget/availability/hold  (Authorization: Bearer <token>)  →  { hold_id, expires_at }   (10-minute hold)
   ▼
POST /widget/customer  (Authorization: Bearer <token>)  →  find-or-create cus_customers(business_id, email)
   ▼
Customer Details  (pre-filled name from account; phone confirmed/edited)
   ▼
GET /widget/business/:id  → require_payment_before_confirmation?
   │                                              │
   │ true (default)                               │ false
   ▼                                               ▼
POST /widget/booking → status "pending"     POST /widget/booking → status "confirmed"
   ▼                                               │
Payment step (emulated card form)                  │
   ▼                                               │
POST /widget/booking/:id/pay → wgt_widget_transactions row, booking → "confirmed", confirmation email
   ▼                                               ▼
                    Confirmation step (both paths converge here)
                         │
                         ▼
        postMessage {type:"daystream:booking_confirmed", bookingReference, status}
```

If the hold expires anywhere between "hold created" and "booking created", `POST /widget/booking` returns 409 and the flow returns to Time Slot Picker (Requirement 3.6) — the hold_id is re-validated server-side at booking-creation time regardless of what the client believes.

---

## Package and Membership Purchase Flow

Shorter than the service flow — no calendar, no slot, no hold, because there's no appointment being reserved:

```
Product Detail (product_type = 'package' | 'membership')
   ▼
Login / Register   (POST /v1/auth/login | /v1/auth/register — identical to the service flow)
   ▼
POST /widget/customer  →  find-or-create cus_customers   (identical to the service flow)
   ▼
Customer Details  (name pre-filled; phone confirmed)
   ▼
GET /widget/business/:id → require_payment_before_confirmation?
   │                                              │
   │ true                                          │ false
   ▼                                               ▼
POST /widget/package-purchase        POST /widget/package-purchase
  or /widget/membership-enrollment     or /widget/membership-enrollment
  → status "pending"                   → status "confirmed"
   ▼                                               │
Payment step (same emulated form as Req 8)         │
   ▼                                               │
POST …/pay → wgt_widget_transactions row,          │
  purchase/enrollment → "confirmed",                │
  confirmation email                                │
   ▼                                               ▼
                    Confirmation step (both paths converge here)
                         ▼
        postMessage {type:"daystream:booking_confirmed", bookingReference: purchaseOrEnrollmentRef, status}
```

`purchasePackage()` and `enrollCustomer()` (both already exist, unchanged) don't have a booking-rule engine to violate the way `createBooking()` does — there's no lead time, capacity, or staff-availability concept for buying a bundle — so this flow has no equivalent to the service flow's 422/409 paths beyond "package not active" / "already purchased and `new_customers_only`" style errors those functions already throw.

---

## API Contracts

All under `/api/v1/widget/`. Public endpoints take no `Authorization` header; authenticated ones require the customer JWT obtained from `/v1/auth/login` or `/v1/auth/register`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/business/:business_id` | public | name, logo_url, tenant_id, theme tokens, require_payment_before_confirmation |
| GET | `/business/:business_id/products` | public | active services/packages/memberships |
| GET | `/business/:business_id/products/:product_id` | public | full detail incl. variants |
| GET | `/availability` | public | `?business_id&service_id&variant_id&month` → per-day status |
| GET | `/availability/slots` | public | `?business_id&service_id&variant_id&date_from&date_to` → array of (time × location × staff) combos, same shape as `availability.service.ts`'s `getAvailabilityCombinations()` (Requirement 3.13) — not the collapsed "one entry per time with an available_staff array" shape |
| POST | `/availability/hold` | **customer JWT** | `{business_id, service_id, variant_id, start_time}` → `{hold_id, expires_at}` (`heldBy` = caller's own user id) |
| POST | `/customer` | **customer JWT** | `{business_id, phone?}` → find-or-create `cus_customers` for `req.user`'s email; backfills `phone` if provided and not already set |
| POST | `/booking` | **customer JWT** | `{business_id, customer_id, service_id, variant_id, start_time, hold_id?, staff_id?, notes?}` |
| POST | `/booking/:booking_id/pay` | **customer JWT** | `{business_id}` → simulated transaction + confirm |
| POST | `/package-purchase` | **customer JWT** | `{business_id, customer_id, package_id}` → wraps `purchasePackage()` unchanged (Phase 5) |
| POST | `/package-purchase/:id/pay` | **customer JWT** | `{business_id}` → simulated transaction + confirm (Phase 5) |
| POST | `/membership-enrollment` | **customer JWT** | `{business_id, customer_id, plan_id, start_date}` → wraps `enrollCustomer()` unchanged (Phase 5) |
| POST | `/membership-enrollment/:id/pay` | **customer JWT** | `{business_id}` → simulated transaction + confirm (Phase 5) |

#### `GET /widget/business/:business_id` — 200

```json
{
  "id": "…", "name": "Transcend Mallorca", "logo_url": "https://…",
  "tenant_id": "…",
  "theme": { "base_theme": "bold-business", "tokens": { "--color-primary": "#0052CC", "...": "..." } },
  "require_payment_before_confirmation": true
}
```
403 if `wgt_widget_configs.is_enabled` is false or missing; 404 if the business doesn't exist.

#### `POST /widget/booking` — 201

Request:
```json
{ "business_id": "…", "customer_id": "…", "service_id": "…", "variant_id": "…", "start_time": "2026-10-01T10:00:00Z", "hold_id": "…" }
```
Response:
```json
{ "booking_reference": "BK-000123", "service_name": "THE RESET", "start_time": "2026-10-01T10:00:00Z", "staff_name": null, "status": "pending" }
```
401 if the JWT's user doesn't map to `customer_id`; 409 if the hold is expired/mismatched; 422 for existing booking-rule violations (unchanged from `createBooking()`).

#### `POST /widget/booking/:booking_id/pay` — 200

Request: `{ "business_id": "…" }` (no card fields — see Requirement 8.8)
Response: `{ "status": "confirmed", "transaction_id": "…" }`

---

## CORS Design

The app's existing global CORS (`packages/server/src/app.ts`) is a single fixed origin:

```ts
app.use(cors({ origin: `http://localhost:${...}`, credentials: true }));
```

This must **not** become a wildcard globally — that would loosen CORS for every authenticated admin/staff endpoint too. Instead, the widget router gets its own CORS middleware, mounted on the router itself (not `app`), which Express applies *in addition to* the global one for requests matching `/api/v1/widget/*`:

```ts
// packages/server/src/routes/widget.ts
export const widgetRouter = Router();
widgetRouter.use(cors({ origin: true, credentials: false })); // reflects any Origin, no cookies
```

`origin: true` (rather than the literal string `'*'`) is used because the `cors` package needs to *reflect* the requesting origin when `credentials` matters anywhere in the chain; here `credentials: false` is correct since the widget never uses cookies (the JWT travels as a bearer header, matching Requirement 13.1's "no cookies" rule) — so a literal `'*'` is equally valid and slightly simpler; either is acceptable, `origin: true` is chosen for forward-compatibility if a future requirement needs per-request origin logging.

`allowed_origins` validation (Requirement 12.2) is a *separate*, application-level check inside each widget route (or a small middleware early in `widgetRouter`) — it inspects `req.headers.origin` against `wgt_widget_configs.allowed_origins` and returns 403 before any business logic runs. This is distinct from the CORS headers themselves (which control whether the *browser* allows the response to be read) — the two checks serve different purposes and both are needed.

---

## Widget Script

Served as a static file at `/widget/daystream-widget.js` (added to the Express static/route layer, not built by Vite — it must be a single dependency-free file a business can paste as-is).

```js
(function () {
  if (window.__daystreamWidgetLoaded) return; // idempotency (Req 1.7)
  window.__daystreamWidgetLoaded = true;

  const scriptTag = document.currentScript;
  const businessId = scriptTag.getAttribute('data-business-id');
  const APP_ORIGIN = new URL(scriptTag.src).origin;

  function openModal(productId, action) { /* inject overlay + iframe, focus trap, Escape handler */ }
  function closeModal() { /* remove overlay, restore scroll */ }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-daystream-product]');
    if (!btn) return;
    openModal(btn.getAttribute('data-daystream-product'), btn.getAttribute('data-daystream-action') || 'book');
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== APP_ORIGIN) return; // Req 12.8 / 13.6
    if (e.data?.type === 'daystream:close') closeModal();
    if (e.data?.type === 'daystream:booking_confirmed') {
      window.dispatchEvent(new CustomEvent('daystreamBookingConfirmed', { detail: e.data }));
    }
  });

  window.DayStream = { open: openModal }; // Req 1.9
})();
```

**Phase 3 correction to the skeleton above:** `APP_ORIGIN = new URL(scriptTag.src).origin` assumes the script and the `/booking-widget` page share an origin. They never do in this project's actual deployment topology — the script is served by the server (Render) and the booking page by the client (Vercel), two different domains, and the same split exists locally (server on :4001 serves the script, the client dev server on :4000 serves `/booking-widget`). The shipped script instead reads an explicit `data-app-url` attribute on the `<script>` tag and derives `APP_ORIGIN` from that, falling back to `scriptTag.src`'s origin only when the attribute is omitted (so a hypothetical same-origin deployment still works with zero config). The Local_Test_Page and Business_Widget_Config snippet (Phase 4/6) must always include both attributes.

---

## postMessage Contract

| Direction | Type | Payload |
|---|---|---|
| iframe → parent | `daystream:ready` | `{}` |
| iframe → parent | `daystream:step_changed` | `{ step, stepName }` |
| iframe → parent | `daystream:booking_confirmed` | `{ bookingReference, serviceName, startTime, status }` |
| iframe → parent | `daystream:close` | `{}` |

No parent → iframe messages are needed in v1 (the iframe is fully self-driving once loaded with its query params).

---

## Payment-Required Configuration

`wgt_widget_configs.require_payment_before_confirmation` is read once at `GET /widget/business/:id` and drives two things client-side (whether the Payment step renders at all) and one thing server-side (`POST /widget/booking`'s initial status — Requirement 7.6). The server is the source of truth: even if a compromised/modified client skipped the check, `POST /widget/booking` independently re-reads the config and sets `pending` or `confirmed` accordingly — the client-side skip is a UX convenience, not the enforcement point.

---

## Theme Integration

No new theming work. The Booking_Flow page calls the existing `GET /v1/themes/resolve?business_id=X` (spec 37) on load and applies the result exactly the way `ThemeManager.applyResolvedTokens()` already does for the admin app — this file is imported directly, not reimplemented. `applyBaseTheme()` sets `data-base-theme` on the iframe's own `document.documentElement`, which is a separate DOM from the parent page, so no leakage between the business's site and the booking flow's styling.

---

## File Layout

```
packages/server/src/
  db/migrations/109_widget_booking.sql
  routes/widget.ts                    ← new, mounted at /api/v1/widget
  services/widget-booking.service.ts  ← thin wrapper: calls createBooking(), slot-hold.service, booking-notifications.service
  middleware/widget-cors.ts           ← origin-allowlist check (Requirement 12.2)
  static/daystream-widget.js          ← served at /widget/daystream-widget.js

packages/client/src/
  pages/BookingWidget.tsx             ← the /booking-widget standalone route (no AppLayout)
  pages/booking-widget/               ← step components (ProductDetail, Calendar, SlotPicker, LoginRegister, CustomerDetails, Payment, Confirmation)
  pages/settings/WidgetSettings.tsx   ← business settings "Booking Widget" section (Phase 4)
  api/widget.ts                       ← typed client for the above, used only within BookingWidget.tsx

fake-business-site/                   ← new top-level folder, separate deploy target
  index.html                          ← Local_Test_Page / Fake_Business_Site (same file, two deploy contexts)
  packages.json (if using a bundler) — plain static HTML/CSS/JS is sufficient, no build step needed
```

`BookingWidget.tsx` is registered in `App.tsx` as a route with **no** `<ProtectedRoute>` wrapper (it's public) and does not render inside `AppLayout`/`AdminLayout` (Requirement 3.12).

---

## Deployment Topology

```
GitHub repo (main branch)
   │
   ├─▶ Vercel project "daystream-app"      (packages/client build)      → app.vercel.app
   ├─▶ Vercel project "transcend-fake-site" (fake-business-site/)       → fake-transcend.vercel.app
   └─▶ Render Web Service "daystream-api"  (packages/server, `npm run start`) → daystream-api.onrender.com
                │
                ▼
         Neon Postgres (connection string via Render env vars)
```

- **Vercel (client)**: build command `npm run build --workspace=packages/client`, output `packages/client/dist`. Env var `VITE_API_URL` pointed at the Render URL.
- **Vercel (fake site)**: separate project rooted at `fake-business-site/`, zero build step. The widget `<script>` tag's `src` points at the Render URL, `data-business-id` set to Transcend Mallorca's real seeded id.
- **Render (server)**: `npm run build --workspace=packages/server && npm run start --workspace=packages/server` (or `tsx` in production if the project doesn't currently compile to JS — check existing `package.json` scripts before assuming a build step exists). Free tier sleeps after 15 minutes idle; first request after sleep is slow (~30–60s) — acceptable for shared dev/test use, not for a real production customer.
- **Neon**: one project, `DATABASE_URL` env var on Render. Migrations run via `npm run migrate:dev`'s equivalent against the Neon connection string (a `migrate:prod` script pointed at `process.env.DATABASE_URL` — the migration runner already reads from env, per `packages/server/src/db/pool.ts`, so this should need no new code, only a new npm script alias for clarity).
- **CORS in production**: the global `app.use(cors({origin: ...}))` in `app.ts` must read the deployed Vercel client URL from an env var (`CLIENT_URL`) instead of the hardcoded `localhost:4000` — this is an existing gap, not new to this spec, but must be fixed as part of deployment (Phase 4) since it currently hardcodes a `NODE_ENV === 'development'` branch that assumes local dev.
- **Secrets**: `JWT_SECRET`, `DATABASE_URL`, SMTP credentials, storage config — set directly in Render/Vercel's environment variable UI, never committed.

---

## Phases

| Phase | Deliverable | Verifiable by |
|---|---|---|
| **1. Backend core** ✅ | Migration 109; `widget.ts` routes for business/products/availability/hold/customer/booking/pay; `widget-booking.service.ts` | `curl` against each endpoint locally, no UI — done, full sequence verified against real Transcend Health data |
| **2. Hosted booking flow page** | `/booking-widget` route + all 7 service-flow step components, called directly via a browser tab with `?business_id=…&product_id=…` (no iframe/widget yet) | Opening the URL directly in a browser and completing a real booking end-to-end |
| **3. Widget script + local test harness** | `daystream-widget.js`; `fake-business-site/index.html` (Local_Test_Page); modal + postMessage wiring | Opening the local test page, clicking "Book Now", completing the flow inside the modal |
| **4. Cloud deployment** | Vercel (client + fake site), Render (server), Neon (DB); `CLIENT_URL` env-driven CORS fix; widget business-settings UI (enable/disable, snippet, payment toggle, allowed origins) | The deployed fake site, opened on a phone, completing a real booking against the deployed server |
| **5. Package & membership purchase** | New migration relaxing `wgt_widget_transactions.booking_id`; `/package-purchase`, `/membership-enrollment` + `/pay` endpoints wrapping `purchasePackage()`/`enrollCustomer()`; the package/membership steps in `BookingWidget.tsx` | "THE RESET" (a real package on the reference site) can be purchased end-to-end through the widget |
| **6. Widget snippet generation** | "Copy widget snippet" action on Services/Packages/Memberships admin pages (frontend-only, no new endpoint) | Copying a snippet from the admin UI and pasting it into the Local_Test_Page produces a working button with no hand-edited id |
| **7. Security & audit hardening** | Rate limiting on mutating widget endpoints; `allowed_origins` enforcement; `source='widget'` + `cus_activities` audit rows; request logging | Rate-limit test (61st request in a minute → 429); audit rows visible in the admin Audit Log |
| **8. v2 — out of scope here** | Real Stripe integration | — |

Phases 1–3 are meant to run fast and local (no deploy friction while the core flow is still being built). Phase 4 is the first point where cross-origin behavior is tested for real rather than assumed — deliberately not deferred to the very end, since a widget that "works" only same-origin hasn't actually proven anything. Phases 5 and 6 were added after a follow-up question surfaced that the reference site's actual products ("THE RESET" etc.) are packages, not plain services, and that snippet generation — not hand-typed ids — is how a business would really wire a product to its DayStream record. Phase 6 has no dependency on Phase 5 and could run in parallel or earlier; it's sequenced after deployment here simply because it's admin-UI work, not because anything blocks it.

---

## Error Handling

| Scenario | Status | Response |
|---|---|---|
| `business_id` not a UUID | 400 | `{ "error": "Invalid business_id" }` |
| Business not found | 404 | `{ "error": "Business not found" }` |
| Widget not enabled for business | 403 | `{ "error": "Widget is not enabled for this business" }` |
| Origin not in `allowed_origins` | 403 | `{ "error": "Origin not permitted" }` |
| Hold expired/mismatched at booking creation | 409 | `{ "error": "Slot hold expired or does not match" }` |
| JWT doesn't match `customer_id` | 401 | `{ "error": "Not authorized for this customer" }` |
| Existing `createBooking()` rule violation (lead time, capacity, etc.) | 422 | passthrough from the existing service, unchanged |
| Rate limit exceeded on mutating endpoint | 429 | standard `express-rate-limit` body |

---

## Testing Strategy

Consistent with how spec 37 was actually verified in this project (no formal PBT suite was written; correctness was proven by direct `curl` calls against the running dev server and cross-checked against the database), Phase 1 and Phase 2 are verified the same way: every new endpoint is exercised directly (public ones via plain `curl`, authenticated ones via a real register/login round-trip) before moving to the next phase, rather than writing example-based unit tests upfront. If deeper regression coverage is wanted later, the natural candidates are: the hold-expiry → 409 path, the `require_payment_before_confirmation` branch in `POST /widget/booking`, and the CORS/`allowed_origins` rejection path — these three are the places most likely to silently regress.

---

## Notes

- `packages/server/src/app.ts`'s CORS origin is currently derived from `NODE_ENV`, not an env var — the Phase 4 deployment fix (`CLIENT_URL`) should replace that branch rather than add a third one, to avoid three-way conditional drift
- The Render free tier's cold-start delay means the *first* widget interaction after a period of inactivity will feel slow during testing — this is a hosting-tier characteristic, not a bug, and should not be "fixed" by adding complexity; it goes away entirely on a paid Render tier when this becomes a real product
- `fake-business-site/` is intentionally a plain static folder, not a Vite app — it must behave like a real, unrelated third-party website with zero DayStream tooling, or it stops being a faithful test of the embed
