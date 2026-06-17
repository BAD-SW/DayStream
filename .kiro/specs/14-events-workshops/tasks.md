# Phase 14: Events & Workshops - Tasks

## Overview

Implementation tasks for the events and workshops module — database schema, event CRUD, recurring events, series (programs), ticketing, registration flow, capacity/waitlist, cancellation/refunds, check-in, communications, public calendar, reporting, and frontend.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [ ] Create migration for `event_types` table
- [ ] Create migration for `events` table
- [ ] Create migration for `event_facilitators` table
- [ ] Create migration for `recurring_event_templates` table
- [ ] Create migration for `event_series` table
- [ ] Create migration for `event_ticket_tiers` table
- [ ] Create migration for `event_registrations` table
- [ ] Create migration for `event_waitlist` table
- [ ] Create migration for `event_communications` table

### 1.2 Indexes and Permissions
- [ ] Add indexes (tenant, status, dates, event references)
- [ ] Add RLS policies on all tables (tenant-scoped)
- [ ] Grant permissions to daystream_app role
- [ ] Seed default event types (Workshop, Seminar, Challenge, Retreat, Class, Webinar)
- [ ] Run migrations and verify schema

---

## 2. Event Types

### 2.1 Event Types CRUD
- [ ] Create `event-types.service.ts`
- [ ] Seed default types per tenant
- [ ] Support custom type creation
- [ ] Write tests

### 2.2 Routes
- [ ] Create `GET /api/v1/events/types` endpoint
- [ ] Create `POST /api/v1/events/types` endpoint
- [ ] Create `PUT /api/v1/events/types/:id` endpoint

---

## 3. Event CRUD

### 3.1 Event Service
- [ ] Create `event.service.ts` with list/create/get/update methods
- [ ] Support slug generation (URL-friendly)
- [ ] Support multi-day events (start/end spanning days)
- [ ] Support filtering by type, status, date range, facilitator
- [ ] Support publishing (draft → published)
- [ ] Support cancelling (notify all registrants)
- [ ] Support completing (mark event as done)
- [ ] Support cover image upload via storage service
- [ ] Support tags/categories
- [ ] Write tests

### 3.2 Facilitators
- [ ] Support adding/removing facilitators (staff members)
- [ ] Validate staff exists and is active
- [ ] Write tests

### 3.3 Routes
- [ ] Create `GET /api/v1/events` endpoint
- [ ] Create `POST /api/v1/events` endpoint
- [ ] Create `GET /api/v1/events/:id` endpoint
- [ ] Create `PUT /api/v1/events/:id` endpoint
- [ ] Create `PUT /api/v1/events/:id/publish` endpoint
- [ ] Create `PUT /api/v1/events/:id/cancel` endpoint
- [ ] Create `PUT /api/v1/events/:id/complete` endpoint
- [ ] Create `POST /api/v1/events/:id/facilitators` endpoint
- [ ] Create `DELETE /api/v1/events/:id/facilitators/:fid` endpoint

---

## 4. Recurring Events

### 4.1 Recurring Template Service
- [ ] Create `recurring-events.service.ts`
- [ ] Support recurrence patterns: weekly, biweekly, monthly, custom interval
- [ ] Generate individual event instances from template
- [ ] Support modifying a single occurrence (detach from template)
- [ ] Support cancelling a single occurrence
- [ ] Support cancelling entire series (future only)
- [ ] Support end conditions (count, date, ongoing)
- [ ] Auto-generate on a rolling window (90 days ahead)
- [ ] Write tests

### 4.2 Routes
- [ ] Create `GET /api/v1/events/recurring` endpoint
- [ ] Create `POST /api/v1/events/recurring` endpoint
- [ ] Create `PUT /api/v1/events/recurring/:id` endpoint
- [ ] Create `PUT /api/v1/events/recurring/:id/cancel` endpoint
- [ ] Create `POST /api/v1/events/recurring/:id/generate` endpoint

---

## 5. Event Series (Programs)

### 5.1 Series Service
- [ ] Create `event-series.service.ts`
- [ ] Support creating series with title, total sessions, pricing model
- [ ] Support linking events to a series (with order)
- [ ] Support series registration (one payment for all sessions)
- [ ] Support drop-in registration for individual sessions (if enabled)
- [ ] Track attendance per session within series
- [ ] Support sequential prerequisite enforcement (if configured)
- [ ] Expose progress (attended / total)
- [ ] Write tests

