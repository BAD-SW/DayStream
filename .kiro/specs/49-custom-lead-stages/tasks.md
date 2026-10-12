# Phase 49: Custom Lead Stages - Tasks

## Overview

This phase is specified but not scheduled. The breakdown below is at section level; it is detailed when the phase is picked up, after its design.md is written. Requirement numbers refer to requirements.md.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 0. Before Starting

### 0.1 Readiness
- [ ] Confirm Phase 48 is complete and in use
- [ ] Confirm the requirements with the product owner
- [ ] Write design.md: schema, drag-and-drop behaviour, live board updates, migration
- [ ] Add end-to-end scripts to `docs/e2e/suites/13-marketing.md`

## 1. Stages

### 1.1 Schema and migration
- [ ] Create the per-Business stage table with RLS and grants (R1)
- [ ] Add the stage reference and "entered stage" time to the Person record (R3)
- [ ] Create default stages for every Business and place existing Open_Leads (R7)

### 1.2 Server
- [ ] Stage configuration service and endpoints: create, rename, reorder, archive with reassignment (R1, R2)
- [ ] Stage on a Lead: move, bulk move, automatic move on first contact, reopen (R3)
- [ ] Timeline and audit entries (R1, R3)

## 2. Screens

### 2.1 Settings
- [ ] Stage configuration in Settings → Leads (R1, R2)

### 2.2 Leads tab
- [ ] Stage column, filter and "Move to" action in the list (R3, R5)
- [ ] Stage board with drag and drop, keyboard and touch alternative (R4)
- [ ] Live updates on the board (R4)
- [ ] Mobile layout (R4)

## 3. Automation and Reporting

### 3.1 Automation
- [ ] Stage as a Segment rule (R5)
- [ ] Sequence trigger "Lead moved to stage" and step "Move to stage", with loop protection (R5)
- [ ] Target stage on Lead_Forms (R5)

### 3.2 Reporting
- [ ] Stage figures in the lead report (R6)

## 4. Verification

### 4.1 Tests
- [ ] Unit and integration tests, including "nothing changes for a Business that changes nothing" (R7)
- [ ] Run the end-to-end scripts and the smoke suite
