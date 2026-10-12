# Phase 46: People Foundation - Design Document

**Date**: October 12, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 02, Phase 05, Phase 12, Phase 16, Phase 38

---

## Overview

This phase extends the existing Phase 05 tables and services. It adds no module and renames no table or route. A Person is a row of `cus_customers`; the UI calls the list "People". Two new shared services, the Identity Service and the Contactability Service, become the only way to create a Person and the only way to decide whether a message may be sent. Phases 47 and 48 depend on both.

---

## Table of Contents

1. [Principles](#1-principles)
2. [Database Schema](#2-database-schema)
3. [Data Migration](#3-data-migration)
4. [Service Architecture](#4-service-architecture)
5. [API Endpoints](#5-api-endpoints)
6. [Frontend](#6-frontend)
7. [Permissions](#7-permissions)
8. [Error Handling](#8-error-handling)
9. [Testing Strategy](#9-testing-strategy)
10. [Rollout Order](#10-rollout-order)
11. [Open Questions](#11-open-questions)

---

## 1. Principles

- **One record, three lenses.** People is who they are; Inbox (47) is what was said; Marketing (48) is how they are being converted. All three read `cus_customers`.
- **Stage, not type.** `lifecycle_stage` stays a single column with the six existing values.
- **One way in.** Nothing inserts into `cus_customers` except `person-identity.service.ts`.
- **One gate out.** Nothing sends a message without `contactability.service.ts`.
- **Label change only.** Tables keep the `cus_` prefix and routes stay under `/customers`, so Phase 05 code, tests and links keep working.

```
 manual   import   widget   lead form   inbound msg (47)   API
    \        \        |         |             /             /
     +--------+-------+----+----+------------+-------------+
                           v
              person-identity.service  (find or create)
                           v
                     cus_customers  <---- People list / profile
                      ^         ^
        Inbox (47) ---+         +--- Marketing audiences (48, 43)
                           |
              contactability.service  (may we send?)
```

---

## 2. Database Schema

All changes are in migration `136_people_foundation.sql` unless stated. Marketing scoping is in `137_marketing_business_scope.sql` so it can be reviewed and rolled out separately.

### 2.1 `cus_customers` changes

```sql
ALTER TABLE cus_customers
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN first_name DROP NOT NULL,
  ALTER COLUMN last_name DROP NOT NULL,
  ADD COLUMN phone_e164 VARCHAR(20),
  ADD COLUMN source VARCHAR(30) NOT NULL DEFAULT 'unknown'
      CHECK (source IN ('manual','import','booking_widget','online_registration',
                        'lead_form','inbound_message','referral','walk_in','api','unknown')),
  ADD COLUMN source_detail VARCHAR(200),
  ADD COLUMN owner_user_id UUID REFERENCES usr_users(id),
  ADD COLUMN user_id UUID REFERENCES usr_users(id),
  ADD COLUMN last_activity_at TIMESTAMPTZ,
  ADD COLUMN last_visit_at TIMESTAMPTZ,
  ADD COLUMN lifecycle_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN email_deliverability VARCHAR(20) NOT NULL DEFAULT 'ok'
      CHECK (email_deliverability IN ('ok','bounced','complained','invalid')),
  ADD COLUMN phone_deliverability VARCHAR(20) NOT NULL DEFAULT 'ok'
      CHECK (phone_deliverability IN ('ok','invalid','blocked')),
  ADD COLUMN merged_into_id UUID REFERENCES cus_customers(id),
  ADD COLUMN merged_at TIMESTAMPTZ,
  ADD CONSTRAINT chk_cus_customers_contact_point
      CHECK (email IS NOT NULL OR phone IS NOT NULL OR status IN ('anonymized','merged'));
```

- `status` CHECK gains `'merged'` (`active`, `archived`, `anonymized`, `merged`).
- `UNIQUE(business_id, email)` is replaced by a partial unique index:
  `CREATE UNIQUE INDEX uq_cus_customers_business_email ON cus_customers (business_id, lower(email)) WHERE email IS NOT NULL AND status NOT IN ('merged','anonymized');`
- New indexes: `(business_id, phone_e164)`, `(business_id, source)`, `(business_id, owner_user_id)`, `(business_id, last_activity_at DESC)`, `(business_id, user_id)` unique where `user_id IS NOT NULL`.
- The full-text index is rebuilt with `COALESCE` around every name and email term (they can now be null).
- "Profile incomplete" is derived, not stored: `email IS NULL OR first_name IS NULL OR last_name IS NULL`.
- Phone normalisation uses `libphonenumber-js` with the business country as default region. `phone` keeps the text as typed; `phone_e164` is null when the number cannot be parsed.

### 2.2 `usr_users` change

```sql
ALTER TABLE usr_users ADD COLUMN last_login_at TIMESTAMPTZ;
```

Set on every successful login and token refresh-from-login (not on silent refresh). Shown on the profile through `cus_customers.user_id`.

### 2.3 Unified consent

`mkt_communication_preferences` becomes the single consent table. It already has channel, category, state, timestamps and source.

```sql
ALTER TABLE mkt_communication_preferences
  ADD COLUMN business_id UUID REFERENCES sys_businesses(id),   -- NOT NULL after backfill
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- channel CHECK: email, sms, push  ->  email, sms, whatsapp, in_app, push
-- category CHECK added: marketing, reminders
-- unique key: (customer_id, channel, category)
```

New append-only history:

```sql
CREATE TABLE cus_consent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
    business_id UUID NOT NULL REFERENCES sys_businesses(id),
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    channel VARCHAR(20) NOT NULL,
    category VARCHAR(20) NOT NULL,
    previous_state BOOLEAN,
    new_state BOOLEAN NOT NULL,
    method VARCHAR(30) NOT NULL
        CHECK (method IN ('form','portal','unsubscribe_link','staff_entry','import','keyword_reply','merge','migration')),
    evidence TEXT,                       -- staff note on how consent was obtained, form name, etc.
    actor_user_id UUID REFERENCES usr_users(id),   -- null when the Person acted without a login
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`cus_preferences` is no longer written. Its four switches map as follows and the table is dropped in a later migration once verified:

| `cus_preferences` | Unified row |
|---|---|
| `email_marketing` | `email` / `marketing` |
| `sms_marketing` | `sms` / `marketing` |
| `push_notifications` | `push` / `marketing` |
| `booking_reminders` | `email` / `reminders` and `sms` / `reminders` |

### 2.4 Segments

```sql
ALTER TABLE cus_segments
  ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'dynamic' CHECK (kind IN ('dynamic','static')),
  ADD COLUMN description VARCHAR(300),
  ADD COLUMN tenant_id UUID REFERENCES sys_tenants(id);   -- backfilled from the business, then NOT NULL

CREATE TABLE cus_segment_members (
    segment_id UUID NOT NULL REFERENCES cus_segments(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    tenant_id UUID NOT NULL,
    business_id UUID NOT NULL,
    added_by UUID REFERENCES usr_users(id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (segment_id, customer_id)
);
```

New rule fields accepted by `evaluateRules`: `source`, `owner_user_id`, `last_activity_at`, `last_visit_at`, `last_login_at`, `consent.<channel>`, `has_account`, `incomplete`. Date fields accept relative operators (`within_days`, `older_than_days`, `never`).

### 2.5 Duplicate flags and view preferences

```sql
CREATE TABLE cus_duplicate_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    other_customer_id UUID NOT NULL REFERENCES cus_customers(id),
    match_type VARCHAR(10) NOT NULL CHECK (match_type IN ('phone','email')),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, other_customer_id)
);
```

Per-user list preferences (last View, chosen columns) are stored client-side in `localStorage` keyed by user and business. No table.

### 2.6 Marketing business scope (`137_marketing_business_scope.sql`)

Add `business_id UUID REFERENCES sys_businesses(id)` to `mkt_campaigns`, `mkt_sequences`, `mkt_lead_funnels`, `mkt_message_templates`, `mkt_communication_preferences`. Unique keys that included only the tenant (`mkt_lead_funnels (tenant_id, slug)`) become `(business_id, slug)`. RLS policies stay tenant-based; services filter by business. System templates (`is_system = true`) keep `business_id` null and are visible to every business.

### 2.7 RLS and grants

Every new table gets `tenant_id`, the standard `tenant_isolation_*` policy, the admin policy and grants to `daystream_app`, matching migration 007.

---

## 3. Data Migration

Run inside migration 136/137, each step idempotent.

| Step | Rule |
|---|---|
| Phone | `phone_e164` computed by a one-off script (`scripts/backfill-phone-e164.ts`), not in SQL |
| Source | Existing rows keep the default `unknown` |
| Linked account | `user_id` set where a `usr_users` row with persona `customer` in the same tenant has the same email, ignoring case |
| Last activity / visit | Computed from `apt_bookings`, `apt_check_in_records` and `fin_orders` |
| Stage date | `lifecycle_changed_at` from the latest lifecycle Timeline entry, else `created_at` |
| Email case | Before the new unique index: report pairs that differ only by case; the migration stops if any exist so they can be merged first |
| Consent | Insert unified rows from `cus_preferences`; where a `mkt_communication_preferences` row already exists, keep `opted_in = false` if either says false; write one `cus_consent_events` row per Person and Channel with method `migration` |
| Marketing scope | `business_id` from the tenant's only business; otherwise from the segment (campaigns) or enrolled People (sequences); rows still null are written to `sys_server_logs` and listed by the migration, and the column stays nullable until they are resolved |

Local check on 2026-10-12: one tenant has more than one business; each `mkt_` table holds 17 rows (mostly created by tests).

---

## 4. Service Architecture

### 4.1 `person-identity.service.ts` (new)

```ts
export type PersonSource =
  | 'manual' | 'import' | 'booking_widget' | 'online_registration' | 'lead_form'
  | 'inbound_message' | 'referral' | 'walk_in' | 'api' | 'unknown';

export interface PersonInput {
  businessId: string;
  tenantId: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  source: PersonSource;
  sourceDetail?: string | null;
  initialStage?: LifecycleStage;      // default 'lead'
  userId?: string | null;             // Linked_Account, when the caller is a logged-in customer
  actorUserId?: string | null;
  extra?: Partial<PersonOptionalFields>;
}

export interface PersonResult {
  person: Person;
  created: boolean;
  matchedBy: 'email' | 'phone' | null;
  duplicateFlagIds: string[];
}

export async function findOrCreatePerson(input: PersonInput, client?: PoolClient): Promise<PersonResult>;
export async function findPersonByContactPoint(businessId: string, cp: { email?: string; phone?: string }): Promise<Person | null>;
export function normaliseEmail(email: string): string;
export function normalisePhone(phone: string, defaultCountry: string): string | null;
```

Matching order: email (case-insensitive) → single phone match → create. Multiple phone matches create a new Person and write `cus_duplicate_flags`. On a match, empty fields are filled, existing ones are left alone, `source` is never changed, and a `matched_via_<source>` Timeline entry is written. Runs in the caller's transaction when a client is passed. The insert handles the unique-index race by retrying the lookup once.

Callers changed to use it, removing their own insert statements:

| Caller | Today | After |
|---|---|---|
| `customer.service.createCustomer` | direct insert | `source: manual / walk_in / referral` |
| `customer-import.service` | direct insert | `source: import`, detail = file name |
| `widget-booking.service.findOrCreateCustomer` | direct insert | `source: booking_widget`, `initialStage` from lifecycle rules |
| `auth` customer registration | no Person created | `source: online_registration` |
| `marketing-funnels.submitForm` | broken insert | `source: lead_form`, detail = form name (fixed fully in Phase 48) |

### 4.2 `contactability.service.ts` (new)

```ts
export type Channel = 'email' | 'sms' | 'whatsapp' | 'in_app' | 'push';
export type Purpose = 'marketing' | 'transactional';
export type RefusalReason =
  | 'no_consent' | 'no_contact_point' | 'archived' | 'merged' | 'anonymized'
  | 'undeliverable' | 'reminders_off' | 'channel_not_connected';

export interface ContactDecision { allowed: boolean; reason?: RefusalReason; address?: string; }

export async function canContact(personId: string, businessId: string, channel: Channel, purpose: Purpose): Promise<ContactDecision>;
export async function filterAudience(businessId: string, personIds: string[], channel: Channel, purpose: Purpose):
  Promise<{ allowed: string[]; excluded: Array<{ personId: string; reason: RefusalReason }>; }>;
export async function summariseAudience(businessId: string, segmentId: string, channel: Channel, purpose: Purpose):
  Promise<{ total: number; willReceive: number; excludedByReason: Record<RefusalReason, number>; }>;
```

`filterAudience` is one set-based query, not a loop. `marketing-campaigns.service` and `sequence-engine.service` call it immediately before each send; `marketing-consent.isOptedIn` becomes a thin wrapper and is then removed.

### 4.3 `consent.service.ts` (replaces `marketing-consent.service.ts`)

`getConsent`, `setConsent` (writes the row and a `cus_consent_events` entry in one transaction), `getConsentHistory`, `processUnsubscribe`. `setConsent` with method `staff_entry` requires `evidence`.

### 4.4 Changes to existing services

- `customer.service`: list query gains views, new columns, new filters, `next_booking_at` (lateral join), and `display_name` (`COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email, phone)`). `updateCustomer` normalises phone.
- `customer-lifecycle.service.transitionLifecycle`: also sets `lifecycle_changed_at`.
- `customer-activity.service`: new `touchActivity(personId, at)` and `touchVisit(personId, at)`, called from booking creation, check-in, order completion and login.
- `customer-segments.service`: `updateSegment`, static list membership functions, new rule fields, extended `seedPredefinedSegments`, deletion guard.
- `customer-duplicates.service.mergeCustomers`: rewritten, see 4.5.
- `auth` login: sets `usr_users.last_login_at` and calls `touchActivity` for the Linked_Account's People.

### 4.5 Merge

One transaction:

1. Lock both rows (`FOR UPDATE`), verify same business, neither merged nor anonymised.
2. Apply chosen profile fields to the primary; keep the earlier `created_at` and `source`.
3. For every table with a foreign key to `cus_customers(id)`, move rows from secondary to primary. The list is read from `information_schema` at run time so a table added later is never forgotten, with explicit handlers for tables that have a unique key including the customer (tags, custom fields, consent, segment members, sequence enrollments, points, streaks, payment refs): keep the primary's row, or combine where the design says so (consent: more restrictive; points: sum).
4. Mark the secondary `status = 'merged'`, set `merged_into_id` and `merged_at`, clear its email and phone so they are free for reuse.
5. Close related `cus_duplicate_flags`; write Timeline and audit entries.

On 2026-10-12 forty-two tables reference `cus_customers`. A test asserts that every one of them is either handled explicitly or covered by the generic move.

---

## 5. API Endpoints

All under `/api/v1`, all requiring `business_id`.

| Method | Path | Change |
|---|---|---|
| GET | `/customers` | New query params: `view`, `source`, `owner` (`me` / `none` / id), `incomplete`, `consent_email`, `last_activity_before/after`, `segment_id`, `include_archived`. New fields in each row |
| GET | `/customers/view-counts` | New. Counts per system View |
| POST | `/customers` | Email optional; `source` accepted; response includes `matched: true` when an existing Person was returned |
| PUT | `/customers/:id` | Accepts `owner_user_id`, `source_detail` |
| GET | `/customers/:id` | A merged id answers `301`-style payload `{ merged_into: id }` |
| POST | `/customers/bulk` | New. `{ ids or filter, action, payload }`; returns affected count |
| POST | `/customers/bulk/preview` | New. Returns the count only |
| GET | `/customers/:id/consent` | New. Current state per Channel and Purpose |
| PUT | `/customers/:id/consent` | New. One change with method and evidence |
| GET | `/customers/:id/consent/history` | New |
| GET / PUT | `/customers/:id/preferences` | Kept for compatibility; reads and writes the unified store |
| GET | `/customers/:id/duplicates` | New. Open flags |
| POST | `/customers/:id/duplicates/:flagId/dismiss` | New |
| POST | `/customers/merge/preview` | New. What will move, per table |
| POST | `/customers/merge` | Behaviour replaced (4.5) |
| PUT | `/segments/:id` | New |
| POST / DELETE | `/segments/:id/members` | New. Static lists only |
| GET | `/segments/:id/audience-summary` | New. `channel`, `purpose` → total, will receive, excluded by reason |
| all | `/marketing/*` | Require `business_id`; filter by it |

Every endpoint has a UI (no orphans): bulk and view counts on the People list; consent, duplicates and merge preview on the profile; segment editing on Segments; audience summary on the campaign form.

---

## 6. Frontend

- `moduleRegistry.ts`: entry `customers` → title "People", description "Leads and customers in one place". Path unchanged.
- Stage labels come from one shared map (`packages/shared`): `lead` Lead, `trial` New customer, `active` Active, `at_risk` At risk, `churned` Former, `winback` Won back. Stored values do not change.
- `Customers.tsx`: View tabs with counts above the table; column chooser; row selection with a bulk action bar; Source, Owner, Last activity columns; "Incomplete" badge; segment picker. Mobile card layout.
- `CustomerCreate.tsx`: email or phone required (not both); Source select; when the Identity Service returns a match, show "This person already exists" with a link instead of an error.
- `CustomerDetail.tsx`: new header strip (stage, Source, Owner, created, last activity, last login); consent block on Overview replacing the Preferences switches, with a "History" link; duplicate banner; Timeline filter chips; merge dialog with a preview step.
- `Segments.tsx`: edit, dynamic / static label, live count, new rule fields.
- `CampaignCreate.tsx`: audience summary line ("412 in segment · 37 excluded · 375 will receive", with reasons on hover).
- All new CSS uses design-system variables and existing components (`Tabs`, `Table`, `Badge`, `Drawer`, `Modal`, `MultiSelect`, `Pagination`).

---

## 7. Permissions

No new permission. `customers:read` sees People, Views and consent state. Creating, editing, bulk actions and consent changes need `customers:update` (or `customers:*`). Merge and anonymise need `customers:*`. Marketing endpoints keep `marketing:*`.

---

## 8. Error Handling

| Case | Response |
|---|---|
| Neither email nor phone given | 400 `CONTACT_POINT_REQUIRED` |
| Email already used by another Person on update | 409 `EMAIL_IN_USE` with the other Person's id |
| Staff consent change without evidence | 400 `CONSENT_EVIDENCE_REQUIRED` |
| Merge across businesses, or of a merged / anonymised record | 409 `MERGE_NOT_ALLOWED` |
| Deleting a Segment in use | 409 `SEGMENT_IN_USE` with the names of what uses it |
| Bulk action on more than 5,000 People | Runs as a background job; the UI shows progress |

---

## 9. Testing Strategy

- Unit: `normaliseEmail`, `normalisePhone`, matching order, fill-not-overwrite, every `RefusalReason`.
- Integration (supertest, own test businesses via `tests/helpers/test-business.ts`): each entry point creates one Person for the same email; phone-only create; merge with bookings, payments and memberships; consent migration; marketing scope isolation between two businesses of one tenant.
- Merge coverage test over `information_schema` (4.5).
- End-to-end: `docs/e2e/suites/08-customers.md` scripts CUS-17 to CUS-28, and journey JNY-15.

---

## 10. Rollout Order

1. Schema and backfill (no behaviour change).
2. Identity Service, callers switched one by one.
3. Consent unification and Contactability Service.
4. Merge rewrite.
5. Segments.
6. Marketing business scope.
7. UI: label, Views, columns, profile, bulk actions.

Each step leaves the app working and is testable on its own.

---

## 11. Open Questions

| # | Question | Default taken in this design |
|---|---|---|
| 1 | Should `/customers` URLs become `/people`? | No. Label only, to avoid breaking links and tests |
| 2 | Should the "Customers" View include `trial`? | Yes |
| 3 | Is a reminder switch per channel needed, or one switch for all reminders? | Per channel in the data, one switch in the UI |
| 4 | May reception create People and record consent? | Yes, through the Front Desk role created in Phase 47 (`customers:update`). The Staff role (service providers) stays read only |
| 5 | Default country for phone numbers | The business country |
