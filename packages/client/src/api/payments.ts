import { apiClient } from './client';

/**
 * Payment Platform API client (spec phase 10). Wraps the /v1/pay endpoints:
 * processor connections, the shared tokenized payment-method vault, and the
 * method catalog / availability resolver.
 */

export type OwnerLevel = 'platform' | 'tenant' | 'business' | 'customer';
export type MethodType = 'card' | 'bank_draw' | 'google_pay' | 'apple_pay';

export interface PaymentMethod {
  id: string;
  owner_level: OwnerLevel;
  tenant_id: string | null;
  business_id: string | null;
  customer_id: string | null;
  method_type: MethodType;
  provider: string;
  display_brand: string | null;
  display_last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  status: string;
  created_at: string;
}

export interface ProcessorConnection {
  id: string;
  owner_level: OwnerLevel;
  tenant_id: string | null;
  business_id: string | null;
  provider: string;
  provider_account_ref: string | null;
  status: string;
}

export interface MethodOwnerParams {
  owner_level: OwnerLevel;
  tenant_id?: string | null;
  business_id?: string | null;
  customer_id?: string | null;
}

// --- Processor connections ---

export async function listProcessors(): Promise<ProcessorConnection[]> {
  const res = await apiClient.get('/v1/pay/processors');
  return res.data.data;
}

export async function connectProcessor(input: {
  owner_level: OwnerLevel;
  tenant_id?: string | null;
  business_id?: string | null;
  provider?: string;
  provider_account_ref?: string | null;
}): Promise<ProcessorConnection> {
  const res = await apiClient.post('/v1/pay/processors/connect', input);
  return res.data.data;
}

// --- Payment methods (shared tokenized vault) ---

export async function listPaymentMethods(owner: MethodOwnerParams): Promise<PaymentMethod[]> {
  const res = await apiClient.get('/v1/pay/methods', { params: owner });
  return res.data.data;
}

export type BankDebitSchemeId = 'sepa' | 'ach' | 'bacs';

export async function beginCaptureSession(
  owner: MethodOwnerParams, methodType: MethodType,
): Promise<{ provider: string; ownerLevel: OwnerLevel; sessionRef: string; clientSecret?: string; publishableKey?: string; debitScheme?: BankDebitSchemeId }> {
  const res = await apiClient.post('/v1/pay/methods/capture-session', { ...owner, method_type: methodType });
  return res.data.data;
}

/**
 * Store a captured method. `capturePayload` is the opaque result of the provider's
 * hosted capture (card element / mandate / wallet). With the mock adapter this can
 * be an empty object; it is tokenized server-side and never stored raw.
 */
export async function storePaymentMethod(
  owner: MethodOwnerParams, methodType: MethodType, capturePayload: Record<string, unknown> = {},
): Promise<PaymentMethod> {
  const res = await apiClient.post('/v1/pay/methods', {
    ...owner, method_type: methodType, capture_payload: capturePayload,
  });
  return res.data.data;
}

export async function setDefaultPaymentMethod(id: string, owner: MethodOwnerParams): Promise<void> {
  await apiClient.put(`/v1/pay/methods/${id}/default`, owner);
}

export async function removePaymentMethod(id: string, owner: MethodOwnerParams): Promise<void> {
  await apiClient.delete(`/v1/pay/methods/${id}`, { params: owner });
}

// --- Provider config schemas + per-connection configuration ---

export interface ProviderConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
  secret: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface ProviderDefinition {
  name: string;
  label: string;
  fields: ProviderConfigField[];
}

export interface SavedConfigView {
  provider: string;
  config: Record<string, string>;        // non-secret values
  secretsSet: Record<string, boolean>;   // which secret fields have a stored value
  secretsMasked: Record<string, string>; // masked display for set secrets
}

export async function getProviderSchemas(): Promise<ProviderDefinition[]> {
  const res = await apiClient.get('/v1/pay/providers');
  return res.data.data;
}

export async function getProcessorConfig(owner: MethodOwnerParams): Promise<SavedConfigView | null> {
  const res = await apiClient.get('/v1/pay/processors/config', { params: owner });
  return res.data.data;
}

