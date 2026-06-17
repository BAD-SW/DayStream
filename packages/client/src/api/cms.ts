import { apiClient } from './client';

export async function getSite() { const r = await apiClient.get('/v1/cms/site'); return r.data.data; }
export async function updateSite(data: Record<string, any>) { const r = await apiClient.put('/v1/cms/site', data); return r.data.data; }
export async function configureDomain(domain: string) { const r = await apiClient.put('/v1/cms/site/domain', { domain }); return r.data.data; }
export async function getDomainStatus() { const r = await apiClient.get('/v1/cms/site/domain/status'); return r.data.data; }
export async function publishSite() { const r = await apiClient.post('/v1/cms/site/publish'); return r.data.data; }
export async function getPages() { const r = await apiClient.get('/v1/cms/pages'); return r.data.data; }
export async function createPage(data: Record<string, any>) { const r = await apiClient.post('/v1/cms/pages', data); return r.data.data; }
export async function getPage(id: string) { const r = await apiClient.get(`/v1/cms/pages/${id}`); return r.data.data; }
export async function updatePage(id: string, data: Record<string, any>) { const r = await apiClient.put(`/v1/cms/pages/${id}`, data); return r.data.data; }
export async function publishPage(id: string) { const r = await apiClient.put(`/v1/cms/pages/${id}/publish`); return r.data.data; }
export async function getBlogPosts(params?: Record<string, any>) { const r = await apiClient.get('/v1/cms/blog', { params }); return { data: r.data.data, meta: r.data.meta }; }
export async function createBlogPost(data: Record<string, any>) { const r = await apiClient.post('/v1/cms/blog', data); return r.data.data; }
export async function publishBlogPost(id: string) { const r = await apiClient.put(`/v1/cms/blog/${id}/publish`); return r.data.data; }
export async function getMedia(params?: Record<string, any>) { const r = await apiClient.get('/v1/cms/media', { params }); return r.data.data; }
export async function getTemplates(businessType?: string) { const r = await apiClient.get('/v1/cms/templates', { params: { business_type: businessType } }); return r.data.data; }
export async function applyTemplate(id: string) { const r = await apiClient.post(`/v1/cms/templates/${id}/apply`); return r.data.data; }
export async function getNavigation() { const r = await apiClient.get('/v1/cms/navigation'); return r.data.data; }
export async function updateNavigation(navType: string, items: any[], settings?: any) { const r = await apiClient.put('/v1/cms/navigation', { nav_type: navType, items, settings }); return r.data.data; }
export async function getFormSubmissions(params?: Record<string, any>) { const r = await apiClient.get('/v1/cms/forms/submissions', { params }); return { data: r.data.data, meta: r.data.meta }; }
