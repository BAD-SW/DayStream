/**
 * Bank-debit scheme registry (spec phase 10, bank-draw).
 *
 * All bank-draw payment methods are processed through the provider (Stripe) as a
 * direct-debit instrument: the payer authorizes a MANDATE once, and the system
 * pulls funds on its own schedule — at the cheaper bank-debit fee tier, not card
 * rates. This is the single source of truth for the supported debit schemes so
 * adding a new one (ACH, BACS, …) is a declaration here plus a client element,
 * not a new capture flow.
 *
 * `method_type = 'bank_draw'` in our catalog maps to exactly one of these schemes
 * at capture time, chosen by region/currency (SEPA for the euro area today).
 */

/** Stripe payment_method type for each debit scheme. */
export type StripeDebitType = 'sepa_debit' | 'us_bank_account' | 'bacs_debit';

export type BankDebitSchemeId = 'sepa' | 'ach' | 'bacs';

export interface BankDebitScheme {
  id: BankDebitSchemeId;
  label: string;
  /** The Stripe payment_method type this scheme captures/charges as. */
  stripeType: StripeDebitType;
  /** Currencies this scheme can debit (lowercase ISO 4217). */
  currencies: string[];
  /** A mandate must be shown + accepted at capture (true for all current schemes). */
  requiresMandate: boolean;
  /**
   * Debits settle asynchronously — a charge is 'pending' for days before it
   * succeeds/fails, so the final status arrives by webhook, not at charge time.
   */
  asyncSettlement: boolean;
  /** Whether DayStream has implemented capture for this scheme yet. */
  implemented: boolean;
}

/**
 * Supported debit schemes. SEPA is implemented now; ACH and BACS are declared so
 * the plumbing (type resolution, display, availability) already accounts for them
 * and only their client capture element is pending.
 */
export const BANK_DEBIT_SCHEMES: Record<BankDebitSchemeId, BankDebitScheme> = {
  sepa: {
    id: 'sepa', label: 'SEPA Direct Debit', stripeType: 'sepa_debit',
    currencies: ['eur'], requiresMandate: true, asyncSettlement: true, implemented: true,
  },
  ach: {
    id: 'ach', label: 'ACH Direct Debit', stripeType: 'us_bank_account',
    currencies: ['usd'], requiresMandate: true, asyncSettlement: true, implemented: true,
  },
  bacs: {
    id: 'bacs', label: 'Bacs Direct Debit', stripeType: 'bacs_debit',
    currencies: ['gbp'], requiresMandate: true, asyncSettlement: true, implemented: false,
  },
};

/** Default scheme (used until region/currency selection drives the choice). */
export const DEFAULT_BANK_DEBIT_SCHEME: BankDebitSchemeId = 'sepa';

export function getBankDebitScheme(id: BankDebitSchemeId): BankDebitScheme {
  return BANK_DEBIT_SCHEMES[id];
}

/** Resolve the debit scheme for a currency, falling back to the default. */
export function schemeForCurrency(currency?: string): BankDebitScheme {
  const cur = (currency || '').toLowerCase();
  const found = Object.values(BANK_DEBIT_SCHEMES).find((s) => s.implemented && s.currencies.includes(cur));
  return found ?? BANK_DEBIT_SCHEMES[DEFAULT_BANK_DEBIT_SCHEME];
}

/** The Stripe payment_method types for every implemented scheme (for SetupIntent/capture). */
export function implementedStripeDebitTypes(): StripeDebitType[] {
  return Object.values(BANK_DEBIT_SCHEMES).filter((s) => s.implemented).map((s) => s.stripeType);
}

/** Map a Stripe payment_method type back to its scheme (for display after tokenize). */
export function schemeByStripeType(stripeType: string): BankDebitScheme | null {
  return Object.values(BANK_DEBIT_SCHEMES).find((s) => s.stripeType === stripeType) ?? null;
}
