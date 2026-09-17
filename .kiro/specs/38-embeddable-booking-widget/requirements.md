# Spec 38: Embeddable Booking Widget — Requirements

## Introduction

The Embeddable Booking Widget is a vanilla JavaScript snippet that any business can paste onto their external website (e.g. transcendhealth.eu) to offer DayStream bookings without redirecting visitors away — replacing the current pattern of redirecting to a third-party booking site (e.g. Momence). When a visitor clicks a "Book Now" or "Purchase" button on the business's own site, a full-screen modal opens containing a DayStream-hosted iframe. The visitor completes the entire booking and (emulated, in v1) payment flow inside that iframe and never leaves the business's website. The widget applies the business's active DayStream theme (spec 37) and logo so the experience feels native to the brand.

**Booking requires an authenticated DayStream customer account.** Unlike a typical "guest checkout" widget, a visitor must log in or register (email + password) before a booking can be created. This mirrors real-world purchase flows (see the reference Momence checkout screenshot, which already shows a logged-in "David Medina") and lets the widget reuse DayStream's existing authentication (`POST /v1/auth/register`, `POST /v1/auth/login`) instead of building a separate identity system.

**Payment-before-confirmation is business-configurable.** By default, a widget booking is not `confirmed` until the (emulated, in v1) payment step completes — matching how a real e-commerce checkout behaves. A business may opt out of this and allow bookings to confirm without upfront payment, the same way a staff member can create an unpaid booking today in the admin app. This is a per-business toggle, not a hardcoded rule, because some businesses will want the stricter default and others will not.

v1 ships with an emulated payment step — no Stripe or real payment processor. A simulated transaction record is written and a confirmation email is sent. Stripe integration is deferred to v2 (out of scope here).

This spec also covers **deploying the project so it's testable from any device without a local setup** — a fake business website (modelled on transcendhealth.eu's packages page) hosted separately from the DayStream app, both on free-tier cloud infrastructure, so the widget's cross-origin behavior is tested for real rather than simulated on `localhost`.

## Glossary

- **Widget_Script**: The single `<script>` tag the business pastes on their external website. Served from the DayStream app server. Vanilla JavaScript, no framework dependencies
- **Widget_Button**: Any element on the external page carrying `data-daystream-product` and `data-daystream-action` attributes. Clicking it triggers the Widget_Script to open the Booking_Modal
- **Booking_Modal**: The full-screen overlay injected into the external page's DOM by the Widget_Script. Contains the Booking_Iframe
- **Booking_Iframe**: An `<iframe>` inside the Booking_Modal loading the DayStream-hosted Booking_Flow page
- **Booking_Flow**: The multi-step hosted page at the `/booking-widget` route inside DayStream, rendered inside the iframe. Steps: product detail → availability calendar → time slot picker → **login/register** → customer details → payment (conditional) → confirmation
- **Widget_API**: The set of REST endpoints under `/api/v1/widget/` that serve the Booking_Flow. Browsing endpoints (business info, products, availability) are public; the booking-creation endpoint requires the visitor's DayStream customer JWT
- **Widget_Customer**: An authenticated DayStream user with `role = 'customer'`, matched to a `cus_customers` row for the specific business being booked
- **Simulated_Transaction**: A payment transaction record written with `payment_method = 'simulated'` and `status = 'completed'`. Used in v1 in place of a real payment processor
- **PostMessage_Event**: A cross-origin `window.postMessage` message between the Booking_Iframe and the parent page, signalling lifecycle events (ready, step changed, booking confirmed, close)
- **Business_Widget_Config**: Per-business configuration in a new `wgt_widget_configs` table: enabled flag, allowed origin domains (optional), and the `require_payment_before_confirmation` toggle
- **Theme_Resolver**: The existing spec 37 resolve endpoint (`GET /v1/themes/resolve`). Applied inside the Booking_Iframe — no separate theme system
- **Availability_Service**: The existing `availability.service.ts`. The Widget_API wraps it read-only and MUST NOT modify it
- **wgt_widget_configs**: New table storing per-business widget configuration
- **wgt_widget_transactions**: New table recording simulated payment transactions created via the widget
- **Fake_Business_Site**: A small static site, modelled on transcendhealth.eu's "Wellness & Recovery Packages" page, used to test the widget in a genuinely separate origin. Exists both as a local test page and as a deployed site on its own domain
- **Local_Test_Page**: The local (non-deployed) version of the Fake_Business_Site, used for fast iteration before every change is pushed to the deployed environment
- **Widget_Snippet**: The ready-made `<button data-daystream-product="…" data-daystream-action="…">` HTML DayStream generates for a specific service, package, or membership, offered as a "Copy widget snippet" action wherever that item is managed in the admin UI. The business pastes this verbatim — they never see or type the underlying id
- **Package_Purchase / Membership_Enrollment**: Buying a package or enrolling in a membership via the widget. Unlike a service booking, this has no specific appointment time to reserve — it grants sessions/access to be scheduled later through the business's normal booking flow — so it skips the Availability Calendar and Time Slot Picker steps entirely

