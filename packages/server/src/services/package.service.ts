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
  displayOrder?: number;
  isTaxable?: boolean;
  taxCategoryId?: string;
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
}

// --- Package CRUD ---

export async function createPackage(input: CreatePackageInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pkg_packages (business_id, name, description, short_description, price, expiration_type, expiration_days, display_order, is_taxable, tax_category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null, input.shortDescription || null,
      input.price, input.expirationType || 'none', input.expirationDays || null,
      input.displayOrder ?? 0, input.isTaxable ?? false, input.taxCategoryId || null,
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
  const allowedFields = ['name', 'description', 'short_description', 'price', 'status', 'expiration_type', 'expiration_days', 'display_order', 'is_taxable', 'tax_category_id'];
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
    `INSERT INTO pkg_package_items (package_id, item_type, service_id, merchandise_id, variant_id, quantity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.packageId, input.itemType, input.serviceId || null, input.merchandiseId || null, input.variantId || null, input.quantity],
  );
  return rows[0];
}

export async function updatePackageItem(itemId: string, updates: { quantity?: number; variantId?: string | null }) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(updates.quantity); }
  if (updates.variantId !== undefined) { fields.push(`variant_id = $${idx++}`); values.push(updates.variantId || null); }

  if (fields.length === 0) return null;
  values.push(itemId);
  const { rows } = await adminPool.query(`UPDATE pkg_package_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
  return rows[0] || null;
}

export async function removePackageItem(itemId: string) {
  const { rowCount } = await adminPool.query('DELETE FROM pkg_package_items WHERE id = $1', [itemId]);
  return (rowCount ?? 0) > 0;
}
