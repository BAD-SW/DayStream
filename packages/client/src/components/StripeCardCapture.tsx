import { useState } from 'react';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../design-system/components/actions/Button';

/**
 * StripeCardCapture — renders Stripe's hosted Card Element and confirms a
 * SetupIntent, returning the resulting Stripe payment_method id to the caller.
 *
 * Card data is entered inside Stripe's iframe (the CardElement) and never touches
 * our form or servers. The parent passes the SetupIntent client_secret and the
 * connection's publishable key (both from the capture-session call).
 */

interface Props {
  clientSecret: string;
  publishableKey: string;
  onCaptured: (paymentMethodId: string) => void;
  onCancel: () => void;
}

// Cache Stripe instances per publishable key (loadStripe should be called once per key).
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function CardForm({ clientSecret, onCaptured, onCancel }: Omit<Props, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    // getElement is typed as a union across element kinds; narrow to the card
    // element we actually mounted (CardElement) for confirmCardSetup.
    const card = elements.getElement(CardElement) as StripeCardElement | null;
    if (!card) return;
    setBusy(true); setErr(null);
    const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
    if (result.error) {
      setErr(result.error.message || 'Could not save the card.');
      setBusy(false);
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (typeof pmId !== 'string') {
      setErr('Card setup did not return a payment method.');
      setBusy(false);
      return;
    }
    onCaptured(pmId);
  }

  return (
    <div style={styles.form}>
      <div style={styles.cardBox}>
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      {err && <p style={styles.err}>{err}</p>}
      <div style={styles.actions}>
        <Button size="sm" variant="primary" loading={busy} disabled={!stripe} onClick={handleConfirm}>Save card</Button>
        <button type="button" style={styles.link} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function StripeCardCapture({ clientSecret, publishableKey, onCaptured, onCancel }: Props) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret }}>
      <CardForm clientSecret={clientSecret} onCaptured={onCaptured} onCancel={onCancel} />
    </Elements>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' },
  cardBox: { padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--control-radius, 8px)', background: 'var(--color-surface)' },
  err: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: 0 },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  link: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
};
