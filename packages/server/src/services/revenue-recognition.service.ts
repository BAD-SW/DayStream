import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

const DEFERRED_REVENUE_CODE = '2400';  // Deferred Revenue (liability)
const MEMBERSHIP_REVENUE_CODE = '4200'; // Membership Revenue

interface RecognitionResult {
  datesProcessed: number;
  enrollmentsProcessed: number;
  totalRecognized: number; // in cents
  journalEntriesCreated: number;
}

/**
 * Recognize deferred revenue for active memberships through a given date.
 *
 * For each active enrollment:
 *   1. Calculate how many days from period_start through the end date (capped at period_end)
 *   2. Calculate total that SHOULD be recognized: daily_amount × covered_days
 *   3. Look up how much has ALREADY been recognized for this enrollment
 *   4. The difference is what needs to be posted
 *
 * All differences are summed into a single journal entry posted on the posting date.
 * The per-enrollment tracking table is updated so subsequent runs only pick up new amounts.
 */
export async function recognizeRevenue(businessId: string, dateFrom: string, dateTo: string, postingDateOverride?: string): Promise<RecognitionResult> {
  const result: RecognitionResult = { datesProcessed: 0, enrollmentsProcessed: 0, totalRecognized: 0, journalEntriesCreated: 0 };

  // Load accounts
  const { rows: accounts } = await adminPool.query(
    'SELECT id, code FROM fin_chart_of_accounts WHERE business_id = $1 AND code IN ($2, $3)',
    [businessId, DEFERRED_REVENUE_CODE, MEMBERSHIP_REVENUE_CODE],
  );
  const accountMap = new Map<string, string>();
  for (const a of accounts) accountMap.set(a.code, a.id);

  const deferredAccountId = accountMap.get(DEFERRED_REVENUE_CODE);
  const revenueAccountId = accountMap.get(MEMBERSHIP_REVENUE_CODE);

  if (!deferredAccountId || !revenueAccountId) {
    throw new Error('Required accounts (2400 Deferred Revenue, 4200 Membership Revenue) not found. Ensure Chart of Accounts is seeded.');
  }

  // Get business timezone for posting date
  const { rows: bizRows } = await adminPool.query(
    'SELECT timezone FROM sys_businesses WHERE id = $1', [businessId],
  );
  const tz = bizRows[0]?.timezone || 'UTC';
  const postingDate = postingDateOverride || new Date().toLocaleDateString('sv-SE', { timeZone: tz });

  // Find all active enrollments that overlap with the requested date range
  const { rows: enrollments } = await adminPool.query(
    `SELECT e.id, e.plan_id, e.current_period_start, e.current_period_end, e.paused_days_credit, p.price, p.name AS plan_name
     FROM mbr_enrollments e
     JOIN mbr_plans p ON p.id = e.plan_id
     WHERE e.business_id = $1
       AND e.status = 'active'
       AND e.current_period_start <= $2
       AND e.current_period_end >= $3`,
    [businessId, dateTo, dateFrom],
  );

  if (enrollments.length === 0) {
    logger.info(`[RevenueRecognition] Business ${businessId}: no active enrollments for ${dateFrom} to ${dateTo}`);
    return result;
  }

  // Load existing recognition records for these enrollments
  const enrollmentIds = enrollments.map((e: any) => e.id);
  const { rows: existingRecords } = await adminPool.query(
    `SELECT enrollment_id, amount_recognized, days_recognized FROM fin_revenue_recognized WHERE enrollment_id = ANY($1)`,
    [enrollmentIds],
  );
  const recognizedMap = new Map<string, { amount: number; days: number }>();
  for (const r of existingRecords) {
    recognizedMap.set(r.enrollment_id, { amount: r.amount_recognized, days: r.days_recognized });
  }

  // Calculate per-enrollment what should be recognized through dateTo
  let totalToPost = 0;
  const planTotals = new Map<string, { name: string; total: number }>();
  const updates: { enrollmentId: string; newAmount: number; newDays: number; lastDate: string }[] = [];

  for (const enrollment of enrollments) {
    const periodStart = new Date(enrollment.current_period_start);
    const periodEnd = new Date(enrollment.current_period_end);
    const daysInPeriod = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (daysInPeriod <= 0) continue;

    const dailyAmount = Math.round(enrollment.price / daysInPeriod);
    if (dailyAmount <= 0) continue;

    // How many days from period_start through dateTo (capped at period_end)?
    const effectiveStart = periodStart;
    const effectiveEnd = new Date(Math.min(new Date(dateTo + 'T00:00:00Z').getTime(), periodEnd.getTime()));
    let daysCovered = Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Subtract paused days (days with no service, no recognition)
    const pausedDaysCredit = enrollment.paused_days_credit || 0;
    daysCovered = Math.max(0, daysCovered - pausedDaysCredit);

    if (daysCovered <= 0) continue;

    const shouldBeRecognized = dailyAmount * daysCovered;
    const alreadyRecognized = recognizedMap.get(enrollment.id)?.amount || 0;
    const difference = shouldBeRecognized - alreadyRecognized;

    if (difference <= 0) continue;

    totalToPost += difference;
    result.enrollmentsProcessed++;

    const existing = planTotals.get(enrollment.plan_id);
    if (existing) {
      existing.total += difference;
    } else {
      planTotals.set(enrollment.plan_id, { name: enrollment.plan_name, total: difference });
    }

    updates.push({
      enrollmentId: enrollment.id,
      newAmount: shouldBeRecognized,
      newDays: daysCovered,
      lastDate: effectiveEnd.toISOString().slice(0, 10),
    });
  }

  result.datesProcessed = Math.round((new Date(dateTo + 'T00:00:00Z').getTime() - new Date(dateFrom + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (totalToPost <= 0) {
    logger.info(`[RevenueRecognition] Business ${businessId}: nothing new to recognize for ${dateFrom} to ${dateTo}`);
    return result;
  }

  // Create journal entry
  const dateRangeLabel = dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`;
  const planSummary = Array.from(planTotals.values()).map(p => `${p.name} ${formatCurrency(p.total)}`).join(', ');

  const { rows: entryRows } = await adminPool.query(
    `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id)
     VALUES ($1, $2, $3, 'revenue_recognition', NULL) RETURNING id`,
    [businessId, postingDate, `Revenue recognition ${dateRangeLabel} — ${planSummary}`],
  );
  const entryId = entryRows[0].id;

  // Debit: Deferred Revenue (reduce liability)
  await adminPool.query(
    `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
     VALUES ($1, $2, $3, 0, $4)`,
    [entryId, deferredAccountId, totalToPost, `Deferred revenue recognized: ${dateRangeLabel}`],
  );

  // Credit: Membership Revenue (recognize income)
  await adminPool.query(
    `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
     VALUES ($1, $2, 0, $3, $4)`,
    [entryId, revenueAccountId, totalToPost, `Membership revenue: ${planSummary}`],
  );

  // Update tracking records
  for (const upd of updates) {
    await adminPool.query(
      `INSERT INTO fin_revenue_recognized (business_id, enrollment_id, amount_recognized, days_recognized, last_recognized_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (enrollment_id) DO UPDATE SET amount_recognized = $3, days_recognized = $4, last_recognized_date = $5, updated_at = NOW()`,
      [businessId, upd.enrollmentId, upd.newAmount, upd.newDays, upd.lastDate],
    );
  }

  result.totalRecognized = totalToPost;
  result.journalEntriesCreated = 1;

  logger.info(`[RevenueRecognition] Business ${businessId}: recognized ${formatCurrency(totalToPost)} for ${dateRangeLabel} (${result.enrollmentsProcessed} enrollments)`);
  return result;
}

/**
 * Run revenue recognition for all days through yesterday.
 * Finds the earliest active enrollment start date and processes everything
 * through yesterday, posting only unrecognized amounts.
 */
export async function recognizeRevenueForYesterday(businessId: string): Promise<RecognitionResult> {
  const { rows: bizRows } = await adminPool.query(
    'SELECT timezone FROM sys_businesses WHERE id = $1', [businessId],
  );
  const tz = bizRows[0]?.timezone || 'UTC';

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // Find the earliest active enrollment start date
  const { rows: earliest } = await adminPool.query(
    `SELECT MIN(current_period_start) AS earliest FROM mbr_enrollments WHERE business_id = $1 AND status = 'active'`,
    [businessId],
  );

  if (!earliest[0]?.earliest) {
    return { datesProcessed: 0, enrollmentsProcessed: 0, totalRecognized: 0, journalEntriesCreated: 0 };
  }

  const dateFrom = new Date(earliest[0].earliest).toISOString().slice(0, 10);

  return recognizeRevenue(businessId, dateFrom, yesterdayStr);
}

function formatCurrency(cents: number): string {
  return `\u20AC${(cents / 100).toFixed(2)}`;
}
