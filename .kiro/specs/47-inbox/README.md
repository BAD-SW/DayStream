# Phase 47: Inbox

**Status**: 📋 Planned (draft: detailed requirements to be confirmed)
**Dependencies**: Phase 46 (People Foundation), Phase 41 (Email Server), Phase 20 (Integrations)

---

## Documents

- **[requirements.md](./requirements.md)** - Two-way conversations with leads and customers across channels
- **[design.md](./design.md)** - Conversation and message model, channel adapters, API and UI
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

The Inbox is where staff read and answer messages from the people the business knows, whatever channel they used. Every conversation belongs to one Person from Phase 46, so the same thread is visible in the Inbox and on the person's profile, and a message from an unknown sender creates a lead instead of being lost.

The name "Inbox" is kept: it is the term used by Momence, Mindbody, HubSpot and Intercom, and needs no explanation. This first version of the spec is a best-practice baseline; it will be revised when the detailed requirements are provided.

**Core Features**:
- One conversation per person, viewable as a whole or channel by channel
- Channels delivered in order: email, WhatsApp, SMS, in-app
- A Front Desk role with Inbox access; service providers have none by default
- Assignment, internal notes, saved replies, unread and open / closed states
- Person profile beside the conversation, with quick actions
- Automated messages (confirmations, campaigns) shown in the same thread

---

**Last Updated**: October 12, 2026
