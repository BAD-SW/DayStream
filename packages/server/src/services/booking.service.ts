import { AsyncLocalStorage } from 'async_hooks';
import { peakParticipants } from './session-capacity';
import { evaluateOnBooking } from './customer-lifecycle.service';
import { adminPool } from '../db/pool';
import { ColumnFilters, FilterableColumn, addColumnFilterConditions, columnValuesSql } from '../utils/column-filters';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { calculatePrice } from './pricing.service';
import { logger } from '../middleware/logger';
import { localSlotMinutes, localParts } from '../utils/business-time';
import { requiredResourceAlternatives, loadMaintenance, underMaintenance, loadResourceHours, resourceOpen, endOfDayMinutes } from './required-resources.service';
import { getServiceHoursForDay } from './availability.service';
import { touchActivity } from './person-identity.service';
import { queueBookingConfirmation } from './booking-notifications.service';
import { msg } from '../i18n';

interface CreateBookingInput {
  businessId: string;
  customerId?: string;
  walkInName?: string;
  serviceId: string;
  variantId: string;
  staffId?: string;
  resourceId?: string;
  /** where it takes place (calendar location filter); default the business's primary location */
  locationId?: string;
  startTime: string;     // ISO 8601
  notes?: string;
  createdBy: string;
  tenantId: string;
  overrideRules?: boolean;  // staff can override lead time, staff hours, AND resource capacity
  /** The customer's saved card held for the reservation (checked by the caller), charged at Checkout. */
  heldCardId?: string | null;
  participantCount?: number; // headcount this booking occupies on its resource; default 1
  skipLeadTime?: boolean;   // a walk-in, or moving an existing booking: minimum notice does not apply
  excludeBookingId?: string; // when re-checking an existing booking, it does not conflict with itself
  dryRun?: boolean;          // run every check and return what would be saved, without saving
  initialStatus?: 'pending' | 'confirmed'; // default 'confirmed' — widget bookings awaiting payment use 'pending'
  source?: 'admin' | 'widget'; // default 'admin' (spec 38)
  // Suppress the appointment-confirmation email for this creation. Set by callers
  // where a confirmation would be noise/spam: walk-ins (customer is at the desk)
  // and recurring-series generation (bulk — avoid a mail storm). The widget passes
  // its own email flow, so born-confirmed widget bookings also suppress here and
  // the widget queues once itself.
  suppressConfirmation?: boolean;
  /** The add-ons chosen (svc_addons ids), checked against the service before (spec 51, gap 15). */
  addonIds?: string[];
}

interface BookingFilters {
  businessId: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  customerId?: string;
  customerSearch?: string;
  staffId?: string;
  serviceId?: string;
  /** Column filters of the shared table (David, 2026-11-02). */
  columns?: ColumnFilters;
  page?: number;
  limit?: number;
  /** Start time order: 'asc' (default) or 'desc' (newest first, the staff list). */
  order?: 'asc' | 'desc';
}

/**
 * A booking refused by a business rule (closed, outside hours, provider not available, limit
 * reached, resource taken...). The message is meant for the person booking.
 */
export class BookingRuleError extends Error {
  code = 'BOOKING_RULE';
}

/** The booking being re-checked (an edit or a move), which must not count as a conflict with itself. */
const excludeStore = new AsyncLocalStorage<string | null>();
const excludedId = (): string | null => excludeStore.getStore() ?? null;

/**
 * One booking decision at a time per business. The checks (is the provider free, is there room)
 * and the insert are separate statements, so two requests for the same slot arriving together
 * both passed the checks and both saved. Requests queue here (in this process) and on a
 * database advisory lock (across processes).
 */
const bookingQueues = new Map<string, Promise<unknown>>();
export async function withBookingLock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const previous = bookingQueues.get(businessId) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => mine);
  bookingQueues.set(businessId, chain);
  await previous;
  const key = `booking:${businessId}`;
  let client: any = null;
  try {
    client = await adminPool.connect();
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    return await fn();
  } finally {
    if (client) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
      client.release();
    }
    release();
    if (bookingQueues.get(businessId) === chain) bookingQueues.delete(businessId);
  }
}

/**
 * Create a booking.
 */
export async function createBooking(input: CreateBookingInput) {
  return withBookingLock(input.businessId, () => excludeStore.run(input.excludeBookingId || null, () => checkAndSaveBooking(input)));
}

/**
 * Run every booking rule for a change to an existing booking (new time, provider, service,
 * variant or headcount) and return what should be saved. Call it inside withBookingLock.
 */
export async function planBookingChange(input: CreateBookingInput & { excludeBookingId: string }) {
  return excludeStore.run(input.excludeBookingId, () => checkAndSaveBooking({ ...input, dryRun: true, skipLeadTime: true }));
}