export async function saveProcessorConfig(
  owner: { owner_level: OwnerLevel; tenant_id?: string | null; business_id?: string | null },
  provider: string, config: Record<string, string>,
): Promise<SavedConfigView> {
  const res = await apiClient.put('/v1/pay/processors/config', { ...owner, provider, config });
  return res.data.data;
}

export async function testProcessorConnection(
  owner: { owner_level: OwnerLevel; tenant_id?: string | null; business_id?: string | null },
  provider: string, config: Record<string, string>,
): Promise<{ ok: boolean; message: string; mode?: string }> {
  const res = await apiClient.post('/v1/pay/processors/test', { ...owner, provider, config });
  return res.data.data;
}

export interface ConnectionProbe {
  ok: boolean;
  message?: string;
  mode?: string;
  provider: string;
  publishableKey?: string;
  clientSecret?: string;
}

/**
 * Prepare an end-to-end connection probe. The server validates the secret key and
 * (for Stripe) returns a throwaway SetupIntent client_secret + the publishable key
 * for the browser to confirm, proving both keys work for real card capture.
 */
export async function prepareConnectionProbe(
  owner: { owner_level: OwnerLevel; tenant_id?: string | null; business_id?: string | null },
  provider: string, config: Record<string, string>,
): Promise<ConnectionProbe> {
  const res = await apiClient.post('/v1/pay/processors/test-probe', { ...owner, provider, config });
  return res.data.data;
}

// --- Catalog + availability ---

export interface MethodDefinition {
  method: string;
  klass: 'processed' | 'manual_record' | 'internal';
  recurringCapable: boolean;
  processed: boolean;
}

export async function getMethodCatalog(): Promise<MethodDefinition[]> {
  const res = await apiClient.get('/v1/pay/catalog');
  return res.data.data;
}

export async function getAvailableMethods(
  businessId: string, recurring: boolean,
): Promise<{ method: string; definition: MethodDefinition }[]> {
  const res = await apiClient.get('/v1/pay/available-methods', { params: { business_id: businessId, recurring } });
  return res.data.data;
}

// --- Section A: Platform Billing (DayStream → Tenant) ---

export interface TenantBillingPlan {
  id: string;
  tenant_id: string;
  version: number;
  flat_amount_cents: number;
  percentage_rate: string;
  cap_amount_cents: number | null;
  cap_applies_to: 'percentage' | 'combined';
  intro_period_months: number;
  intro_flat_amount_cents: number;
  intro_percentage_rate: string;
  billing_day: number;
  plan_start_date: string;
  effective_from: string;
  created_at: string;
}

export interface TenantBillingPlanInput {
  flatAmountCents: number;
  percentageRate: number;
  capAmountCents?: number | null;
  capAppliesTo?: 'percentage' | 'combined';
  introPeriodMonths?: number;
  introFlatAmountCents?: number;
  introPercentageRate?: number;
  billingDay: number;
  planStartDate?: string;
}

export interface PlatformBillingCharge {
  id: string;
  cycle_year: number;
  cycle_month: number;
  reference_number: string;
  flat_component_cents: number;
  net_collections_cents: number;
  percentage_rate: string;
  percentage_component_cents: number;
  cap_applied_cents: number | null;
  credit_applied_cents: number;
  amount_charged_cents: number;
  currency: string;
  status: 'zero' | 'pending' | 'settled' | 'failed' | 'retrying';
  provider_reference: string | null;
  failure_reason: string | null;
  attempts: number;
  last_attempt_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface TenantCredit {
  id: string;
  amount_cents: number;
  remaining_cents: number;
  reason: string;
  status: 'active' | 'exhausted';
  created_at: string;
}

export async function getTenantPlan(tenantId: string): Promise<TenantBillingPlan | null> {
  const res = await apiClient.get(`/v1/pay/platform-billing/${tenantId}/plan`);
  return res.data.data;
}

export async function saveTenantPlan(tenantId: string, input: TenantBillingPlanInput): Promise<TenantBillingPlan> {
  const res = await apiClient.put(`/v1/pay/platform-billing/${tenantId}/plan`, input);
  return res.data.data;
}

export interface TenantPlanVersion extends TenantBillingPlan {
  ended_at: string | null;
}

export async function getTenantPlanHistory(tenantId: string): Promise<TenantPlanVersion[]> {
  const res = await apiClient.get(`/v1/pay/platform-billing/${tenantId}/plan-history`);
  return res.data.data;
}

export interface AuditChange { field: string; from: unknown; to: unknown }

export interface TenantAuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: { changes?: AuditChange[]; [k: string]: unknown } | null;
  created_at: string;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
}

