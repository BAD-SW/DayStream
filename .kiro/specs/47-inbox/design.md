# Phase 47: Inbox - Design Document

**Date**: October 12, 2026
**Status**: 🎨 Design Phase (draft, follows the draft requirements)
**Dependencies**: Phase 46, Phase 41, Phase 20, Phase 16, Phase 07

---

## Overview

The Inbox adds a `msg_` table group and one outbound path that every message in the platform goes through. A Conversation is one row per Person; Messages hang off it. Channels are adapters behind one interface, extending the adapter pattern already in `marketing-adapters.service.ts`. Inbound messages arrive by provider webhook and are matched to a Person by the Phase 46 Identity Service.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Database Schema](#2-database-schema)
3. [Service Architecture](#3-service-architecture)
4. [API Endpoints](#4-api-endpoints)
5. [Live Updates](#5-live-updates)
6. [Frontend](#6-frontend)
7. [Permissions](#7-permissions)
8. [Delivery Steps](#8-delivery-steps)
9. [Testing Strategy](#9-testing-strategy)
10. [Open Questions](#10-open-questions)

---

## 1. Architecture

```
 Staff UI (Inbox, profile tab)          Customer portal (in-app)
            |                                     |
            v                                     v
     /api/v1/inbox/*                       /api/v1/profile/messages
            |                                     |
            +------------> message.service <------+
                               |      ^
        contactability (46) <--+      |  recordAutomated()
                               |      +---- booking notifications, campaigns, sequences
                               v
                       channel adapters  (in_app | email | sms | whatsapp | mock)
                               ^
                               |  provider webhooks: inbound + delivery status
                    /api/v1/inbox/webhooks/:channel
                               |
                     person-identity (46)  ->  find or create lead
```

One rule: **no module calls a provider directly.** Booking notifications, campaigns and sequences keep their own scheduling but hand each message to `message.service`, which checks contactability, sends through the adapter and records the Message.

---

## 2. Database Schema

Migration `138_inbox.sql`. All tables carry `tenant_id` and `business_id`, RLS and grants as in Phase 46.

```sql
CREATE TABLE msg_channel_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('in_app','email','sms','whatsapp')),
    provider VARCHAR(30) NOT NULL,              -- 'mock', 'smtp', 'twilio', ...
    address VARCHAR(255),                       -- sending email, phone number
    config_encrypted TEXT,                      -- provider credentials, encrypted like processor connections
    status VARCHAR(20) NOT NULL DEFAULT 'disconnected'
        CHECK (status IN ('connected','disconnected','error')),
    last_error TEXT, last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, channel)
);

CREATE TABLE msg_channel_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    channel VARCHAR(20) NOT NULL,
    handle VARCHAR(255) NOT NULL,               -- normalised email, E.164 number
    display_name VARCHAR(200),
    last_inbound_at TIMESTAMPTZ,                -- drives the WhatsApp service window
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, channel, handle)
);

CREATE TABLE msg_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','snoozed')),
    snoozed_until TIMESTAMPTZ,
    assignee_user_id UUID REFERENCES usr_users(id),
    unread BOOLEAN NOT NULL DEFAULT false,
    last_message_at TIMESTAMPTZ,
    last_message_preview VARCHAR(200),
    last_message_channel VARCHAR(20),
    last_inbound_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, customer_id)
);
CREATE INDEX idx_msg_conversations_list ON msg_conversations (business_id, status, last_message_at DESC);
CREATE INDEX idx_msg_conversations_assignee ON msg_conversations (business_id, assignee_user_id);

CREATE TABLE msg_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    conversation_id UUID NOT NULL REFERENCES msg_conversations(id),
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('inbound','outbound','note','automated','event')),
    channel VARCHAR(20),                        -- null for note / event
    purpose VARCHAR(15) CHECK (purpose IN ('marketing','transactional')),
    origin VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (origin IN ('manual','booking','campaign','sequence','system')),
    origin_id UUID,                             -- booking, campaign or sequence id
    subject VARCHAR(500),
    body TEXT,
    body_html TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','held','sent','delivered','read','failed','received')),
    failure_reason TEXT,
    hold_until TIMESTAMPTZ,                     -- quiet hours
    provider_message_id VARCHAR(200),
    in_reply_to UUID REFERENCES msg_messages(id),
    sender_user_id UUID REFERENCES usr_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ
);
CREATE INDEX idx_msg_messages_thread ON msg_messages (conversation_id, created_at);
CREATE INDEX idx_msg_messages_provider ON msg_messages (provider_message_id);
CREATE INDEX idx_msg_messages_search ON msg_messages USING GIN (to_tsvector('simple', COALESCE(subject,'') || ' ' || COALESCE(body,'')));

CREATE TABLE msg_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    message_id UUID NOT NULL REFERENCES msg_messages(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL
);

CREATE TABLE msg_saved_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, business_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL, body TEXT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active',
    created_by UUID REFERENCES usr_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE msg_unmatched_inbound (            -- R4.6: nothing is discarded
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel VARCHAR(20) NOT NULL, to_address VARCHAR(255), from_address VARCHAR(255),
    payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Also:

- `cus_customers.last_message_at` (denormalised, for the People list).
- `mkt_campaign_recipients` and booking notification rows gain `message_id` so a delivery update reaches both records.
- Roles: `inbox:read`, `inbox:send` added to Business Owner and Manager; new system role "Front Desk" (section 7).
- `msg_conversation_reads (conversation_id, user_id, channel, read_at)`: per-user, per-Channel read position, for the unread counts on the Channel views.
- Business configuration keys: `inbox.quiet_hours_start`, `inbox.quiet_hours_end`, `inbox.direct_message_limit`, `inbox.notify_roles`.
- Phase 46 merge gains explicit handling for `msg_conversations` (move messages into the primary's conversation, then remove the empty one) and `msg_channel_identities`.

---

## 3. Service Architecture

### 3.1 Channel adapters

```ts
export interface ChannelAdapter {
  channel: Channel;
  send(account: ChannelAccount, msg: OutboundPayload): Promise<{ providerMessageId: string }>;
  parseInbound(req: Request): InboundPayload | null;       // webhook → normalised message
  parseStatus(req: Request): StatusUpdate | null;          // webhook → delivery status
  verifyWebhook(req: Request, account: ChannelAccount): boolean;
  testConnection(account: ChannelAccount): Promise<{ ok: boolean; error?: string }>;
}
```

`getChannelAdapter(businessId, channel)` returns the adapter for the connected account, or the mock adapter in development and tests. The existing `MockEmailAdapter` / `MockSmsAdapter` move behind this interface. The mock adapter exposes a test-only endpoint to simulate an inbound message and a status update.

### 3.2 `message.service.ts`

```ts
sendMessage({ businessId, personId, channel, purpose, subject?, body, senderUserId, origin, originId, force? })
  → contactability.canContact → quiet-hours check → adapter.send → insert msg_messages → update conversation
recordAutomated(...)      // same path, kind 'automated', never sets unread or reopens
receiveInbound(payload)   // identity → conversation upsert → message insert → unread, reopen, notify
applyStatusUpdate(update) // by provider_message_id; also updates campaign recipient / notification rows
addNote(conversationId, body, userId, mentions[])
```

`getOrCreateConversation(businessId, personId)` uses the unique key and `ON CONFLICT`. WhatsApp free text is refused outside the service window (`msg_channel_identities.last_inbound_at` + 24 h) with reason `whatsapp_window_closed`. Opt-out keywords are handled in `receiveInbound` through `consent.service.setConsent(method: 'keyword_reply')`.

### 3.3 Other services

- `conversation.service.ts`: list with filters and search, assign, close, reopen, snooze, mark read / unread.
- `saved-replies.service.ts`: CRUD and merge-field rendering (reuses `marketing-templates` rendering).
- `inbox-notifications.service.ts`: who to notify, per role and per user settings.
- Job `inbox-release-held`: every minute, sends `held` messages whose `hold_until` has passed and reopens snoozed conversations.

---

## 4. API Endpoints

Under `/api/v1/inbox`, all requiring `business_id` and `inbox:read` unless stated.

| Method | Path | Purpose |
|---|---|---|
| GET | `/conversations` | List; filters `status`, `assignee`, `unread`, `channel`, `stage`, `q`; cursor paging |
| GET | `/conversations/unread-count` | Badge |
| GET | `/conversations/by-person/:personId` | Open or create the thread from a profile |
| GET | `/conversations/:id/messages` | Thread, paged backwards; optional `channel` returns one Channel's view; the response includes the unread count per Channel |
| POST | `/conversations/:id/messages` | Send (`inbox:send`) |
| POST | `/conversations/:id/notes` | Internal note |
| PUT | `/conversations/:id` | Assign, close, reopen, snooze, read / unread |
| POST | `/messages/:id/retry` | Retry a failed message (`inbox:send`) |
| POST | `/direct-messages/preview` | Recipients, excluded count and reasons |
| POST | `/direct-messages` | Send to a hand-picked group (`inbox:send`) |
| GET / POST / PUT / DELETE | `/saved-replies` | Saved replies |
| GET / PUT | `/channels`, `/channels/:channel` | Connection state, connect, disconnect (`settings:*`) |
| POST | `/channels/:channel/test` | Test a connection (`settings:*`) |
| GET / PUT | `/settings` | Quiet hours, limits, notified roles (`settings:*`) |
| POST | `/webhooks/:channel` | Public; signature-verified; inbound and status |
| GET / POST | `/api/v1/profile/messages` | Customer portal: own in-app thread |

Webhook endpoints find the business from the destination address through `msg_channel_accounts`.

---

## 5. Live Updates

Server-Sent Events at `GET /api/v1/inbox/stream` (one connection per open app, authenticated, business-scoped). Events: `message.new`, `conversation.updated`, `presence`. SSE is chosen over WebSockets because traffic is one-directional and it passes through the existing Express stack and proxies unchanged. The client falls back to polling `unread-count` every 30 seconds when the stream drops. Presence ("Maria is replying") is held in memory with a short expiry; it is best-effort and not stored.

---

## 6. Frontend

- `moduleRegistry.ts`: new entry `inbox` (title "Inbox", path `/inbox`, persona `business`, permission `inbox:read`), placed directly under People, with an unread badge.
- `pages/Inbox.tsx`: three columns on desktop (list · thread · person panel); one column at a time on mobile.
- `components/inbox/`: `ConversationList`, `Thread`, `ChannelTabs`, `MessageBubble`, `Composer` (channel picker, saved replies, SMS counter, draft kept in `localStorage`), `PersonPanel`, `AssigneePicker`.
- `ChannelTabs` sits above the thread: **All · Email · WhatsApp · SMS · In-app**, showing only Channels the Person has Messages on, each with an unread count. "All" interleaves every Channel, with a Channel icon and label on each bubble; a Channel tab filters the thread and locks the composer to that Channel. Every Message already carries its Channel, so the views are filters over one thread, not separate conversations.
- `CustomerDetail.tsx`: new "Messages" tab reusing `Thread` and `Composer`. `Customers.tsx`: "Message" row and bulk action (opens the direct-message dialog).
- Settings → "Messaging": channel connections, quiet hours, notified roles, saved replies.
- Customer portal: "Messages" page for the in-app thread.
- Design-system components and CSS variables only.

---

## 7. Permissions

| Permission | Allows | Default roles |
|---|---|---|
| `inbox:read` | See the Inbox, threads, the profile Messages tab | Business Owner, Manager, Front Desk |
| `inbox:send` | Send, add notes, assign, close | Business Owner, Manager, Front Desk |
| `settings:*` | Channels and Inbox settings | Business Owner |

**Front Desk role.** Today a login has two unrelated things: `usr_users.role`, a free-text label (`reception`, `therapist`, `trainer`, `business_staff`, `business_manager`...) that grants nothing by itself, and a row in `usr_user_roles` pointing at a permission role in `usr_roles` (Business Owner, Manager, Staff). The seed attaches reception, therapist and trainer to the same "Staff" role, so they cannot be told apart by permission.

| Role | Permissions |
|---|---|
| Staff (unchanged; service providers) | `bookings:read` `bookings:update` `customers:read` `schedule:read` `checkin:*` `events:read` |
| Front Desk (new) | everything in Staff, plus `customers:update` `inbox:read` `inbox:send` |

- Migration `138_inbox.sql` inserts a system role "Front Desk" for every tenant and moves users whose label is `reception` from Staff to Front Desk.
- `tenant.service.ts` (new tenant provisioning), `seed.ts` and `seed-config.sql` create it alongside the other roles.
- `StaffCreate.tsx` / `StaffDetail.tsx`: the role select offers Front Desk and Staff and attaches the matching permission role (today it only sets the label).
- A screen to edit role permissions is Phase 39, not this phase.

Tenant- and system-persona users reach a business's Inbox only through the context switcher, as for every business module.

---

## 8. Delivery Steps

Channel order decided on 2026-10-12: email, WhatsApp, SMS, in-app.

| Step | Contents | External dependency |
|---|---|---|
| A | Schema, `message.service`, mock adapters, Inbox UI with "All" and Channel views, notes, assignment, saved replies, profile tab, Front Desk role | None |
| B | Email: outbound through the existing mailer; booking notifications, campaigns and sequences recorded as automated messages; inbound email (reply-to address per conversation, provider inbound webhook) | Inbound needs Phase 41 |
| C | WhatsApp: two-way, service window, templates | Provider and Meta Business verification |
| D | SMS: two-way, opt-out keywords, quiet hours | Provider account |
| E | In-app channel with the customer portal | None |

Step A plus the outbound half of B deliver a usable Inbox with no provider. The Meta Business verification for step C should be requested while A and B are being built, because it is the longest wait.

---

## 9. Testing Strategy

- Unit: adapter contract tests run against every adapter; quiet-hours and service-window logic; opt-out keyword detection.
- Integration: inbound from an unknown sender creates one lead and one conversation; second inbound reuses both; reply defaults to the last inbound channel; automated message does not set unread; status webhook updates message and campaign recipient; isolation between businesses.
- End-to-end: `docs/e2e/suites/17-inbox.md` (INB-01 to INB-14), driven with the mock adapter's simulate endpoints.

---

## 10. Open Questions

Carried from requirements.md Notes: provider choice, inbound email (Phase 41), quiet-hours and recipient-limit defaults, Front Desk editing People. Two design-level questions:

| # | Question | Default taken |
|---|---|---|
| 1 | Inbound email addressing: one shared business address, or a unique reply-to per conversation? | Unique reply-to per conversation (reliable matching); the shared address also accepted and matched by sender |
| 2 | How long are message bodies kept? | Indefinitely, until the Person is anonymised |
