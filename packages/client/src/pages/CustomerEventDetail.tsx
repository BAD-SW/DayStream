import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListEmpty } from '../design-system/components/data/ListRow';
import { Alert } from '../design-system/components/feedback/Alert';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { StripeOneTimeCardCharge } from '../components/StripeOneTimeCardCharge';
import { formatCurrency } from '../utils/currency';
import { formatNumber } from '../utils/format';
import { useContextManager } from '../context/ContextManager';
import * as eventsApi from '../api/events';
import { apiClient } from '../api/client';
import type { CustomerEventDetail as Detail, CustomerRegistration, OnlinePayment } from '../api/events';
import { eventDateParts, refundWording } from './CustomerEvents';
import './CustomerEvents.css';

function hoursWording(h: number, t: TFunction) {
  return h % 24 === 0 && h >= 24 ? t('eventDetail.days', { count: h / 24 }) : t('eventDetail.hours', { count: h });
}

export function CustomerEventDetail() {
  const { t } = useTranslation('portal');
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
      const first = data.tiers.find((x) => x.available);
      setTierId((cur) => (cur && data.tiers.some((x) => x.id === cur && x.available) ? cur : first?.id || ''));
      if (!data.pay_options.online) setPayAt('reception');
    } catch (e: any) { setError(e?.response?.data?.error || t('eventDetail.loadFailed')); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !ev) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  if (!ev) return <><button className="cev-back" onClick={() => navigate('/events')}>{t('eventDetail.backToEvents')}</button>{error && <Alert variant="error">{error}</Alert>}</>;

  const tz = ev.timezone;
  const s = eventDateParts(ev.start_time, tz);
  const e = eventDateParts(ev.end_time, tz);
  const tier = ev.tiers.find((x) => x.id === tierId);
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
        setDone({ title: t('eventDetail.waitlistTitle'), text: t('eventDetail.waitlistText', { title: ev.title, position: out.position }) });
      } else if (out.payment) {
        setPayment({ registrationId: out.id, session: out.payment });
      } else if (out.status === 'pending') {
        setDone({ title: t('eventDetail.reservedTitle'), text: t('eventDetail.reservedText', { title: ev.title, date: s.date, time: s.time, amount: formatCurrency(subtotal + tax, ev.currency) }) });
      } else {
        setDone({ title: t('eventDetail.registeredTitle'), text: t('eventDetail.registeredText', { title: ev.title, date: s.date, time: s.time }) });
      }
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || t('eventDetail.registerFailed')); }
    finally { setBusy(false); }
  };

  const finishPayment = async (providerReference: string) => {
    if (!payment) return;
    setBusy(true); setError('');
    try {
      await eventsApi.payRegistration(payment.registrationId, providerReference);
      setPayment(null);
      setDone({ title: t('eventDetail.registeredTitle'), text: t('eventDetail.paidText', { title: ev.title, date: s.date, time: s.time, amount: formatCurrency(payment.session.amount, ev.currency) }) });
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || t('eventDetail.payFailed')); await load(); }
    finally { setBusy(false); }
  };

  const cancelReg = async (r: CustomerRegistration) => {
    setError('');
    try {
      const out = await eventsApi.cancelMyRegistration(r.id);
      setDone({
        title: t('eventDetail.cancelledTitle'),
        text: out.refund
          ? t(out.refund.to === 'credit' ? 'eventDetail.cancelledCredit' : 'eventDetail.cancelledCard', { amount: formatCurrency(out.refund.amount, ev.currency) })
          : t('eventDetail.released', { title: ev.title }),
      });
      await load();
    } catch (err: any) { setError(err?.response?.data?.error || t('eventDetail.cancelFailed')); }
  };

  const policy = ev.cancellation.allowed && ev.cancellation.hours_before !== null
    ? t('eventDetail.policy', { time: hoursWording(ev.cancellation.hours_before, t), where: refundWording(ev.cancellation.refund_to) })
    : t('eventDetail.policyNone');

  return (
    <div>
      <button className="cev-back" onClick={() => navigate('/events')}>{t('eventDetail.backToEvents')}</button>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="cev-detail">
        <div className="cev-panel">
          {ev.event_type_name && <span className="cev-type">{ev.event_type_name}</span>}
          <h1 className="cev-title" style={{ fontSize: 'var(--page-title-size)' }}>{ev.title}</h1>
          <dl className="cev-facts">
            <dt>{t('eventDetail.date')}</dt><dd>{s.date}</dd>
            <dt>{t('eventDetail.time')}</dt><dd>{s.time}–{e.time}</dd>
            {ev.location_name && <><dt>{t('eventDetail.location')}</dt><dd>{ev.location_name}</dd></>}
            {ev.host_business_name && businessId !== ev.host_business_id && <><dt>{t('eventDetail.hostedBy')}</dt><dd>{ev.host_business_name}</dd></>}
          </dl>
          <h2 className="cev-h">{t('eventDetail.about')}</h2>
          <p className="cev-p">{ev.description || t('eventDetail.noDescription')}</p>
          <h2 className="cev-h">{t('eventDetail.policyHeading')}</h2>
          <p className="cev-p">{policy}</p>
        </div>

        <div className="cev-panel">
          {done ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>{done.title}</h2>
              <p className="cev-p">{done.text}</p>
              <div className="cev-row" style={{ justifyContent: 'flex-start', marginTop: 'var(--space-md)' }}>
                <Button size="sm" onClick={() => navigate('/events?tab=mine')}>{t('eventDetail.seeMine')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDone(null)}>{t('eventDetail.backToEvent')}</Button>
              </div>
            </>
          ) : payment ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>{t('eventDetail.pay', { amount: formatCurrency(payment.session.amount, ev.currency) })}</h2>
              <p className="cev-small">{t('eventDetail.held')}</p>
              {payment.session.client_secret && payment.session.publishable_key ? (
                <StripeOneTimeCardCharge
                  clientSecret={payment.session.client_secret}
                  publishableKey={payment.session.publishable_key}
                  busyLabel={t('eventDetail.paying')}
                  onPaid={(pi) => finishPayment(pi)}
                  onCancel={() => { setPayment(null); load(); }}
                />
              ) : (
                // Test processor (no card form): the payment succeeds when confirmed.
                <div className="cev-row" style={{ justifyContent: 'flex-start' }}>
                  <Button onClick={() => finishPayment(payment.session.provider_reference)} loading={busy}>{t('eventDetail.payTest')}</Button>
                  <Button variant="ghost" onClick={() => { setPayment(null); load(); }}>{t('common:cancel')}</Button>
                </div>
              )}
            </>
          ) : active.length > 0 || waiting ? (
            <>
              <h2 className="cev-h" style={{ marginTop: 0 }}>{t('eventDetail.yourRegistration')}</h2>
              {active.map((r) => (
                <div key={r.id} className="cev-reg">
                  <div className="cev-row">
                    <span>{r.tier_name || t('eventDetail.ticket')}{r.group_size > 1 ? ` × ${r.group_size}` : ''}</span>
                    <Badge variant={r.status === 'confirmed' ? 'success' : 'warning'}>
                      {r.status === 'confirmed' ? t('events.registered') : r.awaiting_payment === 'online' ? t('events.my.paymentNotFinished') : t('events.my.payAtReception')}
                    </Badge>
                  </div>
                  <div className="cev-row"><span>{t('eventDetail.reference')}</span><span>{r.reference_number}</span></div>
                  {r.amount > 0 && <div className="cev-row"><span>{r.paid ? t('eventDetail.paid') : t('eventDetail.toPay')}</span><span>{formatCurrency(r.amount, ev.currency)}</span></div>}
                  {r.can_cancel && <Button size="sm" variant="secondary" onClick={() => setToCancel(r)}>{t('eventDetail.cancelRegistration')}</Button>}
                  {!r.can_cancel && r.cancel_blocked_reason && <p className="cev-small">{r.cancel_blocked_reason}</p>}
                  {r.can_cancel && r.cancel_until && (r.changed_event
                    ? <p className="cev-small"><Trans t={t} i18nKey="eventDetail.changed" values={{ date: eventDateParts(r.cancel_until, tz).date, time: eventDateParts(r.cancel_until, tz).time }} components={[<b />]} /></p>
                    : <p className="cev-small">{t('eventDetail.cancelUntil', { date: eventDateParts(r.cancel_until, tz).date, time: eventDateParts(r.cancel_until, tz).time })}</p>)}
                </div>
              ))}
              {waiting && (
                <div className="cev-reg">
                  <div className="cev-row"><span>{t('eventDetail.waitlist')}</span><Badge variant="info">{waiting.status === 'notified' ? t('events.my.placeOffered') : t('eventDetail.number', { position: waiting.position })}</Badge></div>
                  <Button size="sm" variant="secondary" onClick={async () => { await eventsApi.leaveWaitlist(waiting.id); await load(); }}>{t('events.leaveWaitlist')}</Button>
                </div>
              )}
            </>
          ) : !ev.open_for_registration ? (
            <p className="cev-p">{t('eventDetail.closed')}</p>
          ) : (
            <>
              <div className="cev-row" style={{ marginTop: 0 }}>
                <h2 className="cev-h" style={{ margin: 0 }}>{t('eventDetail.register')}</h2>
                <span className={full || ev.places_left <= 5 ? 'cev-spots cev-spots--low' : 'cev-spots'}>{full ? t('events.fullWaitlist') : t('events.spotsLeft', { count: ev.places_left })}</span>
              </div>
              <span className="cev-label">{t('eventDetail.ticket')}</span>
              <div className="cev-tiers" role="radiogroup" aria-label={t('eventDetail.ticket')}>
                {ev.tiers.length === 0 && <p className="cev-small">{t('eventDetail.noTickets')}</p>}
                {ev.tiers.map((tr) => (
                  <label key={tr.id} className={`cev-tier${tr.id === tierId ? ' cev-tier--on' : ''}${tr.available ? '' : ' cev-tier--off'}`}>
                    <input type="radio" name="tier" checked={tr.id === tierId} disabled={!tr.available} onChange={() => setTierId(tr.id)} />
                    <span className="cev-tier__name">{tr.name}
                      <span className="cev-tier__note">{tr.available ? (tr.eligibility === 'members_only' ? t('eventDetail.members') : tr.eligibility === 'first_time' ? t('eventDetail.firstTime') : (tr.description || t('eventDetail.anyone'))) : tr.unavailable_reason}</span>
                    </span>
                    <span>{tr.price > 0 ? formatCurrency(tr.price, ev.currency) : t('events.free')}</span>
                  </label>
                ))}
              </div>
              <label className="cev-label" htmlFor="cev-people">{t('eventDetail.people')}</label>
              <select id="cev-people" className="cev-select" style={{ width: '100%' }} value={people} onChange={(x) => setPeople(Number(x.target.value))}>
                {Array.from({ length: maxPeople }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? t('eventDetail.justMe') : n}</option>)}
              </select>
              {paid && (
                <>
                  <div className="cev-row"><span>{t('eventDetail.tickets')}</span><span>{formatCurrency(subtotal, ev.currency)}</span></div>
                  {tax > 0 && <div className="cev-row"><span>{t('eventDetail.tax', { rate: formatNumber(ev.tax_rate / 100, { maximumFractionDigits: 2 }) })}</span><span>{formatCurrency(tax, ev.currency)}</span></div>}
                </>
              )}
              <div className="cev-row cev-total"><span>{t('eventDetail.total')}</span><span>{paid ? formatCurrency(subtotal + tax, ev.currency) : t('events.free')}</span></div>
              {paid && !full && (
                <div role="radiogroup" aria-label={t('eventDetail.howToPay')} style={{ margin: 'var(--space-sm) 0' }}>
                  <span className="cev-label">{t('eventDetail.howToPay')}</span>
                  {ev.pay_options.online && (
                    <label className="cev-row" style={{ justifyContent: 'flex-start' }}>
                      <input type="radio" name="payat" checked={payAt === 'online'} onChange={() => setPayAt('online')} /> {t('eventDetail.payOnline')}
                    </label>
                  )}
                  <label className="cev-row" style={{ justifyContent: 'flex-start' }}>
                    <input type="radio" name="payat" checked={payAt === 'reception'} onChange={() => setPayAt('reception')} /> {t('eventDetail.payReception')}
                  </label>
                </div>
              )}
              <Button onClick={register} loading={busy} disabled={!tier} style={{ width: '100%' }}>
                {full ? t('events.joinWaitlist') : paid && payAt === 'online' ? t('eventDetail.continueToPayment') : t('eventDetail.register')}
              </Button>
              <p className="cev-small">{t('eventDetail.fullNote')}</p>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={() => { if (toCancel) cancelReg(toCancel); }}
        title={t('events.cancel.title')}
        message={toCancel?.paid ? t('eventDetail.cancelMessagePaid', { title: ev.title, date: s.date, where: refundWording(toCancel?.refund_to) }) : t('eventDetail.cancelMessage', { title: ev.title, date: s.date })}
        confirmLabel={t('events.cancel.confirm')}
        cancelLabel={t('events.cancel.keep')}
      />
    </div>
  );
}
