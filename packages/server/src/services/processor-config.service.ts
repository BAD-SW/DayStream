import { adminPool } from '../db/pool';
import { encrypt, decrypt } from '../utils/encryption';
import {
  getProviderDefinition, secretKeysFor, requiredKeysFor, listProviders, ProviderDefinition,
} from './payments/provider-registry';
import { getConfiguredAdapter } from './payments';

/**
 * Processor configuration service (spec phase 10, Phase 1 UI correction).
 *
 * Stores per-connection provider configuration: non-secret fields in
 * pay_processor_connections.config_json, secret fields encrypted (AES-256-GCM via
 * utils/encryption) in secrets_encrypted. Secrets are NEVER returned in the clear;
 * reads return masked placeholders so the UI can show "configured" without exposing
 * the value.
 */

export type OwnerLevel = 'platform' | 'tenant' | 'business';

export interface ConfigOwner {
  ownerLevel: OwnerLevel;
  tenantId?: string | null;
  businessId?: string | null;
}

export interface SavedConfigView {
  provider: string;
  config: Record<string, string>;        // non-secret values (as stored)
  secretsSet: Record<string, boolean>;   // which secret fields have a value stored
  secretsMasked: Record<string, string>; // masked display for set secrets (e.g. '••••1234')
}

function ownerFilter(owner: ConfigOwner): { clause: string; params: any[] } {
  if (owner.ownerLevel === 'platform') return { clause: `owner_level = 'platform'`, params: [] };
  if (owner.ownerLevel === 'tenant') return { clause: `owner_level = 'tenant' AND tenant_id = $1`, params: [owner.tenantId] };
  return { clause: `owner_level = 'business' AND business_id = $1`, params: [owner.businessId] };
}

function maskSecret(value: string): string {
  if (!value) return '';
  const tail = value.slice(-4);
  return `••••${tail}`;
}

/** List providers + their config field schemas (no secret values). */
export function getProviderSchemas(): ProviderDefinition[] {
  return listProviders();
}

/**
 * Save a connection's provider configuration. Validates required fields, encrypts
 * secret fields, and preserves an existing secret when the client submits a blank
 * (so re-saving the form without re-typing a secret doesn't wipe it).
 */
