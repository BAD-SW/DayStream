import { apiClient } from './client';
import type { FormDefinition, FormApplies } from '@daystream/shared';

/** A form a business builds (spec 51, gap 1). One entry per language version. */
export interface Form {
  id: string;
  businessId: string;
  groupId: string;
  name: string;
  language: string | null;
  definition: FormDefinition;
  version: number;
  applies: FormApplies;
  renewAfterMonths: number | null;
  isActive: boolean;
  status: 'active' | 'archived';
  signed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FormInput {
  name?: string;
  language?: string | null;
  definition?: FormDefinition;
  applies?: FormApplies;
  renew_after_months?: number | null;
  is_active?: boolean;
}

export async function listForms(businessId: string): Promise<Form[]> {
  const res = await apiClient.get('/v1/forms', { params: { business_id: businessId } });
  return res.data.data;
}

export async function createForm(businessId: string, input: FormInput): Promise<Form> {
  const res = await apiClient.post('/v1/forms', { business_id: businessId, ...input });
  return res.data.data;
}

export async function updateForm(businessId: string, id: string, input: FormInput): Promise<Form> {
  const res = await apiClient.put(`/v1/forms/${id}`, { business_id: businessId, ...input });
  return res.data.data;
}

export async function deleteForm(businessId: string, id: string): Promise<void> {
  await apiClient.delete(`/v1/forms/${id}`, { data: { business_id: businessId } });
}

export async function duplicateForm(businessId: string, id: string): Promise<Form> {
  const res = await apiClient.post(`/v1/forms/${id}/duplicate`, { business_id: businessId });
  return res.data.data;
}

export async function addFormLanguageVersion(businessId: string, id: string, language: string): Promise<Form> {
  const res = await apiClient.post(`/v1/forms/${id}/language-versions`, { business_id: businessId, language });
  return res.data.data;
}

// --- A customer's forms, for staff ---

export type FormStatus = 'optional' | 'not_needed' | 'done' | 'missing' | 'out_of_date';

export interface CustomerFormStatus {
  groupId: string;
  name: string;
  signed: boolean;
  languages: (string | null)[];
  renewAfterMonths: number | null;
  status: FormStatus;
  lastCompletedAt: string | null;
  lastSubmissionId: string | null;
}

export interface FormSubmission {
  id: string;
  groupId: string;
  formName: string;
  formVersion: number;
  language: string | null;
  completedVia: 'device' | 'link' | 'staff';
  signed: boolean;
  signedAt: string | null;
  createdAt: string;
  sizeBytes: number;
}

export interface CreatedFormRequest {
  requestId: string;
  channel: 'device' | 'email';
  /** The page to open on this device; only set for a device session. */
  url: string | null;
  expiresAt: string;
  emailedTo: string | null;
}

export async function getCustomerForms(
  customerId: string, businessId: string, bookingId?: string, serviceId?: string,
): Promise<{ forms: CustomerFormStatus[]; submissions: FormSubmission[] }> {
  const res = await apiClient.get(`/v1/customers/${customerId}/forms`, {
    params: {
      business_id: businessId,
      ...(bookingId ? { booking_id: bookingId } : {}),
      ...(serviceId ? { service_id: serviceId } : {}),
    },
  });
  return res.data.data;
}

export async function startFormRequest(
  customerId: string, businessId: string,
  input: { group_id: string; channel: 'device' | 'email'; booking_id?: string | null },
): Promise<CreatedFormRequest> {
  const res = await apiClient.post(`/v1/customers/${customerId}/forms/requests`, { business_id: businessId, ...input });
  return res.data.data;
}

export async function completeFormForCustomer(
  customerId: string, businessId: string,
  input: { group_id: string; language?: string | null; answers: Record<string, unknown>; booking_id?: string | null },
): Promise<{ submissionId: string }> {
  const res = await apiClient.post(`/v1/customers/${customerId}/forms/submissions`, { business_id: businessId, ...input });
  return res.data.data;
}

export async function fetchSubmissionPdf(customerId: string, businessId: string, submissionId: string): Promise<Blob> {
  const res = await apiClient.get(`/v1/customers/${customerId}/forms/submissions/${submissionId}/file`, {
    params: { business_id: businessId }, responseType: 'blob',
  });
  return res.data;
}

export async function emailSubmissionCopy(customerId: string, businessId: string, submissionId: string): Promise<{ sentTo: string }> {
  const res = await apiClient.post(`/v1/customers/${customerId}/forms/submissions/${submissionId}/email`, { business_id: businessId });
  return res.data.data;
}

/** How many forms each booking's customer still needs (missing or out of date). Information only. */
export interface OutstandingForms {
  count: number;
  forms: { groupId: string; name: string; status: 'missing' | 'out_of_date' }[];
}

export async function getOutstandingForms(businessId: string, bookingIds: string[]): Promise<Record<string, OutstandingForms>> {
  if (bookingIds.length === 0) return {};
  const res = await apiClient.get('/v1/forms/outstanding', {
    params: { business_id: businessId, booking_ids: bookingIds.join(',') },
  });
  return res.data.data;
}
