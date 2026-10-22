import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListEmpty } from '../design-system/components/data/ListRow';
import { Alert } from '../design-system/components/feedback/Alert';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { StripeOneTimeCardCharge } from '../components/StripeOneTimeCardCharge';
import { formatCurrency } from '../utils/currency';
import { useContextManager } from '../context/ContextManager';
import * as eventsApi from '../api/events';
import { apiClient } from '../api/client';
import type { CustomerEventDetail as Detail, CustomerRegistration, OnlinePayment } from '../api/events';
import { eventDateParts, refundWording } from './CustomerEvents';
import './CustomerEvents.css';

function hoursWording(h: number) {
  return h % 24 === 0 && h >= 24 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

export function CustomerEventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const businessId = useContextManager().activeContext.businessId;
  const [ev, setEv] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tierId, setTierId] = useState('');
  const [people, setPeople] = useState(1);
  const [payAt, setPayAt] = useState<'online' | 'reception'>('online');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<{ registrationId: string; session: OnlinePayment } | null>(null);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const [toCancel, setToCancel] = useState<CustomerRegistration | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await eventsApi.getCustomerEvent(id);
      setEv(data);
      const first = data.tiers.find((t) => t.available);
      setTierId((cur) => (cur && data.tiers.some((t) => t.id === cur && t.available) ? cur : first?.id || ''));
      if (!data.pay_options.online) setPayAt('reception');
    } catch (e: any) { setError(e?.response?.data?.error || 'This event could not be loaded.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !ev) return <ListEmpty>Loading...</ListEmpty>;
  if (!ev) return <><button className="cev-back" onClick={() => navigate('/events')}>← Back to Events</button>{error && <Alert variant="error">{error}</Alert>}</>;

  const tz = ev.timezone;
  const s = eventDateParts(ev.start_time, tz);
  const e = eventDateParts(ev.end_time, tz);
  const tier = ev.tiers.find((t) => t.id === tierId);
  const paid = !!tier && tier.price > 0;
  const subtotal = (tier?.price || 0) * people;
  const tax = paid ? Math.round(subtotal * ev.tax_rate / 10000) : 0;
  const full = ev.places_left <= 0;
  const maxPeople = Math.max(1, Math.min(10, full ? 10 : ev.places_left, tier?.places_left ?? 10));
  const active = ev.my_registrations.filter((r) => r.status === 'confirmed' || r.status === 'pending');
  const waiting = ev.my_waitlist[0];

  // My own customer record for registering: the API resolves the person's record at the
  // hosting business; the one sent is the person's record at their own business.
  const register = async () => {
    if (!tier) return;
    setBusy(true); setError('');
    try {
      const me = await apiClient.get('/v1/profile/customer');
      const customerId = me.data.data?.id;
      const out = await eventsApi.registerForEvent(ev.id, {
        customer_id: customerId, ticket_tier_id: tier.id, group_size: people, pay_at: paid ? payAt : undefined,
      });
      if (out.waitlisted) {
        setDone({ title: 'You are on the waitlist', text: `${ev.title} is full. You are number ${out.position} on the waitlist; if a place opens up, it is offered to the next person on the list.` });
      } else if (out.payment) {
        setPayment({ registrationId: out.id, session: out.payment });
      } else if (out.status === 'pending') {
        setDone({ title: 'Place reserved', text: `${ev.title}, ${s.date} at ${s.time}. Your place is held until the event starts: please pay ${formatCurrency(subtotal + tax, ev.currency)} at reception.` });
      } else {
        setDone({ title: 'You are registered', text: `${ev.title}, ${s.date} at ${s.time}. You can see it in My events.` });
      }
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || 'The registration did not go through.'); }
    finally { setBusy(false); }
  };

  const finishPayment = async (providerReference: string) => {
    if (!payment) return;
    setBusy(true); setError('');
    try {
      await eventsApi.payRegistration(payment.registrationId, providerReference);
      setPayment(null);
      setDone({ title: 'You are registered', text: `${ev.title}, ${s.date} at ${s.time}. Your payment of ${formatCurrency(payment.session.amount, ev.currency)} was received.` });
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || 'The payment did not go through.'); await load(); }
    finally { setBusy(false); }
  };

  const cancelReg = async (r: CustomerRegistration) => {
    setError('');
    try {
      const out = await eventsApi.cancelMyRegistration(r.id);
      setDone({
        title: 'Registration cancelled',
        text: out.refund ? `${formatCurrency(out.refund.amount, ev.currency)} ${out.refund.to === 'credit' ? 'was added to your account credit' : 'will be refunded to your card'}.` : `Your place at ${ev.title} was released.`,
      });
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || 'It could not be cancelled.'); }
  };

  const policy = ev.cancellation.allowed && ev.cancellation.hours_before !== null
    ? `You can cancel online up to ${hoursWording(ev.cancellation.hours_before)} before the event starts. What you paid is returned ${refundWording(ev.cancellation.refund_to)}.`
    : 'Cancelling online is not available for this event. Please contact the business.';

  return (
    <div>
      <button className="cev-back" onClick={() => navigate('/events')}>← Back to Events</button>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="cev-detail">
        <div className="cev-panel">
          {ev.event_type_name && <span className="cev-type">{ev.event_type_name}</span>}
          <h1 className="cev-title" style={{ fontSize: 'var(--page-title-size)' }}>{ev.title}</h1>
          <dl className="cev-facts">
            <dt>Date</dt><dd>{s.date}</dd>
            <dt>Time</dt><dd>{s.time}–{e.time}</dd>
            {ev.location_name && <><dt>Location</dt><dd>{ev.location_name}</dd></>}
            {ev.host_business_name && businessId !== ev.host_business_id && <><dt>Hosted by</dt><dd>{ev.host_business_name}</dd></>}
          </dl>
          <h2 className="cev-h">About this event</h2>
          <p className="cev-p">{ev.description || 'No description yet.'}</p>
          <h2 className="cev-h">Cancellation policy</h2>
          <p className="cev-p">{policy}</p>
        </div>

        <div className="cev-panel">
          {done ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>{done.title}</h2>
              <p className="cev-p">{done.text}</p>
              <div className="cev-row" style={{ justifyContent: 'flex-start', marginTop: 'var(--space-md)' }}>
                <Button size="sm" onClick={() => navigate('/events?tab=mine')}>See My events</Button>
                <Button size="sm" variant="ghost" onClick={() => setDone(null)}>Back to the event</Button>
              </div>
            </>
          ) : payment ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>Pay {formatCurrency(payment.session.amount, ev.currency)}</h2>
              <p className="cev-small">Your place is held for 10 minutes while you pay.</p>
              {payment.session.client_secret && payment.session.publishable_key ? (
                <StripeOneTimeCardCharge
                  clientSecret={payment.session.client_secret}
                  publishableKey={payment.session.publishable_key}
                  busyLabel="Paying…"
                  onPaid={(pi) => finishPayment(pi)}
                  onCancel={() => { setPayment(null); load(); }}
                />
              ) : (
                // Test processor (no card form): the payment succeeds when confirmed.
                <div className="cev-row" style={{ justifyContent: 'flex-start' }}>
                  <Button onClick={() => finishPayment(payment.session.provider_reference)} loading={busy}>Pay (test processor)</Button>
                  <Button variant="ghost" onClick={() => { setPayment(null); load(); }}>Cancel</Button>
                </div>
              )}
            </>
          ) : active.length > 0 || waiting ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>Your registration</h2>
              {active.map((r) => (
                <div key={r.id} className="cev-reg">
                  <div className="cev-row">
                    <span>{r.tier_name || 'Ticket'}{r.group_size > 1 ? ` × ${r.group_size}` : ''}</span>
                    <Badge variant={r.status === 'confirmed' ? 'success' : 'warning'}>
                      {r.status === 'confirmed' ? 'Registered' : r.awaiting_payment === 'online' ? 'Payment not finished' : 'Pay at reception'}
                    </Badge>
                  </div>
                  <div className="cev-row"><span>Reference</span><span>{r.reference_number}</span></div>
                  {r.amount > 0 && <div className="cev-row"><span>{r.paid ? 'Paid' : 'To pay'}</span><span>{formatCurrency(r.amount, ev.currency)}</span></div>}
                  {r.can_cancel && <Button size="sm" variant="secondary" onClick={() => setToCancel(r)}>Cancel registration</Button>}
                  {!r.can_cancel && r.cancel_blocked_reason && <p className="cev-small">{r.cancel_blocked_reason}</p>}
                  {r.can_cancel && r.cancel_until && <p className="cev-small">You can cancel until {eventDateParts(r.cancel_until, tz).date}, {eventDateParts(r.cancel_until, tz).time}.</p>}
                </div>
              ))}
              {waiting && (
                <div className="cev-reg">
                  <div className="cev-row"><span>Waitlist</span><Badge variant="info">{waiting.status === 'notified' ? 'Place offered' : `Number ${waiting.position}`}</Badge></div>
                  <Button size="sm" variant="secondary" onClick={async () => { await eventsApi.leaveWaitlist(waiting.id); await load(); }}>Leave waitlist</Button>
                </div>
              )}
            </>
          ) : !ev.open_for_registration ? (
            <p className="cev-p">Registration is closed for this event.</p>
          ) : (
            <>
              <div className="cev-row" style={{ marginTop: 0 }}>
                <h2 className="cev-h" style={{ margin: 0 }}>Register</h2>
                <span className={full || ev.places_left <= 5 ? 'cev-spots cev-spots--low' : 'cev-spots'}>{full ? 'Full · waitlist open' : `${ev.places_left} ${ev.places_left === 1 ? 'spot' : 'spots'} left`}</span>
              </div>
              <span className="cev-label">Ticket</span>
              <div className="cev-tiers" role="radiogroup" aria-label="Ticket">
                {ev.tiers.length === 0 && <p className="cev-small">No tickets are on sale yet.</p>}
                {ev.tiers.map((t) => (
                  <label key={t.id} className={`cev-tier${t.id === tierId ? ' cev-tier--on' : ''}${t.available ? '' : ' cev-tier--off'}`}>
                    <input type="radio" name="tier" checked={t.id === tierId} disabled={!t.available} onChange={() => setTierId(t.id)} />
                    <span className="cev-tier__name">{t.name}
                      <span className="cev-tier__note">{t.available ? (t.eligibility === 'members_only' ? 'With an active membership' : t.eligibility === 'first_time' ? 'For first-time customers' : (t.description || 'Anyone')) : t.unavailable_reason}</span>
                    </span>
                    <span>{t.price > 0 ? formatCurrency(t.price, ev.currency) : 'Free'}</span>
                  </label>
                ))}
              </div>
              <label className="cev-label" htmlFor="cev-people">People</label>
              <select id="cev-people" className="cev-select" style={{ width: '100%' }} value={people} onChange={(x) => setPeople(Number(x.target.value))}>
                {Array.from({ length: maxPeople }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? '1 (just me)' : n}</option>)}
              </select>
              {paid && (
                <>
                  <div className="cev-row"><span>Tickets</span><span>{formatCurrency(subtotal, ev.currency)}</span></div>
                  {tax > 0 && <div className="cev-row"><span>Tax ({(ev.tax_rate / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%)</span><span>{formatCurrency(tax, ev.currency)}</span></div>}
                </>
              )}
              <div className="cev-row cev-total"><span>Total</span><span>{paid ? formatCurrency(subtotal + tax, ev.currency) : 'Free'}</span></div>
              {paid && !full && (
                <div role="radiogroup" aria-label="How to pay" style={{ margin: 'var(--space-sm) 0' }}>
                  <span className="cev-label">How to pay</span>
                  {ev.pay_options.online && (
                    <label className="cev-row" style={{ justifyContent: 'flex-start' }}>
                      <input type="radio" name="payat" checked={payAt === 'online'} onChange={() => setPayAt('online')} /> Pay online now by card
                    </label>
                  )}
                  <label className="cev-row" style={{ justifyContent: 'flex-start' }}>
                    <input type="radio" name="payat" checked={payAt === 'reception'} onChange={() => setPayAt('reception')} /> Pay at reception (your place is held until the event starts)
                  </label>
                </div>
              )}
              <Button onClick={register} loading={busy} disabled={!tier} style={{ width: '100%' }}>
                {full ? 'Join waitlist' : paid && payAt === 'online' ? 'Continue to payment' : 'Register'}
              </Button>
              <p className="cev-small">When the event is full, you join the waitlist instead.</p>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={() => { if (toCancel) cancelReg(toCancel); }}
        title="Cancel your registration?"
        message={`${ev.title}, ${s.date}. ${toCancel?.paid ? `What you paid is returned ${refundWording(toCancel?.refund_to)}.` : ''}`}
        confirmLabel="Cancel registration"
        cancelLabel="Keep it"
      />
    </div>
  );
}