export async function saveProcessorConfig(
  owner: ConfigOwner, provider: string, submitted: Record<string, string>, userId: string,
): Promise<SavedConfigView> {
  const def = getProviderDefinition(provider);
  if (!def) throw Object.assign(new Error(`Unknown provider: ${provider}`), { code: 'UNKNOWN_PROVIDER' });

  const secretKeys = new Set(secretKeysFor(provider));
  const { clause, params } = ownerFilter(owner);

  // Load any existing row to preserve untouched secrets and know the connection id.
  const existing = await adminPool.query(
    `SELECT id, provider, config_json, secrets_encrypted FROM pay_processor_connections WHERE ${clause} LIMIT 1`,
    params,
  );
  const prevSecrets: Record<string, string> =
    existing.rows[0]?.secrets_encrypted ? JSON.parse(decrypt(existing.rows[0].secrets_encrypted)) : {};

  // Split submitted values into non-secret config and secret values.
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = { ...prevSecrets };
  for (const field of def.fields) {
    const val = submitted[field.key];
    if (secretKeys.has(field.key)) {
      // Only overwrite a secret when a non-blank value is submitted (blank = keep existing).
      if (val !== undefined && val !== '' && !val.startsWith('••••')) secrets[field.key] = val;
    } else if (val !== undefined) {
      config[field.key] = val;
    }
  }

  // Validate required fields: a required secret counts as satisfied if already stored.
  const missing = requiredKeysFor(provider).filter((k) =>
    secretKeys.has(k) ? !secrets[k] : !config[k],
  );
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing required fields: ${missing.join(', ')}`), { code: 'VALIDATION_ERROR', missing });
  }

  const secretsEncrypted = Object.keys(secrets).length > 0 ? encrypt(JSON.stringify(secrets)) : null;

  // Upsert the connection with the new config. account_id (if present) also mirrors
  // into provider_account_ref so the adapter/account resolution keeps working.
  const accountRef = config.account_id || existing.rows[0]?.provider_account_ref || null;
  if (existing.rows[0]) {
    await adminPool.query(
      `UPDATE pay_processor_connections
       SET provider = $1, config_json = $2, secrets_encrypted = $3, provider_account_ref = $4,
           status = 'active', config_updated_at = NOW(), config_updated_by = $5, updated_at = NOW()
       WHERE id = $6`,
      [provider, JSON.stringify(config), secretsEncrypted, accountRef, userId, existing.rows[0].id],
    );
  } else {
    await adminPool.query(
      `INSERT INTO pay_processor_connections
         (tenant_id, business_id, owner_level, provider, provider_account_ref, config_json, secrets_encrypted, config_updated_at, config_updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)`,
      [owner.tenantId ?? null, owner.businessId ?? null, owner.ownerLevel, provider, accountRef,
       JSON.stringify(config), secretsEncrypted, userId],
    );
  }

  return buildView(provider, config, secrets);
}

/** Read a connection's config for display — non-secret values + masked secrets. */
export async function getProcessorConfig(owner: ConfigOwner): Promise<SavedConfigView | null> {
  const { clause, params } = ownerFilter(owner);
  const { rows } = await adminPool.query(
    `SELECT provider, config_json, secrets_encrypted FROM pay_processor_connections WHERE ${clause} LIMIT 1`,
    params,
  );
  if (rows.length === 0) return null;
  const provider = rows[0].provider;
  const config = rows[0].config_json || {};
  const secrets: Record<string, string> = rows[0].secrets_encrypted ? JSON.parse(decrypt(rows[0].secrets_encrypted)) : {};
  return buildView(provider, config, secrets);
}

function buildView(provider: string, config: Record<string, string>, secrets: Record<string, string>): SavedConfigView {
  const secretsSet: Record<string, boolean> = {};
  const secretsMasked: Record<string, string> = {};
  for (const key of secretKeysFor(provider)) {
    const has = !!secrets[key];
    secretsSet[key] = has;
    if (has) secretsMasked[key] = maskSecret(secrets[key]);
  }
  return { provider, config, secretsSet, secretsMasked };
}

/**
 * Test a provider connection using the submitted (typed, UNSAVED) values. For any
 * secret left blank/masked, falls back to the currently-saved secret so a reload
 * can be tested without retyping. Does not persist anything. Also warns when the
 * selected mode doesn't match the secret key's test/live prefix.
 */
export async function testProcessorConnection(
  owner: ConfigOwner, provider: string, submitted: Record<string, string>,
): Promise<{ ok: boolean; message: string; mode?: string }> {
  const def = getProviderDefinition(provider);
  if (!def) return { ok: false, message: `Unknown provider: ${provider}` };

  const secretKeys = new Set(secretKeysFor(provider));
  const prevSecrets = await getDecryptedSecrets(owner);
  const prevView = await getProcessorConfig(owner);

  // Merge typed secrets over saved ones (blank/masked = keep saved), and typed
  // non-secret config over saved config (so a previously-saved publishable key
  // is still validated even if the user didn't re-type it this time).
  const secrets: Record<string, string> = { ...prevSecrets };
  const config: Record<string, string> = { ...(prevView?.config ?? {}) };
  for (const field of def.fields) {
    const val = submitted[field.key];
    if (secretKeys.has(field.key)) {
      if (val !== undefined && val !== '' && !val.startsWith('••••')) secrets[field.key] = val;
    } else if (val !== undefined) {
      config[field.key] = val;
    }
  }

  // Stripe-specific sanity check: mode vs key prefix (common, confusing mistake).
  if (provider === 'stripe' && secrets.secret_key && config.mode) {
    const keyMode = secrets.secret_key.startsWith('sk_live_') ? 'live' : secrets.secret_key.startsWith('sk_test_') ? 'test' : null;
    if (keyMode && keyMode !== config.mode) {
      return { ok: false, message: `Mode is set to "${config.mode}" but the secret key is a ${keyMode} key. They must match.` };
    }
  }

  if (secretKeys.size > 0 && !Object.keys(secrets).some((k) => secretKeys.has(k) && secrets[k])) {
    return { ok: false, message: 'Enter the provider credentials before testing.' };
  }

  const adapter = getConfiguredAdapter(provider as any, secrets);
  const result = await adapter.testConnection(config);
  return { ok: result.ok, message: result.message, mode: result.mode };
}

export interface ConnectionProbe {
  ok: boolean;
  message?: string;
  mode?: string;
  provider: string;
  publishableKey?: string;
  clientSecret?: string;   // SetupIntent client_secret the browser confirms with the publishable key
}

/**
 * Prepare an end-to-end connection probe using the typed (UNSAVED) values. Runs
 * the same server-side validation as testProcessorConnection (secret key reaches
 * the provider, mode/prefix consistent), then — for Stripe — creates a throwaway
 * SetupIntent and returns its client_secret plus the publishable key so the
 * browser can confirm it with Stripe.js. A successful browser confirmation proves
 * the publishable key is valid and from the same account/mode as the secret key.
 *
 * Persists nothing. For the mock provider, returns ok without a client_secret
 * (nothing to confirm client-side).
 */
export async function prepareConnectionProbe(
  owner: ConfigOwner, provider: string, submitted: Record<string, string>,
): Promise<ConnectionProbe> {
  const def = getProviderDefinition(provider);
  if (!def) return { ok: false, message: `Unknown provider: ${provider}`, provider };

  const secretKeys = new Set(secretKeysFor(provider));
  const prevSecrets = await getDecryptedSecrets(owner);
  const prevView = await getProcessorConfig(owner);

  const secrets: Record<string, string> = { ...prevSecrets };
  const config: Record<string, string> = { ...(prevView?.config ?? {}) };
  for (const field of def.fields) {
    const val = submitted[field.key];
    if (secretKeys.has(field.key)) {
      if (val !== undefined && val !== '' && !val.startsWith('••••')) secrets[field.key] = val;
    } else if (val !== undefined) {
      config[field.key] = val;
    }
  }

  // First run the standard server-side validation (secret key + mode/prefix).
  const adapter = getConfiguredAdapter(provider as any, secrets);
  const base = await adapter.testConnection(config);
  if (!base.ok) return { ok: false, message: base.message, mode: base.mode, provider };

  // Stripe: create a throwaway SetupIntent for the browser to confirm.
  if (provider === 'stripe' && secrets.secret_key) {
    try {
      const { StripeAdapter } = await import('./payments/stripe-adapter');
      const stripeAdapter = new StripeAdapter(secrets.secret_key, secrets.webhook_secret);
      const intent = await stripeAdapter.createProbeSetupIntent();
      if (!intent.clientSecret) {
        return { ok: false, message: 'Could not create a verification intent with the secret key.', mode: base.mode, provider };
      }
      return {
        ok: true, mode: base.mode, provider,
        publishableKey: config.publishable_key || '',
        clientSecret: intent.clientSecret,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Could not prepare the Stripe verification.', mode: base.mode, provider };
    }
  }

  // Non-Stripe (mock): server-side check is sufficient; nothing to confirm client-side.
  return { ok: true, message: base.message, mode: base.mode, provider };
}

/** Internal: decrypt a connection's secrets for the adapter to use when charging. */
export async function getDecryptedSecrets(owner: ConfigOwner): Promise<Record<string, string>> {
  const { clause, params } = ownerFilter(owner);
  const { rows } = await adminPool.query(
    `SELECT secrets_encrypted FROM pay_processor_connections WHERE ${clause} LIMIT 1`,
    params,
  );
  if (rows.length === 0 || !rows[0].secrets_encrypted) return {};
  return JSON.parse(decrypt(rows[0].secrets_encrypted));
}
