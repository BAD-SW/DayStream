# Phase 48: Marketing Module - Design Document

**Date**: October 12, 2026
**Status**: 🎨 Design Phase (draft, follows the draft requirements)
**Dependencies**: Phase 46, Phase 47, Phase 16, Phase 43

---

## Overview

This document covers the Leads section of the Marketing module, the only section specified so far. Later sections get their own numbered part of this document.

Leads adds a handful of columns to the Person record, reworks the Phase 16 lead funnel into a business-scoped Lead Form with an embeddable version, and adds a Leads tab to Marketing that is a filtered view of the People list API. No lead table is created: the Leads tab and the People "Leads" View run the same query.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Service Architecture](#2-service-architecture)
3. [API Endpoints](#3-api-endpoints)
4. [Lead Form Embed](#4-lead-form-embed)
5. [Frontend](#5-frontend)
6. [Reporting](#6-reporting)
7. [Permissions](#7-permissions)
8. [Testing Strategy](#8-testing-strategy)
9. [Open Questions](#9-open-questions)

---

## 1. Database Schema

Migration `139_leads.sql`.

### 1.1 `cus_customers` lead fields

```sql
ALTER TABLE cus_customers
  ADD COLUMN lead_status VARCHAR(15)
      CHECK (lead_status IN ('new','contacted','converted','lost','disqualified')),
  ADD COLUMN lead_status_changed_at TIMESTAMPTZ,
  ADD COLUMN lead_lost_reason VARCHAR(30)
      CHECK (lead_lost_reason IN ('no_response','not_interested','price','location',
                                  'schedule','competitor','duplicate_spam','other')),
  ADD COLUMN lead_lost_note VARCHAR(300),
  ADD COLUMN first_contacted_at TIMESTAMPTZ,
  ADD COLUMN last_contacted_at TIMESTAMPTZ,
  ADD COLUMN converted_at TIMESTAMPTZ,
  ADD COLUMN conversion_type VARCHAR(10) CHECK (conversion_type IN ('booking','order','membership','manual')),
  ADD COLUMN conversion_ref_id UUID,
  ADD COLUMN next_follow_up_at DATE,
  ADD COLUMN follow_up_note VARCHAR(300),
  ADD COLUMN interest VARCHAR(200);

CREATE INDEX idx_cus_customers_leads ON cus_customers (business_id, lead_status) WHERE lead_status IS NOT NULL;
CREATE INDEX idx_cus_customers_follow_up ON cus_customers (business_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
```

The status set is fixed here. Phase 49 (Custom Lead Stages) replaces the two open values with business-defined stages; the closed values `converted`, `lost` and `disqualified` stay system-owned, so nothing in this phase needs undoing.

`lead_status` is null for People who were never a lead (created directly by a booking). Backfill: existing `lead` stage rows → `new`; rows at any other stage whose Timeline shows they started as `lead` → `converted` with `converted_at` from that Timeline entry.

Relationship to `lifecycle_stage`:

| lifecycle_stage | lead_status | Meaning |
|---|---|---|
| `lead` | `new` / `contacted` | Open lead |
| `lead` | `lost` / `disqualified` | Closed lead; stays at `lead`, hidden from open lists |
| any other | `converted` | Was a lead, now a customer |
| any other | null | Never a lead |

### 1.2 Lead Forms

`mkt_lead_funnels` is kept (already business-scoped by Phase 46 migration 137) and extended:

```sql
ALTER TABLE mkt_lead_funnels
  ADD COLUMN consent_text VARCHAR(500),
  ADD COLUMN assign_tag_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN assign_owner_user_id UUID REFERENCES usr_users(id),
  ADD COLUMN allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN success_message VARCHAR(500),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- status CHECK: 'active', 'inactive', 'archived'

CREATE TABLE mkt_lead_form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    funnel_id UUID NOT NULL REFERENCES mkt_lead_funnels(id),
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    created_person BOOLEAN NOT NULL,
    consent_given BOOLEAN NOT NULL DEFAULT false,
    data JSONB NOT NULL,
    origin VARCHAR(255), ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `submissions` counter stays for speed; the submissions table is the record.

### 1.3 Settings and sequences

- Business configuration keys: `leads.default_owner_mode` (`none` / `user` / `form`), `leads.default_owner_user_id`, `leads.notify_user_ids`, `marketing.daily_message_limit_per_channel`.
- `mkt_lead_source_sequences (business_id, source, sequence_id)`: the sequence that starts for new Leads of a Source. A sequence set on a Lead Form takes precedence.
- `mkt_sequences.stop_on_conversion BOOLEAN NOT NULL DEFAULT true`, `stop_on_reply BOOLEAN NOT NULL DEFAULT true`.

---

## 2. Service Architecture

### 2.1 `lead.service.ts` (new)

```ts
onPersonCreated(person)            // sets lead_status 'new' when stage is 'lead'; owner rule; notify; start sequence
markContacted(personId, at, by)    // idempotent; sets first/last_contacted_at
closeLead(personId, status, reason, note, userId)
reopenLead(personId, userId | 'system')
setFollowUp(personId, date, note, userId) / completeFollowUp(personId, next?)
onStageChanged(person, from, to, cause)   // 'lead' → other: converted, clears follow-up, stops sequences
getLeadCounts(businessId, userId)  // new, contacted, follow-up due, mine
```

Hooks, all in existing code paths:

| Event | Where | Calls |
|---|---|---|
| Person created | `person-identity.findOrCreatePerson` (46) | `onPersonCreated` |
| Existing closed lead matched again | `findOrCreatePerson` | `reopenLead('system')` |
| Outbound message sent | `message.service.sendMessage` / `recordAutomated` (47) | `markContacted` |
| Inbound message | `message.service.receiveInbound` (47) | `reopenLead` if closed; stop sequences with `stop_on_reply` |
| Stage changed | `customer-lifecycle.transitionLifecycle` | `onStageChanged` |

### 2.2 `marketing-funnels.service.ts` (reworked)

`submitForm` becomes: validate fields and the anti-automation check → `findOrCreatePerson({ source: 'lead_form', sourceDetail: form.name })` → consent via `consent.service.setConsent(method: 'form')` only if ticked → tags and owner → insert submission → Timeline entry → start the form's sequence. One transaction. Public lookups use the business and slug; the `tenant_id` query parameter is removed.

### 2.3 Audience

`audience.service.ts`: `resolveAudience(businessId, segmentId, channel, purpose)` = segment evaluation (46) → `contactability.filterAudience` (46) → daily-limit filter (count of `msg_messages` with purpose `marketing` for that Person and channel today, business time). Returns recipients and excluded-by-reason. Used by campaigns at send and by the sequence engine at each step. The summary endpoint from Phase 46 gains the `limit_reached` reason.

### 2.4 Sequence engine

Honours `stop_on_conversion` and `stop_on_reply`; uses `message.service` for sending; marks the first step after a form submission as `transactional` and later steps by the step's own purpose setting (default `marketing`).

---

## 3. API Endpoints

Under `/api/v1`, all requiring `business_id`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/customers?view=leads&lead_status=…&follow_up=due&…` | The Leads list. Same endpoint as People, with lead fields and filters added |
| GET | `/leads/counts` | New, contacted, follow-up due, mine |
| POST | `/leads` | Quick add (thin wrapper over person creation with lead fields and consent) |
| PUT | `/leads/:personId/status` | `contacted`, `lost`, `disqualified`, reopen |
| PUT | `/leads/:personId/follow-up` | Set, complete, clear |
| GET / PUT | `/leads/settings` | Owner rule, notified users, sequence per source |
| GET / POST / PUT | `/marketing/forms`, `/marketing/forms/:id` | Lead Forms (replaces `/marketing/funnels`; old paths kept as aliases for one release) |
| GET | `/marketing/forms/:id/analytics` | Views, submissions, converted |
| GET | `/marketing/forms/:id/submissions` | Submission list |
| GET | `/public/forms/:businessSlug/:formSlug` | Public form definition |
| POST | `/public/forms/:businessSlug/:formSlug/submit` | Public submission; rate-limited |
| GET | `/reports/leads` | Lead report (through the report framework) |

---

## 4. Lead Form Embed

Follows the booking widget pattern (Phase 38): a snippet generated in the admin UI, a script served by the DayStream server, and an iframe so the business's site styles cannot break the form.

```html
<div data-daystream-form="spring-offer"></div>
<script src="https://app.daystream…/widget/daystream-forms.js" data-business="transcend-mallorca" async></script>
```

- The iframe loads the hosted form page in "embedded" mode, with the business theme (Phase 37).
- `allowed_origins` is enforced the same way as `wgt_widget_configs.allowed_origins`; an empty list allows any origin.
- Anti-automation: a hidden field, a minimum time-to-submit, and the public rate limit. A captcha is added only if abuse is seen.
- The iframe posts `daystream:form:submitted` to the parent so the business can track conversions in its own analytics.

---

## 5. Frontend

- `Marketing.tsx`: tabs Leads · Campaigns · Sequences · Forms · Templates. Follow-up-due badge on the navigation entry.
- `pages/marketing/Leads.tsx`: quick-filter chips with counts, table (reuses the People table and its row components), row quick actions, "Add lead" drawer, close-lead dialog with reasons, follow-up popover. Mobile cards.
- `pages/marketing/LeadForms.tsx`, `LeadFormEdit.tsx`: form builder (field list, consent text, tags, owner, sequence), share link, "Copy embed snippet", analytics.
- `pages/marketing/Templates.tsx`: screen for the existing templates API.
- `pages/public/LeadFormPage.tsx`: hosted and embedded form.
- `CustomerDetail.tsx`: lead block in the header when `lead_status` is set (status, follow-up, sequence and next step, converted date and cause).
- `CampaignCreate.tsx`, `SequenceCreate.tsx`: Audience picker listing all Segments (starter ones first), "New segment" inline, and the audience summary.
- Settings → "Leads": owner rule, notifications, sequence per source.

---

## 6. Reporting

One report definition, `leads.report.ts`, in the existing report catalogue (`services/reports/definitions/`): parameters date range, Source, Lead Form. Figures are computed from `cus_customers` lead fields, cohorted by `created_at`. First-90-day revenue comes from completed orders and payments of converted People, in cents. Median time to convert uses `percentile_cont(0.5)` over `converted_at - created_at`.

---

## 7. Permissions

| Action | Permission |
|---|---|
| See the Leads tab, forms, report | `marketing:read` |
| Change a Lead (status, follow-up, owner) | `customers:update` |
| Create and edit Lead Forms, sequences per source | `marketing:*` |
| Lead settings | `settings:*` |

---

## 8. Testing Strategy

- Unit: status transitions, reopen rules, follow-up due logic across the business time zone, daily-limit filter.
- Integration: each entry point creates one Lead with the right Source; repeat submission does not duplicate; consent recorded only when ticked; first booking converts and stops the sequence; closed lead reopens on inbound; report figures against a fixed data set; public form isolation and rate limit.
- End-to-end: `docs/e2e/suites/13-marketing.md` scripts MKT-09 to MKT-20 and journey JNY-15.

---

## 9. Open Questions

Carried from requirements.md Notes. One design-level question:

| # | Question | Default taken |
|---|---|---|
| 1 | Keep the table name `mkt_lead_funnels` or rename to `mkt_lead_forms`? | Keep the table; rename only in the API and UI |
