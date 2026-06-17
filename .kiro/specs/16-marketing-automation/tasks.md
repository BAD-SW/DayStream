# Phase 16: Marketing & Automation - Tasks

## Overview

Implementation tasks for the marketing and automation module â€” database schema, campaigns (email/SMS/push), automated sequences with visual builder, template system, campaign analytics, consent management, lead funnels, provider abstraction, and frontend.

## Task Status Legend

- âœ… **Complete**: Task is finished and verified
- ðŸŸ¡ **In Progress**: Task is currently being worked on
- ðŸ“‹ **Planned**: Task is defined but not started
- â¸ï¸ **Blocked**: Task is waiting on dependencies
- âŒ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `campaigns` table
- [x] ✅ Create migration for `campaign_recipients` table
- [x] ✅ Create migration for `message_templates` table
- [x] ✅ Create migration for `sequences` table
- [x] ✅ Create migration for `sequence_steps` table
- [x] ✅ Create migration for `sequence_connections` table
- [x] ✅ Create migration for `sequence_enrollments` table
- [x] ✅ Create migration for `sequence_history` table
- [x] ✅ Create migration for `communication_preferences` table
- [x] ✅ Create migration for `lead_funnels` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, status, customer, campaign)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Provider Abstraction

### 2.1 Adapter Interfaces
- [x] ✅ Define `MessageAdapter` interface (sendEmail, sendBulkEmail, getDeliveryStatus, handleWebhook)
- [x] ✅ Define `SmsAdapter` interface (sendSms, sendBulkSms, getDeliveryStatus, handleWebhook)
- [x] ✅ Implement mock email adapter (logs to console/DB, no actual send)
- [x] ✅ Implement mock SMS adapter
- [x] ✅ Create adapter factory (returns configured adapter per tenant)
- [x] ✅ Write tests

---

## 3. Message Templates

### 3.1 Template Service
- [x] ✅ Create `marketing-templates.service.ts`
- [x] ✅ Support CRUD for templates (email, SMS, push)
- [x] ✅ Support block-based content storage (JSONB)
- [x] ✅ Implement block-to-HTML renderer
- [x] ✅ Support dynamic placeholder rendering ({{first_name}}, etc.)
- [x] ✅ Support template preview with sample data
- [x] ✅ Seed pre-built templates (promotion, newsletter, booking confirmation)
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `GET /api/v1/marketing/templates` endpoint
- [x] ✅ Create `POST /api/v1/marketing/templates` endpoint
- [x] ✅ Create `GET /api/v1/marketing/templates/:id` endpoint
- [x] ✅ Create `PUT /api/v1/marketing/templates/:id` endpoint
- [x] ✅ Create `POST /api/v1/marketing/templates/:id/preview` endpoint
- [x] ✅ Create `DELETE /api/v1/marketing/templates/:id` endpoint

---

## 4. Email Campaigns

### 4.1 Campaign Service
- [x] ✅ Create `marketing-campaigns.service.ts`
- [x] ✅ Support campaign CRUD (email, SMS, push channels)
- [x] ✅ Resolve segment â†’ recipient list (excluding unsubscribed)
- [x] ✅ Render personalized content per recipient
- [x] ✅ Support A/B testing on subject lines
- [x] ✅ Support scheduling campaigns
- [x] ✅ Support test sends to specific addresses
- [x] ✅ Send via MessageAdapter in throttled batches
- [x] ✅ Create campaign_recipients records on send
- [x] ✅ Write tests

### 4.2 Routes
- [x] ✅ Create `GET /api/v1/marketing/campaigns` endpoint
- [x] ✅ Create `POST /api/v1/marketing/campaigns` endpoint
- [x] ✅ Create `GET /api/v1/marketing/campaigns/:id` endpoint
- [x] ✅ Create `PUT /api/v1/marketing/campaigns/:id` endpoint
- [x] ✅ Create `POST /api/v1/marketing/campaigns/:id/schedule` endpoint
- [x] ✅ Create `POST /api/v1/marketing/campaigns/:id/send` endpoint
- [x] ✅ Create `POST /api/v1/marketing/campaigns/:id/test` endpoint

---

## 5. SMS Campaigns

### 5.1 SMS Logic
- [x] ✅ Support SMS campaign creation with character count validation
- [x] ✅ Enforce SMS segment calculation (160-char limit)
- [x] ✅ Respect SMS opt-in status
- [x] ✅ Enforce quiet hours per jurisdiction (configurable)
- [x] ✅ Send via SmsAdapter
- [x] ✅ Write tests

---

## 6. Push Notifications

### 6.1 Push Logic
- [x] ✅ Support push notification campaigns (title, body, deep link)
- [x] ✅ Respect push opt-in status
- [x] ✅ Track delivery and open rates
- [x] ✅ Placeholder for mobile integration (Phase 19)
- [x] ✅ Write tests

