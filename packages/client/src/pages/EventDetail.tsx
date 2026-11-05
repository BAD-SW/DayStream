import { useState, useEffect } from 'react';
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
    setSaveResult(failed.length ? { ok: false, text: `Not saved: ${failed.map((f) => `${f.label} (${f.error})`).join('; ')}` } : { ok: true, text: 'All changes saved.' });
  };
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!id) return;
    eventsApi.getEvent(id).then(setEvent).catch(() => navigate('/events')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  if (!event) return <ListEmpty>Event not found</ListEmpty>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' }, { key: 'tickets', label: 'Tickets' },
    { key: 'registrations', label: 'Registrations' }, { key: 'waitlist', label: 'Waitlist' },
    { key: 'facilitators', label: 'Facilitators' },
    { key: 'communications', label: 'Communications' },
  ];

  const handlePublish = async () => {
    setProblem('');
    try { const e = await eventsApi.publishEvent(event.id); setEvent({ ...event, ...e }); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be published.'); }
  };
  // Back to draft, only while nobody is registered or waiting (decision 14).
  const handleUnpublish = async () => {
    setProblem('');
    try { const e = await eventsApi.unpublishEvent(event.id); setEvent({ ...event, ...e }); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be unpublished.'); }
  };
  // Before cancelling, say what will happen (David, 2026-10-29): registrations cancelled and
  // emailed, paid tickets refunded to the card or account credit, the waiting list emptied.
  const handleCancel = async () => {
    setProblem('');
    try { setCancelPreview(await eventsApi.getCancelPreview(event.id)); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be cancelled.'); }
  };
  const confirmCancel = async () => {
    setCancelling(true); setProblem('');
    try { setEvent({ ...event, ...(await eventsApi.cancelEvent(event.id)) }); setCancelPreview(null); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be cancelled.'); setCancelPreview(null); }
    finally { setCancelling(false); }
  };
  const cancelText = (p: eventsApi.CancelPreview) => {
    const lines: string[] = [];
    lines.push(p.registrations === 0 ? 'Nobody is registered.'
      : `${p.registrations} ${p.registrations === 1 ? 'registration is' : 'registrations are'} cancelled and ${p.registrations === 1 ? 'the customer is' : 'the customers are'} emailed.`);
    if (p.paid_tickets > 0) {
      lines.push(`${p.paid_tickets} paid ${p.paid_tickets === 1 ? 'ticket is' : 'tickets are'} refunded, ${formatCurrency(p.refund_amount, p.currency)} in total, ${p.refund_to === 'credit' ? "to the customers' account credit" : "to the customers' card or original payment"} (as set in Settings › System › Customer cancellations › Events).`);
    }
    if (p.waiting > 0) lines.push(`${p.waiting} ${p.waiting === 1 ? 'person leaves' : 'people leave'} the waiting list.`);
    lines.push('This cannot be undone.');
    return lines.join(' ');
  };
  // Delete archives the event (David, 2026-10-28); it is refused while people are registered or waiting.
  const handleDelete = async () => {
    setProblem('');
    try { await eventsApi.deleteEvent(event.id); navigate('/events'); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be deleted.'); }
  };
  const handleRestore = async () => {
    setProblem('');
    try { setEvent({ ...event, ...(await eventsApi.restoreEvent(event.id)) }); }
    catch (err: any) { setProblem(err?.response?.data?.error || 'The event could not be restored.'); }
  };

  return (
    <div>
      <LeaveGuard when={dirty} />
      <StickyPageTop>
      <div className="evd-back">
        <Button variant="ghost" size="sm" onClick={() => confirmLeave(() => navigate('/events'))}>← Back</Button>
      </div>
      <PageHeader
        title={event.title}
        subtitle={[event.event_type_name, event.location_name].filter(Boolean).join(' · ')}
        actions={<>
          {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>You have unsaved changes.</span>
            : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
          <Button onClick={saveChanges} loading={saving} disabled={!dirty}>Save changes</Button>
          {event.deleted_at ? (
            <>
              <Badge variant="error">deleted</Badge>
              <Button onClick={handleRestore}>Restore</Button>
            </>
          ) : (
            <>
              {event.status === 'draft' && <Button onClick={handlePublish}>Publish</Button>}
              {event.status === 'published' && event.registrations_count === 0 && <Button variant="ghost" onClick={handleUnpublish}>Unpublish</Button>}
              {event.status === 'published' && <Button variant="destructive" onClick={handleCancel}>Cancel</Button>}
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete event</Button>
            </>
          )}
          <Badge variant={event.status === 'published' ? 'success' : event.status === 'cancelled' ? 'error' : 'neutral'}>{event.status}</Badge>
        </>}
      />
      <EventWhen start={event.start_time} end={event.end_time} />
      {problem && <Alert variant="error">{problem}</Alert>}
      <ConfirmDialog
        open={!!cancelPreview && !cancelling}
        onClose={() => setCancelPreview(null)}
        onConfirm={confirmCancel}
        title="Cancel this event?"
        message={cancelPreview ? cancelText(cancelPreview) : ''}
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
      />
      {cancelling && <Alert variant="info">Cancelling the event and refunding paid tickets…</Alert>}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this event?"
        message="It leaves the event lists and customers no longer see it. You can restore it from Events with Show deleted events."
        confirmLabel="Delete event"
        cancelLabel="Keep it"
      />
      <TabBar aria-label="Event sections" tabs={tabs.map((t) => ({ ...t, changed: dirtySections.some((s) => s.tab === t.key) }))} active={activeTab} onChange={setActiveTab} />
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

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// The date and time, the largest line under the title (THE-23 item 3, option D).
function EventWhen({ start, end }: { start: string; end: string }) {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const length = mins >= 60 ? `${Math.floor(mins / 60)} ${Math.floor(mins / 60) === 1 ? 'hour' : 'hours'}${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`;
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
  const until = new Date(notice.refund_until).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const [subject, setSubject] = useState(`Change to ${event.title}`);
  const [content, setContent] = useState(
    `Hello,\n\n${event.title} has changed. It now takes place on ${fmtDay(event.start_time)}, ${fmtTime(event.start_time)} – ${fmtTime(event.end_time)}`
    + `${event.location_name ? `, at ${event.location_name}` : ''}.\n\nIf you can no longer come, you can cancel from your account for a full refund until ${until}.\n\nSee you there!`,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setSending(true); setError('');
    try { await eventsApi.sendCommunication(event.id, { subject, content }); onClose(); }
    catch (err: any) { setError(err?.response?.data?.error || 'The message could not be sent.'); }
    finally { setSending(false); }
  };
  const people = `${notice.registrations} ${notice.registrations === 1 ? 'person is' : 'people are'}`;
  return (
    <Modal open onClose={onClose} title="Tell the registered people?" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Don't send</Button><Button onClick={send} loading={sending}>Send to {notice.registrations}</Button></>}>
      <p style={{ marginTop: 0, fontSize: 'var(--font-size-sm)' }}>The date, time or place changed and {people} registered. Until <b>{until}</b> ({notice.refund_days} days, or the start if sooner) each of them can cancel for a full refund, even where cancelling is not normally allowed.</p>
      <label className="evd-field">Subject<input className="ev-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="evd-field" style={{ marginTop: 'var(--space-sm)' }}>Message<textarea className="ev-input evd-textarea" rows={8} value={content} onChange={(e) => setContent(e.target.value)} /></label>
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

  const draft = useDraft<EventForm>('event-details', 'Overview', toForm(event), async (f) => {
    if (!f.title.trim()) throw new Error('Give the event a title');
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

  const pct = (v: any) => `${Number(v || 0)}%`;
  const figures: [string, string | number][] = [
    [`${event.registrations_count} / ${event.capacity}`, `Registered · ${pct(report?.capacityUtilization)} full`],
    [report?.registrations?.confirmed ?? 0, 'Confirmed'],
    [formatCurrency(report?.revenue || 0), 'Revenue'],
    [pct(report?.attendanceRate), 'Attendance rate'],
    [report?.waitlistSize ?? 0, 'Waitlist'],
    [pct(report?.cancellationRate), 'Cancellation rate'],
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
          <h3 className="evd-card__title">Settings<UnsavedTag dirty={draft.dirty} /></h3>
          <div className="evd-fields">
            <label className="evd-field">Title<input className="ev-input" value={f.title} onChange={(e) => set({ title: e.target.value })} style={mark('title')} /></label>
            <label className="evd-field">Type<select className="ev-select" value={f.event_type_id} onChange={(e) => set({ event_type_id: e.target.value })} style={mark('event_type_id')}>
              {!types.some((t) => t.id === f.event_type_id) && <option value={f.event_type_id}>{event.event_type_name || '—'}</option>}
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
            <label className="evd-field">Start<input className="ev-input" type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} style={mark('start')} /></label>
            <label className="evd-field">End<input className="ev-input" type="datetime-local" value={f.end} onChange={(e) => set({ end: e.target.value })} style={mark('end')} /></label>
            <label className="evd-field">Hosted at<select className="ev-select" aria-label="Hosted at" value={f.location_id} onChange={(e) => set({ location_id: e.target.value })} style={mark('location_id')}>
              <option value="">{unknownPlace ? 'A location of another business' : '— None —'}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
            <label className="evd-field">Capacity<input className="ev-input" type="number" min={Math.max(1, event.registrations_count)} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} style={mark('capacity')} /></label>
            <label className="evd-field">Ticket tax<select className="ev-select" aria-label="Ticket tax" value={f.tax_category_id} onChange={(e) => set({ tax_category_id: e.target.value })} style={mark('tax_category_id')}>
              <option value="">Business default tax</option>
              {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.rate / 100).toLocaleString()}%)</option>)}
            </select></label>
            <label className="evd-field">Tags<input className="ev-input" placeholder="Comma-separated" value={f.tags} onChange={(e) => set({ tags: e.target.value })} style={mark('tags')} /></label>
          </div>
          {!f.location_id && event.location_name && <p className="evd-hint">Was entered as text: “{event.location_name}”. Choose where it is hosted.</p>}
        </section>
        <section className="evd-card" style={draftBox(draft.dirty)}>
          <h3 className="evd-card__title">Description</h3>
          <textarea className="ev-input evd-textarea" aria-label="Description" rows={4} value={f.description} placeholder="What the event is about"
            onChange={(e) => set({ description: e.target.value })} style={mark('description')} />
        </section>
      </div>
    </div>
  );
}

function TicketsTab({ eventId }: { eventId: string }) {
  type Who = 'all' | 'members_only' | 'first_time';
  type Tier = { id?: string; name: string; price: number; quantity_available: number | null; eligibility_type: Who; sold_count?: number };
  const list = useDraftList<Tier>('event-tickets', 'Tickets', {
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
    if (!newName.trim()) { setAddError('Give the ticket a name'); return; }
    list.add({ name: newName.trim(), price: Math.round((parseFloat(newPrice) || 0) * 100), quantity_available: newQty ? Number(newQty) : null, eligibility_type: newWho });
    setNewName(''); setNewPrice(''); setNewQty(''); setNewWho('all');
  };

  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">Ticket Tiers<UnsavedTag dirty={list.dirty} /></h3>
      {list.rows.length === 0 ? <ListEmpty>No tiers configured</ListEmpty> : (
        <ListRows>
          {list.rows.map((r) => r.deleted ? (
            <ListRow key={r.key} actions={<Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button>}>
              <ListRowTitle><s>{r.item.name}</s></ListRowTitle>
              <RowTag>Deleted when you save</RowTag>
            </ListRow>
          ) : (
            <ListRow key={r.key} actions={<>
              <ListRowMeta>{r.item.sold_count || 0} / {r.item.quantity_available || '∞'} sold</ListRowMeta>
              <Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>Delete</Button>
            </>}>
              <input className="ev-input" aria-label="Tier name" value={r.item.name} style={fieldMark(!!r.isNew || list.changed(r, (t) => t.name))}
                onChange={(e) => list.edit(r.key, { name: e.target.value })} />
              <input className="ev-input evd-price" aria-label="Price" type="number" step="0.01" min="0" value={r.item.price / 100}
                style={fieldMark(!!r.isNew || list.changed(r, (t) => t.price))}
                onChange={(e) => list.edit(r.key, { price: Math.round((parseFloat(e.target.value) || 0) * 100) })} />
              {r.item.eligibility_type === 'members_only' && <Badge variant="info">Members only</Badge>}
              {r.item.eligibility_type === 'first_time' && <Badge variant="info">First-time customers only</Badge>}
              {r.isNew && <RowTag>New</RowTag>}
            </ListRow>
          ))}
        </ListRows>
      )}
      <div className="ev-add-row" style={{ marginTop: 'var(--space-md)', flexWrap: 'wrap' }}>
        <input className="ev-input" aria-label="New ticket name" placeholder="Ticket name (e.g. Standard)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input className="ev-input evd-price" aria-label="New ticket price" placeholder="Price (0 = free)" type="number" step="0.01" min="0" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
        <input className="ev-input evd-price" aria-label="How many" placeholder="How many (blank = no limit)" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
        <select className="ev-select" aria-label="Who can buy it" value={newWho} onChange={(e) => setNewWho(e.target.value as Who)}>
          <option value="all">Everyone</option>
          <option value="members_only">Members only</option>
          <option value="first_time">First-time customers only</option>
        </select>
        <Button size="sm" onClick={handleAdd}>Add ticket</Button>
      </div>
      {addError && <p className="evd-label" style={{ color: 'var(--color-error)' }}>{addError}</p>}
    </div>
  );
}

function RegistrationsTab({ eventId }: { eventId: string }) {
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
    } catch { alert('Export failed'); }
  };

  const handleCancel = async (regId: string) => {
    if (!confirm('Cancel this registration?')) return;
    const updated = await eventsApi.cancelRegistration(regId);
    setRegs(regs.map((r) => r.id === regId ? { ...r, status: updated.status || 'cancelled' } : r));
  };

  const handleTakePayment = async (regId: string) => {
    try {
      const { order_id } = await eventsApi.openRegistrationCheckout(regId);
      navigate(`/checkout?order=${order_id}`);
    } catch (e: any) { alert(e?.response?.data?.error || 'The payment could not be opened'); }
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
        <h3 className="ev-section-title">Registrations ({regs.length})</h3>
        <Button size="sm" variant="ghost" onClick={handleExportAttendees}>Export Attendees</Button>
      </div>
      {regs.length === 0 ? <ListEmpty>No registrations yet</ListEmpty> : (
        <ListRows>
          {regs.map((r: any) => (
            <div key={r.id}>
              <ListRow actions={<>
                {r.checked_in_at && <Badge variant="success">Checked In</Badge>}
                <Badge variant={r.status === 'confirmed' ? 'success' : r.status === 'cancelled' ? 'error' : 'neutral'}>{r.status}</Badge>
                {r.status === 'confirmed' && !r.checked_in_at && (
                  <Button size="sm" onClick={() => handleCheckIn(r.id)}>Check In</Button>
                )}
                {r.status === 'confirmed' && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setTransferTarget(r.id)}>Transfer</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleCancel(r.id)}>Cancel</Button>
                  </>
                )}
                {/* A place held until it is paid (THE-20): reception takes the payment through
                    checkout, which confirms the place, or cancels it. */}
                {r.status === 'pending' && (
                  <>
                    <Badge variant="warning">{r.pay_at === 'online' ? 'Paying online' : 'Pay at reception'}</Badge>
                    {r.pay_at !== 'online' && <Button size="sm" onClick={() => handleTakePayment(r.id)}>Take payment</Button>}
                    <Button size="sm" variant="destructive" onClick={() => handleCancel(r.id)}>Cancel</Button>
                  </>
                )}
              </>}>
                {/* The name opens the person's profile (THE-23 item 1). */}
                <ListRowTitle>{r.customer_id ? <Link to={`/customers/${r.customer_id}`}>{r.first_name} {r.last_name}</Link> : <>{r.first_name} {r.last_name}</>}</ListRowTitle>
                <ListRowMeta>{r.reference_number}{r.tier_name ? ` · ${r.tier_name}` : ''}{r.group_size > 1 ? ` × ${r.group_size}` : ''}</ListRowMeta>
              </ListRow>
              {transferTarget === r.id && (
                <div className="evd-inline-form">
                  <input className="ev-input" aria-label="Recipient email" placeholder="Recipient email" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} />
                  <Button size="sm" onClick={() => handleTransfer(r.id)}>Confirm Transfer</Button>
                  <Button size="sm" variant="ghost" onClick={() => setTransferTarget(null)}>Cancel</Button>
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
  const [waitlist, setWaitlist] = useState<any[]>([]);
  useEffect(() => { eventsApi.getWaitlist(eventId).then(setWaitlist); }, [eventId]);

  const handleConfirm = async (waitlistId: string) => {
    await eventsApi.confirmWaitlist(waitlistId);
    setWaitlist(waitlist.filter((w) => w.id !== waitlistId));
  };

  return (
    <div>
      <h3 className="ev-section-title">Waitlist ({waitlist.length})</h3>
      {waitlist.length === 0 ? <ListEmpty>No one on waitlist</ListEmpty> : (
        <ListRows>
          {waitlist.map((w: any) => (
            <ListRow key={w.id} actions={<>
              <Badge variant={w.status === 'waiting' ? 'info' : 'warning'}>{w.status}</Badge>
              {w.status === 'waiting' && <Button size="sm" onClick={() => handleConfirm(w.id)}>Confirm</Button>}
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
  type Fac = { id?: string; staff_id: string; role: string; staff_name?: string };
  const list = useDraftList<Fac>('event-facilitators', 'Facilitators', {
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
      <h3 className="ev-section-title">Facilitators<UnsavedTag dirty={list.dirty} /></h3>
      <div className="ev-add-row">
        <select className="ev-select" aria-label="Staff member" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">Choose a staff member…</option>
          {staff.filter((p) => !taken.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>
        <select className="ev-select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="facilitator">Facilitator</option>
          <option value="instructor">Instructor</option>
          <option value="assistant">Assistant</option>
        </select>
        <Button size="sm" onClick={handleAdd} disabled={!staffId}>Add</Button>
      </div>
      {list.rows.length === 0 ? <ListEmpty>No facilitators assigned</ListEmpty> : (
        <ListRows>
          {list.rows.map((r) => (
            <ListRow key={r.key} actions={r.deleted
              ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button>
              : <Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>Remove</Button>}>
              <ListRowTitle>{r.deleted ? <s>{r.item.staff_name || r.item.staff_id}</s> : (r.item.staff_name || r.item.staff_id)}</ListRowTitle>
              <Badge variant="neutral">{r.item.role}</Badge>
              {r.isNew && <RowTag>New</RowTag>}
              {r.deleted && <RowTag>Removed when you save</RowTag>}
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

function CommsTab({ eventId }: { eventId: string }) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => { eventsApi.getCommunications(eventId).then(setHistory); }, [eventId]);
  return (
    <div>
      <h3 className="ev-section-title">Communications</h3>
      {history.length === 0 ? <ListEmpty>No communications sent</ListEmpty> : (
        <ListRows>
          {history.map((c: any) => (
            <ListRow key={c.id} actions={<ListRowMeta>{new Date(c.sent_at).toLocaleString()}</ListRowMeta>}>
              <ListRowTitle>{c.subject}</ListRowTitle>
              <ListRowMeta>{c.communication_type} · {c.recipient_count} recipients</ListRowMeta>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

