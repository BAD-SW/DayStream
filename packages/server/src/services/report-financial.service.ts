import { adminPool } from '../db/pool';

/**
 * Get financial report (P&L, AP/AR aging, payroll, refunds) for a tenant.
 */
export async function getFinancialReport(tenantId: string, startDate: string, endDate: string) {
  // Revenue (from completed bookings)
  const { rows: revenueRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_revenue
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // Expenses
  const { rows: expenseRows } = await adminPool.query(
    `SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
     FROM expenses e
     JOIN businesses bus ON bus.id = e.business_id
     WHERE bus.tenant_id = $1
       AND e.date >= $2::date
       AND e.date <= $3::date`,
    [tenantId, startDate, endDate],
  );

  const totalRevenue = parseFloat(revenueRows[0].total_revenue);
  const totalExpenses = parseFloat(expenseRows[0].total_expenses);
  const netIncome = totalRevenue - totalExpenses;

  // AP Aging (bills by overdue buckets)
  const { rows: apAging } = await adminPool.query(
    `SELECT
       CASE
         WHEN bi.due_date >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 1 AND 30 THEN '1-30'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 31 AND 60 THEN '31-60'
         WHEN CURRENT_DATE - bi.due_date BETWEEN 61 AND 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COUNT(*)::int AS count,
       COALESCE(SUM(bi.amount - bi.amount_paid), 0) AS outstanding
     FROM bills bi
     JOIN businesses bus ON bus.id = bi.business_id
     WHERE bus.tenant_id = $1
       AND bi.status != 'paid'
     GROUP BY bucket
     ORDER BY CASE bucket
       WHEN 'current' THEN 1 WHEN '1-30' THEN 2
       WHEN '31-60' THEN 3 WHEN '61-90' THEN 4 ELSE 5
     END`,
    [tenantId],
  );

  // AR Aging (outstanding invoices — bookings with status 'completed' but unpaid)
  const { rows: arAging } = await adminPool.query(
    `SELECT
       CASE
         WHEN b.end_time >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - b.end_time::date BETWEEN 1 AND 30 THEN '1-30'
         WHEN CURRENT_DATE - b.end_time::date BETWEEN 31 AND 60 THEN '31-60'
         WHEN CURRENT_DATE - b.end_time::date BETWEEN 61 AND 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COUNT(*)::int AS count,
       COALESCE(SUM(b.price), 0) AS outstanding
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.payment_status = 'unpaid'
     GROUP BY bucket
     ORDER BY CASE bucket
       WHEN 'current' THEN 1 WHEN '1-30' THEN 2
       WHEN '31-60' THEN 3 WHEN '61-90' THEN 4 ELSE 5
     END`,
    [tenantId],
  );

  // Payroll costs in period
  const { rows: payrollRows } = await adminPool.query(
    `SELECT COALESCE(SUM(pe.amount), 0) AS total_payroll
     FROM payroll_entries pe
     JOIN businesses bus ON bus.id = pe.business_id
     WHERE bus.tenant_id = $1
       AND pe.pay_date >= $2::date
       AND pe.pay_date <= $3::date`,
    [tenantId, startDate, endDate],
  );

  // Refunds in period
  const { rows: refundRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_refunds, COUNT(*)::int AS refund_count
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
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
