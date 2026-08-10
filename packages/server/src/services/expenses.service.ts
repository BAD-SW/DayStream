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
  const expense = rows[0];

  // Generate journal entry: Debit Expense Account, Credit Cash
  if (input.accountId) {
    try {
      const { rows: cashRows } = await adminPool.query(
        "SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1100'", [input.businessId],
      );
      const cashAccountId = cashRows[0]?.id;
      if (cashAccountId) {
        const entryDate = typeof input.date === 'string' ? input.date.split('T')[0] : input.date;
        const { rows: entryRows } = await adminPool.query(
          `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id)
           VALUES ($1, $2, $3, 'expense', $4) RETURNING *`,
          [input.businessId, entryDate, `Expense - ${input.description || 'General'}`, expense.id],
        );
        const entryId = entryRows[0].id;

        // Debit: Expense account
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, $3, 0, $4)`,
          [entryId, input.accountId, input.amount, input.description || 'Expense'],
        );
        // Credit: Cash
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, 0, $3, $4)`,
          [entryId, cashAccountId, input.amount, `Paid via ${input.paymentMethod || 'cash'}`],
        );
      }
    } catch (err: any) {
      console.error('[Journal] Failed to generate expense entry:', err.message);
    }
  }

  return expense;
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


export async function updateExpense(id: string, businessId: string, input: Partial<Omit<CreateExpenseInput, 'businessId' | 'submittedBy'>>) {
  // Build SET clause dynamically
  const fields: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (input.date !== undefined) { fields.push(`date = $${idx++}`); params.push(input.date); }
  if (input.amount !== undefined) { fields.push(`amount = $${idx++}`); params.push(input.amount); }
  if (input.accountId !== undefined) { fields.push(`account_id = $${idx++}`); params.push(input.accountId || null); }
  if (input.description !== undefined) { fields.push(`description = $${idx++}`); params.push(input.description || null); }
  if (input.vendorId !== undefined) { fields.push(`vendor_id = $${idx++}`); params.push(input.vendorId || null); }
  if (input.paymentMethod !== undefined) { fields.push(`payment_method = $${idx++}`); params.push(input.paymentMethod || null); }

  if (fields.length === 0) return null;

  params.push(id, businessId);
  const { rows } = await adminPool.query(
    `UPDATE fin_expenses SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;

  const expense = rows[0];

  // Rebuild journal entry if account changed or amount changed
  // Delete old journal entry and recreate
  await adminPool.query(
    "DELETE FROM fin_journal_entries WHERE reference_type = 'expense' AND reference_id = $1 AND business_id = $2",
    [id, businessId],
  );

  const accountId = expense.account_id;
  if (accountId) {
    try {
      const { rows: cashRows } = await adminPool.query(
        "SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = '1100'", [businessId],
      );
      const cashAccountId = cashRows[0]?.id;
      if (cashAccountId) {
        const entryDate = typeof expense.date === 'string' ? expense.date.split('T')[0] : expense.date;
        const { rows: entryRows } = await adminPool.query(
          `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id)
           VALUES ($1, $2, $3, 'expense', $4) RETURNING *`,
          [businessId, entryDate, `Expense - ${expense.description || 'General'}`, expense.id],
        );
        const entryId = entryRows[0].id;
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, $3, 0, $4)`,
          [entryId, accountId, expense.amount, expense.description || 'Expense'],
        );
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, 0, $3, $4)`,
          [entryId, cashAccountId, expense.amount, `Paid via ${expense.payment_method || 'cash'}`],
        );
      }
    } catch (err: any) {
      console.error('[Journal] Failed to regenerate expense entry:', err.message);
    }
  }

  return expense;
}

export async function deleteExpense(id: string, businessId: string): Promise<boolean> {
  // Delete associated journal entry first
  await adminPool.query(
    "DELETE FROM fin_journal_entries WHERE reference_type = 'expense' AND reference_id = $1 AND business_id = $2",
    [id, businessId],
  );
  // Delete the expense
  const { rowCount } = await adminPool.query(
    "DELETE FROM fin_expenses WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
