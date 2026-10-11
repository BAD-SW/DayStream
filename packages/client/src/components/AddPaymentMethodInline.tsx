import { useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { StripeCardCapture } from './StripeCardCapture';
import { StripeBankCapture } from './StripeBankCapture';
import { StripeAchCapture } from './StripeAchCapture';
import { StripeWalletCapture } from './StripeWalletCapture';
import * as payApi from '../api/payments';
import type { PaymentMethod, MethodType, MethodOwnerParams, BankDebitSchemeId } from '../api/payments';

/**
 * AddPaymentMethodInline — capture a NEW payment method in the middle of a flow
 * (checkout, take-payment) and hand the stored method back to the caller, so a
 * sale isn't blocked on the method having been vaulted beforehand.
 *
 * Reuses the same capture pipeline as the full PaymentMethods manager:
 * beginCaptureSession → provider hosted element → storePaymentMethod. On success
 * the newly vaulted method is returned via onAdded so the caller can select and
 * charge it immediately.
 */

interface Props {
  owner: MethodOwnerParams;
  /** Which method types may be captured (defaults to card). */
  allowedTypes?: MethodType[];
  onAdded: (method: PaymentMethod) => void;
  onCancel: () => void;
}

const METHOD_LABEL: Record<MethodType, string> = {
  card: 'Card', bank_draw: 'Direct debit', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
};

/** Card-with-plus glyph, matching the common ecommerce "Add new card" affordance. */
export function AddCardIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 24 18" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="3" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="1" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1.6" />
      <line x1="21" y1="4" x2="21" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="17" y1="8" x2="25" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The shared "Add a new card/method" trigger button — spaced and iconed so it
 * reads as a real action, matching a common ecommerce checkout. Used by both the
 * take-payment modal and the order checkout.
 */
export function AddMethodButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={addMethodBtnStyle}>
      <AddCardIcon />
      {label}
    </button>
  );
}

const addMethodBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)',
  marginTop: 'var(--space-sm)', padding: '10px 14px',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)', color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)', fontWeight: 500, fontFamily: 'var(--font-family)',
  cursor: 'pointer', alignSelf: 'flex-start',
};

export function AddPaymentMethodInline({ owner, allowedTypes, onAdded, onCancel }: Props) {
  const types = allowedTypes ?? (['card'] as MethodType[]);
  const [newType, setNewType] = useState<MethodType>(types[0]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [session, setSession] = useState<{ clientSecret: string; publishableKey: string; methodType: MethodType; debitScheme?: BankDebitSchemeId } | null>(null);

  async function begin() {
    setBusy(true); setErrorMsg(null);
    try {
      const s = await payApi.beginCaptureSession(owner, newType);
      const needsHosted = newType === 'card' || newType === 'bank_draw' || newType === 'google_pay' || newType === 'apple_pay';
      if (needsHosted && s.clientSecret && s.publishableKey) {
        setSession({ clientSecret: s.clientSecret, publishableKey: s.publishableKey, methodType: newType, debitScheme: s.debitScheme });
        return;
      }
      // Mock / non-hosted fallback: store directly.
      const stored = await payApi.storePaymentMethod(owner, newType, {});
      onAdded(stored);
    } catch (err: any) {
      setErrorMsg(mapError(err));
    } finally { setBusy(false); }
  }

  async function onCaptured(paymentMethodId: string) {
    setBusy(true); setErrorMsg(null);
    try {
      const stored = await payApi.storePaymentMethod(owner, session?.methodType ?? newType, { paymentMethodId });
      onAdded(stored);
    } catch {
      setErrorMsg('The method was captured but could not be saved.');
    } finally { setBusy(false); }
  }

  function mapError(err: any): string {
    const code = err?.response?.data?.code;
    if (code === 'NO_CONNECTION') return 'No payment processor is connected for this business yet.';
    if (code === 'SCHEME_UNSUPPORTED' || code === 'SCHEME_NOT_IMPLEMENTED') {
      return err?.response?.data?.error || 'Direct debit is not available for this account’s currency.';
    }
    return 'Could not start capture for the new method.';
  }

  function cancel() { setSession(null); setErrorMsg(null); onCancel(); }

  return (
    <div style={styles.wrap}>
      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      {!session && (
        <div style={styles.row}>
          {types.length > 1 && (
            <select style={styles.select} value={newType} onChange={(e) => setNewType(e.target.value as MethodType)}>
              {types.map((t) => <option key={t} value={t}>{METHOD_LABEL[t]}</option>)}
            </select>
          )}
          <Button size="sm" variant="primary" loading={busy} onClick={begin}>Continue</Button>
          <button type="button" style={styles.linkBtn} onClick={cancel}>Cancel</button>
        </div>
      )}

      {session && session.methodType === 'card' && (
        <StripeCardCapture clientSecret={session.clientSecret} publishableKey={session.publishableKey} onCaptured={onCaptured} onCancel={cancel} />
      )}
      {session && session.methodType === 'bank_draw' && session.debitScheme === 'ach' && (
        <StripeAchCapture clientSecret={session.clientSecret} publishableKey={session.publishableKey} onCaptured={onCaptured} onCancel={cancel} />
      )}
      {session && session.methodType === 'bank_draw' && session.debitScheme !== 'ach' && (
        <StripeBankCapture clientSecret={session.clientSecret} publishableKey={session.publishableKey} onCaptured={onCaptured} onCancel={cancel} />
      )}
      {session && (session.methodType === 'google_pay' || session.methodType === 'apple_pay') && (
        <StripeWalletCapture clientSecret={session.clientSecret} publishableKey={session.publishableKey} onCaptured={onCaptured} onCancel={cancel} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)', background: 'var(--color-background)' },
  row: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' },
  select: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm)' },
};
