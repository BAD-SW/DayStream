# Phase 51: Competitive Gaps - Design Document

**Date**: November 2026
**Status**: 🎨 Design Phase — Gap 1 (Forms, waivers and e-signature)
**Dependencies**: Phase 47, Phase 21, Phase 44, Phase 15, Phase 28

---

## Overview

One section per gap, written when the gap is started. Gap 1 delivers forms (built on Business Setup > Templates, completed on a device in the business or from a link, signed, stored as a PDF) and, because the PDF must live in the platform's file storage, it also finishes the storage layer: the local and S3 backends both working from Configuration > Storage, one folder structure for every file, a one-time move of existing files, and complete anonymisation.

Requirements: requirements.md, Requirement 1 (criteria 1-11).

---

## Table of Contents

1. [Gap 1: Forms, waivers and e-signature](#1-gap-1-forms-waivers-and-e-signature)
   - [1.1 Storage: local and S3 from Configuration](#11-storage-local-and-s3-from-configuration)
   - [1.2 Folder structure and the one-time move](#12-folder-structure-and-the-one-time-move)
   - [1.3 Data model](#13-data-model)
   - [1.4 The form definition](#14-the-form-definition)
   - [1.5 Building forms (Business Setup > Templates)](#15-building-forms-business-setup--templates)
   - [1.6 Completing a form](#16-completing-a-form)
   - [1.7 The signed PDF](#17-the-signed-pdf)
   - [1.8 Which forms apply, and what's missing](#18-which-forms-apply-and-whats-missing)
   - [1.9 Viewing, printing and emailing a copy](#19-viewing-printing-and-emailing-a-copy)
   - [1.10 Anonymisation and personal-data export](#110-anonymisation-and-personal-data-export)
   - [1.11 API](#111-api)
   - [1.12 Security](#112-security)
   - [1.13 Build order](#113-build-order)
2. [Gap 2: Treatment charting](#2-gap-2-treatment-charting)
3. [Gap 3: Virtual waiting room](#3-gap-3-virtual-waiting-room)
7. [Gap 7: Retail inventory (Requirement 7)](#7-gap-7-retail-inventory-requirement-7)
14. [Gap 14: Tips (Requirement 14)](#14-gap-14-tips-requirement-14)
15. [Service add-ons (Requirement 15)](#15-service-add-ons-requirement-15)
18. [Appointment history (Requirement 18)](#18-appointment-history-requirement-18)
19. [Paying with a membership or package (Requirement 19)](#19-paying-with-a-membership-or-package-requirement-19)

---

## 1. Gap 1: Forms, waivers and e-signature

### 1.1 Storage: local and S3 from Configuration

**Today**: `services/storage.service.ts` picks its backend once, at start-up, from the `STORAGE_BACKEND` environment variable; only the local folder (`local_path`) is read from Configuration > Storage. The `S3Storage` class throws "not yet implemented" on every call. Configuration > Storage saves `storage_type`, `local_path`, `s3_bucket`, `s3_region`, `s3_access_key` and `s3_secret_key`, but choosing AWS S3 has no effect, Test Connection for S3 only checks the fields are filled in, and the secret key is stored and returned to the browser in plain text.

**Change**:

- **Backend from Configuration.** The storage service reads `storage_type` (and the S3 settings) from `sys_system_configurations` (category `storage`) with the same 60-second cache it uses for `local_path`, and builds the matching backend. Saving the Storage page clears the cache, so a change takes effect at once without a restart. `STORAGE_BACKEND` / `STORAGE_LOCAL_PATH` remain only as a fallback when nothing is configured.
- **S3 backend implemented** with the AWS SDK v3 S3 client (`@aws-sdk/client-s3`, pinned version): `save` → PutObject, `read` → GetObject, `delete` → DeleteObject, `deleteDirectory` → ListObjectsV2 + DeleteObjects for the prefix, `exists` → HeadObject. The bucket is private.
- **Credentials.** When an access key and secret are configured they are used; when both are blank the SDK's default credential chain is used, so on AWS an IAM role can replace stored keys entirely.
- **Secret key encrypted.** On save, `s3_secret_key` is encrypted with `utils/encryption.ts` (AES-256-GCM, the same as payment processor secrets) and stored as `s3_secret_key_encrypted`. GET returns a masked placeholder ("configured") instead of the key; saving with the field left as the placeholder keeps the stored key.
- **Test Connection proves the location.** For both backends it writes a small test object under `_connection-test/`, reads it back, compares, and deletes it, reporting the step that failed. For S3 it tests the values in the form before they are saved.
- **Public files under S3.** Public files (logos, website media, staff/resource/product/service images) are currently served by `app.use('/storage', ...)` straight from the local folder with `res.sendFile`. That route changes to stream through `storage.read`, so the same URLs work with either backend. It keeps refusing anything under a `private` folder. (A CDN in front of S3 is a later performance step, not part of this gap.)

### 1.2 Folder structure and the one-time move

One helper, `storagePaths` (server `utils/storage-paths.ts`), builds every path, so no feature writes paths by hand again. Layout:

```
tenants/{tenantId}/
  tenant/public/
    website/{file}                                    CMS media (the website is the tenant's)
    staff/{staffId}-{uuid}.{ext}                      staff photos (staff belong to the tenant)
  businesses/{businessId}/
    public/
      branding/logo-{uuid}.{ext}, favicon-{uuid}.{ext}
      resources/{resourceId}-{uuid}.{ext}
      products/{productId}/{size}/{fileId}.{ext}      merchandise images (original, medium, thumbnail)
      services/{serviceId}/{size}/{fileId}.{ext}      service images (original, large, medium, thumbnail)
    private/
      customers/{customerId}/
        documents/{uuid}.{ext}                        uploaded documents
        photos/{uuid}.{ext}                           customer photo
        forms/{submissionId}.pdf                      completed forms
        data-exports/{uuid}.pdf                       personal-data exports
```

Each customer has one folder with fixed subfolders by kind (`documents`, `photos`, `forms`, `data-exports`); files sit in them named by their own id. There is no folder per file. A subfolder only exists once its first file is saved.

`private` stays a path segment, so the public route's guard ("refuse any path containing a `private` segment") covers every business's private files.

**No empty folders.** On S3 a folder is only a prefix of file names, so it disappears with its last file. On the local file system folders are real, so the local backend tidies them: `delete(path)` removes the file and then each parent folder that is left empty, stopping at the business's `private` or `public` folder; `deleteDirectory(path)` removes the folder itself with everything in it. Every feature therefore leaves no empty folders behind.

CMS media and staff profiles belong to the tenant, not one business (the website is the tenant's, and staff can work across its businesses), so their files sit in the tenant's own public folder.

Every writer builds its path with `storagePaths` (`utils/storage-paths.ts`) and gets the tenant from the business (`tenantOfBusiness`), never from the caller. Replacing a logo, favicon, resource photo, staff photo or product image deletes the file it replaces; deleting website media deletes its files. File names carry a random id, so a replaced image gets a new URL rather than a stale cached one.

**The one-time move** is a server script, `npm run storage:relayout` (`scripts/storage-relayout.ts`):

1. For each place a file reference is stored, it lists the rows, works out the new path with `storagePaths`, copies the file to it, checks the copy reads back identically, updates the row, then deletes the old file. The references, found by every `storage.save` in the code:
   - customer documents (`cus_documents.storage_path`)
   - customer photos (`cus_customers.photo_path`)
   - personal-data exports (`cus_data_exports.storage_path`)
   - business logo and favicon URLs
   - CMS media file paths
   - resource photos
   - staff photos
   - merchandise images
   - service images

   The exact columns for the last five are confirmed at build time.
2. `--dry-run` lists what would move, and the counts, without touching anything.
3. It is safe to run again: rows already in the new layout are skipped, so an interrupted run can be resumed.
4. It works against whichever backend is configured. A row whose file is missing is reported and left unchanged.
5. When it finishes it removes the old top-level folders it emptied (`private/customer-documents`, `businesses`, `cms`, `staff` and so on), so only the new layout remains.

It is run once on the current environment. A real deployment starts empty and writes only the new layout.

### 1.3 Data model

Migration `168_forms.sql`. Tables carry `tenant_id` and `business_id` like every business table.

```sql
-- A form a business builds. One row per language version; versions of the same form share group_id.
frm_forms (
  id UUID PK, tenant_id UUID NOT NULL, business_id UUID NOT NULL,
  group_id UUID NOT NULL,                 -- the form across its language versions
  name VARCHAR(200) NOT NULL,
  language VARCHAR(10),                   -- NULL = the default version
  definition JSONB NOT NULL,              -- headings, text and fields (1.4)
  version INTEGER NOT NULL DEFAULT 1,     -- +1 on every saved change
  applies JSONB NOT NULL DEFAULT '{}',    -- when it applies (1.8)
  renew_after_months INTEGER,             -- NULL = never needs renewing
  is_active BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | archived (soft delete)
  created_by, created_at, updated_at,
  UNIQUE (group_id, language)
)

-- A request to complete a form: a secure link, or a session on a device in the business.
frm_requests (
  id UUID PK, tenant_id, business_id, customer_id UUID NOT NULL,
  group_id UUID NOT NULL, booking_id UUID NULL,
  channel VARCHAR(16) NOT NULL,           -- device | email (sms later, with gap 4)
  token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 of the link token; the token itself is never stored
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | completed | expired | cancelled
  created_by UUID, created_at, completed_at
)

-- A completed form: a reference to its PDF and the facts of the signing. No answers.
frm_submissions (
  id UUID PK, tenant_id, business_id, customer_id UUID NOT NULL,
  form_id UUID NOT NULL, group_id UUID NOT NULL, form_version INTEGER NOT NULL,
  form_name VARCHAR(200) NOT NULL, language VARCHAR(10),
  request_id UUID NULL, booking_id UUID NULL,
  completed_via VARCHAR(16) NOT NULL,     -- device | link | staff
  completed_by_user UUID NULL,            -- set when staff completed it on the customer's behalf
  signed BOOLEAN NOT NULL,                -- had an "I agree" + signature, both given
  signed_at TIMESTAMPTZ, ip_address INET, user_agent TEXT,
  storage_path VARCHAR(500) NOT NULL, size_bytes INTEGER NOT NULL,
  sha256 VARCHAR(64) NOT NULL,            -- hash of the stored PDF, for tamper evidence
  created_at
)
```

Indexes: `frm_forms (business_id, status)`, `frm_submissions (customer_id, group_id, signed_at DESC)`, `frm_requests (customer_id, status)`. Customer foreign keys cascade on delete, consistent with other customer records.

The answers are never written to the database. They exist only in the request that submits the form, long enough to draw the PDF.

### 1.4 The form definition

`definition` is an ordered list of items:

```ts
type FormItem =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; text: string }                    // a paragraph, e.g. the waiver wording
  | { id: string; type: 'write_in' | 'date' | 'yes_no'; label: string; required: boolean }   // write_in: one multi-line text answer
  | { id: string; type: 'single_choice'; label: string; required: boolean; options: string[] }
  // A checkbox table: a label, a list of entries and 1-4 columns. Entries run down each column, then across.
  // The customer ticks the ones that apply. Related groups (e.g. Cardiovascular, Cancer) are separate tables.
  | { id: string; type: 'multi_choice'; label: string; required: boolean; options: string[]; columns?: number }
  | { id: string; type: 'agree'; label: string }                  // "I have read and agree…" — always required
  | { id: string; type: 'signature'; label: string };             // a signature line — always required
interface FormDefinition { items: FormItem[] }
```

It lives in `packages/shared` with a validator used by both the builder and the server. It checks known types, labels present, choices with at least two options, and `agree` and `signature` either both present or both absent. A form with them is a **signed** form.

### 1.5 Building forms (Business Setup > Templates)

The Templates tab's type list gains **Forms**. Choosing it shows the business's forms in the same list style the other templates use: name, language tag, Active / Inactive, plus Edit, Duplicate and Delete (archive). The editor behind it is a form builder (new `FormTemplateEditor` component), not the rich-text document editor.

- **Header settings:**
  - Name.
  - Language (blank means the default version).
  - Active.
  - "Renew after" (never, or a number of months).
  - "Applies to": before a first visit, and/or for chosen services (see 1.8).
- **Items:** An ordered list. Each item has a type picker, its label or text, Required (for answer fields) and options (for choices). Items can be moved up and down and removed. "Add" buttons cover each type.
- **Preview:** It shows the form exactly as the customer will see it.
- **Language versions:** "Add language version" copies the form into a new row with the same `group_id` and a chosen language, for the business to translate. The default version has no language set, and its settings ("applies to", "renew after") are the group's.
- **Saving:** Saving increases `version`. Submissions record the version signed, and the PDF shows exactly what was signed, so editing a form never changes a past signing.

### 1.6 Completing a form

All three ways use one customer-facing page, `/forms/:token` (public, outside the app layout, in the business's branding).

1. **On a device in the business.**
   - Staff choose **Fill in form** on the customer's profile, a booking or the check-in screen, then pick a form.
   - The server creates a `device` request valid for 1 hour, and the page opens on the same device.
   - Staff hand the device over. When the customer submits, the page shows "Thank you, please hand the device back" and nothing else.
2. **From a link.**
   - Staff choose **Send form**, pick a form and send it by email (SMS joins with gap 4).
   - The link is valid for 7 days.
   - Sending again cancels the earlier link for that form.
3. **By staff, on the customer's behalf.**
   - Used for forms without a signature, such as an intake form taken over the phone.
   - Staff fill it in inside DayStream, and the submission records the staff member as the person who completed it.
   - A signed form can't be completed by staff, because the signature must be the customer's own. Staff use the device or link ways instead.

The page:
- **Language:** It shows the version in the customer's preferred language if the group has one, otherwise the default. Other versions are offered as a language switch.
- **Fields:** It renders each item and validates required fields.
- **Signature:** It captures the signature on a canvas with a finger, stylus or mouse, with a Clear button. A drawn signature and the ticked "I agree" are both required before Submit is enabled.
- **Links:** A link that's expired, used or cancelled shows a plain "This link is no longer valid, ask the business for a new one."

### 1.7 The signed PDF

On submit, the server:

1. Validates the answers against the form version, and the signature image (PNG, at most about 200 KB).
2. Draws the PDF with pdfkit (already used for documents and the personal-data export):
   - The business name and logo header.
   - The form name, version and language.
   - Each question with its answer.
   - The waiver text, with "I agree" shown ticked.
   - The signature image, the customer's name, and the signing date and time in the business's time zone.
   - A footer with the submission reference, IP address and device, and "SHA-256 of this document is recorded by DayStream".
3. Saves it to `…/private/customers/{customerId}/forms/{submissionId}.pdf`.
4. Records the submission with the PDF's SHA-256 and marks the request completed.
5. Adds a timeline entry on the customer ("Form completed: Cold Plunge Waiver"), with no answers in it.
6. Discards the answers.

If storing the PDF fails, nothing is recorded and the customer is asked to try again. A submission never exists without its file.

### 1.8 Which forms apply, and what's missing

`applies` (`{ first_visit?: boolean; service_ids?: string[] }`) and `renew_after_months` describe when a form is needed. For a customer, optionally in the context of a booking, each active form group is:

- **Not needed:** It doesn't apply to this customer or booking.
- **Done:** A signed or completed submission exists for the group, and it's within `renew_after_months` if set.
- **Missing:** It applies and no submission exists.
- **Out of date:** It applies, and the latest submission is older than `renew_after_months`.

`first_visit` applies when the customer has no completed booking yet. A form with no rules is never required: staff simply use it when they choose.

The status is shown, never enforced:
- **Customer profile:** A Forms section with each applicable form's status, plus Fill in form and Send form.
- **Booking detail:** A "Forms: 1 missing" note.
- **Check-in screen:** A small badge on the customer's row.

Bookings and check-ins are never blocked.

### 1.9 Viewing, printing and emailing a copy

The customer profile's Forms section lists the customer's submissions: form, date, version, how it was completed, and signed or not. Each has three actions:

- **View:** Opens the PDF, streamed through an authenticated route, as uploaded documents are today.
- **Print:** Opens the same PDF for the browser's print dialog.
- **Email a copy:** Emails the PDF to the customer's address as an attachment. `email.service` gains an optional `attachments` field, which nodemailer supports. The email is recorded on the timeline.

Any staff member can see completed forms (`customers:read`). Building forms needs `settings:*`.

### 1.10 Anonymisation and personal-data export

`anonymizeCustomer` is extended, which also fixes what it misses today. In one database transaction it:

- Clears the personal fields it already clears, plus `phone_e164`, address, city, postal code, region, preferred language, `photo_path` and the link to a login.
- Deletes the customer's `frm_submissions`, `frm_requests`, `cus_documents` and `cus_data_exports` rows.
- Replaces the description of the customer's timeline entries (`cus_activities`) with "Removed when the customer was anonymised", keeping their dates and types.
- Deletes notes, as today.

After the transaction commits, the customer's whole folder (`…/private/customers/{customerId}/`) is deleted with `storage.deleteDirectory`, which removes the forms, documents, photo and exports and the folders themselves. The anonymised customer has no files, folders or references left.

**Deleting a customer** (the People page's "Delete permanently" today, and any later delete) does the same: the database rows go by cascade as now, and the customer's folder is deleted after the delete commits. Today deletion leaves the customer's files on disk with nothing pointing to them; this closes that.

If storage can't be reached at that moment, the customer's folder is recorded in a small `sys_storage_cleanup` queue table (path, reason, attempts) and a scheduled job retries it, so a temporary storage outage never leaves files behind.

The anonymise confirmation in the customer page is updated to list what is removed.

The personal-data export lists the customer's completed forms by name, date and version, as it lists uploaded documents.

### 1.11 API

All business routes require `business_id` (Critical Rule 3) and use the existing permission checks.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/v1/forms` | List / create forms (`settings:*` to change) |
| GET / PUT / DELETE | `/v1/forms/:id` | Read / update (version +1) / archive |
| POST | `/v1/forms/:id/duplicate` | Copy as a new form |
| POST | `/v1/forms/:id/language-versions` | Add a language version to the group |
| GET | `/v1/customers/:id/forms` | Applicable forms with status, and submissions |
| POST | `/v1/customers/:id/forms/requests` | Start a device session or send a link (`{ group_id, channel, booking_id? }`) |
| POST | `/v1/customers/:id/forms/submissions` | Staff complete an unsigned form on the customer's behalf |
| GET | `/v1/customers/:id/forms/submissions/:sid/file` | The PDF |
| POST | `/v1/customers/:id/forms/submissions/:sid/email` | Email a copy to the customer |
| GET | `/v1/public/forms/:token` | The form to complete (public; the token is the key) |
| POST | `/v1/public/forms/:token` | Submit it (public; rate limited) |
| PUT / POST | `/v1/system-config/storage`, `/storage/test` | Existing routes: encrypt the secret, real connection test, clear the storage cache |

Every endpoint has its UI: the Templates tab, the customer profile, booking detail, check-in and the public form page.

### 1.11a Forms at self check-in (Requirement 3, criteria 4 to 10)

A customer checks in on the front-desk kiosk or from their own phone. Either way, check-in comes first and is never held back by a form; then the customer sees every form that applies to the visit and completes what is missing.

- **Kiosk screen (`/kiosk`).**
  - A public full-screen page for a tablet. It authenticates with the kiosk device's existing token. Staff register the tablet once under **Settings > Check-In Kiosk** (it acts straight away, like Processes), then open the link shown there, `/kiosk?token=…`, on the tablet; the page keeps the token in the browser and removes it from the address. The same tab lists the kiosks and switches one off.
  - The customer types a phone number or email address, or scans their booking QR code with a scanner that types the code. A name is never used.
  - A phone number matches a customer on its digits (with or without the country code); an email address matches exactly. Only people with a confirmed or already checked-in booking today are found, and if more than one person matches nothing is guessed: "Please see the front desk."
  - The page then shows a greeting, the visit, and the list of forms with ticks and **Fill in** buttons, then **Done**, which returns to the start. It also returns to the start after a period of inactivity.
  - If nothing is scheduled today under that phone number or email address, but the person has other confirmed or pending appointments from today to 60 days ahead (at most five), the kiosk says "Nothing is scheduled for today", lists them by service and date and time, and sends the person to the front desk. Nothing else about the person or the appointment is shown. If two people match, or the person has no upcoming appointments, the message is the plain "could not find an appointment" one.
- **Phone page (`/check-in/:code`).**
  - The code is a long random code on the booking (64 bits or more), carried in the link. It is a different code from the short booking QR code, which is too easy to guess for a public link.
  - The page shows the visit and an **I'm here** button, then the same list of forms. If the customer opens it before check-in opens, it says so. It works for a booking that is already checked in, to complete forms.
  - The link is added to each appointment reminder email, and staff can copy it from the booking page.
- **Forms.**
  - **Fill in** starts a device form request for that customer, booking and form (one use, valid for 1 hour) and opens the existing `/forms/:token` page. A `next` address brings the customer back to the kiosk or phone page afterwards, where the list shows the new tick. `next` is limited to the kiosk and check-in pages.
  - Requests are created when the customer taps **Fill in**, not when the list is shown, so showing the list never cancels a form someone is filling in.
- **Kiosk session.** After identifying a customer the server returns an encrypted, short-lived (30 minutes) session that names the booking. The kiosk sends it back to list forms and start one, so the customer is not asked again and the kiosk never holds anything but that session.
- **Security.** The public routes are rate limited. Responses carry only the first name, the service and time, and the forms; no contact details or ids. Every lookup is scoped to the kiosk's business or the code's booking.

### 1.12 Security

- **Link tokens:** 32 random bytes. Only their SHA-256 is stored. They expire after 1 hour (device) or 7 days (link), work once, and are cancelled when replaced.
- **Public routes:** Rate limited per IP and per token. Request bodies are size-limited, with the signature image capped. Answers are validated against the form definition, text lengths are capped, and nothing submitted is rendered as HTML.
- **Private files:** Never public. They're read only through authenticated routes that check `business_id` and `customer_id`. The `/storage` route refuses any path with a `private` segment.
- **The S3 secret:** It's encrypted at rest and never returned to the browser. Leaving the keys blank on AWS uses an IAM role, so no keys are stored at all.
- **Evidence for each signed form:** Signing time, IP address, device, form version and the PDF's SHA-256.

### 1.13 Build order

1. **Storage:**
   - Backend chosen from Configuration.
   - S3 implemented.
   - Encrypted secret.
   - Real connection test.
   - Public route streaming through storage.
   - `storagePaths`, with every writer switched to it.
2. **The one-time move script**, run with `--dry-run`, then for real.
3. **Migration 168 and the shared form definition** with its validator.
4. **The form builder** on the Templates tab.
5. **Requests and the public form page**, with signature capture.
6. **PDF generation and storage, submissions,** and the timeline entry.
7. **Status and actions:**
   - Forms on the customer profile, booking detail and check-in.
   - View, print and email a copy.
8. **Anonymisation, customer deletion and the personal-data export,** including the cleanup queue.
9. **Verification:**
   - Both storage backends.
   - A signed form end to end.
   - The move.
   - Anonymisation and deletion removing every file and folder.
   - No empty folders after deleting a single file.
---

## 2. Gap 2: Treatment charting

### 2.1 Approach

A chart is a form that staff fill in about a customer, not one the customer fills in. It reuses the form definition, the form builder and the PDF drawing from gap 1. What is new is that the answers are kept (encrypted), the chart belongs to a booking or a customer, it is restricted to clinical roles, every touch is audited, and it locks on sign-off with amendments afterwards.

### 2.2 Permission

- One new permission, `clinical:*`, covering both reading and writing (the permission check does not treat write as including read, so one permission avoids a half-access state). Migration 171 adds it to the system roles Tenant Owner, Business Owner and Manager (additive, like migration 135), and the tenant seed list gives it to new tenants.
- Therapist and trainer share the "Staff" role with reception, and there is no role editor. So the Staff role is not given the permission. Instead the job title decides: `hasClinicalAccess(user)` (`auth/clinical.ts`) returns true for a user holding `clinical:*`, or whose role on the user record is therapist or trainer. Reception never gets it. The charts routes use it as a guard before every route.
- The client `getPermissionsFromRole` is kept in step and the chart UI hides itself without access. The server is the authority.

### 2.3 Data model

Migration 171 (with the permission). Tables carry `tenant_id` and `business_id`. Like the forms tables, isolation is in the application (every query is scoped by `business_id`, and the route checks the business belongs to the caller's tenant); there are no database row-level policies on these tables.

- `frm_forms` gains `kind TEXT NOT NULL DEFAULT 'form'` (`form` or `chart`). Chart templates are listed on Business Setup > Templates under a new type **Charts** (shown to clinical roles only). The forms lists, outstanding-forms status and public form requests all ignore `kind = 'chart'`. The validator rejects `agree` and `signature` items in a chart (sign-off is the practitioner's click).
- `svc_services` gains `default_chart_group_id UUID NULL` (the group of the chart template suggested for the service; a group id because a template's id changes per version row).
- `chr_charts`: `id`, `tenant_id`, `business_id`, `customer_id`, `booking_id` (nullable), `form_id`, `form_name`, `form_version`, `definition_encrypted` (the template as it was when started, so later template edits change nothing), `answers_encrypted`, `status` (`draft` or `signed`), `created_by`, `created_at`, `updated_at`, `signed_by`, `signed_at`, `pdf_path`, `pdf_sha256`.
- `chr_amendments`: `id`, `tenant_id`, `business_id`, `chart_id`, `content_encrypted`, `created_by`, `created_at`. Append only.

Encryption uses `utils/encryption`, as customer notes do.

### 2.4 Lifecycle

- **Draft:** created from a template, against a booking or standalone. Answers are saved as the practitioner types and can be changed freely. Only drafts can be deleted, and only by their author or a manager.
- **Sign off:** one action by a user with `clinical:write`. It checks the answers with the shared validator, records name and time, draws the PDF with the existing PDF code (headed "Treatment chart", with the practitioner's name and the sign-off time), stores it in `{customer folder}/charts/`, then locks the chart. If the PDF cannot be stored, the chart stays a draft.
- **Locked:** the answers can no longer change by any route.
- **PDF:** the stored sign-off PDF is never replaced. Downloading a chart that has amendments draws a fresh PDF that includes them.
- **Amend:** any user with chart access adds a dated note to a signed chart. The original and the amendments are shown together, amendments below, oldest first.

### 2.5 Audit

Each of these writes to `usr_audit_log` with `logAuditStrict`, so the action is refused if the entry cannot be written: `chart.viewed` (opening one chart, and listing a customer's charts), `chart.created`, `chart.updated` (draft saves are written once per session of edits, not per keystroke), `chart.signed`, `chart.amended`, `chart.deleted`, `chart.pdf_downloaded`.

### 2.6 Where it appears

- **Booking edit/detail:** a Chart panel (clinical roles only). It offers the service's default template, or a choice of templates, and shows the booking's chart.
- **Customer profile:** a **Charts** tab listing the customer's charts newest first, with the previous chart's key answers shown when a new one is started. Standalone charts are started here.
- Customers never see charts, and the customer portal has no route to them.

### 2.7 Anonymisation, merge and export

- `anonymizeCustomer` deletes the customer's `chr_charts` and `chr_amendments` in its transaction, queues the chart PDFs for cleanup, and `deleteCustomerFolders` removes the `charts` folder.
- `customer-duplicates.service.ts` finds every table that references a customer, so charts move to the surviving customer on merge without a list entry; only its preview label (`Treatment charts`) is added.
- The personal-data export lists charts by date and template name, without the content.
- Existing customer notes are left alone.

### 2.8 API

All routes require `business_id` and clinical access.

- `GET /charts/customer/:customerId`, `GET /charts/booking/:bookingId`, `GET /charts/:id`
- `POST /charts` (customer, optional booking, template), `PUT /charts/:id` (draft only), `DELETE /charts/:id` (draft only; the author, or an owner or manager)
- `POST /charts/:id/sign`, `POST /charts/:id/amendments`, `GET /charts/:id/pdf`
- Chart templates reuse the form template routes with `kind=chart` (listing them needs clinical access; building them needs `settings:*`). `PUT /services/:id` accepts `default_chart_group_id`.

### 2.9 Build order

1. Migration 171, permission helper, shared validator change.
2. Chart service and routes with audit, then tests for access, locking and amendments.
3. Charts type on the Templates tab and the service default.
4. Customer Charts tab and booking Chart panel.
5. Sign-off PDF.
6. Anonymise, merge and export hooks.
7. Verification: access refused for reception, audit rows written, locked chart cannot change, anonymise removes rows and files.

---

## 3. Gap 3: Virtual waiting room

### 3.1 Scope

Criteria 14 to 19 of Requirement 3. Criteria 1 to 13 were built with gap 1 (design 1.11a). Customer SMS is not part of this gap: "ready for you" goes by email and on the customer's screen now, and SMS joins it when gap 4 provides a sender.

### 3.2 Data

Migration 174 adds to `apt_bookings`: `ready_at TIMESTAMPTZ` (when staff said "ready for you") and `started_at TIMESTAMPTZ` (when the session started). The status values already allow `in_progress`.

### 3.3 Status flow

`confirmed -> checked_in -> in_progress -> completed`. Lifecycle changes:
- `checked_in` may go to `in_progress` (start session), `completed` or back to `confirmed` (reset, which clears `checked_in_at` and `ready_at`).
- `in_progress` may go to `completed`. Checkout works from `checked_in` and `in_progress`.
- `startBooking` sets `started_at`; `markReady` (only while `checked_in`) sets `ready_at`.

### 3.4 Staff check-in through the check-in service

`PUT /bookings/:id/check-in` calls `completeCheckIn` (window rules, check-in record, audit, arrival alert) for a booking with a customer. If the rules refuse it, the answer is a 409 with code `CHECK_IN_REFUSED` and the reason; the screen asks "Check in anyway?" and repeats the call with `override: true` and the reason, which the record stores (`validated = false`, `override_reason`). A booking with no customer (a walk-in by name) has nothing to record against, so it keeps the plain status change and still appears on the waiting list.

### 3.5 Waiting list

`GET /bookings/waiting?business_id=` returns today's bookings in `checked_in`, oldest check-in first: id, customer name or walk-in name, service, practitioner, `checked_in_at`, `ready_at`, and the number of forms still to complete (from `countOutstandingForBookings`). "Today" is the business's own day. The panel and the Appointments list both refresh every 10 seconds (the list only while its first page is showing) and after any action. Each row has Ready for you, Start, Check-out and Reset. The row opens the booking.

### 3.6 Alerts

A new Inbox notification event `customer_arrived` (title "Ines has arrived", body service and time, link to Bookings). Defaults: owner, manager and front desk in the app, nobody by email; the booked practitioner is always included in the app alert (`alsoTo`). Settings > Inbox lists it with the other events so the business can change roles and email; each person can switch their own off. It fires from `completeCheckIn`, so kiosk, phone, QR and staff check-in all alert.

### 3.7 Customer screens

`selfView` gains `ready` (`ready_at` set while checked in) and `started` (`in_progress`). The phone page shows "Please come in" when ready and "Your appointment has started" when started, and polls every 5 seconds while checked in. The kiosk does the same through its session and does not time the screen out while the visit is waiting. "Ready for you" also emails the customer when they have an email address.

### 3.8 Bookings page

Two panes: the Waiting list panel (maximum height with its own scroll), then Appointments, which has From and To dates that start as today and are sent as `date_from` and `date_to`. Day boundaries use the business's time zone (the list query used the database's). Customers see their own bookings without either pane's staff features.

### 3.10 Getting the link to the customer

The personal check-in link (`/check-in/DSCI-...`) reaches the customer three ways:
- **Confirmation email:** the appointment template gets a **Check-in Link** placeholder (`check_in_link`) and fills the **Add to Calendar** placeholder (`calendar_links`), which until now resolved to nothing. Add to Calendar is Google and Outlook links; when the template uses it, an `invite.ics` is attached for Apple Calendar and others. A template without the placeholder gets neither. (`manage_link`, a page to view, change or cancel the appointment, is still empty: no such page exists yet.)
- **Reminder emails:** reminders are sent through the business's **Appointment Reminder** template (its own entry in the Document Type list: the Appointment placeholders plus **Time Until Appointment**, filled as "24 hours" or "2 hours", so the template writes "Your appointment is in {{reminder_lead}}"). A business that has not written one yet gets the plain reminder, which always carries the check-in link; the plain reminder is not a template and goes away when starter templates exist (gap 17). Reminder data carries the customer's name, the check-in link and the calendar links. Reminders are queued by a job that runs every 15 minutes (it had never been scheduled). It looks at confirmed appointments in the next 14 days, skips any that already have reminders pending or sent, cancels pending reminders for an appointment that was moved or is no longer confirmed (compared to the second), and queues one reminder per lead time that is still in the future. An appointment booked too close to its start for any reminder is covered by the confirmation email.
- **Staff Copy link:** unchanged.

Lead times come from `booking.reminder_hours` (a list of hours, at most five, each up to 336): the business's own value in `sys_business_configurations` first, then the tenant's, then the system default of 24 and 2. There is no screen for the business value yet.

### 3.11 Words on the customer screens, and the ready email

Nothing a customer reads on the check-in screens is written into the pages. The shared package holds the wording of every supported language (`CHECK_IN_TEXT_DEFAULTS`, keyed by language, so TypeScript will not compile until a newly supported language has a full set). The server answers every customer screen with the wording already chosen:
- **Language:** the customer's own language, then the business's default, then English (`languageFor`).
- **Business wording:** `apt_check_in_texts` (migration 176) holds, per business and language, only the pieces the business changed. A saved piece replaces the built-in wording; an empty one goes back to it. The visit (`selfView`) carries the finished wording and the language, and the kiosk status carries the entry screen's wording in the business's language. A page shows the built-in wording only until the server's arrives.
- **Editing:** Business Setup > Templates > **Check-In**: choose a language, see each piece with the built-in wording as the hint, and save (`GET`/`PUT /v1/checkin-texts`, business settings permission). Pieces that can include the customer's details accept `{{first_name}}`, `{{service_name}}` and `{{time}}`.
- **Not editable:** system messages (the kiosk "not set up" lines, generic failures, and the server's refusals such as "link no longer valid", which show before a business is known) are held per language in the same place but not offered for editing.
- **Ready for you email:** there is no separate template. The email is built from the same Check-In wording (the greeting, the "ready for you" message and one extra piece, the email subject), in the customer's language, and sent at once. The business changes it in the one place.

### 3.12 Which screen Bookings opens on

The calendar redesign made `/bookings` open the calendar for staff, which hid the Waiting list behind the List switch. Each business, and each person, now chooses:

- **Business default:** config key `bookings.default_view` (`calendar` or `list`, system default `calendar`) in `sys_business_configurations`, registered by migration 177. It is set under Settings > System > Bookings screen (`GET`/`PUT /v1/bookings-view`; reading is open to anyone of the business, saving needs the business settings permission).
- **Own choice:** `stf_profiles.bookings_default_view` (migration 177; NULL follows the business). It is set on the staff profile under Personal Information, "Bookings opens on", and saved with the profile (`PUT /v1/staff/:id`).
- **Opening Bookings:** `/bookings` for staff renders `BookingsHome`, which asks `GET /v1/bookings-view` (own choice, then business) and shows the calendar or the list; nothing shows until the answer arrives, so the other screen never flashes. `/bookings/calendar` and `/bookings/list` always show that screen, and the Calendar | List switch uses them, so switching never sends a person back to their default. Customers keep their list.

### 3.9 Build order

1. Migration 174, lifecycle changes (start, ready, reset), time-zone-correct date range.
2. Staff check-in through `completeCheckIn` with override.
3. Waiting list route and arrival alert event.
4. Bookings page panes.
5. Phone page and kiosk "Please come in", polling, ready email.
6. Verification live with the owner.

---

## 7. Gap 7: Retail inventory (Requirement 7)

In-person sales only: stock is counted per product (or variant) and location, changed only through recorded movements, and valued at average cost.

### 7.1 Data model

```sql
-- migration 180 (all new tables: tenant_id NOT NULL, business_id NOT NULL, RLS)
ALTER TABLE prd_merchandise          ADD COLUMN track_stock BOOLEAN NOT NULL DEFAULT false,
                                     ADD COLUMN cost_cents INTEGER, ADD COLUMN barcode VARCHAR(64),
                                     ADD COLUMN supplier_id UUID REFERENCES fin_vendors(id);
ALTER TABLE prd_merchandise_variants ADD COLUMN cost_cents INTEGER, ADD COLUMN barcode VARCHAR(64);

-- one row per stock item (a product without variants, or a variant) and location
CREATE TABLE inv_stock (
  id, tenant_id, business_id, location_id, merchandise_id, variant_id NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER, reorder_qty INTEGER,
  updated_at,
  UNIQUE (location_id, merchandise_id, variant_id)
);

-- every change; never updated or deleted
CREATE TABLE inv_movements (
  id, tenant_id, business_id, location_id, merchandise_id, variant_id NULL,
  qty_change INTEGER NOT NULL,                 -- + in, - out
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('sale','refund_restock','refund_write_off','receive',
         'adjust','count','transfer_in','transfer_out','opening')),
  adjust_reason VARCHAR(40),                   -- damaged, lost, used in a service, found, correction
  unit_cost_cents INTEGER,
  order_item_id UUID, po_line_id UUID, count_id UUID, transfer_id UUID,
  note TEXT, created_by UUID, created_at
);

-- migration 182: purchase orders; account 1300 Inventory seeded for every business
CREATE TABLE inv_purchase_orders (id, tenant_id, business_id, po_number (PO-0001), vendor_id, location_id,
  status ('draft','sent','partly_received','received','closed','cancelled'), expected_on DATE, note, sent_at, created_by, created_at, updated_at);
CREATE TABLE inv_po_lines (id, tenant_id, business_id, po_id, merchandise_id, variant_id NULL,
  qty_ordered, qty_received DEFAULT 0, qty_billed DEFAULT 0, unit_cost_cents);
ALTER TABLE inv_movements ADD COLUMN po_line_id;   -- a receipt says which order line it came in on
ALTER TABLE fin_bills ADD COLUMN purchase_order_id; -- a bill says which order it bills
-- migration 181: transfers
CREATE TABLE inv_transfers (id, tenant_id, business_id, from_location_id, to_location_id, note, created_by, created_at);
ALTER TABLE inv_movements ADD COLUMN transfer_id;

ALTER TABLE fin_orders ADD COLUMN location_id UUID REFERENCES sys_locations(id);  -- where the sale happens
```

- `inv_stock.on_hand` is kept with each movement in the same transaction (row lock), so it always equals the sum of movements.
- `prd_merchandise` has no `tenant_id` today; the new tables have it, as AGENTS.md requires.

### 7.2 Stock changes

- **Sale:** when an order is completed, each tracked product line writes a `sale` movement at the order's location at the stock item's average cost (in the same transaction as completion). An order's location is the booking's location, else the one chosen at Checkout (a business with one location: that one).
- **Refund:** the refund screen asks per product line "Back into stock" or "Write off"; `refund_restock` adds it back at the cost it was sold at, `refund_write_off` records it with no stock change.
- **Receiving:** each received line writes `receive` and updates average cost: `new avg = (on_hand × avg + qty × unit cost) / (on_hand + qty)` (on hand below zero counts as zero).
- **Adjust, count, transfer:** an adjustment writes `adjust` with its reason; a transfer writes `transfer_out` and `transfer_in` at the source's average cost and arrives at once (no stock in transit).
- **Count (owner, 18 Nov 2026: on the product's Stock card, no separate count sessions):** Count lists the product's options at a location with on hand; each count entered that differs sets on hand to it (`count`, the first one `opening`); empty boxes are not changed.
- **Never more than is on hand (owner, 15 Nov 2026):** adding a tracked product, or raising its quantity, is limited to what is on hand at the order's location less what is already on the order's other lines for it; the answer says it was limited. None on hand: the line is refused. Completing the order checks again under the stock row lock (stock may have changed since); if a line no longer fits, the order is not completed and staff are told which line to reduce. Stock never goes below zero through a sale.

### 7.3 Checkout

- The product picker and each product line show "n in stock" at the order's location (per variant), coloured when at or below the reorder level.
- A quantity above what is on hand is limited to it, with "Only 3 in stock, 3 added" on the line; an item with none on hand is shown as Out of stock and cannot be added.
- The order shows its location; a business with several locations chooses it (default: the booking's, else the primary).

### 7.4 Screens

- **Product page:** Track stock, cost, barcode, supplier; a Stock card per location and option (on hand, average cost, reorder level and quantity) with its history and Change stock, Reorder, Count and Transfer buttons.
- **No separate Inventory page (owner, 18 Nov 2026):** stock is managed on each product's Stock card: Change stock and Reorder per row; Count and Transfer (with more than one location) for the whole product; History. The low-stock list is a report (Reports > Inventory > Low Stock), and an automated process sends the low_stock notification (owner, 19 Nov 2026).
- **Purchase orders (Accounting > Purchase Orders, next to Vendors and Bills):** a list (order, date, vendor, deliver to, expected, status, received of ordered, total, to bill) and an order page `/accounting/purchase-orders/:id` (`new` for a new one). A draft is edited there: vendor, delivery location (when there are several), expected date, a note for the vendor, and lines of tracked products (products the vendor supplies listed first; an option must be chosen; unit cost starts at the option's or product's cost price; the quantity starts at its reorder quantity at the delivery location, else 1, and can be changed; owner, 19 Nov 2026). Save draft; Email to vendor (needs the vendor's email) or Mark as sent. The email uses the business's Purchase Order template (Settings > Templates, document type `purchase_order.sent`; owner, 18 Nov 2026): placeholders for the business, vendor name and contact, PO number, order and expected dates, delivery location and address, order total, note, and the details table (product with unit cost, quantity, amount). Without an active template a built-in layout is sent. Replies go to the template's reply-to, else the business email. A sent order is received (Receive: arrived quantity per line, at most what is still to come, and its unit cost), in one go or in parts; Create bill makes a vendor bill for what was received and not yet billed (due by the vendor's payment terms; vendor invoice number optional), shown on the order. The bill is approved when it is created, so it can be paid straight away (owner, 19 Nov 2026). Cancel order (nothing received) or Close order (partly received: the rest is not coming).
- **Notifications:** a `low_stock` event in Settings > Inbox (default: owners and managers, bell and email). An automated check every 15 minutes (with the reminder job) tells the business once when an item is at or below its reorder level, in one message listing every item that has newly fallen low (product, option, location when there are several, on hand, reorder level and quantity); an item is told about again only after it has been restocked above its level (`inv_stock.low_notified_at`, migration 183).

### 7.5 Accounting and reports

- Accounts: 1300 Inventory (migration 182); 5100 Inventory Adjustments, 3900 Opening Balance Equity and its heading 3000 Equity (migration 183); seeded for every business. Stock is carried at cost: a purchase order's bill Dr 1300 / Cr 2100 Accounts Payable (one entry per bill, through the existing bill posting; stock received and not yet billed is on hand but not yet on the books). A sale: Dr 5000 Cost of Goods Sold / Cr 1300 at the average cost it was sold at, as lines of the order's journal entry. Returned to stock on a refund: Dr 1300 / Cr 5000 at the cost it was sold at; written off: nothing more (its cost stays in 5000). Opening stock: Dr 1300 / Cr 3900. Counts and adjustments: stock found Dr 1300 / Cr 5100, stock gone Dr 5100 / Cr 1300, at cost. Transfers stay in 1300 and post nothing. Each stock posting other than a sale is its own entry (reference `inventory_movement`) in the same transaction as the movement; a missing account is logged and the posting skipped.
- Reports, in their own Inventory category (owner, 19 Nov 2026), through the report framework (filters, grouping, totals, CSV and PDF export): **Stock on Hand & Value** (as of today, shown in place of From and To and not chosen (owner, 19 Nov 2026); on hand and average cost are rebuilt from the stock history up to that day, so the report could later be run for a past date; always grouped by location with a subtotal per location and no Group by options: product, variant, on hand, reorder at, cost price, average cost, stock value at average cost, retail price, retail value, margin per item and %, the margin using the average cost, else the cost price); **Low Stock** (as of today, grouped by location like Stock on Hand & Value, no SKU or supplier: items at or below their reorder level, with reorder quantity, what is still to come on sent purchase orders, and the reorder cost); **Stock Movements** (date range, From and To kept; grouped by location like Stock on Hand & Value: every movement with its date, reason, change, unit cost, value, on hand after and who; no time, reference or note columns (owner, 19 Nov 2026)). Product cells link to the product page; order references to the receipt. The report framework gained a fixed grouping (`groupBy` on a report: rows are always shown and exported in those groups, with no Group by options) and hidden columns (carried on the rows for grouping, not shown or exported).

### 7.6 Build order

1. Migration 180, stock service (movements, average cost, locks), product fields and the product Stock tab, opening stock by count.
2. Sale and refund movements; Checkout quantity on hand, warnings and order location.
3. Count and transfer on the product's Stock card.
4. Purchase orders, receiving, bills (migration 182; Accounting > Purchase Orders).
5. Low-stock notification; accounting postings (migration 183).
6. Inventory reports: Stock on Hand & Value (cost price, average cost, stock value, retail value, margin) and Stock Movements.
7. Verification live with the owner.

---

## 14. Gap 14: Tips (Requirement 14)

A tip is money the customer gives the staff who served them. It is charged with the sale, never counted as a sale, and owed to staff until it is handed over (cash) or paid in payroll (electronic).

### 14.1 Data model

```sql
-- migration 185
ALTER TABLE fin_orders ADD COLUMN tip_amount INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
                       ADD COLUMN tip_refunded_cents INTEGER NOT NULL DEFAULT 0,
                       ADD COLUMN tip_split JSONB;            -- a split set by hand: [{user_id, amount_cents}]
-- each staff member's share of a paid tip
CREATE TABLE fin_tip_shares (id, tenant_id, business_id, order_id, user_id,
  amount_cents, refunded_cents DEFAULT 0,
  electronic BOOLEAN,                 -- card / direct debit / wallet / gift card: paid through payroll
  status ('owed','handed_over','paid','pool','allocated'), pay_period_id NULL, paid_cents, paid_at,
  from_pool_share_id NULL,           -- a staff share made by sharing out a pool share (migration 187)
  created_at, updated_at);
-- migration 187: user_id NULL for a pool share; CHECK ((user_id IS NULL) = (status IN ('pool','allocated')))
-- account 2700 Tips Payable (liability), seeded for every business
-- settings (sys_business_configurations): tips.enabled (false), tips.default_percent (15), tips.max_percent (30, migration 189),
--   tips.on_manual (true), tips.split ('value' | 'even'), tips.base ('before_tax' | 'after_tax', migration 186)
```

- `fin_orders.total_amount` stays the sale total. What the customer pays is `total_amount + tip_amount`, so every sales figure (Sales by Item, Revenue, Reconciliation's Sales, commission) leaves tips out by itself.

### 14.2 Checkout

- With tipping on, Checkout shows a Tip panel above the payment: a slider from No tip to the business's highest percentage of the total (after discounts; before tax by default, or including tax, as the business chose), in 1% steps, showing the percentage and the amount; and a typed amount; then the total to pay. A new order starts at the business's default percentage and that tip is put on the order; moving the slider saves where it is let go; no tip is kept as 0% so the default is not put back (owner, 23 Nov 2026; migration 189 replaces `tips.percentages` with `tips.default_percent` and `tips.max_percent`). `PUT /checkout/orders/:id/tip { tip_cents, split? }` stores it on the open order; a cash or other manual payment with a tip is refused when the business allows tips on card only.
- A suggested percentage is sent as `percent` and the server works the tip out from it; `fin_orders.tip_percent` keeps it (migration 188; NULL for a typed amount). Every change that recalculates the order's totals (a line added, changed or removed, a promo) calls `refreshOrderTip`, as does a change to the order's credit: a percentage tip is worked out again, an order with no lines has no tip, and a split by hand is dropped when the tip or the staff change (owner, 23 Nov 2026).
- Who gets it is shown under the tip: the staff on the order's lines (a line's credit, else the order's), shared by the value of their lines or evenly, as the business chose; Change opens a split by hand (amounts that must add up to the tip).
- The payment takes `total_amount + tip_amount` in every path: a saved card or bank account, a gift card, a walk-in's one-time card (the PaymentIntent is created for the sum), and cash, transfer and check (recorded).
- On completion the shares are written: `electronic` for card, direct debit, wallets and gift card, else handed over at the time (status `handed_over`).
- The receipt (screen, PDF and email) shows each item before tax, then Tax and Tip as lines of their own with no quantity, then the total paid (owner, 22 Nov 2026).

### 14.3 Accounting

- The order's journal entry debits Cash (or Gift Card Liability) for sale + tip and credits 2700 Tips Payable for the tip. A tip handed over in cash: Dr 2700 / Cr 1100 when the order is completed.
- Payroll: when a pay run is calculated, each staff member's electronic tips collected in the period and not yet in a finalised run are a `tips` line of gross pay (a staff member with tips but no pay rule still gets an entry). Finalising the run marks those shares `paid` with the pay period; the payroll journal debits 2700 for the tips part of gross pay instead of the wages account.
- A refunded tip: Dr 2700 / Cr Cash; each share's `refunded_cents` takes its part (in the same proportions); a share already paid in payroll, or handed over in cash, goes below zero on what is owed, and the next pay run takes it off (Cr 2700 in the payroll entry).

### 14.4 Refunds

- The refund window lists the tip as its own line (amount left to refund); it can be refunded alone or with product lines. Refunding product lines never touches the tip.

### 14.5 Settings and report

- Settings > Payment Methods > Tips: on or off, where the tip slider starts and its highest percentage, whether they are of the total before or including tax, tips on cash and manual payments (yes / card only), how a tip is shared (by service value / evenly).
- Reports > Staff > Tips (date range): per staff member, tips collected (electronic, cash), refunded, paid (handed over and in payroll) and owed, with a detail of each tip (order, date, method, share).

### 14.6 Tip pool

- An order paid with a tip and no staff member on it writes one share with `user_id` NULL and status `pool` (owner, 22 Nov 2026). A cash pool tip stays in the till; its order entry makes no Dr 2700 / Cr 1100.
- Accounting > Payroll > Tip Pool shows what is waiting (electronic and cash) and shares it for a date range (`start` optional, `end` required, the business's local days):
  - `hand`: an amount per staff member; the amounts must add up to the pool for the dates.
  - `hours`: each pool tip among the staff clocked in on its day (`computeDailyHours` from `clk_events`), by their minutes worked that day.
  - `even`: each pool tip evenly among the staff clocked in on its day.
  - By the clock, a tip from a day nobody was clocked in stays in the pool, and the preview lists those days.
- `GET /checkout/tip-pool` (summary and staff), `POST /checkout/tip-pool/plan` (preview, nothing changes; `unassigned_cents` shows what is still to give out by hand) and `POST /checkout/tip-pool/share`, all `settings:*`.
- Sharing, in one transaction: each part becomes a staff share of the same order with the tip's own date and `from_pool_share_id`: electronic `owed` (into the next pay run), cash `handed_over`. The pool share becomes `allocated`. Cash shared out posts one entry Dr 2700 / Cr 1100 (`reference_type 'tip_pool'`). A pool share that changed after the preview (a refund) stops the share with a conflict.
- Refunds skip `allocated` pool shares and come off the staff shares made from them. Payroll reads staff shares only (`user_id IS NOT NULL`).
- The Tips report has a Tip pool section: each pool tip with its amount, refunded, shared out and waiting. Shared-out parts are already in the staff sections, so the pool section is not added to them.

### 14.7 A service paid at reservation

- The service stays on the order that paid it (the reservation order); the visit's order holds only what is sold at the visit and the tip, so nothing is posted twice (owner, 23 Nov 2026). The alternative, copying the service onto the visit's order as a prepaid line with a credit, was rejected: every report, commission, stock, journal and refund path would have to skip those lines.
- `prepaid-order.service.ts`: the reservation order is another completed (or refunded) order of the same booking holding the booking's service line. `getOrder` returns it as `prepaid` (number, date, method, totals, lines with their staff).
- Checkout shows a read-only Paid at reservation card above the items: its lines, Paid amount and a link to its receipt. No edit or remove; refunds stay on that order.
- Tip: the suggested percentages are of the visit's total plus the reservation order's (not when refunded); the staff on its lines share the tip with the visit's (`tipOrders` in `tips.service.ts`). With no lines of its own, a visit keeps its tip.
- Paying: with nothing else sold and no tip, Finish appointment (as before). With a tip, the visit's order is paid for the tip alone; its journal entry is Dr Cash / Cr 2700 only.
- Receipt (screen, PDF and email, one builder `orderReceiptRows`): the reservation order's lines before tax, the visit's lines, Tax, "Paid at reservation (ORD-…)" taking off what was paid then, the Tip; the total is what was paid at the visit.

### 14.8 Build order

1. Migration 185, settings, tips service (shares, split), Checkout tip panel and payment, receipt.
2. Journal, refunds, payroll, Tips report.
3. Tip pool (migration 187): pool shares, Tip Pool screen, sharing by hand or by the clock, report section.
4. The tip follows the order (migration 188); a service paid at reservation shown at the visit and tipped on (14.7).
5. Verification live with the owner.

---
## 15. Service add-ons (Requirement 15)

An add-on enhances a service and adds no time. It is added on the service like an option: a name, a description and a price; a service has as many as needed (owner, 24 Nov 2026, replacing a shared list of ad hoc and product add-ons built first). Staff and customers choose them with the service; each becomes its own line on the price, the order and the receipt.

### 15.1 Data model (migrations 196 and 197)

```sql
-- a service's add-ons (tenant_id, business_id NOT NULL, RLS)
CREATE TABLE svc_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, business_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES svc_services(id),
  name VARCHAR(200) NOT NULL, description TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),           -- cents
  display_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',          -- 'archived' when deleted on the service
  created_by, created_at, updated_at
);
-- what an appointment has: name and price as they were when chosen (criterion 5)
CREATE TABLE apt_booking_addons (
  id, tenant_id, business_id, booking_id, addon_id REFERENCES svc_addons(id),
  name VARCHAR(200) NOT NULL, price INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',          -- 'removed'
  created_by, created_at, removed_by, removed_at
);
ALTER TABLE fin_order_items ADD COLUMN booking_addon_id UUID REFERENCES apt_booking_addons(id);
-- fin_order_items.item_type gains 'add_on' (invoice, credit-note and debit-note lines keep their own types)
ALTER TABLE pkg_package_items ADD COLUMN addon_id UUID REFERENCES svc_addons(id);  -- item_type 'add_on'
```

- Migration 196 made a shared list with product add-ons and per-service prices; migration 197 moved each add-on onto its service with its price and dropped the product columns and the per-service price table (only test data existed).
- An add-on is chosen at most once per appointment, quantity 1, also on a group or shared booking.
- Deleting an add-on on the service archives it: it is no longer offered; appointments that have it keep it at their price.

### 15.2 Choosing add-ons

- The appointment window shows the service's add-ons under the option as chips with prices. Changing the service drops the add-ons of the old service and says which. One already paid (at reservation) cannot be taken off; it is refunded from the order like any paid line.
- The booking widget shows them after the option, as checkboxes with prices.
- Create and update booking take `addons: string[]`; the server checks each is an active add-on of the booking's service and copies name and price into `apt_booking_addons`. Add-ons chosen when booking are set before the confirmation email is queued.
- Each change is written to the appointment history: "Add-ons: none → Hot stones".

### 15.3 Price and order lines

- The price quote adds a line per add-on under the service, so New Appointment, the payment step and the widget show the same numbers.
- `openBookingOrder` (via `syncAddonLines`) adds one `item_type 'add_on'` line per add-on after the service line, with `booking_addon_id`, credited to the booking's staff member, taxed with the service's tax category, which is kept on the line for any later recalculation.
- An open order follows the appointment's add-ons; removing an add-on's line at Checkout takes it off the appointment ("Removed at Checkout"). When the service was paid at reservation, add-ons not on that order go on the visit's order.
- 'add_on' lines post to Service Revenue (4100) and are refunded like service lines; revenue, staff performance, recognised revenue and commission count them with services.

### 15.4 Memberships and packages (criterion 6)

- A membership never pays an add-on.
- A package item can be an add-on of a service (shown as "Hot stones (Massage)"). The benefit engine has a third target, `itemType 'add_on'`, packages only.
- When the appointment's order is opened, and whenever its add-on lines change, each add-on line is paid from the package the appointment is held against, if that package includes the add-on and has some left (`payAddonsFromBookingPackage`); otherwise it is charged. The price shown while booking shows the same.

### 15.5 Screens

- **Service Details → Add-ons**: rows like the options, each with its name, price and description; Add Add-on opens name, description and price; edit and delete per row; saved with the page's Save changes.
- **Appointment window**: add-on chips under the option; the price summary lists them.
- **Calendar card and Bookings list**: "Massage + Hot stones".
- **Receipt**: each add-on as a line after the service. **Appointment emails**: the service name reads "Massage + Hot stones".
- **Package screen**: an included item can be an add-on.

### 15.6 API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/services/:id/addons?business_id=` | The service's add-ons |
| PUT | `/v1/services/:id/addons?business_id=` | Save them: `[{ addon_id?, name, description, price }]` in order; without `addon_id` is new, left out is deleted |
| GET | `/v1/addons?business_id=` | The business's add-ons with their service (package items) |
| POST, PUT | `/v1/bookings`, `/v1/bookings/:id`, `/v1/widget/booking` | `addons: string[]` |

---
## 18. Appointment history (Requirement 18)

Everything that happens to an appointment is kept in one place, shown to staff on the appointment, and cannot be changed (owner, 23 Nov 2026).

### 18.1 Data model (migration 192)

The status history table becomes the appointment's history:

```sql
ALTER TABLE apt_booking_status_history
  ALTER COLUMN to_status DROP NOT NULL,
  ADD COLUMN event      VARCHAR(12) NOT NULL DEFAULT 'status',  -- created | status | changed | payment
  ADD COLUMN changes    JSONB,         -- [{ field, from, to }]: names, not ids; times as ISO
  ADD COLUMN details    JSONB,         -- a payment: { kind: order | paid | refunded | fee, order_id, order_number, amount_cents, method, fee }
  ADD COLUMN actor_type VARCHAR(10),   -- staff | customer | system
  ADD COLUMN source     VARCHAR(20),   -- staff | widget | customer_portal | self_check_in | import | job | system
  ADD COLUMN job        VARCHAR(80);   -- an automatic job's name
```

- Existing rows: a creation (no previous status), a move ("Rescheduled") or a status change; by a staff member when one was recorded, else the system. `source` stays empty: shown as "before full history".
- A trigger refuses any update or delete, except removing entries with their appointment (a cascade) and anonymising (`app.history_anonymise = 'on'` for that transaction only).
- Entries are written with `clock_timestamp()`, so entries of one request keep their order.

### 18.2 Who and where

- `booking-history.service.ts`. An app-level middleware gives each request its context; who is read when an entry is written (after sign-in): a customer's own login, the booking widget, the customer link or self check-in is the customer; a signed-in staff member is staff; else the system. Where comes from the path: `/v1/widget` widget, `/v1/public/check-in` self check-in, `/v1/profile/customer` and other public links customer link, `/v1/import` import, else staff screen.
- `runAsJob(name, fn)` runs a job's work as the system with its name; the automatic no-shows record their rule ("Marked No-Show automatically: not checked in 15 minutes after the start").

### 18.3 What is recorded

- Created (`booking.service`), every status change (`transitionStatus`, check-in, walk-in check-in, both automatic no-shows, a recurring series or occurrence cancelled, completed at Checkout).
- Field changes: a snapshot before and after (`snapshotBooking`, `recordChanges`) in the appointment edit and Reschedule: time, service, option, staff, location, resource, people, price, notes, customer.
- Payments (criterion 5): Checkout opened (the appointment's order), paid (amount, method), refunded, no-show fee charged. A late-cancellation fee is worked out but not charged anywhere yet, so there is nothing to record for it.
- Fixed with it: a payment confirmed the appointment whatever its status, which undid a check-in (checked in → confirmed), so a paid appointment was never completed. Confirming now applies only to a pending appointment.

### 18.4 Showing it

- `GET /v1/bookings/:id/history` (staff with `bookings:read`; not a customer's own login): newest first, each with when, who (name, the customer, or System and its job), where, what happened in plain words, each field before → after, and the reason.
- The appointment window (edit and view) has a History section, closed until opened.

### 18.5 Anonymising

- When a customer is anonymised, in the same transaction: their appointments' entries keep times, statuses, staff and payments; reasons are removed and the notes and customer values of changes are cleared.
### 18.6 Long-term storage (migrations 193 and 194)

So the table does not grow without end (owner, 23 Nov 2026): recent history stays in the database; the history of long-past appointments moves to file storage (the S3 bucket chosen on Configuration > Storage, or the local folder in development), one JSON file per appointment at `…/businesses/{b}/private/booking-history/{year}/{booking}.json` (private: never served publicly).

- Job `booking_history_archive`, one per tenant (migration 194; owner, 23 Nov 2026): not per business (it would be forgotten or not understood), not one run for the platform (it would fall in some businesses' opening hours). Daily at the time the tenant chooses in its time zone, for all its businesses; `config: { months: 12, batch: 500 }`. Every tenant starts with it on at 03:00 in the tenant's time zone, and a new tenant gets it when created. It moves appointments finished (completed, cancelled, no-show) whose end is more than `months` ago.
- The tenant's Processes page has an Appointment History Storage card: run time, time zone, months, on or off, next and last run, how many appointments have their history in the database and in files, Save and Run now (`GET`/`PUT /v1/bookings/history-storage`, `POST /v1/bookings/history-storage/run-now`, tenant level, `settings:*`). The file is written and read back first; only then are the rows removed (`app.history_archive = 'on'` for that transaction) and `apt_bookings.history_archive_path` / `history_archived_at` set. A failure leaves the rows where they are, for the next run.
- An archived appointment changed later (a late refund): the new entry is in the table, shown with the archived ones, and added to the same file at the next run.
- The History section reads the file and the table together; nothing looks different.
- Anonymising a customer also rewrites their appointments' files without reasons, notes and their name. A bucket with S3 Object Lock in compliance mode would refuse that rewrite: use versioning (or governance mode) on the bucket instead.
- A retention period after which files are removed is not set (a business and legal decision).
## 19. Paying with a membership or package (Requirement 19)

One place decides what a customer's memberships and packages cover, holds the allowance for a booking, and counts it as used at payment. New Appointment, the payment step, the price shown while booking and Checkout all use it.

### 19.1 What counts

- **Memberships** are the `mbr_*` model: an active enrollment (`mbr_enrollments`, `status = 'active'`, `cancelled_at IS NULL`) of a plan whose plan items (`mbr_plan_items`) include the service, for any option (`variant_id` empty) or for the option booked. Each item allows `quantity_per_period` uses per `access_frequency` window: `daily` (the calendar day), `weekly` (Monday to Sunday), `monthly` (a month counted from the membership's start day, which is the membership term for a monthly plan) or `unlimited`. The window is the one the appointment falls in, in the business's time zone. Product items cover products at Checkout the same way.
- **Packages** are an active purchase (`pkg_purchases`, not expired on the appointment day) with an item for the service (any option, or the one booked) or the product. Sessions items use 1 per person; minutes items use the appointment's length.
- The reads of the old `mem_*` tables (the booking payment step, membership pricing rules) are replaced by this.

### 19.2 Holding and using an allowance

A new table records each use, so it can be counted, shown, moved and given back:

```sql
-- the next free migration number
CREATE TABLE pay_benefit_uses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  business_id   UUID NOT NULL,
  customer_id   UUID NOT NULL,
  kind          VARCHAR(12) NOT NULL CHECK (kind IN ('membership', 'package')),
  enrollment_id UUID REFERENCES mbr_enrollments(id),   -- membership
  plan_item_id  UUID REFERENCES mbr_plan_items(id),
  purchase_id   UUID REFERENCES pkg_purchases(id),     -- package
  package_item_id UUID REFERENCES pkg_package_items(id),
  booking_id    UUID REFERENCES apt_bookings(id),
  order_item_id UUID REFERENCES fin_order_items(id),
  quantity      INTEGER NOT NULL DEFAULT 1,             -- sessions or items
  minutes       INTEGER,                                -- a minutes package
  window_start  DATE, window_end DATE,                  -- a membership's allowance window
  status        VARCHAR(10) NOT NULL CHECK (status IN ('held', 'used', 'released')),
  created_at    TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);  -- RLS on tenant_id, as every table
```

- **Left** = allowance − (held + used) in the window (membership) or in total (package).
- **Booking made** with a membership or package: a `held` row for the booking.
- **Paid** (Checkout completed, or paid at reservation): the row becomes `used`, linked to the order line. A package use also writes its `pkg_redemptions` row and a membership use adds to `mbr_usage.quantity_used`, so the existing reports and the customer's timeline stay right.
- **Cancelled** booking: `held` becomes `released`. A refund of the order line releases a `used` row and removes its redemption.
- **Changed** at Checkout (another membership or package, or a normal method): the old row is released and, where one is chosen, a new one held.

### 19.3 API

- `GET /v1/bookings/benefits?business_id&customer_id&service_id&variant_id&start_time&participants`: every membership and package of the customer, each marked as covering the booking or not (with the reason: used up this week, expired, not for this option), with used, allowance, left and the window end or expiry.
- `POST /v1/bookings` and `PUT /v1/bookings/:id` take `benefit: { kind, enrollment_id | purchase_id, item_id } | null`; the server checks it covers the booking and holds it in the same transaction as the booking.
- Checkout: `PUT /v1/checkout/orders/:id/items/:itemId/benefit` sets or clears the benefit of a line (the service line of a booking, a product line); the line's price becomes zero (a discount recorded with the benefit's name, as now).
- `payment-quote` and the price shown while booking take the same `benefit` and return the lines with it applied.

### 19.4 Screens

- **New Appointment, as soon as a customer is chosen:** the Price box lists the customer's memberships and packages that cover what is booked, with used and left. "Pay with membership or package" is first and preselected on the one that runs out soonest; the customer's other covering memberships and packages, and "Pay normally", can be picked instead. Ones that do not cover it are shown greyed with the reason.
- **Reservation Payment Rules:** with a membership or package chosen the service costs nothing, so the reservation is saved without the payment step: "Charged at reservation" has nothing to charge, and "Taken but not charged" does not ask for a card (owner, 23 Nov 2026; this replaces keeping a card for extras and fees). The allowance is held now and counted as used at Checkout.
- **Checkout:** each covered line shows "Paid with ⟨name⟩ (n left after this)" and a Change control: another covering membership or package, or a normal method. Lines not covered are paid as usual.
- **Receipt:** covered lines show the membership or package that paid them.

### 19.5 As built (23 Nov 2026)

- Migration 190 `pay_benefit_uses`, as 19.2, plus `order_id`, and `redemption_id` / `mbr_usage_id` (what a use added when used, removed when it is given back).
- `benefits.service.ts`: `benefitOptions` (what covers, sorted: covering first, then the one that runs out soonest), `holdBenefit` (an advisory lock per allowance), `markUsed`, `releaseUse`; bookings: `setBookingBenefit`, `recheckBookingBenefit` (after a change of service, option, time, people or customer: kept if it still covers, else given back and the answer says why); orders: `attachBookingBenefit` (the booking's hold pays its service line when the order opens), `setLineBenefit`, `useForOrder` (on payment), `releaseForOrderItem` (a removed line; a booking's hold goes back to the booking), `releaseForOrder` (a voided order).
- A booking already used, or paying its open order's line, keeps its choice: saving it again changes nothing; another choice is made on the line at Checkout.
- Cancelling gives back what was held or used for the booking; a no-show gives back only what was held (owner to confirm). A refunded product line paid with a benefit gives back what it used (no money moves).
- The price shown while booking (`pricing.service.ts`, rules for members of some plans) reads `mbr_enrollments`; the payment step's old `mem_*` and single-package logic is replaced by the chosen benefit.
- The line keeps its normal `unit_price`; the benefit is its discount, noted "Paid with ⟨name⟩", as the journal already books discounts.
- Added in testing with the owner (23 Nov 2026):
  - A package sold at Checkout is given to the customer when the order is paid (one purchase per package on the line, `pkg_purchases.order_item_id`, migration 191, which also gave the packages already sold without one). The intro-offer check is not made again after payment.
  - The customer's Packages tab: each package bought, what it includes, used / booked / left, and each use with its appointment and order (`GET /v1/packages/purchases/customer/:id/usage`).
  - With a membership or package chosen, New Appointment saves without the payment step and no card is required (19.4).
  - The default is a covering membership first, then the package that expires soonest, then Pay normally; it follows the day, time and option until staff choose one.
  - Only what can be used is listed: expired or used-up packages, paused or ended memberships are left out; a membership cancelled to end at the close of its period covers until then.
  - Allowances are counted on the appointment's day: before a time is chosen, the day chosen; a line added at an appointment's Checkout, the appointment's day; a rescheduled appointment's hold moves with it.
  - Checkout: the appointment's own service line cannot be removed; services can be added as lines.
- Not in this build: a plan's member price (`discount_services_pct`) and the customer booking widget (it pays normally).

### 19.6 Tips on what a membership or package paid (Requirement 19, criteria 10 and 11)

- A line paid with a benefit keeps its normal price on the line (`unit_price`; the benefit is its discount), so the tip base uses `unit_price × quantity` for it, plus the tax it would have had when the tip setting is including tax; the split by value uses the same normal value (owner, 23 Nov 2026).
- The tip is paid by the order's normal payment method; with nothing else to pay, the order is paid for the tip alone (as design 14.7).
- Paid at reservation (design 14.7) shows a benefit-paid line as "Paid with ⟨name⟩" and the tip follows the rule above.

### 19.7 Build order

1. A migration (the next free number) and the benefits service (what covers, held / used / released), replacing the `mem_*` reads.
2. Benefits endpoint; booking create / update hold the chosen benefit; cancel releases it.
3. New Appointment price box with the choice; payment step and quote follow it.
4. Checkout: benefit per line, change, used on completion; refund releases.
5. Receipt lines; verification live with the owner.
