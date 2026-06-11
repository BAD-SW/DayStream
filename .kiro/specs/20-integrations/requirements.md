# Phase 20: Integrations - Requirements

## Overview

This phase connects the platform with third-party services — calendars, marketing tools, messaging platforms, accounting software, and automation platforms. Integrations extend the platform's value by fitting into the business's existing toolset rather than replacing everything. All integrations are built behind abstraction interfaces, enabled per tenant, and designed for reliability with retry logic and error handling.

## Goals

- Implement two-way calendar sync (Google Calendar, Outlook/Office 365)
- Support marketing platform integrations (Mailchimp, Klaviyo)
- Support messaging integrations (WhatsApp Business API)
- Support accounting software sync (Xero, QuickBooks)
- Implement automation platform connectors (Zapier, Make)
- Build a webhook system for outbound event notifications
- Provide an integration marketplace (tenants enable/disable per integration)
- Establish OAuth2 flows for third-party authorization

## Glossary

- **Integration**: A configured connection between the platform and a third-party service
- **Integration_Adapter**: The abstraction layer interface for a specific integration category
- **Webhook**: An outbound HTTP notification triggered by a platform event
- **Webhook_Subscription**: A configured endpoint that receives specific event types
- **Sync_Direction**: Whether data flows one-way (platform → external or external → platform) or two-way
- **OAuth2_Connection**: An authorized link to a third-party service using OAuth2 tokens
- **Sync_Conflict**: A situation where both the platform and external system modified the same record
- **Integration_Marketplace**: The tenant-facing interface for browsing, enabling, and configuring integrations
- **API_Key**: A credential issued for external systems to access the platform's API
- **Rate_Limit**: A constraint on how many API calls can be made within a time window

## Requirements

### Requirement 1: Google Calendar Sync

**User Story:** As a staff member, I want my bookings synced to my Google Calendar, so that I see my full schedule in one place.

#### Acceptance Criteria

1. THE system SHALL support two-way sync between platform bookings and Google Calendar
2. THE system SHALL create a Google Calendar event when a booking is confirmed
3. THE system SHALL update the Google Calendar event when a booking is rescheduled
4. THE system SHALL delete the Google Calendar event when a booking is cancelled
5. THE system SHALL detect new events created in Google Calendar and block that time as a staff availability override
6. THE system SHALL support connecting via Google OAuth2 (staff authorizes their own calendar)
7. THE system SHALL handle Sync_Conflicts gracefully (platform is source of truth for bookings; Google is source of truth for personal blocks)
8. THE system SHALL sync within 5 minutes of a change (near real-time via push notifications or polling)
9. THE system SHALL support configuring which calendar to sync with (if staff has multiple)
10. THE system SHALL include service name, customer name, and location in the calendar event

### Requirement 2: Outlook/Office 365 Calendar Sync

**User Story:** As a staff member who uses Outlook, I want my bookings synced there, so that I don't need to check two calendars.

#### Acceptance Criteria

1. THE system SHALL support two-way sync between platform bookings and Outlook/Office 365 Calendar
2. THE system SHALL use the Microsoft Graph API for Outlook integration
3. THE system SHALL support connecting via Microsoft OAuth2
4. THE system SHALL create, update, and delete calendar events matching booking lifecycle
5. THE system SHALL detect external events and block staff availability accordingly
6. THE system SHALL handle Sync_Conflicts with the same rules as Google Calendar
7. THE system SHALL support both personal Microsoft accounts and organizational (work) accounts
8. THE system SHALL include relevant booking details in the calendar event body

### Requirement 3: iCal Feed (Read-Only)

**User Story:** As a staff member or customer, I want an iCal feed URL, so that I can subscribe from Apple Calendar or any calendar app.

#### Acceptance Criteria

1. THE system SHALL generate a unique iCal feed URL per staff member (their bookings)
2. THE system SHALL generate a unique iCal feed URL per customer (their bookings)
3. THE feed SHALL update in real-time as bookings change
4. THE feed SHALL be read-only (subscribing calendars pull data but cannot push changes)
5. THE feed SHALL include standard iCalendar fields (VEVENT with summary, location, start, end, description)
6. THE feed URL SHALL include a secure token (not guessable, revocable)
7. THE system SHALL support generating a new feed URL if the old one is compromised

### Requirement 4: Marketing Platform Integrations

**User Story:** As a business owner, I want my customer list synced to my email marketing tool, so that I can use their advanced campaign features alongside the platform.

#### Acceptance Criteria

