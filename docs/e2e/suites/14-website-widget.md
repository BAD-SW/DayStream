# Suite 14 — Website, CMS & Embeddable Booking Widget

Persona: owner for the CMS (needs `settings:*`); anonymous visitor for public pages and the widget. Covers spec 18 (website CMS) and spec 38 (booking widget). Conventions: [README](../README.md).

---

## Website CMS

### WEB-01 · Site settings and publish
`P1` `regression` · Spec 18 R1 · Status: Draft
1. At `/cms` edit the site title and a contact detail; publish.
**Expect:** saved values persist; after publishing, `GET /api/v1/cms/public/site` returns them. Unpublished edits are not public.

### WEB-02 · Page: create from a template, edit blocks, publish
`P0` `regression` · Spec 18 R2–R4 · Status: Draft
1. Create page `E2E {RUN} Page` from a template. In `/cms/pages/{id}` add a text block and an image block, reorder them, delete one; save. 2. Publish. 3. Edit again without publishing.
**Expect:** the editor keeps block order and content across reload; the public page (`/api/v1/cms/public/page/{slug}`) shows the published version only, not the later draft; two pages cannot share a slug.

### WEB-03 · Delete a page
`P2` `regression` `guarded` · Status: Draft
1. Delete `E2E {RUN} Page`.
**Expect:** confirmation is required; the public URL stops resolving; navigation entries pointing to it are removed or flagged.

### WEB-04 · Blog post lifecycle
`P1` `regression` · Spec 18 R6 · Status: Draft
1. At `/cms/blog` create post `E2E {RUN} Post`; save as draft; publish; edit; delete.
**Expect:** the public blog list contains it only while published, newest first.

### WEB-05 · Media library
`P1` `regression` · Spec 18 R5 · Status: Draft
1. At `/cms/media` upload an image; use it in a page block; try to upload an oversized file and a disallowed type; delete the image.
**Expect:** valid upload appears with a thumbnail and is selectable in the editor; invalid uploads are refused with a reason; deleting media that is in use warns.

### WEB-06 · Navigation and SEO
`P2` `regression` · Spec 18 R7, R11 · Status: Draft
1. Edit the navigation: add the E2E page, reorder, save. Set the page's SEO title and description.
**Expect:** the public site data returns the new order; the page's public data carries the SEO fields; the sitemap lists published pages only.

### WEB-07 · Contact form creates a submission
`P1` `regression` · Spec 18 R10 · As: anonymous · Status: Draft
1. Submit the public contact form with a `.test` email; submit with missing required fields; submit 20 times quickly.
**Expect:** the valid submission appears under form submissions in the CMS (and as a lead if so designed); invalid input is refused; rapid submissions are throttled or at least do not break anything (record behaviour).

---

## Embeddable booking widget (spec 38)

### WEB-08 · Widget loads business and catalogue
`P0` `regression` · Spec 38 R3, R4, R11 · As: anonymous · Status: Draft
1. Open `/booking-widget` for the demo business.
**Expect:** it renders with no admin chrome, in the business's branding, listing active services with variants and prices (and packages / memberships if enabled).
**Cross-check:** `GET /api/v1/widget/business/{id}/products` returns only active, bookable items of that business; an unknown or archived business id gives a friendly "not available" state.

### WEB-09 · Widget availability equals internal availability
`P0` `regression` · Spec 38 R5 · As: anonymous · Status: Draft
1. For `E2E {RUN} Massage`, compare the widget's available days and slots for next week with those in the internal booking form.
**Expect:** identical. A slot held in the widget (`/widget/availability/hold`) disappears from the internal form until released or expired.

### WEB-10 · Widget booking requires registration and (if configured) payment
`P0` `regression` · Spec 38 R6–R10 · As: anonymous · Status: Draft
1. Choose a slot; try to continue without registering. 2. Register with an email that already belongs to a customer of this business; then with a new one. 3. Complete the emulated payment where required.
**Expect:** registration is mandatory; an existing email leads to login / account match rather than a duplicate customer; confirmation shows the booking details.
**Cross-check:** JNY-13 covers the back-office side. Calling `POST /api/v1/widget/booking` without the widget's customer token is refused.

### WEB-11 · Package and membership purchase through the widget
`P1` `regression` `guarded` · Spec 38 R18 · As: anonymous · Status: Draft
1. Buy `E2E {RUN} 3-pack` through the widget as a registered E2E customer; complete the emulated payment.
**Expect:** the purchase appears on the customer's profile with a balance of 3; a membership enrolment through the widget appears in `/memberships`.

### WEB-12 · Widget security: origins, isolation, messaging
`P0` `negative` · Spec 38 R12, R13 · Status: Draft
1. Call the public widget API for business A and look for anything belonging to business B. 2. Call authenticated widget endpoints with a customer token from business B. 3. Check the response headers for CORS on a public and an authenticated endpoint. 4. Observe the `postMessage` events the widget emits (open, close, booked).
**Expect:** no cross-business data; cross-business tokens refused; CORS allows only what the business's widget configuration permits; messages carry no personal data beyond the booking reference.

### WEB-13 · Widget configuration and snippet
`P1` `regression` · Spec 38 R14, R19 · As: owner · Status: Blocked (KI-12: no widget configuration screen or API exists)
1. In Settings, open the widget configuration; change an option (for example which offerings are shown, or require payment); copy the generated snippet. 2. Reload the public widget.
**Expect:** the change is reflected in the widget; the snippet contains this business's id and the correct host.
