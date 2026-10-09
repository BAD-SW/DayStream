import { adminPool } from '../db/pool';
import {
  getConfiguredAdapter, StripeAdapter, ConnectedAccount, MethodType, CaptureInput,
  schemeForCurrency, BankDebitSchemeId, BANK_DEBIT_SCHEMES,
} from './payments';
import { getDecryptedSecrets } from './processor-config.service';

/**
 * Resolve the billing currency that governs an owner's bank-draw scheme.
 * Currency determines the debit scheme (eur→SEPA, usd→ACH, gbp→Bacs), so it must
 * come from the authoritative record, not the client:
 *   - tenant  → sys_tenants.currency
 *   - business/customer → sys_businesses.currency
 *   - platform → the platform's configured currency (fallback 'EUR')
 */
async function resolveOwnerCurrency(owner: MethodOwner): Promise<string> {
  if (owner.ownerLevel === 'tenant' && owner.tenantId) {
    const { rows } = await adminPool.query(`SELECT currency FROM sys_tenants WHERE id = $1`, [owner.tenantId]);
    if (rows[0]?.currency) return rows[0].currency;
  } else if ((owner.ownerLevel === 'business' || owner.ownerLevel === 'customer') && owner.businessId) {
    const { rows } = await adminPool.query(`SELECT currency FROM sys_businesses WHERE id = $1`, [owner.businessId]);
    if (rows[0]?.currency) return rows[0].currency;
  }
  // Platform (DayStream's own methods) or missing — default to EUR for now.
  return process.env.PLATFORM_CURRENCY || 'EUR';
}

/**
 * Payment Methods service (spec phase 10, task 1.3 / Requirement 0.5).
 *
 * The SINGLE shared mechanism for capturing and storing a tokenized payment
 * instrument, reused at every layer:
 *   - DayStream capturing a tenant's instrument      (owner_level 'platform'|'tenant')
 *   - a tenant capturing a business's instrument      (owner_level 'business')
 *   - a business/customer capturing a customer's method(owner_level 'customer')
 *
 * Raw card/bank credentials never reach our servers: capture goes through the
 * provider adapter's tokenize(), and only the resulting vault token + masked
 * display are persisted in pay_payment_methods.
 */

export type OwnerLevel = 'platform' | 'tenant' | 'business' | 'customer';

export interface MethodOwner {
  ownerLevel: OwnerLevel;
  tenantId?: string | null;
  businessId?: string | null;
  customerId?: string | null;
}

