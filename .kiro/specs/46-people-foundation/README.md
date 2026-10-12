# Phase 46: People Foundation

**Status**: 📋 Planned
**Dependencies**: Phase 05 (Customer Management), Phase 16 (Marketing Automation), Phase 02 (Security & Compliance)

---

## Documents

- **[requirements.md](./requirements.md)** - One person record for leads and customers: identity, source, consent, views, merge
- **[design.md](./design.md)** - Schema changes, identity service, contactability service, API and UI changes
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

People Foundation turns the existing Customers module into the single place where every person a business knows lives, whether they are a lead who has only sent a message or a member of five years. "Lead" and "customer" are lifecycle stages on one record, never two separate lists.

It is the first of three linked phases. Phase 47 (Inbox) and Phase 48 (Marketing Module) both attach to the person record defined here, so this phase ships first and adds no new module of its own: it extends Phase 05.

**Core Features**:
- "People" navigation with saved views (All, Leads, Customers, At risk, Former)
- People who have only an email or only a phone
- One identity-matching rule used by every entry point
- Source, owner, last activity and last login on every person
- One consent record per channel, enforced by one contactability check
- Complete, reversible-by-audit merge

---

**Last Updated**: October 12, 2026
