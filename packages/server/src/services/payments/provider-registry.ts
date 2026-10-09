import { PaymentProviderName } from './adapter';

/**
 * Provider configuration registry (spec phase 10, Phase 1 UI correction).
 *
 * Each provider declares the config fields it needs. The UI renders a form from
 * this schema; the server validates required fields and encrypts the ones marked
 * `secret`. Adding a new provider = adding an entry here (single source of truth).
 */

export type ConfigFieldType = 'text' | 'password' | 'select';

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required: boolean;
  secret: boolean;                 // encrypted at rest; masked on read
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];   // for type 'select'
}

export interface ProviderDefinition {
  name: PaymentProviderName;
  label: string;
  fields: ConfigField[];
}

/**
 * Supported providers and their config schemas. Fields cover the required and
 * most common settings; `required` and `secret` are flagged per field.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  stripe: {
    name: 'stripe',
    label: 'Stripe',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', required: true, secret: false,
        options: [{ value: 'test', label: 'Test' }, { value: 'live', label: 'Live' }],
        help: 'Use Test while validating; switch to Live to accept real payments.' },
      { key: 'publishable_key', label: 'Publishable Key', type: 'text', required: true, secret: false,
        placeholder: 'pk_test_… / pk_live_…', help: 'Safe to expose to the browser.' },
      { key: 'secret_key', label: 'Secret Key', type: 'password', required: true, secret: true,
        placeholder: 'sk_test_… / sk_live_…', help: 'Stored encrypted; used server-side only.' },
      { key: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password', required: false, secret: true,
        placeholder: 'whsec_…', help: 'Used to verify incoming Stripe webhooks.' },
      { key: 'account_id', label: 'Account ID', type: 'text', required: false, secret: false,
        placeholder: 'acct_…', help: 'The provider account this connection represents.' },
    ],
  },
};

export function getProviderDefinition(provider: string): ProviderDefinition | null {
  return PROVIDER_REGISTRY[provider] ?? null;
}

export function listProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** The secret field keys for a provider (which values get encrypted). */
export function secretKeysFor(provider: string): string[] {
  return (PROVIDER_REGISTRY[provider]?.fields ?? []).filter((f) => f.secret).map((f) => f.key);
}

/** Required field keys for a provider (for validation). */
export function requiredKeysFor(provider: string): string[] {
  return (PROVIDER_REGISTRY[provider]?.fields ?? []).filter((f) => f.required).map((f) => f.key);
}
