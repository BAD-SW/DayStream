# Phase 46: People Foundation - Requirements

## Overview

A business knows people at very different stages: someone who sent one WhatsApp message, someone on a free trial, a long-standing member, someone who left a year ago. Today DayStream stores all of them in the Customers module (Phase 05) with a lifecycle stage, but the module was built around paying customers: an email and a full name are mandatory, there is no record of where a person came from, consent is stored in two places, and each entry point (booking widget, lead funnel, import, manual entry) matches people in its own way.

This phase makes the person record the single source of truth that the Inbox (Phase 47) and Leads (Phase 48) build on. It extends Phase 05; it does not replace it. Where a requirement here differs from Phase 05, this document takes precedence and says so.

## Goals

- One record per person per business, from first contact to former customer
- "Lead" and "customer" are stages of that record, shown as views of one list
- A person can exist with only an email or only a phone number
- Every entry point finds or creates people through the same matching rule
- Staff can see at a glance where a person came from, who looks after them and when they were last active
- One consent record per channel, checked the same way by every module that sends messages
- Merging two records loses nothing

## Glossary

- **Person**: One human known to a Business. Stored in `cus_customers`. The words "customer" and "lead" describe a Person's Lifecycle_Stage, not a different kind of record
- **People**: The navigation label and list that replaces "Customers"
- **Lifecycle_Stage**: The existing Phase 05 stages: `lead`, `trial`, `active`, `at_risk`, `churned`, `winback`. Exactly one per Person. `trial` is not a free trial: it is a Person from their first booking until they buy a membership or make a third visit, and is shown as "New customer"
- **View**: A named filter over the People list. System Views are fixed; custom Views are Segments
- **Contact_Point**: An email address or phone number through which a Person can be reached
- **Source**: How the Person first became known to the Business (for example `lead_form`, `booking_widget`, `inbound_message`)
- **Owner**: The staff member responsible for a Person
- **Linked_Account**: The DayStream login (`usr_users`) belonging to a Person, if they have one
- **Identity_Service**: The single server component that finds an existing Person or creates a new one
- **Channel**: A way of sending a message: `email`, `sms`, `whatsapp`, `in_app`, `push`
- **Purpose**: Why a message is sent: `marketing` (promotional) or `transactional` (about a booking, purchase or account)
- **Contactability_Check**: The single server component that answers "may we send this Person a message on this Channel for this Purpose?"
- **Segment**: A saved audience (Phase 05). Dynamic Segments follow rules; Static_Lists hold hand-picked People

## Requirements

### Requirement 1: People Navigation and Views

**User Story:** As a business owner, I want one list where everyone my business knows can be found, so that I never wonder whether someone is "in leads" or "in customers".

#### Acceptance Criteria

1. THE system SHALL label the business navigation entry and its pages "People" in place of "Customers"
2. THE system SHALL provide these system Views on the People list: All, Leads (`lead`), Customers (`trial`, `active`, `at_risk`, `winback`), At risk (`at_risk`), Former (`churned`)
9. THE system SHALL show the Lifecycle_Stages under these names everywhere in the UI, in exports and in reports: Lead, New customer (`trial`), Active, At risk, Former (`churned`), Won back (`winback`)
3. THE system SHALL show the number of People in each system View
4. THE system SHALL open the People list on the All View by default and remember the last View used per user
5. THE system SHALL allow any saved Segment to be applied to the People list as a custom View
6. THE system SHALL keep search, column filters, sorting and paging working within any View
7. THE system SHALL exclude archived, merged and anonymised People from every View unless the user explicitly asks to see archived People
8. THE system SHALL keep existing links to `/customers` pages working

### Requirement 2: People with Partial Details

**User Story:** As a front-desk user, I want to save someone who only gave me a phone number, so that I can follow up before I have their full details.

#### Acceptance Criteria

1. THE system SHALL allow a Person to be created with at least one Contact_Point (email or phone); email is no longer mandatory
2. THE system SHALL allow first name and last name to be empty when the Person is created by an automatic entry point (inbound message, lead form)
3. THE system SHALL require a first name when a Person is created by hand
4. WHERE a Person has no name, THE system SHALL display their email or phone number in place of the name everywhere a name is shown
5. THE system SHALL store phone numbers in international format in addition to the text as entered
6. THE system SHALL keep email unique per Business, ignoring letter case
7. THE system SHALL prompt for the missing details the first time such a Person books or buys, since bookings and invoices need a name and an email
8. THE system SHALL mark profiles with missing details as "Incomplete" on the list and the profile

