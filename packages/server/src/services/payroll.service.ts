import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { getEffectiveRules } from './compensation.service';
import { getUserSummary, generateFromBookings } from './time-tracking.service';
import { logger } from '../middleware/logger';

interface PayPeriodInput {
  businessId: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * Open a new pay period.
 */
export async function openPayPeriod(input: PayPeriodInput) {
  // Prevent duplicates
  const { rows: existing } = await adminPool.query(
    'SELECT id FROM fin_pay_periods WHERE business_id = $1 AND period_start = $2 AND period_end = $3',
    [input.businessId, input.periodStart, input.periodEnd],
  );
  if (existing.length > 0) throw new Error('Pay period already exists for this date range');

  const { rows } = await adminPool.query(
    `INSERT INTO fin_pay_periods (business_id, period_start, period_end)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.businessId, input.periodStart, input.periodEnd],
  );
  return rows[0];
}

/**
 * List pay periods for a business.
 */
export async function getPayPeriods(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM fin_pay_periods WHERE business_id = $1 ORDER BY period_start DESC',
    [businessId],
  );
  return rows;
}

/**
 * Run payroll for a pay period. Calculates gross, deductions, net for each staff member.
 */
export async function runPayroll(periodId: string, businessId: string, tenantId: string): Promise<{ entries: any[]; totals: any }> {
  // Load period
  const { rows: periodRows } = await adminPool.query(
    "SELECT * FROM fin_pay_periods WHERE id = $1 AND business_id = $2 AND status = 'open'",
    [periodId, businessId],
  );
  if (periodRows.length === 0) throw new Error('Pay period not found or not open');

  const period = periodRows[0];

  // Update status
  await adminPool.query("UPDATE fin_pay_periods SET status = 'processing' WHERE id = $1", [periodId]);

  // Auto-generate time entries from bookings
  await generateFromBookings(businessId, period.period_start, period.period_end);

  // Get all staff with compensation rules
  const { rows: staffWithRules } = await adminPool.query(
    `SELECT DISTINCT cr.user_id FROM fin_compensation_rules cr
     WHERE cr.business_id = $1 AND cr.status = 'active'
       AND cr.effective_from <= $2 AND (cr.effective_to IS NULL OR cr.effective_to >= $3)`,
    [businessId, period.period_end, period.period_start],
  );

  const entries: any[] = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  for (const staff of staffWithRules) {
    const userId = staff.user_id;

    // Get time/session/revenue summary
    const summary = await getUserSummary(userId, businessId, period.period_start, period.period_end);

    // Get effective compensation rules
    const rules = await getEffectiveRules(userId, businessId, period.period_end);

    // Calculate gross pay
    let grossPay = 0;
    const breakdown: any[] = [];

    for (const rule of rules) {
      let amount = 0;
      switch (rule.rule_type) {
        case 'hourly':
          const regularHours = Math.min(summary.total_hours, rule.overtime_after_hours);
          const overtimeHours = Math.max(0, summary.total_hours - rule.overtime_after_hours);
          amount = Math.round(regularHours * rule.rate + overtimeHours * rule.rate * parseFloat(rule.overtime_multiplier));
          breakdown.push({ type: 'hourly', hours: summary.total_hours, regular: regularHours, overtime: overtimeHours, amount });
          break;
        case 'per_session':
          amount = summary.total_sessions * rule.rate;
          breakdown.push({ type: 'per_session', sessions: summary.total_sessions, rate: rule.rate, amount });
          break;
        case 'commission':
          const eligibleRevenue = rule.threshold_amount
            ? Math.max(0, summary.total_revenue - rule.threshold_amount)
            : summary.total_revenue;
          amount = Math.round(eligibleRevenue * rule.rate / 10000); // rate in basis points
          breakdown.push({ type: 'commission', revenue: summary.total_revenue, eligible: eligibleRevenue, rate_bps: rule.rate, amount });
          break;
        case 'salary':
          amount = rule.rate; // Fixed per period
          breakdown.push({ type: 'salary', amount });
          break;
      }
      grossPay += amount;
    }

    // Apply deductions
    const { rows: deductions } = await adminPool.query(
      `SELECT * FROM fin_payroll_deductions
       WHERE user_id = $1 AND business_id = $2 AND status = 'active'
         AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $4)`,
      [userId, businessId, period.period_end, period.period_start],
    );

    let totalDeductionAmount = 0;
    const deductionBreakdown: any[] = [];

    for (const ded of deductions) {
      let deductionAmount = 0;
      if (ded.calculation_type === 'percentage') {
        deductionAmount = Math.round(grossPay * ded.value / 10000); // value in basis points
      } else {
        deductionAmount = ded.value; // fixed cents
      }
      totalDeductionAmount += deductionAmount;
      deductionBreakdown.push({ name: ded.name, type: ded.deduction_type, calculation: ded.calculation_type, value: ded.value, amount: deductionAmount });
    }

    const netPay = grossPay - totalDeductionAmount;

    // Delete existing draft entry for this user/period (re-run)
    await adminPool.query(
      "DELETE FROM fin_payroll_entries WHERE pay_period_id = $1 AND user_id = $2 AND status = 'draft'",
      [periodId, userId],
    );

    // Insert payroll entry
    const { rows: entryRows } = await adminPool.query(
      `INSERT INTO fin_payroll_entries (pay_period_id, user_id, hours_worked, sessions_delivered, revenue_generated, gross_pay, total_deductions, net_pay, breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [periodId, userId, summary.total_hours, summary.total_sessions, summary.total_revenue, grossPay, totalDeductionAmount, netPay, JSON.stringify({ compensation: breakdown, deductions: deductionBreakdown })],
    );

    entries.push(entryRows[0]);
    totalGross += grossPay;
    totalDeductions += totalDeductionAmount;
    totalNet += netPay;
  }

  return {
    entries,
    totals: { gross: totalGross, deductions: totalDeductions, net: totalNet, staff_count: entries.length },
  };
}

/**
 * Finalize a payroll run (lock entries, no further edits).
 */
export async function finalizePayroll(periodId: string, businessId: string, userId: string, tenantId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    "SELECT * FROM fin_pay_periods WHERE id = $1 AND business_id = $2 AND status = 'processing'",
    [periodId, businessId],
  );
  if (rows.length === 0) return false;

  // Finalize entries
  await adminPool.query(
    "UPDATE fin_payroll_entries SET status = 'finalized' WHERE pay_period_id = $1",
    [periodId],
  );

  // Finalize period
  await adminPool.query(
    "UPDATE fin_pay_periods SET status = 'finalized', finalized_at = NOW(), finalized_by = $2 WHERE id = $1",
    [periodId, userId],
  );

  await logAudit({ tenantId, userId, action: 'payroll.finalized', resourceType: 'pay_period', resourceId: periodId });

  return true;
}

/**
 * Get payroll entries for a period.
 */
export async function getPayrollEntries(periodId: string) {
  const { rows } = await adminPool.query(
    `SELECT pe.*, u.first_name, u.last_name FROM fin_payroll_entries pe
     JOIN usr_users u ON u.id = pe.user_id
     WHERE pe.pay_period_id = $1 ORDER BY u.last_name`,
    [periodId],
  );
  return rows;
}
