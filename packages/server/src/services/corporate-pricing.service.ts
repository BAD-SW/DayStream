import { adminPool } from '../db/pool';

interface CreateCorporateAccountInput {
  businessId: string;
  name: string;
  contactEmail?: string;
  billingEmail?: string;
  agreementStart?: string;
  agreementEnd?: string;
  status?: string;
}

/**
 * Create a corporate account.
 */
export async function createAccount(input: CreateCorporateAccountInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pri_corporate_accounts (business_id, name, contact_email, billing_email, agreement_start, agreement_end, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.businessId, input.name, input.contactEmail || null, input.billingEmail || null, input.agreementStart || null, input.agreementEnd || null, input.status || 'active'],
  );
  return rows[0];
}

/**
 * List corporate accounts for a business.
 */
export async function getAccounts(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT ca.*, (SELECT COUNT(*)::int FROM pri_corporate_members cam WHERE cam.account_id = ca.id) AS member_count
     FROM pri_corporate_accounts ca WHERE ca.business_id = $1 AND ca.status = 'active' ORDER BY ca.name`,
    [businessId],
  );
  return rows;
}

/**
 * Add a customer to a corporate account.
 */
export async function addMember(accountId: string, customerId: string): Promise<{ success: boolean; error?: string }> {
  // Check if already a member of this account
  const { rows: existing } = await adminPool.query(
    'SELECT 1 FROM pri_corporate_members WHERE account_id = $1 AND customer_id = $2',
    [accountId, customerId],
  );
  if (existing.length > 0) return { success: false, error: 'Customer is already a member of this account' };

  // Check if already a member of a different corporate account
  const { rows: otherAccount } = await adminPool.query(
    `SELECT ca.name FROM pri_corporate_members cam
     JOIN pri_corporate_accounts ca ON ca.id = cam.account_id
     WHERE cam.customer_id = $1 AND cam.account_id != $2`,
    [customerId, accountId],
  );
  if (otherAccount.length > 0) return { success: false, error: `Customer is already a member of "${otherAccount[0].name}". A customer can only belong to one corporate account.` };

  await adminPool.query(
    'INSERT INTO pri_corporate_members (account_id, customer_id) VALUES ($1, $2)',
    [accountId, customerId],
  );
  return { success: true };
}

/**
 * Remove a customer from a corporate account.
 */
export async function removeMember(accountId: string, customerId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM pri_corporate_members WHERE account_id = $1 AND customer_id = $2',
    [accountId, customerId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get members of a corporate account.
 */
export async function getMembers(accountId: string) {
  const { rows } = await adminPool.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, cam.added_at
     FROM pri_corporate_members cam
     JOIN cus_customers c ON c.id = cam.customer_id
     WHERE cam.account_id = $1 ORDER BY c.last_name`,
    [accountId],
  );
  return rows;
}

/**
 * Get the corporate account for a customer (if any).
 */
export async function getCustomerCorporateAccount(customerId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT ca.* FROM pri_corporate_accounts ca
     JOIN pri_corporate_members cam ON cam.account_id = ca.id
     WHERE cam.customer_id = $1 AND ca.business_id = $2 AND ca.status = 'active'`,
    [customerId, businessId],
  );
  return rows[0] || null;
}