### Requirement 3: Identity Matching

**User Story:** As a business owner, I want the same person to end up on the same record however they reach us, so that their history is not split across duplicates.

#### Acceptance Criteria

1. THE system SHALL route every creation of a Person (manual entry, import, booking widget, online registration, lead form, inbound message, API) through the Identity_Service
2. WHEN an incoming email matches an existing Person's email in the same Business, ignoring case, THE Identity_Service SHALL return that Person
3. WHEN no email matches and the incoming phone number matches exactly one existing Person in the same Business, THE Identity_Service SHALL return that Person
4. WHEN the phone number matches more than one Person, THE Identity_Service SHALL create a new Person and flag the set as possible duplicates
5. THE Identity_Service SHALL NOT match People on name alone
6. WHEN an existing Person is matched, THE Identity_Service SHALL fill in details that were empty and SHALL NOT overwrite details that were already present
7. THE Identity_Service SHALL NOT match People across Businesses
8. THE system SHALL show possible duplicates on the profile with an action to review and merge

### Requirement 4: Source Tracking

**User Story:** As a business owner, I want to know where each person came from, so that I can see which channels bring people in.

#### Acceptance Criteria

1. THE system SHALL record a Source for every Person at creation: `manual`, `import`, `booking_widget`, `online_registration`, `lead_form`, `inbound_message`, `referral`, `walk_in`, `api`, `unknown`
2. THE system SHALL record an optional source detail (for example the form name, the channel of the first message, or the import file name)
3. THE system SHALL set the Source automatically for every automatic entry point
4. THE system SHALL let staff choose the Source when creating a Person by hand (default `manual`; `walk_in` and `referral` offered)
5. THE system SHALL NOT change the Source when a Person is later matched through another entry point
6. THE system SHALL set the Source of People that existed before this phase to `unknown`
7. THE system SHALL show Source on the profile and make it available as a list column, a filter and a Segment rule

### Requirement 5: Owner Assignment

**User Story:** As a manager, I want to assign a person to a staff member, so that someone is clearly responsible for following up.

#### Acceptance Criteria

1. THE system SHALL allow one staff member of the same Business to be set as Owner of a Person, or none
2. THE system SHALL allow the Owner to be set from the profile and in bulk from the list
3. THE system SHALL record Owner changes on the Timeline
4. THE system SHALL make Owner available as a list column, a filter ("Mine", "Unassigned", a named staff member) and a Segment rule
5. WHEN a staff member is deactivated, THE system SHALL keep their People and show them under "Unassigned"

### Requirement 6: Activity and Login Signals

**User Story:** As a staff member, I want to see when a person was last active, so that I know who is engaged and who is going quiet.

#### Acceptance Criteria

1. THE system SHALL record for each Person the date and time of their last activity (booking made, visit, purchase, message received from them, login)
2. THE system SHALL record for each Person the date and time of their last visit (attended booking or check-in)
3. THE system SHALL record the last login date and time of each login account
4. THE system SHALL link a Person to their Linked_Account where one exists, and SHALL show "No account" where none exists
5. THE system SHALL record the date and time the Person entered their current Lifecycle_Stage
6. THE system SHALL show created date, Source, Owner, last activity, last visit, last login and time in current stage in the profile header
7. THE system SHALL make last activity, last visit and last login available as list columns, sort keys, filters and Segment rules
8. THE system SHALL show all dates and times in the Business's time zone

### Requirement 7: Lifecycle Stage Rules

**User Story:** As a business owner, I want a person's stage to follow what they actually do, so that I never have to "convert" a lead by hand.

#### Acceptance Criteria

1. THE system SHALL keep the six Phase 05 Lifecycle_Stages and their automatic transition rules
2. THE system SHALL create a Person at stage `lead` when they are created without a booking or purchase
3. WHEN a Person is created as part of making a booking or purchase, THE system SHALL place them at the stage the transition rules give for that event, not at `lead`
4. THE system SHALL NOT provide or require a manual "convert to customer" step
5. THE system SHALL keep the manual stage override of Phase 05 and record the reason when one is given
6. THE system SHALL keep a Person's full history (Source, messages, notes, tags) unchanged when their stage changes

### Requirement 8: People List Columns and Bulk Actions

**User Story:** As a staff member, I want to choose what I see in the list and act on several people at once, so that routine work is quick.

#### Acceptance Criteria

