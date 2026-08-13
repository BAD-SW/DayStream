import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Auto-generate all outstanding pay periods from the last finalized one through today.
 * Based on the business's pay frequency and start reference date.
 */
export async function generateOutstandingPeriods(businessId: string): Promise<any[]> {
  // Get business pay frequency settings
  const { rows: bizRows } = await adminPool.query(
    'SELECT pay_frequency, pay_period_start_date FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  if (bizRows.length === 0) return [];

  const frequency = bizRows[0].pay_frequency || 'monthly';
  let startRef = bizRows[0].pay_period_start_date;

  // If no start date set, use the 1st of the current month
  if (!startRef) {
    const now = new Date();
    startRef = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  } else {
    startRef = new Date(startRef).toISOString().slice(0, 10);
  }

  // Find the last finalized period's end date
  const { rows: lastFinalized } = await adminPool.query(
    `SELECT period_end FROM fin_pay_periods WHERE business_id = $1 AND status = 'finalized' ORDER BY period_end DESC LIMIT 1`,
    [businessId],
  );

  // Determine where to start generating from
  let generateFrom: Date;
  if (lastFinalized.length > 0) {
    // Start from the day after the last finalized period ended
    generateFrom = new Date(lastFinalized[0].period_end);
    generateFrom.setDate(generateFrom.getDate() + 1);
  } else {
    // No finalized periods — start from the reference date
    generateFrom = new Date(startRef + 'T00:00:00Z');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Generate periods until we've covered today
  const newPeriods: any[] = [];
  let periodStart = new Date(generateFrom);

  while (periodStart <= today) {
    const periodEnd = calculatePeriodEnd(periodStart, frequency);

    // Don't create periods that haven't started yet
    if (periodStart > today) break;

    // Check if this period already exists
    const startStr = periodStart.toISOString().slice(0, 10);
    const endStr = periodEnd.toISOString().slice(0, 10);

    const { rows: existing } = await adminPool.query(
      'SELECT id FROM fin_pay_periods WHERE business_id = $1 AND period_start = $2',
      [businessId, startStr],
    );

    if (existing.length === 0) {
      // Create the period
      const { rows } = await adminPool.query(
        `INSERT INTO fin_pay_periods (business_id, period_start, period_end)
         VALUES ($1, $2, $3) RETURNING *`,
        [businessId, startStr, endStr],
      );
      newPeriods.push(rows[0]);
    }

    // Move to next period
    periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() + 1);
  }

  if (newPeriods.length > 0) {
    logger.info(`[PayPeriod] Generated ${newPeriods.length} outstanding periods for business ${businessId}`);
  }

  return newPeriods;
}

/**
 * Get all unprocessed (open/processing) periods for a business.
 */
export async function getUnprocessedPeriods(businessId: string) {
  // Auto-generate first
  await generateOutstandingPeriods(businessId);

  const { rows } = await adminPool.query(
    `SELECT * FROM fin_pay_periods WHERE business_id = $1 AND status IN ('open', 'processing') ORDER BY period_start ASC`,
    [businessId],
  );
  return rows;
}

/**
 * Get finalized (history) periods for a business.
 */
export async function getFinalizedPeriods(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM fin_pay_periods WHERE business_id = $1 AND status = 'finalized' ORDER BY period_start DESC`,
    [businessId],
  );
  return rows;
}

/**
 * Calculate the end date of a period based on frequency.
 */
function calculatePeriodEnd(start: Date, frequency: string): Date {
  const end = new Date(start);
  switch (frequency) {
    case 'weekly':
      end.setDate(end.getDate() + 6);
      break;
    case 'biweekly':
      end.setDate(end.getDate() + 13);
      break;
    case 'semi_monthly':
      // 1st-15th or 16th-end of month
      if (start.getDate() <= 15) {
        end.setDate(15);
      } else {
        end.setMonth(end.getMonth() + 1, 0); // Last day of month
      }
      break;
    case 'monthly':
      end.setMonth(end.getMonth() + 1);
      end.setDate(end.getDate() - 1); // Last day of the period month
      break;
    default:
      end.setMonth(end.getMonth() + 1);
      end.setDate(end.getDate() - 1);
  }
  return end;
}
