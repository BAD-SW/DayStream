import { apiClient } from './client';

// Leads (THE-17): Marketing → Leads and Settings → Leads (lead stages).

export interface LeadStage { id: string; name: string; sort_order: number; lead_count?: number }
export interface LeadTag { id: string; name: string; color?: string | null }

export interface Lead {
  id: string;
  reference_number: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  owner_user_id: string | null;
  owner_name: string | null;
  lead_source: string | null;
  lead_stage_id: string | null;
  lead_stage_name: string | null;
  messages_sent: number;
  tags: LeadTag[];
}

export interface LeadFilters {
  /** Column filters of the shared table. */
  columns?: Record<string, { values?: string[]; contains?: string; from?: string; to?: string }>;
  stage_id?: string;
  lead_source?: string;
  owner?: string;
  search?: string;
  archived?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export async function getLeads(businessId: string, filters: LeadFilters = {}) {
  const params = new URLSearchParams({ business_id: businessId });
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'columns') continue;
    if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
  }
  if (filters.columns && Object.keys(filters.columns).length) params.set('cf', JSON.stringify(filters.columns));
  const res = await apiClient.get(`/v1/leads?${params}`);
  return res.data as { data: Lead[]; meta: { page: number; total: number; totalPages: number; stages: LeadStage[]; timezone: string } };
}

export async function createLead(businessId: string, data: {
  first_name: string; last_name?: string; email?: string; phone?: string;
  lead_source?: string; lead_stage_id?: string; owner_user_id?: string; tag_ids?: string[];
}): Promise<Lead> {
  const res = await apiClient.post(`/v1/leads?business_id=${businessId}`, data);
  return res.data.data;
}

export async function updateLead(businessId: string, id: string, data: { lead_stage_id?: string; owner_user_id?: string | null; lead_source?: string | null }): Promise<Lead> {
  const res = await apiClient.patch(`/v1/leads/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function restoreLead(businessId: string, id: string): Promise<void> {
  await apiClient.put(`/v1/customers/${id}/reactivate?business_id=${businessId}`);
}

// --- Stages ---

export async function getStages(businessId: string): Promise<LeadStage[]> {
  const res = await apiClient.get(`/v1/leads/stages?business_id=${businessId}`);
  return res.data.data;
}

export async function addStage(businessId: string, name: string): Promise<LeadStage> {
  const res = await apiClient.post(`/v1/leads/stages?business_id=${businessId}`, { name });
  return res.data.data;
}

export async function renameStage(businessId: string, id: string, name: string): Promise<LeadStage> {
  const res = await apiClient.put(`/v1/leads/stages/${id}?business_id=${businessId}`, { name });
  return res.data.data;
}

export async function reorderStages(businessId: string, ids: string[]): Promise<LeadStage[]> {
  const res = await apiClient.put(`/v1/leads/stages/order?business_id=${businessId}`, { ids });
  return res.data.data;
}

export async function deleteStage(businessId: string, id: string, moveTo?: string): Promise<LeadStage[]> {
  const params = new URLSearchParams({ business_id: businessId });
  if (moveTo) params.set('move_to', moveTo);
  const res = await apiClient.delete(`/v1/leads/stages/${id}?${params}`);
  return res.data.data;
}

/** Every value of one Leads column (with counts) among the leads matching the other filters. */
export async function getLeadColumnValues(businessId: string, column: string, filters: LeadFilters = {}): Promise<Array<{ value: string; label: string; count: number }>> {
  const params = new URLSearchParams({ business_id: businessId, column });
  if (filters.search) params.set('search', filters.search);
  if (filters.archived) params.set('archived', 'true');
  if (filters.columns && Object.keys(filters.columns).length) params.set('cf', JSON.stringify(filters.columns));
  const res = await apiClient.get(`/v1/leads/column-values?${params}`);
  return res.data.data;
}
