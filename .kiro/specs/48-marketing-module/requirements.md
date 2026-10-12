# Phase 48: Marketing Module - Requirements

## Overview

This phase specifies the Marketing module of the business application. The module is made of sections; this document currently specifies the first one, **Leads**, together with the two rules every later section depends on: how Marketing is organised (Requirement 11) and how audiences are chosen (Requirement 10). Other sections (campaigns, marketing reports and more) will be added here as numbered sections when their requirements are defined; Phase 43 (Campaign Capabilities) is the existing placeholder for campaigns.

### Section A: Leads

A lead is someone who has shown interest but has not yet booked or bought. In DayStream a lead is a Person at Lifecycle_Stage `lead` (Phase 46): the same record that later becomes a customer. This phase gives businesses a place in Marketing to work their leads, and makes sure every way a lead can arrive actually creates one.

It builds on Phase 16, which delivered lead funnels (landing pages) and sequences, and corrects the parts of it that do not work with the current data model.

> 📋 **Draft.** These requirements are a best-practice baseline drawn from the current product, from Phases 46 and 47, and from how Momence and comparable products handle leads. They are to be revised against the detailed requirements before implementation starts. Items needing a decision are listed under Notes.

## Goals

- Every enquiry becomes a lead with a known source
- Staff can see which leads need attention today
- A lead becomes a customer automatically when they book or buy
- Leads that go nowhere leave the working list without being deleted
- The business can see which sources produce customers
- Marketing can reach any group of People, not only leads

## Glossary

- **Person**, **Lifecycle_Stage**, **Source**, **Owner**, **Segment**, **Contactability_Check**: As defined in Phase 46
- **Lead**: A Person at Lifecycle_Stage `lead`
- **Lead_Status**: Where a Lead is in follow-up: `new`, `contacted`, `converted`, `lost`, `disqualified`
- **Open_Lead**: A Lead with Lead_Status `new` or `contacted`
- **Lost_Reason**: Why a Lead was closed without converting, chosen from a short list
- **Follow_Up**: A date on which a staff member intends to contact a Lead again, with an optional note
- **Lead_Form**: A form that creates a Lead when submitted: a hosted landing page (the Phase 16 lead funnel) or a form embedded in the business's own website
- **Conversion**: The moment a Lead leaves stage `lead` because of a booking or purchase
- **Audience**: The set of People a campaign or sequence will be sent to; always a Segment

## Requirements

### Requirement 1: Leads View

**User Story:** As a business owner, I want to see my leads in Marketing, so that I can work on turning them into customers.

#### Acceptance Criteria

1. THE system SHALL provide a Leads tab as the first tab of the Marketing module
2. THE system SHALL list Open_Leads by default, with: name (or Contact_Point), Lead_Status, Source and source detail, Owner, created date, last contacted, next Follow_Up, last Message preview
3. THE system SHALL provide these quick filters: New, Contacted, Follow-up due, Mine, Unassigned, Lost, Disqualified, Converted
4. THE system SHALL support filtering by Source and by created date range, and searching by name, email and phone
5. THE system SHALL show counts for New, Contacted and Follow-up due
6. THE system SHALL open the same Person profile as the People list when a Lead is opened
7. THE system SHALL show exactly the same Leads as the People list's Leads View for the same filters

### Requirement 2: Lead Status

**User Story:** As a staff member, I want each lead to show how far the follow-up has got, so that I know what to do next.

#### Acceptance Criteria

1. THE system SHALL give every new Lead the Lead_Status `new`
2. WHEN the first outbound Message (manual, campaign or sequence) is sent to a Lead, THE system SHALL set the Lead_Status to `contacted` and record the date
3. THE system SHALL let staff set the Lead_Status to `contacted` by hand, for contact made outside the system
4. THE system SHALL let staff close a Lead as `lost` or `disqualified`, requiring a Lost_Reason
5. THE system SHALL provide these Lost_Reasons: No response, Not interested, Price, Location, Schedule does not fit, Chose a competitor, Duplicate or spam, Other (with text)
6. THE system SHALL let staff reopen a closed Lead, returning it to `contacted`
7. WHEN a closed Lead sends an inbound Message or submits a Lead_Form again, THE system SHALL reopen it automatically
8. THE system SHALL record every Lead_Status change on the Timeline
9. THE system SHALL keep the set of Lead_Statuses fixed; businesses cannot add their own

### Requirement 3: Conversion

**User Story:** As a business owner, I want a lead to become a customer the moment they book or buy, so that nobody has to move them by hand.

#### Acceptance Criteria

1. WHEN a Lead's Lifecycle_Stage changes from `lead` because of a booking or purchase, THE system SHALL set the Lead_Status to `converted` and record the date and the booking or order that caused it
2. THE system SHALL NOT require any staff action for Conversion
3. THE system SHALL keep Source, Owner, Messages, notes and tags unchanged at Conversion
4. THE system SHALL remove a converted Lead from the Open_Leads list and keep it findable under the Converted filter
5. WHEN staff move a Person from `lead` to another stage by hand, THE system SHALL also treat it as a Conversion, marked as manual
6. THE system SHALL stop any sequence that is marked "stop on conversion" for that Person

