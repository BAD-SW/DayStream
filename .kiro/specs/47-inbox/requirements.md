# Phase 47: Inbox - Requirements

## Overview

Businesses talk to leads and customers by email, text message, WhatsApp and inside the app. Today DayStream sends messages (booking notifications, campaigns) but keeps no conversation: a reply goes nowhere, staff cannot see what was sent to a person, and an enquiry from someone new is not captured.

The Inbox gives staff one place to read and answer, and gives every Person (Phase 46) one message history. Phase 16 listed "in-app messaging / inbox" and "WhatsApp" as future work; this phase delivers them.

> 📋 **Draft.** These requirements are a best-practice baseline drawn from the current product, from Phase 46 and from how Momence, Mindbody and general-purpose shared inboxes work. They are to be revised against the detailed requirements before implementation starts. Items needing a decision are listed under Notes.

## Goals

- Every message to or from a Person is stored once and visible in the Inbox and on their profile
- Staff answer from one screen, whatever the channel
- A message from an unknown sender becomes a lead automatically
- Nothing is left unanswered: unread, unassigned and open conversations are easy to find
- Staff see who they are talking to without leaving the conversation
- Sending respects consent and the rules of each channel

## Glossary

- **Person**: As defined in Phase 46
- **Conversation**: The complete message history between a Business and one Person. One per Person
- **Message**: One item in a Conversation: inbound, outbound, an Internal_Note, or an Automated_Message
- **Channel**: `in_app`, `email`, `sms`, `whatsapp`
- **Channel_Account**: The Business's own address on a Channel (a sending email address, an SMS number, a WhatsApp Business number)
- **Channel_Identity**: A Person's address on a Channel, used to match inbound Messages
- **Internal_Note**: A Message visible only to staff
- **Automated_Message**: A Message sent by the system: booking notification, campaign, sequence step
- **Saved_Reply**: A reusable text with merge fields
- **Assignee**: The staff member responsible for a Conversation
- **Service_Window**: The period after a Person's last inbound WhatsApp message (24 hours) during which free-text replies are permitted by WhatsApp
- **Direct_Message**: A Message written by a staff member to one Person or a small hand-picked group, as opposed to a campaign

## Requirements

### Requirement 1: Conversation List

**User Story:** As a front-desk user, I want to see all conversations in one list, so that I know what needs an answer.

#### Acceptance Criteria

1. THE system SHALL provide an Inbox entry in the business navigation, showing the number of unread Conversations
2. THE system SHALL list Conversations with: Person name (or Contact_Point), stage badge, last Message preview, Channel of the last Message, time of the last Message, unread marker, Assignee
3. THE system SHALL order Conversations by most recent Message first
4. THE system SHALL provide these filters: Unread, Assigned to me, Unassigned, Open, Closed, by Channel, Leads only, Customers only
5. THE system SHALL support searching Conversations by Person name, email, phone and Message text
6. THE system SHALL update the list without a page reload when a new Message arrives
7. THE system SHALL show times in the Business's time zone

### Requirement 2: Conversation Thread

**User Story:** As a staff member, I want to read the whole history with a person in one thread, so that I have the context before I reply.

#### Acceptance Criteria

1. THE system SHALL keep exactly one Conversation per Person per Business
2. THE system SHALL provide an "All" view of the thread showing the Messages of every Channel in time order, each clearly marked with its Channel (icon and name) and direction
3. THE system SHALL provide a separate view of the thread for each Channel the Person has Messages on (Email, WhatsApp, SMS, In-app), showing only that Channel's Messages
4. THE system SHALL let staff switch between the "All" view and the Channel views without leaving the Conversation, and SHALL show the number of unread Messages on each
5. WHILE a Channel view is selected, THE system SHALL send replies on that Channel
6. THE system SHALL show Internal_Notes in the "All" view only
7. THE system SHALL remember each user's last chosen view
8. THE system SHALL show for each outbound Message who sent it and its delivery state: queued, sent, delivered, read (where the Channel reports it), failed
9. THE system SHALL show the reason when a Message fails, and SHALL allow it to be retried
10. THE system SHALL mark a Conversation as read when a staff member opens it, and SHALL allow it to be marked unread again
11. THE system SHALL show the same thread, with the same "All" and Channel views, in a Messages tab on the Person's profile

### Requirement 3: Replying and Composing

**User Story:** As a staff member, I want to reply on the right channel without thinking about it, so that the person receives my answer where they wrote.

#### Acceptance Criteria

1. WHILE the "All" view is selected, THE system SHALL default the reply Channel to the Channel of the Person's last inbound Message
2. THE system SHALL let staff choose another Channel, offering only Channels on which the Person can be contacted, and stating the reason for each unavailable Channel
3. THE system SHALL support starting a Conversation with any Person from the Inbox, the People list and the profile
4. THE system SHALL require a subject for email Messages and SHALL show the character count and number of parts for SMS Messages
5. THE system SHALL support Saved_Replies with merge fields (first name, business name, next booking) and SHALL show the filled-in text before sending
6. THE system SHALL keep an unsent draft per Conversation
7. THE system SHALL send email replies from the Business's sending address, with replies routed back to the Conversation
8. THE system SHALL support file attachments on email Messages

