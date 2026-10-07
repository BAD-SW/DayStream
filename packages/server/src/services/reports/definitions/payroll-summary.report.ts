import { adminPool } from '../../../db/pool';
import { ReportDefinition, ReportSectionDef, ReportContext } from '../types';

/**
 * Payroll Summary report — the "explain my pay" artifact. Two sections:
 *
 *   1. Summary       — one row per payroll entry (staff × pay period): the hours
 *                      that drove pay, how base/commission split, and Gross Pay.
 *   2. Line Item Detail — one row per gross-pay component, so a staff member can
 *                      trace exactly what produced each number (e.g. "Hourly —
 *                      Clocked, 37.5h", "Commission — orders").
 *
 * Scope note: deductions and net pay are intentionally NOT reported here. Taxes
 * and statutory deductions are computed by third-party payroll software from an
 * export file, not by this system — so only GROSS pay and its components, which
 * this system actually owns, are shown. Both draft and finalized entries appear
 * (Status distinguishes them) so in-progress runs are visible.
 *
 * Includes any payroll entry whose PAY PERIOD overlaps the selected date range.
 * Uses adminPool scoped by business_id (via the entry's pay period), matching
 * the other reports.
 */

interface CompLine {
  type?: string;
  basis?: string;
  hours?: number;
  regular?: number;
  overtime?: number;
  amount?: number;
}

interface PayrollRow {
  period_start: unknown;
  period_end: unknown;
  status: string;
  gross_pay: number;
  breakdown: { compensation?: CompLine[] } | null;
  staff: string;
}

const BASE_TYPES = new Set(['hourly', 'salary']);
const COMMISSION_TYPES = new Set(['commission', 'per_session']);

// How the hourly basis values map to a human label. 'bookings' is the legacy
// fallback for hourly rules with no basis chosen; salary-only lines show '—'.
const BASIS_LABEL: Record<string, string> = {
  clocked: 'Clocked',
  scheduled: 'Scheduled',
  bookings: 'Bookings (legacy)',
};

// Human label per compensation line type, for the detail section's Item column.
const TYPE_LABEL: Record<string, string> = {
  hourly: 'Hourly',
  salary: 'Salary',
  commission: 'Commission',
  per_session: 'Per Session',
};

function fmtPeriod(s: unknown, e: unknown): string {
  const d = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  return `${d(s)} – ${d(e)}`;
}

function compLines(r: PayrollRow): CompLine[] {
  return Array.isArray(r.breakdown?.compensation) ? r.breakdown!.compensation! : [];
}

async function fetchEntries(ctx: ReportContext): Promise<PayrollRow[]> {
  const { rows } = await adminPool.query(
    `SELECT pp.period_start,
            pp.period_end,
            pe.status,
            pe.gross_pay::int AS gross_pay,
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
  return rows as PayrollRow[];
}

/** Summary section: one payslip line per staff × period (gross only). */
function buildSummarySection(rows: PayrollRow[]): ReportSectionDef {
  const out = rows.map((r) => {
    const comp = compLines(r);
    let base = 0;
    let commission = 0;
    let hours = 0;
    let basis: string | null = null;
    for (const line of comp) {
      const amt = Number(line.amount) || 0;
      if (BASE_TYPES.has(line.type || '')) base += amt;
      else if (COMMISSION_TYPES.has(line.type || '')) commission += amt;
      if (line.type === 'hourly') {
        hours += Number(line.hours) || 0;
        if (basis == null && typeof line.basis === 'string') basis = line.basis;
      }
    }
    return {
      period: fmtPeriod(r.period_start, r.period_end),
      staff: r.staff || '—',
      status: r.status === 'finalized' ? 'Finalized' : 'Draft',
      hours: Math.round(hours * 100) / 100,
      hours_basis: basis ? (BASIS_LABEL[basis] || basis) : '—',
      base_pay: base,
      commission_pay: commission,
      gross_pay: Number(r.gross_pay) || 0,
    };
  });

  return {
    id: 'summary',
    title: 'Summary',
    columns: [
      { key: 'period', header: 'Period', type: 'text', filterable: true, groupable: true },
      { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
      { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
      { key: 'hours', header: 'Hours', type: 'number', total: true },
      { key: 'hours_basis', header: 'Hours Basis', type: 'text', filterable: true, groupable: true },
      { key: 'base_pay', header: 'Base Pay', type: 'currency', total: true },
      { key: 'commission_pay', header: 'Commission Pay', type: 'currency', total: true },
      { key: 'gross_pay', header: 'Gross Pay', type: 'currency', total: true },
    ],
    rows: out,
  };
}

/**
 * Line Item Detail section: one row per gross-pay component, explaining each
 * number in the summary. Category groups Base vs Commission; Detail describes
 * the source (basis for hourly, 'orders' for commission); Hours/Amount show the
 * inputs. Rows are ordered to sit beneath their staff/period in the summary.
 */
function buildDetailSection(rows: PayrollRow[]): ReportSectionDef {
  const out: Record<string, any>[] = [];

  for (const r of rows) {
    const period = fmtPeriod(r.period_start, r.period_end);
    const staff = r.staff || '—';
    for (const line of compLines(r)) {
      const type = line.type || '';
      const amount = Number(line.amount) || 0;
      const isBase = BASE_TYPES.has(type);
      const isCommission = COMMISSION_TYPES.has(type);
      if (!isBase && !isCommission) continue; // skip anything that isn't gross comp

      // Describe the source of this line.
      let detail = '';
      let hours = 0;
      if (type === 'hourly') {
        const basis = typeof line.basis === 'string' ? (BASIS_LABEL[line.basis] || line.basis) : '—';
        hours = Math.round((Number(line.hours) || 0) * 100) / 100;
        const ot = Number(line.overtime) || 0;
        detail = ot > 0 ? `${basis} · incl. ${Math.round(ot * 100) / 100}h overtime` : basis;
      } else if (type === 'salary') {
        detail = 'Fixed per period';
      } else if (type === 'commission' || type === 'per_session') {
        detail = typeof line.basis === 'string' ? `From ${line.basis}` : 'From orders';
      }

      out.push({
        period,
        staff,
        category: isBase ? 'Base' : 'Commission',
        item: TYPE_LABEL[type] || type,
        detail,
        hours,
        amount,
      });
    }
  }

  return {
    id: 'detail',
    title: 'Line Item Detail',
    columns: [
      { key: 'period', header: 'Period', type: 'text', filterable: true, groupable: true },
      { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
      { key: 'category', header: 'Category', type: 'text', filterable: true, groupable: true },
      { key: 'item', header: 'Item', type: 'text', filterable: true },
      { key: 'detail', header: 'Detail', type: 'text' },
      { key: 'hours', header: 'Hours', type: 'number', total: true },
      { key: 'amount', header: 'Amount', type: 'currency', total: true },
    ],
    rows: out,
  };
}

export const payrollSummaryReport: ReportDefinition = {
  id: 'payroll-summary',
  title: 'Payroll Summary',
  buildSections: async (ctx: ReportContext): Promise<ReportSectionDef[]> => {
    const rows = await fetchEntries(ctx);
    return [buildSummarySection(rows), buildDetailSection(rows)];
  },
};
