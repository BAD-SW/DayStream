import { adminPool } from '../db/pool';

/**
 * Account code mappings for item types.
 */
const REVENUE_ACCOUNT_CODES: Record<string, string> = {
  service: '4100',     // Service Revenue
  product: '4300',     // Product Revenue
  membership: '4200',  // Membership Revenue (used for recognition later)
  package: '4500',     // Package Revenue (used for recognition later)
};

// Items that go to deferred revenue instead of direct revenue at point of sale
const DEFERRED_ITEM_TYPES = ['membership', 'package'];
const DEFERRED_REVENUE_CODE = '2400';    // Deferred Revenue (liability)

const CASH_ACCOUNT_CODE = '1100';        // Cash & Bank
const TAX_PAYABLE_CODE = '2300';         // Tax Payable
const DISCOUNTS_ACCOUNT_CODE = '4900';   // Discounts & Adjustments

/**
 * Generate journal entries for a completed order.
 * 
 * Double-entry accounting:
 * - Debit: Cash (total amount paid)
 * - Credit: Revenue accounts (per item type, net of discount)
 * - Credit: Tax Payable (total tax collected)
 * - Debit: Discounts (if any promo discounts applied) — contra-revenue
 * 
 * For premiums (surcharges), the extra revenue goes to the item's revenue account.
 */
export async function generateJournalEntries(orderId: string, businessId: string, userId: string) {
  // Load order and items
  const { rows: orders } = await adminPool.query(
    'SELECT * FROM fin_orders WHERE id = $1 AND business_id = $2', [orderId, businessId],
  );
  if (orders.length === 0) throw new Error('Order not found');
  const order = orders[0];

  if (order.status !== 'completed') throw new Error('Order is not completed');

  // Check if journal entry already exists for this order
  const { rows: existingEntries } = await adminPool.query(
    `SELECT id FROM fin_journal_entries WHERE reference_type = 'order' AND reference_id = $1 AND is_void = false`,
    [orderId],
  );
  if (existingEntries.length > 0) return; // Already generated

  const { rows: items } = await adminPool.query(
    'SELECT * FROM fin_order_items WHERE order_id = $1', [orderId],
  );

  // Load account IDs for this business
  const { rows: accounts } = await adminPool.query(
    'SELECT id, code FROM fin_chart_of_accounts WHERE business_id = $1', [businessId],
  );
  const accountMap = new Map<string, string>();
  for (const acct of accounts) {
    accountMap.set(acct.code, acct.id);
  }

  const cashAccountId = accountMap.get(CASH_ACCOUNT_CODE);
  const taxPayableId = accountMap.get(TAX_PAYABLE_CODE);
  const discountsAccountId = accountMap.get(DISCOUNTS_ACCOUNT_CODE);

  if (!cashAccountId) {
    console.error(`[Journal] Missing Cash account (${CASH_ACCOUNT_CODE}) for business ${businessId}`);
    return;
  }

  // Create journal entry header — use business timezone for the date
  const { rows: bizRows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const bizTimezone = bizRows[0]?.timezone || 'UTC';
  const entryDate = new Date(order.completed_at || new Date()).toLocaleDateString('sv-SE', { timeZone: bizTimezone }); // YYYY-MM-DD format

  const { rows: entryRows } = await adminPool.query(
    `INSERT INTO fin_journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, 'order', $4, $5) RETURNING *`,
    [businessId, entryDate, `Order ${order.order_number}`, orderId, userId],
  );
  const entryId = entryRows[0].id;

  // Aggregate revenue by item type and track totals
  const revenueByType = new Map<string, number>(); // code -> amount (net revenue after discount)
  let deferredTotal = 0;
  let totalTax = 0;
  let totalDiscounts = 0;

  for (const item of items) {
    const grossAmount = item.unit_price * item.quantity;
    const discount = item.discount_amount > 0 ? item.discount_amount : 0;
    const surcharge = item.discount_amount < 0 ? Math.abs(item.discount_amount) : 0;
    const netRevenue = grossAmount - discount + surcharge;
    const revenueCode = REVENUE_ACCOUNT_CODES[item.item_type] || '4100';

    if (DEFERRED_ITEM_TYPES.includes(item.item_type)) {
      // Packages and memberships go to deferred revenue
      deferredTotal += netRevenue;
    } else {
      // Services and products are immediate revenue
      revenueByType.set(revenueCode, (revenueByType.get(revenueCode) || 0) + netRevenue);
    }
    totalTax += item.tax_amount;
    totalDiscounts += discount;
  }

  // Debit: Cash for total amount paid
  if (order.total_amount > 0) {
    await adminPool.query(
      `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, $3, 0, $4)`,
      [entryId, cashAccountId, order.total_amount, `Payment received - ${order.payment_method}`],
    );
  }

  // Credit: Revenue accounts
  for (const [code, amount] of revenueByType) {
    const accountId = accountMap.get(code);
    if (!accountId) continue;
    if (amount <= 0) continue;

    await adminPool.query(
      `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, 0, $3, $4)`,
      [entryId, accountId, amount, `Revenue - ${code}`],
    );
  }

  // Credit: Tax Payable
  if (totalTax > 0 && taxPayableId) {
    await adminPool.query(
      `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, 0, $3, $4)`,
      [entryId, taxPayableId, totalTax, 'Tax collected'],
    );
  }

  // Credit: Deferred Revenue (for packages and memberships)
  const deferredAccountId = accountMap.get(DEFERRED_REVENUE_CODE);
  if (deferredTotal > 0 && deferredAccountId) {
    await adminPool.query(
      `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, 0, $3, $4)`,
      [entryId, deferredAccountId, deferredTotal, 'Deferred revenue - packages/memberships'],
    );
  }

  // Debit: Discounts (contra-revenue) — reduces net revenue
  if (totalDiscounts > 0 && discountsAccountId) {
    await adminPool.query(
      `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, $3, 0, $4)`,
      [entryId, discountsAccountId, totalDiscounts, `Promo discount - ${order.promo_code || 'manual'}`],
    );
  }

  console.log(`[Journal] Generated entry ${entryId} for order ${order.order_number}: cash=${order.total_amount}, tax=${totalTax}, discounts=${totalDiscounts}`);
}