### Requirement 4: Inbound Messages and Unknown Senders

**User Story:** As a business owner, I want a message from someone new to create a lead, so that no enquiry is lost.

#### Acceptance Criteria

1. WHEN an inbound Message arrives, THE system SHALL find the Person through the Phase 46 Identity_Service using the sender's Channel_Identity
2. WHEN no Person matches, THE system SHALL create a Person at stage `lead` with Source `inbound_message` and the Channel as source detail
3. THE system SHALL add the inbound Message to that Person's Conversation, reopen the Conversation if it was closed, and mark it unread
4. THE system SHALL update the Person's last activity
5. THE system SHALL store the sender's display name, where the Channel supplies one, as the Person's name when the Person has none
6. THE system SHALL discard nothing: a Message that cannot be matched to a Business SHALL be logged for the platform operator
7. THE system SHALL recognise opt-out keywords on SMS and WhatsApp (STOP, BAJA and equivalents), withdraw marketing consent on that Channel and confirm to the Person

### Requirement 5: Assignment and Status

**User Story:** As a manager, I want each conversation to have a clear owner and state, so that nothing is forgotten or answered twice.

#### Acceptance Criteria

1. THE system SHALL allow a Conversation to be assigned to one staff member, or to no one
2. THE system SHALL default the Assignee of a new Conversation to the Person's Owner (Phase 46), where set
3. THE system SHALL support the states Open and Closed, and SHALL allow a Conversation to be snoozed until a chosen date and time
4. THE system SHALL reopen a snoozed Conversation at the chosen time or when the Person writes, whichever comes first
5. THE system SHALL show when another staff member is viewing or typing in the same Conversation
6. THE system SHALL record assignment and state changes in the thread

### Requirement 6: Internal Notes

**User Story:** As a staff member, I want to leave a note for colleagues inside a conversation, so that the next person knows what was agreed.

#### Acceptance Criteria

1. THE system SHALL support Internal_Notes in the thread, visually distinct from Messages
2. THE system SHALL never send an Internal_Note to the Person nor show it in the customer portal
3. THE system SHALL support mentioning a staff member in an Internal_Note and SHALL notify them

### Requirement 7: Person Context Panel

**User Story:** As a front-desk user, I want to see who I am talking to next to the conversation, so that I can answer without opening other screens.

#### Acceptance Criteria

1. THE system SHALL show beside the thread: name, Contact_Points, stage, tags, Source, Owner, next booking, last visit, active membership, outstanding balance
2. THE system SHALL provide quick actions from the panel: open profile, new booking, add note, add tag, change Owner
3. WHERE the Person's profile is incomplete, THE system SHALL let staff complete it from the panel
4. WHERE possible duplicates are flagged, THE system SHALL show them with the merge action

### Requirement 8: Automated Messages in the Thread

**User Story:** As a staff member, I want to see what the system already sent to a person, so that I do not repeat or contradict it.

#### Acceptance Criteria

1. THE system SHALL record every booking notification, campaign Message and sequence Message sent to a Person as an Automated_Message in their Conversation
2. THE system SHALL show Automated_Messages collapsed to one line, expandable to the full content
3. THE system SHALL NOT mark a Conversation unread or reopen it because of an Automated_Message
4. THE system SHALL route a Person's reply to an Automated_Message into the same Conversation as an inbound Message

### Requirement 9: Channels

**User Story:** As a business owner, I want to connect the channels my customers use, so that I can answer them where they are.

#### Acceptance Criteria

1. THE system SHALL support the Channels `email`, `whatsapp`, `sms` and `in_app`, each switched on separately per Business, and SHALL deliver them in that order
2. THE system SHALL provide a settings screen where a Business connects, tests and disconnects each Channel_Account
3. THE system SHALL show the connection state of each Channel and SHALL warn in the Inbox when a connected Channel stops working
4. THE system SHALL let a logged-in customer read and send `in_app` Messages from the customer portal
5. WHILE a WhatsApp Service_Window is closed, THE system SHALL allow only approved template Messages on WhatsApp and SHALL explain why
6. THE system SHALL provide a mock adapter for every Channel so the Inbox can be developed and tested without a provider
7. THE system SHALL hide Channels that are not connected from reply and compose choices

### Requirement 10: Consent and Sending Rules

**User Story:** As a business owner, I want the Inbox to keep me within the rules, so that staff cannot send something they should not.

#### Acceptance Criteria

1. THE system SHALL pass every outbound Message through the Phase 46 Contactability_Check
2. THE system SHALL treat a reply inside a Conversation the Person started as `transactional`
3. THE system SHALL treat a Direct_Message to more than one Person as `marketing`, and SHALL exclude People without marketing consent on that Channel, showing how many were excluded and why
4. THE system SHALL limit a Direct_Message to a configurable number of recipients (default 50) and SHALL point to campaigns for larger audiences
5. THE system SHALL respect quiet hours for SMS and WhatsApp, configurable per Business (default 21:00 to 09:00 business time), holding Messages until the window opens unless staff choose to send anyway to a single Person
6. THE system SHALL refuse Messages to archived, merged or anonymised People