export async function getTenantAudit(
  tenantId: string, page = 1, limit = 25,
): Promise<{ entries: TenantAuditEntry[]; total: number; page: number; limit: number }> {
  const res = await apiClient.get(`/v1/pay/platform-billing/${tenantId}/audit`, { params: { page, limit } });
  return res.data.data;
}

export async function getTenantCharges(tenantId: string): Promise<{ charges: PlatformBillingCharge[]; creditBalance: number }> {
  const res = await apiClient.get(`/v1/pay/platform-billing/${tenantId}/charges`);
  return res.data.data;
}

export async function getTenantCredits(tenantId: string): Promise<TenantCredit[]> {
  const res = await apiClient.get(`/v1/pay/platform-billing/${tenantId}/credits`);
  return res.data.data;
}

export async function issueTenantCredit(tenantId: string, amountCents: number, reason: string): Promise<TenantCredit> {
  const res = await apiClient.post(`/v1/pay/platform-billing/${tenantId}/credits`, { amountCents, reason });
  return res.data.data;
}

export async function chargeTenantNow(
  tenantId: string, year: number, month: number, currency?: string,
): Promise<{ chargeId: string; referenceNumber: number; status: string; amountChargedCents: number; failureReason?: string }> {
  const res = await apiClient.post(`/v1/pay/platform-billing/${tenantId}/charge-now`, { year, month, currency });
  return res.data.data;
}

// --- Section A: platform-wide billing run schedule (A6) ---

export interface PlatformSchedule {
  enabled: boolean;
  scheduleTime: string;      // 'HH:MM'
  scheduleTimezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

export async function getPlatformSchedule(): Promise<PlatformSchedule | null> {
  const res = await apiClient.get('/v1/pay/platform-billing-schedule');
  return res.data.data;
}

export async function savePlatformSchedule(
  scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<PlatformSchedule> {
  const res = await apiClient.put('/v1/pay/platform-billing-schedule', { scheduleTime, scheduleTimezone, enabled });
  return res.data.data;
}

export async function runPlatformBillingNow(): Promise<{
  newCharges: number; retries: number; settled: number; pending: number; failed: number; skippedSuspended: number;
}> {
  const res = await apiClient.post('/v1/pay/platform-billing-run-now', {});
  return res.data.data;
}

// --- Section A: observability (job runs + platform-wide charges) ---

export interface PlatformBillingRun {
  id: string;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  durationMs: number | null;
  summary: {
    newCharges: number; retries: number; settled: number; pending: number; failed: number; skippedSuspended: number;
  } | null;
  error: string | null;
}

export interface PlatformWideCharge {
  id: string;
  tenant_id: string;
  tenant_name: string;
  cycle_year: number;
  cycle_month: number;
  reference_number: string;
  amount_charged_cents: number;
  currency: string;
  status: string;
  provider_reference: string | null;
  failure_reason: string | null;
  attempts: number;
  last_attempt_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface RunChargeAttempt {
  id: string;
  charge_id: string;
  tenant_id: string;
  tenant_name: string;
  cycle_year: number;
  cycle_month: number;
  outcome: string;
  amount_cents: number;
  currency: string;
  provider_reference: string | null;
  failure_reason: string | null;
  trigger: string;
  reference_number: string | null;
  created_at: string;
}

export async function getPlatformBillingRuns(
  from?: string, to?: string, limit = 200,
): Promise<PlatformBillingRun[]> {
  const res = await apiClient.get('/v1/pay/platform-billing-runs', { params: { from, to, limit } });
  return res.data.data;
}

export async function getRunCharges(runId: string): Promise<RunChargeAttempt[]> {
  const res = await apiClient.get(`/v1/pay/platform-billing-runs/${runId}/charges`);
  return res.data.data;
}

export async function getPlatformWideCharges(status?: string, limit = 100): Promise<PlatformWideCharge[]> {
  const res = await apiClient.get('/v1/pay/platform-billing-charges', { params: { status, limit } });
  return res.data.data;
}
