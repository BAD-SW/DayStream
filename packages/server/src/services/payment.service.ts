import { adminPool } from '../db/pool';

interface CreateTransactionInput {
  businessId: string;
  customerId: string;
  bookingId?: string;
  membershipId?: string;
  type: 'charge' | 'refund' | 'credit';
  amount: number;
  currency: string;
  paymentMethod: string;
  referenceNumber?: string;
  description?: string;
  refundOfId?: string;
  refundReason?: string;
  processedBy: string;
  // Payment method metadata
  cardLast4?: string;
  cardBrand?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  checkNumber?: string;
  giftCardCode?: string;
}

interface TransactionFilters {
  businessId: string;
  type?: string;
  status?: string;
  customerId?: string;
  customerSearch?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  page?: number;
  limit?: number;
}

export async function createTransaction(input: CreateTransactionInput) {
  // For refunds, validate that the total refunded doesn't exceed the original payment
  if (input.type === 'refund' && input.refundOfId) {
    const { rows: originalRows } = await adminPool.query(
      'SELECT amount FROM pay_transactions WHERE id = $1 AND type = $2',
      [input.refundOfId, 'charge'],
    );
    if (originalRows.length === 0) throw new Error('Original transaction not found');
    const originalAmount = originalRows[0].amount;

    // Sum all existing refunds against this transaction
    const { rows: refundRows } = await adminPool.query(
      "SELECT COALESCE(SUM(amount), 0)::int AS total_refunded FROM pay_transactions WHERE refund_of_id = $1 AND type = 'refund' AND status = 'completed'",
      [input.refundOfId],
    );
    const totalRefunded = refundRows[0].total_refunded;
    const remainingRefundable = originalAmount - totalRefunded;

    if (input.amount > remainingRefundable) {
      throw new Error(`Refund amount exceeds remaining refundable balance. Original: ${originalAmount}, already refunded: ${totalRefunded}, remaining: ${remainingRefundable}`);
    }
  }

  const { rows } = await adminPool.query(
    `INSERT INTO pay_transactions (business_id, customer_id, booking_id, membership_id, type, amount, currency, payment_method, reference_number, description, refund_of_id, refund_reason, processed_by, card_last4, card_brand, bank_routing_number, bank_account_number, check_number, gift_card_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      input.businessId, input.customerId, input.bookingId || null, input.membershipId || null,
      input.type, input.amount, input.currency, input.paymentMethod,
      input.referenceNumber || null, input.description || null,
      input.refundOfId || null, input.refundReason || null, input.processedBy,
      input.cardLast4 || null, input.cardBrand || null,
      input.bankRoutingNumber || null, input.bankAccountNumber || null,
      input.checkNumber || null, input.giftCardCode || null,
    ],
  );
  return rows[0];
}

export async function getTransactions(filters: TransactionFilters) {
  const conditions = ['t.business_id = $1'];
  const params: any[] = [filters.businessId];
  let idx = 2;

  if (filters.type) { conditions.push(`t.type = $${idx++}`); params.push(filters.type); }
  if (filters.status) { conditions.push(`t.status = $${idx++}`); params.push(filters.status); }
  if (filters.customerId) { conditions.push(`t.customer_id = $${idx++}`); params.push(filters.customerId); }
  if (filters.paymentMethod) { conditions.push(`t.payment_method = $${idx++}`); params.push(filters.paymentMethod); }
  if (filters.dateFrom) { conditions.push(`t.created_at >= $${idx++}`); params.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push(`t.created_at <= $${idx++}`); params.push(filters.dateTo + 'T23:59:59Z'); }
  if (filters.customerSearch) {
    conditions.push(`t.customer_id IN (SELECT id FROM cus_customers WHERE first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR CONCAT(first_name, ' ', last_name) ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${filters.customerSearch}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT t.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email,
              u.first_name AS processed_by_first_name, u.last_name AS processed_by_last_name,
              ${PURPOSE_SELECT}
       FROM pay_transactions t
       JOIN cus_customers c ON c.id = t.customer_id
       LEFT JOIN usr_users u ON u.id = t.processed_by
       ${PURPOSE_JOINS}
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM pay_transactions t WHERE ${where}`, params),
  ]);

  return {
    transactions: dataResult.rows.map(withPurpose),
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * "What is this payment FOR?" resolution.
 *
 * A pay_transactions row links to at most one meaningful thing. These JOINs pull
 * the readable bits (invoice number, booked service + time, membership plan name,
 * the original charge of a refund), and `withPurpose` below turns them into a
 * human label + a structured link the UI can navigate:
 *   - invoice     -> open the invoice PDF
 *   - booking     -> /bookings/:id/edit
 *   - membership  -> /memberships/:planId   (resolved from the enrollment/legacy plan)
 *   - others (deposit on account, gift-card redemption, refund, plain payment)
 *     carry a label but no destination.
 *
 * All JOINs are LEFT and keyed on the row's own linkage columns, so they add at
 * most one matching row each and never change the result set.
 */
const PURPOSE_JOINS = `
  LEFT JOIN pay_invoices pi ON pi.id = t.invoice_id
  LEFT JOIN apt_bookings ab ON ab.id = t.booking_id
  LEFT JOIN svc_services ss ON ss.id = ab.service_id
  LEFT JOIN mbr_enrollments me ON me.id = t.enrollment_id
  LEFT JOIN mbr_plans mp ON mp.id = me.plan_id
  LEFT JOIN mem_memberships mm ON mm.id = t.membership_id
  LEFT JOIN mem_plans mmp ON mmp.id = mm.plan_id
  LEFT JOIN pay_transactions orig ON orig.id = t.refund_of_id
  LEFT JOIN fin_orders fo
    ON fo.business_id = t.business_id
   AND fo.payment_reference = t.reference_number
   AND fo.status = 'completed'
`;

const PURPOSE_SELECT = `
  pi.invoice_number       AS purpose_invoice_number,
  ab.start_time           AS purpose_booking_start,
  ss.name                 AS purpose_service_name,
  mp.name                 AS purpose_plan_name,
  me.plan_id              AS purpose_enrollment_plan_id,
  mmp.name                AS purpose_legacy_plan_name,
  mm.plan_id              AS purpose_legacy_plan_id,
  orig.reference_number   AS purpose_refund_of_reference,
  fo.id                   AS purpose_order_id,
  fo.order_number         AS purpose_order_number
`;

export type PurposeLinkType = 'invoice' | 'order' | 'booking' | 'membership';

export interface PurposeLink {
  type: PurposeLinkType;
  id: string;           // invoice id, booking id, or membership PLAN id
}

/** Derive the human label + navigable link for a transaction row from the JOINed fields. */
function withPurpose(row: any): any {
  const label = resolvePurposeLabel(row);
  const link = resolvePurposeLink(row);
  // Strip the raw purpose_* scratch columns from the response; keep the result clean.
  const clean: any = {};
  for (const k of Object.keys(row)) {
    if (!k.startsWith('purpose_')) clean[k] = row[k];
  }
  clean.purpose_label = label;
  clean.purpose_link = link;
  return clean;
}

function resolvePurposeLabel(row: any): string {
  // Refund first: a refund row is "about" the charge it reverses, regardless of
  // any linkage it inherited.
  if (row.type === 'refund') {
    return row.purpose_refund_of_reference
      ? `Refund of ${row.purpose_refund_of_reference}`
      : 'Refund';
  }
  if (row.purpose_invoice_number != null) return `Invoice #${row.purpose_invoice_number}`;
  if (row.purpose_order_number) return `Order ${row.purpose_order_number}`;
  if (row.payment_method === 'account_credit') return 'Account credit applied';
  if (row.purpose_service_name) {
    const when = row.purpose_booking_start
      ? ` · ${new Date(row.purpose_booking_start).toLocaleDateString()}`
      : '';
    return `Booking: ${row.purpose_service_name}${when}`;
  }
  if (row.purpose_plan_name) return `${row.purpose_plan_name} membership`;
  if (row.purpose_legacy_plan_name) return `${row.purpose_legacy_plan_name} membership`;
  if (row.gift_card_code) return `Gift card ${row.gift_card_code}`;
  // No linkage: money taken/held without being tied to a specific sale yet.
  return row.type === 'credit' ? 'Account credit' : 'Payment on account';
}

function resolvePurposeLink(row: any): PurposeLink | null {
  if (row.type === 'refund') return null;         // original charge isn't a navigable page
  if (row.purpose_invoice_number != null && row.invoice_id) return { type: 'invoice', id: row.invoice_id };
  if (row.purpose_order_id) return { type: 'order', id: row.purpose_order_id };
  if (row.purpose_service_name && row.booking_id) return { type: 'booking', id: row.booking_id };
  // Membership links go to the PLAN page (the only membership detail route), using
  // the plan id resolved from the enrollment (or legacy membership).
  if (row.purpose_enrollment_plan_id) return { type: 'membership', id: row.purpose_enrollment_plan_id };
  if (row.purpose_legacy_plan_id) return { type: 'membership', id: row.purpose_legacy_plan_id };
  return null;
}

export async function getTransactionById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT t.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email,
            u.first_name AS processed_by_first_name, u.last_name AS processed_by_last_name,
            ${PURPOSE_SELECT}
     FROM pay_transactions t
     JOIN cus_customers c ON c.id = t.customer_id
     LEFT JOIN usr_users u ON u.id = t.processed_by
     ${PURPOSE_JOINS}
     WHERE t.id = $1 AND t.business_id = $2`,
    [id, businessId],
  );
  return rows[0] ? withPurpose(rows[0]) : null;
}

export async function getTransactionSummary(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'charge' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_charges,
       COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_refunds,
       COUNT(CASE WHEN type = 'charge' AND status = 'completed' THEN 1 END)::int AS charge_count,
       COUNT(CASE WHEN type = 'refund' AND status = 'completed' THEN 1 END)::int AS refund_count,
       COALESCE(SUM(CASE WHEN type = 'charge' AND status = 'completed' AND created_at >= date_trunc('month', NOW()) THEN amount ELSE 0 END), 0) AS mtd_charges,
       COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'completed' AND created_at >= date_trunc('month', NOW()) THEN amount ELSE 0 END), 0) AS mtd_refunds
     FROM pay_transactions WHERE business_id = $1`,
    [businessId],
  );
  return rows[0];
}

