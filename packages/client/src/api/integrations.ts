import { apiClient } from './client';

export async function getMarketplace() { const r = await apiClient.get('/v1/integrations/marketplace'); return r.data.data; }
export async function getConnections() { const r = await apiClient.get('/v1/integrations'); return r.data.data; }
export async function connectProvider(provider: string, redirectUri: string) { const r = await apiClient.post('/v1/integrations/connect', { provider, redirect_uri: redirectUri }); return r.data.data; }
export async function disconnectIntegration(id: string) { const r = await apiClient.delete(`/v1/integrations/${id}`); return r.data.data; }
export async function triggerSync(id: string) { const r = await apiClient.post(`/v1/integrations/${id}/sync`); return r.data.data; }
export async function getWebhooks() { const r = await apiClient.get('/v1/integrations/webhooks'); return r.data.data; }
export async function createWebhook(data: Record<string, any>) { const r = await apiClient.post('/v1/integrations/webhooks', data); return r.data.data; }
export async function deleteWebhook(id: string) { await apiClient.delete(`/v1/integrations/webhooks/${id}`); }
export async function testWebhook(id: string) { const r = await apiClient.post(`/v1/integrations/webhooks/${id}/test`); return r.data.data; }
export async function getApiKeys() { const r = await apiClient.get('/v1/integrations/api-keys'); return r.data.data; }
export async function createApiKey(data: Record<string, any>) { const r = await apiClient.post('/v1/integrations/api-keys', data); return r.data.data; }
export async function deleteApiKey(id: string) { await apiClient.delete(`/v1/integrations/api-keys/${id}`); }
export async function getStaffIcalFeed() { const r = await apiClient.get('/v1/integrations/ical/staff'); return r.data.data; }
export async function getCustomerIcalFeed() { const r = await apiClient.get('/v1/integrations/ical/customer'); return r.data.data; }
export async function regenerateIcalToken() { const r = await apiClient.post('/v1/integrations/ical/regenerate'); return r.data.data; }
export async function getWebhookDeliveries(webhookId: string) { const r = await apiClient.get(`/v1/integrations/webhooks/${webhookId}/deliveries`); return r.data.data; }
