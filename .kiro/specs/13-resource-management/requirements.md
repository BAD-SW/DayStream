# Phase 13: Resource Management

## Status: 🔲 Not Started

## Objective
Manage physical resources (rooms, equipment) and prevent scheduling conflicts.

## Dependencies
- Phase 03: Core Platform

## Scope Summary
- Resource types (rooms, equipment, facilities)
- Resource CRUD (create, configure, deactivate)
- Resource scheduling and availability
- Service-to-resource linking (which services require which resources)
- Conflict prevention (double-booking detection)
- Resource capacity (e.g., sauna fits 4 people)
- Maintenance windows (blocked time for cleaning, repairs)
- Resource utilization tracking
- Multi-location resource management
- Resource calendar view

### Example Resources (Transcend)
- Float Room
- Massage Room
- Gym Room
- Sauna
- Cold Bath
- Jacuzzi
- Compression Boots
- Red Light Cabin

## Key Decisions Pending
- Resource hierarchy (room contains equipment vs. flat list)
- Buffer time between bookings (per resource)
- Resource sharing rules (concurrent vs. exclusive use)

---

*Requirements, design, and tasks to be detailed during spec planning.*
