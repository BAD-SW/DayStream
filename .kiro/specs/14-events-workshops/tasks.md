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
- [x] ✅ Create migration for `event_types` table
- [x] ✅ Create migration for `events` table
- [x] ✅ Create migration for `event_facilitators` table
- [x] ✅ Create migration for `recurring_event_templates` table
- [x] ✅ Create migration for `event_series` table
- [x] ✅ Create migration for `event_ticket_tiers` table
- [x] ✅ Create migration for `event_registrations` table
- [x] ✅ Create migration for `event_waitlist` table
- [x] ✅ Create migration for `event_communications` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, status, dates, event references)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Seed default event types (Workshop, Seminar, Challenge, Retreat, Class, Webinar)
- [x] ✅ Run migrations and verify schema

---

## 2. Event Types

### 2.1 Event Types CRUD
- [x] ✅ Create `event-types.service.ts`
- [x] ✅ Seed default types per tenant
- [x] ✅ Support custom type creation
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `GET /api/v1/events/types` endpoint
- [x] ✅ Create `POST /api/v1/events/types` endpoint
- [x] ✅ Create `PUT /api/v1/events/types/:id` endpoint

---

## 3. Event CRUD

### 3.1 Event Service
- [x] ✅ Create `event.service.ts` with list/create/get/update methods
- [x] ✅ Support slug generation (URL-friendly)
- [x] ✅ Support multi-day events (start/end spanning days)
- [x] ✅ Support filtering by type, status, date range, facilitator
- [x] ✅ Support publishing (draft → published)
- [x] ✅ Support cancelling (notify all registrants)
- [x] ✅ Support completing (mark event as done)
- [x] ✅ Support cover image upload via storage service
- [x] ✅ Support tags/categories
- [x] ✅ Write tests

### 3.2 Facilitators
- [x] ✅ Support adding/removing facilitators (staff members)
- [x] ✅ Validate staff exists and is active
- [x] ✅ Write tests

### 3.3 Routes
- [x] ✅ Create `GET /api/v1/events` endpoint
- [x] ✅ Create `POST /api/v1/events` endpoint
- [x] ✅ Create `GET /api/v1/events/:id` endpoint
- [x] ✅ Create `PUT /api/v1/events/:id` endpoint
- [x] ✅ Create `PUT /api/v1/events/:id/publish` endpoint
- [x] ✅ Create `PUT /api/v1/events/:id/cancel` endpoint
- [x] ✅ Create `PUT /api/v1/events/:id/complete` endpoint
- [x] ✅ Create `POST /api/v1/events/:id/facilitators` endpoint
- [x] ✅ Create `DELETE /api/v1/events/:id/facilitators/:fid` endpoint

---

## 4. Recurring Events

### 4.1 Recurring Template Service
- [x] ✅ Create `recurring-events.service.ts`
- [x] ✅ Support recurrence patterns: weekly, biweekly, monthly, custom interval
- [x] ✅ Generate individual event instances from template
- [x] ✅ Support modifying a single occurrence (detach from template)
- [x] ✅ Support cancelling a single occurrence
- [x] ✅ Support cancelling entire series (future only)
- [x] ✅ Support end conditions (count, date, ongoing)
- [x] ✅ Auto-generate on a rolling window (90 days ahead)
- [x] ✅ Write tests

### 4.2 Routes
- [x] ✅ Create `GET /api/v1/events/recurring` endpoint
- [x] ✅ Create `POST /api/v1/events/recurring` endpoint
- [x] ✅ Create `PUT /api/v1/events/recurring/:id` endpoint
- [x] ✅ Create `PUT /api/v1/events/recurring/:id/cancel` endpoint
- [x] ✅ Create `POST /api/v1/events/recurring/:id/generate` endpoint

---

## 5. Event Series (Programs)

