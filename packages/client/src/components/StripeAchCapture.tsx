import { useState } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Button } from '../design-system/components/actions/Button';

/**
 * StripeAchCapture — captures a US bank account (ACH Direct Debit) mandate and
 * confirms a SetupIntent, returning the resulting payment_method id.
 *
 * Unlike SEPA, ACH manual entry has no hosted Stripe Element: the routing and
 * account numbers are passed directly to `confirmUsBankAccountSetup`, so there's
 * no Elements wrapper. ACH still requires the payer to authorize a mandate, so
 * the authorization text must be shown and accepted before confirming. The parent
 * passes the SetupIntent client_secret and the connection's publishable key.
 *
 * Note: ACH debits verify the bank account (micro-deposits / instant) and settle
 * over several days — the mandate vaults immediately; the first debit confirms
 * asynchronously via webhook.
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

export function StripeAchCapture({ clientSecret, publishableKey, creditorName, onCaptured, onCancel }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [holderType, setHolderType] = useState<'individual' | 'company'>('individual');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const creditor = creditorName || 'DayStream';
  const canConfirm =
    !!name.trim() && !!email.trim() && routing.trim().length === 9 && !!account.trim() && accepted;

  async function handleConfirm() {
    setBusy(true); setErr(null);
    const stripe = await stripeFor(publishableKey);
    if (!stripe) {
      setErr('Could not initialize the payment provider. Check the publishable key.');
      setBusy(false);
      return;
    }
    const result = await stripe.confirmUsBankAccountSetup(clientSecret, {
      payment_method: {
        us_bank_account: {
          routing_number: routing.trim(),
          account_number: account.trim(),
          account_holder_type: holderType,
        },
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
      <div style={styles.row}>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>Routing number</label>
          <input style={styles.input} value={routing} onChange={(e) => setRouting(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="9 digits" inputMode="numeric" autoComplete="off" />
        </div>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>Account number</label>
          <input style={styles.input} value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))} placeholder="Account number" inputMode="numeric" autoComplete="off" />
        </div>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Account type</label>
        <select style={styles.input} value={holderType} onChange={(e) => setHolderType(e.target.value as 'individual' | 'company')}>
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </select>
      </div>

      <label style={styles.mandate}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={styles.checkbox} />
        <span style={styles.mandateText}>
          By providing your account information and confirming, you authorize {creditor} and Stripe,
          our payment service provider, to debit your account via the ACH network for the agreed
          amounts, and you authorize your bank to honor those debits. You may revoke this authorization
          by removing this payment method. ACH debits may take several business days to settle.
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

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  row: { display: 'flex', gap: 'var(--space-sm)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  mandate: { display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' },
  checkbox: { marginTop: '3px', flexShrink: 0 },
  mandateText: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 },
  err: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: 0 },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  link: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
};
