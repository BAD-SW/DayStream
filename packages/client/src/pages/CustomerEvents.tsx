import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import * as eventsApi from '../api/events';
import type { CustomerEventSummary, MyEventRow } from '../api/events';
import './CustomerEvents.css';

/** Dates and times of an event are shown in the hosting business's own time zone. */
export function eventDateParts(iso: string, timeZone: string) {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone, ...o }).format(d);
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
  return to === 'credit' ? 'as account credit' : 'to your card';
}

type Tab = 'upcoming' | 'mine';

// "My events" row texts — shared by the cells and their column filters.
function myStatus(m: MyEventRow): string {
  return m.kind === 'waitlist' ? (m.status === 'notified' ? 'Place offered' : `Waitlist #${m.position}`)
    : m.status === 'confirmed' ? (m.upcoming ? 'Registered' : 'Attended / past')
    : m.status === 'pending' ? (m.awaiting_payment === 'online' ? 'Payment not finished' : 'Pay at reception')
    : m.status === 'cancelled' ? 'Cancelled' : m.status;
}
function myTicket(m: MyEventRow): string {
  return m.kind === 'waitlist' ? '—' : `${m.tier_name || 'Ticket'}${m.group_size && m.group_size > 1 ? ` × ${m.group_size}` : ''}${m.amount ? ` · ${formatCurrency(m.amount, m.currency)}` : ''}`;
}

export function CustomerEvents() {
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
    } catch (e: any) { setError(e?.response?.data?.error || 'Events could not be loaded.'); }
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
        setNotice(`You left the waitlist for ${row.title}.`);
      } else {
        const out = await eventsApi.cancelMyRegistration(row.id);
        setNotice(out.refund
          ? `Registration cancelled. ${formatCurrency(out.refund.amount, row.currency)} ${out.refund.to === 'credit' ? 'was added to your account credit' : 'will be refunded to your card'}.`
          : 'Registration cancelled.');
      }
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || 'It could not be cancelled.'); }
  };

  const tabs = [
    { key: 'upcoming' as Tab, label: 'Upcoming events' },
    { key: 'mine' as Tab, label: `My events${activeMine.length ? ` (${activeMine.length})` : ''}` },
  ];

  return (
    <div>
      <PageHeader title="Events" />
      <TabBar aria-label="Events" tabs={tabs} active={tab} onChange={(t) => setParams(t === 'mine' ? { tab: 'mine' } : {})} />
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {tab === 'upcoming' && (
        <>
          <div className="cev-filters">
            <SearchInput value={search} onChange={setSearch} placeholder="Search events…" />
            <select className="cev-select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="cev-select" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {loading ? <ListEmpty>Loading...</ListEmpty> : shown.length === 0 ? <ListEmpty>No upcoming events</ListEmpty> : (
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
                      <span className="cev-price">{ev.from_price ? `From ${formatCurrency(ev.from_price, ev.currency)}` : 'Free'}</span>
                      <span className={full || ev.places_left <= 5 ? 'cev-spots cev-spots--low' : 'cev-spots'}>
                        {full ? 'Full · waitlist open' : `${ev.places_left} ${ev.places_left === 1 ? 'spot' : 'spots'} left`}
                      </span>
                      {ev.my_status === 'registered' ? <Badge variant="success">Registered</Badge>
                        : ev.my_status === 'awaiting_payment' ? <Badge variant="warning">Awaiting payment</Badge>
                        : ev.my_status === 'waitlisted' ? <Badge variant="info">On the waitlist</Badge> : null}
                      <Button size="sm" variant={full ? 'secondary' : 'primary'} onClick={() => navigate(`/events/${ev.id}`)}>
                        {ev.my_status ? 'View' : full ? 'Join waitlist' : 'View & register'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'mine' && (loading ? <ListEmpty>Loading...</ListEmpty> : mine.length === 0 ? <ListEmpty>You have no event registrations yet</ListEmpty> : (
        <Table
          rowId={(m: MyEventRow) => `${m.kind}-${m.id}`}
          data={mine}
          clientSort
          columns={[
            { key: 'title', header: 'Event', sortable: true, render: (_: any, m: MyEventRow) => <button className="cev-link" onClick={() => navigate(`/events/${m.event_id}`)}>{m.title}</button> },
            { key: 'start_time', header: 'Date/time', sortable: true, filter: 'date' as const, render: (_: any, m: MyEventRow) => { const d = eventDateParts(m.start_time, m.timezone); return `${d.shortDate} · ${d.time}`; } },
            { key: 'ticket', header: 'Ticket', sortable: true, filterValue: myTicket, render: (_: any, m: MyEventRow) => myTicket(m) },
            { key: 'status', header: 'Status', sortable: true, filterValue: myStatus, render: (_: any, m: MyEventRow) => {
              const variant = m.kind === 'waitlist' ? 'info' : m.status === 'confirmed' ? 'success' : m.status === 'pending' ? 'warning' : 'neutral';
              return <Badge variant={variant as any}>{myStatus(m)}</Badge>;
            } },
            { key: 'actions', header: '', filter: false as const, render: (_: any, m: MyEventRow) => {
              const canAct = m.upcoming && (m.kind === 'waitlist' || m.can_cancel);
              return (
                <div className="cev-actions">
                  {canAct && <Button size="sm" variant="secondary" onClick={() => setToCancel(m)}>{m.kind === 'waitlist' ? 'Leave waitlist' : 'Cancel'}</Button>}
                  {!canAct && m.kind === 'registration' && m.upcoming && (m.status === 'confirmed' || m.status === 'pending') && m.cancel_blocked_reason && (
                    <span className="cev-hint" title={m.cancel_blocked_reason}>Contact the business to cancel</span>
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
        title={toCancel?.kind === 'waitlist' ? 'Leave the waitlist?' : 'Cancel your registration?'}
        message={toCancel?.kind === 'waitlist' ? `You will lose your place on the waitlist for ${toCancel?.title}.`
          : `${toCancel?.title}. ${toCancel?.paid ? `What you paid is returned ${refundWording(toCancel?.refund_to)}.` : ''}`}
        confirmLabel={toCancel?.kind === 'waitlist' ? 'Leave waitlist' : 'Cancel registration'}
        cancelLabel="Keep it"
      />
    </div>
  );
}
