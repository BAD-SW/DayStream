import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get available templates, optionally filtered by business type.
 */
export async function getTemplates(businessType?: string) {
  if (businessType) {
    const { rows } = await adminPool.query(
      `SELECT * FROM page_templates WHERE is_active = true AND business_type = $1 ORDER BY name`,
      [businessType],
    );
    return rows;
  }

  const { rows } = await adminPool.query(
    `SELECT * FROM page_templates WHERE is_active = true ORDER BY business_type, name`,
  );
  return rows;
}

/**
 * Get a template by ID.
 */
export async function getTemplateById(id: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM page_templates WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Apply a template to a tenant's site — creates pages from the template's pages JSONB config.
 */
export async function applyTemplate(tenantId: string, templateId: string) {
  const template = await getTemplateById(templateId);
  if (!template) throw new Error('Template not found');

  // Get the tenant's site
  const { rows: siteRows } = await adminPool.query(
    `SELECT id FROM tenant_sites WHERE tenant_id = $1`,
    [tenantId],
  );
  if (siteRows.length === 0) throw new Error('Site not found for tenant');

  const siteId = siteRows[0].id;
  const pages: any[] = template.pages || [];
  const createdPages: any[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { rows } = await adminPool.query(
      `INSERT INTO site_pages (site_id, slug, title, page_type, content_blocks, seo_config, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (site_id, slug) DO UPDATE SET
         content_blocks = EXCLUDED.content_blocks,
         title = EXCLUDED.title,
         updated_at = NOW()
       RETURNING *`,
      [
        siteId,
        page.slug,
        page.title,
        page.pageType || 'custom',
        JSON.stringify(page.contentBlocks || []),
        JSON.stringify(page.seoConfig || {}),
        page.displayOrder ?? i,
      ],
    );
    createdPages.push(rows[0]);
  }

  // Update the site's template reference
  await adminPool.query(
    `UPDATE tenant_sites SET template_id = $1, updated_at = NOW() WHERE tenant_id = $2`,
    [templateId, tenantId],
  );

  await logAudit({
    tenantId,
    action: 'cms.template.applied',
    resourceType: 'page_template',
    resourceId: templateId,
    details: { pagesCreated: createdPages.length },
  });

  return createdPages;
}

/**
 * Seed default templates into the database.
 */
export async function seedDefaultTemplates() {
  const defaults = [
    {
      name: 'Wellness Studio',
      businessType: 'wellness',
      description: 'A clean, calming template for wellness and spa businesses.',
      pages: [
        { slug: 'home', title: 'Home', pageType: 'homepage', displayOrder: 0, contentBlocks: [{ type: 'hero', heading: 'Welcome', subheading: 'Your wellness journey starts here' }, { type: 'services-grid' }] },
        { slug: 'services', title: 'Services', pageType: 'services', displayOrder: 1, contentBlocks: [{ type: 'page-header', heading: 'Our Services' }, { type: 'services-list' }] },
        { slug: 'pricing', title: 'Pricing', pageType: 'pricing', displayOrder: 2, contentBlocks: [{ type: 'page-header', heading: 'Pricing' }, { type: 'pricing-table' }] },
        { slug: 'about', title: 'About Us', pageType: 'about', displayOrder: 3, contentBlocks: [{ type: 'page-header', heading: 'About Us' }, { type: 'text-block' }] },
        { slug: 'contact', title: 'Contact', pageType: 'contact', displayOrder: 4, contentBlocks: [{ type: 'page-header', heading: 'Get in Touch' }, { type: 'contact-form' }] },
      ],
    },
    {
      name: 'Fitness Center',
      businessType: 'fitness',
      description: 'An energetic template for gyms and fitness studios.',
      pages: [
        { slug: 'home', title: 'Home', pageType: 'homepage', displayOrder: 0, contentBlocks: [{ type: 'hero', heading: 'Train Hard', subheading: 'Achieve your fitness goals' }, { type: 'services-grid' }] },
        { slug: 'classes', title: 'Classes', pageType: 'services', displayOrder: 1, contentBlocks: [{ type: 'page-header', heading: 'Our Classes' }, { type: 'services-list' }] },
        { slug: 'pricing', title: 'Membership', pageType: 'pricing', displayOrder: 2, contentBlocks: [{ type: 'page-header', heading: 'Membership Plans' }, { type: 'pricing-table' }] },
        { slug: 'team', title: 'Trainers', pageType: 'team', displayOrder: 3, contentBlocks: [{ type: 'page-header', heading: 'Our Trainers' }, { type: 'team-grid' }] },
        { slug: 'contact', title: 'Contact', pageType: 'contact', displayOrder: 4, contentBlocks: [{ type: 'page-header', heading: 'Contact Us' }, { type: 'contact-form' }] },
      ],
    },
    {
      name: 'Recovery Clinic',
      businessType: 'recovery',
      description: 'A professional template for recovery and therapy clinics.',
      pages: [
        { slug: 'home', title: 'Home', pageType: 'homepage', displayOrder: 0, contentBlocks: [{ type: 'hero', heading: 'Recovery & Healing', subheading: 'Science-backed recovery solutions' }, { type: 'services-grid' }] },
        { slug: 'services', title: 'Treatments', pageType: 'services', displayOrder: 1, contentBlocks: [{ type: 'page-header', heading: 'Our Treatments' }, { type: 'services-list' }] },
        { slug: 'pricing', title: 'Pricing', pageType: 'pricing', displayOrder: 2, contentBlocks: [{ type: 'page-header', heading: 'Pricing' }, { type: 'pricing-table' }] },
        { slug: 'faq', title: 'FAQ', pageType: 'faq', displayOrder: 3, contentBlocks: [{ type: 'page-header', heading: 'Frequently Asked Questions' }, { type: 'faq-accordion' }] },
        { slug: 'contact', title: 'Contact', pageType: 'contact', displayOrder: 4, contentBlocks: [{ type: 'page-header', heading: 'Book a Session' }, { type: 'contact-form' }] },
      ],
    },
  ];

  for (const tmpl of defaults) {
    await adminPool.query(
      `INSERT INTO page_templates (name, business_type, description, pages)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tmpl.name, tmpl.businessType, tmpl.description, JSON.stringify(tmpl.pages)],
    );
  }
}
