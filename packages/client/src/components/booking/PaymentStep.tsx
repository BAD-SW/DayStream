import { useEffect, useState } from 'react';
import * as bookingsApi from '../../api/bookings';
import * as checkoutApi from '../../api/checkout';
import { apiClient } from '../../api/client';
import { formatCurrency } from '../../utils/currency';
import { initials } from '../../utils/zonedTime';
import { StripeOneTimeCardCharge } from '../StripeOneTimeCardCharge';

// ============================================================
// Payment step = step 4 of New Appointment (PAY-1 = A, David 11 Nov 2026; DayStream Hub → Designs →
// Payment step). "What is paid" (lines, what the customer already has, a code) and "How it is paid"
// (method tiles or Pay later). Nothing is preselected (PAY-6). Two methods on one booking = split
// payment, later (PAY-2); a physical card terminal, later (PAY-5).
// ============================================================

interface Quote {
  lines: Array<{ label: string; amount: number }>; total: number; due: number;
  promo: { code: string; ok: boolean; message?: string } | null; credit_needs_split: boolean;
  membership: { name: string; access: string; percent: number } | null;
  package: { purchase_id: string; item_id: string; name: string; left: number } | null;
  credit: number; cards: Array<{ id: string; label: string }>;
}

export interface BookingDraft {
  customer: any; walk: boolean; walkName: string;
  serviceId: string; serviceName: string; variantId: string; variantName: string; parts: number; ovr: boolean;
  startIso: string; staffId?: string; locationId?: string | null; notes: string;
  whenLabel: string; whoLabel: string;
}

const pe = (c: number) => (c < 0 ? '−' : '') + formatCurrency(Math.abs(c));