async function checkAndSaveBooking(input: CreateBookingInput): Promise<any> {
  // Load service + variant
  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sv.duration, sv.price, sv.pricing_model
     FROM svc_services s
     JOIN svc_variants sv ON sv.service_id = s.id AND sv.id = $2
     WHERE s.id = $1 AND s.business_id = $3`,
    [input.serviceId, input.variantId, input.businessId],
  );

  if (svcRows.length === 0) throw new Error(msg('errors:booking.serviceOrVariantNotFound'));

  const service = svcRows[0];
  // A paused, archived or draft service is not for sale, whoever is booking.
  if (service.status !== 'active') {
    throw new BookingRuleError(msg('errors:booking.thisServiceIsAndCannotBe', { status: service.status }));
  }
  if (input.customerId) {
    const { rows: personRows } = await adminPool.query(
      'SELECT status FROM cus_customers WHERE id = $1 AND business_id = $2', [input.customerId, input.businessId],
    );
    if (personRows.length === 0) throw new BookingRuleError(msg('errors:booking.thisPersonDoesNotBelongTo'));
    if (personRows[0].status !== 'active') {
      throw new BookingRuleError(msg('errors:booking.thisPersonIsAndCannotBe', { status: personRows[0].status }));
    }
  }
  const duration = service.duration;
  const basePrice = service.price;
  const bookingType = service.booking_type;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;

  const startTime = new Date(input.startTime);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
  const participantCount = input.participantCount && input.participantCount >= 1 ? Math.floor(input.participantCount) : 1;
  if ((bookingType === 'shared' || bookingType === 'group') && participantCount > (service.max_capacity || 1)) {
    throw new BookingRuleError(msg('errors:booking.thisSessionTakesAtMostPeople', { value: service.max_capacity || 1 }));
  }

  // Calculate price with applicable rules
  let price = basePrice;
  try {
    const priceBreakdown = await calculatePrice({
      businessId: input.businessId,
      items: [{ variant_id: input.variantId }],
      customerId: input.customerId,
      bookingDatetime: input.startTime,
    });
    console.log('[booking] Price calculation:', JSON.stringify({ basePrice, total: priceBreakdown.total, discounts: priceBreakdown.discounts, savings: priceBreakdown.savings }));
    price = priceBreakdown.total;
  } catch (err: any) {
    console.error('[booking] Pricing calculation failed:', err.message, err.stack);
    logger.warn('Pricing calculation failed, using base price', { error: err.message });
  }

  // Enforce lead time (unless staff override)
  if (!input.overrideRules && !input.skipLeadTime) {
    const minAdvanceMs = (service.min_advance_booking_hours ?? 2) * 60 * 60 * 1000;
    if (startTime.getTime() - Date.now() < minAdvanceMs) {
      throw new Error(msg('errors:booking.bookingIsWithinTheMinimumAdvance'));
    }
  }

  if (!input.overrideRules && !input.skipLeadTime) {
    const maxAdvanceDays = service.max_advance_booking_days || 30;
    if (startTime.getTime() - Date.now() > maxAdvanceDays * 24 * 60 * 60 * 1000) {
      throw new Error(msg('errors:booking.bookingsCanBeMadeAtMost', { maxAdvanceDays }));
    }
  }

  // Check business hours (location hours + holiday overrides)
  // The same location the slot calculation uses: one where the service is offered, the
  // primary location first.
  const { rows: locRows } = await adminPool.query(
    `SELECT l.id FROM sys_locations l
      WHERE l.business_id = $1 AND l.status = 'active'
        AND (NOT EXISTS (SELECT 1 FROM svc_locations x JOIN sys_locations xl ON xl.id = x.location_id AND xl.status = 'active' WHERE x.service_id = $2)
             OR l.id IN (SELECT location_id FROM svc_locations WHERE service_id = $2))
      ORDER BY l.is_primary DESC, l.created_at LIMIT 1`,
    [input.businessId, input.serviceId],
  );
  // the location chosen when booking, else the first where the service is offered
  const locationId = input.locationId || locRows[0]?.id;
  // Opening hours, shifts and availability patterns are wall-clock times where the business
  // is: read the appointment in the business's time zone, not on the UTC clock (which is off
  // by the zone's offset and, near midnight, on the wrong day).
  const { rows: tzRows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [input.businessId]);
  const slotLocal = localSlotMinutes(startTime, endTime, tzRows[0]?.timezone || 'UTC');
  // A walk-in is someone already at the business: booked for today only, never a future day.
  // Not an override-able rule (a later visit is booked for a customer).
  if (!input.customerId && slotLocal.date !== localParts(new Date(), tzRows[0]?.timezone || 'UTC').date) {
    throw new Error(msg('errors:booking.aWalkInCanOnlyBe'));
  }
  if (locationId) {
    const bookingDate = slotLocal.date;
    const dayOfWeek = slotLocal.dayOfWeek;
    const slotMins = slotLocal.startMinutes;
    const endMins = slotLocal.endMinutes;

    // Check holiday overrides first
    const { rows: overrides } = await adminPool.query(
      'SELECT * FROM sys_location_hour_overrides WHERE location_id = $1 AND override_date = $2',
      [locationId, bookingDate],
    );
    if (overrides.length > 0) {
      const override = overrides[0];
      if (override.is_closed) {
        throw new Error(msg('errors:booking.businessIsClosedOnThisDate'));
      }
      if (override.open_time && override.close_time) {
        const [oh, om] = override.open_time.split(':').map(Number);
        if (slotMins < oh * 60 + om || endMins > endOfDayMinutes(override.close_time)) {
          throw new Error(msg('errors:booking.appointmentTimeIsOutsideBusinessHours'));
        }
      }
    } else {
      // Check normal business hours
      const { rows: hours } = await adminPool.query(
        'SELECT * FROM sys_location_hours WHERE location_id = $1 AND day_of_week = $2',
        [locationId, dayOfWeek],
      );
      if (hours.length > 0) {
        const bh = hours[0];
        if (bh.is_closed) {
          throw new Error(msg('errors:booking.businessIsClosedOnThisDay'));
        }
        if (bh.open_time && bh.close_time) {
          const [oh, om] = bh.open_time.split(':').map(Number);
          if (slotMins < oh * 60 + om || endMins > endOfDayMinutes(bh.close_time)) {
            throw new Error(msg('errors:booking.appointmentTimeIsOutsideBusinessHours2'));
          }
        }
      }
    }
  }

  // Staff hours (shifts or availability patterns): nothing set up for the person = no limit.
  if (input.staffId && !input.overrideRules) {
    const refusal = await staffHoursRefusal(input.businessId, input.staffId, slotLocal);
    if (refusal) throw new Error(refusal);
  }

  // The service's own availability (its availability rules): no rule = no limit.
  if (!input.overrideRules) {
    const { rows: rules } = await adminPool.query('SELECT * FROM svc_availability_rules WHERE service_id = $1', [input.serviceId]);
    const windows = getServiceHoursForDay(rules, slotLocal.dayOfWeek, slotLocal.date);
    const fits = windows.some((w) => slotLocal.startMinutes >= w.start && slotLocal.endMinutes <= w.end
      && (!w.staffIds || !input.staffId || w.staffIds.includes(input.staffId))
      && (!w.locationIds || !locationId || w.locationIds.includes(locationId)));
    if (!fits) throw new Error(msg('errors:booking.theServiceIsNotOfferedAt'));
  }
  // The provider's daily booking limit (Business Setup → staff → capacity).
  if (input.staffId && !input.overrideRules) {
    const { rows: cap } = await adminPool.query(
      `SELECT COALESCE(o.max_bookings, c.max_bookings_per_day) AS max_per_day
         FROM stf_profiles sp
         LEFT JOIN stf_capacity_config c ON c.staff_id = sp.id
         LEFT JOIN stf_capacity_overrides o ON o.staff_id = sp.id AND o.override_date = $2::date
        WHERE sp.user_id = $1 LIMIT 1`,
      [input.staffId, slotLocal.date],
    );
    const maxPerDay = cap[0]?.max_per_day;
    if (maxPerDay !== null && maxPerDay !== undefined) {
      const { rows: dayCount } = await adminPool.query(
        `SELECT COUNT(*)::int AS n FROM apt_bookings
          WHERE staff_id = $1 AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed')
            AND (start_time AT TIME ZONE $3)::date = $2::date
            AND ($4::uuid IS NULL OR id <> $4)`,
        [input.staffId, slotLocal.date, tzRows[0]?.timezone || 'UTC', excludedId()],
      );
      if (dayCount[0].n >= maxPerDay) {
        throw new Error(msg('errors:booking.staffMemberHasReachedTheirLimit', { maxPerDay }));
      }
    }
  }

  // Resolve staff (auto-assign if not provided for individual bookings)
  let staffId = input.staffId || null;
  if (!staffId && bookingType === 'individual') {
    staffId = await autoAssignStaff(input.serviceId, input.businessId, startTime, endTime, bufferBefore, bufferAfter);
    if (!staffId) throw new Error(msg('errors:booking.noStaffAvailableForTheSelected'));
  }

  // Conflict detection (skip staff conflict for shared/group and non-dedicated services)
  if (staffId && bookingType === 'individual' && service.requires_dedicated_staff !== false) {
    const staffConflict = await checkStaffConflict(staffId, startTime, endTime, bufferBefore, bufferAfter);
    if (staffConflict) throw new Error(msg('errors:booking.staffMemberHasAConflictingBooking'));
  }

  // Auto-assign resource if not provided but service availability rules require one
  let resourceId = input.resourceId || null;
  if (!resourceId) {
    const { rows: availRules } = await adminPool.query(
      `SELECT resource_ids FROM svc_availability_rules WHERE service_id = $1 AND rule_type = 'recurring' AND resource_ids IS NOT NULL LIMIT 1`,
      [input.serviceId],
    );
    if (availRules.length > 0 && availRules[0].resource_ids && availRules[0].resource_ids.length > 0) {
      const requiredResourceIds: string[] = availRules[0].resource_ids;
      // Find an available resource with enough remaining headcount for this booking
      for (const resId of requiredResourceIds) {
        const remaining = await getResourceRemainingCapacity(resId, startTime, endTime);
        if (remaining >= participantCount) {
          resourceId = resId;
          break;
        }
      }
      if (!resourceId && !input.overrideRules) throw new Error(msg('errors:booking.resourceHasAConflictingBookingAt'));
      if (!resourceId) resourceId = requiredResourceIds[0]; // override: still need *a* resource on the row
    }
  }

  // The resource the service requires on the Resources page (see required-resources.service).
  const businessTimeZone = tzRows[0]?.timezone || 'UTC';
  if (!resourceId) {
    const alternatives = await requiredResourceAlternatives(input.serviceId, input.variantId, input.businessId);
    if (alternatives.length > 0) {
      const maintenance = await loadMaintenance(alternatives);
      for (const resId of alternatives) {
        if (underMaintenance(maintenance, resId, startTime, endTime, businessTimeZone)) continue;
        if ((await getResourceRemainingCapacity(resId, startTime, endTime)) >= participantCount) { resourceId = resId; break; }
      }
      if (!resourceId && !input.overrideRules) throw new Error(msg('errors:booking.resourceHasAConflictingBookingAt'));
      if (!resourceId) resourceId = alternatives[0];
    }
  } else if (!input.overrideRules) {
    const maintenance = await loadMaintenance([resourceId]);
    if (underMaintenance(maintenance, resourceId, startTime, endTime, businessTimeZone)) {
      throw new Error(msg('errors:booking.resourceIsUnderMaintenanceAtThis'));
    }
  }

  // The resource's own hours (its schedule and closures; "Available 24/7" overrides the schedule).
  // A resource with no schedule is not limited.
  if (resourceId && !input.overrideRules) {
    const resHours = await loadResourceHours([resourceId]);
    if (!resourceOpen(resHours, resourceId, startTime, endTime, businessTimeZone)) {
      throw new Error(msg('errors:booking.theResourceIsNotAvailableAt'));
    }
  }

  if (resourceId) {
    const remaining = await getResourceRemainingCapacity(resourceId, startTime, endTime);
    if (participantCount > remaining) {
      if (!input.overrideRules) {
        throw new Error(msg('errors:booking.onlySpotSRemainingExceedsResource', { Math: Math.max(remaining, 0) }));
      }
      // overrideRules: allow through. The booking is still inserted with its real
      // participant_count below, so this time window now correctly reads as over capacity
      // for anyone else computing remaining/fill-state afterwards — that's the highlight signal
      // the calendar (feature 31) uses, no separate flag needed.
    }
  }

  // For shared/group: check capacity
  if (bookingType === 'shared' || bookingType === 'group') {
    const capacity = service.max_capacity || 1;
    // Shared rooms (CAL-17): people in the room at the same moment, whatever their start times.
    // Group sessions: the bookings at the same start time.
    const { rows: sessRows } = await adminPool.query(
      `SELECT start_time, end_time, participant_count FROM apt_bookings
       WHERE service_id = $1 AND business_id = $2
         AND ${bookingType === 'shared' ? 'start_time < $5 AND end_time > $3' : 'start_time = $3'}
         AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')
         AND ($4::uuid IS NULL OR id <> $4)`,
      [input.serviceId, input.businessId, startTime.toISOString(), excludedId(), ...(bookingType === 'shared' ? [endTime.toISOString()] : [])],
    );
    const taken = bookingType === 'shared' ? peakParticipants(sessRows, startTime, endTime) : sessRows.reduce((n: number, r: any) => n + (r.participant_count || 1), 0);
    if (taken + participantCount > capacity) {
      const left = Math.max(capacity - taken, 0);
      throw new Error(left === 0 ? 'Session is at full capacity' : `Only ${left} place(s) left in this session — exceeds its capacity`);
    }
  }

  // Customer conflict check (skip for walk-ins)
  if (input.customerId) {
    const customerConflict = await checkCustomerConflict(input.customerId, startTime, endTime);
    if (customerConflict) throw new Error(msg('errors:booking.customerHasAConflictingBookingAt'));
  }

  if (input.dryRun) {
    return {
      start_time: startTime.toISOString(), end_time: endTime.toISOString(), price, staff_id: staffId,
      resource_id: resourceId, booking_type: bookingType, participant_count: participantCount,
    };
  }

  // Generate booking reference
  const { rows: refRows } = await adminPool.query(
    'SELECT generate_booking_reference($1) AS ref',
    [input.businessId],
  );
  const bookingReference = refRows[0].ref;

  // Determine initial status (auto-confirm unless the caller explicitly asks for 'pending' —
  // used by the widget when a business requires payment before confirmation, spec 38)
  const status = input.initialStatus || 'confirmed';

  // Insert booking (its location: the one chosen, else the business's primary location)
  const bookingLocationId = locationId || (await adminPool.query(
    "SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1", [input.businessId],
  )).rows[0]?.id || null;
  const { rows } = await adminPool.query(
    `INSERT INTO apt_bookings (business_id, customer_id, walk_in_name, service_id, variant_id, staff_id, resource_id,
       start_time, end_time, buffer_before, buffer_after, status, booking_reference, booking_type, price, notes, created_by, participant_count, source, location_id,
       payment_method_id, card_saved_at, card_saved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
       $21::uuid, CASE WHEN $21::uuid IS NULL THEN NULL ELSE NOW() END, CASE WHEN $21::uuid IS NULL THEN NULL ELSE $17::uuid END)
     RETURNING *`,
    [
      input.businessId, input.customerId || null, input.walkInName || null, input.serviceId, input.variantId,
      staffId, resourceId,
      startTime.toISOString(), endTime.toISOString(),
      bufferBefore, bufferAfter, status, bookingReference, bookingType, price,
      input.notes || null, input.createdBy, participantCount, input.source || 'admin', bookingLocationId,
      input.heldCardId || null,
    ],
  );

  const booking = rows[0];

  // A new booking counts as activity for the person (Phase 46).
  if (booking.customer_id) await touchActivity(booking.customer_id).catch(() => undefined);

  // Record status history
  // The appointment's history (spec 51, gap 18): created, by whom and from where.
  const { recordStatus } = await import('./booking-history.service');
  await recordStatus(booking.id, null, status, { userId: input.createdBy || null });

  // Its add-ons, before the confirmation is queued so the email lists them (spec 51, gap 15).
  if (input.addonIds && input.addonIds.length > 0) {
    const { setBookingAddons } = await import('./addons.service');
    const { snapshotBooking, recordChanges } = await import('./booking-history.service');
    const before = await snapshotBooking(booking.id);
    await setBookingAddons(booking.id, input.businessId, input.addonIds, input.createdBy || null);
    await recordChanges(booking.id, before, { userId: input.createdBy || null });
  }

  // Log in customer activity timeline (skip for walk-ins)
  if (input.customerId) {
    await createActivity({
      customerId: input.customerId,
      businessId: input.businessId,
      activityType: 'booking',
      description: `Booked: ${service.name} (${bookingReference})`,
      metadata: { booking_id: booking.id, service_id: input.serviceId, start_time: startTime.toISOString() },
      createdBy: input.createdBy,
    });
    // A booking can move the person on (lead → new customer, at risk → active, former → winback).
    // This was written but never called, so stages only ever changed by hand or overnight.
    await evaluateOnBooking(input.customerId, input.businessId)
      .catch((e) => console.error('[Booking] Lifecycle not evaluated:', e?.message || e));
  }

  // Audit
  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'booking.created',
    resourceType: 'booking',
    resourceId: booking.id,
    details: { reference: bookingReference, service: service.name, customer_id: input.customerId },
  });

  // Remove any slot hold for this time
  await adminPool.query(
    `DELETE FROM apt_slot_holds WHERE business_id = $1 AND service_id = $2 AND start_time = $3 AND held_by = $4`,
    [input.businessId, input.serviceId, startTime.toISOString(), input.createdBy],
  );

  logger.info('Booking created', { bookingId: booking.id, reference: bookingReference });

  // Appointment confirmation (born-confirmed paths: admin/staff create). Only when
  // the booking is actually confirmed on creation, has a customer with an email,
  // and the caller didn't suppress it (walk-ins, recurring series, widget's own
  // flow). pending bookings confirm later via confirmBooking, which fires there.
  // Hydrate via getBookingById so service/staff names populate. Non-blocking.
  if (status === 'confirmed' && booking.customer_id && !input.suppressConfirmation) {
    getBookingById(booking.id, input.businessId)
      .then((full) => {
        if (full?.customer_email) return queueBookingConfirmation(full, full.customer_email);
      })
      .catch((e) => logger.warn(`Booking ${bookingReference}: confirmation enqueue failed: ${e?.message || e}`));
  }

  return booking;
}

/**
 * List bookings with filters.
 */
// The bookings list's filterable columns (keys as the table's columns).
const BOOKING_TZ = "COALESCE((SELECT bz.timezone FROM sys_businesses bz WHERE bz.id = b.business_id), 'UTC')";
const personName = (table: string, id: string) =>
  `(SELECT NULLIF(BTRIM(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')), '') FROM ${table} x WHERE x.id = ${id})`;
const BOOKING_COLUMNS: Record<string, FilterableColumn> = {
  booking_reference: { expr: 'b.booking_reference' },
  customer_first_name: { expr: 'b.customer_id', label: personName('cus_customers', 'b.customer_id') },
  service_name: { expr: 'b.service_id', label: '(SELECT sv2.name FROM svc_services sv2 WHERE sv2.id = b.service_id)' },
  start_time: { expr: 'b.start_time', kind: 'date' },
  status: { expr: 'b.status' },
  staff_first_name: { expr: 'b.staff_id', label: personName('usr_users', 'b.staff_id') },
};

/** Every value of one bookings column (with counts) among the bookings matching the other filters. */
export async function getBookingColumnValues(filters: BookingFilters, column: string) {
  const col = BOOKING_COLUMNS[column];
  if (!col || col.kind === 'date') return [];
  const { [column]: _own, ...others } = filters.columns || {};
  const conditions = ['b.business_id = $1']; const params: any[] = [filters.businessId];
  if (filters.customerId) { params.push(filters.customerId); conditions.push(`b.customer_id = $${params.length}`); }
  addColumnFilterConditions(others, BOOKING_COLUMNS, conditions, params, BOOKING_TZ);
  const { rows } = await adminPool.query(columnValuesSql(col, 'apt_bookings b', conditions.join(' AND ')), params);
  return rows as Array<{ value: string; label: string; count: number }>;
}

export async function getBookings(filters: BookingFilters) {
  const conditions = ['b.business_id = $1'];
  const params: any[] = [filters.businessId];
  let paramIndex = 2;

  if (filters.status) {
    conditions.push(`b.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.customerId) {
    conditions.push(`b.customer_id = $${paramIndex++}`);
    params.push(filters.customerId);
  }

  if (filters.customerSearch) {
    conditions.push(`b.customer_id IN (SELECT id FROM cus_customers WHERE (first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR CONCAT(first_name, ' ', last_name) ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR COALESCE(phone, '') ILIKE $${paramIndex}))`);
    params.push(`%${filters.customerSearch}%`);
    paramIndex++;
  }

  if (filters.staffId) {
    conditions.push(`b.staff_id = $${paramIndex++}`);
    params.push(filters.staffId);
  }

  if (filters.serviceId) {
    conditions.push(`b.service_id = $${paramIndex++}`);
    params.push(filters.serviceId);
  }

  if (filters.dateFrom) {
    conditions.push(`(b.start_time AT TIME ZONE ${BOOKING_TZ})::date >= $${paramIndex}::date`);
    params.push(filters.dateFrom);
    paramIndex++;
  }

  if (filters.dateTo) {
    conditions.push(`(b.start_time AT TIME ZONE ${BOOKING_TZ})::date <= $${paramIndex}::date`);
    params.push(filters.dateTo);
    paramIndex++;
  }

  if (filters.columns) addColumnFilterConditions(filters.columns, BOOKING_COLUMNS, conditions, params, BOOKING_TZ);

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT b.*, s.name AS service_name, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              u.first_name AS staff_first_name, u.last_name AS staff_last_name,
              sv.no_show_fee,
              -- the add-ons, for '+ Hot stones' after the service (spec 51, gap 15)
              (SELECT string_agg(ba.name, ', ' ORDER BY ba.created_at) FROM apt_booking_addons ba
                WHERE ba.booking_id = b.id AND ba.status = 'active') AS addon_names
       FROM apt_bookings b
       JOIN svc_services s ON s.id = b.service_id
       LEFT JOIN svc_variants sv ON sv.id = b.variant_id
       LEFT JOIN cus_customers c ON c.id = b.customer_id
       LEFT JOIN usr_users u ON u.id = b.staff_id
       WHERE ${where}
       ORDER BY b.start_time ${filters.order === 'desc' ? 'DESC' : 'ASC'}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM apt_bookings b WHERE ${where}`, params),
  ]);

  return {
    bookings: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * The waiting list (spec 51, gap 3): customers who checked in today and whose session has not started,
 * longest wait first, with the forms they still have to complete. Walk-ins by name are included.
 */
export async function getWaitingList(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.walk_in_name, b.checked_in_at, b.ready_at, b.start_time,
            s.name AS service_name,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
       FROM apt_bookings b
       JOIN sys_businesses bus ON bus.id = b.business_id
       JOIN svc_services s ON s.id = b.service_id
       LEFT JOIN cus_customers c ON c.id = b.customer_id
       LEFT JOIN usr_users u ON u.id = b.staff_id
      WHERE b.business_id = $1 AND b.status = 'checked_in' AND b.checked_in_at IS NOT NULL
        AND (b.checked_in_at AT TIME ZONE COALESCE(bus.timezone, 'UTC'))::date = (NOW() AT TIME ZONE COALESCE(bus.timezone, 'UTC'))::date
      ORDER BY b.checked_in_at ASC
      LIMIT 100`,
    [businessId],
  );
  const { countOutstandingForBookings } = await import('./form-status.service');
  const outstanding = await countOutstandingForBookings(businessId, rows.filter((r) => r.customer_id).map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_first_name ? `${r.customer_first_name} ${r.customer_last_name ?? ''}`.trim() : (r.walk_in_name || 'Walk-in'),
    service_name: r.service_name,
    staff_name: r.staff_first_name ? `${r.staff_first_name} ${r.staff_last_name ?? ''}`.trim() : null,
    start_time: r.start_time,
    checked_in_at: r.checked_in_at,
    ready_at: r.ready_at,
    forms_outstanding: outstanding[r.id]?.count ?? 0,
  }));
}
/**
 * Get a single booking by ID.
 */
export async function getBookingById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT b.*, s.name AS service_name, sv.name AS variant_name,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
     JOIN svc_variants sv ON sv.id = b.variant_id
     LEFT JOIN cus_customers c ON c.id = b.customer_id
     LEFT JOIN usr_users u ON u.id = b.staff_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [id, businessId],
  );

  if (rows.length === 0) return null;

  // Load status history
  const { rows: history } = await adminPool.query(
    'SELECT * FROM apt_booking_status_history WHERE booking_id = $1 ORDER BY created_at',
    [id],
  );

  // The paid orders of this appointment (paid at reservation, at check-out, extras, fees), for their receipts.
  const { rows: paidOrders } = await adminPool.query(
    `SELECT id, order_number, status, total_amount, completed_at FROM fin_orders
      WHERE booking_id = $1 AND business_id = $2 AND status IN ('completed', 'refunded', 'partially_refunded')
      ORDER BY completed_at`,
    [id, businessId],
  );
  // Its add-ons, with the price each had when chosen (spec 51, gap 15).
  const { bookingAddons } = await import('./addons.service');
  return { ...rows[0], status_history: history, paid_orders: paidOrders, addons: await bookingAddons(id) };
}

// --- Helpers ---

/**
 * Why a staff member cannot take a slot, or null when they can (spec 51: nothing set up = no limit).
 * Schedule mode: a shift must cover it; no shift that day = not working. Availability mode: a date
 * override wins; else the weekday pattern, if the person has any pattern at all.
 */
const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

async function staffHoursRefusal(businessId: string, staffUserId: string, slot: { date: string; dayOfWeek: number; startMinutes: number; endMinutes: number }): Promise<string | null> {
  const { rows: biz } = await adminPool.query('SELECT scheduling_mode FROM sys_businesses WHERE id = $1', [businessId]);
  const within = (start: string, end: string) => slot.startMinutes >= toMin(start) && slot.endMinutes <= endOfDayMinutes(end);
  if ((biz[0]?.scheduling_mode || 'availability') === 'schedule') {
    const { rows } = await adminPool.query(
      `SELECT e.start_time, e.end_time FROM stf_schedule_entries e JOIN stf_profiles sp ON sp.id = e.staff_id
        WHERE sp.user_id = $1 AND e.schedule_date = $2 AND e.entry_type = 'shift'`, [staffUserId, slot.date]);
    if (rows.length === 0) return 'Staff member is not scheduled to work on this date';
    return rows.some((e: any) => within(e.start_time, e.end_time)) ? null : 'Appointment time is outside the staff member\'s shift';
  }
  const { rows: prof } = await adminPool.query('SELECT id FROM stf_profiles WHERE user_id = $1 LIMIT 1', [staffUserId]);
  if (!prof[0]) return null;
  const { rows: ov } = await adminPool.query(
    'SELECT override_type, start_time, end_time FROM stf_availability_overrides WHERE staff_id = $1 AND override_date = $2', [prof[0].id, slot.date]);
  if (ov[0]) {
    if (ov[0].override_type === 'remove') return 'Staff member is not available on this date';
    if ((ov[0].override_type === 'modify' || ov[0].override_type === 'add') && ov[0].start_time && ov[0].end_time) {
      return within(ov[0].start_time, ov[0].end_time) ? null : 'Appointment time is outside the staff member\'s availability for this date';
    }
    return null;
  }
  const { rows: pats } = await adminPool.query(
    `SELECT ps.day_of_week, ps.start_time, ps.end_time FROM stf_availability_pattern_slots ps
       JOIN stf_availability_patterns p ON p.id = ps.pattern_id WHERE p.staff_id = $1 AND p.is_default = true`, [prof[0].id]);
  if (pats.length === 0) return null; // no pattern at all = no restriction
  const day = pats.filter((p: any) => p.day_of_week === slot.dayOfWeek);
  if (day.length === 0) return 'Staff member does not work on this day';
  return day.some((p: any) => within(p.start_time, p.end_time)) ? null : 'Appointment time is outside the staff member\'s availability hours';
}

async function autoAssignStaff(
  serviceId: string, businessId: string, startTime: Date, endTime: Date, bufferBefore: number, bufferAfter: number,
): Promise<string | null> {
  // Get all assigned staff, pick the one with the fewest bookings on that day (round-robin-ish)
  const { rows: staff } = await adminPool.query(
    `SELECT ss.user_id FROM svc_staff ss WHERE ss.service_id = $1`,
    [serviceId],
  );

  for (const s of staff) {
    const conflict = await checkStaffConflict(s.user_id, startTime, endTime, bufferBefore, bufferAfter);
    if (!conflict) return s.user_id;
  }

  return null;
}

async function checkStaffConflict(staffId: string, startTime: Date, endTime: Date, bufferBefore: number, bufferAfter: number): Promise<boolean> {
  const blockStart = new Date(startTime.getTime() - bufferBefore * 60 * 1000);
  const blockEnd = new Date(endTime.getTime() + bufferAfter * 60 * 1000);

  const { rows } = await adminPool.query(
    `SELECT id FROM apt_bookings
     WHERE staff_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')
       AND ($4::uuid IS NULL OR id <> $4)
     LIMIT 1`,
    [staffId, blockStart.toISOString(), blockEnd.toISOString(), excludedId()],
  );

  if (rows.length > 0) return true;

  // Also check slot holds
  const { rows: holds } = await adminPool.query(
    `SELECT id FROM apt_slot_holds
     WHERE staff_id = $1
       AND start_time < $3
       AND end_time > $2
       AND expires_at > NOW()
     LIMIT 1`,
    [staffId, blockStart.toISOString(), blockEnd.toISOString()],
  );

  return holds.length > 0;
}

/**
 * Remaining capacity (in participants) for a resource across a proposed time window, accounting
 * for real interval overlap and each existing booking's actual participant_count — not just a
 * count of overlapping booking rows. Replaces the old boolean-only checkResourceConflict; used
 * both for auto-assigning a resource and for gating/reporting capacity on the chosen one.
 */
async function getResourceRemainingCapacity(resourceId: string, startTime: Date, endTime: Date): Promise<number> {
  // Get resource capacity
  const { rows: resRows } = await adminPool.query(
    'SELECT capacity FROM res_resources WHERE id = $1', [resourceId],
  );
  const capacity = resRows[0]?.capacity || 1;

  // Get overlapping bookings
  const { rows: overlapping } = await adminPool.query(
    `SELECT start_time, end_time, participant_count FROM apt_bookings
     WHERE resource_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')
       AND ($4::uuid IS NULL OR id <> $4)`,
    [resourceId, startTime.toISOString(), endTime.toISOString(), excludedId()],
  );

  if (overlapping.length === 0) return capacity;

  // Max concurrent *headcount* at any point within the proposed slot — sample at each
  // overlapping booking's start/end boundaries and sum participant_count.
  const checkPoints = [startTime.getTime()];
  for (const ob of overlapping) {
    const obStart = new Date(ob.start_time).getTime();
    const obEnd = new Date(ob.end_time).getTime();
    if (obStart > startTime.getTime() && obStart < endTime.getTime()) checkPoints.push(obStart);
    if (obEnd > startTime.getTime() && obEnd < endTime.getTime()) checkPoints.push(obEnd - 1);
  }
  const maxConcurrentParticipants = checkPoints.reduce((max, t) => {
    const concurrent = overlapping
      .filter((ob: any) => new Date(ob.start_time).getTime() <= t && new Date(ob.end_time).getTime() > t)
      .reduce((sum: number, ob: any) => sum + (ob.participant_count || 1), 0);
    return Math.max(max, concurrent);
  }, 0);
  return capacity - maxConcurrentParticipants;
}

async function checkCustomerConflict(customerId: string, startTime: Date, endTime: Date): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT id FROM apt_bookings
     WHERE customer_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')
       AND ($4::uuid IS NULL OR id <> $4)
     LIMIT 1`,
    [customerId, startTime.toISOString(), endTime.toISOString(), excludedId()],
  );
  return rows.length > 0;
}