interface RefundableFilters {
  businessId: string;
  customerId: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  limit?: number;
  offset?: number;
}

export async function getRefundableCharges(filters: RefundableFilters) {
  const conditions = ['t.business_id = $1', 't.customer_id = $2', "t.type = 'charge'", "t.status = 'completed'"];
  const params: any[] = [filters.businessId, filters.customerId];
  let idx = 3;

  if (filters.dateFrom) {
    conditions.push(`t.created_at >= $${idx}::date`);
    params.push(filters.dateFrom);
    idx++;
  }
  if (filters.dateTo) {
    conditions.push(`t.created_at < ($${idx}::date + interval '1 day')`);
    params.push(filters.dateTo);
    idx++;
  }
  if (filters.paymentMethod) {
    conditions.push(`t.payment_method = $${idx}`);
    params.push(filters.paymentMethod);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 5, 50);
  const offset = filters.offset || 0;

  // Get total count of refundable charges (those with remaining balance > 0)
  const countResult = await adminPool.query(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT t.amount - COALESCE((SELECT SUM(r.amount) FROM pay_transactions r WHERE r.refund_of_id = t.id AND r.type = 'refund' AND r.status = 'completed'), 0) AS remaining
       FROM pay_transactions t
       WHERE ${where}
     ) sub WHERE remaining > 0`,
    params,
  );

  const { rows } = await adminPool.query(
    `SELECT t.id, t.amount, t.currency, t.payment_method, t.created_at, t.reference_number,
            COALESCE((SELECT SUM(r.amount) FROM pay_transactions r WHERE r.refund_of_id = t.id AND r.type = 'refund' AND r.status = 'completed'), 0)::int AS total_refunded
     FROM pay_transactions t
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  // Filter to only those with remaining balance and compute remaining
  const refundable = rows
    .map((r: any) => ({ ...r, remaining: r.amount - r.total_refunded }))
    .filter((r: any) => r.remaining > 0);

  // Get distinct payment methods across all refundable charges for this customer (ignoring payment_method filter)
  const baseConditions = ['t.business_id = $1', 't.customer_id = $2', "t.type = 'charge'", "t.status = 'completed'"];
  const baseParams: any[] = [filters.businessId, filters.customerId];
  const methodsResult = await adminPool.query(
    `SELECT DISTINCT sub.payment_method FROM (
       SELECT t.payment_method, t.amount - COALESCE((SELECT SUM(r.amount) FROM pay_transactions r WHERE r.refund_of_id = t.id AND r.type = 'refund' AND r.status = 'completed'), 0) AS remaining
       FROM pay_transactions t
       WHERE ${baseConditions.join(' AND ')}
     ) sub WHERE sub.remaining > 0
     ORDER BY sub.payment_method`,
    baseParams,
  );

  return {
    charges: refundable,
    total: countResult.rows[0].total,
    limit,
    offset,
    distinctMethods: methodsResult.rows.map((r: any) => r.payment_method),
  };
}