export function PaymentStep({ businessId, draft, onBack, onClose, onDone }: {
  businessId: string; draft: BookingDraft; onBack: () => void; onClose: () => void; onDone: (message: string) => void;
}) {
  const [usePkg, setUsePkg] = useState(true);
  const [useCredit, setUseCredit] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<string | null>(null); // nothing preselected (PAY-6)
  const [later, setLater] = useState(false);
  const [cardId, setCardId] = useState('');
  const [cash, setCash] = useState('');
  const [ref, setRef] = useState('');
  const [gift, setGift] = useState('');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cardSession, setCardSession] = useState<{ orderId: string; clientSecret: string; publishableKey: string; bookingId: string } | null>(null);

  const customerId = draft.walk ? null : draft.customer?.id || null;
  const name = draft.walk ? (draft.walkName || 'Walk-in') : `${draft.customer?.first_name || ''} ${draft.customer?.last_name || ''}`.trim();
  const first = name.split(' ')[0];

  useEffect(() => {
    let off = false;
    apiClient.post(`/v1/bookings/payment-quote?business_id=${businessId}`, {
      business_id: businessId, customer_id: customerId, service_id: draft.serviceId, variant_id: draft.variantId,
      participant_count: draft.parts, promo_code: promo || null, use_package: usePkg, use_credit: useCredit,
    }).then((r) => { if (!off) { setQuote(r.data.data); if (r.data.data.cards?.[0] && !cardId) setCardId(r.data.data.cards[0].id); } })
      .catch(() => { if (!off) setError('The payment could not be worked out.'); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, customerId, draft.serviceId, draft.variantId, draft.parts, promo, usePkg, useCredit]);

  const due = quote?.due ?? 0;
  const covered = !!quote && due === 0;
  const giftOk = gift.trim().length > 0;
  const cashCents = Math.round(parseFloat((cash || '0').replace(',', '.')) * 100) || 0;
  const ready = !!quote && !quote.credit_needs_split && (covered || later || (!!method && (method !== 'gift' || giftOk) && (method !== 'cash' || !cash || cashCents >= due) && (method !== 'onfile' || !!cardId)));
  const btnLabel = covered ? 'Confirm booking' : later ? 'Confirm, pay later' : `Take ${formatCurrency(due)} and confirm`;

  const confirm = async () => {
    setSaving(true); setError('');
    let bookingId = '';
    try {
      const bk = await bookingsApi.createBooking({
        business_id: businessId, customer_id: customerId || undefined, walk_in_name: draft.walk ? (draft.walkName || 'Walk-in') : undefined,
        service_id: draft.serviceId, variant_id: draft.variantId, staff_id: draft.staffId, start_time: draft.startIso,
        notes: draft.notes || undefined, participant_count: draft.parts, override_rules: draft.ovr, location_id: draft.locationId || undefined,
      });
      bookingId = bk.id;
    } catch (err: any) {
      const e = err?.response?.data?.error; setError(typeof e === 'string' ? e : e?.message || 'The booking could not be created.'); setSaving(false); return;
    }
    try {
      const r = await apiClient.post(`/v1/bookings/${bookingId}/pay?business_id=${businessId}`, {
        method: covered ? 'covered' : later ? 'later' : method, payment_method_id: cardId || null, gift_card_code: gift || null,
        reference: method === 'transfer' ? ref : method === 'other' ? other : null, cash_received: method === 'cash' && cash ? cashCents : null,
        promo_code: promo || null, use_package: usePkg, use_credit: useCredit,
      });
      const res = r.data.data;
      if (res.status === 'card_form') {
        const s = await checkoutApi.beginOneTimeCharge(res.order_id, businessId);
        if (!s.clientSecret || !s.publishableKey) throw new Error('Card payments are not set up for this business.');
        setCardSession({ orderId: res.order_id, clientSecret: s.clientSecret, publishableKey: s.publishableKey, bookingId });
        setSaving(false); return;
      }
      onDone(res.status === 'unpaid' ? `Booking confirmed, to pay later (${formatCurrency(due)}): ${draft.serviceName}, ${draft.whenLabel}` : `Booking confirmed and paid${res.total ? ' ' + formatCurrency(res.total) : ''}: ${draft.serviceName}, ${draft.whenLabel}`);
    } catch (err: any) {
      const e = err?.response?.data?.error;
      setError(`The booking is saved but the payment was not taken: ${typeof e === 'string' ? e : e?.message || err?.message || 'unknown reason'}. Take it from the booking's Checkout.`);
      setSaving(false);
    }
  };

  const tiles: Array<[string, string, string]> = [
    ...(quote?.cards.length ? [['onfile', 'Card on file', quote.cards[0].label] as [string, string, string]] : []),
    ['card', 'Card', 'card form'], ['cash', 'Cash', 'change worked out'], ['transfer', 'Bank transfer', 'with a reference'], ['gift', 'Gift card', 'by code'], ['other', 'Other', ''],
  ];
  const quick = due > 0 ? [due, Math.ceil(due / 1000) * 1000, Math.ceil(due / 5000) * 5000].filter((x, i, a) => a.indexOf(x) === i) : [];

  return (
    <div className="mk-app">
      <div className="mk-title"><span>New appointment <small>step 4 of 4 · Payment</small></span><button type="button" className="mk-x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="pay-steps"><span>1 Customer ✓</span><span>2 Service ✓</span><span>3 Date, staff &amp; location ✓</span><b>4 Payment</b></div>
      {cardSession ? (
        <div className="q-sec"><div className="q-sec-h">Card</div><div className="q-sec-b">
          <StripeOneTimeCardCharge clientSecret={cardSession.clientSecret} publishableKey={cardSession.publishableKey} busyLabel="Taking the payment…"
            onPaid={async (pi) => {
              try { await checkoutApi.completeOrder(cardSession.orderId, businessId, { payment_method: 'card', one_time_charge_ref: pi }); onDone(`Booking confirmed and paid ${formatCurrency(due)}: ${draft.serviceName}, ${draft.whenLabel}`); }
              catch (err: any) { const e = err?.response?.data?.error; setError(`The card was charged but the order could not be closed: ${typeof e === 'string' ? e : e?.message || ''}`); }
            }}
            onCancel={() => { setCardSession(null); setError('The booking is saved, unpaid: take the payment from its Checkout, or choose another method there.'); }} />
        </div></div>
      ) : (
        <div className="pay-a">
          <div className="q-sec"><div className="q-sec-h"><b className="n">4</b> What is paid</div><div className="q-sec-b">
            <div className="pay-bk"><span className="av">{draft.walk ? 'W' : initials(name)}</span><div><b>{name}</b><small>{draft.serviceName} {draft.variantName} · {draft.whenLabel}{draft.whoLabel ? ' · ' + draft.whoLabel : ''}</small></div></div>
            {!quote ? <p className="mk-hint">Working out the price…</p> : (
              <>
                <div className="pay-lines">
                  {quote.lines.map((l, i) => <div key={i} className={`pay-line${i && l.amount < 0 ? ' sub' : ''}`}><span>{l.label}</span><b>{pe(l.amount)}</b></div>)}
                  <div className="pay-line tot"><span>To pay</span><b>{formatCurrency(due)}</b></div>
                </div>
                {(quote.package || quote.credit > 0 || quote.membership) && (
                  <div className="pay-uses">
                    <span className="q-lab">What {first} already has</span>
                    {quote.package && <label className="pay-use"><input type="checkbox" checked={usePkg} onChange={(e) => setUsePkg(e.target.checked)} /> Use 1 session of <b>{quote.package.name}</b> <small>{quote.package.left} left</small></label>}
                    {quote.credit > 0 && <label className="pay-use"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> Use account credit <small>{formatCurrency(quote.credit)} available</small></label>}
                    {quote.membership && <p className="pay-use"><b>{quote.membership.name} member</b> <small>applied automatically</small></p>}
                  </div>
                )}
                {quote.credit_needs_split && <p className="mk-warn">The credit covers part of it: paying the rest with another method needs split payment (PAY-2, later). Untick the credit, or add credit.</p>}
                {(quote.total > 0 || promo) && (
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
          <div className="q-sec"><div className="q-sec-h">How it is paid</div><div className="q-sec-b">
            {!quote ? null : covered ? <p className="pay-zero">Nothing to pay: it is covered. Confirm the booking.</p> : (
              <>
                <div className="pay-tiles">
                  {tiles.map(([v, t, sub]) => <button key={v} type="button" className="svc pay-tile" aria-pressed={method === v && !later} onClick={() => { setMethod(v); setLater(false); }}>{t}<small>{sub || ' '}</small></button>)}
                  <button type="button" className="svc pay-tile later" aria-pressed={later} onClick={() => { setLater(true); setMethod(null); }}>Pay later<small>at reception / on the day</small></button>
                </div>
                {(later || method) && (
                  <div className="pay-det">
                    {later && <p className="mk-hint">The booking is confirmed unpaid. Front desk takes the payment at check-in (Checkout from the booking). {formatCurrency(due)} stays open on the customer.</p>}
                    {method === 'onfile' && (
                      <>
                        {quote.cards.length > 1 && <select value={cardId} onChange={(e) => setCardId(e.target.value)} aria-label="Card on file">{quote.cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}
                        <p className="mk-hint">Charges {quote.cards.find((c) => c.id === cardId)?.label} now (Stripe). The receipt goes by email.</p>
                      </>
                    )}
                    {method === 'card' && <p className="mk-hint">Online card form (Stripe) for a card not saved yet; it opens after you confirm. A physical card terminal is not connected (PAY-5, later).</p>}
                    {method === 'cash' && (
                      <>
                        <div className="pay-cash">
                          <label>Amount received <input type="text" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder={(due / 100).toFixed(2)} /></label>
                          <span className="pay-change">{cashCents ? (cashCents >= due ? <>Change: <b>{formatCurrency(cashCents - due)}</b></> : <span className="pay-short">{formatCurrency(due - cashCents)} short</span>) : null}</span>
                        </div>
                        <div className="chips">{quick.map((x) => <button key={x} type="button" className="ch" onClick={() => setCash((x / 100).toFixed(2))}>{formatCurrency(x)}</button>)}</div>
                      </>
                    )}
                    {method === 'transfer' && <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transfer reference (optional)" aria-label="Transfer reference" />}
                    {method === 'gift' && <input type="text" value={gift} onChange={(e) => setGift(e.target.value)} placeholder="Gift card code" aria-label="Gift card code" />}
                    {method === 'gift' && <p className="mk-hint">The gift card must cover {formatCurrency(due)}; paying the rest with another method needs split payment (PAY-2, later).</p>}
                    {method === 'other' && <input type="text" value={other} onChange={(e) => setOther(e.target.value)} placeholder="What was used (e.g. voucher from a partner)" aria-label="Other method" />}
                  </div>
                )}
              </>
            )}
          </div></div>
        </div>
      )}
      {error && <p className="mk-warn" role="alert">{error}</p>}
      {!cardSession && (
        <div className="q-confirm">
          <div className="q-ctext"><b>{quote ? `${formatCurrency(due)} to pay` : 'Payment'}</b><span>{name} · {draft.serviceName} · {draft.whenLabel}</span></div>
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
