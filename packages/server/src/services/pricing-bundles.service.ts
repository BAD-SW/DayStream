import { adminPool } from '../db/pool';

interface CreateBundleInput {
  businessId: string;
  name: string;
  description?: string;
  bundleType: string;
  bundlePrice?: number;
  discountPercentage?: number;
  expirationDays?: number;
  items: Array<{ variant_id: string; quantity?: number }>;
}

/**
 * Create a pricing bundle.
 */
export async function createBundle(input: CreateBundleInput) {
  if (input.bundleType === 'fixed_price' && !input.bundlePrice) {
    throw new Error('Fixed price bundles require a bundle_price');
  }
  if (input.bundleType === 'percentage_off' && !input.discountPercentage) {
    throw new Error('Percentage off bundles require a discount_percentage');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO pri_bundles (business_id, name, description, bundle_type, bundle_price, discount_percentage, expiration_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.businessId, input.name, input.description || null, input.bundleType, input.bundlePrice ?? null, input.discountPercentage ?? null, input.expirationDays ?? null],
  );

  const bundle = rows[0];

  // Insert items
  for (const item of input.items) {
    await adminPool.query(
      'INSERT INTO pri_bundle_items (bundle_id, variant_id, quantity) VALUES ($1, $2, $3)',
      [bundle.id, item.variant_id, item.quantity || 1],
    );
  }

  return { ...bundle, items: input.items };
}

/**
 * List bundles for a business.
 */
export async function getBundles(businessId: string) {
  const { rows: bundles } = await adminPool.query(
    "SELECT * FROM pri_bundles WHERE business_id = $1 AND status = 'active' ORDER BY name",
    [businessId],
  );

  // Load items for each bundle
  for (const bundle of bundles) {
    const { rows: items } = await adminPool.query(
      `SELECT bi.variant_id, bi.quantity, sv.name AS variant_name, sv.price, sv.duration
       FROM pri_bundle_items bi
       JOIN svc_variants sv ON sv.id = bi.variant_id
       WHERE bi.bundle_id = $1`,
      [bundle.id],
    );
    bundle.items = items;
  }

  return bundles;
}

/**
 * Get a single bundle with calculated savings.
 */
export async function getBundleById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM pri_bundles WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (rows.length === 0) return null;

  const bundle = rows[0];

  const { rows: items } = await adminPool.query(
    `SELECT bi.variant_id, bi.quantity, sv.name AS variant_name, sv.price, sv.duration
     FROM pri_bundle_items bi
     JOIN svc_variants sv ON sv.id = bi.variant_id
     WHERE bi.bundle_id = $1`,
    [id],
  );
  bundle.items = items;

  // Calculate savings
  const individualTotal = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
  if (bundle.bundle_type === 'fixed_price') {
    bundle.individual_total = individualTotal;
    bundle.savings = individualTotal - bundle.bundle_price;
  } else {
    bundle.individual_total = individualTotal;
    bundle.bundle_price = Math.round(individualTotal * (100 - bundle.discount_percentage) / 100);
    bundle.savings = individualTotal - bundle.bundle_price;
  }

  return bundle;
}

/**
 * Calculate bundle price for given items.
 */
export function calculateBundlePrice(bundle: any): { bundle_price: number; individual_total: number; savings: number } {
  const individualTotal = (bundle.items || []).reduce((sum: number, item: any) => sum + (item.price * (item.quantity || 1)), 0);

  let bundlePrice: number;
  if (bundle.bundle_type === 'fixed_price') {
    bundlePrice = bundle.bundle_price;
  } else {
    bundlePrice = Math.round(individualTotal * (100 - bundle.discount_percentage) / 100);
  }

  return {
    bundle_price: bundlePrice,
    individual_total: individualTotal,
    savings: individualTotal - bundlePrice,
  };
}

/**
 * Update a bundle.
 */
export async function updateBundle(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM pri_bundles WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowed: Record<string, string> = { name: 'name', description: 'description', bundle_price: 'bundle_price', discount_percentage: 'discount_percentage', expiration_days: 'expiration_days', status: 'status' };
  for (const [key, value] of Object.entries(updates)) {
    if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(value); }
  }

  if (fields.length === 0) return existing[0];
  fields.push('updated_at = NOW()');
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE pri_bundles SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`, values,
  );
  return rows[0];
}

/**
 * Archive a bundle.
 */
export async function archiveBundle(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE pri_bundles SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
