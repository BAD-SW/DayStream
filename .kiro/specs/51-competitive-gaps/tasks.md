# Phase 51: Competitive Gaps - Tasks

## Overview

One section per gap, in the order of requirements.md. Each gap follows the same steps: confirm its current state in the code, agree its requirements with the owner and write its design, build it, then verify it live and have the owner close it. Gaps finished in another spec (11 and 12) are tracked here only.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 0. Phase setup

### 0.1 Gap register
- [x] ✅ Gaps collected from the competitive comparison and checked against the current code (state recorded per requirement)
- [x] ✅ Order of work: top to bottom through this document, one gap at a time
- [x] ✅ Inventory confirmed as planned long term (Phase 28 left it out short term only)

## 1. Forms, waivers and e-signature (Requirement 1)
- [x] ✅ Confirm current state (no forms; S3 backend unimplemented; anonymisation incomplete)
- [x] ✅ Agree requirements (criteria 1-11, from the owner's answers)
- [x] ✅ Design (design.md §1, agreed with the owner)
- [x] ✅ Build
  - [x] ✅ Storage: local and S3 chosen from Configuration > Storage, secret encrypted
  - [x] ✅ Path helper (`storagePaths`) and every file writer switched to it
  - [x] ✅ One-time move of existing files to the new layout
  - [x] ✅ Migration 168 and the shared form definition with its validator
  - [x] ✅ Form builder on the Templates tab and the `/v1/forms` routes
  - [x] ✅ Requests (device and email link) and the public form page
  - [x] ✅ Signed PDF stored in the customer's folder
  - [x] ✅ Missing and out-of-date status on profile, booking and check-in
  - [x] ✅ View, print and email a copy
  - [x] ✅ Anonymise and delete remove forms, files and folders; cleanup retry job
- [ ] Verify live and close with the owner

## 2. Treatment charting (Requirement 2)
- [ ] Confirm current state and agree requirements (builds on forms)
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 3. Virtual waiting room (Requirement 3)
- [ ] Confirm current state and agree requirements (including forms at self check-in: criteria 4 and 5)
- [ ] Self check-in (kiosk, QR and phone) shows the customer's outstanding forms and lets them complete them, reusing the public form page and the same outstanding-forms lookup staff check-in uses
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 4. Two-way SMS and WhatsApp (Requirement 4)
- [ ] Write up what the Inbox does today for the owner, and bring Phase 47 documents up to date (with David)
- [ ] Choose the messaging provider(s) with the owner
- [ ] Design (in Phase 47)
- [ ] Build
- [ ] Verify live and close with the owner

## 5. Book-and-pay links (Requirement 5)
- [ ] Confirm current state and agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 6. Class scheduling depth (Requirement 6)
- [ ] Confirm what classes already do (timetable, roster, waitlist promotion, late-cancel rules, pass credits)
- [ ] Agree requirements and design
- [ ] Build
- [ ] Verify live and close with the owner

## 7. Retail inventory (Requirement 7)
- [ ] Confirm current state and agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 8. Staff mobile app (Requirement 8)
- [ ] Confirm current state and agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 9. Video hosting and livestream (Requirement 9)
- [ ] Confirm current state (course authoring, paid access) and choose a video provider
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 10. Payroll payout (Requirement 10)
- [ ] Confirm whether payout or filing exists, and choose build vs payroll provider
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

## 11. Multi-language (Requirement 11)
- [ ] Tracked: finished in Phase 44

## 12. AI assistant and receptionist (Requirement 12)
- [ ] Tracked: finished in Phase 21

## 13. Integrated phone (Requirement 13)
- [ ] Choose a telephony provider and agree requirements
- [ ] Design
- [ ] Build
- [ ] Verify live and close with the owner

---

**Status**: 🟡 In Progress — gap register complete; working top to bottom, starting with section 1
**Dependencies**: Phase 47, Phase 21, Phase 44, Phase 15, Phase 28
