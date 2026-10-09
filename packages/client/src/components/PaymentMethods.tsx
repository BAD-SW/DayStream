import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { StripeCardCapture } from './StripeCardCapture';
import { StripeBankCapture } from './StripeBankCapture';
import { StripeAchCapture } from './StripeAchCapture';
import { StripeWalletCapture } from './StripeWalletCapture';
import * as payApi from '../api/payments';
import type { PaymentMethod, MethodType, MethodOwnerParams, BankDebitSchemeId } from '../api/payments';

/**
 * PaymentMethods — the single, reusable payment-method management component
 * (spec phase 10, task 1.7). Reused at every layer by passing a different owner:
 *   - platform  (DayStream's instrument)
 *   - tenant    (a tenant's instrument, charged by DayStream — Section A)
 *   - business  (a business's instrument, charged by its tenant — Section B)
 *   - customer  (a customer's stored method — Section C)
 *
 * Lists stored methods (masked), sets a default, removes, and adds a new method
 * via a capture session. Raw card/bank data never passes through here — with the
 * mock provider the capture payload is empty; with a real provider this is where
 * the hosted card element / mandate / wallet sheet renders.
 */

const METHOD_LABEL: Record<MethodType, string> = {
  card: 'Card',
  bank_draw: 'Bank Draw (direct debit)',
  google_pay: 'Google Pay',
  apple_pay: 'Apple Pay',
};

interface Props {
  owner: MethodOwnerParams;
  /** Which method types may be added here (defaults to the full processed set). */
  allowedTypes?: MethodType[];
  title?: string;
}

