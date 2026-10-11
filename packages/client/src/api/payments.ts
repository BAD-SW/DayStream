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

// ============================================================
// Section B — Tenant Billing (Tenant → Business). Mirror of Section A one level
// down, keyed on businessId. Tenant-admin scoped.
// ============================================================

export interface BusinessBillingPlan {
  id: string;
  business_id: string;
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

export interface BusinessBillingPlanInput {
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

export interface BusinessBillingCharge {
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

export interface BusinessCredit {
  id: string;
  amount_cents: number;
  remaining_cents: number;
  reason: string;
  status: 'active' | 'exhausted';
  created_at: string;
}

export async function getBusinessPlan(businessId: string): Promise<BusinessBillingPlan | null> {
  const res = await apiClient.get(`/v1/pay/tenant-billing/${businessId}/plan`);
  return res.data.data;
}

export async function saveBusinessPlan(businessId: string, input: BusinessBillingPlanInput): Promise<BusinessBillingPlan> {
  const res = await apiClient.put(`/v1/pay/tenant-billing/${businessId}/plan`, input);
  return res.data.data;
}

export interface BusinessPlanVersion extends BusinessBillingPlan {
  ended_at: string | null;
}

export async function getBusinessPlanHistory(businessId: string): Promise<BusinessPlanVersion[]> {
  const res = await apiClient.get(`/v1/pay/tenant-billing/${businessId}/plan-history`);
  return res.data.data;
}

export async function getBusinessAudit(
  businessId: string, page = 1, limit = 25,
): Promise<{ entries: TenantAuditEntry[]; total: number; page: number; limit: number }> {
  const res = await apiClient.get(`/v1/pay/tenant-billing/${businessId}/audit`, { params: { page, limit } });
  return res.data.data;
}

export async function getBusinessCharges(businessId: string): Promise<{ charges: BusinessBillingCharge[]; creditBalance: number }> {
  const res = await apiClient.get(`/v1/pay/tenant-billing/${businessId}/charges`);
  return res.data.data;
}

export async function getBusinessCredits(businessId: string): Promise<BusinessCredit[]> {
  const res = await apiClient.get(`/v1/pay/tenant-billing/${businessId}/credits`);
  return res.data.data;
}

export async function issueBusinessCredit(businessId: string, amountCents: number, reason: string): Promise<BusinessCredit> {
  const res = await apiClient.post(`/v1/pay/tenant-billing/${businessId}/credits`, { amountCents, reason });
  return res.data.data;
}

export async function chargeBusinessNow(
  businessId: string, year: number, month: number, currency?: string,
): Promise<{ chargeId: string; referenceNumber: number; status: string; amountChargedCents: number; failureReason?: string }> {
  const res = await apiClient.post(`/v1/pay/tenant-billing/${businessId}/charge-now`, { year, month, currency });
  return res.data.data;
}

// --- Section B: tenant billing run schedule (B6) ---

export async function getTenantSchedule(): Promise<PlatformSchedule | null> {
  const res = await apiClient.get('/v1/pay/tenant-billing-schedule');
  return res.data.data;
}

export async function saveTenantSchedule(
  scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<PlatformSchedule> {
  const res = await apiClient.put('/v1/pay/tenant-billing-schedule', { scheduleTime, scheduleTimezone, enabled });
  return res.data.data;
}

export async function runTenantBillingNow(): Promise<{
  newCharges: number; retries: number; settled: number; pending: number; failed: number; skippedSuspended: number;
}> {
  const res = await apiClient.post('/v1/pay/tenant-billing-run-now', {});
  return res.data.data;
}

// --- Section B: observability (job runs + tenant-wide business charges) ---

export interface BusinessWideCharge {
  id: string;
  business_id: string;
  business_name: string;
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

export interface BusinessRunChargeAttempt {
  id: string;
  charge_id: string;
  business_id: string;
  business_name: string;
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

export async function getTenantBillingRuns(
  from?: string, to?: string, limit = 200,
): Promise<PlatformBillingRun[]> {
  const res = await apiClient.get('/v1/pay/tenant-billing-runs', { params: { from, to, limit } });
  return res.data.data;
}

export async function getTenantRunCharges(runId: string): Promise<BusinessRunChargeAttempt[]> {
  const res = await apiClient.get(`/v1/pay/tenant-billing-runs/${runId}/charges`);
  return res.data.data;
}

export async function getBusinessWideCharges(status?: string, limit = 100): Promise<BusinessWideCharge[]> {
  const res = await apiClient.get('/v1/pay/tenant-billing-charges', { params: { status, limit } });
  return res.data.data;
}

// --- Section B: tenant's own receiving/billing bank account ---

export interface TenantBillingAccount {
  bank_name: string;
  account_holder: string;
  account_number: string;
  routing_number: string;
  iban: string;
  swift: string;
}

export async function getTenantBillingAccount(): Promise<TenantBillingAccount | null> {
  const res = await apiClient.get('/v1/pay/tenant-billing-account');
  return res.data.data;
}

export async function saveTenantBillingAccount(input: TenantBillingAccount): Promise<TenantBillingAccount> {
  const res = await apiClient.put('/v1/pay/tenant-billing-account', input);
  return res.data.data;
}

// ============================================================
// Section C — Customer → Business payments (spec phase 10, task 4.10)
// ============================================================

export type SectionCMethod =
  | 'cash' | 'card' | 'bank_draw' | 'bank_transfer' | 'check' | 'gift_card' | 'google_pay' | 'apple_pay' | 'other';

// --- One-time charges (C1) ---

export interface TakeChargeInput {
  business_id: string;
  customer_id: string;
  method: SectionCMethod;
  amount: number;                 // integer cents
  payment_method_id?: string | null;
  gift_card_code?: string | null;
  booking_id?: string | null;
  membership_id?: string | null;
  description?: string | null;
  check_number?: string | null;
}

export interface ChargeResult {
  transactionId: string;
  referenceNumber: string;
  status: 'completed' | 'pending' | 'failed';
  amountCents: number;
  method: SectionCMethod;
  isProcessed: boolean;
  providerReference?: string | null;
  giftCardBalanceCents?: number | null;
  bookingConfirmed?: boolean;
  failureReason?: string | null;
}

export async function takeCharge(input: TakeChargeInput): Promise<ChargeResult> {
  const res = await apiClient.post('/v1/pay/charges', input);
  return res.data.data;
}

// --- Transactions (ledger list) ---

export type PurposeLinkType = 'invoice' | 'order' | 'booking' | 'membership';

export interface PurposeLink {
  type: PurposeLinkType;
  id: string;           // invoice id, order id, booking id, or membership plan id
}

export interface PayTransaction {
  id: string;
  type: 'charge' | 'refund' | 'credit';
  status: string;
  amount: number;
  currency: string;
  payment_method: string;
  reference_number: string | null;
  description: string | null;
  is_processed: boolean;
  provider_reference: string | null;
  refund_of_id: string | null;
  /** Resolved "what is this payment for" label (e.g. "Invoice #1002", "Payment on account"). */
  purpose_label: string;
  /** Where the label links, if anywhere (invoice -> PDF, booking/membership -> page). */
  purpose_link: PurposeLink | null;
  customer_first_name?: string;
  customer_last_name?: string;
  created_at: string;
}

export interface TransactionListParams {
  business_id: string;
  customer_id?: string;
  type?: string;
  status?: string;
  payment_method?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export async function listTransactions(
  params: TransactionListParams,
): Promise<{ transactions: PayTransaction[]; meta: { total: number; page: number; limit: number } }> {
  const res = await apiClient.get('/v1/pay/transactions', { params });
  return { transactions: res.data.data, meta: res.data.meta };
}

// --- Refunds (C4) ---

export async function refundTransaction(
  businessId: string, transactionId: string, reason: string, amount?: number | null,
): Promise<any> {
  const res = await apiClient.post('/v1/pay/refunds', {
    business_id: businessId, transaction_id: transactionId, reason, amount: amount ?? null,
  });
  return res.data.data;
}

// --- Subscriptions (C2) ---

export async function createSubscription(input: {
  business_id: string; customer_id: string; plan_id: string; start_date: string; payment_method_id?: string | null;
}): Promise<any> {
  const res = await apiClient.post('/v1/pay/subscriptions', input);
  return res.data.data;
}

export async function cancelSubscription(id: string, businessId: string): Promise<void> {
  await apiClient.put(`/v1/pay/subscriptions/${id}/cancel`, { business_id: businessId });
}

// --- Accepted methods (per business) ---

export interface AcceptedMethod { method: string; enabled: boolean; }

export async function getAcceptedMethods(businessId: string): Promise<AcceptedMethod[]> {
  const res = await apiClient.get('/v1/pay/accepted-methods', { params: { business_id: businessId } });
  return res.data.data;
}

export async function setAcceptedMethods(businessId: string, methods: AcceptedMethod[]): Promise<AcceptedMethod[]> {
  const res = await apiClient.put('/v1/pay/accepted-methods', { business_id: businessId, methods });
  return res.data.data;
}

// --- Invoices (C5) ---

export type InvoiceItemType = 'service' | 'product' | 'membership' | 'package' | 'no_show_fee';

export interface InvoiceLineItemInput {
  description: string;
  quantity?: number;
  unit_price_cents: number;
  tax_cents?: number | null;
  item_type?: InvoiceItemType;
}

export interface Invoice {
  id: string;
  invoice_number: number;
  customer_id: string;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_email?: string;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'void';
  notes: string | null;
  line_items?: Array<{ id: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number }>;
}

export async function getInvoicingEnabled(businessId: string): Promise<boolean> {
  const res = await apiClient.get('/v1/pay/invoicing-enabled', { params: { business_id: businessId } });
  return res.data.data.enabled;
}

export async function setInvoicingEnabled(businessId: string, enabled: boolean): Promise<boolean> {
  const res = await apiClient.put('/v1/pay/invoicing-enabled', { business_id: businessId, enabled });
  return res.data.data.enabled;
}

export async function listInvoices(businessId: string, filters: { customerId?: string; status?: string } = {}): Promise<Invoice[]> {
  const res = await apiClient.get('/v1/pay/invoices', {
    params: { business_id: businessId, customer_id: filters.customerId, status: filters.status },
  });
  return res.data.data;
}

export async function getInvoice(id: string, businessId: string): Promise<Invoice> {
  const res = await apiClient.get(`/v1/pay/invoices/${id}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function issueInvoice(input: {
  business_id: string; customer_id: string; due_date: string; notes?: string | null; line_items: InvoiceLineItemInput[];
}): Promise<Invoice> {
  const res = await apiClient.post('/v1/pay/invoices', input);
  return res.data.data;
}

export async function settleInvoice(id: string, businessId: string, paymentMethodId: string): Promise<any> {
  const res = await apiClient.post(`/v1/pay/invoices/${id}/settle`, { business_id: businessId, payment_method_id: paymentMethodId });
  return res.data.data;
}

export async function voidInvoice(id: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/pay/invoices/${id}/void`, { business_id: businessId });
}

export async function emailInvoice(id: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/pay/invoices/${id}/email`, { business_id: businessId });
}

/** Fetch the invoice PDF as a blob (auth is a Bearer header, so this can't be a plain link). */
export async function fetchInvoicePdf(id: string, businessId: string): Promise<Blob> {
  const res = await apiClient.get(`/v1/pay/invoices/${id}/pdf`, {
    params: { business_id: businessId }, responseType: 'blob',
  });
  return res.data;
}

// --- Gift cards (C7) ---

export interface GiftCard {
  id: string;
  code: string;
  currency: string;
  initial_amount_cents: number;
  balance_cents: number;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string | null;
  status: 'active' | 'depleted' | 'expired' | 'void';
  created_at: string;
  redemptions?: Array<{ id: string; amount: number; currency: string; reference_number: string | null; created_at: string }>;
}

export async function listGiftCards(businessId: string, status?: string): Promise<GiftCard[]> {
  const res = await apiClient.get('/v1/pay/gift-cards', { params: { business_id: businessId, status } });
  return res.data.data;
}

export async function createGiftCard(input: {
  business_id: string; amount: number; recipient_email?: string | null; recipient_name?: string | null;
  purchaser_customer_id?: string | null; expires_at?: string | null;
}): Promise<GiftCard> {
  const res = await apiClient.post('/v1/pay/gift-cards', input);
  return res.data.data;
}

export async function lookupGiftCard(code: string, businessId: string): Promise<{ id: string; code: string; currency: string; balance_cents: number; expires_at: string | null; status: string }> {
  const res = await apiClient.get('/v1/pay/gift-cards/lookup', { params: { code, business_id: businessId } });
  return res.data.data;
}

export async function getGiftCard(id: string, businessId: string): Promise<GiftCard> {
  const res = await apiClient.get(`/v1/pay/gift-cards/${id}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function voidGiftCard(id: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/pay/gift-cards/${id}/void`, { business_id: businessId });
}

export async function emailGiftCard(id: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/pay/gift-cards/${id}/email`, { business_id: businessId });
}

// --- Vouchers (C8) ---

export interface Voucher {
  id: string;
  code: string;
  discount_type: 'free' | 'fixed' | 'percentage';
  discount_value: number | null;
  applies_to: { serviceIds?: string[]; categoryIds?: string[] } | null;
  single_use: boolean;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  status: 'active' | 'expired' | 'void';
  created_at: string;
}

export async function listVouchers(businessId: string, status?: string): Promise<Voucher[]> {
  const res = await apiClient.get('/v1/pay/vouchers', { params: { business_id: businessId, status } });
  return res.data.data;
}

export async function createVoucher(input: {
  business_id: string; discount_type: 'free' | 'fixed' | 'percentage'; discount_value?: number | null;
  applies_to?: { serviceIds?: string[]; categoryIds?: string[] } | null;
  single_use?: boolean; max_redemptions?: number | null; expires_at?: string | null;
}): Promise<Voucher> {
  const res = await apiClient.post('/v1/pay/vouchers', input);
  return res.data.data;
}

export async function validateVoucher(input: {
  business_id: string; code: string; service_id?: string | null; category_id?: string | null; amount: number;
}): Promise<{ valid: boolean; reason?: string; voucherId?: string; code?: string; discountType?: string; discountCents?: number }> {
  const res = await apiClient.post('/v1/pay/vouchers/validate', input);
  return res.data.data;
}

export async function voidVoucher(id: string, businessId: string): Promise<void> {
  await apiClient.post(`/v1/pay/vouchers/${id}/void`, { business_id: businessId });
}

// --- Business recurring-billing run schedule (C6a) ---

export interface BusinessBillingSchedule {
  enabled: boolean;
  scheduleTime: string;
  scheduleTimezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

export async function getBusinessBillingSchedule(businessId: string): Promise<BusinessBillingSchedule | null> {
  const res = await apiClient.get('/v1/pay/billing-schedule', { params: { business_id: businessId } });
  return res.data.data;
}

export async function saveBusinessBillingSchedule(
  businessId: string, scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<BusinessBillingSchedule> {
  const res = await apiClient.put('/v1/pay/billing-schedule', {
    business_id: businessId, scheduleTime, scheduleTimezone, enabled,
  });
  return res.data.data;
}

export async function runBusinessBillingNow(businessId: string): Promise<any> {
  const res = await apiClient.post('/v1/pay/billing-run-now', { business_id: businessId });
  return res.data.data;
}
// --- Customer account credit (unapplied payments) ---

export interface AccountCreditBalance {
  customerId: string;
  currency: string | null;
  availableCents: number;
}

export interface AccountCreditRow {
  id: string;
  source_transaction_id: string | null;
  currency: string;
  original_cents: number;
  remaining_cents: number;
  status: 'available' | 'applied' | 'refunded';
  note: string | null;
  created_at: string;
}

export async function getAccountCredit(
  businessId: string, customerId: string,
): Promise<{ balance: AccountCreditBalance; credits: AccountCreditRow[] }> {
  const res = await apiClient.get('/v1/pay/account-credit', {
    params: { business_id: businessId, customer_id: customerId },
  });
  return res.data.data;
}

export interface ApplyCreditResult {
  invoiceId: string;
  appliedCents: number;
  invoiceStatus: string;
  transactionId: string;
  referenceNumber: string;
  remainingCreditCents: number;
  invoiceOutstandingCents: number;
}

export async function applyAccountCredit(
  businessId: string, invoiceId: string, amount?: number | null,
): Promise<ApplyCreditResult> {
  const res = await apiClient.post('/v1/pay/account-credit/apply', {
    business_id: businessId, invoice_id: invoiceId, amount: amount ?? null,
  });
  return res.data.data;
}
