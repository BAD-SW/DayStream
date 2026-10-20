import { adminPool } from '../db/pool';
import { createBooking } from './booking.service';
import { logger } from '../middleware/logger';
import { localParts, localToUtc } from '../utils/business-time';

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

  // The series' time is a clock time where the business is (15:00 means 15:00 there, in summer
  // and in winter). It used to be read as UTC, so every occurrence was an hour or two off.
  const { rows: tzRows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [series.business_id]);
  const dates = calculateOccurrenceDates(series, weeksAhead, tzRows[0]?.timezone || 'UTC');

  for (const date of dates) {
    // Check if instance already exists
    const { rows: existing } = await adminPool.query(
      `SELECT id FROM apt_bookings WHERE recurring_series_id = $1 AND start_time = $2`,
      [series.id, date.toISOString()],
    );
    if (existing.length > 0) {
      result.skipped++;
      continue;
    }

    try {
      const booking = await createBooking({
        businessId: series.business_id,
        customerId: series.customer_id,
        serviceId: series.service_id,
        variantId: series.variant_id,
        staffId: series.staff_id,
        startTime: date.toISOString(),
        createdBy: series.created_by,
        tenantId,
        // Only the minimum notice is waived. Opening hours, the provider's availability,
        // resources and capacity apply to every occurrence like to any other booking.
        skipLeadTime: true,
        // Bulk series generation — don't blast one confirmation email per occurrence.
        suppressConfirmation: true,
      });

      // Link to series
      await adminPool.query('UPDATE apt_bookings SET recurring_series_id = $1 WHERE id = $2', [series.id, booking.id]);

      result.created++;
    } catch (err: any) {
      // Conflict — skip this occurrence
      result.skipped++;
      result.conflicts.push(localParts(date, tzRows[0]?.timezone || 'UTC').date);
      logger.debug('Recurring booking skipped (conflict)', { date: date.toISOString(), error: err.message });
    }
  }

  return result;
}

/**
 * Calculate occurrence dates for a series.
 */
function calculateOccurrenceDates(series: any, weeksAhead: number, timeZone: string): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  const maxDate = new Date(now.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);

  // If series has an end date, clamp (the end date itself is included)
  const endLimit = series.end_date ? localToUtc(String(series.end_date).slice(0, 10), '23:59', timeZone) : maxDate;
  const effectiveEnd = endLimit < maxDate ? endLimit : maxDate;

  const startTime = String(series.start_time).slice(0, 5); // HH:MM
  const maxCount = series.end_count || 100;

  // Walk calendar days of the business, starting tomorrow.
  const day = new Date(`${localParts(now, timeZone).date}T00:00:00Z`);
  for (let i = 0; i < weeksAhead * 7 + 1 && dates.length < maxCount; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    let isOccurrence = false;

    if (series.recurrence_pattern === 'weekly') {
      isOccurrence = day.getUTCDay() === series.day_of_week;
    } else if (series.recurrence_pattern === 'biweekly') {
      if (day.getUTCDay() === series.day_of_week) {
        // Every other week — approximate by checking week number parity
        const weekNum = Math.floor(day.getTime() / (7 * 24 * 60 * 60 * 1000));
        isOccurrence = weekNum % 2 === 0;
      }
    } else if (series.recurrence_pattern === 'monthly') {
      isOccurrence = day.getUTCDate() === series.day_of_month;
    }
    if (!isOccurrence) continue;

    const occDate = localToUtc(day.toISOString().slice(0, 10), startTime, timeZone);
    if (occDate > effectiveEnd) break;
    if (occDate > now) dates.push(occDate);
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
