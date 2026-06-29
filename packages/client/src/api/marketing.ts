import { apiClient } from './client';

// Campaigns
export async function getCampaigns(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/marketing/campaigns', { params }); return { data: res.data.data, meta: res.data.meta };
}
export async function createCampaign(data: Record<string, any>) {
  const res = await apiClient.post('/v1/marketing/campaigns', data); return res.data.data;
}
export async function getCampaign(id: string) { const res = await apiClient.get(`/v1/marketing/campaigns/${id}`); return res.data.data; }
export async function sendCampaign(id: string) { const res = await apiClient.post(`/v1/marketing/campaigns/${id}/send`); return res.data.data; }
export async function getCampaignAnalytics(id: string) { const res = await apiClient.get(`/v1/marketing/campaigns/${id}/analytics`); return res.data.data; }
export async function getCampaignRecipients(id: string) { const res = await apiClient.get(`/v1/marketing/campaigns/${id}/recipients`); return res.data.data; }
export async function scheduleCampaign(id: string, data: Record<string, any>) { const res = await apiClient.put(`/v1/marketing/campaigns/${id}/schedule`, data); return res.data.data; }
export async function testCampaign(id: string, data: Record<string, any>) { const res = await apiClient.post(`/v1/marketing/campaigns/${id}/test`, data); return res.data.data; }

// Sequences
export async function getSequences(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/marketing/sequences', { params }); return { data: res.data.data, meta: res.data.meta };
}
export async function createSequence(data: Record<string, any>) { const res = await apiClient.post('/v1/marketing/sequences', data); return res.data.data; }
export async function getSequence(id: string) { const res = await apiClient.get(`/v1/marketing/sequences/${id}`); return res.data.data; }
export async function updateSequence(id: string, data: Record<string, any>) { const res = await apiClient.put(`/v1/marketing/sequences/${id}`, data); return res.data.data; }
export async function activateSequence(id: string) { const res = await apiClient.post(`/v1/marketing/sequences/${id}/activate`); return res.data.data; }
export async function pauseSequence(id: string) { const res = await apiClient.post(`/v1/marketing/sequences/${id}/pause`); return res.data.data; }
export async function validateSequence(id: string) { const res = await apiClient.post(`/v1/marketing/sequences/${id}/validate`); return res.data.data; }
export async function getSequenceTemplates() { const res = await apiClient.get('/v1/marketing/sequences/templates'); return res.data.data; }

// Templates
export async function getTemplates(channel?: string) { const res = await apiClient.get('/v1/marketing/templates', { params: { channel } }); return res.data.data; }
export async function createTemplate(data: Record<string, any>) { const res = await apiClient.post('/v1/marketing/templates', data); return res.data.data; }
export async function getTemplate(id: string) { const res = await apiClient.get(`/v1/marketing/templates/${id}`); return res.data.data; }
export async function previewTemplate(id: string, data: Record<string, any>) { const res = await apiClient.post(`/v1/marketing/templates/${id}/preview`, data); return res.data.data; }

// Consent
export async function getPreferences(customerId: string) { const res = await apiClient.get(`/v1/marketing/preferences/${customerId}`); return res.data.data; }
export async function updatePreferences(customerId: string, prefs: any[]) { const res = await apiClient.put(`/v1/marketing/preferences/${customerId}`, { preferences: prefs }); return res.data.data; }

// Funnels
export async function getFunnels() { const res = await apiClient.get('/v1/marketing/funnels'); return res.data.data; }
export async function createFunnel(data: Record<string, any>) { const res = await apiClient.post('/v1/marketing/funnels', data); return res.data.data; }
export async function getFunnelAnalytics(id: string) { const res = await apiClient.get(`/v1/marketing/funnels/${id}/analytics`); return res.data.data; }

// Sequence enrollments
export async function getSequenceEnrollments(id: string) { const res = await apiClient.get(`/v1/marketing/sequences/${id}/enrollments`); return res.data.data; }
