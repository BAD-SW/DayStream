import { useCallback, useEffect, useRef, useState } from 'react';
import * as bookingsApi from '../../api/bookings';
import * as checkoutApi from '../../api/checkout';
import { apiClient } from '../../api/client';
import type { PaymentMethod } from '../../api/payments';
import { formatCurrency } from '../../utils/currency';
import { initials } from '../../utils/zonedTime';
import { StripeOneTimeCardCharge, StripeDeferredCard } from '../StripeOneTimeCardCharge';
import type { DeferredCardCharge } from '../StripeOneTimeCardCharge';
import { AddPaymentMethodInline } from '../AddPaymentMethodInline';
import { ReceiptActions } from '../ReceiptActions';
import type { BenefitRef } from '../../api/bookings';

// ============================================================
// Step 4 of New Appointment (PAY-1 = A, David 11 Nov 2026; spec 51 gap 5). One screen for both
// Reservation Payment Rules that need a payment method, so they work the same way:
//   charge  "Charged at reservation": paid now
//   hold    "Taken but not charged for reservation": a card or bank account is kept on the booking and
//           charged after the service, at Checkout
// Left: what it costs. Right: a saved card, a new card or a bank account; a new one is entered right
// there. Cash, check and gift cards are taken at Checkout. Nothing is preselected (PAY-6). Split
// payment later (PAY-2); a physical card terminal later (PAY-5).
// ============================================================

interface Saved { id: string; label: string }

interface Quote {
  lines: Array<{ label: string; amount: number }>; total: number; due: number;
  promo: { code: string; ok: boolean; message?: string } | null; credit_needs_split: boolean;
  /** The membership or package chosen in the window (spec 51, gap 19): does it cover the booking, and why not. */
  benefit: { name: string; covers: boolean; reason: string | null; left_after: number | null } | null;
  credit: number; cards: Saved[];
  /** saved bank accounts (SEPA / ACH direct debit) */
  banks: Saved[];
  /** the business's publishable card key, for a walk-in's card field */
  publishable_key?: string | null;
}

export interface BookingDraft {
  customer: any; walk: boolean; walkName: string;
  serviceId: string; serviceName: string; variantId: string; variantName: string; parts: number; ovr: boolean;
  startIso: string; staffId?: string; locationId?: string | null; notes: string;
  whenLabel: string; whoLabel: string;
  /** The membership or package chosen to pay (spec 51, gap 19); null: paid normally. */
  benefit?: BenefitRef | null;
  /** The add-ons chosen (spec 51, gap 15): priced here and booked with it. */
  addons?: string[];
}

type Choice = 'onfile' | 'card' | 'bank';

const pe = (c: number) => (c < 0 ? '−' : '') + formatCurrency(Math.abs(c));
const labelOf = (m: PaymentMethod) => m.method_type === 'bank_draw'
  ? `${m.display_brand || 'Bank account'} ···· ${m.display_last4 || ''}`.trim()
  : `${m.display_brand || 'Card'} ···· ${m.display_last4 || ''}`.trim();

