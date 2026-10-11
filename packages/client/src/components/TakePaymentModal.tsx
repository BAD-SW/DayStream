import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../design-system/components/feedback/Modal';
import { Button } from '../design-system/components/actions/Button';
import { CurrencyInput } from './CurrencyInput';
import { AddPaymentMethodInline, AddMethodButton } from './AddPaymentMethodInline';
import * as payApi from '../api/payments';
import type { PaymentMethod, SectionCMethod, ChargeResult, MethodType } from '../api/payments';

/**
 * TakePaymentModal — the Section C "take a payment" surface (task 4.10 / C1).
 *
 * Lets staff collect a one-time payment from a customer. The method list is the
 * business's accepted methods (availability resolver), grouped by how they settle:
 *   - processed (card / direct debit / wallet): charges a stored vault method
 *   - manual-record (cash / check / bank transfer / other): recorded only
 *   - gift card: redeemed (full/partial) against a looked-up balance
 */

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: string;
  customerId: string;
  /** Fixed amount (cents) when paying for a specific thing; omit to let staff enter it. */
  amountCents?: number;
  bookingId?: string | null;
  membershipId?: string | null;
  description?: string | null;
  onPaid?: (result: ChargeResult) => void;
}

const MANUAL_LABEL: Record<string, string> = {
  cash: 'Cash', check: 'Check', bank_transfer: 'Bank transfer', other: 'Other',
};
const PROCESSED_LABEL: Record<string, string> = {
  card: 'Card', bank_draw: 'Direct debit', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
};