### Requirement 4: Follow-Up

**User Story:** As a front-desk user, I want to set a reminder to get back to a lead, so that I follow up at the right time.

#### Acceptance Criteria

1. THE system SHALL let staff set one next Follow_Up date and an optional note on a Lead
2. THE system SHALL list Leads whose Follow_Up is today or overdue under "Follow-up due", oldest first
3. THE system SHALL show the number of Follow_Ups due to the signed-in user on the Marketing navigation entry
4. THE system SHALL let staff mark a Follow_Up as done, with a choice to set the next one
5. THE system SHALL clear the Follow_Up when the Lead converts or is closed
6. THE system SHALL provide quick actions on every Lead row: message, book, set Follow_Up, assign Owner, close

### Requirement 5: Adding Leads by Hand and by Import

**User Story:** As a front-desk user, I want to add a lead in a few seconds while I am on the phone, so that I do not lose the enquiry.

#### Acceptance Criteria

1. THE system SHALL provide an "Add lead" form asking only for: first name, email or phone, Source, what they are interested in (optional), note (optional)
2. THE system SHALL create the Lead through the Phase 46 Identity_Service, and SHALL open the existing Person when one matches
3. THE system SHALL let staff record marketing consent on the form, stating how it was obtained
4. THE system SHALL let a CSV import create People as Leads, with a Source of `import` and the option to tag them
5. THE system SHALL NOT assume marketing consent for imported Leads unless the file states it and the importing user confirms the lawful basis

### Requirement 6: Lead Forms

**User Story:** As a business owner, I want forms that turn website visitors into leads, so that enquiries arrive in DayStream without retyping.

#### Acceptance Criteria

1. THE system SHALL let a Business create Lead_Forms with: name, headline, description, fields (first name, last name, email, phone, free-text question, service of interest), button text
2. THE system SHALL require every Lead_Form to collect an email or a phone number
3. THE system SHALL provide each Lead_Form as a hosted page with a shareable link and as a snippet to embed in the business's own website
4. THE system SHALL create or match a Person for every valid submission, at stage `lead` when new, with Source `lead_form` and the form name as source detail
5. THE system SHALL NOT create a second Person when the same email or phone is submitted again, and SHALL record the repeat submission on the Timeline
6. THE system SHALL include an unticked marketing consent box on every Lead_Form, with wording the Business can edit, and SHALL record consent only when it is ticked
7. THE system SHALL let a Lead_Form assign tags, an Owner and a sequence to the Leads it creates
8. THE system SHALL protect Lead_Forms against automated submissions
9. THE system SHALL show per Lead_Form: views, submissions, conversion rate from view to submission, and Leads converted to customers
10. THE system SHALL let a Lead_Form be switched off without deleting it or its history
11. THE system SHALL attach every Lead_Form to one Business

### Requirement 7: Leads from Other Entry Points

**User Story:** As a business owner, I want leads captured wherever people first touch my business, so that my list is complete.

#### Acceptance Criteria

1. WHEN a visitor registers in the booking widget or online and does not complete a booking, THE system SHALL keep them as a Lead with Source `booking_widget` or `online_registration`
2. WHEN an inbound Message arrives from an unknown sender (Phase 47), THE system SHALL create a Lead with Source `inbound_message`
3. WHEN a form on the business's DayStream website (Phase 18) is submitted with an email or phone, THE system SHALL create or match a Lead with Source `lead_form`
4. THE system SHALL notify the users chosen by the Business when a new Lead arrives
5. THE system SHALL assign new Leads to an Owner according to a per-Business setting: none, a named staff member, or the staff member named on the Lead_Form

### Requirement 8: Automatic Follow-Up

**User Story:** As a business owner, I want new leads to get a prompt first response automatically, so that they hear from us even when we are busy.

#### Acceptance Criteria

1. THE system SHALL let a Business choose a sequence that starts automatically for new Leads, per Source or per Lead_Form
2. THE system SHALL provide a ready-made "New lead welcome" sequence
3. THE system SHALL apply the Contactability_Check to every sequence Message; the first reply to a Lead_Form enquiry counts as `transactional`, later promotional steps as `marketing`
4. THE system SHALL stop a Lead's sequence when the Lead converts (where the sequence says so), is closed, or replies
5. THE system SHALL show on the Lead which sequence they are in and the next step due

### Requirement 9: Lead Reporting

**User Story:** As a business owner, I want to know which sources bring customers, so that I can put effort where it works.

#### Acceptance Criteria

1. THE system SHALL report, for a chosen date range: new Leads, Leads converted, conversion rate, median time to convert, Open_Leads, Leads lost by Lost_Reason
2. THE system SHALL break each figure down by Source and by Lead_Form
3. THE system SHALL show a simple funnel: created → contacted → converted
4. THE system SHALL report revenue from converted Leads in their first 90 days as customers, in the Business's currency
5. THE system SHALL base conversion rates on the date the Lead was created
6. THE system SHALL allow the Lead list and the report to be exported

