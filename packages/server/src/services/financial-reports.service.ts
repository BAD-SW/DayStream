import { adminPool } from '../db/pool';

interface ReportFilters {
  businessId: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * Profit & Loss report.
 */
export async function getProfitAndLoss(filters: ReportFilters) {
  const { businessId, dateFrom, dateTo } = filters;

  // Revenue
  const { rows: revenue } = await adminPool.query(
    `SELECT coa.name, COALESCE(SUM(jel.credit - jel.debit), 0)::int AS amount
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.business_id = $1 AND je.entry_date >= $2 AND je.entry_date <= $3
       AND coa.account_type = 'revenue' AND je.is_void = false
     GROUP BY coa.name ORDER BY amount DESC`,
    [businessId, dateFrom, dateTo],
  );

  // Expenses
  const { rows: expenses } = await adminPool.query(
    `SELECT coa.name, COALESCE(SUM(jel.debit - jel.credit), 0)::int AS amount
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.business_id = $1 AND je.entry_date >= $2 AND je.entry_date <= $3
       AND coa.account_type = 'expense' AND je.is_void = false
     GROUP BY coa.name ORDER BY amount DESC`,
    [businessId, dateFrom, dateTo],
  );

  const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenses.reduce((sum, r) => sum + r.amount, 0);

  return {
    period: { from: dateFrom, to: dateTo },
    revenue: { items: revenue, total: totalRevenue },
    expenses: { items: expenses, total: totalExpenses },
    net_profit: totalRevenue - totalExpenses,
  };
}

/**
 * Staff cost report.
 */
export async function getStaffCosts(filters: ReportFilters) {
  const { businessId, dateFrom, dateTo } = filters;

  const { rows } = await adminPool.query(
    `SELECT pe.user_id, u.first_name, u.last_name,
            SUM(pe.hours_worked)::numeric AS total_hours,
            SUM(pe.sessions_delivered)::int AS total_sessions,
            SUM(pe.gross_pay)::int AS total_gross,
            SUM(pe.total_deductions)::int AS total_deductions,
            SUM(pe.net_pay)::int AS total_net
     FROM payroll_entries pe
     JOIN pay_periods pp ON pp.id = pe.pay_period_id
     JOIN users u ON u.id = pe.user_id
     WHERE pp.business_id = $1 AND pp.period_start >= $2 AND pp.period_end <= $3
     GROUP BY pe.user_id, u.first_name, u.last_name
     ORDER BY total_gross DESC`,
    [businessId, dateFrom, dateTo],
  );

  const totalGross = rows.reduce((sum, r) => sum + r.total_gross, 0);

  return { period: { from: dateFrom, to: dateTo }, staff: rows, total_gross: totalGross };
}

/**
 * AP Aging report.
 */
export async function getAPAging(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT
       CASE
         WHEN due_date >= CURRENT_DATE THEN 'current'
         WHEN due_date >= CURRENT_DATE - 30 THEN '1_30'
         WHEN due_date >= CURRENT_DATE - 60 THEN '31_60'
         WHEN due_date >= CURRENT_DATE - 90 THEN '61_90'
         ELSE '90_plus'
       END AS aging_bucket,
       COUNT(*)::int AS count,
       COALESCE(SUM(amount - amount_paid), 0)::int AS total
     FROM bills
     WHERE business_id = $1 AND status NOT IN ('paid', 'void')
     GROUP BY aging_bucket`,
    [businessId],
  );

  const buckets: Record<string, { count: number; total: number }> = {
    current: { count: 0, total: 0 }, '1_30': { count: 0, total: 0 },
    '31_60': { count: 0, total: 0 }, '61_90': { count: 0, total: 0 }, '90_plus': { count: 0, total: 0 },
  };

  for (const row of rows) {
    buckets[row.aging_bucket] = { count: row.count, total: row.total };
  }

  return { buckets, total_outstanding: Object.values(buckets).reduce((s, b) => s + b.total, 0) };
}

/**
 * Expense breakdown by category.
 */
export async function getExpenseBreakdown(filters: ReportFilters) {
  const { businessId, dateFrom, dateTo } = filters;

  const { rows } = await adminPool.query(
    `SELECT coa.name AS category, coa.code, COALESCE(SUM(e.amount), 0)::int AS total, COUNT(*)::int AS count
     FROM expenses e
     LEFT JOIN chart_of_accounts coa ON coa.id = e.account_id
     WHERE e.business_id = $1 AND e.date >= $2 AND e.date <= $3 AND e.status = 'approved'
     GROUP BY coa.name, coa.code ORDER BY total DESC`,
    [businessId, dateFrom, dateTo],
  );

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  return { period: { from: dateFrom, to: dateTo }, categories: rows, total: grandTotal };
}