---

## Requirements

### Requirement 1: Widget Script Integration

**User Story:** As a business owner, I want to paste a single `<script>` tag on my website so that my visitors can book DayStream services without leaving my site.

#### Acceptance Criteria

1. THE Widget_Script SHALL be served at a publicly accessible URL (e.g. `/widget/daystream-widget.js`) without authentication
2. THE Widget_Script SHALL accept a `data-business-id` attribute on the `<script>` tag identifying which business's services to show
3. WHEN the Widget_Script loads, THE Widget_Script SHALL scan the page for elements with `data-daystream-product` and `data-daystream-action` attributes and attach click listeners to them. THE `data-daystream-product` value is a DayStream service/package/membership id, obtained by the business pasting a Widget_Snippet (Requirement 18) — it is never hand-typed
4. WHEN a Widget_Button is clicked, THE Widget_Script SHALL open the Booking_Modal and load the Booking_Iframe pointing to `/booking-widget` with `business_id` and `product_id` as query parameters
5. THE Widget_Script SHALL be vanilla JavaScript with zero external library dependencies, so it works on any website platform (WordPress, Squarespace, Webflow, custom HTML)
6. THE Widget_Script SHALL NOT pollute the global namespace — all internal state SHALL be scoped within an IIFE
7. THE Widget_Script SHALL be idempotent — loading the same script tag multiple times on the same page SHALL NOT create duplicate modals or listeners
8. WHERE `data-daystream-action` is `"book"`, THE Widget_Script SHALL open the Booking_Flow at the service booking step; WHERE it is `"purchase"`, at the package/membership purchase step
9. THE Widget_Script SHALL expose `window.DayStream.open(productId, action)` so business developers can trigger the modal programmatically

---

### Requirement 2: Booking Modal Overlay

**User Story:** As a visitor on the business's website, I want the booking UI to appear as a full-screen overlay so that I can complete my booking without navigating away.

#### Acceptance Criteria

1. WHEN the Booking_Modal opens, THE Widget_Script SHALL inject a full-screen overlay `<div>` into the external page's `<body>` with a high z-index covering the full viewport
2. THE Booking_Modal SHALL contain the Booking_Iframe filling the overlay area
3. THE Booking_Modal SHALL display a close button visible at all times
4. WHEN the close button is clicked, THE Widget_Script SHALL remove the Booking_Modal and restore page scroll
5. THE Widget_Script SHALL lock body scroll while the Booking_Modal is open and restore it on close
6. WHEN the Booking_Iframe sends `{ type: "daystream:close" }`, THE Widget_Script SHALL close the Booking_Modal as if the close button were clicked
7. WHEN the Booking_Iframe sends `{ type: "daystream:booking_confirmed", ... }`, THE Widget_Script SHALL dispatch a native DOM `CustomEvent` named `daystreamBookingConfirmed` on `window` with the booking reference in `event.detail`
8. THE Booking_Modal SHALL trap keyboard focus within itself while open and SHALL be dismissible via the Escape key

---

### Requirement 3: Hosted Booking Flow (iframe) — services

**User Story:** As a visitor, I want a clear step-by-step booking process inside the overlay so that I can select a service, pick a time, sign in, pay, and receive confirmation without confusion.

This requirement covers booking a **service** specifically (`product_type = 'service'`). Purchasing a **package** or **membership** follows the shorter flow in Requirement 18 instead — there's no appointment time to pick when buying a bundle of sessions or enrolling in a plan.

#### Acceptance Criteria

