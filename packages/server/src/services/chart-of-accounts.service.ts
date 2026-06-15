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
    `INSERT INTO chart_of_accounts (business_id, code, name, account_type, parent_id, description)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.businessId, input.code, input.name, input.accountType, input.parentId || null, input.description || null],
  );
  return rows[0];
}

export async function getAccounts(businessId: string) {
  const { rows } = await adminPool.query(
    "SELECT * FROM chart_of_accounts WHERE business_id = $1 AND status = 'active' ORDER BY code",
    [businessId],
  );
  return rows;
}

export async function archiveAccount(id: string, businessId: string): Promise<{ success: boolean; error?: string }> {
  // Prevent archiving if has transactions
  const { rows: txnCheck } = await adminPool.query(
    'SELECT 1 FROM journal_entry_lines WHERE account_id = $1 LIMIT 1', [id],
  );
  if (txnCheck.length > 0) return { success: false, error: 'Cannot archive account with transactions' };

  // Prevent archiving system accounts
  const { rows: acct } = await adminPool.query(
    'SELECT is_system FROM chart_of_accounts WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (acct.length === 0) return { success: false, error: 'Account not found' };
  if (acct[0].is_system) return { success: false, error: 'Cannot archive system account' };

  await adminPool.query(
    "UPDATE chart_of_accounts SET status = 'archived' WHERE id = $1 AND business_id = $2", [id, businessId],
  );
  return { success: true };
}

export async function seedDefaults(businessId: string): Promise<void> {
  await adminPool.query('SELECT seed_chart_of_accounts($1)', [businessId]);
}
