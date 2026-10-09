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