export function PaymentMethods({ owner, allowedTypes, title = 'Payment Methods' }: Props) {
  const types = allowedTypes ?? (['card', 'bank_draw', 'google_pay', 'apple_pay'] as MethodType[]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<MethodType>('card');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Stripe capture session (set when the provider returns a SetupIntent to confirm).
  // `methodType` picks card vs bank; for bank, `debitScheme` (resolved server-side
  // from the owner's currency) picks the SEPA vs ACH capture form.
  const [stripeSession, setStripeSession] = useState<{ clientSecret: string; publishableKey: string; methodType: MethodType; debitScheme?: BankDebitSchemeId } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      setMethods(await payApi.listPaymentMethods(owner));
    } catch {
      setErrorMsg('Failed to load payment methods.');
      setMethods([]);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.owner_level, owner.tenant_id, owner.business_id, owner.customer_id]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const session = await payApi.beginCaptureSession(owner, newType);
      // Real Stripe capture (card or bank mandate): render the matching hosted
      // element and defer storing until the SetupIntent is confirmed and we have
      // a payment_method id.
      const needsHostedCapture = newType === 'card' || newType === 'bank_draw'
        || newType === 'google_pay' || newType === 'apple_pay';
      if (needsHostedCapture && session.clientSecret && session.publishableKey) {
        setStripeSession({
          clientSecret: session.clientSecret,
          publishableKey: session.publishableKey,
          methodType: newType,
          debitScheme: session.debitScheme,
        });
        setBusy(false);
        return;
      }
      // Mock / unsupported fallback: store directly (no hosted capture available yet).
      await payApi.storePaymentMethod(owner, newType, {});
      setAdding(false);
      await load();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const serverMsg = err?.response?.data?.error;
      if (code === 'NO_CONNECTION') {
        setErrorMsg('No payment processor is connected for this account yet.');
      } else if (code === 'SCHEME_UNSUPPORTED' || code === 'SCHEME_NOT_IMPLEMENTED') {
        // e.g. a USD tenant before ACH ships, or a currency no scheme covers.
        setErrorMsg(serverMsg || 'Bank draw is not available for this account’s currency.');
      } else {
        setErrorMsg('Could not add the payment method.');
      }
    } finally { setBusy(false); }
  }

  async function handleStripeCaptured(paymentMethodId: string) {
    const methodType = stripeSession?.methodType ?? 'card';
    setBusy(true);
    setErrorMsg(null);
    try {
      await payApi.storePaymentMethod(owner, methodType, { paymentMethodId });
      setStripeSession(null);
      setAdding(false);
      await load();
    } catch {
      setErrorMsg('The payment method was captured but could not be saved.');
    } finally { setBusy(false); }
  }

  function cancelAdd() {
    setAdding(false);
    setStripeSession(null);
    setErrorMsg(null);
  }

  async function handleDefault(id: string) {
    try { await payApi.setDefaultPaymentMethod(id, owner); await load(); }
    catch { setErrorMsg('Could not set default.'); }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove this payment method?')) return;
    try { await payApi.removePaymentMethod(id, owner); await load(); }
    catch { setErrorMsg('Could not remove the method.'); }
  }

  function describe(m: PaymentMethod): string {
    const brand = m.display_brand || METHOD_LABEL[m.method_type] || m.method_type;
    const last4 = m.display_last4 ? ` •••• ${m.display_last4}` : '';
    const exp = m.exp_month && m.exp_year ? ` (exp ${String(m.exp_month).padStart(2, '0')}/${m.exp_year})` : '';
    return `${brand}${last4}${exp}`;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h3 style={styles.title}>{title}</h3>
        {!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add method</Button>}
      </div>

      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      {loading ? (
        <p style={styles.muted}>Loading…</p>
      ) : methods.length === 0 ? (
        <p style={styles.muted}>No payment methods on file.</p>
      ) : (
        <ul style={styles.list}>
          {methods.map((m) => (
            <li key={m.id} style={styles.item}>
              <span style={styles.desc}>
                {describe(m)}
                {m.is_default && <span style={styles.defaultTag}>Default</span>}
              </span>
              <span style={styles.actions}>
                {!m.is_default && (
                  <button type="button" style={styles.linkBtn} onClick={() => handleDefault(m.id)}>Make default</button>
                )}
                <button type="button" style={styles.linkDanger} onClick={() => handleRemove(m.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding && !stripeSession && (
        <div style={styles.addRow}>
          <select
            style={styles.select}
            value={newType}
            onChange={(e) => setNewType(e.target.value as MethodType)}
          >
            {types.map((t) => <option key={t} value={t}>{METHOD_LABEL[t]}</option>)}
          </select>
          <Button size="sm" variant="primary" loading={busy} onClick={handleAdd}>
            {newType === 'card' || newType === 'bank_draw' ? 'Continue' : 'Save'}
          </Button>
          <button type="button" style={styles.linkBtn} onClick={cancelAdd}>Cancel</button>
        </div>
      )}

      {adding && stripeSession && stripeSession.methodType === 'card' && (
        <StripeCardCapture
          clientSecret={stripeSession.clientSecret}
          publishableKey={stripeSession.publishableKey}
          onCaptured={handleStripeCaptured}
          onCancel={cancelAdd}
        />
      )}

      {adding && stripeSession && stripeSession.methodType === 'bank_draw' && stripeSession.debitScheme === 'ach' && (
        <StripeAchCapture
          clientSecret={stripeSession.clientSecret}
          publishableKey={stripeSession.publishableKey}
          onCaptured={handleStripeCaptured}
          onCancel={cancelAdd}
        />
      )}

      {adding && stripeSession && stripeSession.methodType === 'bank_draw' && stripeSession.debitScheme !== 'ach' && (
        <StripeBankCapture
          clientSecret={stripeSession.clientSecret}
          publishableKey={stripeSession.publishableKey}
          onCaptured={handleStripeCaptured}
          onCancel={cancelAdd}
        />
      )}

      {adding && stripeSession && (stripeSession.methodType === 'google_pay' || stripeSession.methodType === 'apple_pay') && (
        <StripeWalletCapture
          clientSecret={stripeSession.clientSecret}
          publishableKey={stripeSession.publishableKey}
          onCaptured={handleStripeCaptured}
          onCancel={cancelAdd}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' },
  title: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm)' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
  item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--control-radius, 8px)' },
  desc: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  defaultTag: { marginLeft: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-success, #17794A)', border: '1px solid var(--color-success, #17794A)', borderRadius: '4px', padding: '1px 6px' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
  linkDanger: { background: 'none', border: 'none', color: 'var(--color-error, #C4291C)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
  addRow: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: 'var(--space-sm)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
