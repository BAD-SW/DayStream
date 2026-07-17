import { adminPool } from '../db/pool';

// --- Interfaces ---

interface CreatePackageInput {
  businessId: string;
  name: string;
  description?: string;
  shortDescription?: string;
  price: number;
  expirationType?: string;
  expirationDays?: number;
  expirationUnit?: string;
  displayOrder?: number;
  isTaxable?: boolean;
  taxCategoryId?: string;
  newCustomersOnly?: boolean;
}

interface PackageFilters {
  businessId: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface PackageItemInput {
  packageId: string;
  itemType: 'service' | 'merchandise';
  serviceId?: string;
  merchandiseId?: string;
  variantId?: string;
  quantity: number;
  redemptionType?: 'sessions' | 'minutes';
}

// --- Package CRUD ---

export async function createPackage(input: CreatePackageInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pkg_packages (business_id, name, description, short_description, price, expiration_type, expiration_days, expiration_unit, display_order, is_taxable, tax_category_id, new_customers_only)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null, input.shortDescription || null,
      input.price, input.expirationType || 'none', input.expirationDays || null,
      input.expirationUnit || 'days',
      input.displayOrder ?? 0, input.isTaxable ?? false, input.taxCategoryId || null,
      input.newCustomersOnly ?? false,
    ],
  );
  return rows[0];
}

export async function getPackages(filters: PackageFilters) {
  const conditions = ['p.business_id = $1'];
  const params: any[] = [filters.businessId];
  let idx = 2;

  if (filters.status && filters.status !== 'all') {
    conditions.push(`p.status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM pkg_purchases pp WHERE pp.package_id = p.id AND pp.status = 'active') AS active_purchases
       FROM pkg_packages p WHERE ${where} ORDER BY p.display_order, p.name LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM pkg_packages p WHERE ${where}`, params),
  ]);

  return { packages: dataResult.rows, total: countResult.rows[0].total, page, limit };
}

export async function getPackageById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM pkg_purchases pp WHERE pp.package_id = p.id AND pp.status = 'active') AS active_purchases
     FROM pkg_packages p WHERE p.id = $1 AND p.business_id = $2`,
    [id, businessId],
  );
  return rows[0] || null;
}

export async function updatePackage(id: string, businessId: string, updates: Record<string, any>) {
  const allowedFields = ['name', 'description', 'short_description', 'price', 'status', 'expiration_type', 'expiration_days', 'expiration_unit', 'display_order', 'is_taxable', 'tax_category_id', 'new_customers_only'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      let finalValue = value;
      if (key === 'tax_category_id' && value === '') finalValue = null;
      fields.push(`${key} = $${idx++}`);
      values.push(finalValue);
    }
  }

  if (fields.length === 0) return getPackageById(id, businessId);

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE pkg_packages SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  return getPackageById(id, businessId);
}

export async function archivePackage(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE pkg_packages SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status != 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function activatePackage(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE pkg_packages SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('paused', 'archived')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function pausePackage(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE pkg_packages SET status = 'paused', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Package Items ---

export async function getPackageItems(packageId: string) {
  const { rows } = await adminPool.query(
    `SELECT pi.*, s.name AS service_name, m.name AS merchandise_name
     FROM pkg_package_items pi
     LEFT JOIN svc_services s ON s.id = pi.service_id
     LEFT JOIN prd_merchandise m ON m.id = pi.merchandise_id
     WHERE pi.package_id = $1 ORDER BY pi.created_at`,
    [packageId],
  );
  return rows;
}

export async function addPackageItem(input: PackageItemInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pkg_package_items (package_id, item_type, service_id, merchandise_id, variant_id, quantity, redemption_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.packageId, input.itemType, input.serviceId || null, input.merchandiseId || null, input.variantId || null, input.quantity, input.redemptionType || 'sessions'],
  );
  return rows[0];
}

export async function updatePackageItem(itemId: string, updates: { quantity?: number; variantId?: string | null; redemptionType?: string }) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(updates.quantity); }
  if (updates.variantId !== undefined) { fields.push(`variant_id = $${idx++}`); values.push(updates.variantId || null); }
  if (updates.redemptionType !== undefined) { fields.push(`redemption_type = $${idx++}`); values.push(updates.redemptionType); }

  if (fields.length === 0) return null;
  values.push(itemId);
  const { rows } = await adminPool.query(`UPDATE pkg_package_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
  return rows[0] || null;
}

