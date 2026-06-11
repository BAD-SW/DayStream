# Phase 18: Website & CMS - Requirements

## Overview

This phase provides tenant-customizable web presence — branded pages, content management, and SEO tools. The platform's differentiator is personalization: each business gets a portal that looks and feels like their own brand, seamlessly connecting to their booking engine, service catalog, and membership offerings. This is NOT a full page builder — it's a structured, template-driven content system that allows businesses to customize their public-facing pages without code.

## Goals

- Provide tenant-customizable public pages (homepage, services, pricing, team, FAQ, contact)
- Build a content management system for page content and blog posts
- Implement per-tenant branding (logo, colors, fonts, imagery) applied at runtime
- Support SEO tooling (meta tags, structured data, sitemap, Open Graph)
- Support custom domain mapping per tenant
- Enable embedding booking flows within the tenant's existing website
- Provide pre-built page templates per business type

## Glossary

- **Tenant_Site**: The public-facing web presence for a specific Tenant
- **Page**: A configured page within the Tenant_Site (e.g., Homepage, Services, Pricing)
- **Page_Template**: A pre-designed layout structure that a Tenant fills with their own content
- **Content_Block**: A configurable section within a page (hero, feature grid, testimonials, CTA, etc.)
- **Blog_Post**: A publishable article or news entry managed by the Tenant
- **Media_Library**: A per-tenant collection of uploaded images and files
- **SEO_Config**: Metadata associated with a page for search engine optimization
- **Custom_Domain**: A Tenant's own domain pointed at their Tenant_Site
- **Embed_Widget**: A bookable component that can be embedded on an external website

## Requirements

### Requirement 1: Tenant Site Structure

**User Story:** As a business owner, I want my own branded website within the platform, so that customers see a professional presence that matches my brand.

#### Acceptance Criteria

1. THE system SHALL provide each Tenant with a public-facing Tenant_Site
2. THE Tenant_Site SHALL be accessible via a default URL (e.g., `platform.com/transcend` or `transcend.platform.com`)
3. THE Tenant_Site SHALL support the following standard pages: Homepage, Services (linked to service catalog), Pricing (linked to membership plans), Team/Staff (linked to public staff directory), About, FAQ, Contact, Blog, Gallery
4. THE system SHALL allow Tenants to enable/disable pages (e.g., hide Blog if not used)
5. THE system SHALL allow Tenants to reorder navigation menu items
6. THE system SHALL generate responsive pages (mobile-first)
7. THE system SHALL apply the Tenant's theme (colors, fonts, logo) from the Theme Engine (Phase 04)
8. THE system SHALL render pages using the Tenant's configured language (i18n, Phase 03)

### Requirement 2: Page Templates

**User Story:** As a business owner, I want pre-designed page layouts for my business type, so that I get a professional site quickly without design skills.

#### Acceptance Criteria

1. THE system SHALL provide Page_Templates per business type: Recovery Center (Transcend-inspired), Yoga Studio, Gym/Fitness, Spa & Wellness, Physiotherapy Clinic, General (flexible)
2. Each Page_Template SHALL include pre-configured Content_Blocks with placeholder content
3. THE system SHALL allow Tenants to select and apply a template during onboarding
4. THE system SHALL allow customizing all content within a template (text, images, layout options)
5. THE system SHALL allow switching templates without losing content (content migrates to new layout where possible)
6. THE system SHALL support previewing a template before applying

### Requirement 3: Content Block System

**User Story:** As a business owner, I want to customize page sections with my own content, so that my site tells my story.

#### Acceptance Criteria

1. THE system SHALL provide configurable Content_Blocks: Hero Banner (image/video, headline, subtext, CTA button), Feature Grid (icon + title + description cards), Service Showcase (linked to service catalog, auto-populated), Pricing Table (linked to membership plans, auto-populated), Team Grid (linked to public staff directory, auto-populated), Testimonials/Reviews (customer quotes), Image Gallery (grid or carousel), Text Section (rich text content), Call-to-Action Banner (heading, text, button), FAQ Accordion (question/answer pairs), Contact Form (configurable fields), Map/Location (address with embedded map), Video Embed (YouTube, Vimeo), Stats/Numbers (animated counters)
2. THE system SHALL allow adding, removing, and reordering Content_Blocks per page
3. THE system SHALL support configuring each block's content (text, images, links)
4. THE system SHALL support configuring block-level styling options (background color, padding, text alignment)
5. THE system SHALL auto-populate data-linked blocks (services, pricing, team) from the platform data
6. THE system SHALL update data-linked blocks automatically when the source data changes

