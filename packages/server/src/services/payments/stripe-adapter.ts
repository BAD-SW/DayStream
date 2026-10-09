import Stripe from 'stripe';
import {
  PaymentAdapter, ChargeInput, RefundInput, CaptureInput, TokenResult,
  AdapterResult, AdapterTxn, DateRange, ConnectedAccount, ChargeOutcome,
  NormalizedEvent, NormalizedEventType, PaymentProviderName, ConnectionTestResult,
} from './adapter';

/**
 * StripeAdapter — the real Stripe implementation of PaymentAdapter.
 *
 * Built per-connection from the connection's DECRYPTED secret key (the config
 * layer stores it encrypted; this adapter receives the plaintext at construction
 * only, never persisting it). Follows "bill what it's told": the system owns
 * recurrence; Stripe only executes charges/refunds/tokenization.
 *
 * Card data is captured client-side via Stripe Elements (a SetupIntent), so raw
 * PANs never reach our servers — tokenize() here just reads back the resulting
 * PaymentMethod's masked display after the client has confirmed it.
 */
export class StripeAdapter implements PaymentAdapter {
  readonly provider: PaymentProviderName = 'stripe';
  private stripe: Stripe;
  private webhookSecret?: string;

  constructor(secretKey: string, webhookSecret?: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' as any });
    this.webhookSecret = webhookSecret;
  }

  /**
   * Create a SetupIntent for capturing a payment method client-side. Returns the
   * client_secret the browser confirms against with Stripe Elements.
   */
  /**
   * Create a SetupIntent for capturing a payment method client-side. Returns the
   * client_secret the browser confirms against with Stripe Elements.
   *
   * `paymentMethodTypes` restricts which instrument kinds this intent accepts
   * (e.g. ['card'] for a card, ['sepa_debit'] for a SEPA mandate). Defaults to
   * card to preserve the original behavior.
   */
  async createSetupIntent(
    paymentMethodTypes: string[] = ['card'],
  ): Promise<{ clientSecret: string; setupIntentId: string }> {
    // payment_method_types is a valid Stripe API param but isn't in this SDK
    // version's typed create params; cast narrowly (same approach as apiVersion).
    const params = { usage: 'off_session', payment_method_types: paymentMethodTypes } as Stripe.SetupIntentCreateParams;
    const intent = await this.stripe.setupIntents.create(params);
    return { clientSecret: intent.client_secret || '', setupIntentId: intent.id };
  }

  /**
   * Create a throwaway SetupIntent purely to validate the connection end-to-end.
   * The browser confirms it with the publishable key; if confirmation succeeds,
   * the publishable key is proven valid and from the same account/mode as the
   * secret key that created the intent. Tagged in metadata so these can be told
   * apart from real captures. Returns null clientSecret if the secret key is bad
   * (the caller surfaces that as a failed test).
   */
  async createProbeSetupIntent(): Promise<{ clientSecret: string; setupIntentId: string }> {
    const intent = await this.stripe.setupIntents.create({
      usage: 'off_session',
      metadata: { __daystream_probe: 'connection-test' },
    });
    return { clientSecret: intent.client_secret || '', setupIntentId: intent.id };
  }