### 5.2 Routes
- [ ] Create `GET /api/v1/events/series` endpoint
- [ ] Create `POST /api/v1/events/series` endpoint
- [ ] Create `GET /api/v1/events/series/:id` endpoint
- [ ] Create `PUT /api/v1/events/series/:id` endpoint

---

## 6. Ticketing and Pricing Tiers

### 6.1 Ticket Tier Service
- [ ] Create `event-tickets.service.ts`
- [ ] Support multiple tiers per event (name, price, quantity, availability window)
- [ ] Support eligibility rules (all, members_only, first_time)
- [ ] Validate tier availability window on registration
- [ ] Track quantity sold vs available
- [ ] Support free events (price = 0)
- [ ] Integrate with Pricing Engine for discount codes and member pricing
- [ ] Write tests

### 6.2 Routes
- [ ] Create `GET /api/v1/events/:id/tickets` endpoint
- [ ] Create `POST /api/v1/events/:id/tickets` endpoint
- [ ] Create `PUT /api/v1/events/:id/tickets/:tid` endpoint
- [ ] Create `DELETE /api/v1/events/:id/tickets/:tid` endpoint

---

## 7. Registration Flow

### 7.1 Registration Service
- [ ] Create `event-registration.service.ts`
- [ ] Implement registration flow (select tier → attendee info → hold → pay → confirm)
- [ ] Generate unique registration reference number
- [ ] Support hold mechanism (10 min expiry for pending registrations)
- [ ] Support group registration (multiple attendees in one transaction)
- [ ] Support custom field collection (per-event configurable fields)
- [ ] Support free event instant confirmation
- [ ] Validate tier eligibility and availability
- [ ] Write tests

### 7.2 Routes
- [ ] Create `POST /api/v1/events/:id/register` endpoint
- [ ] Create `GET /api/v1/events/:id/registrations` endpoint (admin)
- [ ] Create `PUT /api/v1/events/registrations/:rid/cancel` endpoint
- [ ] Create `PUT /api/v1/events/registrations/:rid/transfer` endpoint

---

## 8. Capacity and Waitlist

### 8.1 Waitlist Service
- [ ] Create `event-waitlist.service.ts`
- [ ] Enforce capacity limits (sum of group_size for confirmed registrations)
- [ ] Add to waitlist when capacity reached (maintain order)
- [ ] On cancellation: notify next waitlist entry
- [ ] Configurable claim window (default 4 hours)
- [ ] Auto-expire unclaimed notifications, move to next
- [ ] Display waitlist position to customer
- [ ] Support minimum attendee threshold (cancel if not met by deadline)
- [ ] Write tests

### 8.2 Routes
- [ ] Create `GET /api/v1/events/:id/waitlist` endpoint
- [ ] Create `PUT /api/v1/events/waitlist/:wid/confirm` endpoint

---

## 9. Cancellation and Refunds

### 9.1 Cancellation Logic
- [ ] Implement per-event cancellation policy enforcement
- [ ] Calculate refund based on policy (full, partial, none based on timing)
- [ ] Support admin-initiated cancellation with full refund override
- [ ] Support registration transfer (name change to another customer)
- [ ] On business cancels entire event: notify all, process full refunds
- [ ] Log all cancellations in audit trail
- [ ] Write tests

---

## 10. Check-In and Attendance

### 10.1 Check-In Service
- [ ] Create `event-checkin.service.ts`
- [ ] Support QR code check-in (validate registration reference)
- [ ] Support manual check-in by facilitator
- [ ] Record check-in timestamp and method
- [ ] Mark no-shows after event completion
- [ ] Provide attendee list with check-in status
- [ ] Report attendance rate (checked in / registered)
- [ ] Log attendance in customer Activity_Timeline
- [ ] Write tests

### 10.2 Routes
- [ ] Create `PUT /api/v1/events/registrations/:rid/check-in` endpoint
- [ ] Create `POST /api/v1/events/:id/check-in/qr` endpoint
- [ ] Create `GET /api/v1/events/:id/attendees` endpoint

---

## 11. Event Communications

### 11.1 Communications Service
- [ ] Create `event-communications.service.ts`
- [ ] Send registration confirmation (immediate)
- [ ] Send event reminder (configurable: 1/3/7 days before)
- [ ] Send preparation instructions (configurable timing)
- [ ] Send post-event follow-up (1 day after)
- [ ] Send cancellation notifications (individual or all)
- [ ] Support ad-hoc messages to all registrants
- [ ] Respect customer communication preferences
- [ ] Log all communications sent
- [ ] Write tests