1. THE Booking_Flow SHALL be a DayStream-hosted page at `/booking-widget`, rendered inside the Booking_Iframe, accepting `business_id`, `product_id`, and `action` as URL query parameters
2. WHEN the product resolved from `product_id` has `product_type = 'service'`, THE Booking_Flow SHALL consist of the following ordered steps: (1) Product Detail, (2) Availability Calendar, (3) Time Slot Picker, (4) Login / Register, (5) Customer Details, (6) Payment — shown only when the business's `require_payment_before_confirmation` is `true`, (7) Confirmation
3. WHEN at the Availability Calendar step, THE Booking_Flow SHALL display a month calendar where days with available slots are selectable and days without are visually disabled
4. WHEN a visitor selects a date, THE Booking_Flow SHALL display available time slots for that date
5. WHEN a visitor selects a time slot, THE Booking_Flow SHALL proceed to the Login / Register step and, immediately upon successful authentication, hold that slot via the existing slot-hold mechanism for 10 minutes while the visitor completes the remaining steps (the existing hold mechanism requires an acting user id, so holding happens right after authentication, not before — browsing and viewing availability remain fully unauthenticated)
6. IF the slot hold expires before checkout completes, THEN THE Booking_Flow SHALL display an expiry notice and return the visitor to the Time Slot Picker step
7. AT the Login / Register step, THE Booking_Flow SHALL offer both "Log in" (email + password) and "Create account" (first name, last name, email, password) using the existing `POST /v1/auth/login` and `POST /v1/auth/register` endpoints, scoped to the tenant that owns the business being booked
8. WHEN login or registration succeeds, THE Booking_Flow SHALL hold the resulting access token only within the iframe's own browser context (memory or `sessionStorage` scoped to the DayStream origin) — it SHALL NOT be exposed to the parent page in any form
9. THE Customer Details step SHALL be pre-filled with the authenticated user's name; the visitor confirms or edits phone number. WHEN a `cus_customers` row already exists for this business and email, THE Booking_Flow SHALL display a "Welcome back" message and pre-fill phone from that record
10. THE Booking_Flow SHALL display a progress indicator showing the current step and total steps at all times
11. WHEN the visitor clicks "Back" within the Booking_Flow, THE Booking_Flow SHALL return to the previous step without losing already-entered data
12. THE Booking_Flow SHALL be a standalone page with no DayStream admin navigation, sidebar, or header — only booking content and the business's branding
13. AT the Time Slot Picker step, WHERE more than one location or more than one qualified staff member can serve the selected date, THE Booking_Flow SHALL let the visitor filter by Location and/or Staff before picking a time — the same (time × location × staff) combinations the admin booking flow (`BookingCreate.tsx`) already exposes, not a collapsed "first available" choice. A Location or Staff filter is omitted when there is only one option (nothing to choose) or, for Staff, when the service has no staff dimension at all (`booking_type = 'resource'`)
14. FROM the Customer Details step onward, THE Booking_Flow SHALL display the resolved Location (when known) and Staff member (when the service has one) for the booking being made, even when Requirement 3.13 offered no choice because only one option existed — the visitor SHALL always be able to see who and/or where, not only choose when there's a decision to make

---

### Requirement 4: Widget API — Business and Products (public)

**User Story:** As the Booking_Flow, I need business info and bookable products so I can display accurate service details and pricing before the visitor logs in.

#### Acceptance Criteria

1. THE Widget_API SHALL expose `GET /api/v1/widget/business/:business_id` returning: business name, logo URL, `tenant_id` (needed for the login/register step), the active Theme token set (via the existing Theme_Resolver), and the resolved `require_payment_before_confirmation` value
2. THE Widget_API SHALL expose `GET /api/v1/widget/business/:business_id/products` returning all active services, packages, and memberships configured as bookable/purchasable
3. THE Widget_API SHALL expose `GET /api/v1/widget/business/:business_id/products/:product_id` returning full product detail: name, description, images, variants (duration + price in cents), product type
4. WHEN a product is a service, THE Widget_API SHALL include all active variants with duration (minutes) and price (integer cents)
5. WHEN a product is a package, THE Widget_API SHALL include session count, price, and the service the package is for
6. WHEN a product is a membership, THE Widget_API SHALL include billing interval, price per interval, and included service access
7. THE business and products endpoints SHALL NOT require authentication
8. THE Widget_API SHALL return HTTP 404 if `business_id` does not exist, and HTTP 403 if the business does not have the widget enabled

---

### Requirement 5: Widget API — Availability (public)

**User Story:** As the Booking_Flow, I need to query slot availability so I only show dates and times that can actually be booked.

#### Acceptance Criteria