export function PaymentStep({ businessId, draft, mode = 'charge', onBack, onDone }: {
  businessId: string; draft: BookingDraft; mode?: 'charge' | 'hold';
  onBack: () => void; onDone: (message: string) => void;
}) {
  const hold = mode === 'hold';
  const [useCredit, setUseCredit] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<Choice | null>(null); // nothing preselected (PAY-6)
  const [cardId, setCardId] = useState('');
  const [bankId, setBankId] = useState('');
  const [adding, setAdding] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cardSession, setCardSession] = useState<{ orderId: string; clientSecret: string; publishableKey: string } | null>(null);
  // Paid: the order and the message, shown with its receipt before the window closes.
  const [paid, setPaid] = useState<{ orderId: string; message: string } | null>(null);
  // A walk-in's new card: the field is shown at once and charged on Confirm. A booking made by a first
  // attempt (declined card) is kept, so trying again charges the same order, not a second booking.
  const chargeCard = useRef<DeferredCardCharge | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const onCardReady = useCallback((fn: DeferredCardCharge | null) => { chargeCard.current = fn; setCardReady(!!fn); }, []);
  const walkInAttempt = useRef<{ orderId: string; clientSecret: string } | null>(null);

  const customerId: string | null = draft.walk ? null : draft.customer?.id || null;
  const name = draft.walk ? (draft.walkName || 'Walk-in') : `${draft.customer?.first_name || ''} ${draft.customer?.last_name || ''}`.trim();
  const first = name.split(' ')[0];
  const owner = customerId ? { owner_level: 'customer' as const, business_id: businessId, customer_id: customerId } : null;

  useEffect(() => {
    let off = false;
    apiClient.post(`/v1/bookings/payment-quote?business_id=${businessId}`, {
      business_id: businessId, customer_id: customerId, service_id: draft.serviceId, variant_id: draft.variantId,
      participant_count: draft.parts, promo_code: hold ? null : promo || null, use_credit: hold ? false : useCredit,
      benefit: draft.benefit || null, start_time: draft.startIso, addons: draft.addons || [],
    }).then((r) => {
      if (off) return;
      const q: Quote = r.data.data;
      setQuote((prev) => (prev ? { ...q, cards: mergeSaved(q.cards, prev.cards), banks: mergeSaved(q.banks, prev.banks) } : q));
      if (q.cards[0] && !cardId) setCardId(q.cards[0].id);
      if (q.banks[0] && !bankId) setBankId(q.banks[0].id);
    }).catch(() => { if (!off) setError('The price could not be worked out.'); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, customerId, draft.serviceId, draft.variantId, draft.parts, promo, useCredit, hold, draft.benefit, (draft.addons || []).join(',')]);

  const due = quote?.due ?? 0;
  // The membership or package is used only when it covers the booking; otherwise it is paid normally.
  const usedBenefit = draft.benefit && quote?.benefit?.covers !== false ? draft.benefit : null;
  const covered = !hold && !!quote && due === 0;
  const chosenId = method === 'onfile' ? cardId : method === 'bank' ? bankId : '';
  // A new card for a customer is saved first (then it is a card on file); for a walk-in it is taken
  // with the one-time card form after Confirm.
  const newCardForWalkIn = method === 'card' && !customerId;
  const ready = !!quote && !adding && (hold
    ? !!chosenId && agreed
    : !quote.credit_needs_split && (covered || !!chosenId || (newCardForWalkIn && (cardReady || !quote.publishable_key))));
  const btnLabel = hold ? 'Save reservation' : covered ? 'Confirm booking' : `Take ${formatCurrency(due)} and confirm`;

  const pick = (c: Choice) => {
    setMethod(c);
    setAdding(c === 'card' ? !!customerId : c === 'bank' ? !quote?.banks.length : false);
  };

  const saved = (m: PaymentMethod) => {
    const item = { id: m.id, label: labelOf(m) };
    if (m.method_type === 'bank_draw') {
      setQuote((q) => (q ? { ...q, banks: mergeSaved([item], q.banks) } : q)); setBankId(m.id); setMethod('bank');
    } else {
      setQuote((q) => (q ? { ...q, cards: mergeSaved([item], q.cards) } : q)); setCardId(m.id); setMethod('onfile');
    }
    setAdding(false);
  };

  const bookingData = (paymentMethodId?: string) => ({
    business_id: businessId, customer_id: customerId || undefined, walk_in_name: draft.walk ? (draft.walkName || 'Walk-in') : undefined,
    service_id: draft.serviceId, variant_id: draft.variantId, staff_id: draft.staffId, start_time: draft.startIso,
    notes: draft.notes || undefined, participant_count: draft.parts, override_rules: draft.ovr, location_id: draft.locationId || undefined,
    ...(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
    ...(usedBenefit ? { benefit: usedBenefit } : {}),
    ...(draft.addons && draft.addons.length ? { addons: draft.addons } : {}),
  });
  const errText = (err: any, fallback: string) => { const e = err?.response?.data?.error; return typeof e === 'string' ? e : e?.message || err?.message || fallback; };

  const confirm = async () => {
    setSaving(true); setError('');
    if (hold) {
      try {
        await bookingsApi.createBooking(bookingData(chosenId));
        const held = (method === 'bank' ? quote?.banks : quote?.cards)?.find((x) => x.id === chosenId)?.label || 'the payment method';
        onDone(`Reservation saved, ${held} kept and not charged: ${draft.serviceName}, ${draft.whenLabel}`);
      } catch (err) { setError(errText(err, 'The reservation could not be saved.')); setSaving(false); }
      return;
    }
    const paidMessage = `Booking confirmed and paid ${formatCurrency(due)}: ${draft.serviceName}, ${draft.whenLabel}`;
    // Retrying a walk-in card after a decline: same booking and order, same payment.
    if (walkInAttempt.current && chargeCard.current) {
      await chargeWalkIn(walkInAttempt.current.orderId, walkInAttempt.current.clientSecret, paidMessage);
      return;
    }
    let bookingId = '';
    try {
      bookingId = (await bookingsApi.createBooking(bookingData())).id;
    } catch (err) { setError(errText(err, 'The booking could not be created.')); setSaving(false); return; }
    try {
      const r = await apiClient.post(`/v1/bookings/${bookingId}/pay?business_id=${businessId}`, {
        method: covered ? 'covered' : method === 'bank' ? 'bank' : method === 'onfile' ? 'onfile' : 'card',
        payment_method_id: chosenId || null, promo_code: promo || null, use_credit: useCredit, benefit: usedBenefit,
      });
      const res = r.data.data;
      if (res.status === 'card_form') {
        const s = await checkoutApi.beginOneTimeCharge(res.order_id, businessId);
        if (!s.clientSecret || !s.publishableKey) throw new Error('Card payments are not set up for this business.');
        if (chargeCard.current) {
          walkInAttempt.current = { orderId: res.order_id, clientSecret: s.clientSecret };
          await chargeWalkIn(res.order_id, s.clientSecret, paidMessage);
          return;
        }
        setCardSession({ orderId: res.order_id, clientSecret: s.clientSecret, publishableKey: s.publishableKey });
        setSaving(false); return;
      }
      const message = res.order?.status === 'pending' || res.status === 'pending'
        ? `Booking confirmed, bank payment of ${formatCurrency(due)} on its way: ${draft.serviceName}, ${draft.whenLabel}`
        : `Booking confirmed and paid${res.total ? ' ' + formatCurrency(res.total) : ''}: ${draft.serviceName}, ${draft.whenLabel}`;
      if (res.order?.id && res.total > 0) { setPaid({ orderId: res.order.id, message }); setSaving(false); } else onDone(message);
    } catch (err) {
      setError(`The booking is saved but the payment was not taken: ${errText(err, 'unknown reason')}. Take it from the booking's Checkout.`);
      setSaving(false);
    }
  };

  // Charge the walk-in's typed card, then close the order. A declined card leaves the field there to try again.
  async function chargeWalkIn(orderId: string, clientSecret: string, message: string) {
    try {
      const pi = await chargeCard.current!(clientSecret);
      await checkoutApi.completeOrder(orderId, businessId, { payment_method: 'card', one_time_charge_ref: pi });
      walkInAttempt.current = null;
      setPaid({ orderId, message });
    } catch (err) {
      setError(`The card was not charged: ${errText(err, 'unknown reason')}. Check the card and try again, or take the payment at Checkout.`);
    } finally { setSaving(false); }
  }

  const tiles: Array<[Choice, string, string]> = [
    ...(quote?.cards.length ? [['onfile', 'Card on file', quote.cards.find((c) => c.id === cardId)?.label || quote.cards[0].label] as [Choice, string, string]] : []),
    ['card', 'New card', 'enter it here'],
    // a bank account is saved to a customer, so not for a walk-in
    ...(customerId ? [['bank', 'Bank account', quote?.banks.length ? quote.banks.find((b) => b.id === bankId)?.label || quote.banks[0].label : 'direct debit (SEPA / ACH)'] as [Choice, string, string]] : []),
  ];
  const chosenLabel = (method === 'bank' ? quote?.banks : quote?.cards)?.find((x) => x.id === chosenId)?.label;

  return (
    <div className="mk-app">
      <div className="mk-title"><span>New appointment <small>step 4 of 4 · Payment</small></span></div>
      <div className="pay-steps"><span>1 Customer ✓</span><span>2 Service ✓</span><span>3 Date, staff &amp; location ✓</span><b>4 Payment</b></div>
      <div className="pay-a">
        <div className="q-sec"><div className="q-sec-h"><b className="n">4</b> {hold ? 'What it costs' : 'What is paid'}</div><div className="q-sec-b">
          <div className="pay-bk"><span className="av">{draft.walk ? 'W' : initials(name)}</span><div><b>{name}</b><small>{draft.serviceName} {draft.variantName} · {draft.whenLabel}{draft.whoLabel ? ' · ' + draft.whoLabel : ''}</small></div></div>
          {!quote ? <p className="mk-hint">Working out the price…</p> : (
            <>
              <div className="pay-lines">
                {quote.lines.map((l, i) => <div key={i} className={`pay-line${i && l.amount < 0 ? ' sub' : ''}`}><span>{l.label}</span><b>{pe(l.amount)}</b></div>)}
                <div className="pay-line tot"><span>{hold ? 'Due after the service' : 'To pay'}</span><b>{formatCurrency(due)}</b></div>
              </div>
              {hold && <p className="mk-hint">Nothing is charged now. At Checkout, after the service, the card or bank account kept here is charged for the final amount, including anything added.</p>}
              {quote.benefit && !quote.benefit.covers && (
                <p className="mk-warn">{quote.benefit.name} does not cover this: {quote.benefit.reason} Go back to choose another, or it is paid normally.</p>
              )}
              {!hold && quote.credit > 0 && (
                <div className="pay-uses">
                  <span className="q-lab">What {first} already has</span>
                  <label className="pay-use"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> Use account credit <small>{formatCurrency(quote.credit)} available</small></label>
                </div>
              )}
              {!hold && quote.credit_needs_split && <p className="mk-warn">The credit covers part of it: paying the rest with another method needs split payment (PAY-2, later). Untick the credit, or add credit.</p>}
              {!hold && (quote.total > 0 || promo) && (
                <>
                  <div className="pay-promo">
                    <input type="text" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Promotion or discount code" aria-label="Promotion or discount code" />
                    <button type="button" className="btn sec" onClick={() => setPromo(promoInput.trim())} disabled={!promoInput.trim()}>Apply</button>
                  </div>
                  {quote.promo && !quote.promo.ok && <p className="mk-warn">{quote.promo.message || 'This code is not valid.'}</p>}
                </>
              )}
            </>
          )}
        </div></div>

        <div className="q-sec"><div className="q-sec-h">{hold ? 'Card or bank account to keep' : 'How it is paid'}</div><div className="q-sec-b">
          {!quote ? null : paid ? (
            <>
              <p className="pay-zero" role="status">Paid {formatCurrency(due)}. The booking is confirmed.</p>
              <ReceiptActions kind="order" id={paid.orderId} businessId={businessId} />
              <p className="mk-hint">The receipt can also be printed or emailed later, from Orders or the customer's Billing tab.</p>
            </>
          ) : cardSession ? (
            <StripeOneTimeCardCharge clientSecret={cardSession.clientSecret} publishableKey={cardSession.publishableKey} busyLabel="Taking the payment…"
              onPaid={async (pi) => {
                try {
                  await checkoutApi.completeOrder(cardSession.orderId, businessId, { payment_method: 'card', one_time_charge_ref: pi });
                  setPaid({ orderId: cardSession.orderId, message: `Booking confirmed and paid ${formatCurrency(due)}: ${draft.serviceName}, ${draft.whenLabel}` }); setCardSession(null);
                }
                catch (err) { setError(`The card was charged but the order could not be closed: ${errText(err, '')}`); }
              }}
              onCancel={() => { setCardSession(null); setError('The booking is saved, unpaid: take the payment from its Checkout, or choose another method there.'); }} />
          ) : covered ? <p className="pay-zero">Nothing to pay: it is covered. Confirm the booking.</p> : (
            <>
              <div className="pay-tiles">
                {tiles.map(([v, t, sub]) => <button key={v} type="button" className="svc pay-tile" aria-pressed={method === v} onClick={() => pick(v)}>{t}<small>{sub || ' '}</small></button>)}
              </div>
              {method && (
                <div className="pay-det">
                  {adding && owner ? (
                    <AddPaymentMethodInline key={method} owner={owner} allowedTypes={[method === 'bank' ? 'bank_draw' : 'card']}
                      onAdded={saved}
                      onCancel={() => { setAdding(false); if (method === 'card' || !quote.banks.length) setMethod(null); }} />
                  ) : (
                    <>
                      {method === 'onfile' && quote.cards.length > 1 && (
                        <select value={cardId} onChange={(e) => setCardId(e.target.value)} aria-label="Card on file">{quote.cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                      )}
                      {method === 'bank' && quote.banks.length > 1 && (
                        <select value={bankId} onChange={(e) => setBankId(e.target.value)} aria-label="Bank account">{quote.banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                      )}
                      {method === 'onfile' && <p className="mk-hint">{hold ? `${chosenLabel} is kept for the reservation, not charged now.` : `Charges ${chosenLabel} now (Stripe). The receipt goes by email.`}</p>}
                      {method === 'bank' && <p className="mk-hint">{hold ? `${chosenLabel} is kept for the reservation, not charged now.` : `Collects ${formatCurrency(due)} from ${chosenLabel} by direct debit (Stripe). A bank payment takes a few days to arrive.`}</p>}
                      {newCardForWalkIn && (quote.publishable_key
                        ? <><StripeDeferredCard publishableKey={quote.publishable_key} onReady={onCardReady} /><p className="mk-hint">Charged when you confirm. The card is not saved. A physical card terminal is not connected (PAY-5, later).</p></>
                        : <p className="mk-hint">The card form opens when you confirm. A physical card terminal is not connected (PAY-5, later).</p>)}
                    </>
                  )}
                </div>
              )}
              {hold && chosenId && !adding && (
                <label className="pay-use" style={{ marginTop: 'var(--space-md)' }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  {' '}{first} agrees that this {method === 'bank' ? 'bank account' : 'card'} is kept for the reservation and charged after the
                  service, and for a no-show or late-cancellation fee under the business&apos;s policy.
                </label>
              )}
            </>
          )}
        </div></div>
      </div>
      {error && <p className="mk-warn" role="alert">{error}</p>}
      {paid && (
        <div className="q-confirm">
          <div className="q-ctext"><b>Paid {formatCurrency(due)}</b><span>{name} · {draft.serviceName} · {draft.whenLabel}</span></div>
          <span />
          <div className="q-cbtns"><button type="button" className="btn" onClick={() => onDone(paid.message)}>Done</button></div>
        </div>
      )}
      {!cardSession && !paid && (
        <div className="q-confirm">
          <div className="q-ctext"><b>{!quote ? 'Payment' : hold ? `${formatCurrency(due)} due after the service` : `${formatCurrency(due)} to pay`}</b><span>{name} · {draft.serviceName} · {draft.whenLabel}</span></div>
          <span />
          <div className="q-cbtns">
            <button type="button" className="btn ghost" onClick={onBack} disabled={saving}>‹ Back</button>
            <button type="button" className="btn" disabled={!ready || saving} onClick={confirm}>{saving ? 'Working…' : btnLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** New entries first, without duplicates. */
function mergeSaved(first: Saved[], rest: Saved[]): Saved[] {
  return [...first, ...rest.filter((r) => !first.some((f) => f.id === r.id))];
}
