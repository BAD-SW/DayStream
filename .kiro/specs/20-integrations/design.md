# Phase 20: Integrations - Design Document

**Date**: June 17, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 08, Phase 10–12, Phase 16

---

## Overview

This document describes the technical design for the DayStream integrations module — third-party calendar sync, marketing platform connectors, WhatsApp messaging, accounting sync, Zapier/Make automation, outbound webhooks, inbound API keys, and the integration marketplace. All integrations are optional per tenant, built behind adapter interfaces, and use a unified sync engine for reliability.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Unified Sync Engine](#2-unified-sync-engine)
3. [OAuth2 Connection Flow](#3-oauth2-connection-flow)
4. [Calendar Sync](#4-calendar-sync)
5. [Outbound Webhooks](#5-outbound-webhooks)
6. [API Keys](#6-api-keys)
7. [Integration Adapter Pattern](#7-integration-adapter-pattern)
8. [API Endpoints](#8-api-endpoints)
9. [Frontend Views](#9-frontend-views)

---

## 1. Database Schema

### Integration Connections

```sql
CREATE TABLE integration_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    integration_type VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'disconnected', 'error', 'expired')),
    config JSONB DEFAULT '{}',
    oauth_access_token TEXT,
    oauth_refresh_token TEXT,
    oauth_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_connections_tenant ON integration_connections(tenant_id);
CREATE INDEX idx_integration_connections_type ON integration_connections(tenant_id, integration_type);
```

### Sync Log

```sql
CREATE TABLE integration_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    operation VARCHAR(30) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    resource_type VARCHAR(50),
    resource_id UUID,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'retrying')),
    error_message TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_log_connection ON integration_sync_log(connection_id);
CREATE INDEX idx_sync_log_date ON integration_sync_log(created_at);
```

### Webhook Subscriptions

```sql
CREATE TABLE webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(200) NOT NULL,
    event_types JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_delivery_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_subs_tenant ON webhook_subscriptions(tenant_id);
```

### Webhook Delivery Log

```sql
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE status = 'retrying';
```

### API Keys

```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(200) NOT NULL,
    key_prefix VARCHAR(10) NOT NULL,
    scopes JSONB DEFAULT '["*"]',
    rate_limit INTEGER NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
```

### iCal Feeds

```sql
CREATE TABLE ical_feeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    customer_id UUID REFERENCES customers(id),
    feed_token VARCHAR(100) NOT NULL UNIQUE,
    feed_type VARCHAR(20) NOT NULL CHECK (feed_type IN ('staff', 'customer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ical_feeds_token ON ical_feeds(feed_token);
```

---

## 2. Unified Sync Engine

All integrations use a common sync infrastructure:

```
Sync Engine:
  1. Scheduled job runs every 5 minutes
  2. For each active integration_connection:
     a. Check if sync is due (based on config frequency)
     b. Call the adapter's sync() method
     c. Log results to integration_sync_log
     d. On failure: increment error_count, schedule retry
     e. On success: reset error_count, update last_sync_at
  3. After threshold failures: set status = 'error', alert admin
```

Retry strategy: 1 min → 5 min → 30 min → 2 hours → pause.

---

## 3. OAuth2 Connection Flow

```
Tenant clicks "Connect" in Integration Marketplace
    ↓
Redirect to provider's OAuth2 authorization page
    ↓
User authorizes → provider redirects back with auth code
    ↓
DayStream exchanges code for access_token + refresh_token
    ↓
Store encrypted tokens in integration_connections
    ↓
Connection status = 'connected', initial sync triggered
```

Token refresh handled automatically when access_token expires.

---

## 4. Calendar Sync

### Google Calendar
- Uses Google Calendar API v3
- Push notifications (webhooks) for near real-time sync
- Creates/updates/deletes VEVENT objects
- Maps: booking → calendar event, external event → availability override

### Outlook
- Uses Microsoft Graph API
- Subscription notifications for changes
- Same mapping as Google

### Conflict Resolution
- Bookings: DayStream is source of truth (external changes don't modify bookings)
- Availability: External calendar events block staff availability in DayStream

---

## 5. Outbound Webhooks

### Delivery Flow

```
Platform event occurs (e.g., booking.created)
    ↓
Find all active webhook_subscriptions for this tenant + event_type
    ↓
For each subscription:
  1. Build payload (event_type, timestamp, data)
  2. Sign payload (HMAC-SHA256 with subscription.secret)
  3. POST to subscription.url with signature header
  4. If 2xx → status = 'sent'
  5. If error → status = 'retrying', schedule retry
```

### Payload Format

```json
{
  "event": "booking.created",
  "timestamp": "2026-06-17T10:00:00Z",
  "data": { "id": "...", "customer_id": "...", "service_id": "...", "start_time": "..." },
  "webhook_id": "...",
  "tenant_id": "..."
}
```

---

## 6. API Keys

- Key format: `dsk_live_` + 32 random characters
- Only the hash is stored; full key shown once at creation
- Prefix stored for identification (`dsk_live_abc...`)
- Authentication: `Authorization: Bearer dsk_live_...`
- Rate limiting per key (default 1000/hour, configurable)
- Scopes: `["bookings:read", "customers:*"]` or `["*"]` for full access

---

## 7. Integration Adapter Pattern

```typescript
interface IntegrationAdapter {
  connect(connection: Connection, authCode: string): Promise<void>;
  disconnect(connection: Connection): Promise<void>;
  sync(connection: Connection): Promise<SyncResult>;
  handleWebhook(connection: Connection, payload: any): Promise<void>;
}
```

Each provider implements this interface. The sync engine calls adapters generically.

---

## 8. API Endpoints

### Connections

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/integrations` | List all connections |
| POST | `/api/v1/integrations/connect` | Initiate OAuth/connect |
| GET | `/api/v1/integrations/callback` | OAuth callback |
| DELETE | `/api/v1/integrations/:id` | Disconnect |
| GET | `/api/v1/integrations/:id/logs` | Sync log |
| POST | `/api/v1/integrations/:id/sync` | Trigger manual sync |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/integrations/webhooks` | List subscriptions |
| POST | `/api/v1/integrations/webhooks` | Create subscription |
| PUT | `/api/v1/integrations/webhooks/:id` | Update subscription |
| DELETE | `/api/v1/integrations/webhooks/:id` | Delete subscription |
| POST | `/api/v1/integrations/webhooks/:id/test` | Send test payload |
| GET | `/api/v1/integrations/webhooks/:id/deliveries` | Delivery log |

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/integrations/api-keys` | List keys (prefix only) |
| POST | `/api/v1/integrations/api-keys` | Create key (returns full key once) |
| DELETE | `/api/v1/integrations/api-keys/:id` | Revoke key |

### iCal Feeds

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/integrations/ical/staff` | Get/generate staff feed URL |
| GET | `/api/v1/integrations/ical/customer` | Get/generate customer feed URL |
| POST | `/api/v1/integrations/ical/regenerate` | Regenerate feed token |
| GET | `/api/v1/ical/:token` | Public iCal feed (no auth) |

### Marketplace

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/integrations/marketplace` | Available integrations catalog |

---

## 9. Frontend Views

### Integration Marketplace (`/integrations`)
- Card grid of available integrations (grouped by category)
- Connection status badge per integration
- "Connect" button → OAuth flow or config modal

### Integration Detail (`/integrations/:type`)
- Connection status and health
- Configuration options
- Sync log (recent operations, errors)
- Manual sync trigger
- Disconnect button

### Webhooks (`/integrations/webhooks`)
- Subscription list with event types and status
- Create/edit modal (URL, events, secret)
- Test button
- Delivery log per subscription

### API Keys (`/integrations/api-keys`)
- Key list (name, prefix, scopes, last used)
- Create modal (name, scopes)
- Full key shown once on creation (copy button)
- Revoke button

---

**Last Updated**: June 17, 2026
