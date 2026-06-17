import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as siteService from '../services/cms-site.service';
import * as pagesService from '../services/cms-pages.service';
import * as blogService from '../services/cms-blog.service';
import * as mediaService from '../services/cms-media.service';
import * as templatesService from '../services/cms-templates.service';
import * as formsService from '../services/cms-forms.service';
import * as navService from '../services/cms-navigation.service';
import * as publicService from '../services/cms-public.service';
import { storage } from '../services/storage.service';

export const cmsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ============================================================
// Public endpoints (no auth)
// ============================================================
cmsRouter.get('/public/site', async (req: Request, res: Response) => {
  try {
    const id = (req.query.slug || req.query.domain) as string;
    if (!id) { error(res, 'slug or domain required', 'VALIDATION_ERROR', 400); return; }
    const data = await publicService.getPublicSite(id);
    if (!data) { error(res, 'Site not found', 'NOT_FOUND', 404); return; }
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/public/page/:slug', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.site_id as string;
    if (!siteId) { error(res, 'site_id required', 'VALIDATION_ERROR', 400); return; }
    const page = await publicService.getPublicPage(siteId, req.params.slug);
    if (!page) { error(res, 'Page not found', 'NOT_FOUND', 404); return; }
    success(res, page);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/public/blog', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.site_id as string;
    if (!siteId) { error(res, 'site_id required', 'VALIDATION_ERROR', 400); return; }
    const data = await publicService.getPublicBlogListing(siteId, req.query.page ? parseInt(req.query.page as string) : 1);
    success(res, data.posts, { page: data.page, total: data.total });
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/public/blog/:slug', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.site_id as string;
    if (!siteId) { error(res, 'site_id required', 'VALIDATION_ERROR', 400); return; }
    const post = await publicService.getPublicBlogPost(siteId, req.params.slug);
    if (!post) { error(res, 'Post not found', 'NOT_FOUND', 404); return; }
    success(res, post);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/public/sitemap', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.site_id as string;
    if (!siteId) { error(res, 'site_id required', 'VALIDATION_ERROR', 400); return; }
    const xml = await publicService.generateSitemap(siteId);
    res.setHeader('Content-Type', 'application/xml'); res.send(xml);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/forms/submit', async (req: Request, res: Response) => {
  try {
    const tenantId = req.body.tenant_id;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const sub = await formsService.submitForm(tenantId, { formName: req.body.form_name, data: req.body.data, ipAddress: req.ip });
    success(res, sub, undefined, 201);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Authenticated admin endpoints
// ============================================================
cmsRouter.use(authenticate);
cmsRouter.use(tenantContext);

// --- Site ---
cmsRouter.get('/site', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await siteService.getSite(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/site', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await siteService.updateSite(authReq.tenantId, req.body); success(res, s); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/site/domain', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const s = await siteService.configureDomain(authReq.tenantId, req.body.domain); success(res, s); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/site/domain/status', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await siteService.checkDomainStatus(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/site/publish', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await siteService.publishSite(authReq.tenantId)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Pages ---
cmsRouter.get('/pages', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); success(res, await pagesService.getPages(site.id)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/pages', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await pagesService.createPage(site.id, req.body); success(res, p, undefined, 201); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/pages/:id', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await pagesService.getPageById(req.params.id, site.id); if (!p) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/pages/:id', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await pagesService.updatePage(req.params.id, site.id, req.body); if (!p) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/pages/:id/publish', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await pagesService.publishPage(req.params.id, site.id); success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.delete('/pages/:id', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const d = await pagesService.deletePage(req.params.id, site.id); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Blog ---
cmsRouter.get('/blog', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const r = await blogService.getPosts(site.id, { status: req.query.status as string, page: req.query.page ? parseInt(req.query.page as string) : 1 }); success(res, r.posts, { page: r.page, total: r.total }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/blog', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await blogService.createPost(site.id, req.body); success(res, p, undefined, 201); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.get('/blog/:id', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await blogService.getPostById(req.params.id, site.id); if (!p) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/blog/:id', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await blogService.updatePost(req.params.id, site.id, req.body); if (!p) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/blog/:id/publish', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const p = await blogService.publishPost(req.params.id, site.id); success(res, p); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.delete('/blog/:id', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const d = await blogService.deletePost(req.params.id, site.id); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Media ---
cmsRouter.get('/media', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; success(res, await mediaService.getMedia(authReq.tenantId, { folder: req.query.folder as string, search: req.query.search as string })); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/media', requirePermission('cms:*'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!req.file) { error(res, 'No file', 'VALIDATION_ERROR', 400); return; }
    const ext = req.file.originalname.split('.').pop() || 'bin';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const relativePath = `cms/${authReq.tenantId}/${filename}`;
    await storage.save(relativePath, req.file.buffer);
    const media = await mediaService.uploadMedia(authReq.tenantId, { filename, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, filePath: relativePath, folder: req.body.folder, altText: req.body.alt_text });
    success(res, media, undefined, 201);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.delete('/media/:id', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await mediaService.deleteMedia(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Templates ---
cmsRouter.get('/templates', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { success(res, await templatesService.getTemplates(req.query.business_type as string)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.post('/templates/:id/apply', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const pages = await templatesService.applyTemplate(authReq.tenantId, req.params.id); success(res, pages); } catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Navigation ---
cmsRouter.get('/navigation', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); success(res, await navService.getNavigation(site.id)); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
cmsRouter.put('/navigation', requirePermission('cms:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const site = await siteService.getSite(authReq.tenantId); const nav = await navService.updateNavigation(site.id, req.body.nav_type, req.body.items, req.body.settings); success(res, nav); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Form Submissions (admin view) ---
cmsRouter.get('/forms/submissions', requirePermission('cms:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await formsService.getSubmissions(authReq.tenantId, { formName: req.query.form_name as string, page: req.query.page ? parseInt(req.query.page as string) : 1 }); success(res, r.submissions, { page: r.page, total: r.total }); } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
