# Phase 49: Custom Lead Stages - Requirements

## Overview

Phase 48 tracks follow-up with a fixed Lead_Status: `new`, `contacted`, and the outcomes `converted`, `lost`, `disqualified`. That suits a business that simply answers enquiries. A business with a longer path to a sale (a studio that offers a tour, then a trial class, then a membership offer) wants to name its own steps and see how many leads sit at each.

This phase lets each Business define its own open stages and adds a board to work them. It is specified now and not scheduled; it will be picked up after Phase 48 if businesses ask for it.

## Goals

- A Business names and orders its own lead stages without help from DayStream
- Businesses that change nothing keep exactly the Phase 48 behaviour
- Leads can be moved between stages quickly, one at a time or several at once
- A stage change can start automatic follow-up
- The business can see where leads get stuck

## Glossary

- **Person**, **Lead**, **Open_Lead**, **Lost_Reason**, **Conversion**: As defined in Phases 46 and 48
- **Lead_Stage**: A named step in a Business's lead follow-up, defined by the Business
- **Open_Stage**: A Lead_Stage for Leads still being worked. A Business has between one and ten
- **Outcome**: One of the three system-owned end states: Converted, Lost, Disqualified. Outcomes cannot be renamed, removed or added to
- **Entry_Stage**: The Open_Stage a new Lead is placed in
- **Contacted_Stage**: The Open_Stage a Lead moves to automatically when first contacted, if the Business chooses one
- **Stage_Board**: A view showing Open_Stages as columns and Leads as cards

## Requirements

### Requirement 1: Defining Stages

**User Story:** As a business owner, I want to name the steps my leads go through, so that the system matches how my business actually sells.

#### Acceptance Criteria

1. THE system SHALL let a Business create, rename, reorder and archive Open_Stages in Settings → Leads
2. THE system SHALL give every Business the default Open_Stages "New" and "Contacted", so that a Business that changes nothing behaves exactly as in Phase 48
3. THE system SHALL require at least one and allow at most ten Open_Stages per Business
4. THE system SHALL require stage names to be unique within the Business and at most 30 characters
5. THE system SHALL let the Business choose a colour for each Open_Stage from the design system palette
6. THE system SHALL require exactly one Entry_Stage and SHALL let the Business choose which Open_Stage it is
7. THE system SHALL let the Business choose one Contacted_Stage, or none
8. THE system SHALL keep the three Outcomes fixed and SHALL show them after the Open_Stages wherever stages are listed
9. THE system SHALL restrict stage configuration to users with `settings:*`
10. THE system SHALL record every change to the stage configuration in the audit log

### Requirement 2: Archiving and Changing Stages Safely

**User Story:** As a business owner, I want to change my stages without losing track of leads, so that I can refine my process over time.

#### Acceptance Criteria

1. WHEN an Open_Stage that holds Leads is archived, THE system SHALL require the Business to choose the Open_Stage those Leads move to
2. THE system SHALL NOT allow the Entry_Stage to be archived until another Open_Stage is made the Entry_Stage
3. THE system SHALL keep archived stages in each Lead's history and in reports for past periods
4. THE system SHALL NOT delete a Lead_Stage that any Lead has ever been in
5. WHEN a stage is renamed, THE system SHALL show the new name everywhere, including in past history
6. THE system SHALL warn the Business when archiving a stage that a sequence or a Segment refers to, naming what will be affected

### Requirement 3: Stage on a Lead

**User Story:** As a staff member, I want to move a lead to the right stage, so that everyone can see how far the follow-up has got.

#### Acceptance Criteria

1. THE system SHALL place every new Lead in the Entry_Stage
2. THE system SHALL let staff move a Lead to any Open_Stage, forwards or backwards, from the list, the board and the profile
3. WHEN a Lead is first contacted and a Contacted_Stage is set, THE system SHALL move the Lead to it, unless the Lead is already in a later Open_Stage
4. THE system SHALL keep Conversion automatic, as in Phase 48, whatever Open_Stage the Lead is in
5. THE system SHALL keep closing a Lead as Lost or Disqualified with a Lost_Reason, as in Phase 48
6. WHEN a closed Lead is reopened, THE system SHALL return it to the Open_Stage it was in when it was closed, or to the Entry_Stage if that stage has been archived
7. THE system SHALL record every stage change on the Timeline with the previous stage, the new stage, the acting user (or "automatic") and the time
8. THE system SHALL record when a Lead entered its current stage and SHALL show the time spent in it
9. THE system SHALL let staff move several selected Leads to a stage in one action, with a confirmation stating how many

### Requirement 4: Stage Board

**User Story:** As a business owner, I want to see my leads as cards in columns, so that I can see the whole pipeline at a glance and move leads by dragging.

#### Acceptance Criteria

