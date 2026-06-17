-- Phase 18: Website & CMS tables

-- ============================================================
-- 1. Tenant Sites
-- ============================================================

CREATE TABLE tenant_sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    custom_domain VARCHAR(255),
    domain_status VARCHAR(20) DEFAULT 'pending'
        CHECK (domain_status IN ('pending', 'verifying', 'active', 'failed')),
    domain_verified_at TIMESTAMPTZ,
    ssl_provisioned BOOLEAN NOT NULL DEFAULT false,
    hosting_tier VARCHAR(20) NOT NULL DEFAULT 'subdomain'
        CHECK (hosting_tier IN ('custom_domain', 'subdomain', 'embedded')),
    template_id UUID,
    is_published BOOLEAN NOT NULL DEFAULT false,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id)
);

CREATE INDEX idx_tenant_sites_domain ON tenant_sites(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_tenant_sites_slug ON tenant_sites(slug);

-- ============================================================
-- 2. Page Templates
-- ============================================================

CREATE TABLE page_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    business_type VARCHAR(50) NOT NULL,
    description TEXT,
    pages JSONB NOT NULL DEFAULT '[]',
    preview_image_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. Site Pages
-- ============================================================

CREATE TABLE site_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES tenant_sites(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    page_type VARCHAR(30) NOT NULL
        CHECK (page_type IN ('homepage', 'services', 'pricing', 'team', 'about', 'faq', 'contact', 'blog', 'gallery', 'custom')),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    content_blocks JSONB NOT NULL DEFAULT '[]',
    seo_config JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, slug)
);

CREATE INDEX idx_site_pages_site ON site_pages(site_id);

-- ============================================================
-- 4. Blog Posts
-- ============================================================

CREATE TABLE blog_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES tenant_sites(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    slug VARCHAR(300) NOT NULL,
    content TEXT,
    excerpt TEXT,
    featured_image_path TEXT,
    author_name VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    category VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ,
    seo_config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, slug)
);

CREATE INDEX idx_blog_posts_site ON blog_posts(site_id);
CREATE INDEX idx_blog_posts_status ON blog_posts(site_id, status);

-- ============================================================
-- 5. Media Files
-- ============================================================

CREATE TABLE media_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    medium_path TEXT,
    large_path TEXT,
    alt_text VARCHAR(500),
    folder VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_files_tenant ON media_files(tenant_id);
CREATE INDEX idx_media_files_folder ON media_files(tenant_id, folder);

-- ============================================================
-- 6. Form Submissions
-- ============================================================

CREATE TABLE form_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    form_name VARCHAR(100) NOT NULL,
    data JSONB NOT NULL,
    customer_id UUID REFERENCES customers(id),
    ip_address VARCHAR(50),
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_form_submissions_tenant ON form_submissions(tenant_id);

-- ============================================================
-- 7. Site Navigation
-- ============================================================

CREATE TABLE site_navigation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES tenant_sites(id) ON DELETE CASCADE,
    nav_type VARCHAR(20) NOT NULL CHECK (nav_type IN ('header', 'footer')),
    items JSONB NOT NULL DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    UNIQUE(site_id, nav_type)
);

-- ============================================================
-- 8. RLS Policies
-- ============================================================

ALTER TABLE tenant_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_sites ON tenant_sites FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_tenant_sites ON tenant_sites FOR ALL TO postgres USING (true);

ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_pages ON site_pages FOR ALL TO daystream_app
    USING (site_id IN (SELECT id FROM tenant_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_site_pages ON site_pages FOR ALL TO postgres USING (true);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_blog_posts ON blog_posts FOR ALL TO daystream_app
    USING (site_id IN (SELECT id FROM tenant_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_blog_posts ON blog_posts FOR ALL TO postgres USING (true);

ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_media_files ON media_files FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_media_files ON media_files FOR ALL TO postgres USING (true);

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_submissions ON form_submissions FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_form_submissions ON form_submissions FOR ALL TO postgres USING (true);

ALTER TABLE site_navigation ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_navigation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_navigation ON site_navigation FOR ALL TO daystream_app
    USING (site_id IN (SELECT id FROM tenant_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_site_navigation ON site_navigation FOR ALL TO postgres USING (true);

-- ============================================================
-- 9. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_sites TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON page_templates TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_pages TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON blog_posts TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_files TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_submissions TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_navigation TO daystream_app;
