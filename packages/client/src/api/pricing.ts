import { apiClient } from './client';

// --- Types ---

export interface PriceBreakdown {
  base_price: number;
  discounts: Array<{ rule_name: string; rule_type: string; amount: number }>;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  currency: string;
  discount_code_applied?: string;
  savings: number;
}

export interface PricingRule {
  id: string;
  name: string;
  rule_type: string;
  discount_type: string;
  discount_value: number;
  priority: number;
  stacking_mode: string;
  status: string;
  effective_from?: string;
  effective_to?: string;
}

export interface DiscountCode {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  current_uses: number;
  max_total_uses?: number;
  status: string;
}

export interface PricingBundle {
  id: string;
  name: string;
  bundle_type: string;
  bundle_price?: number;
  discount_percentage?: number;
  items: any[];
}

// --- Price Calculation ---

export async function calculatePrice(data: { business_id: string; items: Array<{ variant_id: string }>; customer_id?: string; discount_code?: string; booking_datetime?: string }): Promise<PriceBreakdown> {
  const res = await apiClient.post('/v1/pricing/calculate', data);
  return res.data.data;
}

// --- Rules ---

export async function getRules(businessId: string, ruleType?: string): Promise<PricingRule[]> {
  const params = new URLSearchParams({ business_id: businessId });
  if (ruleType) params.set('rule_type', ruleType);
  const res = await apiClient.get(`/v1/pricing/rules?${params}`);
  return res.data.data;
}

export async function createRule(data: any) {
  const res = await apiClient.post('/v1/pricing/rules', data);
  return res.data.data;
}

export async function updateRule(id: string, businessId: string, data: any) {
  const res = await apiClient.put(`/v1/pricing/rules/${id}?business_id=${businessId}`, data);
  return res.data.data;
}

export async function deleteRule(id: string, businessId: string) {
  await apiClient.delete(`/v1/pricing/rules/${id}?business_id=${businessId}`);
}

// --- Discount Codes ---

export async function getCodes(businessId: string): Promise<DiscountCode[]> {
  const res = await apiClient.get(`/v1/pricing/codes?business_id=${businessId}`);
  return res.data.data;
}

export async function createCode(data: any) {
  const res = await apiClient.post('/v1/pricing/codes', data);
  return res.data.data;
}

export async function validateCode(data: { code: string; business_id: string; customer_id?: string }) {
  const res = await apiClient.post('/v1/pricing/codes/validate', data);
  return res.data.data;
}

export async function bulkGenerateCodes(data: { business_id: string; count: number; prefix: string; discount_type: string; discount_value: number }) {
  const res = await apiClient.post('/v1/pricing/codes/bulk', data);
  return res.data.data;
}

export async function deactivateCode(id: string, businessId: string) {
  const res = await apiClient.put(`/v1/pricing/codes/${id}?business_id=${businessId}`, { status: 'inactive' });
  return res.data.data;
}

// --- Bundles ---

export async function getBundles(businessId: string): Promise<PricingBundle[]> {
  const res = await apiClient.get(`/v1/pricing/bundles?business_id=${businessId}`);
  return res.data.data;
}

export async function createBundle(data: any) {
  const res = await apiClient.post('/v1/pricing/bundles', data);
  return res.data.data;
}

export async function updateBundle(id: string, data: any) {
  const res = await apiClient.put(`/v1/pricing/bundles/${id}`, data);
  return res.data.data;
}

export async function deleteBundle(id: string) {
  await apiClient.delete(`/v1/pricing/bundles/${id}`);
}

// --- Corporate ---

export async function getCorporateAccounts(businessId: string) {
  const res = await apiClient.get(`/v1/pricing/corporate?business_id=${businessId}`);
  return res.data.data;
}

export async function createCorporateAccount(data: any) {
  const res = await apiClient.post('/v1/pricing/corporate', data);
  return res.data.data;
}

export async function getCorporateMembers(corporateId: string) {
  const res = await apiClient.get(`/v1/pricing/corporate/${corporateId}/members`);
  return res.data.data;
}

export async function addCorporateMember(corporateId: string, data: { customer_id: string }) {
  const res = await apiClient.post(`/v1/pricing/corporate/${corporateId}/members`, data);
  return res.data.data;
}

export async function removeCorporateMember(corporateId: string, customerId: string) {
  await apiClient.delete(`/v1/pricing/corporate/${corporateId}/members/${customerId}`);
}

// --- History ---

export async function getPriceHistory(businessId: string) {
  const res = await apiClient.get(`/v1/pricing/history?business_id=${businessId}`);
  return res.data;
}