### Requirement 4: Content Editor

**User Story:** As a business owner, I want an easy way to edit my site content, so that I can update text and images without technical knowledge.

#### Acceptance Criteria

1. THE system SHALL provide a WYSIWYG content editor for text sections
2. THE editor SHALL support: headings, bold, italic, links, lists, images, blockquotes
3. THE system SHALL provide an inline editing experience (edit content in context of the page layout)
4. THE system SHALL support previewing changes before publishing
5. THE system SHALL support draft and published states for content changes
6. THE system SHALL track content revision history (who changed what, when)
7. THE system SHALL support reverting to a previous content version
8. THE system SHALL validate that all required content fields are filled before allowing publish

### Requirement 5: Media Library

**User Story:** As a business owner, I want to upload and manage images for my site, so that I can use my own photos and branding assets.

#### Acceptance Criteria

1. THE system SHALL provide a per-tenant Media_Library for image and file uploads
2. THE system SHALL support image uploads: JPEG, PNG, WebP (max 10MB per file)
3. THE system SHALL support file uploads: PDF (for downloadable content like menus, guides)
4. THE system SHALL auto-generate responsive image sizes on upload (thumbnail, medium, large, original)
5. THE system SHALL support organizing media into folders
6. THE system SHALL support searching media by filename
7. THE system SHALL display used/unused media (which images are referenced on pages)
8. THE system SHALL store media in tenant-scoped storage paths
9. THE system SHALL support alt text per image (accessibility)

### Requirement 6: Blog/News Publishing

**User Story:** As a business owner, I want to publish blog posts, so that I can share news, tips, and improve my SEO.

#### Acceptance Criteria

1. THE system SHALL support creating Blog_Posts with: title, slug (URL-friendly), content (rich text), featured image, excerpt/summary, author, tags/categories, status (draft, published, archived), publish date (scheduled or immediate)
2. THE system SHALL support scheduling posts for future publication
3. THE system SHALL display published posts on the Tenant_Site blog page (newest first)
4. THE system SHALL support blog post categories and tags for organization
5. THE system SHALL support pagination on the blog listing page
6. THE system SHALL generate SEO metadata for each blog post
7. THE system SHALL support social sharing buttons on blog posts
8. THE system SHALL support a related posts section (based on tags/category)

### Requirement 7: SEO Tooling

**User Story:** As a business owner, I want my site to rank well in search engines, so that potential customers can find me online.

#### Acceptance Criteria

1. THE system SHALL support configuring per-page SEO_Config: page title (title tag), meta description, canonical URL, Open Graph title/description/image, Twitter card metadata
2. THE system SHALL auto-generate SEO_Config defaults from page content (overridable)
3. THE system SHALL generate a sitemap.xml for each Tenant_Site
4. THE system SHALL generate structured data (JSON-LD) for: LocalBusiness, Service, Event, FAQPage, BreadcrumbList
5. THE system SHALL generate semantic HTML with proper heading hierarchy (h1, h2, h3)
6. THE system SHALL support adding a robots.txt per tenant
7. THE system SHALL support connecting Google Search Console (verification meta tag)
8. THE system SHALL display an SEO checklist/score per page (title length, description length, heading structure)

### Requirement 8: Custom Domain Support

**User Story:** As a business owner, I want my booking site on my own domain (e.g., book.mybusiness.com), so that it feels like my own brand.

#### Acceptance Criteria