1. THE system SHALL offer these list columns: reference, name, email, phone, stage, tags, Source, Owner, created, last activity, last visit, last login, next booking, marketing consent
2. THE system SHALL let each user choose which columns are shown and SHALL remember the choice
3. THE system SHALL allow selecting several People, or everyone matching the current View and filters
4. THE system SHALL support these bulk actions on a selection: add tag, remove tag, assign Owner, change stage, add to Static_List, export, archive
5. THE system SHALL show how many People a bulk action will affect and ask for confirmation before applying it
6. THE system SHALL record each bulk change on every affected Person's Timeline
7. THE system SHALL collapse the list into cards on mobile widths, showing name, stage and last activity

### Requirement 9: Unified Consent

**User Story:** As a business owner, I want one clear record of what each person agreed to receive, so that every part of the system respects it in the same way.

#### Acceptance Criteria

1. THE system SHALL store one consent state per Person, per Channel, per Purpose, and SHALL use it as the only source of truth for all modules
2. THE system SHALL bring the existing preference values from both current stores into the single record without loss; where the two stores disagree, the more restrictive value SHALL win
3. THE system SHALL default marketing consent to "not given" on every Channel
4. THE system SHALL record every consent change with date, time, who made it (the Person or a staff member), the method (form, portal, unsubscribe link, staff entry, import, keyword reply) and the previous and new value
5. THE system SHALL show the consent history on the profile
6. THE system SHALL treat a withdrawal on any Channel as immediate
7. THE system SHALL NOT infer marketing consent from a booking, a purchase or an inbound message
8. THE system SHALL keep consent records when a Person is archived, and SHALL keep the minimum needed to prove a withdrawal after anonymisation
9. THE system SHALL require staff who record consent by hand to state how it was obtained

### Requirement 10: Contactability Check

**User Story:** As a business owner, I want the system to stop a message that should not be sent, so that I stay within the law without checking every list myself.

#### Acceptance Criteria

1. THE system SHALL provide one Contactability_Check that every sending module (Inbox, campaigns, sequences, notifications) uses before sending
2. THE Contactability_Check SHALL refuse a `marketing` message when the Person has not given marketing consent on that Channel
3. THE Contactability_Check SHALL refuse any message when the Person has no usable Contact_Point for that Channel
4. THE Contactability_Check SHALL refuse any message to an archived, merged or anonymised Person
5. THE Contactability_Check SHALL refuse a message on a Channel whose address is marked undeliverable (hard bounce, invalid number, complaint)
6. THE Contactability_Check SHALL allow `transactional` messages regardless of marketing consent, subject to the Person's reminder setting
7. THE Contactability_Check SHALL return the reason for every refusal in words a staff member can read
8. THE system SHALL run the Contactability_Check at the moment of sending, not only when an audience is built
9. THE system SHALL show, wherever an audience is chosen, how many People are in it, how many will be excluded and why

### Requirement 11: Segments as Shared Audiences

**User Story:** As a business owner, I want to define a group of people once and use it everywhere, so that my list views and my campaigns always agree.

#### Acceptance Criteria

1. THE system SHALL support editing an existing Segment's name and rules
2. THE system SHALL support two kinds of Segment: dynamic (membership follows the rules at the time of use) and Static_List (membership is exactly the People added by hand)
3. THE system SHALL label each Segment clearly as dynamic or Static_List
4. THE system SHALL support these additional rule fields: Source, Owner, last activity, last visit, last login, marketing consent per Channel, has Linked_Account, profile incomplete
5. THE system SHALL provide these starter Segments for every Business: Leads, New customers, Active, At risk, Former, New this month, No visit in 30 days, Birthday this month
6. THE system SHALL show a live member count while a Segment is being built
7. THE system SHALL make every Segment available as a People View and as an audience in Marketing
8. THE system SHALL prevent deleting a Segment that a scheduled campaign or an active sequence uses

### Requirement 12: Complete Merge

**User Story:** As a staff member, I want to merge two records for the same person without losing anything, so that I can fix duplicates safely.

#### Acceptance Criteria

1. WHEN two People are merged, THE system SHALL move every record linked to the secondary Person to the primary Person: bookings, check-ins, waitlist entries, memberships, packages, orders, invoices, payments, stored payment methods, credits, gift cards, event registrations, community records, campaign and sequence history, form submissions, messages, notes, tags, custom fields and Timeline entries
2. THE system SHALL carry out a merge completely or not at all
3. THE system SHALL keep the secondary record, marked as merged into the primary, and SHALL NOT delete it
4. THE system SHALL redirect any link to a merged record to the primary Person
5. THE system SHALL combine consent by keeping the more restrictive state per Channel and Purpose, and SHALL keep both consent histories
6. THE system SHALL keep the earlier creation date and the earlier Source on the primary Person
7. THE system SHALL show a summary of what will move before the merge is confirmed
8. THE system SHALL record the merge on the Timeline and in the audit log with both record identifiers and the acting user
9. THE system SHALL restrict merging to users with full customer permissions

