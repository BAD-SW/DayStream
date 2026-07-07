import { adminPool } from '../db/pool';

interface CreateExpenseInput {
  businessId: string;
  date: string;
  amount: number;
  accountId?: string;
  description?: string;
  vendorId?: string;
  paymentMethod?: string;
  receiptPath?: string;
  isRecurring?: boolean;
  submittedBy?: string;
}

export async function createExpense(input: CreateExpenseInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO fin_expenses (business_id, date, amount, account_id, description, vendor_id, payment_method, receipt_path, is_recurring, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.businessId, input.date, input.amount, input.accountId||null, input.description||null, input.vendorId||null, input.paymentMethod||null, input.receiptPath||null, input.isRecurring??false, input.submittedBy||null],
  );
  return rows[0];
}

export async function getExpenses(businessId: string, filters?: { status?: string; accountId?: string; dateFrom?: string; dateTo?: string }) {
  const conditions = ['e.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;
  if (filters?.status) { conditions.push(`e.status = $${idx++}`); params.push(filters.status); }
  if (filters?.accountId) { conditions.push(`e.account_id = $${idx++}`); params.push(filters.accountId); }
  if (filters?.dateFrom) { conditions.push(`e.date >= $${idx++}`); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push(`e.date <= $${idx++}`); params.push(filters.dateTo); }
  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT e.*, coa.name AS account_name, v.name AS vendor_name
     FROM fin_expenses e
     LEFT JOIN fin_chart_of_accounts coa ON coa.id = e.account_id
     LEFT JOIN fin_vendors v ON v.id = e.vendor_id
     WHERE ${where} ORDER BY e.date DESC`,
    params,
  );
  return rows;
}

export async function approveExpense(id: string, businessId: string, approvedBy: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE fin_expenses SET status = 'approved', approved_by = $3 WHERE id = $1 AND business_id = $2 AND status = 'pending'",
    [id, businessId, approvedBy],
  );
  return (rowCount ?? 0) > 0;
}

export async function rejectExpense(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE fin_expenses SET status = 'rejected' WHERE id = $1 AND business_id = $2 AND status = 'pending'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getExpenseTotals(businessId: string, dateFrom: string, dateTo: string) {
  const { rows } = await adminPool.query(
    `SELECT coa.name AS category, COALESCE(SUM(e.amount), 0)::int AS total
     FROM fin_expenses e
     LEFT JOIN fin_chart_of_accounts coa ON coa.id = e.account_id
     WHERE e.business_id = $1 AND e.date >= $2 AND e.date <= $3 AND e.status = 'approved'
     GROUP BY coa.name ORDER BY total DESC`,
    [businessId, dateFrom, dateTo],
  );
  return rows;
}