// --- Accepted Payment Methods ---

const ALL_METHODS = ['cash', 'card', 'bank_draw', 'bank_transfer', 'check', 'gift_card', 'google_pay', 'apple_pay', 'other'];

/** Methods enabled by default when a business has no explicit setting for them. */
function defaultEnabled(method: string): boolean {
  // Wallets and the bank-draw pull require an integration/mandate flow, so they
  // default OFF; everything else defaults ON so a new business can take payment.
  return method !== 'google_pay' && method !== 'apple_pay' && method !== 'bank_draw';
}

/**
 * The effective accepted-methods map for a business: the full catalog, with each
 * method's enabled flag taken from the stored row when present, otherwise its
 * default. This matters because a business can have a PARTIAL set of rows (e.g.
 * only a disabled bank_draw from a backfill) — the missing standard methods must
 * still resolve to their sensible default rather than disappearing. Both the
 * Settings UI (getAcceptedMethods) and the charge-availability resolver read
 * through this so they never diverge.
 */
export async function getEffectiveAcceptedMethods(businessId: string): Promise<Record<string, boolean>> {
  const { rows } = await adminPool.query(
    'SELECT method, enabled FROM pay_accepted_methods WHERE business_id = $1',
    [businessId],
  );
  const stored = new Map<string, boolean>(rows.map((r) => [r.method, r.enabled]));
  const effective: Record<string, boolean> = {};
  for (const m of ALL_METHODS) {
    effective[m] = stored.has(m) ? stored.get(m)! : defaultEnabled(m);
  }
  return effective;
}

export async function getAcceptedMethods(businessId: string) {
  const effective = await getEffectiveAcceptedMethods(businessId);
  return ALL_METHODS.map((method) => ({ method, enabled: effective[method] }));
}

export async function updateAcceptedMethods(businessId: string, methods: { method: string; enabled: boolean }[]) {
  // Upsert each method
  for (const { method, enabled } of methods) {
    if (!ALL_METHODS.includes(method)) continue;
    await adminPool.query(
      `INSERT INTO pay_accepted_methods (business_id, method, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, method) DO UPDATE SET enabled = $3, updated_at = NOW()`,
      [businessId, method, enabled],
    );
  }

  return getAcceptedMethods(businessId);
}
