import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, confirmLeave } from '../components/unsaved/LeaveGuard';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { Modal } from '../design-system/components/feedback/Modal';
import { Alert } from '../design-system/components/feedback/Alert';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';
import { formatCurrency } from '../utils/currency';
import { getLocations } from '../api/locations';
import { getTaxCategories } from '../api/services';
import { getStaffList } from '../api/staff';
import { formatDate, formatDateTime, formatNumber, formatPercent, formatTime } from '../utils/format';
import './Events.css';
import './EventDetail.css';

type Tab = 'overview' | 'tickets' | 'registrations' | 'waitlist' | 'facilitators' | 'communications';
const TABS: Tab[] = ['overview', 'tickets', 'registrations', 'waitlist', 'facilitators', 'communications'];

// One Save for the event (David, 2026-11-01, as in Settings): details, tickets and facilitators
// wait for Save changes; Publish, Cancel, Delete, registrations and messages act straight away.
export function EventDetail() {
  return (
    <DraftSectionsProvider>
      <EventDetailPage />
    </DraftSectionsProvider>
  );
}

function EventDetailPage() {
  const { t } = useTranslation('events');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  // The tab is kept in the address (?tab=), as in Settings, so Back from a profile returns to it (THE-23 remark).
  const [searchParams, setSearchParams] = useSearchParams();
  // Details and Reports are one tab, Overview (THE-23 item 3); old links to them open it.
  const [activeTab, setActiveTabState] = useState<Tab>(() => { const t = searchParams.get('tab') as Tab; return TABS.includes(t) ? t : 'overview'; });
  const setActiveTab = (tab: Tab) => { setActiveTabState(tab); setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true }); };
  // After a date, time or place change with people registered: offer to tell them (decision 14).
  const [changeNotice, setChangeNotice] = useState<{ registrations: number; refund_until: string; refund_days: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<eventsApi.CancelPreview | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  useEffect(() => { setSaveResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);
  const saveChanges = async () => {
    const { failed } = await saveAll();
    setSaveResult(failed.length ? { ok: false, text: t('detail.notSaved', { details: failed.map((f) => `${f.label} (${f.error})`).join('; ') }) } : { ok: true, text: t('detail.allSaved') });
  };
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!id) return;
    eventsApi.getEvent(id).then(setEvent).catch(() => navigate('/events')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  if (!event) return <ListEmpty>{t('detail.notFound')}</ListEmpty>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t('detail.tab.overview') }, { key: 'tickets', label: t('detail.tab.tickets') },
    { key: 'registrations', label: t('detail.tab.registrations') }, { key: 'waitlist', label: t('detail.tab.waitlist') },
    { key: 'facilitators', label: t('detail.tab.facilitators') },
    { key: 'communications', label: t('detail.tab.communications') },
  ];

  const handlePublish = async () => {
    setProblem('');
    try { const e = await eventsApi.publishEvent(event.id); setEvent({ ...event, ...e }); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.publishFailed')); }
  };
  // Back to draft, only while nobody is registered or waiting (decision 14).
  const handleUnpublish = async () => {
    setProblem('');
    try { const e = await eventsApi.unpublishEvent(event.id); setEvent({ ...event, ...e }); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.unpublishFailed')); }
  };
  // Before cancelling, say what will happen (David, 2026-10-29): registrations cancelled and
  // emailed, paid tickets refunded to the card or account credit, the waiting list emptied.
  const handleCancel = async () => {
    setProblem('');
    try { setCancelPreview(await eventsApi.getCancelPreview(event.id)); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.cancelFailed')); }
  };
  const confirmCancel = async () => {
    setCancelling(true); setProblem('');
    try { setEvent({ ...event, ...(await eventsApi.cancelEvent(event.id)) }); setCancelPreview(null); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.cancelFailed')); setCancelPreview(null); }
    finally { setCancelling(false); }
  };
  const cancelText = (p: eventsApi.CancelPreview) => {
    const lines: string[] = [];
    lines.push(p.registrations === 0 ? t('detail.cancel.nobody') : t('detail.cancel.registrations', { count: p.registrations }));
    if (p.paid_tickets > 0) {
      lines.push(t(p.refund_to === 'credit' ? 'detail.cancel.refundCredit' : 'detail.cancel.refundCard', { count: p.paid_tickets, amount: formatCurrency(p.refund_amount, p.currency) }));
    }
    if (p.waiting > 0) lines.push(t('detail.cancel.waiting', { count: p.waiting }));
    lines.push(t('detail.cancel.undone'));
    return lines.join(' ');
  };
  // Delete archives the event (David, 2026-10-28); it is refused while people are registered or waiting.
  const handleDelete = async () => {
    setProblem('');
    try { await eventsApi.deleteEvent(event.id); navigate('/events'); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.deleteFailed')); }
  };
  const handleRestore = async () => {
    setProblem('');
    try { setEvent({ ...event, ...(await eventsApi.restoreEvent(event.id)) }); }
    catch (err: any) { setProblem(err?.response?.data?.error || t('detail.restoreFailed')); }
  };

  return (
    <div>
      <LeaveGuard when={dirty} />
      <StickyPageTop>
      <div className="evd-back">
        <Button variant="ghost" size="sm" onClick={() => confirmLeave(() => navigate('/events'))}>{t('detail.back')}</Button>
      </div>
      <PageHeader
        title={event.title}
        subtitle={[event.event_type_name, event.location_name].filter(Boolean).join(' · ')}
        actions={<>
          {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>{t('detail.unsaved')}</span>
            : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
          <Button onClick={saveChanges} loading={saving} disabled={!dirty}>{t('detail.saveChanges')}</Button>
          {event.deleted_at ? (
            <>
              <Badge variant="error">{t('detail.deleted')}</Badge>
              <Button onClick={handleRestore}>{t('detail.restore')}</Button>
            </>
          ) : (
            <>
              {event.status === 'draft' && <Button onClick={handlePublish}>{t('detail.publish')}</Button>}
              {event.status === 'published' && event.registrations_count === 0 && <Button variant="ghost" onClick={handleUnpublish}>{t('detail.unpublish')}</Button>}
              {event.status === 'published' && <Button variant="destructive" onClick={handleCancel}>{t('common:cancel')}</Button>}
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>{t('detail.deleteEvent')}</Button>
            </>
          )}
          <Badge variant={event.status === 'published' ? 'success' : event.status === 'cancelled' ? 'error' : 'neutral'}>{t(`detail.status.${event.status}`, { defaultValue: event.status })}</Badge>
        </>}
      />
      <EventWhen start={event.start_time} end={event.end_time} />
      {problem && <Alert variant="error">{problem}</Alert>}
      <ConfirmDialog
        open={!!cancelPreview && !cancelling}
        onClose={() => setCancelPreview(null)}
        onConfirm={confirmCancel}
        title={t('detail.cancelThisTitle')}
        message={cancelPreview ? cancelText(cancelPreview) : ''}
        confirmLabel={t('detail.cancelEvent')}
        cancelLabel={t('detail.keepIt')}
      />
      {cancelling && <Alert variant="info">{t('detail.cancelling')}</Alert>}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title={t('detail.deleteThisTitle')}
        message={t('detail.deleteMessage')}
        confirmLabel={t('detail.deleteEvent')}
        cancelLabel={t('detail.keepIt')}
      />
      <TabBar aria-label={t('detail.sections')} tabs={tabs.map((tab) => ({ ...tab, changed: dirtySections.some((s) => s.tab === tab.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>
      {/* Tabs with drafts stay mounted, so their edits survive switching tabs. */}
      <div hidden={activeTab !== 'overview'}><DraftTab tab="overview"><OverviewTab event={event}
        onSaved={(e) => { setEvent((prev) => (prev ? { ...prev, ...e } : prev)); if (e.material_change) setChangeNotice(e.material_change); }} /></DraftTab></div>
      <div hidden={activeTab !== 'tickets'}><DraftTab tab="tickets"><TicketsTab eventId={event.id} /></DraftTab></div>
      {activeTab === 'registrations' && <RegistrationsTab eventId={event.id} />}
      {activeTab === 'waitlist' && <WaitlistTab eventId={event.id} />}
      <div hidden={activeTab !== 'facilitators'}><DraftTab tab="facilitators"><FacilitatorsTab eventId={event.id} /></DraftTab></div>
      {activeTab === 'communications' && <CommsTab eventId={event.id} />}
      {changeNotice && <ChangeNotice event={event} notice={changeNotice} onClose={() => setChangeNotice(null)} />}
    </div>
  );
}

const fmtDay = (iso: string) => formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = (iso: string) => formatTime(iso, undefined, { hour: '2-digit', minute: '2-digit' });

// The date and time, the largest line under the title (THE-23 item 3, option D).
function EventWhen({ start, end }: { start: string; end: string }) {
  const { t } = useTranslation('events');
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const length = mins >= 60 ? (mins % 60 ? t('detail.lengthHoursMinutes', { count: Math.floor(mins / 60), minutes: mins % 60 }) : t('detail.lengthHours', { count: Math.floor(mins / 60) })) : t('detail.lengthMinutes', { minutes: mins });
  return (
    <div className="evd-when">
      <strong>{fmtDay(start)}</strong>
      <span>{fmtTime(start)} – {sameDay ? fmtTime(end) : `${fmtDay(end)}, ${fmtTime(end)}`}</span>
      <small>{length}</small>
    </div>
  );
}

// Tell the registered people about a date, time or place change (decision 14): the message is
// prefilled and editable; they can cancel for a full refund until the window closes.
function ChangeNotice({ event, notice, onClose }: { event: Event; notice: { registrations: number; refund_until: string; refund_days: number }; onClose: () => void }) {
  const { t } = useTranslation('events');
  const until = formatDate(notice.refund_until, { day: 'numeric', month: 'long', year: 'numeric' });
  const [subject, setSubject] = useState(t('detail.notice.subject', { title: event.title }));
  const [content, setContent] = useState(
    t('detail.notice.message', { title: event.title, day: fmtDay(event.start_time), start: fmtTime(event.start_time), end: fmtTime(event.end_time), place: event.location_name ? t('detail.notice.at', { location: event.location_name }) : '', until }),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setSending(true); setError('');
    try { await eventsApi.sendCommunication(event.id, { subject, content }); onClose(); }
    catch (err: any) { setError(err?.response?.data?.error || t('detail.noticeSendFailed')); }
    finally { setSending(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('detail.noticeTitle')} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('detail.dontSend')}</Button><Button onClick={send} loading={sending}>{t('detail.notice.send', { count: notice.registrations })}</Button></>}>
      <p style={{ marginTop: 0, fontSize: 'var(--font-size-sm)' }}><Trans i18nKey="detail.notice.body" ns="events" count={notice.registrations} values={{ until, days: notice.refund_days }} components={[<b key="b" />]} /></p>
      <label className="evd-field">{t('detail.subject')}<input className="ev-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="evd-field" style={{ marginTop: 'var(--space-sm)' }}>{t('detail.message')}<textarea className="ev-input evd-textarea" rows={8} value={content} onChange={(e) => setContent(e.target.value)} /></label>
      {error && <Alert variant="error">{error}</Alert>}
    </Modal>
  );
}

// Overview (THE-23 item 3, option D): the figures of the old Reports tab in one strip, then the
// event's settings (all editable, saved with Save changes) and a compact description. Where it is
// hosted decides which business sells its tickets; the tax is one of that business's tax
// categories, or its default tax (THE-20). Hosted at replaces the free-text location (David, 4 Nov).
type EventForm = { title: string; event_type_id: string; start: string; end: string; location_id: string; capacity: string; tax_category_id: string; tags: string; description: string };
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toForm = (e: Event): EventForm => ({
  title: e.title || '', event_type_id: e.event_type_id || '', start: toLocalInput(e.start_time), end: toLocalInput(e.end_time),
  location_id: (e as any).location_id || '', capacity: String(e.capacity ?? ''), tax_category_id: (e as any).tax_category_id || '',
  tags: (e.tags || []).join(', '), description: e.description || '',
});

function OverviewTab({ event, onSaved }: { event: Event; onSaved: (e: any) => void }) {
  const { t } = useTranslation('events');
  const businessId = localStorage.getItem('business_id') || '';
  const [locations, setLocations] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const loadReport = () => eventsApi.getEventReport(event.id).then(setReport).catch(() => {});
  useEffect(() => { loadReport(); }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    eventsApi.getEventTypes().then((t) => setTypes(t || [])).catch(() => {});
    if (!businessId) return;
    getLocations(businessId).then(setLocations).catch(() => {});
    getTaxCategories(businessId).then(setTaxes).catch(() => {});
  }, [businessId]);

  const draft = useDraft<EventForm>('event-details', t('detail.tab.overview'), toForm(event), async (f) => {
    if (!f.title.trim()) throw new Error(t('detail.giveTitle'));
    const updated = await eventsApi.updateEvent(event.id, {
      title: f.title.trim(), event_type_id: f.event_type_id || undefined, description: f.description,
      start_time: new Date(f.start).toISOString(), end_time: new Date(f.end).toISOString(),
      location_id: f.location_id || null, capacity: Number(f.capacity) || 0, tax_category_id: f.tax_category_id,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    onSaved(updated);
    loadReport();
    return toForm({ ...event, ...updated });
  });
  const f = draft.value;
  const set = (patch: Partial<EventForm>) => draft.setValue({ ...f, ...patch });
  const mark = (k: keyof EventForm) => fieldMark(draft.changed((v) => v[k]));
  const unknownPlace = f.location_id && !locations.some((l) => l.id === f.location_id);

  const pct = (v: any) => formatPercent(Number(v || 0));
  const figures: [string, string | number][] = [
    [`${event.registrations_count} / ${event.capacity}`, t('detail.figures.registered', { percent: pct(report?.capacityUtilization) })],
    [report?.registrations?.confirmed ?? 0, t('detail.confirmed')],
    [formatCurrency(report?.revenue || 0), t('detail.revenue')],
    [pct(report?.attendanceRate), t('detail.attendanceRate')],
    [report?.waitlistSize ?? 0, t('detail.tab.waitlist')],
    [pct(report?.cancellationRate), t('detail.cancellationRate')],
  ];

  return (
    <div className="evd-overview">
      <div className="evd-kpis">
        {figures.map(([value, label]) => (
          <div key={label} className="evd-kpi"><b>{report ? value : '—'}</b><small>{label}</small></div>
        ))}
      </div>
      <div className="evd-cards">
        <section className="evd-card" style={draftBox(draft.dirty)}>
          <h3 className="evd-card__title">{t('detail.settings')}<UnsavedTag dirty={draft.dirty} /></h3>
          <div className="evd-fields">
            <label className="evd-field">{t('detail.title')}<input className="ev-input" value={f.title} onChange={(e) => set({ title: e.target.value })} style={mark('title')} /></label>
            <label className="evd-field">{t('detail.type')}<select className="ev-select" value={f.event_type_id} onChange={(e) => set({ event_type_id: e.target.value })} style={mark('event_type_id')}>
              {!types.some((t) => t.id === f.event_type_id) && <option value={f.event_type_id}>{event.event_type_name || '—'}</option>}
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
            <label className="evd-field">{t('detail.start')}<input className="ev-input" type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} style={mark('start')} /></label>
            <label className="evd-field">{t('detail.end')}<input className="ev-input" type="datetime-local" value={f.end} onChange={(e) => set({ end: e.target.value })} style={mark('end')} /></label>
            <label className="evd-field">{t('detail.hostedAt')}<select className="ev-select" aria-label={t('detail.hostedAt')} value={f.location_id} onChange={(e) => set({ location_id: e.target.value })} style={mark('location_id')}>
              <option value="">{unknownPlace ? t('detail.anotherBusiness') : t('detail.none')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
            <label className="evd-field">{t('detail.capacity')}<input className="ev-input" type="number" min={Math.max(1, event.registrations_count)} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} style={mark('capacity')} /></label>
            <label className="evd-field">{t('detail.ticketTax')}<select className="ev-select" aria-label={t('detail.ticketTax')} value={f.tax_category_id} onChange={(e) => set({ tax_category_id: e.target.value })} style={mark('tax_category_id')}>
              <option value="">{t('detail.defaultTax')}</option>
              {taxes.map((tx) => <option key={tx.id} value={tx.id}>{tx.name} ({formatNumber(tx.rate / 100)}%)</option>)}
            </select></label>
            <label className="evd-field">{t('detail.tags')}<input className="ev-input" placeholder={t('detail.commaSeparated')} value={f.tags} onChange={(e) => set({ tags: e.target.value })} style={mark('tags')} /></label>
          </div>
          {!f.location_id && event.location_name && <p className="evd-hint">{t('detail.enteredAsText', { location: event.location_name })}</p>}
        </section>
        <section className="evd-card" style={draftBox(draft.dirty)}>
          <h3 className="evd-card__title">{t('detail.description')}</h3>
          <textarea className="ev-input evd-textarea" aria-label={t('detail.description')} rows={4} value={f.description} placeholder={t('detail.aboutEvent')}
            onChange={(e) => set({ description: e.target.value })} style={mark('description')} />
        </section>
      </div>
    </div>
  );
}

function TicketsTab({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events');
  type Who = 'all' | 'members_only' | 'first_time';
  type Tier = { id?: string; name: string; price: number; quantity_available: number | null; eligibility_type: Who; sold_count?: number };
  const list = useDraftList<Tier>('event-tickets', t('detail.tab.tickets'), {
    create: (t) => eventsApi.createTier(eventId, { name: t.name.trim(), price: t.price, quantity_available: t.quantity_available, eligibility_type: t.eligibility_type }).then((c: any) => ({ ...c, sold_count: 0 })),
    update: (t) => eventsApi.updateTier(eventId, t.id!, { name: t.name.trim(), price: t.price }),
    remove: (t) => eventsApi.deleteTier(eventId, t.id!),
  });
  useEffect(() => { eventsApi.getTiers(eventId).then(list.load); }, [eventId, list.load]);

  // A new ticket type (THE-20): who may buy it is everyone, members only (an active
  // membership at the hosting business) or first-time customers only (no earlier visit or
  // purchase there). "Custom" is not defined, so it is not offered. It is saved with Save changes.
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newWho, setNewWho] = useState<Who>('all');
  const [addError, setAddError] = useState('');
  const handleAdd = () => {
    setAddError('');
    if (!newName.trim()) { setAddError(t('detail.giveTicketName')); return; }
    list.add({ name: newName.trim(), price: Math.round((parseFloat(newPrice) || 0) * 100), quantity_available: newQty ? Number(newQty) : null, eligibility_type: newWho });
    setNewName(''); setNewPrice(''); setNewQty(''); setNewWho('all');
  };

  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">{t('detail.ticketTiers')}<UnsavedTag dirty={list.dirty} /></h3>
      {list.rows.length === 0 ? <ListEmpty>{t('detail.noTiers')}</ListEmpty> : (
        <ListRows>
          {list.rows.map((r) => r.deleted ? (
            <ListRow key={r.key} actions={<Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>{t('detail.undo')}</Button>}>
              <ListRowTitle><s>{r.item.name}</s></ListRowTitle>
              <RowTag>{t('detail.deletedWhenSave')}</RowTag>
            </ListRow>
          ) : (
            <ListRow key={r.key} actions={<>
              <ListRowMeta>{t('detail.soldOf', { sold: r.item.sold_count || 0, total: r.item.quantity_available || '∞' })}</ListRowMeta>
              <Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>{t('common:delete')}</Button>
            </>}>
              <input className="ev-input" aria-label={t('detail.tierName')} value={r.item.name} style={fieldMark(!!r.isNew || list.changed(r, (t) => t.name))}
                onChange={(e) => list.edit(r.key, { name: e.target.value })} />
              <input className="ev-input evd-price" aria-label={t('detail.price')} type="number" step="0.01" min="0" value={r.item.price / 100}
                style={fieldMark(!!r.isNew || list.changed(r, (t) => t.price))}
                onChange={(e) => list.edit(r.key, { price: Math.round((parseFloat(e.target.value) || 0) * 100) })} />
              {r.item.eligibility_type === 'members_only' && <Badge variant="info">{t('detail.membersOnly')}</Badge>}
              {r.item.eligibility_type === 'first_time' && <Badge variant="info">{t('detail.firstTimeOnly')}</Badge>}
              {r.isNew && <RowTag>{t('detail.new')}</RowTag>}
            </ListRow>
          ))}
        </ListRows>
      )}
      <div className="ev-add-row" style={{ marginTop: 'var(--space-md)', flexWrap: 'wrap' }}>
        <input className="ev-input" aria-label={t('detail.newTicketName')} placeholder={t('detail.ticketNameExample')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input className="ev-input evd-price" aria-label={t('detail.newTicketPrice')} placeholder={t('detail.priceFree')} type="number" step="0.01" min="0" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
        <input className="ev-input evd-price" aria-label={t('detail.howMany')} placeholder={t('detail.howManyBlank')} type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
        <select className="ev-select" aria-label={t('detail.whoCanBuy')} value={newWho} onChange={(e) => setNewWho(e.target.value as Who)}>
          <option value="all">{t('detail.everyone')}</option>
          <option value="members_only">{t('detail.membersOnly')}</option>
          <option value="first_time">{t('detail.firstTimeOnly')}</option>
        </select>
        <Button size="sm" onClick={handleAdd}>{t('detail.addTicket')}</Button>
      </div>
      {addError && <p className="evd-label" style={{ color: 'var(--color-error)' }}>{addError}</p>}
    </div>
  );
}

function RegistrationsTab({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const [regs, setRegs] = useState<any[]>([]);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [transferEmail, setTransferEmail] = useState('');
  useEffect(() => { eventsApi.getRegistrations(eventId).then((r) => setRegs(r.data)); }, [eventId]);

  const handleExportAttendees = async () => {
    try {
      const blob = await eventsApi.exportAttendees(eventId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'attendees.csv'; a.click();
      window.URL.revokeObjectURL(url);
    } catch { void showMessage({ message: t('detail.exportFailed'), tone: 'error' }); }
  };

  const handleCancel = async (regId: string) => {
    if (!(await askConfirm({ message: t('detail.cancelRegConfirm'), confirmLabel: t('common:action.cancelBooking'), destructive: true }))) return;
    const updated = await eventsApi.cancelRegistration(regId);
    setRegs(regs.map((r) => r.id === regId ? { ...r, status: updated.status || 'cancelled' } : r));
  };

  const handleTakePayment = async (regId: string) => {
    try {
      const { order_id } = await eventsApi.openRegistrationCheckout(regId);
      navigate(`/checkout?order=${order_id}`);
    } catch (e: any) { void showMessage({ message: e?.response?.data?.error || t('detail.paymentFailed'), tone: 'error' }); }
  };

  const handleCheckIn = async (regId: string) => {
    const updated = await eventsApi.checkInRegistration(regId);
    setRegs(regs.map((r) => r.id === regId ? { ...r, checked_in_at: updated.checked_in_at || new Date().toISOString() } : r));
  };

  const handleTransfer = async (regId: string) => {
    if (!transferEmail) return;
    await eventsApi.transferRegistration(regId, { email: transferEmail });
    setTransferTarget(null); setTransferEmail('');
    const result = await eventsApi.getRegistrations(eventId);
    setRegs(result.data);
  };

  return (
    <div>
      <div className="evd-section-head">
        <h3 className="ev-section-title">{t('detail.registrationsCount', { number: regs.length })}</h3>
        <Button size="sm" variant="ghost" onClick={handleExportAttendees}>{t('detail.exportAttendees')}</Button>
      </div>
      {regs.length === 0 ? <ListEmpty>{t('detail.noRegistrations')}</ListEmpty> : (
        <ListRows>
          {regs.map((r: any) => (
            <div key={r.id}>
              <ListRow actions={<>
                {r.checked_in_at && <Badge variant="success">{t('detail.checkedIn')}</Badge>}
                <Badge variant={r.status === 'confirmed' ? 'success' : r.status === 'cancelled' ? 'error' : 'neutral'}>{t(`detail.regStatus.${r.status}`, { defaultValue: r.status })}</Badge>
                {r.status === 'confirmed' && !r.checked_in_at && (
                  <Button size="sm" onClick={() => handleCheckIn(r.id)}>{t('detail.checkIn')}</Button>
                )}
                {r.status === 'confirmed' && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setTransferTarget(r.id)}>{t('detail.transfer')}</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleCancel(r.id)}>{t('common:cancel')}</Button>
                  </>
                )}
                {/* A place held until it is paid (THE-20): reception takes the payment through
                    checkout, which confirms the place, or cancels it. */}
                {r.status === 'pending' && (
                  <>
                    <Badge variant="warning">{r.pay_at === 'online' ? t('detail.payingOnline') : t('detail.payAtReception')}</Badge>
                    {r.pay_at !== 'online' && <Button size="sm" onClick={() => handleTakePayment(r.id)}>{t('detail.takePayment')}</Button>}
                    <Button size="sm" variant="destructive" onClick={() => handleCancel(r.id)}>{t('common:cancel')}</Button>
                  </>
                )}
              </>}>
                {/* The name opens the person's profile (THE-23 item 1). */}
                <ListRowTitle>{r.customer_id ? <Link to={`/customers/${r.customer_id}`}>{r.first_name} {r.last_name}</Link> : <>{r.first_name} {r.last_name}</>}</ListRowTitle>
                <ListRowMeta>{r.reference_number}{r.tier_name ? ` · ${r.tier_name}` : ''}{r.group_size > 1 ? ` × ${r.group_size}` : ''}</ListRowMeta>
              </ListRow>
              {transferTarget === r.id && (
                <div className="evd-inline-form">
                  <input className="ev-input" aria-label={t('detail.recipientEmail')} placeholder={t('detail.recipientEmail')} value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} />
                  <Button size="sm" onClick={() => handleTransfer(r.id)}>{t('detail.confirmTransfer')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setTransferTarget(null)}>{t('common:cancel')}</Button>
                </div>
              )}
            </div>
          ))}
        </ListRows>
      )}
    </div>
  );
}

function WaitlistTab({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events');
  const [waitlist, setWaitlist] = useState<any[]>([]);
  useEffect(() => { eventsApi.getWaitlist(eventId).then(setWaitlist); }, [eventId]);

  const handleConfirm = async (waitlistId: string) => {
    await eventsApi.confirmWaitlist(waitlistId);
    setWaitlist(waitlist.filter((w) => w.id !== waitlistId));
  };

  return (
    <div>
      <h3 className="ev-section-title">{t('detail.waitlistCount', { number: waitlist.length })}</h3>
      {waitlist.length === 0 ? <ListEmpty>{t('detail.noWaitlist')}</ListEmpty> : (
        <ListRows>
          {waitlist.map((w: any) => (
            <ListRow key={w.id} actions={<>
              <Badge variant={w.status === 'waiting' ? 'info' : 'warning'}>{t(`detail.waitStatus.${w.status}`, { defaultValue: w.status })}</Badge>
              {w.status === 'waiting' && <Button size="sm" onClick={() => handleConfirm(w.id)}>{t('detail.confirm')}</Button>}
            </>}>
              <span>#{w.position} — {w.first_name} {w.last_name}</span>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

function FacilitatorsTab({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events');
  type Fac = { id?: string; staff_id: string; role: string; staff_name?: string };
  const list = useDraftList<Fac>('event-facilitators', t('detail.tab.facilitators'), {
    create: (f) => eventsApi.addFacilitator(eventId, { staff_id: f.staff_id, role: f.role }),
    remove: (f) => eventsApi.removeFacilitator(eventId, f.id!),
  });
  const [staffId, setStaffId] = useState('');
  const [role, setRole] = useState('facilitator');
  // Facilitators are chosen from the business's staff (it used to ask for a typed staff ID).
  const [staff, setStaff] = useState<{ id: string; first_name: string; last_name: string }[]>([]);

  useEffect(() => { eventsApi.getFacilitators(eventId).then(list.load).catch(() => {}); }, [eventId, list.load]);
  useEffect(() => {
    getStaffList({ business_id: localStorage.getItem('business_id') || '', status: 'active' }).then((res) => setStaff(res.data || [])).catch(() => {});
  }, []);

  const taken = new Set(list.rows.filter((r) => !r.deleted).map((r) => r.item.staff_id));
  const handleAdd = () => {
    if (!staffId) return;
    const person = staff.find((p) => p.id === staffId);
    list.add({ staff_id: staffId, role, staff_name: person ? `${person.first_name} ${person.last_name}`.trim() : undefined });
    setStaffId(''); setRole('facilitator');
  };

  return (
    <div>
      <h3 className="ev-section-title">{t('detail.tab.facilitators')}<UnsavedTag dirty={list.dirty} /></h3>
      <div className="ev-add-row">
        <select className="ev-select" aria-label={t('detail.staffMember')} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">{t('detail.chooseStaff')}</option>
          {staff.filter((p) => !taken.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>
        <select className="ev-select" aria-label={t('detail.role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="facilitator">{t('detail.roleOption.facilitator')}</option>
          <option value="instructor">{t('detail.roleOption.instructor')}</option>
          <option value="assistant">{t('detail.roleOption.assistant')}</option>
        </select>
        <Button size="sm" onClick={handleAdd} disabled={!staffId}>{t('detail.add')}</Button>
      </div>
      {list.rows.length === 0 ? <ListEmpty>{t('detail.noFacilitators')}</ListEmpty> : (
        <ListRows>
          {list.rows.map((r) => (
            <ListRow key={r.key} actions={r.deleted
              ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>{t('detail.undo')}</Button>
              : <Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>{t('detail.remove')}</Button>}>
              <ListRowTitle>{r.deleted ? <s>{r.item.staff_name || r.item.staff_id}</s> : (r.item.staff_name || r.item.staff_id)}</ListRowTitle>
              <Badge variant="neutral">{t(`detail.role.${r.item.role}`, { defaultValue: r.item.role })}</Badge>
              {r.isNew && <RowTag>{t('detail.new')}</RowTag>}
              {r.deleted && <RowTag>{t('detail.removedWhenSave')}</RowTag>}
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

function CommsTab({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events');
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => { eventsApi.getCommunications(eventId).then(setHistory); }, [eventId]);
  return (
    <div>
      <h3 className="ev-section-title">{t('detail.tab.communications')}</h3>
      {history.length === 0 ? <ListEmpty>{t('detail.noComms')}</ListEmpty> : (
        <ListRows>
          {history.map((c: any) => (
            <ListRow key={c.id} actions={<ListRowMeta>{formatDateTime(c.sent_at)}</ListRowMeta>}>
              <ListRowTitle>{c.subject}</ListRowTitle>
              <ListRowMeta>{c.communication_type} · {t('detail.recipients', { count: Number(c.recipient_count) })}</ListRowMeta>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

