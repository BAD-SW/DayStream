# Phase 20: Integrations

## Status: 🔲 Not Started

## Objective
Connect the platform with third-party services — calendars, marketing tools, messaging, and automation platforms.

## Dependencies
- Phase 03: Core Platform (API-first architecture)

## Scope Summary
- Calendar sync:
  - Google Calendar (two-way)
  - Outlook/Office 365 (two-way)
  - Apple Calendar (iCal feed)
- Marketing integrations:
  - Mailchimp
  - Klaviyo
- Automation:
  - Zapier connector
  - Make (Integromat)
- Messaging:
  - WhatsApp Business API
  - SMS providers
- Accounting:
  - Xero
  - QuickBooks
- Webhooks (outbound event notifications)
- API keys and developer portal
- OAuth2 for third-party auth
- Rate limiting and usage tracking
- Integration marketplace (tenant enables/disables per integration)

## Key Decisions Pending
- Integration architecture (direct vs. middleware like Merge.dev)
- Webhook delivery guarantees (at-least-once, retry strategy)
- Developer portal scope (public API docs, sandbox)
- WhatsApp Business API provider

---

*Requirements, design, and tasks to be detailed during spec planning.*
