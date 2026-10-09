import crypto from 'crypto';
import {
  PaymentAdapter, ChargeInput, RefundInput, CaptureInput, TokenResult,
  AdapterResult, AdapterTxn, DateRange, ConnectedAccount, ChargeOutcome,
  NormalizedEvent, NormalizedEventType, PaymentProviderName, ConnectionTestResult,
} from './adapter';

/**
 * MockAdapter — a deterministic, in-memory PaymentAdapter used until a real
 * provider (Stripe) is wired to live credentials. It lets the billing layers be
 * built and tested end-to-end without an external account.
 *
 * It models the behavior the rest of the system depends on:
 *  - idempotent charges/refunds (same idempotencyKey returns the same result)
 *  - vault tokens from tokenize() (never echoes raw payload)
 *  - deterministic success, with simple test hooks for forcing a decline
 *  - webhook signature verification (HMAC) + normalization
 *
 * Deterministic test hooks (via charge metadata):
 *   metadata.__force = 'decline'  -> outcome 'failed'
 *   metadata.__force = 'pending'  -> outcome 'pending'
 * Otherwise charges succeed.
 */
export class MockAdapter implements PaymentAdapter {
  readonly provider: PaymentProviderName;

  // In-memory stores (per process). Real adapters delegate to the provider.
  private charges = new Map<string, AdapterResult>();      // idempotencyKey -> result
  private byReference = new Map<string, AdapterResult>();   // providerReference -> result
  private refunds = new Map<string, AdapterResult>();       // idempotencyKey -> result
  private webhookSecret: string;

  constructor(provider: PaymentProviderName = 'mock', webhookSecret = 'mock_webhook_secret') {
    this.provider = provider;
    this.webhookSecret = webhookSecret;
  }

  async charge(input: ChargeInput): Promise<AdapterResult> {
    // Idempotency: same key returns the prior result, never charges twice.
    const existing = this.charges.get(input.idempotencyKey);
    if (existing) return existing;

    const forced = input.metadata?.__force;
    const outcome: ChargeOutcome =
      forced === 'decline' ? 'failed' : forced === 'pending' ? 'pending' : 'succeeded';

    const result: AdapterResult = {
      providerReference: `mock_ch_${crypto.randomUUID()}`,
      outcome,
      amount: input.amount,
      currency: input.currency,
      failureReason: outcome === 'failed' ? 'Card declined (mock)' : undefined,
    };

    this.charges.set(input.idempotencyKey, result);
    this.byReference.set(result.providerReference, result);
    return result;
  }

  async refund(input: RefundInput): Promise<AdapterResult> {
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing) return existing;

    const original = this.byReference.get(input.providerReference);
    const amount = input.amount ?? original?.amount ?? 0;

    const result: AdapterResult = {
      providerReference: `mock_re_${crypto.randomUUID()}`,
      outcome: 'succeeded',
      amount,
      currency: original?.currency ?? 'EUR',
    };
    this.refunds.set(input.idempotencyKey, result);
    this.byReference.set(result.providerReference, result);
    return result;
  }

  async tokenize(input: CaptureInput): Promise<TokenResult> {
    // Never persist or echo the raw payload. Produce a vault token + masked display.
    const token = `mock_tok_${crypto.randomUUID()}`;
    const brandByType: Record<string, string> = {
      card: 'Visa', bank_draw: 'SEPA', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
    };
    const last4 = String(Math.floor(1000 + Math.random() * 9000));
    return {
      providerToken: token,
      displayBrand: brandByType[input.methodType] ?? 'Card',
      displayLast4: input.methodType === 'card' || input.methodType === 'bank_draw' ? last4 : undefined,
      expMonth: input.methodType === 'card' ? 12 : undefined,
      expYear: input.methodType === 'card' ? new Date().getFullYear() + 3 : undefined,
    };
  }

  async removeMethod(_providerToken: string, _account: ConnectedAccount): Promise<void> {
    // No-op for the mock; a real adapter detaches the token at the provider.
  }

  async getStatus(providerReference: string, _account: ConnectedAccount): Promise<ChargeOutcome> {
    return this.byReference.get(providerReference)?.outcome ?? 'failed';
  }

  async listTransactions(_account: ConnectedAccount, _range: DateRange): Promise<AdapterTxn[]> {
    return Array.from(this.byReference.values()).map((r) => ({
      providerReference: r.providerReference,
      type: r.providerReference.startsWith('mock_re_') ? 'refund' : 'charge',
      amount: r.amount,
      currency: r.currency,
      outcome: r.outcome,
      occurredAt: new Date().toISOString(),
    }));
  }

  parseWebhook(rawBody: string | Buffer, signature: string): NormalizedEvent {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    // Verify an HMAC-SHA256 signature over the raw body (constant-time compare).
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
    const ok = signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      throw new Error('Invalid webhook signature');
    }

    let parsed: any;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }

    const typeMap: Record<string, NormalizedEventType> = {
      'charge.succeeded': 'charge.succeeded',
      'charge.failed': 'charge.failed',
      'refund.succeeded': 'refund.succeeded',
      'method.updated': 'method.updated',
    };
    return {
      type: typeMap[parsed?.type] ?? 'unknown',
      providerReference: parsed?.reference,
      raw: parsed,
    };
  }

  async testConnection(_publicConfig?: Record<string, string>): Promise<ConnectionTestResult> {
    return { ok: true, message: 'Mock provider reachable (no real credentials required).', mode: 'test' };
  }

  /** Test helper: sign a webhook body the way a provider would. */
  signWebhook(body: string): string {
    return crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
  }
}