### Requirement 13: Profile Updates

**User Story:** As a staff member, I want the profile to tell me who this person is at a glance, so that I do not need to open several screens.

#### Acceptance Criteria

1. THE system SHALL show in the profile header: name (or Contact_Point), stage, tags, Source, Owner, created date, last activity, last login, and an "Incomplete" marker where it applies
2. THE system SHALL show marketing consent per Channel on the profile overview
3. THE system SHALL let the Timeline be filtered by kind of entry: bookings, payments, messages, marketing, notes, profile changes
4. THE system SHALL show stage changes, Owner changes, consent changes, Source and merges on the Timeline
5. THE system SHALL keep the existing profile tabs and quick actions of Phase 05

### Requirement 14: Business Scoping of Marketing Data

**User Story:** As a tenant with several businesses, I want each business to see only its own campaigns, sequences, forms and templates, so that one business never messages another's people.

#### Acceptance Criteria

1. THE system SHALL attach every campaign, sequence, lead form, message template and consent record to one Business
2. THE system SHALL assign existing marketing records to a Business: the tenant's only Business where there is one, otherwise the Business of the People the record refers to
3. THE system SHALL list any existing marketing record that cannot be assigned, for a manual decision, and SHALL NOT guess
4. THE system SHALL require an active Business for every marketing screen and marketing API call
5. THE system SHALL refuse a marketing record that refers to a Segment or a Person of another Business

---

## Dependencies

- Phase 02: Security & Compliance - Audit log, consent records, anonymisation
- Phase 05: Customer Management - Person record, segments, tags, Timeline, lifecycle, merge, import
- Phase 12: Staff Management - Staff members as Owners
- Phase 16: Marketing Automation - Campaigns, sequences, lead forms, consent store
- Phase 38: Embeddable Booking Widget - An entry point that creates People

## Success Criteria

- A person who messages first and books later is one record with one history
- A Person can be saved with only a phone number, and is asked for the rest when they first book
- The same person entering through the widget, a lead form and an import ends up as one record
- Every Person shows a Source, and no automatic entry point leaves it empty
- A marketing message to a Person without consent is refused by every sending path, with a readable reason
- Merging two People with bookings and payments keeps every booking and payment
- A business of a multi-business tenant cannot see or use another business's marketing records
- No existing Phase 05 behaviour regresses

## Out of Scope

- A separate Leads or Customers navigation entry - They are Views of People
- More than one stage per Person, or several sales opportunities per Person - Use tags and Segments
- Tracking anonymous website visitors - A Person exists once there is a Contact_Point
- Several emails or phone numbers per Person - One of each for now
- A duplicate review queue - Flagging on the profile plus manual merge for now
- Conversations and message sending - Phase 47
- Lead status, follow-up and conversion reporting - Phase 48
- Renaming database tables or the `/customers` routes - Label change only

## Notes

- Findings from the current code that this phase corrects:
  - `cus_customers.email`, `first_name` and `last_name` are mandatory, so a phone-only lead cannot be stored
  - Consent is stored twice: `cus_preferences` (four switches, used by the profile) and `mkt_communication_preferences` (per channel, used by Marketing). They can disagree
  - Marketing tables hold a tenant but no business, against the platform rule that business data always carries `business_id`
  - Merge moves notes, tags, custom fields and Timeline entries only, then deletes the secondary record; bookings, payments and memberships are not moved (Phase 05 Requirement 9.4 is not met)
  - The lead form submission writes a `source` column that does not exist and omits the business and reference number
  - Segments can be created and deleted but not edited
  - No login date is stored anywhere
- Competitor practice checked for this phase: Momence keeps leads in a separate area of Marketing with their own stages and sources; Mindbody and HubSpot-style CRMs use one contact record with a lifecycle field. DayStream follows the single-record model
- Under GDPR and Spain's LSSI-CE, marketing by email, SMS or WhatsApp needs prior opt-in; replying to a person who wrote first is not marketing

---

**Status**: 📋 Planned
**Dependencies**: Phase 02, Phase 05, Phase 12, Phase 16, Phase 38
**Next Phase**: Phase 47 (Inbox)