export async function removePackageItem(itemId: string) {
  const { rowCount } = await adminPool.query('DELETE FROM pkg_package_items WHERE id = $1', [itemId]);
  return (rowCount ?? 0) > 0;
}


// --- Package Purchases ---

interface PurchaseInput {
  packageId: string;
  businessId: string;
  customerId: string;
}

export async function purchasePackage(input: PurchaseInput) {
  // Get package to determine expiration
  const pkg = await getPackageById(input.packageId, input.businessId);
  if (!pkg) throw new Error('Package not found');
  if (pkg.status !== 'active') throw new Error('Package is not available for purchase');

  // Check new customers only restriction
  if (pkg.new_customers_only) {
    const { rows: history } = await adminPool.query(
      `SELECT id FROM pkg_purchases WHERE customer_id = $1 AND business_id = $2 LIMIT 1`,
      [input.customerId, input.businessId],
    );
    if (history.length > 0) {
      throw new Error('This intro package is only available to new customers');
    }
    // Also check for completed appointments
    const { rows: bookings } = await adminPool.query(
      `SELECT id FROM apt_bookings WHERE customer_id = $1 AND business_id = $2 AND status IN ('completed', 'checked_in') LIMIT 1`,
      [input.customerId, input.businessId],
    );
    if (bookings.length > 0) {
      throw new Error('This intro package is only available to new customers');
    }
  }

  let expiresAt: string | null = null;
  if (pkg.expiration_type !== 'none' && pkg.expiration_days) {
    const now = new Date();
    const unit = pkg.expiration_unit || 'days';
    if (unit === 'months') {
      now.setMonth(now.getMonth() + pkg.expiration_days);
    } else if (unit === 'weeks') {
      now.setDate(now.getDate() + pkg.expiration_days * 7);
    } else {
      now.setDate(now.getDate() + pkg.expiration_days);
    }
    expiresAt = now.toISOString();
  }

  const { rows } = await adminPool.query(
    `INSERT INTO pkg_purchases (package_id, business_id, customer_id, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.packageId, input.businessId, input.customerId, expiresAt],
  );
  return rows[0];
}

export async function getCustomerPurchases(customerId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT pp.*, p.name AS package_name, p.expiration_type
     FROM pkg_purchases pp
     JOIN pkg_packages p ON p.id = pp.package_id
     WHERE pp.customer_id = $1 AND pp.business_id = $2
     ORDER BY pp.purchased_at DESC`,
    [customerId, businessId],
  );
  return rows;
}

// --- Redemptions ---

interface RedeemInput {
  purchaseId: string;
  packageItemId: string;
  quantityRedeemed?: number;
  minutesRedeemed?: number;
  bookingId?: string;
  notes?: string;
}

/**
 * Redeem from a purchased package.
 * For sessions-based items: deducts from quantity count.
 * For minutes-based items: deducts from the time pool.
 */
