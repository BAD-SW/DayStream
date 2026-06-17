# Phase 16: Marketing & Automation - Design Document

**Date**: June 16, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 08

---

## Overview

This document describes the technical design for the DayStream marketing and automation module — email/SMS/push campaigns, automated sequences with a visual flow builder, template system, campaign analytics, consent management, lead funnels, and provider abstraction. The sequence builder uses a left-to-right visual canvas (referencing the Gold Mine journey orchestration pattern) with three node categories: Triggers, Actions, and Outputs.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Visual Sequence Builder](#2-visual-sequence-builder)
3. [Sequence Engine](#3-sequence-engine)
4. [Campaign Delivery](#4-campaign-delivery)
5. [Provider Abstraction](#5-provider-abstraction)
6. [Template System](#6-template-system)
7. [Consent Management](#7-consent-management)
8. [Campaign Analytics](#8-campaign-analytics)
9. [Lead Funnels](#9-lead-funnels)
10. [API Endpoints](#10-api-endpoints)
11. [Frontend Views](#11-frontend-views)

---

## 1. Database Schema

### Campaigns

```sql
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
    segment_id UUID,
    subject VARCHAR(500),
    sender_name VARCHAR(100),
    sender_email VARCHAR(255),
    content TEXT,
    html_content TEXT,
    template_id UUID,
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    ab_test_enabled BOOLEAN NOT NULL DEFAULT false,
    ab_variant_b_subject VARCHAR(500),
    ab_split_percentage INTEGER DEFAULT 50,
    total_recipients INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_status ON campaigns(tenant_id, status);
```

### Campaign Recipients

```sql
CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    email VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'complained', 'unsubscribed')),
    ab_variant VARCHAR(1),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    provider_message_id VARCHAR(200)
);

CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_customer ON campaign_recipients(customer_id);
```

### Message Templates

```sql
CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    subject VARCHAR(500),
    html_content TEXT,
    text_content TEXT,
    blocks JSONB DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT false,
    category VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_templates_tenant ON message_templates(tenant_id);
```

### Automated Sequences

```sql
CREATE TABLE sequences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    canvas_data JSONB NOT NULL DEFAULT '{}',
    allow_reentry BOOLEAN NOT NULL DEFAULT false,
    is_template BOOLEAN NOT NULL DEFAULT false,
    template_category VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ
);

CREATE INDEX idx_sequences_tenant ON sequences(tenant_id);
CREATE INDEX idx_sequences_status ON sequences(tenant_id, status);
```

### Sequence Steps (Canvas Nodes)

```sql
CREATE TABLE sequence_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    step_category VARCHAR(20) NOT NULL
        CHECK (step_category IN ('trigger', 'action', 'output', 'start', 'end')),
    step_type VARCHAR(30) NOT NULL,
    label VARCHAR(200),
    config JSONB NOT NULL DEFAULT '{}',
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequence_steps_sequence ON sequence_steps(sequence_id);
```

### Sequence Connections

```sql
CREATE TABLE sequence_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    source_step_id UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
    target_step_id UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
    label VARCHAR(100),
    sort_order INTEGER DEFAULT 0
);
```

### Sequence Enrollments (Customer State)

```sql
CREATE TABLE sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    current_step_id UUID REFERENCES sequence_steps(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'exited', 'paused')),
    context JSONB DEFAULT '{}',
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    step_entered_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    exit_reason VARCHAR(200),
    UNIQUE(sequence_id, customer_id)
);

CREATE INDEX idx_sequence_enrollments_sequence ON sequence_enrollments(sequence_id);
CREATE INDEX idx_sequence_enrollments_customer ON sequence_enrollments(customer_id);
```

### Sequence Execution History

```sql
CREATE TABLE sequence_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    step_id UUID NOT NULL REFERENCES sequence_steps(id),
    action VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequence_history_sequence ON sequence_history(sequence_id);
```

### Consent/Subscription Preferences

```sql
CREATE TABLE communication_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    category VARCHAR(50) NOT NULL DEFAULT 'marketing',
    opted_in BOOLEAN NOT NULL DEFAULT false,
    opted_in_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    source VARCHAR(50),
    UNIQUE(tenant_id, customer_id, channel, category)
);

CREATE INDEX idx_comm_prefs_customer ON communication_preferences(customer_id);
```

### Lead Funnels

```sql
CREATE TABLE lead_funnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    headline VARCHAR(300),
    description TEXT,
    image_path TEXT,
    form_fields JSONB DEFAULT '[]',
    cta_text VARCHAR(100) DEFAULT 'Sign Up',
    discount_code VARCHAR(50),
    sequence_id UUID REFERENCES sequences(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    page_views INTEGER NOT NULL DEFAULT 0,
    submissions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_lead_funnels_tenant ON lead_funnels(tenant_id);
```

---

## 2. Visual Sequence Builder

### Canvas Architecture (Left-to-Right Flow)

The sequence builder uses a visual canvas (React Flow) with left-to-right flow direction:

```
SequenceBuilderPage
  ├── SequenceToolbar (save, activate, validate, zoom)
  ├── SequenceCanvas (main area, left-to-right)
  │     ├── ConnectionLayer (bezier curves between nodes)
  │     └── StepNodes (positioned on canvas)
  │           ├── CategoryBadge (Trigger/Action/Output color)
  │           ├── StepIcon + StepLabel
  │           ├── EnrollmentCount (when active)
  │           └── AddButton ('+' to add next step)
  ├── AddStepPopover (two-level: category → type)
  ├── StepConfigPanel (right sidebar for selected step config)
  └── MiniMap (bottom-right)
```

### Node Categories

| Category | Color | Description |
|----------|-------|-------------|
| **Trigger** | Green `#2E7D32` | Entry conditions — what starts the sequence |
| **Action** | Orange `#E65100` | Logic and flow — conditions, waits, splits |
| **Output** | Blue `#1565C0` | Delivery — send email, SMS, push, apply tag |
| **Start** | Green | Single entry point |
| **End** | Red `#C62828` | Exit points |

### Trigger Step Types

| Type | Description |
|------|-------------|
| customer_registered | New customer created |
| booking_completed | First or any booking completed |
| membership_purchased | Membership plan activated |
| membership_expiring | X days before expiry |
| membership_cancelled | Membership cancelled |
| inactivity | No visit in X days |
| birthday | X days before birthday |
| booking_cancelled | Customer cancelled booking |
| event_registered | Registered for an event |
| tag_added | Specific tag applied |
| segment_entered | Customer enters a segment |

### Action Step Types

| Type | Description |
|------|-------------|
| wait | Pause for X hours/days/weeks |
| condition | If/else branch on customer attribute |
| split | A/B percentage split |
| exit_condition | Exit sequence if condition met |

### Output Step Types

| Type | Description |
|------|-------------|
| send_email | Send email using a template |
| send_sms | Send SMS message |
| send_push | Send push notification |
| add_tag | Apply a tag to customer |
| remove_tag | Remove a tag from customer |
| update_lifecycle | Change lifecycle stage |
| create_task | Create a follow-up task for staff |

---

## 3. Sequence Engine

### Execution Model

Runs as a scheduled job (every 5 minutes):

```
For each active sequence:
  1. Entry Evaluation:
     - Check trigger conditions against recent events
     - Enroll matching customers (if not already enrolled and reentry allows)

  2. Step Advancement (for each enrolled customer):
     - If current step is Wait: check if duration elapsed → advance
     - If current step is Condition: evaluate → route to Yes/No branch
     - If current step is Split: assign random branch
     - If current step is Output: execute (send email, add tag, etc.) → advance
     - If current step is End: mark enrollment as completed

  3. Exit Evaluation:
     - Check exit conditions for enrolled customers
     - Remove customers who meet exit criteria
```

### Event Bus

Internal event publishing for triggers:
- Booking service publishes `booking.completed`, `booking.cancelled`
- Membership service publishes `membership.purchased`, `membership.expiring`
- Customer service publishes `customer.created`, `customer.tag_added`
- Segment engine publishes `segment.customer_entered`

Sequences subscribe to relevant events and enroll matching customers.

---

## 4. Campaign Delivery

### Email Campaign Flow

```
1. Create campaign (draft) → select segment → compose content → schedule
2. At scheduled time:
   a. Resolve segment → get customer list (exclude unsubscribed)
   b. Create campaign_recipients records (status = pending)
   c. Render personalized content per recipient
   d. Send via MessageAdapter in batches (throttled)
   e. Update recipient status on delivery webhooks
```

### SMS Campaign Flow

Similar, using SmsAdapter. Enforces quiet hours and opt-in checks.

---

## 5. Provider Abstraction

### MessageAdapter Interface

```typescript
interface MessageAdapter {
  sendEmail(to: string, subject: string, html: string, options?: SendOptions): Promise<SendResult>;
  sendBulkEmail(messages: EmailMessage[]): Promise<BulkResult>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  handleWebhook(payload: any): Promise<WebhookEvent[]>;
}

interface SmsAdapter {
  sendSms(to: string, body: string, options?: SmsOptions): Promise<SendResult>;
  sendBulkSms(messages: SmsMessage[]): Promise<BulkResult>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  handleWebhook(payload: any): Promise<WebhookEvent[]>;
}
```

### Mock Adapter (Development)

Logs all sends to console/database. No actual delivery. Enables full testing locally.

---

## 6. Template System

### Block-Based Editor

Templates are composed of blocks stored as JSON:

```json
[
  { "type": "header", "content": { "logo": true, "backgroundColor": "#1a1a1a" } },
  { "type": "text", "content": { "html": "<h1>Hello {{first_name}}</h1>" } },
  { "type": "image", "content": { "src": "...", "alt": "..." } },
  { "type": "button", "content": { "text": "Book Now", "url": "{{booking_url}}" } },
  { "type": "divider" },
  { "type": "footer", "content": { "unsubscribe": true } }
]
```

Rendered to HTML at send time using a block renderer.

---

## 7. Consent Management

- Default: customers are opted OUT of marketing
- Opt-in recorded per channel × category
- Unsubscribe link in every email → immediate opt-out
- SMS opt-out via STOP keyword
- Preference center: customer self-manages subscriptions
- All changes logged with timestamp and source

---

## 8. Campaign Analytics

Tracked per campaign and per recipient:
- **Delivery rate**: delivered / sent
- **Open rate**: opened / delivered (email only, via tracking pixel)
- **Click rate**: clicked / delivered
- **Click-to-open rate**: clicked / opened
- **Bounce rate**: bounced / sent
- **Unsubscribe rate**: unsubscribed / delivered
- **Revenue attribution**: bookings made within 48h of interaction

---

## 9. Lead Funnels

- Simple landing pages (headline, description, image, form, CTA)
- Form submissions create customer records (status = lead)
- Auto-tag and auto-enroll in welcome sequence
- Track: page views, submissions, conversion rate
- Shareable URL per funnel

---

## 10. API Endpoints

### Campaigns

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/marketing/campaigns` | List campaigns |
| POST | `/api/v1/marketing/campaigns` | Create campaign |
| GET | `/api/v1/marketing/campaigns/:id` | Get campaign detail |
| PUT | `/api/v1/marketing/campaigns/:id` | Update campaign |
| POST | `/api/v1/marketing/campaigns/:id/schedule` | Schedule send |
| POST | `/api/v1/marketing/campaigns/:id/send` | Send immediately |
| POST | `/api/v1/marketing/campaigns/:id/test` | Send test |
| GET | `/api/v1/marketing/campaigns/:id/analytics` | Campaign analytics |
| GET | `/api/v1/marketing/campaigns/:id/recipients` | Recipient list |

### Sequences

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/marketing/sequences` | List sequences |
| POST | `/api/v1/marketing/sequences` | Create sequence |
| GET | `/api/v1/marketing/sequences/:id` | Get sequence (with canvas data) |
| PUT | `/api/v1/marketing/sequences/:id` | Update sequence |
| POST | `/api/v1/marketing/sequences/:id/activate` | Activate |
| POST | `/api/v1/marketing/sequences/:id/pause` | Pause |
| POST | `/api/v1/marketing/sequences/:id/validate` | Validate structure |
| GET | `/api/v1/marketing/sequences/:id/enrollments` | Enrolled customers |
| GET | `/api/v1/marketing/sequences/:id/analytics` | Sequence analytics |
| GET | `/api/v1/marketing/sequences/templates` | Pre-built templates |

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/marketing/templates` | List templates |
| POST | `/api/v1/marketing/templates` | Create template |
| GET | `/api/v1/marketing/templates/:id` | Get template |
| PUT | `/api/v1/marketing/templates/:id` | Update template |
| POST | `/api/v1/marketing/templates/:id/preview` | Preview with data |
| DELETE | `/api/v1/marketing/templates/:id` | Delete template |

### Consent

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/marketing/preferences/:customerId` | Get preferences |
| PUT | `/api/v1/marketing/preferences/:customerId` | Update preferences |
| POST | `/api/v1/marketing/unsubscribe` | Process unsubscribe |

### Lead Funnels

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/marketing/funnels` | List funnels |
| POST | `/api/v1/marketing/funnels` | Create funnel |
| GET | `/api/v1/marketing/funnels/:slug` | Public funnel page |
| POST | `/api/v1/marketing/funnels/:slug/submit` | Submit lead form |
| GET | `/api/v1/marketing/funnels/:id/analytics` | Funnel analytics |

### Provider Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/marketing/webhooks/email` | Email provider webhook |
| POST | `/api/v1/marketing/webhooks/sms` | SMS provider webhook |

---

## 11. Frontend Views

### Campaign List (`/marketing/campaigns`)
- List with status, channel, send date, open rate
- Filters by channel, status
- Create button → channel selection

### Campaign Editor (`/marketing/campaigns/:id`)
- Compose: subject, content (template or custom), segment
- Preview with personalization
- Schedule or send immediately
- A/B test configuration

### Sequence Builder (`/marketing/sequences/:id`)
- Visual canvas (React Flow, left-to-right)
- Node palette (Triggers, Actions, Outputs)
- Step config panel (right sidebar)
- Validate and activate controls
- Live enrollment counts (when active)
- Minimap for navigation

### Sequence List (`/marketing/sequences`)
- List with status, enrollment count, template badge
- Pre-built templates section
- Activate/pause/duplicate actions

### Template Builder (`/marketing/templates/:id`)
- Block-based drag-and-drop editor
- Live preview (desktop/mobile toggle)
- Save and reuse
- Template gallery (pre-built designs)

### Analytics Dashboard (`/marketing/analytics`)
- Campaign performance summary
- Open/click rate trends
- Top-performing campaigns
- Sequence conversion funnel

### Preference Center (customer-facing, `/preferences`)
- Channel subscription management
- Category-level opt-in/out
- Clear confirmation feedback

### Lead Funnel Pages (public, `/f/:slug`)
- Landing page display
- Form submission
- Thank you page / redirect

---

**Last Updated**: June 16, 2026