1. THE system SHALL provide a Stage_Board on the Marketing Leads tab, with a switch between List and Board that is remembered per user
2. THE system SHALL show one column per Open_Stage, in the Business's order, each with its name, colour and number of Leads
3. THE system SHALL show on each card: name (or Contact_Point), Source, Owner, time in stage, next Follow_Up, and a marker when the Follow_Up is due
4. THE system SHALL let staff move a Lead to another stage by dragging its card
5. THE system SHALL provide a non-drag way to move a card (a "Move to" menu) usable by keyboard and on touch screens
6. THE system SHALL show drop areas for Lost and Disqualified while a card is being dragged, and SHALL ask for the Lost_Reason on drop
7. THE system SHALL apply the same filters and search as the list (Owner, Source, date, Follow-up due)
8. THE system SHALL load cards in pages within each column so that a column with many Leads stays responsive
9. THE system SHALL order cards within a column by Follow_Up due first, then by longest time in stage
10. THE system SHALL show a stage change made by another user without a page reload
11. THE system SHALL show Open_Stages as a single scrollable list of collapsible groups on mobile widths, with "Move to" in place of dragging

### Requirement 5: Stages in Filters, Segments and Automation

**User Story:** As a business owner, I want stages to drive my follow-up, so that the right message goes out when a lead reaches a step.

#### Acceptance Criteria

1. THE system SHALL make Lead_Stage available as a filter and a column in the Leads list and the People list
2. THE system SHALL make Lead_Stage and time in stage available as Segment rules
3. THE system SHALL provide a sequence trigger "Lead moved to stage", with the stage chosen by the Business
4. THE system SHALL let a sequence step move a Lead to a chosen Open_Stage
5. THE system SHALL prevent a sequence from moving a Lead more than once per step, so that stage triggers cannot loop
6. THE system SHALL let a Lead_Form (Phase 48) place its Leads in a chosen Open_Stage instead of the Entry_Stage

### Requirement 6: Reporting by Stage

**User Story:** As a business owner, I want to see where leads get stuck, so that I can improve the step that loses them.

#### Acceptance Criteria

1. THE system SHALL extend the Phase 48 lead report with, per Lead_Stage: Leads currently in it, Leads that entered it in the period, median time spent in it
2. THE system SHALL show the proportion of Leads that moved from each Open_Stage to the next, to Converted, and to Lost or Disqualified
3. THE system SHALL show Lost_Reasons broken down by the stage the Lead was in when it was closed
4. THE system SHALL include archived stages in reports for periods in which they were used, marked as archived
5. THE system SHALL keep the Phase 48 figures (new, converted, conversion rate, time to convert) unchanged by this phase

### Requirement 7: Moving from Fixed Statuses

**User Story:** As a business already using Leads, I want my existing leads to keep their place when custom stages arrive, so that nothing changes until I decide to change it.

#### Acceptance Criteria

1. WHEN this phase is installed, THE system SHALL create the default Open_Stages "New" and "Contacted" for every Business
2. THE system SHALL place every existing Open_Lead in the stage matching its Phase 48 Lead_Status
3. THE system SHALL leave every existing converted, lost and disqualified Lead with its Outcome, dates and Lost_Reason unchanged
4. THE system SHALL keep every Phase 48 screen, filter, report and sequence working without any action by the Business

---

## Dependencies

- Phase 48: Marketing Module - Lead_Status, Leads tab, lost reasons, lead report, Lead_Forms
- Phase 46: People Foundation - Person record, Segments, Timeline
- Phase 16: Marketing Automation - Sequence triggers and steps
- Phase 04: Design System - Board, cards and drag-and-drop components

## Success Criteria

- A Business that changes nothing sees no difference from Phase 48
- A Business can add a stage "Tour booked", drag a Lead into it, and see it on the Lead's Timeline
- Archiving a stage with Leads in it moves them to the chosen stage and loses none
- A Lead who books converts automatically from any stage
- The board is usable with a keyboard and on a phone
- Report totals per stage add up to the number of Open_Leads

## Out of Scope

- Business-defined Outcomes - The three Outcomes stay fixed so that reporting stays comparable
- Several pipelines per Business - One set of stages per Business
- Several opportunities per Person - One stage per Lead, as agreed for Phase 46
- Deal values and forecasts - Not relevant to this market
- Rules that make a stage mandatory or restrict the order of stages - Staff may move a Lead to any stage
- Per-stage permissions - Stage changes need the same permission as any change to a Lead

## Notes

- Requested on 2026-10-12 as a separate set of requirements to be picked up later; Phase 48 ships with fixed statuses
- Competitor practice checked on 2026-10-12: Momence lets a business create and edit lead stages in settings, shows them as columns with drag and drop, and offers a "lead assigned new stage" trigger for sequences
- Design direction, to be detailed in a design.md when the phase is scheduled: a `mkt_lead_stages` table per Business and a `lead_stage_id` on the Person; Phase 48's `lead_status` keeps the Outcomes and is derived for open Leads, so Phase 48 code keeps working
- A design.md is required before implementation (drag-and-drop behaviour, live board updates, data migration)

---

**Status**: 📋 Planned
**Dependencies**: Phase 48, Phase 46, Phase 16, Phase 04
**Next Phase**: TBD