1. THE system SHALL support mapping a Custom_Domain to a Tenant_Site
2. THE system SHALL provide DNS configuration instructions to the Tenant
3. THE system SHALL provision and manage SSL/TLS certificates for custom domains (e.g., via Let's Encrypt)
4. THE system SHALL verify domain ownership before activating
5. THE system SHALL support both root domains (mybusiness.com) and subdomains (book.mybusiness.com)
6. THE system SHALL redirect the default platform URL to the custom domain when configured
7. THE system SHALL handle certificate renewal automatically
8. THE system SHALL gracefully fall back to the default URL if custom domain configuration fails

### Requirement 9: Embeddable Booking Widget

**User Story:** As a business owner who already has a website, I want to embed my booking flow on my existing site, so that customers can book without leaving my website.

#### Acceptance Criteria

1. THE system SHALL provide an Embed_Widget that can be inserted into any external website
2. THE Embed_Widget SHALL support embed methods: JavaScript snippet (inline widget), iFrame embed, popup/modal trigger (button click opens booking)
3. THE Embed_Widget SHALL support configuring which services/categories to display
4. THE Embed_Widget SHALL inherit the Tenant's theme (or support custom styling for external sites)
5. THE Embed_Widget SHALL support the complete booking flow (browse → select → book → pay → confirm)
6. THE Embed_Widget SHALL handle authentication (customer login within the widget)
7. THE system SHALL provide embed code generation with copy-to-clipboard in the admin UI
8. THE Embed_Widget SHALL be responsive (adapts to container width)

### Requirement 10: Contact Form and Lead Capture

**User Story:** As a business owner, I want a contact form on my site, so that potential customers can reach me with inquiries.

#### Acceptance Criteria

1. THE system SHALL provide a configurable Contact Form block with: configurable fields (name, email, phone, message, custom fields), required/optional per field, CAPTCHA/spam protection, submission notification (email to configured recipient)
2. THE system SHALL store form submissions in the system (viewable by staff)
3. THE system SHALL optionally create a Lead record in Customer Management (Phase 05) from submissions
4. THE system SHALL support auto-reply to the submitter (configurable template)
5. THE system SHALL support multiple forms per site (contact, inquiry, free trial request)
6. THE system SHALL log all submissions with timestamps

### Requirement 11: Navigation and Footer Management

**User Story:** As a business owner, I want to control my site's navigation and footer content, so that customers can find what they need easily.

#### Acceptance Criteria

1. THE system SHALL allow configuring the main navigation menu: page links (internal), custom links (external), dropdown menus (grouped items), "Book Now" CTA button (always visible)
2. THE system SHALL allow configuring the footer: business information (address, phone, email), operating hours, social media links, legal links (privacy policy, terms), custom text/copyright
3. THE system SHALL support sticky/fixed header navigation
4. THE system SHALL render navigation responsively (hamburger menu on mobile)
5. THE system SHALL support a "Book Now" floating action button on mobile

---

## Dependencies

- Phase 00: Infrastructure - Database, API, file storage
- Phase 02: Security & Compliance - RBAC (who can edit site content)
- Phase 03: Core Platform - Tenant context, configuration engine, i18n, custom domains
- Phase 04: Design System - Theme engine (tenant branding), responsive components
- Phase 05: Customer Management - Lead capture from contact forms
- Phase 06: Service Management - Service catalog data for auto-populated blocks
- Phase 07: Booking Engine - Booking flow for embed widget
- Phase 08: Membership Engine - Pricing table data for auto-populated blocks
- Phase 12: Staff Management - Staff directory data for team page

## Success Criteria

- Each tenant has a public-facing branded site with configured pages
- Page templates allow quick onboarding without design skills
- Content blocks can be added, removed, reordered, and customized
- Blog posts can be published and appear with proper SEO
- SEO tools generate proper meta tags, structured data, and sitemaps
- Custom domains work with automatic SSL provisioning
- Embed widget allows booking from external websites
- Contact form captures leads and notifies the business
- All site content is strictly tenant-scoped
- Pages load within 2 seconds

## Out of Scope

- Full drag-and-drop page builder (Wix/Squarespace level) - Structured templates are sufficient
- E-commerce product catalog (physical goods) - Future enhancement
- Multi-language pages (same page in multiple languages) - i18n handles UI; translated page content is future
- A/B testing of page layouts - Future enhancement
- Custom code injection (JavaScript/CSS) - Security risk; not supported initially
- Email hosting for custom domains - Out of scope

## Notes

- This is personalization, not a page builder. Structured templates with configurable blocks strike the balance between flexibility and development effort.
- The key differentiator (per your requirements) is that each business's portal feels like their brand — same colors, fonts, imagery as their main site
- Embed widget is critical for businesses that already have websites and don't want to migrate entirely
- Custom domain SSL provisioning needs infrastructure support (tracked in MIGRATION_TRACKER.md for AWS — use Caddy or similar locally)
- Data-linked blocks (services, pricing, team) auto-update — no manual sync needed
- Blog/SEO is important for organic customer acquisition for each tenant
- Media storage is local filesystem during development (S3 migration tracked)

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06, Phase 07, Phase 08, Phase 12
**Next Phase**: Phase 19 (Mobile Application)
