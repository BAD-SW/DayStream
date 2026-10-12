# Phase 47: Inbox - Tasks

## Overview

Tasks follow the delivery steps in design.md section 8 and the channel order decided on 2026-10-12: email, WhatsApp, SMS, in-app. Sections 1 to 4, the outbound half of section 5, and section 6 need no external provider. Requirement numbers refer to requirements.md, which is still a draft: section 0 comes first.

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
- [ ] Decide the open questions listed in requirements.md Notes and design.md section 10
- [ ] Confirm Phase 46 sections 1 to 3 are complete (Identity Service, consent, Contactability Service)
- [ ] Choose the WhatsApp provider and start the Meta Business verification (longest wait)

## 1. Schema and Core Services

### 1.1 Migration `138_inbox.sql`
- [ ] Create `msg_channel_accounts`, `msg_channel_identities`, `msg_conversations`, `msg_messages`, `msg_attachments`, `msg_saved_replies`, `msg_conversation_reads`, `msg_unmatched_inbound` with RLS and grants
- [ ] Add `cus_customers.last_message_at`
- [ ] Add the Inbox configuration keys

### 1.2 Services
- [ ] `ChannelAdapter` interface and mock adapter with simulate-inbound and simulate-status endpoints (R9)
- [ ] `message.service.ts`: `sendMessage`, `recordAutomated`, `receiveInbound`, `applyStatusUpdate`, `addNote` (R2, R3, R4, R6, R8)
- [ ] `conversation.service.ts`: list, filters, search, assign, close, reopen, snooze, read / unread per Channel (R1, R2, R5)
- [ ] `saved-replies.service.ts` with merge fields (R3)
- [ ] Extend the Phase 46 merge for conversations and channel identities

## 2. API

### 2.1 Routes
- [ ] `/inbox/conversations` list, unread count, by person, messages (with the `channel` view), send, notes, update (R1, R2, R3, R5, R6)
- [ ] `/inbox/messages/:id/retry` (R2)
- [ ] `/inbox/saved-replies` (R3)
- [ ] `/inbox/webhooks/:channel` with signature verification (R4)
- [ ] Permission checks on every route; business isolation test (R12)

### 2.2 Live updates
- [ ] SSE stream with `message.new`, `conversation.updated`, `presence` (R1, R5)
- [ ] Polling fallback for the unread count (R11)

## 3. Inbox UI

### 3.1 Pages and components
- [ ] `inbox` entry in `moduleRegistry.ts` with unread badge (R1, R11)
- [ ] `Inbox.tsx` three-column layout with mobile behaviour (R1, R2, R7)
- [ ] Conversation list with filters and search (R1)
- [ ] Thread "All" view with a Channel icon and label on every message (R2)
- [ ] Channel views (Email, WhatsApp, SMS, In-app) with unread counts; remember the last view (R2)
- [ ] Message states, failure reason and retry (R2)
- [ ] Composer: channel picker with reasons, locked to the Channel in a Channel view, saved replies, SMS counter, draft (R2, R3)
- [ ] Internal notes and mentions (R6)
- [ ] Assignment, close, snooze, presence (R5)
- [ ] Person panel with quick actions, incomplete profile and duplicate handling (R7)

### 3.2 Profile and People list
- [ ] "Messages" tab on the profile with the same views (R2)
- [ ] "Message" action on the People list and profile (R3)

## 4. Front Desk Role

### 4.1 Roles and permissions
- [ ] Add `inbox:read` and `inbox:send` to Business Owner and Manager for every tenant (R12)
- [ ] Create the system role "Front Desk" for every existing tenant; move users labelled `reception` to it (R12)
- [ ] Create Front Desk for new tenants in `tenant.service.ts`, `seed.ts` and `seed-config.sql` (R12)
- [ ] Staff create / edit: choose Front Desk or Staff and attach the matching permission role (R12)
- [ ] Tests: Front Desk sees and sends; Staff (therapist, trainer) is refused by menu, page and API (R12)

## 5. Email (first channel)

### 5.1 Email out
- [ ] Email adapter over the existing mailer (R3, R9)
- [ ] Email attachments (R3)

### 5.2 One outbound path
- [ ] Route booking notifications through `recordAutomated` (R8)
- [ ] Route campaign sends through `recordAutomated` and link recipients to messages (R8)
- [ ] Route sequence sends through `recordAutomated` (R8)
- [ ] Collapsed display of automated messages in the thread (R8)

### 5.3 Email in (depends on Phase 41)
- [ ] Reply-to address per conversation and inbound webhook (R3, R4, R8)
- [ ] Strip quoted text and signatures from inbound email
- [ ] Unmatched inbound log (R4)

## 6. Rules, Notifications and Settings

### 6.1 Sending rules
- [ ] Contactability check on every send, with readable refusal reasons (R10)
- [ ] Direct message to a hand-picked group with preview, exclusions and recipient limit (R10)
- [ ] Quiet hours with held messages and the release job (R10)
- [ ] Anonymisation removes message content (R12)

### 6.2 Notifications and settings
- [ ] `inbox-notifications.service.ts`: assignee, unassigned, mentions (R11)
- [ ] Settings → Messaging: channels, quiet hours, notified roles, saved replies (R9, R11)
- [ ] Per-user notification preference (R11)

## 7. WhatsApp (second channel)

### 7.1 Depends on provider choice and Meta verification
- [ ] WhatsApp adapter and connection screen (R9)
- [ ] Service window enforcement and template messages (R9)
- [ ] Inbound, delivery and read status webhooks (R4)
- [ ] Opt-out keywords with confirmation (R4)

## 8. SMS (third channel)

### 8.1 Depends on provider choice
- [ ] SMS adapter, channel connection screen and test (R9)
- [ ] Inbound SMS and delivery status webhooks (R4)
- [ ] Opt-out keywords with confirmation (R4)

## 9. In-App (fourth channel)

### 9.1 Customer portal
- [ ] In-app adapter (R9)
- [ ] `/profile/messages` endpoints and the portal "Messages" page (R9)
- [ ] Unread indicator for the customer

## 10. Verification

### 10.1 Tests and documentation
- [ ] Adapter contract tests pass for every adapter
- [ ] Run `docs/e2e` suite 17, suites 08 and 13, the journeys and the smoke suite; set script statuses from the run
- [ ] Update the path → suite impact map and known issues in `docs/e2e/README.md`
