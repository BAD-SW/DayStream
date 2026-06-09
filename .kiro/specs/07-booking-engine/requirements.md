# Phase 07: Booking Engine

## Status: 🔲 Not Started

## Objective
Build the core scheduling and availability system — the heart of the platform.

## Dependencies
- Phase 06: Service Management
- Phase 12: Staff Management (availability)
- Phase 13: Resource Management (room/equipment availability)

## Scope Summary
- Availability calculation engine (staff + resource + business hours + rules)
- Booking types:
  - Individual appointments (1:1)
  - Shared sessions (multi-customer, fixed time)
  - Group classes (capacity-limited)
  - Resource bookings (room/equipment)
- Booking lifecycle (pending → confirmed → completed / cancelled / no-show)
- Booking rules (lead time, cut-off, max advance booking)
- Cancellation and reschedule policies
- Waitlist management
- Calendar views (day, week, month, timeline, resource calendar)
- Conflict detection and prevention
- Recurring bookings
- Customer booking flow (browse → select slot → confirm → pay)
- Admin booking management (create, modify, cancel on behalf)
- Booking notifications (confirmation, reminder, cancellation)
- Time zone handling

## Key Decisions Pending
- Availability algorithm approach (slot-based vs. interval-based)
- Calendar UI library or custom build
- Notification delivery mechanism (in-app, email, SMS, push)
- Recurring booking pattern (RRULE or custom)

---

*Requirements, design, and tasks to be detailed during spec planning.*
