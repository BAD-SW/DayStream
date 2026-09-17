import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Payroll Summary report — one row per payroll entry (staff × pay period),
 * showing how each person's pay breaks down. Effectively a payslip line.
 *
 * Gross is split from the entry's breakdown JSON:
 *   - Base Pay       = hourly + salary compensation lines
 *   - Commission Pay = commission + per_session (flat-rate) lines
 *   Base + Commission = Gross Pay (the stored gross_pay).
 *
 * Includes any payroll entry whose PAY PERIOD overlaps the selected date range;
 * the Period column makes each row's period explicit. Both draft and finalized
 * entries appear (Status distinguishes them) so in-progress runs are visible.
 *
 * Uses adminPool scoped by business_id (via the entry's pay period), matching
 * the other reports.
 */
export const payrollSummaryReport: ReportDefinition = {
  id: 'payroll-summary',
  title: 'Payroll Summary',
  columns: [
    { key: 'period', header: 'Period', type: 'text', filterable: true, groupable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
    { key: 'base_pay', header: 'Base Pay', type: 'currency', total: true },
    { key: 'commission_pay', header: 'Commission Pay', type: 'currency', total: true },
    { key: 'gross_pay', header: 'Gross Pay', type: 'currency', total: true },
    { key: 'deductions', header: 'Deductions', type: 'currency', total: true },
    { key: 'net_pay', header: 'Net Pay', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT pp.period_start,
              pp.period_end,
              pe.status,
              pe.gross_pay::int AS gross_pay,
              pe.total_deductions::int AS deductions,
              pe.net_pay::int AS net_pay,
              pe.breakdown,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS staff
         FROM fin_payroll_entries pe
         JOIN fin_pay_periods pp ON pp.id = pe.pay_period_id
         JOIN usr_users u ON u.id = pe.user_id
        WHERE pp.business_id = $1
          AND pp.period_start <= $3::date
          AND pp.period_end >= $2::date
        ORDER BY pp.period_start DESC, u.last_name, u.first_name`,
      [ctx.businessId, ctx.start, ctx.end],
    );

    const fmtPeriod = (s: unknown, e: unknown): string => {
      const d = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
      return `${d(s)} – ${d(e)}`;
    };

    // Split gross into base (hourly + salary) vs commission (commission +
    // per_session) from the compensation breakdown.
    const BASE_TYPES = new Set(['hourly', 'salary']);
    const COMMISSION_TYPES = new Set(['commission', 'per_session']);

    return rows.map((r) => {
      const comp: any[] = Array.isArray(r.breakdown?.compensation) ? r.breakdown.compensation : [];
      let base = 0;
      let commission = 0;
      for (const line of comp) {
        const amt = Number(line?.amount) || 0;
        if (BASE_TYPES.has(line?.type)) base += amt;
        else if (COMMISSION_TYPES.has(line?.type)) commission += amt;
      }
      return {
        period: fmtPeriod(r.period_start, r.period_end),
        staff: r.staff || '—',
        status: r.status === 'finalized' ? 'Finalized' : 'Draft',
        base_pay: base,
        commission_pay: commission,
        gross_pay: Number(r.gross_pay) || 0,
        deductions: Number(r.deductions) || 0,
        net_pay: Number(r.net_pay) || 0,
      };
    });
  },
};
