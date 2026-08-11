import { apiClient } from './client';

// --- Vendors ---
export async function getVendors(businessId: string) {
  const res = await apiClient.get(`/v1/ap/vendors?business_id=${businessId}`);
  return res.data.data;
}
export async function createVendor(data: any) {
  const res = await apiClient.post('/v1/ap/vendors', data);
  return res.data.data;
}
export async function updateVendor(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/ap/vendors/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

// --- Bills ---
export async function getBills(businessId: string, filters?: { status?: string }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  const res = await apiClient.get(`/v1/ap/bills?${params}`);
  return res.data.data;
}
export async function createBill(data: any) {
  const res = await apiClient.post('/v1/ap/bills', data);
  return res.data.data;
}
export async function updateBill(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/ap/bills/${id}?business_id=${businessId}`, data);
  return res.data.data;
}
export async function approveBill(id: string, businessId: string) {
  await apiClient.put(`/v1/ap/bills/${id}/approve?business_id=${businessId}`);
}
export async function payBill(id: string, businessId: string, data: { amount: number; payment_date?: string; payment_method?: string; reference?: string }) {
  const res = await apiClient.put(`/v1/ap/bills/${id}/pay?business_id=${businessId}`, data);
  return res.data.data;
}

// --- Expenses ---
export async function getExpenses(businessId: string) {
  const res = await apiClient.get(`/v1/ap/expenses?business_id=${businessId}`);
  return res.data.data;
}
export async function createExpense(data: any) {
  const res = await apiClient.post('/v1/ap/expenses', data);
  return res.data.data;
}
export async function updateExpense(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/ap/expenses/${id}?business_id=${businessId}`, data);
  return res.data.data;
}
export async function deleteExpense(id: string, businessId: string) {
  await apiClient.delete(`/v1/ap/expenses/${id}?business_id=${businessId}`);
}
export async function approveExpense(id: string, businessId: string) {
  await apiClient.put(`/v1/ap/expenses/${id}/approve?business_id=${businessId}`);
}

// --- Chart of Accounts ---
export async function getAccounts(businessId: string) {
  const res = await apiClient.get(`/v1/ap/accounts?business_id=${businessId}`);
  return res.data.data;
}
export async function createAccount(data: any) {
  const res = await apiClient.post('/v1/ap/accounts', data);
  return res.data.data;
}
export async function updateAccount(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/ap/accounts/${id}?business_id=${businessId}`, data);
  return res.data.data;
}
export async function archiveAccount(id: string, businessId: string) {
  await apiClient.put(`/v1/ap/accounts/${id}/archive?business_id=${businessId}`);
}
export async function unarchiveAccount(id: string, businessId: string) {
  await apiClient.put(`/v1/ap/accounts/${id}/unarchive?business_id=${businessId}`);
}
export async function seedAccounts(businessId: string) {
  await apiClient.post(`/v1/ap/accounts/seed?business_id=${businessId}`);
}

// --- Journal ---
export async function getJournalEntries(businessId: string, filters?: { date_from?: string; date_to?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/ap/journal?${params}`);
  return res.data;
}
export async function createJournalEntry(data: any) {
  const res = await apiClient.post('/v1/ap/journal', data);
  return res.data.data;
}
export async function voidJournalEntry(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/ap/journal/${id}/void?business_id=${businessId}`);
  return res.data.data;
}

// --- Reports ---
export async function getPnL(businessId: string, dateFrom: string, dateTo: string) {
  const res = await apiClient.get(`/v1/ap/reports/pnl?business_id=${businessId}&date_from=${dateFrom}&date_to=${dateTo}`);
  return res.data.data;
}
export async function getStaffCosts(businessId: string, dateFrom: string, dateTo: string) {
  const res = await apiClient.get(`/v1/ap/reports/staff-costs?business_id=${businessId}&date_from=${dateFrom}&date_to=${dateTo}`);
  return res.data.data;
}
export async function getAPAging(businessId: string) {
  const res = await apiClient.get(`/v1/ap/reports/ap-aging?business_id=${businessId}`);
  return res.data.data;
}
export async function getExpenseReport(businessId: string, dateFrom: string, dateTo: string) {
  const res = await apiClient.get(`/v1/ap/reports/expenses?business_id=${businessId}&date_from=${dateFrom}&date_to=${dateTo}`);
  return res.data.data;
}

// --- Bank Reconciliation ---
export async function importStatement(businessId: string, accountName: string, statementDate: string, lines: any[]) {
  const res = await apiClient.post('/v1/ap/reconciliation/import', { business_id: businessId, account_name: accountName, statement_date: statementDate, lines });
  return res.data.data;
}
export async function getStatementDetails(statementId: string) {
  const res = await apiClient.get(`/v1/ap/reconciliation/${statementId}`);
  return res.data.data;
}
export async function matchReconciliationLine(lineId: string, journalEntryId: string) {
  const res = await apiClient.put(`/v1/ap/reconciliation/${lineId}/match`, { journal_entry_id: journalEntryId });
  return res.data.data;
}
