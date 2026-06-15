import { adminPool } from '../db/pool';
import { storage } from './storage.service';

interface CatalogFilters {
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDuration?: number;
  maxDuration?: number;
  search?: string;
}

/**
 * Get the public service catalog for a business (no auth required).
 * Returns categories with nested active services that have online booking enabled.
 */
export async function getCatalog(businessSlug: string, filters?: CatalogFilters) {
  // Resolve business by slug
  const { rows: bizRows } = await adminPool.query(
    "SELECT id, name, slug FROM businesses WHERE slug = $1 AND status = 'active'",
    [businessSlug],
  );

  if (bizRows.length === 0) return null;

  const business = bizRows[0];
  const businessId = business.id;

  // Build service query with filters
  const conditions = [
    's.business_id = $1',
    "s.status = 'active'",
    's.online_booking_enabled = true',
  ];
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (filters?.categoryId) {
    conditions.push(`s.category_id = $${paramIndex++}`);
    params.push(filters.categoryId);
  }

  if (filters?.search) {
    conditions.push(`to_tsvector('english', s.name || ' ' || COALESCE(s.description, '') || ' ' || COALESCE(s.short_description, '')) @@ plainto_tsquery('english', $${paramIndex++})`);
    params.push(filters.search);
  }

  const where = conditions.join(' AND ');

  // Get services with their starting price and duration range from variants
  const { rows: services } = await adminPool.query(
    `SELECT s.id, s.name, s.slug, s.short_description, s.booking_type, s.category_id,
       (SELECT MIN(sv.price) FROM service_variants sv WHERE sv.service_id = s.id AND sv.status = 'active') AS starting_price,
       (SELECT MIN(sv.duration) FROM service_variants sv WHERE sv.service_id = s.id AND sv.status = 'active') AS min_duration,
       (SELECT MAX(sv.duration) FROM service_variants sv WHERE sv.service_id = s.id AND sv.status = 'active') AS max_duration,
       (SELECT si.file_path FROM service_images si WHERE si.service_id = s.id AND si.is_primary = true LIMIT 1) AS primary_image_path
     FROM services s
     WHERE ${where}
     ORDER BY s.display_order, s.name`,
    params,
  );

  // Apply price/duration filters (post-query since they're aggregated from variants)
  let filtered = services;
  if (filters?.minPrice !== undefined) {
    filtered = filtered.filter((s: any) => s.starting_price >= filters.minPrice!);
  }
  if (filters?.maxPrice !== undefined) {
    filtered = filtered.filter((s: any) => s.starting_price <= filters.maxPrice!);
  }
  if (filters?.minDuration !== undefined) {
    filtered = filtered.filter((s: any) => s.max_duration >= filters.minDuration!);
  }
  if (filters?.maxDuration !== undefined) {
    filtered = filtered.filter((s: any) => s.min_duration <= filters.maxDuration!);
  }

  // Get categories for this business
  const { rows: categories } = await adminPool.query(
    "SELECT id, name, icon, parent_id, display_order FROM service_categories WHERE business_id = $1 AND status = 'active' ORDER BY display_order, name",
    [businessId],
  );

  // Build category → services map
  const categoryMap = new Map<string, any>();
  for (const cat of categories) {
    categoryMap.set(cat.id, { ...cat, services: [] });
  }

  for (const svc of filtered) {
    const cat = categoryMap.get(svc.category_id);
    if (cat) {
      cat.services.push({
        id: svc.id,
        name: svc.name,
        slug: svc.slug,
        short_description: svc.short_description,
        booking_type: svc.booking_type,
        starting_price: svc.starting_price,
        duration_range: svc.min_duration === svc.max_duration
          ? `${svc.min_duration} min`
          : `${svc.min_duration}-${svc.max_duration} min`,
        primary_image_url: svc.primary_image_path
          ? storage.getUrl(svc.primary_image_path.replace('/original/', '/medium/').replace(/\.[^.]+$/, '.webp'))
          : null,
      });
    }
  }

  // Return only categories that have services
  const result = Array.from(categoryMap.values()).filter((c) => c.services.length > 0);

  return {
    business: { name: business.name, slug: business.slug },
    categories: result,
  };
}

/**
 * Get a single service detail for the public catalog.
 */
export async function getCatalogServiceDetail(businessSlug: string, serviceSlug: string) {
  const { rows: bizRows } = await adminPool.query(
    "SELECT id FROM businesses WHERE slug = $1 AND status = 'active'",
    [businessSlug],
  );
  if (bizRows.length === 0) return null;

  const businessId = bizRows[0].id;

  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sc.name AS category_name
     FROM services s
     JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.business_id = $1 AND s.slug = $2 AND s.status = 'active' AND s.online_booking_enabled = true`,
    [businessId, serviceSlug],
  );

  if (svcRows.length === 0) return null;

  const service = svcRows[0];

  // Variants
  const { rows: variants } = await adminPool.query(
    "SELECT id, name, duration, price, pricing_model, billing_interval, included_sessions, sessions_rollover FROM service_variants WHERE service_id = $1 AND status = 'active' ORDER BY display_order",
    [service.id],
  );

  // Images
  const { rows: images } = await adminPool.query(
    'SELECT id, file_path, alt_text, is_primary, display_order FROM service_images WHERE service_id = $1 ORDER BY display_order',
    [service.id],
  );

  const imageUrls = images.map((img: any) => ({
    id: img.id,
    alt_text: img.alt_text,
    is_primary: img.is_primary,
    urls: {
      large: storage.getUrl(img.file_path.replace('/original/', '/large/').replace(/\.[^.]+$/, '.webp')),
      medium: storage.getUrl(img.file_path.replace('/original/', '/medium/').replace(/\.[^.]+$/, '.webp')),
      thumbnail: storage.getUrl(img.file_path.replace('/original/', '/thumbnail/').replace(/\.[^.]+$/, '.webp')),
    },
  }));

  // Staff (if configured to show)
  const { rows: staff } = await adminPool.query(
    `SELECT u.first_name, u.last_name, ss.is_primary
     FROM service_staff ss JOIN users u ON u.id = ss.user_id
     WHERE ss.service_id = $1 ORDER BY ss.is_primary DESC, u.last_name`,
    [service.id],
  );

  // Cancellation policy
  let cancellationPolicy = null;
  if (service.cancellation_policy_id) {
    const { rows: polRows } = await adminPool.query(
      'SELECT name, free_cancellation_hours, late_cancel_fee_type, late_cancel_fee_value, noshow_fee_type, noshow_fee_value FROM cancellation_policies WHERE id = $1',
      [service.cancellation_policy_id],
    );
    if (polRows.length > 0) cancellationPolicy = polRows[0];
  } else {
    // Fall back to business default
    const { rows: defRows } = await adminPool.query(
      'SELECT name, free_cancellation_hours, late_cancel_fee_type, late_cancel_fee_value, noshow_fee_type, noshow_fee_value FROM cancellation_policies WHERE business_id = $1 AND is_default = true',
      [businessId],
    );
    if (defRows.length > 0) cancellationPolicy = defRows[0];
  }

  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    short_description: service.short_description,
    category_name: service.category_name,
    booking_type: service.booking_type,
    default_duration: service.default_duration,
    max_capacity: service.max_capacity,
    variants,
    images: imageUrls,
    staff,
    cancellation_policy: cancellationPolicy,
  };
}
