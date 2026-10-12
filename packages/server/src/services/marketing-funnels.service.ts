import { adminPool } from '../db/pool';
import { findOrCreatePerson } from './person-identity.service';
import { logAudit } from './audit.service';

/**
 * List all lead funnels for a tenant.
 */
export async function getFunnels(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_lead_funnels WHERE tenant_id = $1 ORDER BY created_at DESC`,
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
    `INSERT INTO mkt_lead_funnels (tenant_id, name, slug, headline, description, image_path, form_fields, cta_text, discount_code, sequence_id)
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
    `SELECT * FROM mkt_lead_funnels WHERE tenant_id = $1 AND slug = $2 AND status = 'active'`,
    [tenantId, slug],
  );
  return rows[0] || null;
}

/**
 * Increment page views for a funnel.
 */
export async function incrementPageViews(funnelId: string) {
  await adminPool.query(
    `UPDATE mkt_lead_funnels SET page_views = page_views + 1 WHERE id = $1`,
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
    `SELECT * FROM mkt_lead_funnels WHERE id = $1`,
    [funnelId],
  );
  const funnel = funnels[0];
  if (!funnel) throw new Error('Funnel not found');

  const tenantId = funnel.tenant_id;

  // Find or create the person (Phase 46). Funnels still belong to a tenant, not a business
  // (the Marketing module rework moves them), so the lead goes to the funnel's own business when
  // it has one, otherwise to the tenant's first business.
  const email = formData.email;
  const firstName = formData.firstName || formData.first_name || null;
  const lastName = formData.lastName || formData.last_name || null;
  const phone = formData.phone || null;

  let businessId: string | null = funnel.business_id || null;
  if (!businessId) {
    const { rows: biz } = await adminPool.query(
      `SELECT id FROM sys_businesses WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    businessId = biz[0]?.id || null;
  }
  if (!businessId) throw new Error('This form is not attached to a business');

  const { person } = await findOrCreatePerson({
    businessId,
    tenantId,
    email,
    phone,
    firstName,
    lastName,
    source: 'lead_form',
    sourceDetail: funnel.name,
  });
  const customerId: string = person.id;

  // Increment submissions
  await adminPool.query(
    `UPDATE mkt_lead_funnels SET submissions = submissions + 1 WHERE id = $1`,
    [funnelId],
  );

  // Enroll in sequence if configured
  let enrollmentId: string | null = null;
  if (funnel.sequence_id) {
    const { rows: enrollmentRows } = await adminPool.query(
      `INSERT INTO mkt_sequence_enrollments (sequence_id, customer_id, context)
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
    `SELECT page_views, submissions FROM mkt_lead_funnels WHERE id = $1`,
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
