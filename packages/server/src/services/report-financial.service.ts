import { bizAnd } from './report-scope';
import { adminPool } from '../db/pool';

/**
 * Get financial report (P&L, AP/AR aging, payroll, refunds) for a tenant.
 */
export async function getFinancialReport(tenantId: string, startDate: string, endDate: string) {
  // Revenue (from completed bookings)
  const { rows: revenueRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_revenue
     FROM apt_bookings b
     JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1${bizAnd('bus.id')}
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // Expenses
  const { rows: expenseRows } = await adminPool.query(
    `SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
     FROM fin_expenses e
     JOIN sys_businesses bus ON bus.id = e.business_id
     WHERE bus.tenant_id = $1${bizAnd('bus.id')}
       AND e.date >= $2::date
       AND e.date <= $3::date`,
    [tenantId, startDate, endDate],
  );

  const totalRevenue = parseFloat(revenueRows[0].total_revenue);
  const totalExpenses = parseFloat(expenseRows[0].total_expenses);
  const netIncome = totalRevenue - totalExpenses;

  // AP Aging (bills by overdue buckets)
  const { rows: apAging } = await adminPool.query(
    `SELECT * FROM (
     SELECT
       CASE
         WHEN bi.due_date >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 1 AND 30 THEN '1-30'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 31 AND 60 THEN '31-60'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 61 AND 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COUNT(*)::int AS count,
       COALESCE(SUM(bi.amount - bi.amount_paid), 0) AS outstanding
     FROM fin_bills bi
     JOIN sys_businesses bus ON bus.id = bi.business_id
     WHERE bus.tenant_id = $1${bizAnd('bus.id')}
       AND bi.status != 'paid'
     GROUP BY 1
     ) aged
     ORDER BY array_position(ARRAY['current','1-30','31-60','61-90','90+'], aged.bucket)`,
    [tenantId],
  );

  // AR Aging (outstanding invoices — bookings with status 'completed' but unpaid)
  const { rows: arAging } = await adminPool.query(
    `SELECT * FROM (
     SELECT
       CASE
         WHEN COALESCE(inv.due_date, inv.issue_date) >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - COALESCE(inv.due_date, inv.issue_date) BETWEEN 1 AND 30 THEN '1-30'
         WHEN CURRENT_DATE - COALESCE(inv.due_date, inv.issue_date) BETWEEN 31 AND 60 THEN '31-60'
         WHEN CURRENT_DATE - COALESCE(inv.due_date, inv.issue_date) BETWEEN 61 AND 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COUNT(*)::int AS count,
       COALESCE(SUM(inv.total_cents - inv.amount_paid_cents), 0) AS outstanding
     FROM pay_invoices inv
     WHERE inv.tenant_id = $1${bizAnd('inv.business_id')}
       AND inv.status NOT IN ('draft', 'void', 'paid')
       AND inv.total_cents > inv.amount_paid_cents
     GROUP BY 1
     ) aged
     ORDER BY array_position(ARRAY['current','1-30','31-60','61-90','90+'], aged.bucket)`,
    [tenantId],
  );

  // Payroll costs in period
  const { rows: payrollRows } = await adminPool.query(
    `SELECT COALESCE(SUM(pe.gross_pay), 0) AS total_payroll
     FROM fin_payroll_entries pe
     JOIN fin_pay_periods pp ON pp.id = pe.pay_period_id
     JOIN sys_businesses bus ON bus.id = pp.business_id
     WHERE bus.tenant_id = $1${bizAnd('bus.id')}
       AND pp.period_end >= $2::date
       AND pp.period_end <= $3::date`,
    [tenantId, startDate, endDate],
  );

  // Refunds in period
  const { rows: refundRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_refunds, COUNT(*)::int AS refund_count
     FROM apt_bookings b
     JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1${bizAnd('bus.id')}
       AND b.status = 'refunded'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  return {
    profitAndLoss: {
      totalRevenue,
      totalExpenses,
      netIncome,
      payroll: parseFloat(payrollRows[0].total_payroll),
    },
    apAging: apAging.map(r => ({ ...r, outstanding: parseFloat(r.outstanding) })),
    arAging: arAging.map(r => ({ ...r, outstanding: parseFloat(r.outstanding) })),
    refunds: {
      total: parseFloat(refundRows[0].total_refunds),
      count: refundRows[0].refund_count,
    },
  };
}
