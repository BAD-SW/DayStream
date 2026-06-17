# Phase 18: Website & CMS - Tasks

## Overview

Implementation tasks for the website and CMS module â€” database schema, tenant site management, page templates, content block system, media library, blog publishing, SEO, custom domain hosting (3 tiers), embeddable widgets, contact forms, navigation, and frontend.

## Task Status Legend

- âœ… **Complete**: Task is finished and verified
- ðŸŸ¡ **In Progress**: Task is currently being worked on
- ðŸ“‹ **Planned**: Task is defined but not started
- â¸ï¸ **Blocked**: Task is waiting on dependencies
- âŒ **Cancelled**: Task is no longer needed

---

## 1. Database Schema

### 1.1 Core Tables
- [x] ✅ Create migration for `tenant_sites` table
- [x] ✅ Create migration for `site_pages` table
- [x] ✅ Create migration for `blog_posts` table
- [x] ✅ Create migration for `media_files` table
- [x] ✅ Create migration for `page_templates` table
- [x] ✅ Create migration for `form_submissions` table
- [x] ✅ Create migration for `site_navigation` table

### 1.2 Indexes and Permissions
- [x] ✅ Add indexes (tenant, slug, domain, status)
- [x] ✅ Add RLS policies on all tables (tenant-scoped)
- [x] ✅ Grant permissions to daystream_app role
- [x] ✅ Run migrations and verify schema

---

## 2. Tenant Site Management

### 2.1 Site Service
- [x] ✅ Create `cms-site.service.ts`
- [x] ✅ Create/get tenant site (auto-create on first access)
- [x] ✅ Support site settings (publish status, template, hosting tier)
- [x] ✅ Support slug-based lookup for subdomain tier
- [x] ✅ Support custom domain configuration
- [x] ✅ Domain verification (DNS TXT record check)
- [x] ✅ Domain status tracking (pending â†’ verifying â†’ active â†’ failed)
- [x] ✅ Write tests

### 2.2 Routes
- [x] ✅ Create `GET /api/v1/cms/site` endpoint
- [x] ✅ Create `PUT /api/v1/cms/site` endpoint
- [x] ✅ Create `PUT /api/v1/cms/site/domain` endpoint
- [x] ✅ Create `GET /api/v1/cms/site/domain/status` endpoint
- [x] ✅ Create `POST /api/v1/cms/site/publish` endpoint

---

## 3. Page Management

### 3.1 Pages Service
- [x] ✅ Create `cms-pages.service.ts`
- [x] ✅ Support page CRUD (create, get, update, delete)
- [x] ✅ Support content_blocks JSONB (add/remove/reorder blocks)
- [x] ✅ Support SEO config per page
- [x] ✅ Support draft â†’ published workflow
- [x] ✅ Support page enable/disable and display order
- [x] ✅ Support page type validation (homepage, services, etc.)
- [x] ✅ Write tests

### 3.2 Routes
- [x] ✅ Create `GET /api/v1/cms/pages` endpoint
- [x] ✅ Create `POST /api/v1/cms/pages` endpoint
- [x] ✅ Create `GET /api/v1/cms/pages/:id` endpoint
- [x] ✅ Create `PUT /api/v1/cms/pages/:id` endpoint
- [x] ✅ Create `PUT /api/v1/cms/pages/:id/publish` endpoint
- [x] ✅ Create `DELETE /api/v1/cms/pages/:id` endpoint

---

## 4. Content Block System

### 4.1 Block Rendering
- [x] ✅ Define block type registry (type â†’ component mapping)
- [x] ✅ Implement data-linked block resolution (services, pricing, team)
- [x] ✅ Support block configuration validation per type
- [x] ✅ Support i18n-ready config structure (string or locale-object)
- [x] ✅ Write tests

---

## 5. Page Templates

### 5.1 Template Service
- [x] ✅ Create `cms-templates.service.ts`
- [x] ✅ Seed default templates per business type (Recovery, Yoga, Gym, Spa, Physio, General)
- [x] ✅ Support listing available templates
- [x] ✅ Support applying template to site (creates pages with pre-configured blocks)
- [x] ✅ Write tests

### 5.2 Routes
- [x] ✅ Create `GET /api/v1/cms/templates` endpoint
- [x] ✅ Create `POST /api/v1/cms/templates/:id/apply` endpoint

---

## 6. Blog Publishing

