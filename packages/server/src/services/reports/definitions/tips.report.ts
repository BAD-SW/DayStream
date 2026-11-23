import { reportDb } from '../lib/report-db';
import { ReportDefinition } from '../types';

/**
 * Tips (spec 51, gap 14; design 14.5). For a date range: each staff member's tips collected
 * (electronic, cash and other manual), refunded, paid (handed over at the time, or in payroll) and
 * still owed; then every tip share. Tips are owed to staff, so they never appear in sales reports.
 */
export const tipsReport: ReportDefinition = {
  id: 'tips',
  title: 'Tips',
  buildSections: async (ctx) => {
    const { rows: summary } = await reportDb.query(
      `SELECT TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS staff,
              SUM(CASE WHEN s.electronic THEN s.amount_cents ELSE 0 END)::int AS electronic,
              SUM(CASE WHEN s.electronic THEN 0 ELSE s.amount_cents END)::int AS manual,
              SUM(s.amount_cents)::int AS collected,
              SUM(s.refunded_cents)::int AS refunded,
              SUM(s.paid_cents)::int AS paid,
              SUM(s.amount_cents - s.refunded_cents - s.paid_cents)::int AS owed
         FROM fin_tip_shares s
         JOIN usr_users u ON u.id = s.user_id
        WHERE s.business_id = $1 AND s.created_at::date BETWEEN $2::date AND $3::date
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY staff`,
      [ctx.businessId, ctx.start, ctx.end]);
    const { rows: detail } = await reportDb.query(
      `SELECT s.created_at::date AS tipped_on, o.order_number, o.id AS order_id,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS staff,
              CASE WHEN s.electronic THEN 'Electronic' ELSE 'Cash or manual' END AS kind,
              s.amount_cents AS amount, s.refunded_cents AS refunded, s.paid_cents AS paid,
              (s.amount_cents - s.refunded_cents - s.paid_cents) AS owed,
              CASE WHEN s.amount_cents - s.refunded_cents - s.paid_cents = 0
                     THEN CASE WHEN s.electronic THEN 'Paid in payroll' ELSE 'Handed over' END
                   WHEN s.amount_cents - s.refunded_cents - s.paid_cents < 0 THEN 'Taken off next pay run'
                   ELSE 'Owed' END AS status
         FROM fin_tip_shares s
         JOIN usr_users u ON u.id = s.user_id
         JOIN fin_orders o ON o.id = s.order_id
        WHERE s.business_id = $1 AND s.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY s.created_at DESC, staff`,
      [ctx.businessId, ctx.start, ctx.end]);
    // The tip pool: tips on orders with no staff member on them. Once shared out, each staff
    // member's part is in the sections above, so this section is not added to them.
    const { rows: pool } = await reportDb.query(
      `SELECT s.created_at::date AS tipped_on, o.order_number, o.id AS order_id,
              CASE WHEN s.electronic THEN 'Electronic' ELSE 'Cash or manual' END AS kind,
              s.amount_cents AS amount, s.refunded_cents AS refunded,
              CASE WHEN s.status = 'allocated' THEN s.paid_cents ELSE 0 END AS shared,
              CASE WHEN s.status = 'pool' THEN s.amount_cents - s.refunded_cents - s.paid_cents ELSE 0 END AS waiting,
              CASE WHEN s.status = 'allocated' THEN 'Shared out'
                   WHEN s.amount_cents - s.refunded_cents - s.paid_cents = 0 THEN 'Refunded'
                   ELSE 'Waiting' END AS status
         FROM fin_tip_shares s
         JOIN fin_orders o ON o.id = s.order_id
        WHERE s.business_id = $1 AND s.user_id IS NULL AND s.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY s.created_at DESC`,
      [ctx.businessId, ctx.start, ctx.end]);
    return [
      {
        id: 'by-staff',
        title: 'By staff member',
        columns: [
          { key: 'staff', header: 'Staff', type: 'text', filterable: true },
          { key: 'electronic', header: 'Electronic', type: 'currency', filterable: false, total: true },
          { key: 'manual', header: 'Cash / Manual', type: 'currency', filterable: false, total: true },
          { key: 'collected', header: 'Collected', type: 'currency', filterable: false, total: true },
          { key: 'refunded', header: 'Refunded', type: 'currency', filterable: false, total: true },
          { key: 'paid', header: 'Paid', type: 'currency', filterable: false, total: true },
          { key: 'owed', header: 'Owed', type: 'currency', filterable: false, total: true },
        ],
        rows: summary,
      },
      {
        id: 'tips',
        title: 'Each tip',
        columns: [
          { key: 'tipped_on', header: 'Date', type: 'date', filterable: true },
          { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
          { key: 'staff', header: 'Staff', type: 'text', filterable: true },
          { key: 'kind', header: 'Paid By', type: 'text', filterable: true },
          { key: 'amount', header: 'Tip', type: 'currency', filterable: false, total: true },
          { key: 'refunded', header: 'Refunded', type: 'currency', filterable: false, total: true },
          { key: 'paid', header: 'Paid', type: 'currency', filterable: false, total: true },
          { key: 'owed', header: 'Owed', type: 'currency', filterable: false, total: true },
          { key: 'status', header: 'Status', type: 'text', filterable: true },
        ],
        rows: detail,
      },
      {
        id: 'pool',
        title: 'Tip pool (no staff member on the order; shared out in Accounting > Payroll > Tip Pool)',
        columns: [
          { key: 'tipped_on', header: 'Date', type: 'date', filterable: true },
          { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
          { key: 'kind', header: 'Paid By', type: 'text', filterable: true },
          { key: 'amount', header: 'Tip', type: 'currency', filterable: false, total: true },
          { key: 'refunded', header: 'Refunded', type: 'currency', filterable: false, total: true },
          { key: 'shared', header: 'Shared Out', type: 'currency', filterable: false, total: true },
          { key: 'waiting', header: 'Waiting', type: 'currency', filterable: false, total: true },
          { key: 'status', header: 'Status', type: 'text', filterable: true },
        ],
        rows: pool,
      },
    ];
  },
};