export interface StoredPaymentMethod {
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

/** Columns safe to return to clients — never the provider_token. */
const PUBLIC_COLUMNS = `
  id, owner_level, tenant_id, business_id, customer_id, method_type, provider,
  display_brand, display_last4, exp_month, exp_year, is_default, status, created_at
`;

/**
 * Resolve the connected provider account an owner's methods are captured/charged
 * against. Platform uses the platform connection; tenant uses the tenant's;
 * business and customer methods both use the business's connection (customers pay
 * the business). Returns null if no active connection is configured.
 */
export async function resolveConnectedAccount(owner: MethodOwner): Promise<ConnectedAccount | null> {
  // A method is captured/charged against the CHARGING party's connection, not the
  // owner's own: DayStream charges tenants (platform conn), a tenant charges its
  // businesses (tenant conn), a business charges its customers (business conn).
  const charging = chargingConfigOwnerFor(owner);
  const params: any[] = [];
  let filter: string;

  if (charging.ownerLevel === 'platform') {
    filter = `owner_level = 'platform'`;
  } else if (charging.ownerLevel === 'tenant') {
    filter = `owner_level = 'tenant' AND tenant_id = $1`;
    params.push(charging.tenantId);
  } else {
    filter = `owner_level = 'business' AND business_id = $1`;
    params.push(charging.businessId);
  }

  const { rows } = await adminPool.query(
    `SELECT provider, provider_account_ref FROM pay_processor_connections
     WHERE ${filter} AND status = 'active' LIMIT 1`,
    params,
  );
  if (rows.length === 0) return null;
  return {
    provider: rows[0].provider,
    providerAccountRef: rows[0].provider_account_ref || '',
    ownerLevel: charging.ownerLevel as ConnectedAccount['ownerLevel'],
  };
}

/**
 * The CHARGING party whose provider account vaults and charges this owner's card.
 * The party doing the charging owns the processor account (and bank), so:
 *   - a tenant's card is charged by DayStream  -> platform provider
 *   - a business's card is charged by its tenant -> that tenant's provider
 *   - a customer's card is charged by its business -> that business's provider
 *   - a platform-level method (rare) -> platform provider
 */
function chargingConfigOwnerFor(owner: MethodOwner): { ownerLevel: 'platform' | 'tenant' | 'business'; tenantId?: string | null; businessId?: string | null } {
  if (owner.ownerLevel === 'platform') return { ownerLevel: 'platform' };
  if (owner.ownerLevel === 'tenant') return { ownerLevel: 'platform' };          // DayStream charges tenants
  if (owner.ownerLevel === 'business') return { ownerLevel: 'tenant', tenantId: owner.tenantId }; // tenant charges businesses
  return { ownerLevel: 'business', businessId: owner.businessId };               // business charges customers
}

/** Resolve a connection-aware adapter (real Stripe when a secret key is configured). */
async function adapterForOwner(owner: MethodOwner, account: ConnectedAccount) {
  const secrets = await getDecryptedSecrets(chargingConfigOwnerFor(owner));
  return getConfiguredAdapter(account.provider, secrets);
}

/**
 * Begin a capture session. For Stripe this creates a SetupIntent and returns the
 * client_secret + publishable key the browser needs to render Stripe Elements and
 * confirm the card. For the mock it returns a stand-in ref. The connected account
 * determines which provider/account the instrument is captured into.
 */
export async function beginCaptureSession(
  owner: MethodOwner, methodType: MethodType,
): Promise<{ provider: string; ownerLevel: OwnerLevel; sessionRef: string; clientSecret?: string; publishableKey?: string; debitScheme?: BankDebitSchemeId; currency?: string }> {
  const account = await resolveConnectedAccount(owner);
  if (!account) {
    throw Object.assign(new Error('No active payment processor connection for this owner'), { code: 'NO_CONNECTION' });
  }
  const cfgOwner = chargingConfigOwnerFor(owner);
  const secrets = await getDecryptedSecrets(cfgOwner);
  const adapter = getConfiguredAdapter(account.provider, secrets);

  // Real Stripe: create a SetupIntent + return publishable key for Elements.
  if (adapter instanceof StripeAdapter) {
    // Bank draw captures a direct-debit mandate; the owner's billing currency
    // determines the scheme (eur→SEPA, usd→ACH, gbp→Bacs). Card captures a card.
    let scheme = null as ReturnType<typeof schemeForCurrency> | null;
    if (methodType === 'bank_draw') {
      const currency = await resolveOwnerCurrency(owner);
      // Match the currency to a scheme WITHOUT the implemented-only fallback, so an
      // as-yet-unimplemented scheme (e.g. ACH before it ships) surfaces a clear
      // error instead of silently showing the wrong (SEPA) form.
      const matched = Object.values(BANK_DEBIT_SCHEMES).find((s) => s.currencies.includes(currency.toLowerCase()));
      if (!matched) {
        throw Object.assign(
          new Error(`No bank-draw scheme supports ${currency.toUpperCase()} payments.`),
          { code: 'SCHEME_UNSUPPORTED' },
        );
      }
      if (!matched.implemented) {
        throw Object.assign(
          new Error(`${matched.label} (${currency.toUpperCase()}) is not available yet.`),
          { code: 'SCHEME_NOT_IMPLEMENTED' },
        );
      }
      scheme = matched;
    }
    // Wallets (Google Pay / Apple Pay) are a presentment layer over a CARD: the
    // wallet sheet returns a card PaymentMethod we vault for off-session reuse. So
    // the SetupIntent allows 'card'; the client's Express Checkout Element (setup
    // mode) needs the owner's billing currency to render.
    const isWallet = methodType === 'google_pay' || methodType === 'apple_pay';
    const pmTypes = scheme ? [scheme.stripeType] : ['card'];
    const { clientSecret, setupIntentId } = await adapter.createSetupIntent(pmTypes);
    const config = await getConfigForOwner(cfgOwner);
    const currency = isWallet ? await resolveOwnerCurrency(owner) : undefined;
    return {
      provider: account.provider,
      ownerLevel: owner.ownerLevel,
      sessionRef: setupIntentId,
      clientSecret,
      publishableKey: config?.publishable_key,
      ...(scheme ? { debitScheme: scheme.id } : {}),
      ...(currency ? { currency: currency.toLowerCase() } : {}),
    };
  }

  // Mock fallback.
  return { provider: account.provider, ownerLevel: owner.ownerLevel, sessionRef: `sess_${account.provider}_${Date.now()}` };
}

/** Read the non-secret config (e.g. publishable_key) for a connection owner. */
async function getConfigForOwner(cfgOwner: { ownerLevel: string; tenantId?: string | null; businessId?: string | null }): Promise<Record<string, string> | null> {
  let filter: string; const params: any[] = [];
  if (cfgOwner.ownerLevel === 'platform') filter = `owner_level = 'platform'`;
  else if (cfgOwner.ownerLevel === 'tenant') { filter = `owner_level = 'tenant' AND tenant_id = $1`; params.push(cfgOwner.tenantId); }
  else { filter = `owner_level = 'business' AND business_id = $1`; params.push(cfgOwner.businessId); }
  const { rows } = await adminPool.query(`SELECT config_json FROM pay_processor_connections WHERE ${filter} LIMIT 1`, params);
  return rows[0]?.config_json ?? null;
}

/**
 * Store a payment method from a completed capture. Tokenizes the capture payload
 * via the adapter (raw instrument never persisted), then saves the vault token +
 * masked display. If this is the owner's first method, it becomes the default.
 */
export async function storePaymentMethod(
  owner: MethodOwner, methodType: MethodType, capturePayload: Record<string, unknown>,
): Promise<StoredPaymentMethod> {
  const account = await resolveConnectedAccount(owner);
  if (!account) {
    throw Object.assign(new Error('No active payment processor connection for this owner'), { code: 'NO_CONNECTION' });
  }

  const adapter = await adapterForOwner(owner, account);
  const input: CaptureInput = { account, methodType, capturePayload };
  const token = await adapter.tokenize(input);

  // First active method for this owner becomes default.
  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS n FROM pay_payment_methods
     WHERE owner_level = $1 AND status = 'active'
       AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
    [owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
  );
  const isDefault = countRows[0].n === 0;

  const { rows } = await adminPool.query(
    `INSERT INTO pay_payment_methods
       (tenant_id, owner_level, business_id, customer_id, method_type, provider,
        provider_token, display_brand, display_last4, exp_month, exp_year, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      owner.tenantId ?? null, owner.ownerLevel, owner.businessId ?? null, owner.customerId ?? null,
      methodType, account.provider, token.providerToken, token.displayBrand ?? null,
      token.displayLast4 ?? null, token.expMonth ?? null, token.expYear ?? null, isDefault,
    ],
  );
  return rows[0];
}

/** List an owner's active, stored methods (masked; never the token). */
export async function listPaymentMethods(owner: MethodOwner): Promise<StoredPaymentMethod[]> {
  const { rows } = await adminPool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM pay_payment_methods
     WHERE owner_level = $1 AND status = 'active'
       AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY is_default DESC, created_at DESC`,
    [owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
  );
  return rows;
}

/**
 * Set a method as the owner's default. Verifies the method belongs to the owner,
 * clears the prior default, and sets the new one — in a transaction.
 */
export async function setDefaultPaymentMethod(methodId: string, owner: MethodOwner): Promise<boolean> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM pay_payment_methods
       WHERE id = $1 AND owner_level = $2 AND status = 'active'
         AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       FOR UPDATE`,
      [methodId, owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return false; }

    await client.query(
      `UPDATE pay_payment_methods SET is_default = false, updated_at = NOW()
       WHERE owner_level = $1 AND is_default = true
         AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
      [owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
    );
    await client.query(
      `UPDATE pay_payment_methods SET is_default = true, updated_at = NOW() WHERE id = $1`,
      [methodId],
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Remove a stored method: detach at the provider, then mark removed. Verifies
 * ownership. If the removed method was the default, promotes the most recent
 * remaining active method to default.
 */
export async function removePaymentMethod(methodId: string, owner: MethodOwner): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT id, provider, provider_token, is_default FROM pay_payment_methods
     WHERE id = $1 AND owner_level = $2 AND status = 'active'
       AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
    [methodId, owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
  );
  if (rows.length === 0) return false;
  const method = rows[0];

  const account = await resolveConnectedAccount(owner);
  if (account) {
    try { const a = await adapterForOwner(owner, account); await a.removeMethod(method.provider_token, account); }
    catch { /* best-effort provider detach; local removal still proceeds */ }
  }

  await adminPool.query(
    `UPDATE pay_payment_methods SET status = 'removed', is_default = false, updated_at = NOW() WHERE id = $1`,
    [methodId],
  );

  // Promote a new default if we just removed the default.
  if (method.is_default) {
    await adminPool.query(
      `UPDATE pay_payment_methods SET is_default = true, updated_at = NOW()
       WHERE id = (
         SELECT id FROM pay_payment_methods
         WHERE owner_level = $1 AND status = 'active'
           AND COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
           AND COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
           AND COALESCE(customer_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         ORDER BY created_at DESC LIMIT 1
       )`,
      [owner.ownerLevel, owner.tenantId ?? null, owner.businessId ?? null, owner.customerId ?? null],
    );
  }
  return true;
}

/** Internal: fetch the provider token for charging (never exposed via API). */
export async function getProviderToken(methodId: string): Promise<{ token: string; provider: string } | null> {
  const { rows } = await adminPool.query(
    `SELECT provider_token, provider FROM pay_payment_methods WHERE id = $1 AND status = 'active'`,
    [methodId],
  );
  if (rows.length === 0) return null;
  return { token: rows[0].provider_token, provider: rows[0].provider };
}
