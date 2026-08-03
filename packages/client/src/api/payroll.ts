import { apiClient } from './client';

// --- Compensation ---
export async function getCompensationRules(businessId: string, userId?: string) {
  const params = new URLSearchParams({ business_id: businessId });
  if (userId) params.set('user_id', userId);
  const res = await apiClient.get(`/v1/payroll/compensation-rules?${params}`);
  return res.data.data;
}

export async function createCompensationRule(data: any) {
  const res = await apiClient.post('/v1/payroll/compensation-rules', data);
  return res.data.data;
}

export async function updateCompensationRule(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/payroll/compensation-rules/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deleteCompensationRule(id: string, businessId: string) {
  await apiClient.delete(`/v1/payroll/compensation-rules/${id}?business_id=${businessId}`);
}

// --- Time Entries ---
export async function getTimeEntries(businessId: string, filters?: { user_id?: string }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.user_id) params.set('user_id', filters.user_id);
  const res = await apiClient.get(`/v1/payroll/time-entries?${params}`);
  return res.data.data;
}

export async function createTimeEntry(data: any) {
  const res = await apiClient.post('/v1/payroll/time-entries', data);
  return res.data.data;
}

export async function approveTimeEntry(id: string) {
  const res = await apiClient.put(`/v1/payroll/time-entries/${id}/approve`);
  return res.data.data;
}

// --- Pay Periods ---
export async function getPayPeriods(businessId: string) {
  const res = await apiClient.get(`/v1/payroll/periods?business_id=${businessId}`);
  return res.data.data;
}

export async function openPayPeriod(data: { business_id: string; period_start: string; period_end: string }) {
  const res = await apiClient.post('/v1/payroll/periods', data);
  return res.data.data;
}

export async function runPayroll(periodId: string, businessId: string) {
  const res = await apiClient.post(`/v1/payroll/periods/${periodId}/run?business_id=${businessId}`);
  return res.data.data;
}

export async function finalizePayroll(periodId: string, businessId: string) {
  const res = await apiClient.put(`/v1/payroll/periods/${periodId}/finalize?business_id=${businessId}`);
  return res.data.data;
}

export async function getPayrollEntries(periodId: string) {
  const res = await apiClient.get(`/v1/payroll/periods/${periodId}/entries`);
  return res.data.data;
}

// --- Deductions ---
export async function getDeductions(businessId: string, userId?: string) {
  const params = new URLSearchParams({ business_id: businessId });
  if (userId) params.set('user_id', userId);
  const res = await apiClient.get(`/v1/payroll/deductions?${params}`);
  return res.data.data;
}

export async function createDeduction(data: any) {
  const res = await apiClient.post('/v1/payroll/deductions', data);
  return res.data.data;
}

export async function updateDeduction(id: string, data: any) {
  const res = await apiClient.put(`/v1/payroll/deductions/${id}`, data);
  return res.data.data;
}

export async function deleteDeduction(id: string) {
  await apiClient.delete(`/v1/payroll/deductions/${id}`);
}

// --- Tax Documents ---
export async function generateTaxDocuments(businessId: string, taxYear: number) {
  const res = await apiClient.post(`/v1/payroll/tax-documents/generate?business_id=${businessId}`, { tax_year: taxYear });
  return res.data.data;
}

export async function getTaxDocuments(businessId: string, taxYear?: number) {
  const params = new URLSearchParams({ business_id: businessId });
  if (taxYear) params.set('tax_year', String(taxYear));
  const res = await apiClient.get(`/v1/payroll/tax-documents?${params}`);
  return res.data.data;
}