### Requirement 10: Audiences over All People

**User Story:** As a business owner, I want to send a campaign to my existing customers as easily as to my leads, so that I can win back, upsell and keep people informed.

#### Acceptance Criteria

1. THE system SHALL let every campaign and sequence choose its Audience from all Segments of the Business, with no restriction to Leads
2. THE system SHALL offer the Phase 46 starter Segments first in the Audience picker
3. THE system SHALL let a new Segment be created from within the Audience picker
4. THE system SHALL show, before sending: People in the Audience, People excluded and the reason for each group, People who will receive it
5. THE system SHALL evaluate a dynamic Segment at the moment of sending, and at each step for a sequence
6. THE system SHALL apply a per-Person limit on marketing Messages, configurable per Business (default: one per Channel per day), and SHALL count Messages held back by it
7. THE system SHALL record each campaign and sequence Message on the Person's Timeline and Conversation

### Requirement 11: Marketing Navigation

**User Story:** As a business owner, I want Marketing organised around what I do, so that I can find things without learning the system.

#### Acceptance Criteria

1. THE system SHALL organise the Marketing module into sections shown as tabs, in this order: Leads, Campaigns, Sequences, Forms, Templates
5. THE system SHALL allow further sections to be added to the Marketing module without changing the existing ones
2. THE system SHALL make Segments reachable from both People and Marketing, as the same list
3. THE system SHALL require an active Business for every Marketing screen
4. THE system SHALL show the Leads tab to users with `marketing:read`, and SHALL require `customers:update` to change a Lead

---

## Dependencies

- Phase 46: People Foundation - Person record, Identity_Service, Source, Owner, consent, Segments, business-scoped marketing data
- Phase 47: Inbox - Messages to and from Leads, inbound lead creation, "contacted" detection
- Phase 16: Marketing Automation - Sequences, lead funnels, templates
- Phase 43: Campaign Capabilities - Campaign building and sending; this phase supplies its Audience rules
- Phase 38: Embeddable Booking Widget - Registration without booking; embed pattern
- Phase 18: Website & CMS - Website form submissions
- Phase 17 / 35: Reporting - Lead report in the report catalogue

## Success Criteria

- A form submission, an unknown inbound message and a manual entry each produce exactly one Lead with the right Source
- A Lead who books becomes a customer with no staff action and appears under Converted
- "Follow-up due" shows exactly the Leads that need contact today
- The Leads tab and the People Leads View always agree
- The Lead report's conversion rate matches a hand count on test data
- A campaign can be sent to a Segment of active members, and people without consent are excluded with the reason shown

## Out of Scope

- Business-defined lead stages and a drag-and-drop board - Specified separately in Phase 49 (Custom Lead Stages), not scheduled
- Several sales opportunities per Person - Use tags and Segments
- Lead scoring - Later, if needed
- Paid-ad integrations (Meta, Google lead ads) - Later channel; forms and links cover the first version
- Abandoned checkout recovery - Later; needs checkout tracking
- Staff tasks beyond one Follow_Up date - Needs a task module
- Campaign editor, scheduling, A/B testing and analytics - A later section of this module (Phase 43 is its placeholder)
- Marketing reports beyond the lead report - A later section of this module, to be defined

## Notes

- Decisions to confirm with the detailed requirements:
  1. Whether a Person at stage `trial` should still appear in Leads. In DayStream `trial` does not mean a free trial: it is the stage a Person enters at their first booking and leaves for `active` after a membership purchase or a third visit, in other words a new customer. Decided on 2026-10-12: not in Leads, and the stage is shown as "New customer" (Phase 46 Requirement 7)
  2. Who is notified of new Leads by default
  3. The default per-Person message limit
  4. Whether the hosted Lead_Form page should live under the business's DayStream website (Phase 18) when one exists
- Decided on 2026-10-12: this spec is the Marketing module, not only Leads; Leads is one section of it
- Decided on 2026-10-12: the fixed Lead_Status set is used for now; business-defined stages are specified in Phase 49 for later
- Findings from the current code that this phase corrects:
  - Lead funnels belong to a tenant, not a business, and their public address needs a `tenant_id` parameter
  - A funnel submission tries to write a `source` column that does not exist and supplies no business or reference number, so it cannot create a Lead today
  - The Marketing screen has two tabs (Campaigns, Sequences); funnels and templates have an API but no entry in the screen
- Competitor practice checked on 2026-10-12: Momence shows each lead's source, stage and the revenue they generate; default stages are "Cold" (not yet contacted) and "Contacted" (set when an automated sequence reaches them), with business-defined stages and a drag-and-drop board; sources include website lead forms, Facebook and Instagram ads, manual entry and abandoned checkout; sequences are attached per source
- A reply to an enquiry is not marketing under GDPR / LSSI-CE; a later promotional sequence is, and needs the consent box to have been ticked

---

**Status**: 📋 Planned
**Dependencies**: Phase 46, Phase 47, Phase 16, Phase 43, Phase 38, Phase 18
**Next Phase**: Phase 43 (Campaign Capabilities)
