# Phase 48: Marketing Module

**Status**: 📋 Planned (draft: detailed requirements to be confirmed)
**Dependencies**: Phase 46 (People Foundation), Phase 47 (Inbox), Phase 16 (Marketing Automation)

---

## Documents

- **[requirements.md](./requirements.md)** - The Marketing module; first section: Leads (capture, follow-up, conversion)
- **[design.md](./design.md)** - Lead fields on the person record, capture paths, API and UI
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

This phase is the Marketing module. It is built section by section; **Leads is the first section** and the only one specified so far. Further sections (campaigns, marketing reports and others) will be added to this spec as their requirements are defined.

A lead is a Person at stage `lead` (Phase 46), so the Leads section adds no second list of people: it adds a working view inside Marketing with the things a business needs to turn enquiries into customers: where each lead came from, who is following up, what happens next, and whether it worked.

It also establishes the rule the rest of Marketing follows: an audience is any Segment of People, so campaigns can reach existing customers as easily as leads.

**Core Features**:
- Leads view in Marketing: status, source, owner, next follow-up
- Capture from forms, the booking widget, inbound messages, imports and manual entry
- Automatic conversion on first booking or purchase; lost and disqualified outcomes
- Automatic follow-up sequences by source
- Lead reporting: by source, conversion rate, time to convert
- Audience picker over all People for every campaign and sequence

---

**Last Updated**: October 12, 2026