  async charge(input: ChargeInput): Promise<AdapterResult> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        payment_method: input.methodToken,
        confirm: true,
        off_session: true,
        description: input.description,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      providerReference: pi.id,
      outcome: this.mapStatus(pi.status),
      amount: pi.amount,
      currency: pi.currency.toUpperCase(),
      failureReason: pi.last_payment_error?.message,
    };
  }

  async refund(input: RefundInput): Promise<AdapterResult> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: input.providerReference, amount: input.amount, reason: undefined },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      providerReference: refund.id,
      outcome: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'pending' ? 'pending' : 'failed',
      amount: refund.amount,
      currency: refund.currency.toUpperCase(),
    };
  }

  /**
   * Read back the masked display of a payment method the client already captured
   * and confirmed (its id arrives in capturePayload.paymentMethodId). We do NOT
   * see raw card data — only brand/last4/expiry from Stripe.
   */
  async tokenize(input: CaptureInput): Promise<TokenResult> {
    const pmId = String((input.capturePayload as any)?.paymentMethodId || '');
    if (!pmId) throw new Error('Stripe tokenize requires a captured paymentMethodId');
    const pm = await this.stripe.paymentMethods.retrieve(pmId);

    // Card: brand + last4 + expiry.
    if (pm.card) {
      return {
        providerToken: pm.id,
        displayBrand: pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1),
        displayLast4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
      };
    }

    // Bank debits: a mandate instrument. No expiry; show scheme + last4.
    if (pm.sepa_debit) {
      return { providerToken: pm.id, displayBrand: 'SEPA Direct Debit', displayLast4: pm.sepa_debit.last4 ?? undefined };
    }
    if (pm.us_bank_account) {
      const bank = pm.us_bank_account.bank_name ? `ACH · ${pm.us_bank_account.bank_name}` : 'ACH Direct Debit';
      return { providerToken: pm.id, displayBrand: bank, displayLast4: pm.us_bank_account.last4 ?? undefined };
    }
    if (pm.bacs_debit) {
      return { providerToken: pm.id, displayBrand: 'Bacs Direct Debit', displayLast4: pm.bacs_debit.last4 ?? undefined };
    }

    // Fallback: whatever type Stripe reports.
    return { providerToken: pm.id, displayBrand: pm.type || 'Bank account' };
  }

  async removeMethod(providerToken: string, _account: ConnectedAccount): Promise<void> {
    try { await this.stripe.paymentMethods.detach(providerToken); } catch { /* already detached */ }
  }

  async getStatus(providerReference: string, _account: ConnectedAccount): Promise<ChargeOutcome> {
    const pi = await this.stripe.paymentIntents.retrieve(providerReference);
    return this.mapStatus(pi.status);
  }

  async listTransactions(_account: ConnectedAccount, range: DateRange): Promise<AdapterTxn[]> {
    const created = { gte: Math.floor(new Date(range.start).getTime() / 1000), lte: Math.floor(new Date(range.end).getTime() / 1000) };
    const pis = await this.stripe.paymentIntents.list({ created, limit: 100 });
    return pis.data.map((pi) => ({
      providerReference: pi.id,
      type: 'charge' as const,
      amount: pi.amount,
      currency: pi.currency.toUpperCase(),
      outcome: this.mapStatus(pi.status),
      occurredAt: new Date(pi.created * 1000).toISOString(),
    }));
  }

  parseWebhook(rawBody: string | Buffer, signature: string): NormalizedEvent {
    if (!this.webhookSecret) throw new Error('Webhook secret not configured');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const map: Record<string, NormalizedEventType> = {
      'payment_intent.succeeded': 'charge.succeeded',
      'payment_intent.payment_failed': 'charge.failed',
      'charge.refunded': 'refund.succeeded',
      'payment_method.updated': 'method.updated',
      'payment_method.automatically_updated': 'method.updated',
    };
    const obj = event.data?.object as any;
    return {
      type: map[event.type] ?? 'unknown',
      providerReference: obj?.id,
      raw: event,
    };
  }

  /**
   * Authenticated, read-only reachability + credential check: retrieve the
   * account balance. Confirms the secret key is valid and Stripe is reachable,
   * and reports whether the key operates in test or live mode.
   *
   * Also validates the publishable key when supplied: Stripe can't verify a
   * publishable key via a server call (it's a public, client-side key), so we
   * check it structurally and confirm its mode matches the authenticated
   * account's mode. This catches a bogus or wrong-mode publishable key, which
   * the secret-key check alone cannot.
   */
  async testConnection(publicConfig?: Record<string, string>): Promise<ConnectionTestResult> {
    let mode: 'test' | 'live';
    try {
      const balance = await this.stripe.balance.retrieve();
      mode = balance.livemode ? 'live' : 'test';
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Could not reach Stripe with the provided credentials.' };
    }

    const pubKey = (publicConfig?.publishable_key || '').trim();
    if (pubKey) {
      const pubMode: 'test' | 'live' | null =
        pubKey.startsWith('pk_live_') ? 'live' : pubKey.startsWith('pk_test_') ? 'test' : null;
      if (pubMode === null) {
        return { ok: false, message: 'The publishable key is not a valid Stripe key (it should start with "pk_test_" or "pk_live_").', mode };
      }
      if (pubMode !== mode) {
        return {
          ok: false,
          mode,
          message: `The publishable key is a ${pubMode} key, but the secret key authenticated in ${mode} mode. Both keys must be from the same (${mode}) mode.`,
        };
      }
    }

    return { ok: true, message: `Connected to Stripe (${mode} mode).`, mode };
  }

  private mapStatus(status: string): ChargeOutcome {
    if (status === 'succeeded') return 'succeeded';
    if (status === 'processing' || status === 'requires_action' || status === 'requires_confirmation') return 'pending';
    return 'failed';
  }
}
