import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../utils/currency';
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

// Method names are shown through checkout:takePayment.method.<value>.
const MANUAL_METHODS = ['cash', 'check', 'bank_transfer', 'other'];
const PROCESSED_METHODS = ['card', 'bank_draw', 'google_pay', 'apple_pay'];

export function TakePaymentModal({
  open, onClose, businessId, customerId, amountCents, bookingId, membershipId, description, onPaid,
}: Props) {
  const { t } = useTranslation('checkout');
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
  // The settled transaction (set on success) — enables the receipt Email/Print/Both choice.
  const [paidTxnId, setPaidTxnId] = useState<string | null>(null);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

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
      setMessage({ ok: false, text: t('takePayment.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [businessId, customerId]);

  useEffect(() => {
    if (open) {
      setMethod(''); setStoredMethodId(''); setGiftCardCode(''); setGiftBalance(null);
      setCheckNumber(''); setMessage(null); setAmount(amountCents ?? 0); setAddingMethod(false);
      setPaidTxnId(null); setReceiptNote(null); setReceiptBusy(false);
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
      if (card.status !== 'active') setMessage({ ok: false, text: t('takePayment.giftCardStatus', { status: t(`takePayment.giftStatus.${card.status}`, { defaultValue: card.status }) }) });
    } catch {
      setGiftBalance(null);
      setMessage({ ok: false, text: t('takePayment.giftNotFound') });
    }
  }

  function friendlyError(code: string | undefined, fallback: string): string {
    switch (code) {
      case 'NO_CONNECTION': return t('takePayment.error.noConnection');
      case 'METHOD_REQUIRED': return t('takePayment.error.methodRequired');
      case 'METHOD_UNAVAILABLE': return t('takePayment.error.methodUnavailable');
      case 'GIFT_CARD_NOT_FOUND': return t('takePayment.giftNotFound');
      case 'GIFT_CARD_INACTIVE': return t('takePayment.error.giftInactive');
      case 'GIFT_CARD_EXPIRED': return t('takePayment.error.giftExpired');
      case 'GIFT_CARD_INSUFFICIENT': return t('takePayment.error.giftInsufficient');
      case 'GIFT_CARD_CURRENCY': return t('takePayment.error.giftCurrency');
      default: return fallback;
    }
  }

  async function handleSubmit() {
    if (!method) { setMessage({ ok: false, text: t('takePayment.chooseMethod') }); return; }
    if (amount <= 0) { setMessage({ ok: false, text: t('takePayment.amountRequired') }); return; }
    // Resolve the effective stored method for the selected class (the select may be
    // showing a fallback first item that isn't yet reflected in state).
    const effectiveStoredId = methodsForSelected.some((m) => m.id === storedMethodId)
      ? storedMethodId : (methodsForSelected[0]?.id ?? '');
    if (isProcessed && !effectiveStoredId) { setMessage({ ok: false, text: t('takePayment.selectOrAdd') }); return; }
    if (isGiftCard && !giftCardCode.trim()) { setMessage({ ok: false, text: t('takePayment.giftCodeRequired') }); return; }

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
        setMessage({ ok: false, text: result.failureReason || t('takePayment.declined') });
      } else {
        const pending = result.status === 'pending';
        const balance = result.giftCardBalanceCents != null ? formatCurrency(result.giftCardBalanceCents) : null;
        const key = pending ? (balance !== null ? 'takePayment.recordedPendingBalance' : 'takePayment.recordedPending') : (balance !== null ? 'takePayment.recordedBalance' : 'takePayment.recorded');
        setMessage({ ok: true, text: t(key, { ref: result.referenceNumber, balance }) });
        setPaidTxnId(result.transactionId);
        onPaid?.(result);
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setMessage({ ok: false, text: friendlyError(code, err?.response?.data?.error || t('takePayment.failed')) });
    } finally {
      setSubmitting(false);
    }
  }

  // Receipt actions offered after a successful manual payment (Email / Print / Both).
  async function emailReceipt(): Promise<boolean> {
    if (!paidTxnId) return false;
    try { await payApi.emailTransaction(paidTxnId, businessId); return true; }
    catch { return false; }
  }
  async function printReceipt(): Promise<boolean> {
    if (!paidTxnId) return false;
    try {
      const blob = await payApi.fetchReceiptPdf(paidTxnId, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch { return false; }
  }
  async function handleReceipt(mode: 'email' | 'print' | 'both') {
    setReceiptBusy(true); setReceiptNote(null);
    const emailed = mode !== 'print' ? await emailReceipt() : null;
    const printed = mode !== 'email' ? await printReceipt() : null;
    setReceiptNote(emailed === true && printed === true ? t('takePayment.receiptBoth')
      : emailed === true ? t('takePayment.receiptEmailed')
      : printed === true ? t('takePayment.receiptPrinted')
      : t('takePayment.receiptFailed'));
    setReceiptBusy(false);
  }

  const processedAvailable = availableMethods.filter((m) => PROCESSED_METHODS.includes(m));
  const manualAvailable = availableMethods.filter((m) => MANUAL_METHODS.includes(m));
  const giftAvailable = availableMethods.includes('gift_card');
  const succeeded = message?.ok === true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('takePayment.title')}
      footer={
        succeeded ? (
          <Button variant="primary" onClick={onClose}>{t('takePayment.done')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
            <Button variant="primary" loading={submitting} disabled={loading} onClick={handleSubmit}>{t('takePayment.takePayment')}</Button>
          </>
        )
      }
    >
      {loading ? (
        <p style={styles.muted}>{t('takePayment.loading')}</p>
      ) : (
        <div style={styles.body}>
          {/* Amount */}
          <div style={styles.field}>
            <label style={styles.label}>{t('takePayment.amount')}</label>
            {amountFixed ? (
              <div style={styles.fixedAmount}>{formatCurrency(amount)}</div>
            ) : (
              <CurrencyInput value={amount} onChange={setAmount} style={styles.input} />
            )}
          </div>

          {/* Method */}
          <div style={styles.field}>
            <label style={styles.label}>{t('takePayment.method')}</label>
            <select style={styles.input} value={method} onChange={(e) => {
              const next = e.target.value as SectionCMethod;
              setMethod(next); setMessage(null); setAddingMethod(false);
              // Pre-select a stored method that matches the new method class.
              const match = storedMethods.find((m) => next === 'bank_draw' ? m.method_type === 'bank_draw' : m.method_type !== 'bank_draw');
              setStoredMethodId(match?.id ?? '');
            }}>
              <option value="">{t('takePayment.selectMethod')}</option>
              {processedAvailable.length > 0 && (
                <optgroup label={t('takePayment.groupProcessed')}>
                  {processedAvailable.map((m) => <option key={m} value={m}>{t(`takePayment.method.${m}`)}</option>)}
                </optgroup>
              )}
              {manualAvailable.length > 0 && (
                <optgroup label={t('takePayment.groupManual')}>
                  {manualAvailable.map((m) => <option key={m} value={m}>{t(`takePayment.method.${m}`)}</option>)}
                </optgroup>
              )}
              {giftAvailable && (
                <optgroup label={t('takePayment.method.gift_card')}>
                  <option value="gift_card">{t('takePayment.method.gift_card')}</option>
                </optgroup>
              )}
            </select>
            {availableMethods.length === 0 && (
              <span style={styles.warn}>{t('takePayment.noAccepted')}</span>
            )}
          </div>

          {/* Processed → pick a stored method, or capture a new one on the spot */}
          {isProcessed && (
            <div style={styles.field}>
              <label style={styles.label}>{t('takePayment.storedMethod')}</label>
              {methodsForSelected.length > 0 && !addingMethod && (
                <select
                  style={styles.input}
                  value={methodsForSelected.some((m) => m.id === storedMethodId) ? storedMethodId : (methodsForSelected[0]?.id ?? '')}
                  onChange={(e) => setStoredMethodId(e.target.value)}
                >
                  {methodsForSelected.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_brand || t(`takePayment.method.${m.method_type}`)}{m.display_last4 ? ` ···· ${m.display_last4}` : ''}{m.is_default ? ` ${t('takePayment.defaultTag')}` : ''}
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
                  label={methodsForSelected.length > 0 ? t('takePayment.addNew') : t('takePayment.addToCharge')}
                  onClick={() => setAddingMethod(true)}
                />
              )}
            </div>
          )}

          {/* Gift card → code + balance lookup */}
          {isGiftCard && (
            <div style={styles.field}>
              <label style={styles.label}>{t('takePayment.giftCode')}</label>
              <div style={styles.row}>
                <input style={{ ...styles.input, flex: 1 }} value={giftCardCode} placeholder={t('takePayment.giftCodePlaceholder')}
                  onChange={(e) => { setGiftCardCode(e.target.value); setGiftBalance(null); }} />
                <Button variant="outline" size="sm" onClick={handleLookupGiftCard}>{t('takePayment.checkBalance')}</Button>
              </div>
              {giftBalance != null && (
                <span style={styles.muted}>{t('takePayment.balance', { amount: formatCurrency(giftBalance) })}</span>
              )}
            </div>
          )}

          {/* Check number (optional) */}
          {method === 'check' && (
            <div style={styles.field}>
              <label style={styles.label}>{t('takePayment.checkNumber')}</label>
              <input style={styles.input} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
            </div>
          )}

          {message && (
            <p style={{ ...styles.msg, color: message.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{message.text}</p>
          )}

          {/* Receipt choice — offered once a manual payment has settled. */}
          {succeeded && paidTxnId && (
            <div style={styles.receiptBox}>
              <span style={styles.label}>{t('takePayment.receipt')}</span>
              <div style={styles.row}>
                <Button variant="outline" size="sm" loading={receiptBusy} onClick={() => handleReceipt('email')}>{t('takePayment.receiptEmail')}</Button>
                <Button variant="outline" size="sm" loading={receiptBusy} onClick={() => handleReceipt('print')}>{t('takePayment.receiptPrint')}</Button>
                <Button variant="outline" size="sm" loading={receiptBusy} onClick={() => handleReceipt('both')}>{t('takePayment.receiptBothButton')}</Button>
              </div>
              {receiptNote && <span style={styles.muted}>{receiptNote}</span>}
            </div>
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
  receiptBox: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' },
};
