# Design Document

**Date**: July 2026
**Status**: 🎨 Design Phase
**Dependencies**: Existing booking engine (spec 07), availability service, resource management (spec 13)

---

## Overview

This document describes the technical design for the Smart Booking Flow enhancements to `BookingCreate.tsx`. Two capabilities are added: a participant count field for multi-capacity resource services, and a two-level visual availability calendar (month Day_Picker → day Slot_Picker) that replaces the plain `<input type="date">`.

The existing `availability.service.ts` and the `/availability/combinations` endpoint are **read-only** — this design adds a new endpoint that delegates to the existing service, and extends `booking.service.ts` only to accept and validate `participant_count`.

---

## Table of Contents

1. [Architecture](#architecture)
2. [New Backend Endpoint — availability/days](#2-new-backend-endpoint--availabilitydays)
3. [Booking Service Extension — participant_count](#3-booking-service-extension--participant_count)
4. [Components and Interfaces](#components-and-interfaces)
5. [AvailabilityCalendar Component](#5-availabilitycalendar-component)
6. [ParticipantCount Component](#6-participantcount-component)
7. [BookingCreate Page Integration](#7-bookingcreate-page-integration)
8. [Data Models](#data-models)
9. [Correctness Properties](#correctness-properties)
10. [Error Handling](#error-handling)
11. [Testing Strategy](#testing-strategy)

---

## Architecture

```
BookingCreate (page)
│
├── ParticipantCountField        ← new: shown only when resource.capacity > 1
│
└── AvailabilityCalendar         ← new: replaces <input type="date">
    ├── DayPicker (Level 1)
    │   └── calls GET /availability/days
    └── SlotPicker (Level 2)
        └── reuses existing /availability/combinations data (already fetched)

Server
├── GET /availability/days       ← new endpoint (thin wrapper)
│   └── delegates to availability.service.getAvailabilityCombinations()
└── POST /bookings               ← extended to accept + validate participant_count
    └── booking.service.createBooking() extended
```

**Key constraint**: `availability.service.ts` is not touched. The new `/availability/days` endpoint loops over each day in the requested month and calls `getAvailabilityCombinations` once per day.

---

## 2. New Backend Endpoint — availability/days

### Route

```
GET /api/v1/bookings/availability/days
```

Registered in `packages/server/src/routes/bookings.ts` **before** the `/:id` catch-all, alongside the existing `/availability/combinations` route.

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `service_id` | UUID | Yes | Service to check |
| `variant_id` | UUID | Yes | Variant (determines duration) |
| `business_id` | UUID | Yes | Business scope |
| `month` | `YYYY-MM` | Yes | Month to query |
| `participant_count` | integer | No | Default 1. When >1, filters days to those with remaining capacity ≥ count |

### Response Shape

```json
{
  "success": true,
  "data": {
    "timezone": "Australia/Melbourne",
    "days": {
      "2026-07-01": "available",
      "2026-07-02": "unavailable",
      "2026-07-03": "closed",
      ...
    }
  }
}
```

Status values:
- `"available"` — `getAvailabilityCombinations` returned ≥ 1 slot satisfying capacity
- `"unavailable"` — no slots returned, but business is not explicitly closed
- `"closed"` — location hours/overrides mark all active locations closed that day

### Implementation Logic

```typescript
// bookings.ts route handler (pseudocode)
bookingsRouter.get('/availability/days', requirePermission('bookings:read'), async (req, res) => {
  const { service_id, variant_id, business_id, month, participant_count = 1 } = req.query;

  // Validate required params
  if (!service_id || !variant_id || !business_id || !month) { /* 400 */ }
  if (!/^\d{4}-\d{2}$/.test(month)) { /* 400 */ }

  // Build list of all days in the month
  const days = getDaysInMonth(month); // ['2026-07-01', '2026-07-02', ...]

  const result: Record<string, 'available' | 'unavailable' | 'closed'> = {};
  let timezone = 'UTC';

  for (const day of days) {
    const availability = await availabilityService.getAvailabilityCombinations({
      serviceId: service_id,
      businessId: business_id,
      variantId: variant_id,
      dateFrom: day,
      dateTo: day,
    });

    timezone = availability.timezone;

    if (availability.slots.length === 0) {
      // Determine if closed vs unavailable
      result[day] = await isDayClosedForBusiness(business_id, day) ? 'closed' : 'unavailable';
    } else if (Number(participant_count) > 1) {
      // Check if any slot has sufficient remaining capacity
      const hasCapacity = availability.slots.some(
        slot => (slot.capacity_remaining ?? 1) >= Number(participant_count)
      );
      result[day] = hasCapacity ? 'available' : 'unavailable';
    } else {
      result[day] = 'available';
    }
  }

  success(res, { timezone, days: result });
});
```

The `isDayClosedForBusiness` helper queries `sys_location_hours` and `sys_location_hour_overrides` to determine whether all active locations are closed on that day (same logic already used in `BookingCreate`'s `locationStatuses` effect — extracted to a shared helper).

### Performance Consideration

This endpoint performs N database round-trips (one per day). For a 31-day month this is acceptable for a staff-side tool with no SLA pressure. The frontend only calls this endpoint when the month changes or parameters change, not on every render. No caching is required for the initial implementation.

---

## 3. Booking Service Extension — participant_count

### Schema — No Migration Required

The `apt_bookings` table does not need a new column. `participant_count` is a booking-time validation parameter, not stored data. The resource capacity constraint is enforced at booking time using the existing `checkResourceConflict` logic.

If a booking occupies N participant spots, the validation is: existing confirmed/pending/in-progress bookings for the same slot must leave at least N spots free.

### booking.service.ts Changes

The `CreateBookingInput` interface gains one optional field:

```typescript
interface CreateBookingInput {
  // ... existing fields ...
  participantCount?: number;  // default 1 if not provided
}
```

The `createBookingSchema` in `bookings.ts` route handler gains:

```typescript
participant_count: Joi.number().integer().min(1).default(1),
```

In `createBooking()`, the existing resource conflict check is extended to consider participant count:

```typescript
// After resource is resolved (resourceId is known):
if (resourceId && participantCount > 1) {
  const { rows: resRows } = await adminPool.query(
    'SELECT capacity FROM res_resources WHERE id = $1', [resourceId]
  );
  const capacity = resRows[0]?.capacity || 1;

  const { rows: overlapping } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM apt_bookings
     WHERE resource_id = $1 AND start_time = $2
       AND status IN ('pending', 'confirmed', 'in_progress')`,
    [resourceId, startTime.toISOString()]
  );
  const bookedSpots = overlapping[0]?.count || 0;
  const remaining = capacity - bookedSpots;

  if (participantCount > remaining) {
    throw new Error(`Only ${remaining} spot(s) remaining for this slot`);
  }
}
```

The route error handler already catches messages containing `'capacity'` and returns 409, so no change to the error mapping is needed.

### participant_count in bookings.ts Route

The Joi schema addition and passing `participantCount` to `createBooking` are the only changes to the route file.

---

## Components and Interfaces

Two new components are created under `packages/client/src/components/booking/`:

```
packages/client/src/components/booking/
├── AvailabilityCalendar.tsx      ← manages Day_Picker / Slot_Picker state
├── AvailabilityCalendar.css
├── DayPicker.tsx                 ← month grid, day colour-coding
├── DayPicker.css
├── SlotPicker.tsx                ← time slot grid
├── SlotPicker.css
└── ParticipantCountField.tsx     ← number input, conditionally shown
```

`BookingCreate.tsx` imports and uses these components, replacing the `<input type="date">` section and adding the participant count field.

### State Flow

```
BookingCreate
  selectedService ──────────────────────────────────────┐
  selectedVariant ──────────────────────────────────────┤
  participantCount ─────────────────────────────────────┤
                                                        ▼
                                          AvailabilityCalendar
                                            viewedMonth (YYYY-MM)
                                            dayStatuses: Map<date, DayStatus>
                                            selectedDate (YYYY-MM-DD | null)
                                            loading / error
                                                ▼
                                          DayPicker     SlotPicker
                                                            ▼
                                          selectedDate ────► BookingCreate
                                          (lifted up via onDateSelect callback)

BookingCreate
  selectedDate ────────────────────────────────────────►
  participantCount ───────────────────────────────────► allCombos fetch
                                                        (existing useEffect, extended)
```

Callbacks flowing up from `AvailabilityCalendar` to `BookingCreate`:
- `onDateSelect(date: string)` — called when user selects a day
- `onDateClear()` — called when user goes back from Slot_Picker to Day_Picker

---

## 5. AvailabilityCalendar Component

### Props

```typescript
interface AvailabilityCalendarProps {
  serviceId: string;
  variantId: string;
  businessId: string;
  participantCount: number;
  onDateSelect: (date: string) => void;
  onDateClear: () => void;
  selectedDate: string | null;
}
```

### Internal State

```typescript
const [viewedMonth, setViewedMonth] = useState<string>(currentYYYYMM());
const [dayStatuses, setDayStatuses] = useState<Record<string, DayStatus>>({});
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [view, setView] = useState<'day-picker' | 'slot-picker'>('day-picker');
```

### Day Status Fetch

```typescript
useEffect(() => {
  if (!serviceId || !variantId) return;
  setLoading(true);
  setError(null);
  apiClient.get('/v1/bookings/availability/days', {
    params: { service_id: serviceId, variant_id: variantId, business_id: businessId,
              month: viewedMonth, participant_count: participantCount }
  })
  .then(res => setDayStatuses(res.data.data.days))
  .catch(() => setError('Failed to load calendar availability'))
  .finally(() => setLoading(false));
}, [serviceId, variantId, businessId, viewedMonth, participantCount]);
```

When `selectedDate` changes externally to null, reset `view` to `'day-picker'`.

### Month Navigation

- Previous month button disabled when `viewedMonth === currentYYYYMM()`
- Next month has no upper bound (max advance days enforced by the availability service returning empty slots, which results in grey days)

---

## 6. ParticipantCountField Component

### Props

```typescript
interface ParticipantCountFieldProps {
  value: number;
  onChange: (count: number) => void;
  maxCapacity: number;       // resource capacity ceiling
  remainingCapacity?: number; // per-slot remaining (if slot selected)
  disabled?: boolean;
}
```

### Logic

- The `max` attribute on the `<input type="number">` is `remainingCapacity ?? maxCapacity`
- `min` is always `1`
- When the selected slot changes and `value > remainingCapacity`, the parent resets value to 1

### Visibility Gating in BookingCreate

```typescript
// Load resource capacity when service is selected
const [resourceCapacity, setResourceCapacity] = useState<number>(1);

useEffect(() => {
  if (!selectedService) { setResourceCapacity(1); return; }
  // Query service's availability rules to find linked resource
  apiClient.get(`/v1/services/${selectedService}/availability`)
    .then(res => {
      const rules = res.data.data || [];
      const resourceIds = rules.flatMap((r: any) => r.resource_ids || []);
      if (resourceIds.length === 0) { setResourceCapacity(1); return; }
      // Load first resource capacity
      return apiClient.get(`/v1/resources/${resourceIds[0]}?business_id=${businessId}`);
    })
    .then(res => {
      if (res?.data?.data?.capacity) setResourceCapacity(res.data.data.capacity);
    })
    .catch(() => setResourceCapacity(1));
}, [selectedService, businessId]);

const showParticipantCount = resourceCapacity > 1;
```

> Note: The resources API endpoint for fetching a single resource must be confirmed during implementation. If no dedicated GET `/v1/resources/:id` exists, fetch from the availability rules response which already includes `resource_ids`, and add a minimal lookup in the service.

---

## 7. BookingCreate Page Integration

### Changes to BookingCreate.tsx

1. **Remove** the `<input type="date">` block (the `{selectedVariant && ...}` date field section)
2. **Add** `AvailabilityCalendar` in its place:

```tsx
{selectedVariant && (
  <AvailabilityCalendar
    serviceId={selectedService}
    variantId={selectedVariant}
    businessId={businessId}
    participantCount={participantCount}
    selectedDate={selectedDate}
    onDateSelect={(date) => { setSelectedDate(date); resetFilters(); }}
    onDateClear={() => { setSelectedDate(''); resetFilters(); }}
  />
)}
```

3. **Add** `ParticipantCountField` between the variant selector and the calendar:

```tsx
{showParticipantCount && (
  <ParticipantCountField
    value={participantCount}
    onChange={setParticipantCount}
    maxCapacity={resourceCapacity}
    remainingCapacity={selectedSlotRemainingCapacity}
  />
)}
```

4. **Extend** `createBooking` API call to include `participant_count`:

```typescript
await bookingsApi.createBooking({
  // ... existing fields ...
  participant_count: participantCount,
});
```

5. **Extend** the combinations endpoint call to include `participant_count` (the server will use this to annotate `capacity_remaining` in slots).

### State additions to BookingCreate

```typescript
const [participantCount, setParticipantCount] = useState(1);
const [resourceCapacity, setResourceCapacity] = useState(1);
```

When `selectedService` changes: reset `participantCount` to 1.  
When `selectedVariant` changes: reset `participantCount` to 1.

---

## Data Models

### DayStatus type (frontend)

```typescript
type DayStatus = 'available' | 'unavailable' | 'closed';
```

### Updated createBooking API call shape

```typescript
// packages/client/src/api/bookings.ts — createBooking data parameter
{
  business_id: string;
  customer_id?: string;
  walk_in_name?: string;
  service_id: string;
  variant_id: string;
  staff_id?: string;
  start_time: string;
  notes?: string;
  override_rules?: boolean;
  participant_count?: number;   // NEW — optional, defaults to 1 server-side
}
```

### Slot colour mapping

| Condition | CSS Variable | Visual |
|---|---|---|
| `status === 'available'` | `--color-success` (border) | Green outline |
| `capacity_remaining < participantCount` | `--color-error` (border) + disabled | Red, non-interactive |
| Selected | `--color-accent` (background) | Gold fill |
| Day: available | `--color-success` background tint | Green cell |
| Day: unavailable | `--color-border` background | Grey cell |
| Day: closed | `--color-error` background tint | Red cell |
| Day: past | `--color-text-secondary` (muted) + disabled | Greyed, non-interactive |

All via CSS variables — no hardcoded hex values anywhere in new components.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Participant field visibility matches resource capacity

*For any* service rendered in BookingCreate, the "Number of participants" field SHALL be visible if and only if the service's linked resource has `capacity > 1`. No field for capacity ≤ 1 or no resource.

**Validates: Requirements 1.1, 1.5**

---

### Property 2: Server rejects over-capacity participant counts

*For any* booking creation request where `participant_count` exceeds the `Remaining_Capacity` of the target resource slot, THE Server SHALL reject the request with HTTP 409.

Equivalently: if `participant_count ≤ Remaining_Capacity`, the server SHALL accept the request (capacity constraint satisfied).

**Validates: Requirements 1.7, 1.8**

---

### Property 3: Day status correctly reflects slot availability

*For any* month query to the `/availability/days` endpoint with valid parameters, every day in the response SHALL map to exactly one of `available`, `unavailable`, or `closed`, and no day in the requested month SHALL be absent from the response.

**Validates: Requirements 3.1, 3.2**

---

### Property 4: Participant count filters day availability

*For any* participant_count ≥ 1 supplied to `/availability/days`, a day SHALL only receive the `"available"` status if at least one slot on that day has `capacity_remaining ≥ participant_count`.

**Validates: Requirements 3.7**

---

### Property 5: Past days are always non-interactive

*For any* date in the past (before today's date in the browser), the Day_Picker cell SHALL render as disabled/non-interactive regardless of the day's availability status.

**Validates: Requirements 2.6**

---

### Property 6: Day status maps to correct CSS variable

*For any* day cell rendered by DayPicker, the background/border CSS variable applied SHALL match the day's status: `--color-success` for `available`, `--color-border` for `unavailable`, `--color-error` for `closed`.

**Validates: Requirements 2.3**

---

### Property 7: Selected slot start_time propagates to parent

*For any* slot selected in the Slot_Picker, the `onDateSelect` callback received by `BookingCreate` SHALL receive the selected day's date string, and the `selectedTime` state SHALL be set to that slot's `start_time` when the user clicks the slot button.

**Validates: Requirements 4.6**

---

### Property 8: Slot capacity state correctly gates interactivity

*For any* slot rendered in the Slot_Picker, it SHALL be clickable (available) if `capacity_remaining ≥ participantCount`, and disabled (not clickable, red-bordered) if `capacity_remaining < participantCount`.

**Validates: Requirements 4.3**

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `/availability/days` fails | Day_Picker shows inline error message with retry button; calendar stays visible |
| `/availability/combinations` fails | Existing handling unchanged (empty slot list, "No availability" message) |
| `participant_count` validation fails (409) | Existing error display in BookingCreate shows server error message |
| Missing required params to `/availability/days` | Server returns 400 with `VALIDATION_ERROR` code |
| Month format invalid | Server returns 400, client validates `YYYY-MM` format before calling |
| Resource capacity lookup fails | `resourceCapacity` defaults to 1 (field hidden — safe fallback) |

---

## Testing Strategy

### Unit Tests

- `DayPicker`: renders correct CSS variable per day status; past days disabled; navigation buttons
- `SlotPicker`: available slots clickable; over-capacity slots disabled
- `AvailabilityCalendar`: calls `/availability/days` with correct params; resets on prop change
- `ParticipantCountField`: max capped at `remainingCapacity ?? maxCapacity`; min is 1
- Server `/availability/days` handler: returns correct status map; validates params; returns 400 on missing params

### Property Tests (Vitest + fast-check)

Each property test uses `fc` (fast-check) and runs a minimum of 100 iterations.

**Property 1** — `for all service configs, participant field visibility = (resource.capacity > 1)`

**Property 2** — `for all (participant_count, remaining_capacity) pairs, server accepts iff participant_count ≤ remaining_capacity`

**Property 3** — `for all valid month strings, /availability/days response contains all N days of that month with valid statuses`

**Property 4** — `for all participant_count values and slot sets, day marked available iff ∃ slot with capacity_remaining ≥ participant_count`

**Property 5** — `for all dates before today, DayPicker cell is disabled`

**Property 6** — `for all DayStatus values, rendered cell applies the correct CSS variable`

**Property 7** — `for any slot selection, parent receives correct start_time`

**Property 8** — `for all (slot.capacity_remaining, participantCount) pairs, slot interactability matches capacity_remaining ≥ participantCount`

### Integration Tests

- Booking creation end-to-end with `participant_count = 1` succeeds
- Booking creation with `participant_count` exceeding capacity returns 409
- `/availability/days` returns populated map for a known-available service/month
- Permission check: unauthenticated request returns 401

---

**Last Updated**: July 2026
