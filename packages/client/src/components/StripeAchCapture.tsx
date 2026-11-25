import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('checkout');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [holderType, setHolderType] = useState<'individual' | 'company'>('individual');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The creditor comes with the capture session (the Stripe account's business); the application's name otherwise.
  const creditor = creditorName || t('common:app_name');
  const canConfirm =
    !!name.trim() && !!email.trim() && routing.trim().length === 9 && !!account.trim() && accepted;

  async function handleConfirm() {
    setBusy(true); setErr(null);
    const stripe = await stripeFor(publishableKey);
    if (!stripe) {
      setErr(t('stripe.initFailed'));
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
      setErr(result.error.message || t('stripe.mandateFailed'));
      setBusy(false);
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (typeof pmId !== 'string') {
      setErr(t('stripe.mandateNoMethod'));
      setBusy(false);
      return;
    }
    onCaptured(pmId);
  }

  return (
    <div style={styles.form}>
      <div style={styles.field}>
        <label style={styles.label}>{t('stripe.holderName')}</label>
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('stripe.holderNamePlaceholder')} autoComplete="off" />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>{t('stripe.email')}</label>
        <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('stripe.emailPlaceholder')} autoComplete="off" />
      </div>
      <div style={styles.row}>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>{t('stripe.routingNumber')}</label>
          <input style={styles.input} value={routing} onChange={(e) => setRouting(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder={t('stripe.routingPlaceholder')} inputMode="numeric" autoComplete="off" />
        </div>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>{t('stripe.accountNumber')}</label>
          <input style={styles.input} value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))} placeholder={t('stripe.accountNumber')} inputMode="numeric" autoComplete="off" />
        </div>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>{t('stripe.accountType')}</label>
        <select style={styles.input} value={holderType} onChange={(e) => setHolderType(e.target.value as 'individual' | 'company')}>
          <option value="individual">{t('stripe.individual')}</option>
          <option value="company">{t('stripe.company')}</option>
        </select>
      </div>

      <label style={styles.mandate}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={styles.checkbox} />
        <span style={styles.mandateText}>
          {t('stripe.achMandate', { creditor })}
        </span>
      </label>

      {err && <p style={styles.err}>{err}</p>}
      <div style={styles.actions}>
        <Button size="sm" variant="primary" loading={busy} disabled={!canConfirm} onClick={handleConfirm}>
          {t('stripe.setUpDirectDebit')}
        </Button>
        <button type="button" style={styles.link} onClick={onCancel} disabled={busy}>{t('common:cancel')}</button>
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
