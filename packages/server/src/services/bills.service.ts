import { adminPool } from '../db/pool';

interface CreateBillInput {
  businessId: string;
  vendorId: string;
  invoiceNumber?: string;
  amount: number;
  dueDate: string;
  description?: string;
  accountId?: string;
  lineItems?: Array<{ description: string; quantity: number; unit_price: number; account_id?: string }>;
  isRecurring?: boolean;
  recurrenceInterval?: string;
  createdBy?: string;
}

export async function createBill(input: CreateBillInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO fin_bills (business_id, vendor_id, invoice_number, amount, due_date, description, account_id, is_recurring, recurrence_interval)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.businessId, input.vendorId, input.invoiceNumber||null, input.amount, input.dueDate, input.description||null, input.accountId||null, input.isRecurring??false, input.recurrenceInterval||null],
  );
  const bill = rows[0];

  if (input.lineItems) {
    for (const item of input.lineItems) {
      const lineAmount = Math.round(item.quantity * item.unit_price);
      await adminPool.query(
        `INSERT INTO fin_bill_line_items (bill_id, description, quantity, unit_price, account_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bill.id, item.description, item.quantity, item.unit_price, item.account_id||null, lineAmount],
      );
    }
  }

  // Generate journal entry: Debit Expense, Credit Accounts Payable
  if (input.accountId) {
    try {
      const apAccountId = await getAccountByCode(input.businessId, '2100'); // Accounts Payable
      if (apAccountId) {
        const { rows: vendorRows } = await adminPool.query('SELECT name FROM fin_vendors WHERE id = $1', [input.vendorId]);
        const vendorName = vendorRows[0]?.name || 'Unknown';
        const entryDate = new Date().toISOString().slice(0, 10);

        const { rows: entryRows } = await adminPool.query(
          `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, 'bill', $4, $5) RETURNING *`,
          [input.businessId, entryDate, `Bill - ${vendorName}${input.invoiceNumber ? ` #${input.invoiceNumber}` : ''}`, bill.id, input.createdBy || null],
        );
        const entryId = entryRows[0].id;

        // Debit: Expense account
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, $3, 0, $4)`,
          [entryId, input.accountId, input.amount, input.description || 'Bill expense'],
        );
        // Credit: Accounts Payable
        await adminPool.query(
          `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
           VALUES ($1, $2, 0, $3, $4)`,
          [entryId, apAccountId, input.amount, `Payable to ${vendorName}`],
        );
      }
    } catch (err: any) {
      console.error('[Journal] Failed to generate bill entry:', err.message);
    }
  }

  return bill;
}

async function getAccountByCode(businessId: string, code: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    'SELECT id FROM fin_chart_of_accounts WHERE business_id = $1 AND code = $2', [businessId, code],
  );
  return rows[0]?.id || null;
}

export async function getBills(businessId: string, filters?: { status?: string; vendorId?: string }) {
  const conditions = ['b.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;
  if (filters?.status) { conditions.push(`b.status = $${idx++}`); params.push(filters.status); }
  if (filters?.vendorId) { conditions.push(`b.vendor_id = $${idx++}`); params.push(filters.vendorId); }
  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT b.*, v.name AS vendor_name FROM fin_bills b JOIN fin_vendors v ON v.id = b.vendor_id WHERE ${where} ORDER BY b.due_date`,
    params,
  );
  return rows;
}

export async function approveBill(id: string, businessId: string, approvedBy: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE fin_bills SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('draft','pending')",
    [id, businessId, approvedBy],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateBill(id: string, businessId: string, updates: any): Promise<any> {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM fin_bills WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  const allowed: Record<string, string> = { vendor_id: 'vendor_id', invoice_number: 'invoice_number', amount: 'amount', due_date: 'due_date', description: 'description', account_id: 'account_id' };

  for (const [key, val] of Object.entries(updates)) {
    if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(val); }
  }
  if (fields.length === 0) return existing[0];

  fields.push('updated_at = NOW()');
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE fin_bills SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

export async function recordPayment(id: string, businessId: string, amount: number): Promise<any> {
  const { rows } = await adminPool.query('SELECT * FROM fin_bills WHERE id = $1 AND business_id = $2', [id, businessId]);
  if (rows.length === 0) return null;
  const bill = rows[0];
  const newPaid = bill.amount_paid + amount;
  const newStatus = newPaid >= bill.amount ? 'paid' : bill.status;
  await adminPool.query(
    'UPDATE fin_bills SET amount_paid = $3, status = $4, updated_at = NOW() WHERE id = $1 AND business_id = $2',
    [id, businessId, newPaid, newStatus],
  );

  // Generate journal entry: Debit Accounts Payable, Credit Cash
  try {
    const apAccountId = await getAccountByCode(businessId, '2100'); // Accounts Payable
    const cashAccountId = await getAccountByCode(businessId, '1100'); // Cash & Bank
    if (apAccountId && cashAccountId) {
      const { rows: vendorRows } = await adminPool.query(
        'SELECT v.name FROM fin_vendors v WHERE v.id = $1', [bill.vendor_id],
      );
      const vendorName = vendorRows[0]?.name || 'Unknown';
      const entryDate = new Date().toISOString().slice(0, 10);

      const { rows: entryRows } = await adminPool.query(
        `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id)
         VALUES ($1, $2, $3, 'bill_payment', $4) RETURNING *`,
        [businessId, entryDate, `Payment - ${vendorName}${bill.invoice_number ? ` #${bill.invoice_number}` : ''}`, id],
      );
      const entryId = entryRows[0].id;

      // Debit: Accounts Payable (reduces liability)
      await adminPool.query(
        `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, 0, $4)`,
        [entryId, apAccountId, amount, `Payment to ${vendorName}`],
      );
      // Credit: Cash (money out)
      await adminPool.query(
        `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, 0, $3, $4)`,
        [entryId, cashAccountId, amount, `Payment to ${vendorName}`],
      );
    }
  } catch (err: any) {
    console.error('[Journal] Failed to generate payment entry:', err.message);
  }

  return { ...bill, amount_paid: newPaid, status: newStatus };
}

export async function markOverdueBills(): Promise<number> {
  const { rowCount } = await adminPool.query(
    "UPDATE fin_bills SET status = 'overdue', updated_at = NOW() WHERE status IN ('pending','approved') AND due_date < CURRENT_DATE",
  );
  return rowCount ?? 0;
}

export async function getAccountsPayableTotal(businessId: string): Promise<number> {
  const { rows } = await adminPool.query(
    "SELECT COALESCE(SUM(amount - amount_paid), 0)::int AS total FROM fin_bills WHERE business_id = $1 AND status NOT IN ('paid','void')",
    [businessId],
  );
  return rows[0].total;
}