### 6.1 Blog Service
- [x] ✅ Create `cms-blog.service.ts`
- [x] ✅ Support post CRUD (create, get, update, delete)
- [x] ✅ Support draft/published/archived status
- [x] ✅ Support scheduled publication (future publish date)
- [x] ✅ Support tags and categories
- [x] ✅ Support slug generation
- [x] ✅ Support SEO config per post
- [x] ✅ Write tests

### 6.2 Routes
- [x] ✅ Create `GET /api/v1/cms/blog` endpoint
- [x] ✅ Create `POST /api/v1/cms/blog` endpoint
- [x] ✅ Create `GET /api/v1/cms/blog/:id` endpoint
- [x] ✅ Create `PUT /api/v1/cms/blog/:id` endpoint
- [x] ✅ Create `PUT /api/v1/cms/blog/:id/publish` endpoint
- [x] ✅ Create `DELETE /api/v1/cms/blog/:id` endpoint

---

## 7. Media Library

### 7.1 Media Service
- [x] ✅ Create `cms-media.service.ts`
- [x] ✅ Support file upload (images: JPEG, PNG, WebP; files: PDF)
- [x] ✅ Auto-generate responsive sizes (thumbnail, medium, large) via sharp
- [x] ✅ Support folder organization
- [x] ✅ Support alt text per image
- [x] ✅ Support filename search
- [x] ✅ Track file references (which pages use which media)
- [x] ✅ Store in tenant-scoped paths (local filesystem / S3)
- [x] ✅ Write tests

### 7.2 Routes
- [x] ✅ Create `GET /api/v1/cms/media` endpoint
- [x] ✅ Create `POST /api/v1/cms/media` endpoint (multipart upload)
- [x] ✅ Create `DELETE /api/v1/cms/media/:id` endpoint

---

## 8. SEO Engine

### 8.1 SEO Service
- [x] ✅ Create `cms-seo.service.ts`
- [x] ✅ Auto-generate title/description from page content
- [x] ✅ Support Open Graph and Twitter card metadata
- [x] ✅ Generate structured data (JSON-LD: LocalBusiness, Service, Event, FAQPage)
- [x] ✅ Generate sitemap.xml from published pages + blog posts
- [x] ✅ Generate robots.txt
- [x] ✅ SEO score/checklist per page
- [x] ✅ Write tests

---

## 9. Custom Domain (3-Tier Hosting)

