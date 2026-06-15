import { adminPool } from '../db/pool';

interface CreateBillInput {
  businessId: string;
  vendorId: string;
  invoiceNumber?: string;
  amount: number;
  dueDate: string;
  description?: string;
  lineItems?: Array<{ description: string; quantity: number; unit_price: number; account_id?: string }>;
  isRecurring?: boolean;
  recurrenceInterval?: string;
}

export async function createBill(input: CreateBillInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO bills (business_id, vendor_id, invoice_number, amount, due_date, description, is_recurring, recurrence_interval)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.businessId, input.vendorId, input.invoiceNumber||null, input.amount, input.dueDate, input.description||null, input.isRecurring??false, input.recurrenceInterval||null],
  );
  const bill = rows[0];

  if (input.lineItems) {
    for (const item of input.lineItems) {
      const lineAmount = Math.round(item.quantity * item.unit_price);
      await adminPool.query(
        `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, account_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bill.id, item.description, item.quantity, item.unit_price, item.account_id||null, lineAmount],
      );
    }
  }

  return bill;
}

export async function getBills(businessId: string, filters?: { status?: string; vendorId?: string }) {
  const conditions = ['b.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;
  if (filters?.status) { conditions.push(`b.status = $${idx++}`); params.push(filters.status); }
  if (filters?.vendorId) { conditions.push(`b.vendor_id = $${idx++}`); params.push(filters.vendorId); }
  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE ${where} ORDER BY b.due_date`,
    params,
  );
  return rows;
}

export async function approveBill(id: string, businessId: string, approvedBy: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE bills SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('draft','pending')",
    [id, businessId, approvedBy],
  );
  return (rowCount ?? 0) > 0;
}

export async function recordPayment(id: string, businessId: string, amount: number): Promise<any> {
  const { rows } = await adminPool.query('SELECT * FROM bills WHERE id = $1 AND business_id = $2', [id, businessId]);
  if (rows.length === 0) return null;
  const bill = rows[0];
  const newPaid = bill.amount_paid + amount;
  const newStatus = newPaid >= bill.amount ? 'paid' : bill.status;
  await adminPool.query(
    'UPDATE bills SET amount_paid = $3, status = $4, updated_at = NOW() WHERE id = $1 AND business_id = $2',
    [id, businessId, newPaid, newStatus],
  );
  return { ...bill, amount_paid: newPaid, status: newStatus };
}

export async function markOverdueBills(): Promise<number> {
  const { rowCount } = await adminPool.query(
    "UPDATE bills SET status = 'overdue', updated_at = NOW() WHERE status IN ('pending','approved') AND due_date < CURRENT_DATE",
  );
  return rowCount ?? 0;
}

export async function getAccountsPayableTotal(businessId: string): Promise<number> {
  const { rows } = await adminPool.query(
    "SELECT COALESCE(SUM(amount - amount_paid), 0)::int AS total FROM bills WHERE business_id = $1 AND status NOT IN ('paid','void')",
    [businessId],
  );
  return rows[0].total;
}