1. THE Widget_API SHALL expose `GET /api/v1/widget/availability` with `business_id`, `service_id`, `variant_id`, `month` (YYYY-MM), returning per-day availability status
2. THE Widget_API SHALL delegate to the existing Availability_Service without modifying it, returning the same `available` / `unavailable` / `closed` status values
3. THE Widget_API SHALL expose `GET /api/v1/widget/availability/slots` with `business_id`, `service_id`, `variant_id`, `date_from`, `date_to`, returning available time slots
4. THE Widget_API SHALL NOT modify, wrap with additional logic, or bypass any booking rule enforced by the Availability_Service
5. THE availability endpoints SHALL NOT require authentication
6. THE Widget_API SHALL expose `POST /api/v1/widget/availability/hold` accepting `business_id`, `service_id`, `variant_id`, `start_time`, creating a 10-minute slot hold via the existing slot-hold mechanism (`heldBy` = the caller's own user id) and returning a `hold_id`. This endpoint REQUIRES the customer JWT, since the underlying hold mechanism requires an acting user — it is called immediately after Login/Register, before Customer Details

---

### Requirement 6: Widget API — Authentication and Customer Record

**User Story:** As a visitor, I need to log in or register so that my booking can be created under my own account, and so DayStream recognises me if I book again.

#### Acceptance Criteria

1. THE Booking_Flow SHALL use the existing `POST /api/v1/auth/register` and `POST /api/v1/auth/login` endpoints unchanged for the Login/Register step, passing the `tenant_id` returned by the business endpoint (Requirement 4.1)
2. AFTER a successful login or registration, THE Widget_API SHALL expose `POST /api/v1/widget/customer` (authenticated, using the token obtained in 6.1) accepting `business_id` and returning the existing or newly created `cus_customers` record for that `(business_id, email)` pair, using the authenticated user's email
3. WHEN no matching `cus_customers` record exists for `(business_id, email)`, THE Widget_API SHALL insert one with `lifecycle_stage = 'lead'`, `status = 'active'`, and `created_by` set to the authenticated user's own id
4. THE `/widget/customer` endpoint SHALL NOT expose customer fields beyond `id`, `first_name`, `last_name`, `email`, `phone`
5. THE `/widget/customer` endpoint SHALL require a valid `role = 'customer'` JWT; all other roles SHALL receive HTTP 403

---

### Requirement 7: Widget API — Booking Creation (authenticated)

**User Story:** As a logged-in visitor, I need to create a booking under my account so the appointment is recorded and I receive confirmation.

#### Acceptance Criteria

1. THE Widget_API SHALL expose `POST /api/v1/widget/booking`, requiring the visitor's customer JWT, accepting `business_id`, `customer_id`, `service_id`, `variant_id`, `start_time` (ISO 8601), and optionally `staff_id`, `notes`, `hold_id`
2. THE Widget_API SHALL create the booking in `apt_bookings` using the existing `createBooking()` service, with `source = 'widget'` and `created_by` set to the authenticated user's own id (no guest/anonymous booking path exists)
3. THE booking endpoint SHALL enforce all existing booking rules (lead time, advance booking limit, capacity) — widget bookings are not exempt from any rule
4. WHEN `hold_id` is supplied, THE Widget_API SHALL validate the hold is active and matches `service_id`/`variant_id`/`start_time` before creating the booking; IF expired or mismatched, THEN return HTTP 409
5. THE Widget_API SHALL reject the request with HTTP 401 if the JWT does not belong to a `role = 'customer'` account matching the `customer_id` supplied
6. WHEN the business's `require_payment_before_confirmation` is `true` (the default), THE booking SHALL be created with status `pending`; WHEN `false`, THE booking SHALL be created with status `confirmed` immediately and the Payment step SHALL be skipped
7. WHEN the booking is created, THE Widget_API SHALL return the booking reference, service name, start time, staff name (if assigned), and current status

---

### Requirement 8: Emulated Payment (v1) — conditional on business configuration

**User Story:** As a visitor, when the business requires upfront payment, I want to complete a payment step so my booking is confirmed — even though real card processing isn't integrated yet.

#### Acceptance Criteria

1. WHEN the business's `require_payment_before_confirmation` is `true`, THE Booking_Flow SHALL show a Payment step with fields for cardholder name, card number (16-digit input), expiry (MM/YY), CVC — clearly labelled as a test/demo environment
2. WHEN `require_payment_before_confirmation` is `false`, THE Booking_Flow SHALL skip the Payment step entirely and proceed from Customer Details directly to Confirmation with the booking already `confirmed`
3. THE Widget_API SHALL expose `POST /api/v1/widget/booking/:booking_id/pay` (authenticated, same customer JWT) accepting `business_id`, creating a `wgt_widget_transactions` row with `payment_method = 'simulated'`, `status = 'completed'`, the booking amount from the variant price, and transitioning the booking status from `pending` to `confirmed`
4. WHEN the simulated payment is recorded, THE Widget_API SHALL trigger a booking confirmation email using the existing booking notification service
5. THE payment form SHALL perform client-side format validation only (card number length, expiry format, CVC length) — no real card data is transmitted to DayStream's server; the pay endpoint accepts no card fields
6. IF the payment form is submitted with missing required fields, THEN THE Booking_Flow SHALL show inline validation errors without clearing other fields
7. THE `wgt_widget_transactions` table SHALL record: `id`, `tenant_id`, `business_id`, `booking_id`, `customer_id`, `amount_cents`, `currency`, `payment_method`, `status`, `created_at`
8. THE Booking_Flow SHALL NOT transmit card numbers or CVC values to the DayStream server in v1

---

### Requirement 9: Booking Confirmation

**User Story:** As a visitor, after booking (and paying, if required) I want a clear confirmation so I know my booking is secured.

#### Acceptance Criteria

1. THE confirmation step SHALL display: booking reference, service name, date/time in the business's time zone, staff name (if assigned), the confirmation-email address, and current status (`confirmed`, or `pending` if payment was not required and the business still reviews bookings manually — matches existing admin behaviour)
2. THE confirmation step SHALL display a "Close" button sending `{ type: "daystream:booking_confirmed", ... }` to the parent page before closing
3. WHEN the confirmation step is reached, THE Booking_Flow SHALL send the `daystream:booking_confirmed` PostMessage_Event automatically, without requiring the visitor to click "Close"
4. THE confirmation email SHALL include booking reference, service name, date/time, staff name (if assigned), business name, and business contact details, using the existing booking notification service and email template infrastructure

---

### Requirement 10: Customer Account (registration is mandatory, not optional)

**User Story:** As a visitor, I must have a DayStream account to book, so my booking history and future bookings are tied to me.

#### Acceptance Criteria

1. THE Booking_Flow SHALL NOT offer a guest-checkout path — every booking is created under an authenticated `role = 'customer'` account
2. WHEN a visitor's email already has a `usr_users` account for the business's tenant, THE Login/Register step SHALL treat this as an existing account (login, not registration)
3. WHEN a visitor's email already exists in `cus_customers` for the specific business (but they are logging in for the first time to that business, e.g. a returning DayStream customer of a different business under the same tenant), THE Booking_Flow SHALL still create/link the `cus_customers` row per Requirement 6.3 and greet them as "Welcome back" if the row already existed
4. Registration via the widget SHALL use the same password rules already enforced by `POST /v1/auth/register`

---

### Requirement 11: Business Branding and Theme

**User Story:** As a business owner, I want the booking widget to show my logo and brand colours so it feels like part of my own website.

#### Acceptance Criteria

1. THE Booking_Flow SHALL call `GET /api/v1/widget/business/:business_id` on load and apply the returned theme token set as CSS custom properties on `document.documentElement` within the iframe
2. THE Booking_Flow SHALL display the business's logo in the header
3. THE Booking_Flow SHALL use the same Theme_Resolver used by the DayStream admin UI (spec 37) — no separate theme system
4. WHEN no custom theme is configured, THE Booking_Flow SHALL apply the Bold_Business built-in theme as the safe default
5. THE Booking_Flow SHALL use CSS custom properties exclusively for colours — no hardcoded hex values

---

### Requirement 12: CORS and Security

**User Story:** As a platform operator, I want the widget API accessible from any business website domain while protecting against abuse.

#### Acceptance Criteria

1. THE Widget_API endpoints (`/api/v1/widget/*`) SHALL respond with CORS headers allowing cross-origin requests from any origin, overriding the app's default single-origin CORS policy for this router specifically (see design.md for the exact middleware placement — the global `app.use(cors(...))` in `app.ts` must not be loosened for any other route)
2. WHERE a business has configured `allowed_origins`, THE Widget_API SHALL validate the `Origin` header matches one of them and return HTTP 403 otherwise; an empty list means any origin is accepted
3. THE Widget_API SHALL apply a rate limit of 60 requests/minute/IP on booking-mutating endpoints (`POST /booking`, `POST /customer`, `POST /booking/:id/pay`, `POST /availability/hold`)
4. THE Widget_API SHALL NOT expose staff personal contact details, internal tenant configuration, other customers' data, financial reporting data, or any field not explicitly listed in this spec's endpoint definitions
5. THE Widget_API SHALL validate `business_id` as a UUID on every request, returning HTTP 400 for malformed values
6. THE Widget_API SHALL return HTTP 403 for a `business_id` whose widget is not enabled
7. THE `/booking-widget` route SHALL be exempt from `X-Frame-Options` framing restrictions; all other DayStream pages MUST retain their existing framing policy
8. THE Widget_Script SHALL validate that any PostMessage_Event's `origin` matches the DayStream application origin before acting on it

---

### Requirement 13: Cross-Origin Communication (postMessage)

**User Story:** As a developer integrating the widget, I want documented events from the iframe so I can react to booking completion without polling or redirects.

#### Acceptance Criteria

1. THE Booking_Iframe SHALL communicate with the parent exclusively via `window.parent.postMessage` — no cookies, localStorage sharing, or URL-based communication
2. THE Booking_Flow SHALL send `{ type: "daystream:ready" }` when the iframe has finished loading
3. THE Booking_Flow SHALL send `{ type: "daystream:step_changed", step: <number>, stepName: <string> }` on every step change
4. THE Booking_Flow SHALL send `{ type: "daystream:booking_confirmed", bookingReference, serviceName, startTime, status }` when booking (and payment, if required) completes
5. THE Booking_Flow SHALL send `{ type: "daystream:close" }` when the visitor clicks the in-iframe close button
6. THE Widget_Script SHALL ignore any message whose `event.origin` does not match the DayStream application origin
7. THE Widget_Script SHALL re-dispatch `daystream:booking_confirmed` as a native `CustomEvent` on the parent `window`

---

### Requirement 14: Widget Configuration (Business Settings)

**User Story:** As a business owner, I want to enable/disable the widget, control upfront-payment requirements, and optionally restrict it to my own domain.

#### Acceptance Criteria

1. THE system SHALL store per-business widget configuration in `wgt_widget_configs`: `id`, `tenant_id`, `business_id`, `is_enabled` (BOOLEAN), `require_payment_before_confirmation` (BOOLEAN, default `true`), `allowed_origins` (TEXT ARRAY, nullable), `created_at`, `updated_at`
2. THE system SHALL expose widget configuration in the business settings UI under a "Booking Widget" section
3. THE settings page SHALL display the embeddable `<script>` snippet pre-populated with the business's own `data-business-id`
4. THE settings page SHALL allow toggling the widget on/off
5. THE settings page SHALL allow toggling `require_payment_before_confirmation` (default on), with inline copy explaining that turning it off allows bookings to confirm without upfront payment, the same as an unpaid booking created by staff
6. THE settings page SHALL allow entering allowed origin domains; an empty list means any origin is accepted
7. WHEN `is_enabled = false`, THE Widget_API SHALL return HTTP 403 for all requests for that business
8. THE `wgt_widget_configs` table SHALL enforce a unique constraint on `business_id`

---

### Requirement 15: Audit Trail

**User Story:** As a platform operator, I want widget-sourced bookings and customer records clearly identified for separate auditing and reporting.

#### Acceptance Criteria

1. WHEN a booking is created via the Widget_API, THE `apt_bookings.source` field SHALL be set to `'widget'`
2. WHEN a `cus_customers` record is created via the Widget_API, THE Widget_API SHALL record the event in `cus_activities` with `activity_type = 'widget_registration'`
3. THE `wgt_widget_transactions` table SHALL record every `/pay` call, successful or not
4. THE Widget_API SHALL log booking creation attempts (successful and failed) with `business_id`, hashed customer email, `product_id`, requested start time, and outcome, using the existing request logging infrastructure

---

### Requirement 16: Local and Deployed Test Site

**User Story:** As the product owner, I want a page that looks like a real business's packages page so I can test and demo the widget end-to-end, first locally and then from any device.

#### Acceptance Criteria

1. THE project SHALL include a static HTML page, modelled on transcendhealth.eu's "Wellness & Recovery Packages" layout (not a byte-for-byte Squarespace export), with at least three product cards each carrying a working "Book Now" `Widget_Button`
2. THE Local_Test_Page SHALL run locally (e.g. served via a simple static server or opened directly) and load the Widget_Script from the local DayStream dev server
3. THE Fake_Business_Site SHALL also be deployed to its own domain, separate from the deployed DayStream app's domain, so the widget is exercised as a genuine cross-origin embed
4. THE Fake_Business_Site SHALL target one specific seeded business (Transcend Mallorca) so the full flow — browse, book, log in, pay, confirm — can be demonstrated against real DayStream data for that business
5. Both the Local_Test_Page and the deployed Fake_Business_Site SHALL use the same widget integration snippet shape a real customer would use — no test-only shortcuts in the embedding code itself

---

### Requirement 17: Cloud Deployment

**User Story:** As the product owner, I want the project deployed to free-tier cloud infrastructure so I can test from any device and share progress with a colleague without them needing a local copy of the code.

#### Acceptance Criteria

1. THE DayStream client (Vite/React) SHALL be deployed to Vercel as a static build
2. THE DayStream server (Express) SHALL be deployed to Render as a persistent Web Service (not a serverless function), preserving the existing background job scheduler
3. THE DayStream database SHALL be a Neon Postgres instance; migrations SHALL run against it via the existing migration runner before first use
4. THE deployed server's CORS configuration SHALL allow the deployed client's exact origin (not a wildcard) for authenticated admin routes, while the `/api/v1/widget/*` routes remain openly cross-origin per Requirement 12.1
5. THE Fake_Business_Site SHALL be deployed as its own separate Vercel project/domain
6. Environment variables (JWT secret, database URL, storage config) SHALL be set via each platform's environment variable configuration — no secrets committed to the repository
7. THE deployment SHALL be triggered by pushing to the project's GitHub repository (Vercel and Render both support GitHub-connected auto-deploy), so a colleague with repo access sees changes without a manual deploy step

---

### Requirement 18: Package and Membership Purchase Flow

**User Story:** As a visitor, I want to buy a package of sessions or enroll in a membership through the same widget, so I'm not redirected elsewhere for anything the business sells online.

Real businesses commonly sell bundles, not just single appointments — the reference Transcend page sells "THE RESET" as a package (multiple services bundled together), not a plain service. Buying a package or membership has no specific appointment time to reserve, so this flow is shorter than Requirement 3's — the resulting sessions/access get scheduled individually later through the business's normal booking flow, which already exists and is unchanged by this spec.

#### Acceptance Criteria

1. WHEN the product resolved from `product_id` has `product_type = 'package'` or `product_type = 'membership'`, THE Booking_Flow SHALL consist of: (1) Product Detail, (2) Login / Register, (3) Customer Details, (4) Payment — conditional on `require_payment_before_confirmation`, (5) Confirmation. THE Availability Calendar and Time Slot Picker steps SHALL be skipped entirely
2. THE Widget_API SHALL expose `POST /api/v1/widget/package-purchase` (customer JWT required) accepting `business_id`, `customer_id`, `package_id`, creating the purchase via the existing `purchasePackage()` service (`package.service.ts`) unchanged, with the same `source = 'widget'` tagging applied to the resulting `pkg_purchases` row as Requirement 15.1 requires for bookings
3. THE Widget_API SHALL expose `POST /api/v1/widget/membership-enrollment` (customer JWT required) accepting `business_id`, `customer_id`, `plan_id`, `start_date`, creating the enrollment via the existing `enrollCustomer()` service (`membership.service.ts`) unchanged
4. WHEN the business's `require_payment_before_confirmation` is `true`, THE package purchase or membership enrollment SHALL NOT be finalised until `POST /api/v1/widget/package-purchase/:id/pay` or `POST /api/v1/widget/membership-enrollment/:id/pay` completes — mirroring Requirement 8's booking payment step, writing the same `wgt_widget_transactions` shape with `booking_id` left `NULL` and a new nullable `purchase_id` / `enrollment_id` column added to support this
5. THE confirmation step for a package purchase SHALL display the package name, number of sessions included, and expiration (if any); for a membership, the plan name, billing interval, and price per interval
6. THE confirmation email for a package purchase or membership enrollment SHALL use the existing notification templates already used when a package/membership is sold through the admin app — no new email template is introduced
7. THIS requirement does NOT change how a package session or membership-included visit is later booked — that continues to use the business's existing booking flow (admin app today; a future phase may extend the widget to let an already-enrolled customer book their next session through it, but that is out of scope here)

---

### Requirement 19: Widget Snippet Generation (DayStream admin UI)

**User Story:** As a business owner, I want to copy ready-made embed code for each of my services, packages, and memberships so that I never have to find or type a DayStream id myself.

#### Acceptance Criteria

1. THE DayStream admin UI SHALL display a "Copy widget snippet" action on each service, package, and membership management page (Offerings), visible wherever that item is already listed
2. WHEN "Copy widget snippet" is used, THE UI SHALL copy to the clipboard a complete `<button>` element: `<button data-daystream-product="<id>" data-daystream-action="book|purchase">Book Now</button>` — `book` for services, `purchase` for packages and memberships — with the item's own name pre-filled as the button text, ready to paste and restyle
3. THE "Copy widget snippet" action SHALL require no new backend endpoint — the id is already present in the admin page's existing data; this is a frontend-only feature
4. THE Business_Widget_Config settings page (Requirement 14.3) SHALL continue to be the single place the outer `<script data-business-id="…">` tag is shown — Widget_Snippets are per-product buttons that assume that script is already on the page
5. WHERE a service, package, or membership is not `online_booking_enabled` (or the equivalent active/purchasable flag for packages/memberships), THE "Copy widget snippet" action SHALL be disabled with an inline explanation, since a snippet for a non-bookable item would silently fail at the Widget_API layer (Requirement 4.8)

---

## Dependencies

- Spec 07 (Booking Engine): `apt_bookings`, `apt_slot_holds`, booking service, availability service — reused without modification
- Spec 37 (Theme Setup): Theme_Resolver and `cfg_themes` — the widget iframe calls the existing resolve endpoint
- Existing auth service (`packages/server/src/services/auth.service.ts`): `registerUser`/login already create `role = 'customer'` accounts — reused unchanged
- Phase 05 (Customer Management): `cus_customers` schema — widget creates/links customer records here, respecting the existing `UNIQUE(business_id, email)` constraint
- Phase 02 (Security & Compliance): JWT middleware, rate limiting infrastructure (`express-rate-limit`), audit logging
- Phase 13 (Booking Notifications): existing `booking-notifications.service.ts` used for confirmation emails

## Success Criteria

- A business can paste the `<script>` tag and Widget_Buttons trigger the Booking_Modal within 2 seconds
- The full flow (product → calendar → slot → login/register → details → payment (if required) → confirmation) completes end-to-end inside the iframe, against a real seeded business (Transcend Mallorca)
- A visitor cannot create a booking without an authenticated `role = 'customer'` account
- By default, a widget booking is not `confirmed` until simulated payment completes; a business can opt out of this requirement
- Widget bookings are distinguishable via `source = 'widget'`
- The booking flow applies the business's active DayStream theme
- `availability.service.ts` is not modified
- The Local_Test_Page works against the local dev server; the same page (deployed) works against the deployed server from any device
- The project is deployed (client on Vercel, server on Render, DB on Neon) and reachable without a local setup
- A business can copy a working Widget_Snippet for any of their services, packages, or memberships without ever seeing a raw id
- A package purchase and a membership enrollment each complete end-to-end through the widget, reusing `purchasePackage()`/`enrollCustomer()` unchanged, tagged `source = 'widget'`

## Out of Scope

- Stripe or any real payment processor integration — deferred to v2
- Guest checkout — every booking requires an authenticated account (this reverses KIRO's original draft, per explicit decision)
- Multi-location selection within the widget — v1 serves the business's default location
- Group class booking via the widget — v1 supports individual services, packages, and memberships only
- Recurring booking setup via the widget — single bookings only
- Widget analytics dashboard — a future phase
- CDN hosting of the widget script — served from the Render-hosted app server in v1
- Webhooks for external website notification — postMessage covers the same-session case
- Booking a session that's already included in a customer's purchased package or active membership, via the widget — v1 lets the widget sell the package/membership; redeeming it still happens through the business's existing (unchanged) booking flow

## Notes

- The `source` column does not yet exist on `apt_bookings` — must be added via migration (there is no existing column to collide with)
- The app's current CORS setup (`packages/server/src/app.ts`) is a single hardcoded origin applied globally via `app.use(cors(...))`, not a wildcard. Widget routes need their own CORS handling layered on top — see design.md for exact placement
- `createBooking()` (`booking.service.ts`) requires `createdBy` — resolved cleanly since every widget booking now has an authenticated user; `createdBy` is simply that user's own id, no guest sentinel needed
- No existing endpoint lets a `customer`-persona JWT create their own booking (`POST /bookings` requires staff-level `bookings:*`) — the new widget booking endpoint is genuinely new, though it delegates to the existing `createBooking()` service function
- The `wgt_` table prefix follows the project's domain prefix convention
- CORS wildcard on public widget endpoints (business/products/availability) is intentional — they return no sensitive, user-specific data; the customer and booking endpoints require a real JWT regardless of origin
- `purchasePackage()` and `enrollCustomer()` (Requirement 18) already exist and are reused exactly as `createBooking()` was in Phase 1 — no new purchase/enrollment logic is invented, only a widget-facing wrapper around each
- Requirement 19's snippet generation is deliberately a frontend-only addition to the existing Offerings admin pages — it does not require a new API endpoint since the product id is already loaded on those pages today

---

**Status**: 📋 Planned — superseded KIRO's initial draft per explicit review; Requirements 18–19 added after a follow-up question about how a website product maps to a DayStream record. See design.md for phase breakdown
**Dependencies**: Spec 07 (Booking Engine), Spec 37 (Theme Setup), Phase 05 (Customer Management), Phase 02 (Security), Phase 13 (Booking Notifications)
**Next Phase**: Design (design.md)
