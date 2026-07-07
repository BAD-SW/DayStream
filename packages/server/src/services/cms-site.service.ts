import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get the tenant's site, auto-creating one if it doesn't exist.
 */
export async function getSite(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_sites WHERE tenant_id = $1`,
    [tenantId],
  );

  if (rows.length > 0) return rows[0];

  // Auto-create site with a slug derived from tenant id
  const slug = `site-${tenantId.slice(0, 8)}`;
  const { rows: created } = await adminPool.query(
    `INSERT INTO web_sites (tenant_id, slug)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [tenantId, slug],
  );
  return created[0];
}

/**
 * Update site settings.
 */
export async function updateSite(tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.slug !== undefined) { fields.push(`slug = $${idx++}`); values.push(updates.slug); }
  if (updates.hostingTier !== undefined) { fields.push(`hosting_tier = $${idx++}`); values.push(updates.hostingTier); }
  if (updates.templateId !== undefined) { fields.push(`template_id = $${idx++}`); values.push(updates.templateId); }
  if (updates.settings !== undefined) { fields.push(`settings = $${idx++}`); values.push(JSON.stringify(updates.settings)); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(tenantId);

  const { rows } = await adminPool.query(
    `UPDATE web_sites SET ${fields.join(', ')} WHERE tenant_id = $${idx} RETURNING *`,
    values,
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'cms.site.updated',
      resourceType: 'tenant_site',
      resourceId: rows[0].id,
      details: { fields: Object.keys(updates) },
    });
  }

  return rows[0] || null;
}

/**
 * Configure a custom domain for the tenant site.
 */
export async function configureDomain(tenantId: string, domain: string) {
  const { rows } = await adminPool.query(
    `UPDATE web_sites
     SET custom_domain = $1, domain_status = 'verifying', updated_at = NOW()
     WHERE tenant_id = $2 RETURNING *`,
    [domain, tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'cms.domain.configured',
      resourceType: 'tenant_site',
      resourceId: rows[0].id,
      details: { domain },
    });
  }

  return rows[0] || null;
}

/**
 * Check domain verification status (placeholder — returns current status).
 */
export async function checkDomainStatus(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT domain_status, custom_domain, domain_verified_at, ssl_provisioned
     FROM web_sites WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0] || null;
}

/**
 * Publish the tenant site.
 */
export async function publishSite(tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE web_sites SET is_published = true, updated_at = NOW()
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'cms.site.published',
      resourceType: 'tenant_site',
      resourceId: rows[0].id,
    });
  }

  return rows[0] || null;
}

/**
 * Public lookup: get site by slug.
 */
export async function getSiteBySlug(slug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_sites WHERE slug = $1 AND is_published = true`,
    [slug],
  );
  return rows[0] || null;
}

/**
 * Public lookup: get site by custom domain.
 */
export async function getSiteByDomain(domain: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_sites WHERE custom_domain = $1 AND domain_status = 'active' AND is_published = true`,
    [domain],
  );
  return rows[0] || null;
}
