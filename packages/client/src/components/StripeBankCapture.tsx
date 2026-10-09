import { useState } from 'react';
import { loadStripe, Stripe, StripeIbanElement } from '@stripe/stripe-js';
import { Elements, IbanElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../design-system/components/actions/Button';

/**
 * StripeBankCapture — captures a SEPA Direct Debit mandate via Stripe's IBAN
 * Element and confirms a SetupIntent, returning the resulting payment_method id.
 *
 * SEPA legally requires the payer to authorize a mandate: the IBAN is entered in
 * Stripe's iframe (never touches our form/servers), the payer provides their name
 * and email (required by Stripe for sepa_debit), and must accept the mandate text
 * below before confirming. The parent passes the SetupIntent client_secret and the
 * connection's publishable key (both from the capture-session call).
 *
 * Only SEPA is implemented today; ACH/BACS will add their own elements and reuse
 * this same capture-session -> confirm -> store flow.
 */

interface Props {
  clientSecret: string;
  publishableKey: string;
  /** Creditor shown in the mandate text (who will debit the account). */
  creditorName?: string;
  onCaptured: (paymentMethodId: string) => void;
  onCancel: () => void;
}

// Cache Stripe instances per publishable key (loadStripe should run once per key).
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function BankForm({
  clientSecret, creditorName, onCaptured, onCancel,
}: Omit<Props, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const creditor = creditorName || 'DayStream';
  const canConfirm = !!stripe && !!name.trim() && !!email.trim() && accepted;

  async function handleConfirm() {
    if (!stripe || !elements) return;
    const iban = elements.getElement(IbanElement) as StripeIbanElement | null;
    if (!iban) return;
    setBusy(true); setErr(null);
    const result = await stripe.confirmSepaDebitSetup(clientSecret, {
      payment_method: {
        sepa_debit: iban,
        billing_details: { name: name.trim(), email: email.trim() },
      },
    });
    if (result.error) {
      setErr(result.error.message || 'Could not set up the direct debit mandate.');
      setBusy(false);
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (typeof pmId !== 'string') {
      setErr('Mandate setup did not return a payment method.');
      setBusy(false);
      return;
    }
    onCaptured(pmId);
  }

  return (
    <div style={styles.form}>
      <div style={styles.field}>
        <label style={styles.label}>Account holder name</label>
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on the bank account" autoComplete="off" />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Email</label>
        <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="For the mandate confirmation" autoComplete="off" />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>IBAN</label>
        <div style={styles.ibanBox}>
          <IbanElement options={{ supportedCountries: ['SEPA'], placeholderCountry: 'DE' }} />
        </div>
      </div>

      <label style={styles.mandate}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={styles.checkbox} />
        <span style={styles.mandateText}>
          By providing your IBAN and confirming this payment, you authorize {creditor} and Stripe,
          our payment service provider, to send instructions to your bank to debit your account, and
          your bank to debit your account in accordance with those instructions. You are entitled to a
          refund from your bank under the terms and conditions of your agreement with your bank. A refund
          must be claimed within 8 weeks starting from the date on which your account was debited.
        </span>
      </label>

      {err && <p style={styles.err}>{err}</p>}
      <div style={styles.actions}>
        <Button size="sm" variant="primary" loading={busy} disabled={!canConfirm} onClick={handleConfirm}>
          Set up direct debit
        </Button>
        <button type="button" style={styles.link} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function StripeBankCapture({ clientSecret, publishableKey, creditorName, onCaptured, onCancel }: Props) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret }}>
      <BankForm clientSecret={clientSecret} creditorName={creditorName} onCaptured={onCaptured} onCancel={onCancel} />
    </Elements>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  ibanBox: { padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--control-radius, 8px)', background: 'var(--color-surface)' },
  mandate: { display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' },
  checkbox: { marginTop: '3px', flexShrink: 0 },
  mandateText: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 },
  err: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: 0 },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  link: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
};
