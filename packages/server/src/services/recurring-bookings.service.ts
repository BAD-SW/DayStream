import { adminPool } from '../db/pool';
import { createBooking } from './booking.service';
import { logger } from '../middleware/logger';

interface CreateRecurringInput {
  businessId: string;
  customerId: string;
  serviceId: string;
  variantId: string;
  staffId?: string;
  recurrencePattern: 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek?: number;       // 0-6 for weekly/biweekly
  dayOfMonth?: number;      // 1-31 for monthly
  startTime: string;        // HH:MM
  endType: 'ongoing' | 'count' | 'date';
  endCount?: number;
  endDate?: string;
  createdBy: string;
  tenantId: string;
}

interface GenerationResult {
  created: number;
  skipped: number;
  conflicts: string[];      // dates that had conflicts
}

/**
 * Create a recurring booking series and generate initial instances.
 */
export async function createRecurringSeries(input: CreateRecurringInput): Promise<{ series: any; generation: GenerationResult }> {
  // Validate
  if ((input.recurrencePattern === 'weekly' || input.recurrencePattern === 'biweekly') && input.dayOfWeek === undefined) {
    throw new Error('day_of_week is required for weekly/biweekly patterns');
  }
  if (input.recurrencePattern === 'monthly' && !input.dayOfMonth) {
    throw new Error('day_of_month is required for monthly patterns');
  }

  // Create series record
  const { rows } = await adminPool.query(
    `INSERT INTO apt_recurring_series (business_id, customer_id, service_id, variant_id, staff_id, recurrence_pattern, day_of_week, day_of_month, start_time, end_type, end_count, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.businessId, input.customerId, input.serviceId, input.variantId,
      input.staffId || null, input.recurrencePattern,
      input.dayOfWeek ?? null, input.dayOfMonth ?? null,
      input.startTime, input.endType,
      input.endCount ?? null, input.endDate ?? null,
      input.createdBy,
    ],
  );

  const series = rows[0];

  // Generate initial instances (next 8 weeks)
  const generation = await generateInstances(series, input.tenantId, 8);

  return { series, generation };
}

/**
 * Generate booking instances for a recurring series.
 */
export async function generateInstances(series: any, tenantId: string, weeksAhead = 8): Promise<GenerationResult> {
  const result: GenerationResult = { created: 0, skipped: 0, conflicts: [] };

  const dates = calculateOccurrenceDates(series, weeksAhead);

  for (const date of dates) {
    // Check if instance already exists
    const { rows: existing } = await adminPool.query(
      `SELECT id FROM apt_bookings WHERE recurring_series_id = $1 AND start_time::date = $2::date`,
      [series.id, date.toISOString()],
    );
    if (existing.length > 0) {
      result.skipped++;
      continue;
    }

    try {
      await createBooking({
        businessId: series.business_id,
        customerId: series.customer_id,
        serviceId: series.service_id,
        variantId: series.variant_id,
        staffId: series.staff_id,
        startTime: date.toISOString(),
        createdBy: series.created_by,
        tenantId,
        overrideRules: true, // recurring bookings skip lead time
      });

      // Link to series
      await adminPool.query(
        `UPDATE apt_bookings SET recurring_series_id = $1
         WHERE business_id = $2 AND customer_id = $3 AND service_id = $4
           AND start_time = $5 AND recurring_series_id IS NULL`,
        [series.id, series.business_id, series.customer_id, series.service_id, date.toISOString()],
      );

      result.created++;
    } catch (err: any) {
      // Conflict — skip this occurrence
      result.skipped++;
      result.conflicts.push(date.toISOString().slice(0, 10));
      logger.debug('Recurring booking skipped (conflict)', { date: date.toISOString(), error: err.message });
    }
  }

  return result;
}

/**
 * Calculate occurrence dates for a series.
 */
function calculateOccurrenceDates(series: any, weeksAhead: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  const maxDate = new Date(now.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);

  // If series has an end date, clamp
  const endLimit = series.end_date ? new Date(series.end_date) : maxDate;
  const effectiveEnd = endLimit < maxDate ? endLimit : maxDate;

  // Parse start time (HH:MM)
  const [hours, minutes] = series.start_time.split(':').map(Number);

  let current = new Date(now);
  current.setUTCDate(current.getUTCDate() + 1); // start from tomorrow

  let count = 0;
  const maxCount = series.end_count || 100;

  while (current <= effectiveEnd && count < maxCount) {
    let isOccurrence = false;

    if (series.recurrence_pattern === 'weekly') {
      isOccurrence = current.getUTCDay() === series.day_of_week;
    } else if (series.recurrence_pattern === 'biweekly') {
      if (current.getUTCDay() === series.day_of_week) {
        // Every other week — approximate by checking week number parity
        const weekNum = Math.floor(current.getTime() / (7 * 24 * 60 * 60 * 1000));
        isOccurrence = weekNum % 2 === 0;
      }
    } else if (series.recurrence_pattern === 'monthly') {
      isOccurrence = current.getUTCDate() === series.day_of_month;
    }

    if (isOccurrence) {
      const occDate = new Date(current);
      occDate.setUTCHours(hours, minutes, 0, 0);

      if (occDate > now) {
        dates.push(occDate);
        count++;
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Get a recurring series with its instances.
 */
export async function getSeriesById(seriesId: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM apt_recurring_series WHERE id = $1 AND business_id = $2',
    [seriesId, businessId],
  );
  if (rows.length === 0) return null;

  const series = rows[0];

  const { rows: instances } = await adminPool.query(
    `SELECT id, start_time, end_time, status, booking_reference
     FROM apt_bookings WHERE recurring_series_id = $1 ORDER BY start_time`,
    [seriesId],
  );

  return { ...series, instances };
}

/**
 * Cancel all future occurrences of a recurring series.
 */
export async function cancelSeries(seriesId: string, businessId: string, userId: string, tenantId: string): Promise<{ cancelled: number }> {
  // Cancel the series itself
  await adminPool.query(
    "UPDATE apt_recurring_series SET status = 'cancelled' WHERE id = $1 AND business_id = $2",
    [seriesId, businessId],
  );

  // Cancel future bookings in the series
  const { rowCount } = await adminPool.query(
    `UPDATE apt_bookings SET status = 'cancelled', cancelled_by = $3, cancelled_at = NOW(), cancellation_reason = 'Series cancelled'
     WHERE recurring_series_id = $1 AND business_id = $2
       AND start_time > NOW()
       AND status IN ('pending', 'confirmed')`,
    [seriesId, businessId, userId],
  );

  return { cancelled: rowCount ?? 0 };
}

/**
 * Cancel a single occurrence without affecting the series.
 */
export async function cancelSingleOccurrence(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    `UPDATE apt_bookings SET status = 'cancelled', cancelled_by = $3, cancelled_at = NOW(), cancellation_reason = 'Single occurrence cancelled'
     WHERE id = $1 AND business_id = $2 AND recurring_series_id IS NOT NULL
       AND status IN ('pending', 'confirmed')`,
    [bookingId, businessId, userId],
  );
  return (rowCount ?? 0) > 0;
}