export function TakePaymentModal({
  open, onClose, businessId, customerId, amountCents, bookingId, membershipId, description, onPaid,
}: Props) {
  const [availableMethods, setAvailableMethods] = useState<string[]>([]);
  const [storedMethods, setStoredMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const [method, setMethod] = useState<SectionCMethod | ''>('');
  const [amount, setAmount] = useState<number>(amountCents ?? 0);
  const [storedMethodId, setStoredMethodId] = useState<string>('');
  const [addingMethod, setAddingMethod] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftBalance, setGiftBalance] = useState<number | null>(null);
  const [checkNumber, setCheckNumber] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [avail, stored] = await Promise.all([
        payApi.getAvailableMethods(businessId, false),
        payApi.listPaymentMethods({ owner_level: 'customer', business_id: businessId, customer_id: customerId }),
      ]);
      setAvailableMethods(avail.map((a) => a.method));
      setStoredMethods(stored);
      const defaultStored = stored.find((m) => m.is_default) ?? stored[0];
      if (defaultStored) setStoredMethodId(defaultStored.id);
    } catch {
      setMessage({ ok: false, text: 'Could not load payment methods for this business.' });
    } finally {
      setLoading(false);
    }
  }, [businessId, customerId]);

  useEffect(() => {
    if (open) {
      setMethod(''); setStoredMethodId(''); setGiftCardCode(''); setGiftBalance(null);
      setCheckNumber(''); setMessage(null); setAmount(amountCents ?? 0); setAddingMethod(false);
      load();
    }
  }, [open, amountCents, load]);

  const isProcessed = method === 'card' || method === 'bank_draw' || method === 'google_pay' || method === 'apple_pay';
  const isGiftCard = method === 'gift_card';
  const amountFixed = amountCents != null;

  // Only show stored methods that match the selected method class: card/wallets
  // are card-backed and interchangeable; bank_draw lists only direct-debit mandates.
  const methodsForSelected = storedMethods.filter((m) =>
    method === 'bank_draw' ? m.method_type === 'bank_draw' : m.method_type !== 'bank_draw',
  );

  function handleMethodAdded(m: PaymentMethod) {
    setStoredMethods((prev) => [m, ...prev.filter((x) => x.id !== m.id)]);
    setStoredMethodId(m.id);
    setAddingMethod(false);
    setMessage(null);
  }

  async function handleLookupGiftCard() {
    if (!giftCardCode.trim()) return;
    setMessage(null);
    try {
      const card = await payApi.lookupGiftCard(giftCardCode.trim(), businessId);
      setGiftBalance(card.balance_cents);
      if (card.status !== 'active') setMessage({ ok: false, text: `Gift card is ${card.status}.` });
    } catch {
      setGiftBalance(null);
      setMessage({ ok: false, text: 'Gift card not found for this business.' });
    }
  }

  function friendlyError(code: string | undefined, fallback: string): string {
    switch (code) {
      case 'NO_CONNECTION': return 'This business has no active payment processor connected.';
      case 'METHOD_REQUIRED': return 'Select a stored payment method to charge.';
      case 'METHOD_UNAVAILABLE': return 'That stored method is no longer available.';
      case 'GIFT_CARD_NOT_FOUND': return 'Gift card not found for this business.';
      case 'GIFT_CARD_INACTIVE': return 'This gift card is not active.';
      case 'GIFT_CARD_EXPIRED': return 'This gift card has expired.';
      case 'GIFT_CARD_INSUFFICIENT': return 'The gift card balance is less than the amount.';
      case 'GIFT_CARD_CURRENCY': return 'The gift card currency does not match this business.';
      default: return fallback;
    }
  }

  async function handleSubmit() {
    if (!method) { setMessage({ ok: false, text: 'Choose a payment method.' }); return; }
    if (amount <= 0) { setMessage({ ok: false, text: 'Enter an amount greater than zero.' }); return; }
    // Resolve the effective stored method for the selected class (the select may be
    // showing a fallback first item that isn't yet reflected in state).
    const effectiveStoredId = methodsForSelected.some((m) => m.id === storedMethodId)
      ? storedMethodId : (methodsForSelected[0]?.id ?? '');
    if (isProcessed && !effectiveStoredId) { setMessage({ ok: false, text: 'Select or add a payment method.' }); return; }
    if (isGiftCard && !giftCardCode.trim()) { setMessage({ ok: false, text: 'Enter a gift card code.' }); return; }

    setSubmitting(true); setMessage(null);
    try {
      const result = await payApi.takeCharge({
        business_id: businessId,
        customer_id: customerId,
        method,
        amount,
        payment_method_id: isProcessed ? effectiveStoredId : null,
        gift_card_code: isGiftCard ? giftCardCode.trim() : null,
        booking_id: bookingId ?? null,
        membership_id: membershipId ?? null,
        description: description ?? null,
        check_number: method === 'check' ? (checkNumber || null) : null,
      });
      if (result.status === 'failed') {
        setMessage({ ok: false, text: result.failureReason || 'The payment was declined.' });
      } else {
        const pending = result.status === 'pending' ? ' (pending — bank debits settle in a few days)' : '';
        const bal = result.giftCardBalanceCents != null ? ` Gift card balance: ${(result.giftCardBalanceCents / 100).toFixed(2)}.` : '';
        setMessage({ ok: true, text: `Payment recorded — ref ${result.referenceNumber}${pending}.${bal}` });
        onPaid?.(result);
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setMessage({ ok: false, text: friendlyError(code, err?.response?.data?.error || 'Failed to take payment.') });
    } finally {
      setSubmitting(false);
    }
  }

  const processedAvailable = availableMethods.filter((m) => PROCESSED_LABEL[m]);
  const manualAvailable = availableMethods.filter((m) => MANUAL_LABEL[m]);
  const giftAvailable = availableMethods.includes('gift_card');
  const succeeded = message?.ok === true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Payment"
      footer={
        succeeded ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={submitting} disabled={loading} onClick={handleSubmit}>Take payment</Button>
          </>
        )
      }
    >
      {loading ? (
        <p style={styles.muted}>Loading payment methods…</p>
      ) : (
        <div style={styles.body}>
          {/* Amount */}
          <div style={styles.field}>
            <label style={styles.label}>Amount</label>
            {amountFixed ? (
              <div style={styles.fixedAmount}>{(amount / 100).toFixed(2)}</div>
            ) : (
              <CurrencyInput value={amount} onChange={setAmount} style={styles.input} />
            )}
          </div>

          {/* Method */}
          <div style={styles.field}>
            <label style={styles.label}>Method</label>
            <select style={styles.input} value={method} onChange={(e) => {
              const next = e.target.value as SectionCMethod;
              setMethod(next); setMessage(null); setAddingMethod(false);
              // Pre-select a stored method that matches the new method class.
              const match = storedMethods.find((m) => next === 'bank_draw' ? m.method_type === 'bank_draw' : m.method_type !== 'bank_draw');
              setStoredMethodId(match?.id ?? '');
            }}>
              <option value="">Select a method…</option>
              {processedAvailable.length > 0 && (
                <optgroup label="Card / Direct debit">
                  {processedAvailable.map((m) => <option key={m} value={m}>{PROCESSED_LABEL[m]}</option>)}
                </optgroup>
              )}
              {manualAvailable.length > 0 && (
                <optgroup label="Record only">
                  {manualAvailable.map((m) => <option key={m} value={m}>{MANUAL_LABEL[m]}</option>)}
                </optgroup>
              )}
              {giftAvailable && (
                <optgroup label="Gift card">
                  <option value="gift_card">Gift card</option>
                </optgroup>
              )}
            </select>
            {availableMethods.length === 0 && (
              <span style={styles.warn}>This business has no accepted payment methods configured.</span>
            )}
          </div>

          {/* Processed → pick a stored method, or capture a new one on the spot */}
          {isProcessed && (
            <div style={styles.field}>
              <label style={styles.label}>Payment card / method</label>
              {methodsForSelected.length > 0 && !addingMethod && (
                <select
                  style={styles.input}
                  value={methodsForSelected.some((m) => m.id === storedMethodId) ? storedMethodId : (methodsForSelected[0]?.id ?? '')}
                  onChange={(e) => setStoredMethodId(e.target.value)}
                >
                  {methodsForSelected.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_brand || m.method_type}{m.display_last4 ? ` ···· ${m.display_last4}` : ''}{m.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {addingMethod ? (
                <AddPaymentMethodInline
                  owner={{ owner_level: 'customer', business_id: businessId, customer_id: customerId }}
                  allowedTypes={[method as MethodType]}
                  onAdded={handleMethodAdded}
                  onCancel={() => setAddingMethod(false)}
                />
              ) : (
                <AddMethodButton
                  label={methodsForSelected.length > 0 ? 'Add a new card / method' : 'Add a card / method to charge'}
                  onClick={() => setAddingMethod(true)}
                />
              )}
            </div>
          )}

          {/* Gift card → code + balance lookup */}
          {isGiftCard && (
            <div style={styles.field}>
              <label style={styles.label}>Gift card code</label>
              <div style={styles.row}>
                <input style={{ ...styles.input, flex: 1 }} value={giftCardCode} placeholder="GC-XXXX-XXXX"
                  onChange={(e) => { setGiftCardCode(e.target.value); setGiftBalance(null); }} />
                <Button variant="outline" size="sm" onClick={handleLookupGiftCard}>Check balance</Button>
              </div>
              {giftBalance != null && (
                <span style={styles.muted}>Balance: {(giftBalance / 100).toFixed(2)}</span>
              )}
            </div>
          )}

          {/* Check number (optional) */}
          {method === 'check' && (
            <div style={styles.field}>
              <label style={styles.label}>Check number (optional)</label>
              <input style={styles.input} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
            </div>
          )}

          {message && (
            <p style={{ ...styles.msg, color: message.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{message.text}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-base)' },
  fixedAmount: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  row: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  warn: { fontSize: 'var(--font-size-sm)', color: 'var(--color-warning)' },
  msg: { fontSize: 'var(--font-size-sm)', margin: 0 },
};
