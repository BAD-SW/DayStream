import { apiClient } from './client';

export interface MembershipPlan {
  id: string;
  name: string;
  plan_type: string;
  billing_cycle: string;
  price: number;
  credits_per_cycle?: number;
  total_sessions?: number;
  status: string;
}

export interface Membership {
  id: string;
  plan_name: string;
  plan_type: string;
  status: string;
  credit_balance: number;
  start_date: string;
  next_billing_date?: string;
  first_name: string;
  last_name: string;
}

// Plans
export async function getPlans(businessId: string) {
  const res = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}`);
  return res.data.data;
}

export async function createPlan(data: any) {
  const res = await apiClient.post('/v1/memberships/plans', data);
  return res.data.data;
}

export async function getPlan(id: string, businessId: string) {
  const res = await apiClient.get(`/v1/memberships/plans/${id}?business_id=${businessId}`);
  return res.data.data;
}

export async function archivePlan(id: string, businessId: string) {
  await apiClient.put(`/v1/memberships/plans/${id}/archive?business_id=${businessId}`);
}

// Memberships
export async function getMemberships(businessId: string, filters?: { status?: string; page?: number }) {
  const params = new URLSearchParams({ business_id: businessId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.page) params.set('page', String(filters.page));
  const res = await apiClient.get(`/v1/memberships?${params}`);
  return res.data;
}

export async function getMembership(id: string, businessId: string) {
  const res = await apiClient.get(`/v1/memberships/${id}?business_id=${businessId}`);
  return res.data.data;
}

export async function createMembership(data: { business_id: string; customer_id: string; plan_id: string }) {
  const res = await apiClient.post('/v1/memberships', data);
  return res.data.data;
}

export async function cancelMembership(id: string, businessId: string, reason?: string) {
  await apiClient.put(`/v1/memberships/${id}/cancel?business_id=${businessId}`, { reason });
}

export async function pauseMembership(id: string, businessId: string, pauseDays: number) {
  const res = await apiClient.put(`/v1/memberships/${id}/pause?business_id=${businessId}`, { pause_days: pauseDays });
  return res.data.data;
}

export async function resumeMembership(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/memberships/${id}/resume?business_id=${businessId}`);
  return res.data.data;
}

export async function upgradeMembership(id: string, businessId: string, planId: string) {
  const res = await apiClient.put(`/v1/memberships/${id}/upgrade?business_id=${businessId}`, { plan_id: planId });
  return res.data.data;
}

// Credits
export async function getCredits(membershipId: string) {
  const res = await apiClient.get(`/v1/memberships/${membershipId}/credits`);
  return res.data.data;
}

// Family
export async function getFamilyMembers(membershipId: string) {
  const res = await apiClient.get(`/v1/memberships/${membershipId}/members`);
  return res.data.data;
}

export async function addFamilyMember(membershipId: string, businessId: string, customerId: string) {
  const res = await apiClient.post(`/v1/memberships/${membershipId}/members?business_id=${businessId}`, { customer_id: customerId });
  return res.data.data;
}

export async function removeFamilyMember(membershipId: string, customerId: string) {
  await apiClient.delete(`/v1/memberships/${membershipId}/members/${customerId}`);
}

// Credit management
export async function adjustCredits(membershipId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/memberships/${membershipId}/credits/adjust`, data); return res.data.data;
}
export async function deductCredits(membershipId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/memberships/${membershipId}/credits/deduct`, data); return res.data.data;
}
export async function restoreCredits(membershipId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/memberships/${membershipId}/credits/restore`, data); return res.data.data;
}

// Downgrade
export async function downgradeMembership(id: string, businessId: string, planId: string) {
  const res = await apiClient.put(`/v1/memberships/${id}/downgrade?business_id=${businessId}`, { plan_id: planId });
  return res.data.data;
}

// Reports
export async function getSummaryReport(businessId: string) {
  const res = await apiClient.get(`/v1/memberships/reports/summary?business_id=${businessId}`);
  return res.data.data;
}

export async function getChurnReport(businessId: string) {
  const res = await apiClient.get(`/v1/memberships/reports/churn?business_id=${businessId}`);
  return res.data.data;
}

export async function getCreditReport(businessId: string) {
  const res = await apiClient.get(`/v1/memberships/reports/credits?business_id=${businessId}`);
  return res.data.data;
}