### 9.1 Domain Service
- [x] ✅ Create `cms-domain.service.ts`
- [x] ✅ Tier 1: Custom domain configuration and verification
- [x] ✅ DNS verification (check TXT record)
- [x] ✅ SSL provisioning placeholder (Let's Encrypt / AWS ACM integration point)
- [x] ✅ Auto-renewal scheduling
- [x] ✅ Tier 2: Default subdomain ({slug}.daystream.app) â€” works immediately
- [x] ✅ Tier 3: Widget-only mode (no standalone site, just embeds)
- [x] ✅ Domain status monitoring
- [x] ✅ Fallback logic (custom domain fails â†’ revert to subdomain)
- [x] ✅ Write tests

### 9.2 Domain Resolution Middleware
- [x] ✅ Implement hostname-based tenant resolution
- [x] ✅ Route requests to correct tenant based on domain or subdomain
- [x] ✅ Handle SSL termination (reverse proxy config)

---

## 10. Embeddable Booking Widget

### 10.1 Widget Service
- [x] ✅ Create `cms-widget.service.ts`
- [x] ✅ Generate embed code (JavaScript snippet, iframe, popup)
- [x] ✅ Support configuring displayed services/categories
- [x] ✅ Support theme inheritance or custom styling
- [x] ✅ Serve widget JavaScript bundle
- [x] ✅ Handle cross-origin requests (CORS)
- [x] ✅ Write tests

### 10.2 Routes
- [x] ✅ Create widget bundle endpoint (public JavaScript file)
- [x] ✅ Create widget API endpoints (services, booking flow within widget context)

---

## 11. Contact Forms

### 11.1 Form Service
- [x] ✅ Create `cms-forms.service.ts`
- [x] ✅ Support form submission (validate fields, store data)
- [x] ✅ CAPTCHA/spam protection (placeholder for reCAPTCHA integration)
- [x] ✅ Send notification email to configured recipient
- [x] ✅ Optionally create Lead record in Customer Management
- [x] ✅ Support multiple forms per site
- [x] ✅ Write tests

### 11.2 Routes
- [x] ✅ Create `POST /api/v1/cms/forms/submit` endpoint (public)
- [x] ✅ Create `GET /api/v1/cms/forms/submissions` endpoint (admin)

---

## 12. Navigation Management

### 12.1 Navigation Service
- [x] ✅ Create `cms-navigation.service.ts`
- [x] ✅ Support header navigation CRUD (items JSONB)
- [x] ✅ Support footer content CRUD (business info, social, legal links)
- [x] ✅ Support menu item types (page link, external link, dropdown, CTA)
- [x] ✅ Write tests

### 12.2 Routes
- [x] ✅ Create `GET /api/v1/cms/navigation` endpoint
- [x] ✅ Create `PUT /api/v1/cms/navigation` endpoint

---

## 13. Public Site API

### 13.1 Public Rendering Service
- [x] ✅ Create `cms-public.service.ts`
- [x] ✅ Serve site data (theme, navigation, settings) by domain/slug
- [x] ✅ Serve page data with resolved content blocks
- [x] ✅ Serve blog listing and individual posts
- [x] ✅ Resolve data-linked blocks (services, pricing, team)
- [x] ✅ Generate and serve sitemap.xml
- [x] ✅ Write tests

### 13.2 Routes
- [x] ✅ Create `GET /api/v1/cms/public/site` endpoint (by domain or slug)
- [x] ✅ Create `GET /api/v1/cms/public/page/:slug` endpoint
- [x] ✅ Create `GET /api/v1/cms/public/blog` endpoint
- [x] ✅ Create `GET /api/v1/cms/public/blog/:slug` endpoint
- [x] ✅ Create `GET /api/v1/cms/public/sitemap` endpoint

---

## 14. Frontend

### 14.1 CMS Admin Dashboard
- [x] ✅ Create `/cms` page with site overview
- [x] ✅ Domain configuration wizard (step-by-step DNS guide)
- [x] ✅ Hosting tier selector
- [x] ✅ Publish site button

### 14.2 Page Editor
- [x] ✅ Create `/cms/pages/:id` editor
- [x] ✅ Block list with add/remove/reorder
- [x] ✅ Per-block configuration panel (right sidebar)
- [x] ✅ Preview mode (desktop/tablet/mobile)
- [x] ✅ SEO panel
- [x] ✅ Draft/publish controls

### 14.3 Blog Manager
- [x] ✅ Create `/cms/blog` list page
- [x] ✅ Create `/cms/blog/:id` editor (rich text, image, tags, SEO)
- [x] ✅ Schedule/publish controls

### 14.4 Media Library
- [x] ✅ Create `/cms/media` page
- [x] ✅ Upload dropzone
- [x] ✅ Grid view with thumbnails
- [x] ✅ Folder navigation
- [x] ✅ Alt text editing

### 14.5 Template Gallery
- [x] ✅ Create `/cms/templates` page
- [x] ✅ Template cards with preview
- [x] ✅ Apply with confirmation

### 14.6 Navigation Editor
- [x] ✅ Create `/cms/navigation` page
- [x] ✅ Drag-reorder header menu items
- [x] ✅ Footer content editor

### 14.7 Form Submissions
- [x] ✅ Create `/cms/forms` page
- [x] ✅ Submission list (read/unread)
- [x] ✅ Detail view
- [x] ✅ Export CSV

### 14.8 Widget Configuration
- [x] ✅ Create `/cms/widget` page
- [x] ✅ Widget type selector (booking, events, schedule)
- [x] ✅ Service/category filter config
- [x] ✅ Embed code generator with copy button
- [x] ✅ Preview

---

## 15. Testing

### 15.1 Unit Tests
- [x] ✅ Test site CRUD and domain configuration
- [x] ✅ Test page CRUD and content block management
- [x] ✅ Test blog post lifecycle (draft, publish, schedule)
- [x] ✅ Test media upload and responsive size generation
- [x] ✅ Test template application (creates pages with blocks)
- [x] ✅ Test SEO generation (meta tags, structured data, sitemap)
- [x] ✅ Test domain verification logic
- [x] ✅ Test form submission and notification
- [x] ✅ Test navigation CRUD
- [x] ✅ Test public site rendering (domain resolution, page data)

### 15.2 Integration Tests
- [x] ✅ Test full site creation â†’ template apply â†’ publish flow
- [x] ✅ Test custom domain configuration â†’ verification â†’ active
- [x] ✅ Test public page access via subdomain and custom domain
- [x] ✅ Test embed widget loading and booking flow
- [x] ✅ Test contact form â†’ lead creation â†’ notification
- [x] ✅ Test blog publish â†’ sitemap update â†’ SEO metadata
- [x] ✅ Test tenant scoping (site data isolated per tenant)
