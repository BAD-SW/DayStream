import { adminPool } from '../db/pool';

/**
 * Payment method catalog & availability (spec phase 10, task 1.4 / Requirements 0.2, 0.3).
 *
 * Defines the method classification that drives system behavior and resolves which
 * methods may be offered for a given Section C (customer -> business) charge:
 *
 *   offered = accepted-by-business
 *             ∩ valid-for-context (recurring excludes non-recurring-capable methods)
 *             ∩ supported-by-active-provider/region
 */

export type CatalogMethod =
  | 'cash' | 'card' | 'bank_draw' | 'bank_transfer' | 'check'
  | 'gift_card' | 'google_pay' | 'apple_pay' | 'other';

export type MethodClass = 'processed' | 'manual_record' | 'internal';

export interface MethodDefinition {
  method: CatalogMethod;
  klass: MethodClass;
  recurringCapable: boolean;      // chargeable on a stored credential / mandate
  processed: boolean;             // money moves via a provider
}

/**
 * The catalog. `bank_transfer` is the legacy manual push (record-only); `bank_draw`
 * is the processed pull/mandate instrument (ACH/SEPA direct debit).
 */
export const METHOD_CATALOG: Record<CatalogMethod, MethodDefinition> = {
  card:         { method: 'card',         klass: 'processed',     recurringCapable: true,  processed: true },
  bank_draw:    { method: 'bank_draw',    klass: 'processed',     recurringCapable: true,  processed: true },
  google_pay:   { method: 'google_pay',   klass: 'processed',     recurringCapable: false, processed: true },
  apple_pay:    { method: 'apple_pay',    klass: 'processed',     recurringCapable: false, processed: true },
  cash:         { method: 'cash',         klass: 'manual_record', recurringCapable: false, processed: false },
  check:        { method: 'check',        klass: 'manual_record', recurringCapable: false, processed: false },
  bank_transfer:{ method: 'bank_transfer',klass: 'manual_record', recurringCapable: false, processed: false },
  other:        { method: 'other',        klass: 'manual_record', recurringCapable: false, processed: false },
  gift_card:    { method: 'gift_card',    klass: 'internal',      recurringCapable: false, processed: false },
};

/** Methods valid for the recurring/automated billing layers (A, B) — the fixed set. */
export const RECURRING_METHOD_SET: CatalogMethod[] = ['card', 'bank_draw'];

/** The full customer-facing (Section C) catalog, subject to business configuration. */
export const CUSTOMER_METHOD_SET: CatalogMethod[] = [
  'card', 'bank_draw', 'google_pay', 'apple_pay', 'cash', 'check', 'gift_card', 'other',
];

export interface AvailabilityContext {
  recurring: boolean;     // true for subscription/stored-credential charges
}

export interface AvailabilityResult {
  method: CatalogMethod;
  definition: MethodDefinition;
}

/**
 * Which processed methods the active provider supports (optionally per region).
 * Until the real provider feature matrix lands, Stripe/mock support card + bank_draw
 * universally and wallets where enabled. Region is accepted for future refinement.
 */
function providerSupports(method: CatalogMethod, provider: string | null, _region?: string): boolean {
  const def = METHOD_CATALOG[method];
  if (!def.processed) return true;              // manual/internal don't need provider support
  if (!provider) return false;                  // processed method needs an active connection
  // Mock/Stripe baseline: all processed methods supported. Refine per provider/region later.
  return true;
}

/**
 * Resolve the methods a business may offer for a Section C charge.
 * Reads enabled methods from pay_accepted_methods, intersects with the context
 * (recurring excludes non-recurring-capable methods) and provider support.
 */
export async function resolveAvailableMethods(
  businessId: string, ctx: AvailabilityContext,
): Promise<AvailabilityResult[]> {
  // Use the effective accepted-methods map (stored rows overlaid on sensible
  // defaults) so a business with a partial/empty set still offers its default
  // methods — and so this resolver never diverges from the Settings UI.
  const { getEffectiveAcceptedMethods } = await import('./payment.service');
  const effective = await getEffectiveAcceptedMethods(businessId);
  const enabled = new Set<string>(Object.entries(effective).filter(([, on]) => on).map(([m]) => m));

  // Active provider for this business (for processed-method support checks).
  const { rows: connRows } = await adminPool.query(
    `SELECT provider FROM pay_processor_connections
     WHERE owner_level = 'business' AND business_id = $1 AND status = 'active' LIMIT 1`,
    [businessId],
  );
  const provider: string | null = connRows[0]?.provider ?? null;

  const results: AvailabilityResult[] = [];
  for (const method of CUSTOMER_METHOD_SET) {
    if (!enabled.has(method)) continue;                         // business must accept it
    const def = METHOD_CATALOG[method];
    if (ctx.recurring && !def.recurringCapable) continue;       // recurring excludes manual/one-off
    if (def.processed && !providerSupports(method, provider)) continue;  // provider/region support
    results.push({ method, definition: def });
  }
  return results;
}

/** The classification/catalog, for display and client logic. */
export function getMethodCatalog(): MethodDefinition[] {
  return Object.values(METHOD_CATALOG);
}
