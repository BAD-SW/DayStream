# Phase 16: Marketing & Automation - Requirements

## Overview

This phase builds marketing tools for customer engagement — email campaigns, SMS messaging, push notifications, and automated sequences triggered by customer behavior. The marketing system leverages customer segmentation (Phase 05) to target the right customers with the right message at the right time. Automated workflows reduce manual effort while improving retention and re-engagement.

## Goals

- Build email campaign creation, targeting, and delivery
- Build SMS campaign support
- Implement automated sequences triggered by customer events
- Integrate with customer segmentation for precise targeting
- Build a template system for emails and SMS
- Support campaign scheduling and throttling
- Provide campaign analytics (delivery, opens, clicks, conversions)
- Implement unsubscribe and consent management
- Support lead funnels (landing pages → conversion tracking)

## Glossary

- **Campaign**: A one-time targeted message sent to a customer segment (email, SMS, or push)
- **Sequence**: An automated multi-step workflow triggered by a customer event (also called "automation" or "drip")
- **Trigger**: A customer event that initiates a Sequence (e.g., new member, no visit in 30 days, birthday)
- **Template**: A reusable message design with dynamic content placeholders
- **Segment**: A dynamic customer group defined by filter criteria (from Phase 05)
- **Channel**: The delivery mechanism for a message (email, SMS, push notification)
- **Delivery_Status**: The outcome of a message send attempt (sent, delivered, bounced, failed)
- **Engagement_Metric**: A tracked customer interaction (open, click, conversion)
- **Unsubscribe**: A customer's opt-out from a communication channel or category
- **Lead_Funnel**: A landing page or form designed to capture prospective customer information

## Requirements

### Requirement 1: Email Campaigns

**User Story:** As a business owner, I want to send targeted emails to customer segments, so that I can communicate promotions, news, and updates effectively.

#### Acceptance Criteria

1. THE system SHALL support creating email campaigns with: subject line, sender name, sender email, template/content (HTML), target segment, scheduled send time (or immediate)
2. THE system SHALL support A/B testing on subject lines (split audience, compare open rates)
3. THE system SHALL support dynamic content placeholders: {{first_name}}, {{last_name}}, {{membership_type}}, {{credits_remaining}}, {{next_booking}}, and custom fields
4. THE system SHALL render personalized content per recipient before sending
5. THE system SHALL support scheduling campaigns for a future date/time
6. THE system SHALL support sending a test email to a specified address before launching
7. THE system SHALL respect customer communication preferences (opted-out customers are excluded)
8. THE system SHALL track Delivery_Status per recipient: sent, delivered, opened, clicked, bounced, complained
9. THE system SHALL throttle sending to comply with provider rate limits
10. THE system SHALL store all campaigns scoped to the current Tenant

### Requirement 2: SMS Campaigns

**User Story:** As a business owner, I want to send SMS messages to customers, so that I can reach them with time-sensitive offers and reminders.

#### Acceptance Criteria

1. THE system SHALL support creating SMS campaigns with: message body, target segment, scheduled send time
2. THE system SHALL support dynamic content placeholders in SMS messages
3. THE system SHALL enforce SMS character limits (160 characters for single SMS, or segment for longer)
4. THE system SHALL display character count and segment count during composition
5. THE system SHALL respect customer SMS opt-in status (only send to opted-in customers)
6. THE system SHALL track Delivery_Status per recipient: sent, delivered, failed
7. THE system SHALL comply with SMS regulations (include opt-out instructions, respect quiet hours)
8. THE system SHALL support scheduling SMS for a future date/time
9. THE system SHALL integrate with a configurable SMS provider via abstraction layer (provider TBD per THIRD_PARTY_SERVICES.md)

### Requirement 3: Push Notifications

**User Story:** As a business owner, I want to send push notifications to customers who have the mobile app, so that I can reach them instantly with relevant updates.

#### Acceptance Criteria

1. THE system SHALL support creating push notification campaigns with: title, body, target segment, deep link (where to navigate in app), scheduled time
2. THE system SHALL support rich push notifications (image, action buttons)
3. THE system SHALL respect customer push notification opt-in status
4. THE system SHALL track delivery and open rates
5. THE system SHALL integrate with the mobile app's notification infrastructure (Phase 19)
6. THE system SHALL support sending push notifications as part of automated sequences

### Requirement 4: Automated Sequences

**User Story:** As a business owner, I want automated message workflows triggered by customer behavior, so that customers receive relevant communications without manual effort.

