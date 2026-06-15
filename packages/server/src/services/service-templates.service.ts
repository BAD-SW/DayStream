import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * List available templates by business type.
 */
export async function getTemplates(businessType?: string) {
  if (businessType) {
    const { rows } = await adminPool.query(
      'SELECT * FROM service_templates WHERE business_type = $1 ORDER BY category_name, display_order',
      [businessType],
    );
    return rows;
  }

  // Return grouped by business type
  const { rows } = await adminPool.query(
    'SELECT * FROM service_templates ORDER BY business_type, category_name, display_order',
  );
  return rows;
}

/**
 * Get list of available business types.
 */
export async function getBusinessTypes(): Promise<string[]> {
  const { rows } = await adminPool.query(
    'SELECT DISTINCT business_type FROM service_templates ORDER BY business_type',
  );
  return rows.map((r) => r.business_type);
}

/**
 * Apply a template to a business.
 * Creates categories (skip existing) and services in draft status.
 * Additive only — never overwrites existing data.
 */
export async function applyTemplate(businessId: string, businessType: string, userId: string) {
  const templates = await getTemplates(businessType);

  if (templates.length === 0) {
    throw new Error(`No templates found for business type: ${businessType}`);
  }

  const categoriesCreated: string[] = [];
  const servicesCreated: string[] = [];
  const categoryIdMap = new Map<string, string>();

  // Create categories (skip existing)
  const uniqueCategories = [...new Set(templates.map((t: any) => t.category_name))];

  for (const catName of uniqueCategories) {
    // Check if category already exists
    const { rows: existing } = await adminPool.query(
      "SELECT id FROM service_categories WHERE business_id = $1 AND name = $2 AND parent_id IS NULL AND status = 'active'",
      [businessId, catName],
    );

    if (existing.length > 0) {
      categoryIdMap.set(catName, existing[0].id);
    } else {
      const { rows } = await adminPool.query(
        'INSERT INTO service_categories (business_id, name) VALUES ($1, $2) RETURNING id',
        [businessId, catName],
      );
      categoryIdMap.set(catName, rows[0].id);
      categoriesCreated.push(catName);
    }
  }

  // Create services in draft status
  for (const template of templates) {
    const categoryId = categoryIdMap.get(template.category_name);
    if (!categoryId) continue;

    // Generate slug
    let slug = template.name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    let candidate = slug;
    let counter = 1;
    while (true) {
      const { rows: slugCheck } = await adminPool.query(
        'SELECT id FROM services WHERE business_id = $1 AND slug = $2',
        [businessId, candidate],
      );
      if (slugCheck.length === 0) break;
      candidate = `${slug}-${counter++}`;
    }

    // Check if service with same name already exists in this category
    const { rows: nameCheck } = await adminPool.query(
      "SELECT id FROM services WHERE business_id = $1 AND category_id = $2 AND name = $3 AND status != 'archived'",
      [businessId, categoryId, template.name],
    );
    if (nameCheck.length > 0) continue; // Skip existing

    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO services (business_id, category_id, name, slug, description, short_description, booking_type, default_duration, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9)
       RETURNING id`,
      [businessId, categoryId, template.name, candidate, template.description, template.short_description, template.booking_type, template.default_duration, userId],
    );

    const serviceId = svcRows[0].id;
    servicesCreated.push(template.name);

    // Create default variant with suggested price
    if (template.suggested_price) {
      await adminPool.query(
        `INSERT INTO service_variants (service_id, name, duration, price)
         VALUES ($1, $2, $3, $4)`,
        [serviceId, `${template.default_duration} min`, template.default_duration, template.suggested_price],
      );
    }
  }

  // Create default cancellation policy if none exists
  const { rows: policyCheck } = await adminPool.query(
    'SELECT id FROM cancellation_policies WHERE business_id = $1',
    [businessId],
  );

  let policyCreated = false;
  if (policyCheck.length === 0) {
    const hours = templates[0]?.cancellation_hours || 24;
    await adminPool.query(
      `INSERT INTO cancellation_policies (business_id, name, is_default, free_cancellation_hours)
       VALUES ($1, 'Standard Policy', true, $2)`,
      [businessId, hours],
    );
    policyCreated = true;
  }

  logger.info('Template applied', { businessId, businessType, categoriesCreated: categoriesCreated.length, servicesCreated: servicesCreated.length });

  return {
    business_type: businessType,
    categories_created: categoriesCreated.length,
    services_created: servicesCreated.length,
    policy_created: policyCreated,
    details: { categories: categoriesCreated, services: servicesCreated },
  };
}
