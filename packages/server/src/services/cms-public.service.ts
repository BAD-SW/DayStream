import { adminPool } from '../db/pool';

/**
 * Resolve a public site by slug or custom domain.
 * Returns site info along with theme settings and navigation.
 */
export async function getPublicSite(identifier: string) {
  // Try slug first, then custom domain
  const { rows } = await adminPool.query(
    `SELECT * FROM tenant_sites
     WHERE is_published = true
       AND (slug = $1 OR (custom_domain = $1 AND domain_status = 'active'))`,
    [identifier],
  );

  if (rows.length === 0) return null;

  const site = rows[0];

  // Fetch navigation
  const { rows: navRows } = await adminPool.query(
    `SELECT * FROM site_navigation WHERE site_id = $1`,
    [site.id],
  );

  const navigation: { header: any | null; footer: any | null } = { header: null, footer: null };
  for (const nav of navRows) {
    if (nav.nav_type === 'header') navigation.header = nav;
    if (nav.nav_type === 'footer') navigation.footer = nav;
  }

  return {
    site,
    theme: site.settings?.theme || {},
    navigation,
  };
}

/**
 * Get a published page by slug for the public site.
 */
export async function getPublicPage(siteId: string, pageSlug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM site_pages
     WHERE site_id = $1 AND slug = $2 AND is_enabled = true AND status = 'published'`,
    [siteId, pageSlug],
  );
  return rows[0] || null;
}

/**
 * Get published blog posts for the public listing.
 */
export async function getPublicBlogListing(siteId: string, page?: number, limit?: number) {
  const p = page || 1;
  const l = Math.min(limit || 10, 50);
  const offset = (p - 1) * l;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT id, title, slug, excerpt, featured_image_path, author_name, tags, category, published_at
       FROM blog_posts
       WHERE site_id = $1 AND status = 'published'
       ORDER BY published_at DESC
       LIMIT $2 OFFSET $3`,
      [siteId, l, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM blog_posts WHERE site_id = $1 AND status = 'published'`,
      [siteId],
    ),
  ]);

  return {
    posts: dataResult.rows,
    total: countResult.rows[0].total,
    page: p,
    limit: l,
  };
}

/**
 * Get a single published blog post by slug.
 */
export async function getPublicBlogPost(siteId: string, slug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM blog_posts WHERE site_id = $1 AND slug = $2 AND status = 'published'`,
    [siteId, slug],
  );
  return rows[0] || null;
}

/**
 * Generate a sitemap XML string for all published pages and blog posts.
 */
export async function generateSitemap(siteId: string): Promise<string> {
  // Get site info for base URL
  const { rows: siteRows } = await adminPool.query(
    `SELECT slug, custom_domain, domain_status FROM tenant_sites WHERE id = $1`,
    [siteId],
  );
  if (siteRows.length === 0) return '';

  const site = siteRows[0];
  const baseUrl = site.domain_status === 'active' && site.custom_domain
    ? `https://${site.custom_domain}`
    : `https://${site.slug}.daystream.app`;

  // Fetch published pages
  const { rows: pages } = await adminPool.query(
    `SELECT slug, updated_at FROM site_pages
     WHERE site_id = $1 AND is_enabled = true AND status = 'published'
     ORDER BY display_order`,
    [siteId],
  );

  // Fetch published blog posts
  const { rows: posts } = await adminPool.query(
    `SELECT slug, updated_at FROM blog_posts
     WHERE site_id = $1 AND status = 'published'
     ORDER BY published_at DESC`,
    [siteId],
  );

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  // Homepage
  xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

  // Pages
  for (const page of pages) {
    if (page.slug === 'home') continue; // already added as root
    const lastmod = page.updated_at ? new Date(page.updated_at).toISOString().split('T')[0] : '';
    xml += `  <url>\n    <loc>${baseUrl}/${page.slug}</loc>\n`;
    if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += `    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  // Blog posts
  for (const post of posts) {
    const lastmod = post.updated_at ? new Date(post.updated_at).toISOString().split('T')[0] : '';
    xml += `  <url>\n    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
    if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += `    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
  }

  xml += `</urlset>`;
  return xml;
}
