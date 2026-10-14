import { useState } from 'react';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../design-system/components/actions/Button';

/**
 * StripeOneTimeCardCharge — renders Stripe's hosted Card Element and CONFIRMS a
 * PaymentIntent (one-time charge), returning the confirmed PaymentIntent id.
 *
 * Unlike StripeCardCapture (which confirms a SetupIntent to VAULT a card), this
 * charges the card ONCE and never saves it — the walk-in / card-not-stored path.
 * Card data stays inside Stripe's iframe; raw PANs never reach our form or server.
 * The server created the PaymentIntent and gave us its client_secret; after the
 * browser confirms, the server finalizes by retrieving the intent (authoritative).
 */

interface Props {
  clientSecret: string;
  publishableKey: string;
  onPaid: (paymentIntentId: string) => void;
  onCancel: () => void;
  busyLabel?: string;
}

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function ChargeForm({ clientSecret, onPaid, onCancel, busyLabel }: Omit<Props, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement) as StripeCardElement | null;
    if (!card) return;
    setBusy(true); setErr(null);
    const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } });
    if (result.error) {
      setErr(result.error.message || 'The card could not be charged.');
      setBusy(false);
      return;
    }
    const pi = result.paymentIntent;
    if (!pi || (pi.status !== 'succeeded' && pi.status !== 'processing')) {
      setErr('The payment did not complete.');
      setBusy(false);
      return;
    }
    onPaid(pi.id);
  }

  return (
    <div style={styles.form}>
      <div style={styles.cardBox}>
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      {err && <p style={styles.err}>{err}</p>}
      <div style={styles.actions}>
        <Button size="sm" variant="primary" loading={busy} disabled={!stripe} onClick={handleConfirm}>
          {busyLabel || 'Charge card'}
        </Button>
        <button type="button" style={styles.link} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function StripeOneTimeCardCharge({ clientSecret, publishableKey, onPaid, onCancel, busyLabel }: Props) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret }}>
      <ChargeForm clientSecret={clientSecret} onPaid={onPaid} onCancel={onCancel} busyLabel={busyLabel} />
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