### Requirement 11: Notifications

**User Story:** As a staff member, I want to know when a message needs me, so that people are not kept waiting.

#### Acceptance Criteria

1. THE system SHALL show an unread count on the Inbox navigation entry, updated without a reload
2. THE system SHALL notify the Assignee of a new inbound Message, and all users with Inbox access when the Conversation is unassigned
3. THE system SHALL let each Business choose which roles receive Inbox notifications
4. THE system SHALL let each user choose in-app notification, email notification, or none

### Requirement 12: Access Control

**User Story:** As a business owner, I want to decide who can read and send messages, so that customer conversations stay private.

#### Acceptance Criteria

1. THE system SHALL add the permissions `inbox:read` and `inbox:send`
2. THE system SHALL provide a "Front Desk" role, separate from the "Staff" role, for reception users
3. THE system SHALL grant `inbox:read` and `inbox:send` by default to Business Owner, Manager and Front Desk
4. THE system SHALL NOT grant Inbox access by default to the "Staff" role (service providers such as therapists and trainers)
5. THE system SHALL create the Front Desk role for every existing and every new tenant, and SHALL move existing reception users to it
6. THE system SHALL let the role of a staff member be chosen as Front Desk or Staff when the staff member is created or edited
7. THE system SHALL show the Inbox only to users with `inbox:read`, and the composer only to users with `inbox:send`
8. THE system SHALL keep Conversations strictly within their Business
9. THE system SHALL record who sent every outbound Message
10. WHEN a Person is anonymised, THE system SHALL remove the content of their Messages and keep only dates, Channels and directions

---

## Dependencies

- Phase 46: People Foundation - Person record, Identity_Service, Contactability_Check, Owner, consent
- Phase 41: Email Server - Production sending and inbound email
- Phase 20: Integrations - SMS and WhatsApp providers
- Phase 16: Marketing Automation - Campaign and sequence sends recorded in the thread
- Phase 07: Booking Engine - Booking notifications recorded in the thread
- Phase 39: Security Profiles - Role permissions

## Success Criteria

- A reply to a booking confirmation email appears in the Inbox under the right Person
- An SMS from an unknown number creates one lead and one unread Conversation
- The same thread is visible in the Inbox and on the profile
- Two staff members cannot unknowingly answer the same Conversation
- A marketing Direct_Message never reaches a Person without consent
- The Inbox works end to end with mock adapters and no provider account

## Out of Scope

- Instagram and Facebook direct messages - Later channel; the model allows it
- Voice calls and voicemail - Not planned
- AI replies and chat bots - Phase 21
- Turning a Message into a staff task - Needs a task module that does not exist yet
- A chat bubble on the business's public website - Later; needs visitor identity rules
- Several Conversations per Person (ticket style) - One Conversation per Person, viewable as a whole or per Channel
- A screen to create roles and edit their permissions - Phase 39 (Security Profiles); until then role permissions are set by the platform
- Bulk marketing sends - Campaigns (Phase 43)

## Notes

- Decisions to confirm with the detailed requirements:
  1. Provider choice for WhatsApp and SMS (for example Twilio, MessageBird / Bird, 360dialog). WhatsApp needs a verified Meta Business account per business, which can take days to weeks: start it early, since WhatsApp is the second channel
  2. Two-way email needs inbound email handling from Phase 41 (Email Server), which is still a placeholder; sending email works today
  3. Quiet-hours default and the Direct_Message recipient limit
  4. Whether the Front Desk role should also be allowed to create and edit People (proposed: yes)
- Decided on 2026-10-12:
  - Channel order: email, then WhatsApp, then SMS, then in-app
  - The thread is shown as a whole and per Channel (Requirement 2)
  - Reception sees the Inbox by default, therapists and trainers do not; a separate Front Desk role is created (Requirement 12)
- How roles work today: each login has a free-text label (`reception`, `therapist`, `trainer`, `business_staff`...) that grants nothing, and is separately attached to a permission role (Business Owner, Manager, Staff). The seed attaches reception, therapist and trainer all to "Staff". Staff members created through the Staff screen get a label but, in the local data, no permission role at all: to be checked under Phase 39
- Competitor practice checked on 2026-10-12: Momence's Inbox combines two-way SMS, in-app, email and Instagram / Facebook messages, shows the customer profile beside the thread, lets a message be turned into a staff task and lets the host choose which roles are notified. Mindbody offers messaging through a separate add-on (Messenger) covering web chat, SMS and Facebook
- Email and SMS delivery is checked in tests up to the provider hand-off, as for the rest of the E2E book

---

**Status**: 📋 Planned
**Dependencies**: Phase 46, Phase 41, Phase 20, Phase 16, Phase 07, Phase 39
**Next Phase**: Phase 48 (Marketing Module)
