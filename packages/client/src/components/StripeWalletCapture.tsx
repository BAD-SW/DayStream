import { useState } from 'react';
import { loadStripe, Stripe, StripeExpressCheckoutElementReadyEvent } from '@stripe/stripe-js';
import { Elements, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';

/**
 * StripeWalletCapture — captures Apple Pay / Google Pay via Stripe's Express
 * Checkout Element and vaults the underlying card for off-session reuse.
 *
 * Wallets are a presentment layer over a card: the wallet sheet returns a card
 * PaymentMethod, which we store (with a mandate) exactly like a typed card, so it
 * can back recurring charges later. The Express Checkout Element renders whichever
 * wallet the device/browser supports (Apple Pay in Safari on a configured device,
 * Google Pay in Chrome); if none is available, the button doesn't render.
 *
 * Validation note: Apple Pay requires HTTPS and an Apple-verified domain, so it
 * cannot render on http://localhost — it's validated once deployed. Google Pay
 * works in supported browsers in test mode.
 */

interface Props {
  clientSecret: string;
  publishableKey: string;
  onCaptured: (paymentMethodId: string) => void;
  onCancel: () => void;
}

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function WalletForm({ clientSecret, onCaptured, onCancel }: Omit<Props, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [err, setErr] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setErr(null);
    // Submit the Element, then confirm the SetupIntent — vaulting the card the
    // wallet returned, with no redirect for wallet methods.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setErr(submitError.message || 'Could not confirm the wallet.');
      return;
    }
    const result = await stripe.confirmSetup({ elements, clientSecret, redirect: 'if_required' });
    if (result.error) {
      setErr(result.error.message || 'Could not save the wallet payment method.');
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (typeof pmId !== 'string') {
      setErr('Wallet setup did not return a payment method.');
      return;
    }
    onCaptured(pmId);
  }

  return (
    <div style={styles.form}>
      <ExpressCheckoutElement
        onConfirm={handleConfirm}
        onReady={(e: StripeExpressCheckoutElementReadyEvent) => {
          // availablePaymentMethods is null/empty when no wallet can render here.
          const avail = e.availablePaymentMethods;
          if (!avail || (!avail.applePay && !avail.googlePay)) setUnavailable(true);
        }}
      />
      {unavailable && (
        <p style={styles.muted}>
          No wallet is available in this browser/device. Apple Pay needs Safari on a configured
          device over HTTPS; Google Pay needs a supported browser with a saved card.
        </p>
      )}
      {err && <p style={styles.err}>{err}</p>}
      <div style={styles.actions}>
        <button type="button" style={styles.link} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function StripeWalletCapture({ clientSecret, publishableKey, onCaptured, onCancel }: Props) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret }}>
      <WalletForm clientSecret={clientSecret} onCaptured={onCaptured} onCancel={onCancel} />
    </Elements>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  err: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: 0 },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  link: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
};
