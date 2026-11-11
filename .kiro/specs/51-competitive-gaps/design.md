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