1. THE system SHALL support syncing customer data to Mailchimp (audiences/lists)
2. THE system SHALL support syncing customer data to Klaviyo (profiles/lists)
3. THE system SHALL sync customer fields: name, email, phone, membership type, tags, lifecycle stage
4. THE system SHALL support configuring which segments/tags to sync (not necessarily all customers)
5. THE system SHALL sync new customers automatically when they are created
6. THE system SHALL sync customer updates (profile changes, tag changes, unsubscribes)
7. THE system SHALL respect unsubscribes synced back from the marketing platform
8. THE system SHALL connect via OAuth2 or API key (per provider)
9. THE system SHALL log all sync operations for troubleshooting

### Requirement 5: WhatsApp Business API

**User Story:** As a business owner, I want to send booking confirmations and reminders via WhatsApp, so that I reach customers on their preferred messaging channel.

#### Acceptance Criteria

1. THE system SHALL support sending WhatsApp messages for: booking confirmations, booking reminders, membership notifications, custom messages (from marketing sequences, Phase 16)
2. THE system SHALL use pre-approved WhatsApp message templates (required by WhatsApp Business API)
3. THE system SHALL support receiving customer replies (two-way within the 24-hour conversational window)
4. THE system SHALL connect via a WhatsApp Business API provider (provider TBD per THIRD_PARTY_SERVICES.md)
5. THE system SHALL track message delivery status (sent, delivered, read, failed)
6. THE system SHALL respect customer opt-in for WhatsApp communications
7. THE system SHALL display WhatsApp conversation history on the customer profile
8. THE system SHALL support WhatsApp as a channel in automated sequences (Phase 16)

### Requirement 6: Accounting Software Sync

**User Story:** As a business owner, I want my invoices and payments synced to my accounting software, so that my books are always up to date without manual entry.

#### Acceptance Criteria

1. THE system SHALL support syncing to Xero: invoices, payments, refunds, contacts
2. THE system SHALL support syncing to QuickBooks Online: invoices, payments, refunds, customers
3. THE system SHALL map platform accounts to accounting software chart of accounts (configurable mapping)
4. THE system SHALL create invoices in the accounting system when payments are processed
5. THE system SHALL mark invoices as paid when payment confirmations are received
6. THE system SHALL sync refunds as credit notes
7. THE system SHALL connect via OAuth2
8. THE system SHALL support configuring sync frequency (real-time or batch daily)
9. THE system SHALL handle sync errors gracefully (retry, log, alert admin)
10. THE system SHALL prevent duplicate entries on retry

### Requirement 7: Zapier / Make Connector

**User Story:** As a business owner, I want to connect the platform to other tools via Zapier or Make, so that I can automate workflows without custom development.

#### Acceptance Criteria

1. THE system SHALL provide a Zapier integration with triggers and actions
2. THE system SHALL provide a Make (Integromat) integration with triggers and actions
3. THE system SHALL expose triggers for: new booking, booking cancelled, new customer, membership purchased, membership cancelled, payment received, check-in completed
4. THE system SHALL expose actions for: create booking, create customer, add tag to customer, send notification
5. THE system SHALL authenticate via API key or OAuth2
6. THE system SHALL provide clear documentation and examples for each trigger/action
7. THE system SHALL handle webhooks from Zapier/Make reliably (acknowledge receipt, retry on failure)

### Requirement 8: Outbound Webhooks

**User Story:** As a developer, I want to receive webhook notifications when events occur in the platform, so that I can build custom integrations.

#### Acceptance Criteria

1. THE system SHALL support configuring Webhook_Subscriptions per Tenant
2. THE system SHALL support subscribing to event types: booking.created, booking.cancelled, booking.completed, booking.no_show, customer.created, customer.updated, membership.purchased, membership.cancelled, membership.renewed, payment.completed, payment.refunded, checkin.completed
3. THE system SHALL deliver webhooks as HTTP POST with JSON payload to the configured URL
4. THE system SHALL include a signature header (HMAC-SHA256) for payload verification
5. THE system SHALL retry failed deliveries with exponential backoff (retry at 1 min, 5 min, 30 min, 2 hours)
6. THE system SHALL log all webhook deliveries with status (success, failed, retrying)
7. THE system SHALL support disabling a webhook after repeated failures (configurable threshold)
8. THE system SHALL provide a webhook delivery log viewable in the admin UI
9. THE system SHALL support testing a webhook (send a test payload to verify endpoint)

### Requirement 9: Inbound API and API Keys

**User Story:** As a developer, I want to access the platform's API with an API key, so that I can build custom integrations for my business.

#### Acceptance Criteria