#### Acceptance Criteria

1. THE system SHALL support creating Sequences with: name, trigger event, steps (messages with delays), status (active/paused/archived)
2. THE system SHALL support the following Trigger events: New customer registration, First booking completed, Membership purchased, Membership expiring (X days before), Membership cancelled, No visit in X days (configurable), Birthday (X days before), Booking cancelled, Event registration, Specific tag added, Entered a specific segment
3. THE system SHALL support sequence steps: Send email (using a template), Send SMS, Wait (delay for X hours/days), Condition (if/else based on customer attribute), Add tag, Remove tag, Update lifecycle stage
4. THE system SHALL execute sequence steps in order with configured delays between them
5. THE system SHALL support branching logic (if customer opened email → path A, else → path B)
6. THE system SHALL support exiting a sequence early if a condition is met (e.g., customer books — exit re-engagement sequence)
7. THE system SHALL prevent a customer from entering the same sequence multiple times simultaneously (configurable: allow re-entry or block)
8. THE system SHALL log sequence enrollment, step execution, and exit per customer

### Requirement 5: Pre-Built Sequence Templates

**User Story:** As a business owner, I want pre-configured automation templates, so that I can activate common workflows quickly without building them from scratch.

#### Acceptance Criteria

1. THE system SHALL provide pre-built sequence templates: Welcome Series (new customer: welcome email → intro offer → how-to-book guide), Re-engagement (no visit 30 days: reminder → incentive offer → final message), Membership Renewal (expiring: reminder 14 days → reminder 7 days → last chance 1 day), Birthday (birthday -3 days: birthday offer), Post-Visit (1 day after: thank you → review request → rebooking prompt), Abandoned Booking (started but didn't complete: reminder after 2 hours), Win-Back (churned 90 days: we miss you → special offer)
2. THE system SHALL allow tenants to activate templates and customize content, delays, and channels
3. THE system SHALL allow tenants to create fully custom sequences from scratch
4. THE system SHALL support duplicating a sequence for modification

### Requirement 6: Template Builder

**User Story:** As a business owner, I want to create attractive email templates without coding, so that my communications look professional.

#### Acceptance Criteria

1. THE system SHALL provide an email template builder with drag-and-drop blocks: header, text, image, button, divider, columns, social links, footer
2. THE system SHALL support responsive templates (render correctly on mobile and desktop)
3. THE system SHALL support tenant branding in templates (logo, colors, fonts from tenant theme)
4. THE system SHALL support saving reusable template designs
5. THE system SHALL provide pre-built template designs for common use cases (promotion, newsletter, event announcement, booking confirmation override)
6. THE system SHALL support a plain-text fallback for every HTML email
7. THE system SHALL preview templates with sample personalization data
8. THE system SHALL support importing custom HTML templates

### Requirement 7: Campaign Analytics

**User Story:** As a business owner, I want to see how my campaigns perform, so that I can improve my marketing over time.

#### Acceptance Criteria

1. THE system SHALL report per campaign: total sent, delivered, bounced, opened, clicked, unsubscribed, complained (spam)
2. THE system SHALL calculate rates: delivery rate, open rate, click rate, click-to-open rate, unsubscribe rate, bounce rate
3. THE system SHALL display a timeline of engagement (opens/clicks over time after send)
4. THE system SHALL track link clicks individually (which links were clicked, how many times)
5. THE system SHALL support A/B test result comparison (winner determination)
6. THE system SHALL report revenue attribution (bookings made within X hours after campaign interaction)
7. THE system SHALL expose data for the Reporting & Analytics phase (Phase 17)
8. THE system SHALL compare campaign performance across campaigns (trending)

### Requirement 8: Unsubscribe and Consent Management

**User Story:** As a customer, I want to easily unsubscribe from marketing communications, so that I only receive messages I want.

#### Acceptance Criteria

1. THE system SHALL include a one-click unsubscribe link in every marketing email
2. THE system SHALL include opt-out instructions in every marketing SMS
3. THE system SHALL process unsubscribes immediately (no further messages of that type)
4. THE system SHALL support granular unsubscribe categories: all marketing, email only, SMS only, specific campaign types
5. THE system SHALL provide a customer-facing preference center where customers manage their subscriptions
6. THE system SHALL honor list-unsubscribe headers (email client unsubscribe buttons)
7. THE system SHALL log all subscription changes with timestamps
8. THE system SHALL comply with GDPR, CAN-SPAM, and relevant regulations
9. THE system SHALL never send marketing messages to customers who have not opted in

### Requirement 9: Lead Funnels

**User Story:** As a business owner, I want to create landing pages that capture leads, so that I can convert website visitors into customers.

#### Acceptance Criteria

1. THE system SHALL support creating simple landing pages with: headline, description, image/video, form fields (configurable), call-to-action button
2. THE system SHALL capture form submissions as lead records in Customer Management (Phase 05)
3. THE system SHALL auto-assign tags and lifecycle stage "Lead" to captured contacts
4. THE system SHALL support triggering a Sequence upon lead capture (e.g., welcome series)
5. THE system SHALL track conversion metrics: page views, form submissions, conversion rate
6. THE system SHALL support multiple active landing pages per tenant
7. THE system SHALL support associating a discount code or intro offer with a landing page
8. THE system SHALL generate a shareable URL per landing page

### Requirement 10: Send Time Optimization

**User Story:** As a business owner, I want messages sent at the optimal time for each customer, so that engagement is maximized.

#### Acceptance Criteria

1. THE system SHALL support configuring send windows (e.g., only send between 9 AM–9 PM in customer's time zone)
2. THE system SHALL respect customer time zones when scheduling campaign delivery
3. THE system SHALL support "send at best time" mode that distributes sends across optimal engagement windows
4. THE system SHALL respect SMS quiet hours per jurisdiction (no SMS between 9 PM–8 AM unless urgent)
5. THE system SHALL throttle campaign delivery to spread load over time (avoid all-at-once spikes)

### Requirement 11: Email/SMS Provider Abstraction

**User Story:** As a platform operator, I want messaging providers abstracted behind an interface, so that we can evaluate and switch providers without rewriting campaign logic.

#### Acceptance Criteria

1. THE system SHALL define a `MessageAdapter` interface for email delivery with: sendEmail, sendBulkEmail, getDeliveryStatus, handleWebhook (for delivery/open/click events)
2. THE system SHALL define a `SmsAdapter` interface with: sendSms, sendBulkSms, getDeliveryStatus, handleWebhook
3. THE system SHALL support configuring which provider is active per tenant (from configuration engine)
4. THE system SHALL normalize provider-specific responses and webhooks into common event types
5. THE system SHALL support a mock adapter for local development and testing
6. THE system SHALL log all message send attempts regardless of provider

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging, GDPR consent
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, feature flags
- Phase 04: Design System - Template builder UI, campaign forms, analytics charts
- Phase 05: Customer Management - Customer segments, tags, lifecycle stages, communication preferences
- Phase 07: Booking Engine - Triggers (booking completed, cancelled, etc.)
- Phase 08: Membership Engine - Triggers (membership purchased, expiring, cancelled)

## Success Criteria

- Email campaigns deliver to targeted segments with correct personalization
- SMS campaigns comply with regulations and respect opt-in
- Automated sequences trigger correctly on customer events and execute steps with delays
- Pre-built templates can be activated and customized quickly
- Template builder produces responsive, branded emails
- Campaign analytics accurately track delivery, opens, clicks, and conversions
- Unsubscribe is immediate and respected across all channels
- Lead funnels capture contacts and trigger follow-up sequences
- Provider abstraction allows testing with mock adapter locally
- All marketing data is strictly tenant-scoped

## Out of Scope

- WhatsApp messaging - Phase 20 (Integrations)
- In-app messaging / inbox - Phase 24+ (future)
- Social media posting/management - Out of platform scope
- Paid advertising management (Google Ads, Meta Ads) - Out of platform scope
- AI-generated content for campaigns - Phase 21 (AI Features)

## Notes

- Email and SMS provider are NOT pre-selected (per THIRD_PARTY_SERVICES.md — evaluated at implementation)
- Mock adapters enable full development and testing without real providers
- GDPR requires opt-in for marketing; system defaults to opted-out (Phase 05 consent records)
- Sequence trigger events come from other modules publishing events — need an internal event bus or webhook system
- Revenue attribution is approximate (customer booked within X hours of interacting with campaign)
- Template builder complexity varies; start with block-based, evaluate whether to build or use a third-party editor (Unlayer, MJML)
- Quiet hours for SMS vary by country; must be configurable per tenant jurisdiction

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 07, Phase 08
**Next Phase**: Phase 17 (Reporting & Analytics)