---

## 7. Automated Sequences (Journey Builder)

### 7.1 Sequence Service
- [x] ✅ Create `marketing-sequences.service.ts`
- [x] ✅ Support sequence CRUD (with canvas_data JSONB)
- [x] ✅ Support activation, pausing, archiving lifecycle
- [x] ✅ Support validation (all paths reach End, trigger defined)
- [x] ✅ Support cloning/duplicating sequences
- [x] ✅ Store steps and connections as separate rows
- [x] ✅ Write tests

### 7.2 Sequence Engine
- [x] ✅ Create `sequence-engine.service.ts`
- [x] ✅ Implement scheduled job (every 5 min)
- [x] ✅ Evaluate entry triggers against recent events
- [x] ✅ Advance enrolled customers through steps
- [x] ✅ Execute Wait steps (check elapsed duration)
- [x] ✅ Execute Condition steps (evaluate customer attributes)
- [x] ✅ Execute Split steps (random percentage assignment)
- [x] ✅ Execute Output steps (send email, add tag, etc.)
- [x] ✅ Handle End nodes (mark completed)
- [x] ✅ Evaluate exit conditions
- [x] ✅ Prevent duplicate enrollment (unless allow_reentry)
- [x] ✅ Log all step executions to sequence_history
- [x] ✅ Write tests

### 7.3 Event Bus
- [x] ✅ Implement internal event publishing system
- [x] ✅ Publish events from booking, membership, customer services
- [x] ✅ Sequence engine subscribes to relevant trigger events
- [x] ✅ Write tests

### 7.4 Pre-Built Templates
- [x] ✅ Create Welcome Series template
- [x] ✅ Create Re-engagement template (30-day inactivity)
- [x] ✅ Create Membership Renewal template
- [x] ✅ Create Birthday template
- [x] ✅ Create Post-Visit template
- [x] ✅ Create Win-Back template (90-day churned)
- [x] ✅ Seed templates for new tenants

### 7.5 Routes
- [x] ✅ Create `GET /api/v1/marketing/sequences` endpoint
- [x] ✅ Create `POST /api/v1/marketing/sequences` endpoint
- [x] ✅ Create `GET /api/v1/marketing/sequences/:id` endpoint
- [x] ✅ Create `PUT /api/v1/marketing/sequences/:id` endpoint
- [x] ✅ Create `POST /api/v1/marketing/sequences/:id/activate` endpoint
- [x] ✅ Create `POST /api/v1/marketing/sequences/:id/pause` endpoint
- [x] ✅ Create `POST /api/v1/marketing/sequences/:id/validate` endpoint
- [x] ✅ Create `GET /api/v1/marketing/sequences/:id/enrollments` endpoint
- [x] ✅ Create `GET /api/v1/marketing/sequences/:id/analytics` endpoint
- [x] ✅ Create `GET /api/v1/marketing/sequences/templates` endpoint

---

## 8. Campaign Analytics

