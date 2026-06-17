# Phase 20: Integrations - Tasks

## Overview

Implementation tasks for the integrations module — database schema, unified sync engine, OAuth2 flows, calendar sync (Google/Outlook/iCal), marketing connectors, WhatsApp, accounting sync, Zapier/Make, outbound webhooks, API keys, and integration marketplace.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `integration_connections` table
- [x] ✅ Create migration for `integration_sync_log` table
- [x] ✅ Create migration for `webhook_subscriptions` table
- [x] ✅ Create migration for `webhook_deliveries` table
- [x] ✅ Create migration for `api_keys` table
- [x] ✅ Create migration for `ical_feeds` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, type, token, retry dates)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Unified Sync Engine

### 2.1 Sync Engine Service
- [x] ✅ Create `integration-sync.service.ts`
- [x] ✅ Implement scheduled sync job (check due connections)
- [x] ✅ Call adapter sync() for each connection
- [x] ✅ Log results to integration_sync_log
- [x] ✅ Implement retry with exponential backoff (1m → 5m → 30m → 2h → pause)
- [x] ✅ Increment error_count on failure, reset on success
- [x] ✅ Pause integration after threshold failures
- [x] ✅ Alert admin on persistent failures
- [x] ✅ Support manual sync trigger
- [x] ✅ Write tests

---

## 3. OAuth2 Connection Framework

### 3.1 OAuth Service
- [x] ✅ Create `integration-oauth.service.ts`
- [x] ✅ Implement initiate connection (generate OAuth URL with state)
- [x] ✅ Implement callback handler (exchange code for tokens)
- [x] ✅ Store encrypted tokens in integration_connections
- [x] ✅ Implement automatic token refresh on expiry
- [x] ✅ Handle re-authorization prompts
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `POST /api/v1/integrations/connect` endpoint
- [x] ✅ Create `GET /api/v1/integrations/callback` endpoint

---

## 4. Google Calendar Sync

### 4.1 Google Calendar Adapter
- [x] ✅ Create `adapters/google-calendar.adapter.ts`
- [x] ✅ Implement connect (OAuth2 with Google)
- [x] ✅ Implement sync: create event on booking confirmed
- [x] ✅ Implement sync: update event on booking rescheduled
- [x] ✅ Implement sync: delete event on booking cancelled
- [x] ✅ Implement inbound: detect external events → availability overrides
- [x] ✅ Handle push notifications (Google webhook for near real-time)
- [x] ✅ Include service, customer, location in event details
- [x] ✅ Write tests

---

## 5. Outlook Calendar Sync

### 5.1 Outlook Calendar Adapter
- [x] ✅ Create `adapters/outlook-calendar.adapter.ts`
- [x] ✅ Implement connect (Microsoft Graph OAuth2)
- [x] ✅ Implement sync: create/update/delete events
- [x] ✅ Implement inbound: detect external events → availability overrides
- [x] ✅ Handle change notifications (Microsoft Graph subscriptions)
- [x] ✅ Support personal and organizational accounts
- [x] ✅ Write tests

---

## 6. iCal Feeds

### 6.1 iCal Service
- [x] ✅ Create `integration-ical.service.ts`
- [x] ✅ Generate unique feed token per staff/customer
- [x] ✅ Build iCalendar VCALENDAR/VEVENT output from bookings
- [x] ✅ Include standard fields (SUMMARY, LOCATION, DTSTART, DTEND, DESCRIPTION)
- [x] ✅ Support token regeneration (revoke old)
- [x] ✅ Serve feed at public URL (no auth, token-based)
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/integrations/ical/staff` endpoint
- [x] ✅ Create `GET /api/v1/integrations/ical/customer` endpoint
- [x] ✅ Create `POST /api/v1/integrations/ical/regenerate` endpoint
- [x] ✅ Create `GET /api/v1/ical/:token` endpoint (public)

---

## 7. Marketing Platform Connectors

### 7.1 Mailchimp Adapter
- [x] ✅ Create `adapters/mailchimp.adapter.ts`
- [x] ✅ Sync customers to Mailchimp audiences
- [x] ✅ Sync tags and segments
- [x] ✅ Handle unsubscribe sync (Mailchimp → DayStream)
- [x] ✅ Write tests

### 7.2 Klaviyo Adapter
- [x] ✅ Create `adapters/klaviyo.adapter.ts`
- [x] ✅ Sync customer profiles
- [x] ✅ Push events (booking completed, membership purchased)
- [x] ✅ Handle unsubscribe sync
- [x] ✅ Write tests

---

## 8. WhatsApp Business API

### 8.1 WhatsApp Adapter
- [x] ✅ Create `adapters/whatsapp.adapter.ts`
- [x] ✅ Send template messages (booking confirmation, reminder)
- [x] ✅ Handle inbound replies (within 24h conversational window)
- [x] ✅ Track delivery status (sent, delivered, read)
- [x] ✅ Respect opt-in for WhatsApp channel
- [x] ✅ Integrate as channel in marketing sequences (Phase 16)
- [x] ✅ Write tests

---

## 9. Accounting Sync

### 9.1 Xero Adapter
- [x] ✅ Create `adapters/xero.adapter.ts`
- [x] ✅ Connect via OAuth2
- [x] ✅ Sync invoices (payment → Xero invoice)
- [x] ✅ Sync payments (mark invoices paid)
- [x] ✅ Sync refunds as credit notes
- [x] ✅ Map chart of accounts (configurable)
- [x] ✅ Prevent duplicate entries
- [x] ✅ Write tests

### 9.2 QuickBooks Adapter
- [x] ✅ Create `adapters/quickbooks.adapter.ts`
- [x] ✅ Connect via OAuth2
- [x] ✅ Sync invoices, payments, refunds
- [x] ✅ Map accounts
- [x] ✅ Prevent duplicates
- [x] ✅ Write tests

---

## 10. Zapier / Make Connectors

### 10.1 Trigger/Action Definitions
- [x] ✅ Define triggers: booking.created, booking.cancelled, customer.created, membership.purchased, payment.received, checkin.completed
- [x] ✅ Define actions: create_booking, create_customer, add_tag
- [x] ✅ Expose trigger endpoints (polling-based for Zapier)
- [x] ✅ Authenticate via API key
- [x] ✅ Document triggers and actions
- [x] ✅ Write tests

---

## 11. Outbound Webhooks

### 11.1 Webhook Service
- [x] ✅ Create `integration-webhooks.service.ts`
- [x] ✅ Support subscription CRUD (URL, events, secret)
- [x] ✅ Implement delivery: POST payload with HMAC-SHA256 signature
- [x] ✅ Implement retry with exponential backoff
- [x] ✅ Log all deliveries (status, response, attempts)
- [x] ✅ Disable subscription after threshold failures
- [x] ✅ Support test delivery (send sample payload)
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `GET /api/v1/integrations/webhooks` endpoint
- [x] ✅ Create `POST /api/v1/integrations/webhooks` endpoint
- [x] ✅ Create `PUT /api/v1/integrations/webhooks/:id` endpoint
- [x] ✅ Create `DELETE /api/v1/integrations/webhooks/:id` endpoint
- [x] ✅ Create `POST /api/v1/integrations/webhooks/:id/test` endpoint
- [x] ✅ Create `GET /api/v1/integrations/webhooks/:id/deliveries` endpoint

---

## 12. API Keys

### 12.1 API Key Service
- [x] ✅ Create `integration-apikeys.service.ts`
- [x] ✅ Generate keys (format: `dsk_live_` + 32 random chars)
- [x] ✅ Store hash only (never store raw key)
- [x] ✅ Support scopes (resource:action permissions)
- [x] ✅ Implement rate limiting (per key, default 1000/hour)
- [x] ✅ Return 429 + Retry-After on limit exceeded
- [x] ✅ Support revocation
- [x] ✅ Log usage for auditing
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/integrations/api-keys` endpoint
- [x] ✅ Create `POST /api/v1/integrations/api-keys` endpoint
- [x] ✅ Create `DELETE /api/v1/integrations/api-keys/:id` endpoint

