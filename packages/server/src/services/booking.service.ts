import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { calculatePrice } from './pricing.service';
import { logger } from '../middleware/logger';

interface CreateBookingInput {
  businessId: string;
  customerId?: string;
  walkInName?: string;
  serviceId: string;
  variantId: string;
  staffId?: string;
  resourceId?: string;
  startTime: string;     // ISO 8601
  notes?: string;
  createdBy: string;
  tenantId: string;
  overrideRules?: boolean;  // staff can override lead time, staff hours, AND resource capacity
  participantCount?: number; // headcount this booking occupies on its resource; default 1
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
  page?: number;
  limit?: number;
}

/**
 * Create a booking.
 */
export async function createBooking(input: CreateBookingInput) {
  // Load service + variant
  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sv.duration, sv.price, sv.pricing_model
     FROM svc_services s
     JOIN svc_variants sv ON sv.service_id = s.id AND sv.id = $2
     WHERE s.id = $1 AND s.business_id = $3`,
    [input.serviceId, input.variantId, input.businessId],
  );

  if (svcRows.length === 0) throw new Error('Service or variant not found');

  const service = svcRows[0];
  const duration = service.duration;
  const basePrice = service.price;
  const bookingType = service.booking_type;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;

  const startTime = new Date(input.startTime);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
  const participantCount = input.participantCount && input.participantCount >= 1 ? Math.floor(input.participantCount) : 1;

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
  if (!input.overrideRules) {
    const minAdvanceMs = (service.min_advance_booking_hours || 2) * 60 * 60 * 1000;
    if (startTime.getTime() - Date.now() < minAdvanceMs) {
      throw new Error('Booking is within the minimum advance booking window');
    }
  }

  // Check business hours (location hours + holiday overrides)
  const { rows: locRows } = await adminPool.query(
    "SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active' AND is_primary = true LIMIT 1",
    [input.businessId],
  );
  const locationId = locRows[0]?.id;
  if (locationId) {
    const bookingDate = startTime.toISOString().split('T')[0];
    const dayOfWeek = startTime.getUTCDay();
    const slotMins = startTime.getUTCHours() * 60 + startTime.getUTCMinutes();
    const endMins = endTime.getUTCHours() * 60 + endTime.getUTCMinutes();

    // Check holiday overrides first
    const { rows: overrides } = await adminPool.query(
      'SELECT * FROM sys_location_hour_overrides WHERE location_id = $1 AND override_date = $2',
      [locationId, bookingDate],
    );
    if (overrides.length > 0) {
      const override = overrides[0];
      if (override.is_closed) {
        throw new Error('Business is closed on this date (holiday)');
      }
      if (override.open_time && override.close_time) {
        const [oh, om] = override.open_time.split(':').map(Number);
        const [ch, cm] = override.close_time.split(':').map(Number);
        if (slotMins < oh * 60 + om || endMins > ch * 60 + cm) {
          throw new Error('Appointment time is outside business hours for this date');
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
          throw new Error('Business is closed on this day');
        }
        if (bh.open_time && bh.close_time) {
          const [oh, om] = bh.open_time.split(':').map(Number);
          const [ch, cm] = bh.close_time.split(':').map(Number);
          if (slotMins < oh * 60 + om || endMins > ch * 60 + cm) {
            throw new Error('Appointment time is outside business hours');
          }
        }
      }
    }
  }

  // Check staff working hours (schedule mode vs availability mode)
  if (input.staffId && !input.overrideRules) {
    const { rows: bizRows } = await adminPool.query(
      'SELECT scheduling_mode FROM sys_businesses WHERE id = $1',
      [input.businessId],
    );
    const schedulingMode = bizRows[0]?.scheduling_mode || 'availability';
    const bookingDate = startTime.toISOString().split('T')[0];
    const dayOfWeek = startTime.getUTCDay();
    const slotMins = startTime.getUTCHours() * 60 + startTime.getUTCMinutes();
    const endMins = endTime.getUTCHours() * 60 + endTime.getUTCMinutes();

    if (schedulingMode === 'schedule') {
      // Check if staff has a schedule entry covering this time
      const { rows: schedEntries } = await adminPool.query(
        `SELECT e.start_time, e.end_time FROM stf_schedule_entries e
         JOIN stf_profiles sp ON sp.id = e.staff_id
         WHERE sp.user_id = $1 AND e.schedule_date = $2 AND e.entry_type = 'shift'`,
        [input.staffId, bookingDate],
      );
      if (schedEntries.length === 0) {
        throw new Error('Staff member is not scheduled to work on this date');
      }
      const isWithinShift = schedEntries.some((e: any) => {
        const [sh, sm] = e.start_time.split(':').map(Number);
        const [eh, em] = e.end_time.split(':').map(Number);
        return slotMins >= sh * 60 + sm && endMins <= eh * 60 + em;
      });
      if (!isWithinShift) {
        throw new Error('Appointment time is outside staff scheduled shift');
      }
    } else {
      // Check availability patterns + overrides
      const { rows: profileRows } = await adminPool.query(
        'SELECT id FROM stf_profiles WHERE user_id = $1 LIMIT 1', [input.staffId],
      );
      if (profileRows.length > 0) {
        const staffProfileId = profileRows[0].id;

        // Check overrides first
        const { rows: overrideRows } = await adminPool.query(
          'SELECT * FROM stf_availability_overrides WHERE staff_id = $1 AND override_date = $2',
          [staffProfileId, bookingDate],
        );
        if (overrideRows.length > 0) {
          const override = overrideRows[0];
          if (override.override_type === 'remove') {
            throw new Error('Staff member is not available on this date');
          }
          if ((override.override_type === 'modify' || override.override_type === 'add') && override.start_time && override.end_time) {
            const [oh, om] = override.start_time.split(':').map(Number);
            const [ch, cm] = override.end_time.split(':').map(Number);
            if (slotMins < oh * 60 + om || endMins > ch * 60 + cm) {
              throw new Error('Appointment time is outside staff availability for this date');
            }
          }
        } else {
          // Check pattern for this day of week
          const { rows: patternSlots } = await adminPool.query(
            `SELECT ps.start_time, ps.end_time FROM stf_availability_pattern_slots ps
             JOIN stf_availability_patterns p ON p.id = ps.pattern_id
             WHERE p.staff_id = $1 AND p.is_default = true AND ps.day_of_week = $2`,
            [staffProfileId, dayOfWeek],
          );
          if (patternSlots.length > 0) {
            const isAvailable = patternSlots.some((s: any) => {
              const [sh, sm] = s.start_time.split(':').map(Number);
              const [eh, em] = s.end_time.split(':').map(Number);
              return slotMins >= sh * 60 + sm && endMins <= eh * 60 + em;
            });
            if (!isAvailable) {
              throw new Error('Appointment time is outside staff availability hours');
            }
          }
        }
      }
    }
  }

  // Resolve staff (auto-assign if not provided for individual bookings)
  let staffId = input.staffId || null;
  if (!staffId && bookingType === 'individual') {
    staffId = await autoAssignStaff(input.serviceId, input.businessId, startTime, endTime, bufferBefore, bufferAfter);
    if (!staffId) throw new Error('No staff available for the selected time');
  }

  // Conflict detection (skip staff conflict for shared/group and non-dedicated services)
  if (staffId && bookingType === 'individual' && service.requires_dedicated_staff !== false) {
    const staffConflict = await checkStaffConflict(staffId, startTime, endTime, bufferBefore, bufferAfter);
    if (staffConflict) throw new Error('Staff member has a conflicting booking at this time');
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
      if (!resourceId && !input.overrideRules) throw new Error('Resource has a conflicting booking at this time');
      if (!resourceId) resourceId = requiredResourceIds[0]; // override: still need *a* resource on the row
    }
  }

  if (resourceId) {
    const remaining = await getResourceRemainingCapacity(resourceId, startTime, endTime);
    if (participantCount > remaining) {
      if (!input.overrideRules) {
        throw new Error(`Only ${Math.max(remaining, 0)} spot(s) remaining — exceeds resource capacity for this slot`);
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
    const { rows: countRows } = await adminPool.query(
      `SELECT COUNT(*)::int AS count FROM apt_bookings
       WHERE service_id = $1 AND business_id = $2
         AND start_time = $3 AND status IN ('pending', 'confirmed', 'in_progress')`,
      [input.serviceId, input.businessId, startTime.toISOString()],
    );
    if (countRows[0].count >= capacity) {
      throw new Error('Session is at full capacity');
    }
  }

  // Customer conflict check (skip for walk-ins)
  if (input.customerId) {
    const customerConflict = await checkCustomerConflict(input.customerId, startTime, endTime);
    if (customerConflict) throw new Error('Customer has a conflicting booking at this time');
  }

  // Generate booking reference
  const { rows: refRows } = await adminPool.query(
    'SELECT generate_booking_reference($1) AS ref',
    [input.businessId],
  );
  const bookingReference = refRows[0].ref;

  // Determine initial status (auto-confirm if configured)
  const status = 'confirmed'; // For now, auto-confirm

  // Insert booking
  const { rows } = await adminPool.query(
    `INSERT INTO apt_bookings (business_id, customer_id, walk_in_name, service_id, variant_id, staff_id, resource_id,
       start_time, end_time, buffer_before, buffer_after, status, booking_reference, booking_type, price, notes, created_by, participant_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      input.businessId, input.customerId || null, input.walkInName || null, input.serviceId, input.variantId,
      staffId, resourceId,
      startTime.toISOString(), endTime.toISOString(),
      bufferBefore, bufferAfter, status, bookingReference, bookingType, price,
      input.notes || null, input.createdBy, participantCount,
    ],
  );

  const booking = rows[0];

  // Record status history
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [booking.id, status, input.createdBy],
  );

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

  return booking;
}

/**
 * List bookings with filters.
 */
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
    conditions.push(`b.start_time >= $${paramIndex}::date`);
    params.push(filters.dateFrom);
    paramIndex++;
  }

  if (filters.dateTo) {
    conditions.push(`b.start_time < ($${paramIndex}::date + interval '1 day')`);
    params.push(filters.dateTo);
    paramIndex++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT b.*, s.name AS service_name, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              u.first_name AS staff_first_name, u.last_name AS staff_last_name
       FROM apt_bookings b
       JOIN svc_services s ON s.id = b.service_id
       LEFT JOIN cus_customers c ON c.id = b.customer_id
       LEFT JOIN usr_users u ON u.id = b.staff_id
       WHERE ${where}
       ORDER BY b.start_time ASC
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

  return { ...rows[0], status_history: history };
}

// --- Helpers ---

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
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [staffId, blockStart.toISOString(), blockEnd.toISOString()],
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
       AND status IN ('pending', 'confirmed', 'in_progress')`,
    [resourceId, startTime.toISOString(), endTime.toISOString()],
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
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [customerId, startTime.toISOString(), endTime.toISOString()],
  );
  return rows.length > 0;
}