### 11.2 Routes
- [ ] Create `POST /api/v1/events/:id/communications` endpoint (ad-hoc)
- [ ] Create `GET /api/v1/events/:id/communications` endpoint (history)

---

## 12. Public Event Calendar

### 12.1 Calendar API
- [ ] Create public event calendar endpoint (no auth required)
- [ ] Return only published, future events
- [ ] Support filtering: type, date range, facilitator, tag, availability
- [ ] Support detail view with tiers, facilitator bios, registration action
- [ ] Support slug-based lookup for SEO-friendly URLs
- [ ] Write tests

### 12.2 Routes
- [ ] Create `GET /api/v1/events/calendar` endpoint (public, no auth)
- [ ] Create `GET /api/v1/events/calendar/:slug` endpoint (public detail)

---

## 13. Event Reporting

### 13.1 Reporting Service
- [ ] Create `event-reports.service.ts`
- [ ] Report per event: registrations, attendance rate, revenue, utilization, waitlist, cancellations
- [ ] Report aggregated: events per period, total revenue, avg attendance, popular types
- [ ] Report facilitator performance (events led, avg attendance)
- [ ] Support event comparison (current vs previous run)
- [ ] Support CSV export of attendee lists
- [ ] Write tests

### 13.2 Routes
- [ ] Create `GET /api/v1/events/reports/summary` endpoint
- [ ] Create `GET /api/v1/events/:id/reports` endpoint
- [ ] Create `GET /api/v1/events/:id/attendees/export` endpoint

---

## 14. Frontend

### 14.1 Event List Page
- [ ] Create `/events` page with card/list view
- [ ] Add filters (type, status, date range)
- [ ] Quick actions (publish, cancel, duplicate)

### 14.2 Event Detail Page
- [ ] Create `/events/:id` page with tabbed layout
- [ ] Details tab (title, description, type, dates, location, facilitators)
- [ ] Tickets tab (tier management with pricing and availability)
- [ ] Registrations tab (attendee list, statuses, check-in actions)
- [ ] Waitlist tab (ordered list, notify/confirm)
- [ ] Communications tab (send messages, history)
- [ ] Reports tab (attendance, revenue, tier breakdown)

### 14.3 Event Create/Edit
- [ ] Create `/events/new` and `/events/:id/edit` multi-step form
- [ ] Steps: basics → schedule → tickets → facilitators → review/publish

### 14.4 Recurring Events Page
- [ ] Create `/events/recurring` page
- [ ] Template list with next occurrence and controls

### 14.5 Event Series Page
- [ ] Create `/events/series` page
- [ ] Series list with session tracking

### 14.6 Public Event Calendar
- [ ] Create public event calendar component (customer-facing)
- [ ] List/calendar/card views
- [ ] Filter by type, date, availability
- [ ] Event detail with registration CTA

### 14.7 Check-In View
- [ ] Create `/events/:id/check-in` page
- [ ] QR scanner interface
- [ ] Attendee list with check-in buttons
- [ ] Real-time attendance counter

---

## 15. Testing

### 15.1 Unit Tests
- [ ] Test event CRUD (create, update, publish, cancel, complete)
- [ ] Test recurring event generation (weekly, monthly, custom)
- [ ] Test event series (register for series, track progress)
- [ ] Test ticket tier management (availability windows, eligibility, sold out)
- [ ] Test registration flow (hold, confirm, expire)
- [ ] Test capacity enforcement and waitlist (add, notify, confirm, expire)
- [ ] Test cancellation policy enforcement (full, partial, no refund)
- [ ] Test check-in (QR, manual, no-show marking)
- [ ] Test communications (triggers, logging)
- [ ] Test public calendar (filtering, published only)

### 15.2 Integration Tests
- [ ] Test full registration flow (browse → select tier → register → confirm → check-in)
- [ ] Test capacity → waitlist → cancellation → waitlist promotion flow
- [ ] Test recurring event generation and single-occurrence modification
- [ ] Test series registration and sequential attendance
- [ ] Test event cancellation with bulk refund processing
- [ ] Test group registration (multiple attendees in one transaction)
- [ ] Test tenant scoping (events isolated per tenant)