### 12.3 API Key Authentication Middleware
- [x] ✅ Create middleware to authenticate requests by API key
- [x] ✅ Validate key hash, check scopes, enforce rate limit
- [x] ✅ Apply as alternative to JWT auth on API routes

---

## 13. Integration Marketplace

### 13.1 Marketplace Service
- [x] ✅ Create `integration-marketplace.service.ts`
- [x] ✅ Define available integrations catalog (static config)
- [x] ✅ Return integration list with connection status per tenant
- [x] ✅ Support category filtering (calendar, marketing, messaging, accounting, automation)
- [x] ✅ Write tests

### 13.2 Routes
- [x] ✅ Create `GET /api/v1/integrations/marketplace` endpoint
- [x] ✅ Create `GET /api/v1/integrations` endpoint (tenant's connections)
- [x] ✅ Create `DELETE /api/v1/integrations/:id` endpoint (disconnect)
- [x] ✅ Create `GET /api/v1/integrations/:id/logs` endpoint
- [x] ✅ Create `POST /api/v1/integrations/:id/sync` endpoint (manual trigger)

---

## 14. Frontend

### 14.1 Integration Marketplace Page
- [x] ✅ Create `/integrations` page with card grid
- [x] ✅ Category tabs (Calendar, Marketing, Messaging, Accounting, Automation)
- [x] ✅ Connection status badges
- [x] ✅ "Connect" buttons → OAuth flow or config modal

### 14.2 Integration Detail
- [x] ✅ Create `/integrations/:type` page
- [x] ✅ Health status, last sync, error count
- [x] ✅ Configuration options
- [x] ✅ Sync log table
- [x] ✅ Manual sync button
- [x] ✅ Disconnect button

### 14.3 Webhooks Page
- [x] ✅ Create `/integrations/webhooks` page
- [x] ✅ Subscription list with event types
- [x] ✅ Create/edit modal
- [x] ✅ Test button
- [x] ✅ Delivery log

### 14.4 API Keys Page
- [x] ✅ Create `/integrations/api-keys` page
- [x] ✅ Key list (name, prefix, scopes, last used)
- [x] ✅ Create modal with scopes selector
- [x] ✅ Show full key once (copy button)
- [x] ✅ Revoke button

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test sync engine (retry logic, error threshold, pause)
- [x] ✅ Test OAuth2 flow (connect, callback, token refresh)
- [x] ✅ Test webhook delivery (payload signing, retry, disable)
- [x] ✅ Test API key generation (hash, scopes, rate limit)
- [x] ✅ Test iCal feed generation (VCALENDAR format)
- [x] ✅ Test marketplace catalog with connection status

### 15.2 Integration Tests
- [x] ✅ Test full OAuth connection → sync → log flow
- [x] ✅ Test webhook subscription → event trigger → delivery → retry
- [x] ✅ Test API key authentication → rate limiting → 429 response
- [x] ✅ Test iCal feed subscription (valid token → events, invalid → 404)
- [x] ✅ Test disconnect (revokes tokens, stops sync)
- [x] ✅ Test tenant scoping (integration data isolated)
