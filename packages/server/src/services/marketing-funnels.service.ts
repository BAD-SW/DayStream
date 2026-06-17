import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List all lead funnels for a tenant.
 */
export async function getFunnels(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM lead_funnels WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a new lead funnel.
 */
export async function createFunnel(
  tenantId: string,
  input: {
    name: string;
    slug: string;
    headline?: string;
    description?: string;
    imagePath?: string;
    formFields?: any[];
    ctaText?: string;
    discountCode?: string;
    sequenceId?: string;
  },
) {
  const { rows } = await adminPool.query(
    `INSERT INTO lead_funnels (tenant_id, name, slug, headline, description, image_path, form_fields, cta_text, discount_code, sequence_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      tenantId,
      input.name,
      input.slug,
      input.headline || null,
      input.description || null,
      input.imagePath || null,
      JSON.stringify(input.formFields || []),
      input.ctaText || 'Sign Up',
      input.discountCode || null,
      input.sequenceId || null,
    ],
  );

  await logAudit({
    tenantId,
    action: 'funnel.created',
    resourceType: 'lead_funnel',
    resourceId: rows[0].id,
    details: { name: input.name, slug: input.slug },
  });

  return rows[0];
}

/**
 * Get a funnel by its slug (public-facing lookup).
 */
export async function getFunnelBySlug(tenantId: string, slug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM lead_funnels WHERE tenant_id = $1 AND slug = $2 AND status = 'active'`,
    [tenantId, slug],
  );
  return rows[0] || null;
}

/**
 * Increment page views for a funnel.
 */
export async function incrementPageViews(funnelId: string) {
  await adminPool.query(
    `UPDATE lead_funnels SET page_views = page_views + 1 WHERE id = $1`,
    [funnelId],
  );
}

/**
 * Submit a form on a funnel: create customer record, tag as lead, increment submissions,
 * and optionally enroll in the configured sequence.
 */
export async function submitForm(funnelId: string, formData: Record<string, any>) {
  // Get the funnel
  const { rows: funnels } = await adminPool.query(
    `SELECT * FROM lead_funnels WHERE id = $1`,
    [funnelId],
  );
  const funnel = funnels[0];
  if (!funnel) throw new Error('Funnel not found');

  const tenantId = funnel.tenant_id;

  // Create or find the customer
  const email = formData.email;
  const firstName = formData.firstName || formData.first_name || null;
  const lastName = formData.lastName || formData.last_name || null;
  const phone = formData.phone || null;

  let customerId: string;

  if (email) {
    // Try to find existing customer by email
    const { rows: existing } = await adminPool.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
      [tenantId, email],
    );

    if (existing.length > 0) {
      customerId = existing[0].id;
    } else {
      // Create new customer
      const { rows: newCustomer } = await adminPool.query(
        `INSERT INTO customers (tenant_id, email, first_name, last_name, phone, source, status)
         VALUES ($1, $2, $3, $4, $5, 'funnel', 'active') RETURNING id`,
        [tenantId, email, firstName, lastName, phone],
      );
      customerId = newCustomer[0].id;
    }
  } else {
    // Create anonymous lead
    const { rows: newCustomer } = await adminPool.query(
      `INSERT INTO customers (tenant_id, first_name, last_name, phone, source, status)
       VALUES ($1, $2, $3, $4, 'funnel', 'active') RETURNING id`,
      [tenantId, firstName, lastName, phone],
    );
    customerId = newCustomer[0].id;
  }

  // Increment submissions
  await adminPool.query(
    `UPDATE lead_funnels SET submissions = submissions + 1 WHERE id = $1`,
    [funnelId],
  );

  // Enroll in sequence if configured
  let enrollmentId: string | null = null;
  if (funnel.sequence_id) {
    const { rows: enrollmentRows } = await adminPool.query(
      `INSERT INTO sequence_enrollments (sequence_id, customer_id, context)
       VALUES ($1, $2, $3)
       ON CONFLICT (sequence_id, customer_id) DO NOTHING
       RETURNING id`,
      [funnel.sequence_id, customerId, JSON.stringify({ source: 'funnel', funnelId, formData })],
    );
    enrollmentId = enrollmentRows[0]?.id || null;
  }

  await logAudit({
    tenantId,
    action: 'funnel.submission',
    resourceType: 'lead_funnel',
    resourceId: funnelId,
    details: { customerId, hasSequence: !!funnel.sequence_id },
  });

  return { customerId, funnelId, enrollmentId };
}

/**
 * Get analytics for a funnel.
 */
export async function getFunnelAnalytics(funnelId: string) {
  const { rows } = await adminPool.query(
    `SELECT page_views, submissions FROM lead_funnels WHERE id = $1`,
    [funnelId],
  );

  if (!rows[0]) return null;

  const { page_views, submissions } = rows[0];
  const conversionRate = page_views > 0
    ? Math.round((submissions / page_views) * 10000) / 100
    : 0;

  return {
    pageViews: page_views,
    submissions,
    conversionRate,
  };
}