export async function redeemPackageItem(input: RedeemInput) {
  // Verify the purchase is active and not expired
  const { rows: purchaseRows } = await adminPool.query(
    `SELECT pp.*, p.name AS package_name FROM pkg_purchases pp
     JOIN pkg_packages p ON p.id = pp.package_id
     WHERE pp.id = $1 AND pp.status = 'active'`,
    [input.purchaseId],
  );
  if (purchaseRows.length === 0) throw new Error('Purchase not found or inactive');
  const purchase = purchaseRows[0];

  if (purchase.expires_at && new Date(purchase.expires_at) < new Date()) {
    throw new Error('Package has expired');
  }

  // Get the package item to check redemption type and limits
  const { rows: itemRows } = await adminPool.query(
    'SELECT * FROM pkg_package_items WHERE id = $1 AND package_id = $2',
    [input.packageItemId, purchase.package_id],
  );
  if (itemRows.length === 0) throw new Error('Package item not found');
  const item = itemRows[0];

  // Check remaining balance
  const remaining = await getRemainingBalance(input.purchaseId, input.packageItemId);

  if (item.redemption_type === 'minutes') {
    const minutesToRedeem = input.minutesRedeemed || 0;
    if (minutesToRedeem <= 0) throw new Error('minutes_redeemed is required for time-pool items');
    if (minutesToRedeem > remaining.remaining) {
      throw new Error(`Insufficient minutes remaining. Available: ${remaining.remaining}, Requested: ${minutesToRedeem}`);
    }

    const { rows } = await adminPool.query(
      `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, minutes_redeemed, booking_id, notes)
       VALUES ($1, $2, 1, $3, $4, $5) RETURNING *`,
      [input.purchaseId, input.packageItemId, minutesToRedeem, input.bookingId || null, input.notes || null],
    );
    return rows[0];
  } else {
    // Sessions-based
    const qty = input.quantityRedeemed || 1;
    if (qty > remaining.remaining) {
      throw new Error(`Insufficient sessions remaining. Available: ${remaining.remaining}, Requested: ${qty}`);
    }

    const { rows } = await adminPool.query(
      `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, booking_id, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.purchaseId, input.packageItemId, qty, input.bookingId || null, input.notes || null],
    );
    return rows[0];
  }
}

/**
 * Get remaining balance for a specific item in a purchase.
 * Returns { total, used, remaining } in the appropriate unit (sessions or minutes).
 */
export async function getRemainingBalance(purchaseId: string, packageItemId: string) {
  const { rows: itemRows } = await adminPool.query(
    'SELECT * FROM pkg_package_items WHERE id = $1',
    [packageItemId],
  );
  if (itemRows.length === 0) throw new Error('Package item not found');
  const item = itemRows[0];

  if (item.redemption_type === 'minutes') {
    const { rows } = await adminPool.query(
      'SELECT COALESCE(SUM(minutes_redeemed), 0)::int AS used FROM pkg_redemptions WHERE purchase_id = $1 AND package_item_id = $2',
      [purchaseId, packageItemId],
    );
    const used = rows[0].used;
    return { total: item.quantity, used, remaining: item.quantity - used, unit: 'minutes' };
  } else {
    const { rows } = await adminPool.query(
      'SELECT COALESCE(SUM(quantity_redeemed), 0)::int AS used FROM pkg_redemptions WHERE purchase_id = $1 AND package_item_id = $2',
      [purchaseId, packageItemId],
    );
    const used = rows[0].used;
    return { total: item.quantity, used, remaining: item.quantity - used, unit: 'sessions' };
  }
}

/**
 * Get full redemption status for a purchase (all items with their usage).
 */
export async function getPurchaseStatus(purchaseId: string) {
  const { rows: items } = await adminPool.query(
    `SELECT pi.*, s.name AS service_name, m.name AS merchandise_name
     FROM pkg_package_items pi
     LEFT JOIN svc_services s ON s.id = pi.service_id
     LEFT JOIN prd_merchandise m ON m.id = pi.merchandise_id
     JOIN pkg_purchases pp ON pp.package_id = pi.package_id
     WHERE pp.id = $1`,
    [purchaseId],
  );

  const result = [];
  for (const item of items) {
    const balance = await getRemainingBalance(purchaseId, item.id);
    result.push({
      ...item,
      ...balance,
    });
  }
  return result;
}
