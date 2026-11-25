import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '../i18n';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import { ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { Alert } from '../design-system/components/feedback/Alert';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { formatCurrency } from '../utils/currency';
import { formatDate } from '../utils/format';
import * as eventsApi from '../api/events';
import type { CustomerEventSummary, MyEventRow } from '../api/events';
import './CustomerEvents.css';

/** Dates and times of an event are shown in the hosting business's own time zone. */
export function eventDateParts(iso: string, timeZone: string) {
  const part = (o: Intl.DateTimeFormatOptions) => formatDate(iso, { timeZone, ...o });
  return {
    month: part({ month: 'short' }).toUpperCase(),
    day: part({ day: '2-digit' }),
    weekday: part({ weekday: 'short' }),
    date: part({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    shortDate: part({ weekday: 'short', day: 'numeric', month: 'short' }),
    time: part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  };
}

export function eventWhen(start: string, end: string, timeZone: string) {
  const s = eventDateParts(start, timeZone);
  const e = eventDateParts(end, timeZone);
  return `${s.weekday} ${s.time}–${e.time}`;
}

export function refundWording(to: 'card' | 'credit' | null | undefined) {
  return i18n.t(to === 'credit' ? 'portal:events.refund.credit' : 'portal:events.refund.card');
}

type Tab = 'upcoming' | 'mine';

// "My events" row texts — shared by the cells and their column filters.
function myStatus(m: MyEventRow, t: TFunction): string {
  return m.kind === 'waitlist' ? (m.status === 'notified' ? t('events.my.placeOffered') : t('events.my.waitlistNumber', { position: m.position }))
    : m.status === 'confirmed' ? (m.upcoming ? t('events.registered') : t('events.my.attendedPast'))
    : m.status === 'pending' ? (m.awaiting_payment === 'online' ? t('events.my.paymentNotFinished') : t('events.my.payAtReception'))
    : m.status === 'cancelled' ? t('events.my.cancelled') : t(`events.my.status.${m.status}`, { defaultValue: m.status.replace('_', ' ') });
}
function myTicket(m: MyEventRow, t: TFunction): string {
  if (m.kind === 'waitlist') return '—';
  const name = m.tier_name || t('events.ticket');
  const ticket = m.group_size && m.group_size > 1 ? t('events.ticketGroup', { name, size: m.group_size }) : name;
  return m.amount ? t('events.ticketAmount', { ticket, amount: formatCurrency(m.amount, m.currency) }) : ticket;
}

export function CustomerEvents() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'mine' ? 'mine' : 'upcoming';
  const [events, setEvents] = useState<CustomerEventSummary[]>([]);
  const [mine, setMine] = useState<MyEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [toCancel, setToCancel] = useState<MyEventRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, my] = await Promise.all([eventsApi.getCustomerEvents(), eventsApi.getMyEvents()]);
      setEvents(list); setMine(my);
    } catch (e: any) { setError(e?.response?.data?.error || t('events.notice.loadFailed')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => Array.from(new Set(events.map((e) => e.event_type_name).filter(Boolean))) as string[], [events]);
  const locations = useMemo(() => Array.from(new Set(events.map((e) => e.location_name).filter(Boolean))) as string[], [events]);
  const shown = events.filter((e) =>
    (!search || `${e.title} ${e.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    && (!type || e.event_type_name === type) && (!location || e.location_name === location));
  const activeMine = mine.filter((m) => m.upcoming && (m.kind === 'waitlist' || m.status === 'confirmed' || m.status === 'pending'));

  const cancel = async (row: MyEventRow) => {
    setError(''); setNotice('');
    try {
      if (row.kind === 'waitlist') {
        await eventsApi.leaveWaitlist(row.id);
        setNotice(t('events.notice.leftWaitlist', { title: row.title }));
      } else {
        const out = await eventsApi.cancelMyRegistration(row.id);
        setNotice(out.refund
          ? t(out.refund.to === 'credit' ? 'events.notice.cancelledCredit' : 'events.notice.cancelledCard', { amount: formatCurrency(out.refund.amount, row.currency) })
          : t('events.notice.cancelled'));
      }
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || t('events.notice.cancelFailed')); }
  };

  const tabs = [
    { key: 'upcoming' as Tab, label: t('events.tab.upcoming') },
    { key: 'mine' as Tab, label: activeMine.length ? t('events.tab.mineCount', { n: activeMine.length }) : t('events.tab.mine') },
  ];

  return (
    <div>
      <PageHeader title={t('events.title')} />
      <TabBar aria-label={t('events.title')} tabs={tabs} active={tab} onChange={(k) => setParams(k === 'mine' ? { tab: 'mine' } : {})} />
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {tab === 'upcoming' && (
        <>
          <div className="cev-filters">
            <SearchInput value={search} onChange={setSearch} placeholder={t('events.searchPlaceholder')} />
            <select className="cev-select" aria-label={t('events.type')} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('events.allTypes')}</option>
              {types.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
            </select>
            <select className="cev-select" aria-label={t('events.location')} value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">{t('events.allLocations')}</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {loading ? <ListEmpty>{t('common:loading')}</ListEmpty> : shown.length === 0 ? <ListEmpty>{t('events.noUpcoming')}</ListEmpty> : (
            <div className="cev-list">
              {shown.map((ev) => {
                const d = eventDateParts(ev.start_time, ev.timezone);
                const full = ev.places_left <= 0;
                return (
                  <div key={ev.id} className="cev-card">
                    <div className="cev-date" aria-hidden="true"><span>{d.month}</span><strong>{d.day}</strong></div>
                    <div className="cev-main">
                      {ev.event_type_name && <span className="cev-type">{ev.event_type_name}</span>}
                      <h3 className="cev-title">{ev.title}</h3>
                      <p className="cev-meta">{eventWhen(ev.start_time, ev.end_time, ev.timezone)}{ev.location_name ? ` · ${ev.location_name}` : ''}</p>
                    </div>
                    <div className="cev-side">
                      <span className="cev-price">{ev.from_price ? t('events.fromPrice', { price: formatCurrency(ev.from_price, ev.currency) }) : t('events.free')}</span>
                      <span className={full || ev.places_left <= 5 ? 'cev-spots cev-spots--low' : 'cev-spots'}>
                        {full ? t('events.fullWaitlist') : t('events.spotsLeft', { count: ev.places_left })}
                      </span>
                      {ev.my_status === 'registered' ? <Badge variant="success">{t('events.registered')}</Badge>
                        : ev.my_status === 'awaiting_payment' ? <Badge variant="warning">{t('events.awaitingPayment')}</Badge>
                        : ev.my_status === 'waitlisted' ? <Badge variant="info">{t('events.onWaitlist')}</Badge> : null}
                      <Button size="sm" variant={full ? 'secondary' : 'primary'} onClick={() => navigate(`/events/${ev.id}`)}>
                        {ev.my_status ? t('events.view') : full ? t('events.joinWaitlist') : t('events.viewRegister')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'mine' && (loading ? <ListEmpty>{t('common:loading')}</ListEmpty> : mine.length === 0 ? <ListEmpty>{t('events.noneMine')}</ListEmpty> : (
        <Table
          rowId={(m: MyEventRow) => `${m.kind}-${m.id}`}
          data={mine}
          clientSort
          columns={[
            { key: 'title', header: t('events.col.event'), sortable: true, render: (_: any, m: MyEventRow) => <button className="cev-link" onClick={() => navigate(`/events/${m.event_id}`)}>{m.title}</button> },
            { key: 'start_time', header: t('events.col.dateTime'), sortable: true, filter: 'date' as const, render: (_: any, m: MyEventRow) => { const d = eventDateParts(m.start_time, m.timezone); return `${d.shortDate} · ${d.time}`; } },
            { key: 'ticket', header: t('events.col.ticket'), sortable: true, filterValue: (m: MyEventRow) => myTicket(m, t), render: (_: any, m: MyEventRow) => myTicket(m, t) },
            { key: 'status', header: t('events.col.status'), sortable: true, filterValue: (m: MyEventRow) => myStatus(m, t), render: (_: any, m: MyEventRow) => {
              const variant = m.kind === 'waitlist' ? 'info' : m.status === 'confirmed' ? 'success' : m.status === 'pending' ? 'warning' : 'neutral';
              return <Badge variant={variant as any}>{myStatus(m, t)}</Badge>;
            } },
            { key: 'actions', header: '', filter: false as const, render: (_: any, m: MyEventRow) => {
              const canAct = m.upcoming && (m.kind === 'waitlist' || m.can_cancel);
              return (
                <div className="cev-actions">
                  {canAct && <Button size="sm" variant="secondary" onClick={() => setToCancel(m)}>{m.kind === 'waitlist' ? t('events.leaveWaitlist') : t('common:cancel')}</Button>}
                  {!canAct && m.kind === 'registration' && m.upcoming && (m.status === 'confirmed' || m.status === 'pending') && m.cancel_blocked_reason && (
                    <span className="cev-hint" title={m.cancel_blocked_reason}>{t('events.contactToCancel')}</span>
                  )}
                </div>
              );
            } },
          ]}
        />
      ))}

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={() => { if (toCancel) cancel(toCancel); }}
        title={toCancel?.kind === 'waitlist' ? t('events.cancel.leaveTitle') : t('events.cancel.title')}
        message={toCancel?.kind === 'waitlist' ? t('events.cancel.leaveMessage', { title: toCancel?.title })
          : toCancel?.paid ? t('events.cancel.messagePaid', { title: toCancel?.title, where: refundWording(toCancel?.refund_to) }) : t('events.cancel.message', { title: toCancel?.title })}
        confirmLabel={toCancel?.kind === 'waitlist' ? t('events.leaveWaitlist') : t('events.cancel.confirm')}
        cancelLabel={t('events.cancel.keep')}
      />
    </div>
  );
}
