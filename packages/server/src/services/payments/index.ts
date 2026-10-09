import { PaymentAdapter, PaymentProviderName, ConnectedAccount } from './adapter';
import { MockAdapter } from './mock-adapter';
import { StripeAdapter } from './stripe-adapter';

export * from './adapter';
export { MockAdapter } from './mock-adapter';
export { StripeAdapter } from './stripe-adapter';
export * from './provider-registry';
export * from './bank-debit-schemes';

/**
 * Adapter registry / factory.
 *
 * Resolves the PaymentAdapter for a given provider. Stripe is the intended first
 * real provider; until the Stripe SDK is wired to live credentials it resolves to
 * a MockAdapter so the billing layers can be built and tested. When the real
 * StripeAdapter lands, register it here — no billing-layer code changes.
 *
 * TODO(stripe): add `import { StripeAdapter } from './stripe-adapter'` and register
 * `stripe: new StripeAdapter(config)` once an account + keys are available.
 */
const adapters: Record<PaymentProviderName, PaymentAdapter> = {
  mock: new MockAdapter('mock'),
  // Stripe currently backed by the mock implementation (same interface, deterministic).
  stripe: new MockAdapter('stripe'),
};

export function getAdapter(provider: PaymentProviderName): PaymentAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`No payment adapter registered for provider: ${provider}`);
  return adapter;
}

/** Convenience: resolve the shared (connectionless) adapter for a connected account. */
export function getAdapterForAccount(account: ConnectedAccount): PaymentAdapter {
  return getAdapter(account.provider);
}

/**
 * Resolve a connection-aware adapter from provider credentials. When a real
 * Stripe secret key is present, returns a live StripeAdapter built from it;
 * otherwise falls back to the deterministic mock so flows still work pre-wiring.
 */
export function getConfiguredAdapter(
  provider: PaymentProviderName, secrets: Record<string, string>,
): PaymentAdapter {
  if (provider === 'stripe' && secrets.secret_key) {
    return new StripeAdapter(secrets.secret_key, secrets.webhook_secret);
  }
  return getAdapter(provider);
}