### 8.1 Analytics Service
- [x] ✅ Create `marketing-analytics.service.ts`
- [x] ✅ Calculate delivery, open, click, bounce, unsubscribe rates per campaign
- [x] ✅ Track individual link clicks
- [x] ✅ Support A/B test winner determination
- [x] ✅ Calculate revenue attribution (bookings within 48h of interaction)
- [x] ✅ Report engagement timeline (opens/clicks over time)
- [x] ✅ Compare across campaigns (trending)
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/marketing/campaigns/:id/analytics` endpoint
- [x] ✅ Create `GET /api/v1/marketing/campaigns/:id/recipients` endpoint

---

## 9. Consent Management

### 9.1 Consent Service
- [x] ✅ Create `marketing-consent.service.ts`
- [x] ✅ Support per-channel, per-category opt-in/opt-out
- [x] ✅ Process one-click unsubscribe (from email link)
- [x] ✅ Process SMS opt-out (STOP keyword)
- [x] ✅ Log all preference changes with timestamp and source
- [x] ✅ Default new customers to opted-out for marketing
- [x] ✅ Write tests

### 9.2 Routes
- [x] ✅ Create `GET /api/v1/marketing/preferences/:customerId` endpoint
- [x] ✅ Create `PUT /api/v1/marketing/preferences/:customerId` endpoint
- [x] ✅ Create `POST /api/v1/marketing/unsubscribe` endpoint (public, no auth)

---

## 10. Lead Funnels

### 10.1 Funnel Service
- [x] ✅ Create `marketing-funnels.service.ts`
- [x] ✅ Support funnel CRUD (name, slug, headline, form fields, CTA)
- [x] ✅ Render public landing page (no auth required)
- [x] ✅ Process form submissions â†’ create customer (status=lead)
- [x] ✅ Auto-tag and auto-enroll in sequence on capture
- [x] ✅ Track page views and submissions
- [x] ✅ Associate discount codes with funnels
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `GET /api/v1/marketing/funnels` endpoint
- [x] ✅ Create `POST /api/v1/marketing/funnels` endpoint
- [x] ✅ Create `GET /api/v1/marketing/funnels/:slug` endpoint (public)
- [x] ✅ Create `POST /api/v1/marketing/funnels/:slug/submit` endpoint (public)
- [x] ✅ Create `GET /api/v1/marketing/funnels/:id/analytics` endpoint

---

## 11. Provider Webhooks

### 11.1 Webhook Handlers
- [x] ✅ Create `POST /api/v1/marketing/webhooks/email` endpoint
- [x] ✅ Create `POST /api/v1/marketing/webhooks/sms` endpoint
- [x] ✅ Normalize webhook events to common types (delivered, opened, clicked, bounced, complained)
- [x] ✅ Update campaign_recipients status on webhook events
- [x] ✅ Write tests

---

## 12. Frontend

### 12.1 Campaign List Page
- [x] ✅ Create `/marketing/campaigns` page
- [x] ✅ List with status, channel, send date, open rate
- [x] ✅ Filters by channel, status
- [x] ✅ Create button with channel selection

### 12.2 Campaign Editor
- [x] ✅ Create `/marketing/campaigns/:id` editor page
- [x] ✅ Compose: subject, content, segment selection
- [x] ✅ Preview with personalization
- [x] ✅ Schedule or send immediately controls
- [x] ✅ A/B test configuration

### 12.3 Sequence Builder (Visual Canvas)
- [x] ✅ Create `/marketing/sequences/:id` canvas page
- [x] ✅ Integrate React Flow for left-to-right canvas
- [x] ✅ Implement Trigger nodes (green)
- [x] ✅ Implement Action nodes (orange)
- [x] ✅ Implement Output nodes (blue)
- [x] ✅ Implement Start/End nodes
- [x] ✅ Two-level add-step popover (category â†’ type)
- [x] ✅ Step configuration panel (right sidebar)
- [x] ✅ Validate and activate controls
- [x] ✅ Live enrollment counts overlay (when active)
- [x] ✅ Minimap for navigation
- [x] ✅ Auto-layout with grid snapping

### 12.4 Sequence List
- [x] ✅ Create `/marketing/sequences` page
- [x] ✅ List with status, enrollment count
- [x] ✅ Pre-built templates section
- [x] ✅ Activate/pause/duplicate actions

### 12.5 Template Builder
- [x] ✅ Create `/marketing/templates/:id` editor page
- [x] ✅ Block-based drag-and-drop (header, text, image, button, divider, columns, footer)
- [x] ✅ Live preview (desktop/mobile toggle)
- [x] ✅ Template gallery (pre-built designs)

### 12.6 Analytics Dashboard
- [x] ✅ Create `/marketing/analytics` page
- [x] ✅ Campaign performance cards
- [x] ✅ Open/click rate trend charts
- [x] ✅ Top campaigns by engagement
- [x] ✅ Sequence conversion funnels

### 12.7 Preference Center (Customer-Facing)
- [x] ✅ Create `/preferences` public page
- [x] ✅ Channel subscription toggles
- [x] ✅ Category-level opt-in/out
- [x] ✅ Save confirmation

### 12.8 Lead Funnel Pages
- [x] ✅ Create `/f/:slug` public landing page
- [x] ✅ Form rendering from funnel config
- [x] ✅ Submission handling
- [x] ✅ Thank-you confirmation

---

## 13. Testing

### 13.1 Unit Tests
- [x] ✅ Test campaign CRUD and delivery flow (mock adapter)
- [x] ✅ Test personalization rendering (placeholder substitution)
- [x] ✅ Test segment resolution with unsubscribe exclusion
- [x] ✅ Test SMS character counting and segmentation
- [x] ✅ Test sequence CRUD and validation
- [x] ✅ Test sequence engine step advancement (wait, condition, split, output)
- [x] ✅ Test trigger evaluation and enrollment
- [x] ✅ Test consent management (opt-in, opt-out, channel/category)
- [x] ✅ Test lead funnel submission and customer creation
- [x] ✅ Test A/B test splitting and winner determination

### 13.2 Integration Tests
- [x] ✅ Test full campaign flow (create â†’ schedule â†’ send â†’ webhook â†’ analytics)
- [x] ✅ Test full sequence flow (trigger â†’ enroll â†’ advance â†’ output â†’ complete)
- [x] ✅ Test unsubscribe â†’ excluded from next campaign
- [x] ✅ Test lead funnel â†’ customer created â†’ sequence enrolled
- [x] ✅ Test provider webhook handling (status updates)
- [x] ✅ Test tenant scoping (marketing data isolated per tenant)
