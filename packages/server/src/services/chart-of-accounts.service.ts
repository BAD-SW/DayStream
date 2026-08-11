import { adminPool } from '../db/pool';

interface CreateAccountInput {
  businessId: string;
  code: string;
  name: string;
  accountType: string;
  parentId?: string;
  description?: string;
}

export async function createAccount(input: CreateAccountInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, parent_id, description)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.businessId, input.code, input.name, input.accountType, input.parentId || null, input.description || null],
  );
  return rows[0];
}

export async function getAccounts(businessId: string) {
  const { rows } = await adminPool.query(
    "SELECT * FROM fin_chart_of_accounts WHERE business_id = $1 ORDER BY code",
    [businessId],
  );
  return rows;
}

export async function archiveAccount(id: string, businessId: string): Promise<{ success: boolean; error?: string }> {
  // Prevent archiving if has transactions
  const { rows: txnCheck } = await adminPool.query(
    'SELECT 1 FROM fin_journal_entry_lines WHERE account_id = $1 LIMIT 1', [id],
  );
  if (txnCheck.length > 0) return { success: false, error: 'Cannot archive account with transactions' };

  const { rows: acct } = await adminPool.query(
    'SELECT id FROM fin_chart_of_accounts WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (acct.length === 0) return { success: false, error: 'Account not found' };

  await adminPool.query(
    "UPDATE fin_chart_of_accounts SET status = 'archived' WHERE id = $1 AND business_id = $2", [id, businessId],
  );
  return { success: true };
}

export async function unarchiveAccount(id: string, businessId: string): Promise<{ success: boolean; error?: string }> {
  const { rows: acct } = await adminPool.query(
    'SELECT status FROM fin_chart_of_accounts WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (acct.length === 0) return { success: false, error: 'Account not found' };
  if (acct[0].status !== 'archived') return { success: false, error: 'Account is not archived' };

  await adminPool.query(
    "UPDATE fin_chart_of_accounts SET status = 'active' WHERE id = $1 AND business_id = $2", [id, businessId],
  );
  return { success: true };
}

export async function updateAccount(id: string, businessId: string, updates: { name?: string; code?: string; description?: string }) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM fin_chart_of_accounts WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.code !== undefined) { fields.push(`code = $${idx++}`); values.push(updates.code); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description || null); }

  if (fields.length === 0) return existing[0];
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE fin_chart_of_accounts SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

export async function seedDefaults(businessId: string): Promise<void> {
  await adminPool.query('SELECT seed_chart_of_accounts($1)', [businessId]);
}
