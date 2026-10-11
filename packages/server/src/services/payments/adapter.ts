/**
 * Payment Provider Abstraction (spec phase 10, Requirement 0.1).
 *
 * A single PaymentAdapter interface is used by all three billing layers
 * (A: DayStream -> tenant, B: tenant -> business, C: customer -> business) to
 * execute payment operations against a connected provider account supplied by
 * the calling layer.
 *
 * "Bill what it's told": the SYSTEM decides amount, method, and timing; the
 * provider only executes single operations. There is deliberately NO
 * createSubscription / cancelSubscription — recurrence lives in the billing
 * layers (mbr_enrollments + the scheduled jobs), never in the provider.
 */

/** The provider account an operation runs against (platform, tenant, or business). */
export interface ConnectedAccount {
  provider: PaymentProviderName;
  providerAccountRef: string;              // provider-side account id (never a secret)
  ownerLevel: 'platform' | 'tenant' | 'business';
}

export type PaymentProviderName = 'stripe' | 'mock';

export type MethodType = 'card' | 'bank_draw' | 'google_pay' | 'apple_pay';

/** Input to execute a charge. `idempotencyKey` makes retries safe (never double-charge). */
export interface ChargeInput {
  account: ConnectedAccount;
  amount: number;                          // integer cents
  currency: string;                        // ISO 4217, e.g. 'EUR'
  methodToken: string;                     // vaulted token to charge
  methodType?: MethodType;                 // vault method type (card/bank_draw/wallet) — drives the provider's allowed payment_method_types
  customerRef?: string;                    // provider customer the token is attached to (required for off-session reuse)
  idempotencyKey: string;                  // caller-supplied; stable per logical charge
  description?: string;
  metadata?: Record<string, string>;
}

export interface RefundInput {
  account: ConnectedAccount;
  providerReference: string;               // the original charge's provider reference
  amount?: number;                         // integer cents; omit for full refund
  idempotencyKey: string;
  reason?: string;
}

/** Input to capture + tokenize a new instrument (card entry, bank mandate, wallet). */
export interface CaptureInput {
  account: ConnectedAccount;
  methodType: MethodType;
  // Opaque payload produced by the provider's hosted capture (card element,
  // mandate flow, or wallet sheet). The raw instrument never reaches our servers.
  capturePayload: Record<string, unknown>;
}

export interface TokenResult {
  providerToken: string;                   // vault token to store (NOT raw credentials)
  displayBrand?: string;                   // e.g. 'Visa', 'SEPA'
  displayLast4?: string;
  expMonth?: number;                       // card only
  expYear?: number;                        // card only
}

export type ChargeOutcome = 'succeeded' | 'failed' | 'pending';

export interface AdapterResult {
  providerReference: string;               // provider-side charge/refund id
  outcome: ChargeOutcome;
  amount: number;
  currency: string;
  failureReason?: string;
}

export interface AdapterTxn {
  providerReference: string;
  type: 'charge' | 'refund';
  amount: number;
  currency: string;
  outcome: ChargeOutcome;
  occurredAt: string;                      // ISO timestamp
}

export interface DateRange {
  start: string;                           // ISO date
  end: string;                             // ISO date
}

/** Normalized provider webhook event (provider-specific payloads are mapped to these). */
export type NormalizedEventType =
  | 'charge.succeeded'
  | 'charge.failed'
  | 'refund.succeeded'
  | 'method.updated'
  | 'unknown';

export interface NormalizedEvent {
  type: NormalizedEventType;
  providerReference?: string;              // charge/refund/method id the event concerns
  raw: unknown;                            // original payload for audit/debug
}

/**
 * The provider abstraction. Every implementation (StripeAdapter, MockAdapter, ...)
 * satisfies this and nothing else in the billing layers talks to a provider directly.
 */
export interface PaymentAdapter {
  readonly provider: PaymentProviderName;

  /** Execute a one-off or system-driven recurring charge. Idempotent via idempotencyKey. */
  charge(input: ChargeInput): Promise<AdapterResult>;

  /** Full or partial refund of a prior charge. Idempotent via idempotencyKey. */
  refund(input: RefundInput): Promise<AdapterResult>;

  /** Capture + tokenize a new instrument; returns a vault token + masked display. */
  tokenize(input: CaptureInput): Promise<TokenResult>;

  /** Remove a stored (vaulted) method from the provider. */
  removeMethod(providerToken: string, account: ConnectedAccount): Promise<void>;

  /** Current status of a prior charge by its provider reference. */
  getStatus(providerReference: string, account: ConnectedAccount): Promise<ChargeOutcome>;

  /** List transactions for a connected account within a date range (reconciliation). */
  listTransactions(account: ConnectedAccount, range: DateRange): Promise<AdapterTxn[]>;

  /** Verify a webhook signature and normalize the payload into a common event. */
  parseWebhook(rawBody: string | Buffer, signature: string): NormalizedEvent;

  /**
   * Validate that the configured credentials are valid and the service is
   * reachable, without changing any state. Returns a human-readable result and,
   * where the provider exposes it, the mode (test/live) it is operating in.
   *
   * `publicConfig` carries the non-secret, typed values (e.g. the publishable
   * key and selected mode) so the adapter can validate them against the
   * authenticated account — the secret key alone can't catch a bogus
   * publishable key.
   */
  testConnection(publicConfig?: Record<string, string>): Promise<ConnectionTestResult>;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  mode?: 'test' | 'live';
}