1. THE system SHALL support generating API keys per Tenant
2. THE system SHALL support multiple API keys per Tenant (e.g., one per integration)
3. THE system SHALL support API key scopes (restrict to read-only, specific resources, etc.)
4. THE system SHALL enforce Rate_Limits per API key (configurable, default: 1000 requests/hour)
5. THE system SHALL return HTTP 429 with Retry-After header when rate limit is exceeded
6. THE system SHALL support revoking an API key immediately
7. THE system SHALL log all API key usage for auditing
8. THE system SHALL never display the full API key after creation (show only prefix for identification)
9. THE system SHALL authenticate API key requests via `Authorization: Bearer <key>` header

### Requirement 10: Integration Marketplace

**User Story:** As a business owner, I want to browse and enable integrations from a marketplace, so that I can connect my tools without technical setup.

#### Acceptance Criteria

1. THE system SHALL provide an Integration_Marketplace in the admin UI
2. THE marketplace SHALL display available integrations with: name, logo, description, category (calendar, marketing, messaging, accounting, automation), connection status (connected, disconnected, error)
3. THE system SHALL allow Tenants to enable/disable integrations independently
4. THE system SHALL provide a guided setup flow per integration (OAuth authorization, API key entry, configuration options)
5. THE system SHALL display integration health (last sync time, error count, status)
6. THE system SHALL support disconnecting an integration (revokes OAuth tokens, stops syncing)
7. THE system SHALL support viewing sync logs per integration (recent operations, errors)

### Requirement 11: Sync Error Handling and Monitoring

**User Story:** As a business owner, I want to know when an integration is failing, so that I can fix the issue before it impacts my operations.

#### Acceptance Criteria

1. THE system SHALL detect and log all sync failures with error details
2. THE system SHALL retry failed sync operations with exponential backoff
3. THE system SHALL alert the Tenant admin when an integration has persistent failures (e.g., 3+ consecutive failures)
4. THE system SHALL pause a failing integration after a configurable failure threshold (prevent runaway retries)
5. THE system SHALL provide a sync error dashboard showing: failed operations, last successful sync, error messages
6. THE system SHALL support manually triggering a re-sync for failed operations
7. THE system SHALL handle OAuth token expiration by prompting re-authorization (not failing silently)

---

## Dependencies

- Phase 00: Infrastructure - Database, API
- Phase 02: Security & Compliance - RBAC (who can manage integrations), audit logging, encryption (OAuth tokens)
- Phase 03: Core Platform - Tenant context, configuration engine, API infrastructure
- Phase 05: Customer Management - Customer data for marketing sync
- Phase 07: Booking Engine - Booking events for calendar sync and webhooks
- Phase 08: Membership Engine - Membership events for webhooks
- Phase 10: Payment Platform - Payment/invoice data for accounting sync
- Phase 11: Accounts Payable - Financial data for accounting sync
- Phase 12: Staff Management - Staff data for calendar sync
- Phase 16: Marketing & Automation - WhatsApp as a messaging channel in sequences

## Success Criteria

- Google Calendar and Outlook sync bookings bidirectionally within 5 minutes
- iCal feeds update correctly and are subscribable from any calendar app
- Marketing platforms receive customer data and respect unsubscribes
- WhatsApp messages deliver with template compliance
- Accounting sync creates invoices/payments without duplicates
- Zapier/Make triggers fire for all configured events
- Outbound webhooks deliver reliably with retry and signature verification
- API keys enforce rate limits and scoping correctly
- Integration marketplace allows self-service setup per tenant
- Sync errors are detected, retried, and surfaced to admins
- All integration data and tokens are strictly tenant-scoped

## Out of Scope

- Building a public developer portal (API docs site) - Future; Swagger UI suffices initially
- Custom integration development per tenant - Platform provides hooks; custom work is services
- Real-time bidirectional database sync (CDC) - Overkill for this stage
- Social media integrations (Instagram, Facebook posting) - Out of platform scope
- ERP integrations (SAP, Oracle) - Enterprise-only, future phase
- SMS provider integration - Phase 16 handles this as a message channel

## Notes

- All third-party services are evaluated per THIRD_PARTY_SERVICES.md — nothing is pre-selected
- OAuth token storage must be encrypted at rest (sensitive credentials)
- Calendar sync is the most requested integration for wellness businesses (staff need one calendar view)
- Zapier/Make connectors require publishing to their marketplace (separate process with review)
- WhatsApp Business API requires business verification and template pre-approval
- Webhook reliability is critical — use a background queue (Bull/BullMQ) for delivery with retry
- Integration tokens should be stored per-tenant and never exposed in API responses
- Consider a unified sync engine that handles scheduling, retry, and logging for all integrations

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 10, Phase 11, Phase 12, Phase 16
**Next Phase**: Phase 21 (AI Features)
