# Phase 18: Website & CMS - Design Document

**Date**: June 17, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06, Phase 07, Phase 08, Phase 12

---

## Overview

This document describes the technical design for the DayStream Website & CMS module — tenant-branded public sites, structured page templates, content block system, media library, blog publishing, SEO tooling, three-tier custom domain hosting, embeddable booking widgets, contact forms, and navigation management. The content model is i18n-ready for future multi-language support.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Site Rendering Architecture](#2-site-rendering-architecture)
3. [Content Block System](#3-content-block-system)
4. [Custom Domain Resolution](#4-custom-domain-resolution)
5. [Embeddable Widget](#5-embeddable-widget)
6. [SEO Engine](#6-seo-engine)
7. [API Endpoints](#7-api-endpoints)
8. [Frontend Views](#8-frontend-views)

---

## 1. Database Schema

### Tenant Sites

```sql
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
```

### Site Pages

```sql
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
```

### Blog Posts

```sql
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
```

### Media Library

```sql
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
```

### Page Templates

```sql
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
```

### Contact Form Submissions

```sql
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
```

### Navigation Config

```sql
CREATE TABLE site_navigation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES tenant_sites(id) ON DELETE CASCADE,
    nav_type VARCHAR(20) NOT NULL CHECK (nav_type IN ('header', 'footer')),
    items JSONB NOT NULL DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    UNIQUE(site_id, nav_type)
);
```

---

## 2. Site Rendering Architecture

### Request Flow

```
Customer visits: www.transcendhealth.eu/services
    ↓
DNS resolves to DayStream server
    ↓
DayStream checks request hostname:
  - If custom_domain match → resolve tenant_site
  - If {slug}.daystream.app → resolve by slug
  - If /api/* → route to API
    ↓
Load tenant_site → get theme + navigation + page
    ↓
Render page using:
  - Tenant theme (colors, fonts, logo from Phase 04)
  - Page content_blocks (JSONB → rendered HTML/React)
  - Data-linked blocks (services, pricing, team fetched live)
  - SEO metadata injected
    ↓
Return rendered page to customer
```

### Content Block Rendering

Each block in `content_blocks` JSONB:
```json
{
  "id": "block-1",
  "type": "hero_banner",
  "config": {
    "headline": "Welcome to Transcend Health",
    "subtext": "Recovery. Performance. Wellness.",
    "image": "/media/hero.jpg",
    "cta_text": "Book Now",
    "cta_link": "/book"
  }
}
```

Rendered by a block registry that maps `type` → React component.

### i18n Readiness

Content blocks support a `locale` dimension (future):
```json
{
  "id": "block-1",
  "type": "hero_banner",
  "config": {
    "headline": { "en": "Welcome", "es": "Bienvenido" },
    "subtext": { "en": "Recovery...", "es": "Recuperación..." }
  }
}
```

For now, config values are simple strings. The renderer is built to handle both string and locale-object formats, defaulting to string for MVP.

---

## 3. Content Block System

### Available Block Types

| Type | Description | Data Source |
|------|-------------|-------------|
| `hero_banner` | Full-width image/video with headline + CTA | Manual |
| `feature_grid` | Icon + title + description cards | Manual |
| `service_showcase` | Service cards with booking links | Auto (services) |
| `pricing_table` | Membership plan comparison | Auto (plans) |
| `team_grid` | Staff photo + name + bio | Auto (staff directory) |
| `testimonials` | Customer quotes carousel | Manual |
| `image_gallery` | Grid or carousel of images | Manual (media library) |
| `text_section` | Rich text content | Manual |
| `cta_banner` | Heading + text + button | Manual |
| `faq_accordion` | Question/answer expandable | Manual |
| `contact_form` | Configurable form fields | Manual (config) |
| `map_location` | Address + embedded map | Manual |
| `video_embed` | YouTube/Vimeo player | Manual |
| `stats_numbers` | Animated counters | Manual |

### Data-Linked Blocks

`service_showcase`, `pricing_table`, and `team_grid` pull live data from the platform. When a service is added/removed, the block updates automatically. Configuration controls which items to show and display order.

---

## 4. Custom Domain Resolution

### Domain Setup Flow (Tier 1)

```
1. Tenant enters desired domain in admin
2. System generates verification TXT record value
3. Tenant adds TXT record + CNAME to their DNS
4. System periodically checks DNS for verification
5. Once verified: provision SSL certificate (Let's Encrypt)
6. Mark domain as active → start serving requests
7. Auto-renew certificate before expiry
```

### Multi-Tier Routing

```
Incoming request → check hostname:
  ├── matches custom_domain in tenant_sites → serve that tenant's site
  ├── matches {slug}.daystream.app → serve by slug
  ├── matches daystream.app/embed/* → serve widget API
  └── else → 404 or marketing site
```

---

## 5. Embeddable Widget

### Architecture

The embed widget is a standalone JavaScript bundle that:
1. Loads via `<script src="https://widgets.daystream.app/embed.js" data-tenant="slug"></script>`
2. Creates an iframe (for isolation) or renders inline (for tighter integration)
3. Communicates with DayStream API for booking/events/calendar data
4. Styled via tenant theme or custom CSS overrides
5. Handles auth (customer login within the widget)

### Widget Types

- **Booking Widget**: Full service browse → select → book → pay flow
- **Event Calendar**: Upcoming events with registration
- **Schedule Widget**: Weekly schedule grid
- **Class Timetable**: Recurring class display

---

## 6. SEO Engine

Per-page SEO config:
- Title tag (auto-generated from page title, overridable)
- Meta description (auto from first text block, overridable)
- Canonical URL
- Open Graph (title, description, image)
- Twitter card
- Structured data (JSON-LD): LocalBusiness, Service, Event, FAQPage

Sitemap auto-generated from published pages + blog posts.

---

## 7. API Endpoints

### Site Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/site` | Get tenant's site config |
| PUT | `/api/v1/cms/site` | Update site settings |
| PUT | `/api/v1/cms/site/domain` | Configure custom domain |
| GET | `/api/v1/cms/site/domain/status` | Check domain verification status |
| POST | `/api/v1/cms/site/publish` | Publish site |

### Pages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/pages` | List pages |
| POST | `/api/v1/cms/pages` | Create page |
| GET | `/api/v1/cms/pages/:id` | Get page with blocks |
| PUT | `/api/v1/cms/pages/:id` | Update page (blocks, SEO) |
| PUT | `/api/v1/cms/pages/:id/publish` | Publish page |
| DELETE | `/api/v1/cms/pages/:id` | Delete page |

### Blog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/blog` | List blog posts |
| POST | `/api/v1/cms/blog` | Create post |
| GET | `/api/v1/cms/blog/:id` | Get post |
| PUT | `/api/v1/cms/blog/:id` | Update post |
| PUT | `/api/v1/cms/blog/:id/publish` | Publish post |
| DELETE | `/api/v1/cms/blog/:id` | Delete post |

### Media

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/media` | List media files |
| POST | `/api/v1/cms/media` | Upload file |
| DELETE | `/api/v1/cms/media/:id` | Delete file |

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/templates` | List available templates |
| POST | `/api/v1/cms/templates/:id/apply` | Apply template to site |

### Navigation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/navigation` | Get nav config |
| PUT | `/api/v1/cms/navigation` | Update nav config |

### Forms

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/forms/submissions` | List submissions |
| POST | `/api/v1/cms/forms/submit` | Submit form (public) |

### Public Site (rendered)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cms/public/site` | Public site data (theme + nav) |
| GET | `/api/v1/cms/public/page/:slug` | Public page data |
| GET | `/api/v1/cms/public/blog` | Public blog listing |
| GET | `/api/v1/cms/public/blog/:slug` | Public blog post |
| GET | `/api/v1/cms/public/sitemap` | Sitemap XML |

---

## 8. Frontend Views

### Site Admin (`/cms`)
- Site settings (domain, hosting tier, template, publish status)
- Domain configuration wizard (step-by-step DNS instructions)
- Page list with enable/disable and reorder

### Page Editor (`/cms/pages/:id`)
- Block-based editor (add/remove/reorder blocks)
- Per-block configuration panel
- Preview mode (desktop/tablet/mobile)
- SEO configuration panel
- Draft/publish controls

### Blog Manager (`/cms/blog`)
- Post list with status and dates
- Post editor (rich text, featured image, tags, SEO)
- Schedule/publish controls

### Media Library (`/cms/media`)
- Grid view of uploaded images
- Upload dropzone
- Folder navigation
- Search and alt-text editing

### Template Gallery (`/cms/templates`)
- Template cards with preview images
- Apply button with confirmation
- Business type filter

### Navigation Editor (`/cms/navigation`)
- Drag-reorder menu items
- Add/remove links
- Footer content editor

### Form Submissions (`/cms/forms`)
- Submission list with read/unread
- Detail view per submission
- Export to CSV

### Public Site Preview
- Live preview of the tenant's public site
- Desktop/mobile toggle

---

**Last Updated**: June 17, 2026