### 5.1 Series Service
- [x] ✅ Create `event-series.service.ts`
- [x] ✅ Support creating series with title, total sessions, pricing model
- [x] ✅ Support linking events to a series (with order)
- [x] ✅ Support series registration (one payment for all sessions)
- [x] ✅ Support drop-in registration for individual sessions (if enabled)
- [x] ✅ Track attendance per session within series
- [x] ✅ Support sequential prerequisite enforcement (if configured)
- [x] ✅ Expose progress (attended / total)
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/events/series` endpoint
- [x] ✅ Create `POST /api/v1/events/series` endpoint
- [x] ✅ Create `GET /api/v1/events/series/:id` endpoint
- [x] ✅ Create `PUT /api/v1/events/series/:id` endpoint

---

## 6. Ticketing and Pricing Tiers

### 6.1 Ticket Tier Service
- [x] ✅ Create `event-tickets.service.ts`
- [x] ✅ Support multiple tiers per event (name, price, quantity, availability window)
- [x] ✅ Support eligibility rules (all, members_only, first_time)
- [x] ✅ Validate tier availability window on registration
- [x] ✅ Track quantity sold vs available
- [x] ✅ Support free events (price = 0)
- [x] ✅ Integrate with Pricing Engine for discount codes and member pricing
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/events/:id/tickets` endpoint
- [x] ✅ Create `POST /api/v1/events/:id/tickets` endpoint
- [x] ✅ Create `PUT /api/v1/events/:id/tickets/:tid` endpoint
- [x] ✅ Create `DELETE /api/v1/events/:id/tickets/:tid` endpoint

---

## 7. Registration Flow

### 7.1 Registration Service
- [x] ✅ Create `event-registration.service.ts`
- [x] ✅ Implement registration flow (select tier → attendee info → hold → pay → confirm)
- [x] ✅ Generate unique registration reference number
- [x] ✅ Support hold mechanism (10 min expiry for pending registrations)
- [x] ✅ Support group registration (multiple attendees in one transaction)
- [x] ✅ Support custom field collection (per-event configurable fields)
- [x] ✅ Support free event instant confirmation
- [x] ✅ Validate tier eligibility and availability
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `POST /api/v1/events/:id/register` endpoint
- [x] ✅ Create `GET /api/v1/events/:id/registrations` endpoint (admin)
- [x] ✅ Create `PUT /api/v1/events/registrations/:rid/cancel` endpoint
- [x] ✅ Create `PUT /api/v1/events/registrations/:rid/transfer` endpoint

---

## 8. Capacity and Waitlist

### 8.1 Waitlist Service
- [x] ✅ Create `event-waitlist.service.ts`
- [x] ✅ Enforce capacity limits (sum of group_size for confirmed registrations)
- [x] ✅ Add to waitlist when capacity reached (maintain order)
- [x] ✅ On cancellation: notify next waitlist entry
- [x] ✅ Configurable claim window (default 4 hours)
- [x] ✅ Auto-expire unclaimed notifications, move to next
- [x] ✅ Display waitlist position to customer
- [x] ✅ Support minimum attendee threshold (cancel if not met by deadline)
- [x] ✅ Write tests

### 8.2 Routes
- [x] ✅ Create `GET /api/v1/events/:id/waitlist` endpoint
- [x] ✅ Create `PUT /api/v1/events/waitlist/:wid/confirm` endpoint

---

## 9. Cancellation and Refunds

### 9.1 Cancellation Logic
- [x] ✅ Implement per-event cancellation policy enforcement
- [x] ✅ Calculate refund based on policy (full, partial, none based on timing)
- [x] ✅ Support admin-initiated cancellation with full refund override
- [x] ✅ Support registration transfer (name change to another customer)
- [x] ✅ On business cancels entire event: notify all, process full refunds
- [x] ✅ Log all cancellations in audit trail
- [x] ✅ Write tests

---

## 10. Check-In and Attendance

### 10.1 Check-In Service
- [x] ✅ Create `event-checkin.service.ts`
- [x] ✅ Support QR code check-in (validate registration reference)
- [x] ✅ Support manual check-in by facilitator
- [x] ✅ Record check-in timestamp and method
- [x] ✅ Mark no-shows after event completion
- [x] ✅ Provide attendee list with check-in status
- [x] ✅ Report attendance rate (checked in / registered)
- [x] ✅ Log attendance in customer Activity_Timeline
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create `PUT /api/v1/events/registrations/:rid/check-in` endpoint
- [x] ✅ Create `POST /api/v1/events/:id/check-in/qr` endpoint
- [x] ✅ Create `GET /api/v1/events/:id/attendees` endpoint

---

## 11. Event Communications

### 11.1 Communications Service
- [x] ✅ Create `event-communications.service.ts`
- [x] ✅ Send registration confirmation (immediate)
- [x] ✅ Send event reminder (configurable: 1/3/7 days before)
- [x] ✅ Send preparation instructions (configurable timing)
- [x] ✅ Send post-event follow-up (1 day after)
- [x] ✅ Send cancellation notifications (individual or all)
- [x] ✅ Support ad-hoc messages to all registrants
- [x] ✅ Respect customer communication preferences
- [x] ✅ Log all communications sent
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `POST /api/v1/events/:id/communications` endpoint (ad-hoc)
- [x] ✅ Create `GET /api/v1/events/:id/communications` endpoint (history)

