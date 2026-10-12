# Phase 48: Marketing Module - Tasks

## Overview

These tasks cover the Leads section of the Marketing module. Tasks for later sections are added when those sections are specified.

Tasks are grouped so that the Leads view works first with manually added leads, then capture paths, automation and reporting are added. Requirement numbers refer to requirements.md, which is still a draft: section 0 comes first.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 0. Requirements Confirmation

### 0.1 Before any implementation
- [ ] Review the draft against the detailed requirements and update requirements.md and design.md
- [ ] Decide the open questions listed in requirements.md Notes
- [ ] Confirm Phase 46 is complete and Phase 47 delivery steps A and B are complete

## 1. Schema

### 1.1 Migration `139_leads.sql`
- [ ] Add the lead fields to `cus_customers` with indexes (R2, R3, R4)
- [ ] Backfill `lead_status` for existing People
- [ ] Extend `mkt_lead_funnels`; create `mkt_lead_form_submissions` and `mkt_lead_source_sequences` with RLS and grants (R6, R8)
- [ ] Add `stop_on_conversion` and `stop_on_reply` to `mkt_sequences` (R8)
- [ ] Add the Leads and marketing-limit configuration keys

## 2. Lead Service

### 2.1 Service and hooks
- [ ] Create `lead.service.ts` (R2, R3, R4)
- [ ] Hook `onPersonCreated` and reopen-on-match into the Identity Service (R2, R7)
- [ ] Hook `markContacted` into `message.service` (R2)
- [ ] Hook `onStageChanged` into `transitionLifecycle` and the manual stage override (R3)
- [ ] Reopen closed leads and stop sequences on inbound messages (R2, R8)
- [ ] Timeline entries for every status change (R2)
- [ ] Unit tests for all transitions

### 2.2 API
- [ ] Lead fields and filters on `GET /customers` (R1)
- [ ] `/leads/counts`, `/leads`, `/leads/:personId/status`, `/leads/:personId/follow-up`, `/leads/settings` (R1, R2, R4, R5, R7)

## 3. Leads View

### 3.1 Marketing navigation
- [ ] Marketing tabs: Leads, Campaigns, Sequences, Forms, Templates (R11)
- [ ] Follow-up-due badge on the Marketing navigation entry (R4)
- [ ] Templates screen for the existing API (R11)

### 3.2 Leads tab
- [ ] Leads table with quick-filter chips and counts (R1)
- [ ] Row quick actions: message, book, follow-up, assign, close (R4)
- [ ] "Add lead" drawer with consent capture (R5)
- [ ] Close-lead dialog with reasons; reopen (R2)
- [ ] Lead block in the profile header (R2, R3, R8)
- [ ] Import option "create as leads" with tag (R5)
- [ ] Mobile card layout

## 4. Lead Forms

### 4.1 Server
- [ ] Rework `marketing-funnels.service.submitForm` through the Identity Service, in one transaction (R6)
- [ ] Consent recorded only when ticked (R6)
- [ ] Tags, Owner and sequence from the form (R6)
- [ ] Public endpoints by business and form slug; rate limit; anti-automation checks (R6)
- [ ] `/marketing/forms` endpoints with analytics and submissions; aliases for the old funnel paths (R6)

### 4.2 Client
- [ ] Forms list and form editor (R6)
- [ ] Hosted form page with the business theme (R6)
- [ ] Embed script, snippet generation and allowed origins (R6)

## 5. Other Entry Points

### 5.1 Capture
- [ ] Registration without booking leaves a Lead (R7)
- [ ] Website (CMS) form submissions create or match a Lead (R7)
- [ ] Inbound message from an unknown sender shows as a new Lead (R7)

### 5.2 Assignment and notification
- [ ] Owner rule for new Leads (R7)
- [ ] New-lead notification to chosen users (R7)
- [ ] Settings → Leads screen (R7, R8)

## 6. Automatic Follow-Up

### 6.1 Sequences
- [ ] Sequence per Source and per form (R8)
- [ ] "New lead welcome" ready-made sequence (R8)
- [ ] Stop on conversion, close and reply (R3, R8)
- [ ] Purpose per step; first reply to an enquiry is transactional (R8)
- [ ] Sequence and next step shown on the Lead (R8)

## 7. Audiences

### 7.1 Server
- [ ] `audience.service.ts` with the daily per-Person limit (R10)
- [ ] Campaign send and sequence steps resolve the audience at send time (R10)

### 7.2 Client
- [ ] Audience picker over all Segments with inline segment creation (R10)
- [ ] Audience summary with exclusion reasons on campaign and sequence forms (R10)

## 8. Reporting

### 8.1 Lead report
- [ ] `leads.report.ts` in the report catalogue (R9)
- [ ] Funnel, by Source, by form, lost reasons, 90-day revenue (R9)
- [ ] Export of the report and of the Lead list (R9)

## 9. Verification

### 9.1 Tests and documentation
- [ ] Server, client and shared unit tests pass
- [ ] Run `docs/e2e` suite 13 (MKT-09 to MKT-20), suites 08 and 17, JNY-15 and the smoke suite; set script statuses from the run
- [ ] Update Phase 16 and Phase 43 cross-references and `docs/e2e/README.md`
