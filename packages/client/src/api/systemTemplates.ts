import { apiClient } from './client';
import type { DocumentArtifactType, DocumentBrandingTemplate, DocumentBrandingInput } from './payments';
import type { SystemForm, FormInput } from './forms';

/**
 * System templates (spec 51, gap 17): the platform's document templates, built by platform
 * administrators in System Configuration → Templates. Used by a business with no active template
 * of its own for the type.
 */
const BASE = '/v1/admin/system-config/document-templates';

export async function getSystemArtifactTypes(): Promise<DocumentArtifactType[]> {
  const res = await apiClient.get(`${BASE}/artifact-types`);
  return res.data.data;
}

export async function listSystemTemplates(artifactType?: string): Promise<DocumentBrandingTemplate[]> {
  const res = await apiClient.get(BASE, { params: artifactType ? { artifact_type: artifactType } : {} });
  return res.data.data;
}

export async function createSystemTemplate(artifactType: string, input: DocumentBrandingInput): Promise<DocumentBrandingTemplate> {
  const res = await apiClient.post(BASE, { artifact_type: artifactType, ...input });
  return res.data.data;
}

export async function updateSystemTemplate(id: string, input: DocumentBrandingInput): Promise<DocumentBrandingTemplate> {
  const res = await apiClient.put(`${BASE}/${id}`, input);
  return res.data.data;
}

export async function deleteSystemTemplate(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/${id}`);
}

// ---- System forms and chart templates, and the platform's check-in wording (criteria 8 and 9) ----

const CONFIG = '/v1/admin/system-config';

export async function listAdminSystemForms(kind: 'form' | 'chart'): Promise<SystemForm[]> {
  const res = await apiClient.get(`${CONFIG}/forms`, { params: { kind } });
  return res.data.data;
}

export async function createAdminSystemForm(kind: 'form' | 'chart', input: FormInput): Promise<SystemForm> {
  const { applies: _a, renew_after_months: _r, kind: _k, ...rest } = input;
  const res = await apiClient.post(`${CONFIG}/forms`, { ...rest, kind });
  return res.data.data;
}

export async function updateAdminSystemForm(id: string, input: FormInput): Promise<SystemForm> {
  const { applies: _a, renew_after_months: _r, kind: _k, ...rest } = input;
  const res = await apiClient.put(`${CONFIG}/forms/${id}`, rest);
  return res.data.data;
}

export async function deleteAdminSystemForm(id: string): Promise<void> {
  await apiClient.delete(`${CONFIG}/forms/${id}`);
}

export async function getSystemCheckInTexts(language: string): Promise<{ language: string; overrides: Record<string, string> }> {
  const res = await apiClient.get(`${CONFIG}/check-in-texts`, { params: { language } });
  return res.data.data;
}

export async function saveSystemCheckInTexts(language: string, texts: Record<string, string>): Promise<{ language: string; overrides: Record<string, string> }> {
  const res = await apiClient.put(`${CONFIG}/check-in-texts`, { language, texts });
  return res.data.data;
}