---

## 12. Public Event Calendar

### 12.1 Calendar API
- [x] ✅ Create public event calendar endpoint (no auth required)
- [x] ✅ Return only published, future events
- [x] ✅ Support filtering: type, date range, facilitator, tag, availability
- [x] ✅ Support detail view with tiers, facilitator bios, registration action
- [x] ✅ Support slug-based lookup for SEO-friendly URLs
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/events/calendar` endpoint (public, no auth)
- [x] ✅ Create `GET /api/v1/events/calendar/:slug` endpoint (public detail)

---

## 13. Event Reporting

### 13.1 Reporting Service
- [x] ✅ Create `event-reports.service.ts`
- [x] ✅ Report per event: registrations, attendance rate, revenue, utilization, waitlist, cancellations
- [x] ✅ Report aggregated: events per period, total revenue, avg attendance, popular types
- [x] ✅ Report facilitator performance (events led, avg attendance)
- [x] ✅ Support event comparison (current vs previous run)
- [x] ✅ Support CSV export of attendee lists
- [x] ✅ Write tests

### 13.2 Routes
- [x] ✅ Create `GET /api/v1/events/reports/summary` endpoint
- [x] ✅ Create `GET /api/v1/events/:id/reports` endpoint
- [x] ✅ Create `GET /api/v1/events/:id/attendees/export` endpoint

---

## 14. Frontend

### 14.1 Event List Page
- [x] ✅ Create `/events` page with card/list view
- [x] ✅ Add filters (type, status, date range)
- [x] ✅ Quick actions (publish, cancel, duplicate)

### 14.2 Event Detail Page
- [x] ✅ Create `/events/:id` page with tabbed layout
- [x] ✅ Details tab (title, description, type, dates, location, facilitators)
- [x] ✅ Tickets tab (tier management with pricing and availability)
- [x] ✅ Registrations tab (attendee list, statuses, check-in actions)
- [x] ✅ Waitlist tab (ordered list, notify/confirm)
- [x] ✅ Communications tab (send messages, history)
- [x] ✅ Reports tab (attendance, revenue, tier breakdown)

### 14.3 Event Create/Edit
- [x] ✅ Create `/events/new` and `/events/:id/edit` multi-step form
- [x] ✅ Steps: basics → schedule → tickets → facilitators → review/publish

### 14.4 Recurring Events Page
- [x] ✅ Create `/events/recurring` page
- [x] ✅ Template list with next occurrence and controls

### 14.5 Event Series Page
- [x] ✅ Create `/events/series` page
- [x] ✅ Series list with session tracking

### 14.6 Public Event Calendar
- [x] ✅ Create public event calendar component (customer-facing)
- [x] ✅ List/calendar/card views
- [x] ✅ Filter by type, date, availability
- [x] ✅ Event detail with registration CTA

### 14.7 Check-In View
- [x] ✅ Create `/events/:id/check-in` page
- [x] ✅ QR scanner interface
- [x] ✅ Attendee list with check-in buttons
- [x] ✅ Real-time attendance counter

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test event CRUD (create, update, publish, cancel, complete)
- [x] ✅ Test recurring event generation (weekly, monthly, custom)
- [x] ✅ Test event series (register for series, track progress)
- [x] ✅ Test ticket tier management (availability windows, eligibility, sold out)
- [x] ✅ Test registration flow (hold, confirm, expire)
- [x] ✅ Test capacity enforcement and waitlist (add, notify, confirm, expire)
- [x] ✅ Test cancellation policy enforcement (full, partial, no refund)
- [x] ✅ Test check-in (QR, manual, no-show marking)
- [x] ✅ Test communications (triggers, logging)
- [x] ✅ Test public calendar (filtering, published only)

### 15.2 Integration Tests
- [x] ✅ Test full registration flow (browse → select tier → register → confirm → check-in)
- [x] ✅ Test capacity → waitlist → cancellation → waitlist promotion flow
- [x] ✅ Test recurring event generation and single-occurrence modification
- [x] ✅ Test series registration and sequential attendance
- [x] ✅ Test event cancellation with bulk refund processing
- [x] ✅ Test group registration (multiple attendees in one transaction)
- [x] ✅ Test tenant scoping (events isolated per tenant)
