import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, confirmLeave } from '../components/unsaved/LeaveGuard';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { Alert } from '../design-system/components/feedback/Alert';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';
import { formatCurrency } from '../utils/currency';
import { getLocations } from '../api/locations';
import { getTaxCategories } from '../api/services';
import './Events.css';
import './EventDetail.css';

type Tab = 'details' | 'tickets' | 'registrations' | 'waitlist' | 'facilitators' | 'communications' | 'reports';

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
  const [activeTab, setActiveTab] = useState<Tab>('details');
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
    { key: 'details', label: 'Details' }, { key: 'tickets', label: 'Tickets' },
    { key: 'registrations', label: 'Registrations' }, { key: 'waitlist', label: 'Waitlist' },
    { key: 'facilitators', label: 'Facilitators' },
    { key: 'communications', label: 'Communications' }, { key: 'reports', label: 'Reports' },
  ];

  const handlePublish = async () => { const e = await eventsApi.publishEvent(event.id); setEvent(e); };
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
        subtitle={`${event.event_type_name} · ${new Date(event.start_time).toLocaleDateString()}`}
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
              {event.status === 'published' && <Button variant="destructive" onClick={handleCancel}>Cancel</Button>}
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete event</Button>
            </>
          )}
          <Badge variant={event.status === 'published' ? 'success' : event.status === 'cancelled' ? 'error' : 'neutral'}>{event.status}</Badge>
        </>}
      />
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
      <div hidden={activeTab !== 'details'}><DraftTab tab="details"><DetailsTab event={event} /></DraftTab></div>
      <div hidden={activeTab !== 'tickets'}><DraftTab tab="tickets"><TicketsTab eventId={event.id} /></DraftTab></div>
      {activeTab === 'registrations' && <RegistrationsTab eventId={event.id} />}
      {activeTab === 'waitlist' && <WaitlistTab eventId={event.id} />}
      <div hidden={activeTab !== 'facilitators'}><DraftTab tab="facilitators"><FacilitatorsTab eventId={event.id} /></DraftTab></div>
      {activeTab === 'communications' && <CommsTab eventId={event.id} />}
      {activeTab === 'reports' && <ReportsTab eventId={event.id} />}
    </div>
  );
}

function DetailsTab({ event }: { event: Event }) {
  return (
    <div className="evd-details">
      <dl className="evd-facts">
        <div><dt>Start</dt><dd>{new Date(event.start_time).toLocaleString()}</dd></div>
        <div><dt>End</dt><dd>{new Date(event.end_time).toLocaleString()}</dd></div>
        <div><dt>Location</dt><dd>{event.location_name || '—'}</dd></div>
        <HostAndTax event={event} />
        <div><dt>Capacity</dt><dd>{event.registrations_count} / {event.capacity}</dd></div>
        {event.tags?.length > 0 && <div><dt>Tags</dt><dd>{event.tags.join(', ')}</dd></div>}
      </dl>
      <div className="evd-description">
        <span className="evd-label">Description</span>
        <p>{event.description || 'No description'}</p>
      </div>
    </div>
  );
}

// Where the event is held decides which business sells its tickets; the tax is one of that
// business's tax categories, or its default tax (THE-20).
function HostAndTax({ event }: { event: Event }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [locations, setLocations] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const draft = useDraft('event-details', 'Details', { location_id: (event as any).location_id || '', tax_category_id: (event as any).tax_category_id || '' },
    async (d) => { await eventsApi.updateEvent(event.id, { location_id: d.location_id || null, tax_category_id: d.tax_category_id }); });
  const locationId = draft.value.location_id;
  const taxId = draft.value.tax_category_id;
  useEffect(() => {
    if (!businessId) return;
    getLocations(businessId).then(setLocations).catch(() => {});
    getTaxCategories(businessId).then(setTaxes).catch(() => {});
  }, [businessId]);
  return (
    <>
      <div><dt>Hosted at</dt><dd>
        <select className="ev-select" aria-label="Hosted at" value={locationId} style={fieldMark(draft.changed((v) => v.location_id))}
          onChange={(e) => draft.setValue({ ...draft.value, location_id: e.target.value })}>
          <option value="">{locationId && !locations.some((l) => l.id === locationId) ? 'A location of another business' : '— None —'}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </dd></div>
      <div><dt>Ticket tax</dt><dd>
        <select className="ev-select" aria-label="Ticket tax" value={taxId} style={fieldMark(draft.changed((v) => v.tax_category_id))}
          onChange={(e) => draft.setValue({ ...draft.value, tax_category_id: e.target.value })}>
          <option value="">Business default tax</option>
          {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.rate / 100).toLocaleString()}%)</option>)}
        </select>
        <UnsavedTag dirty={draft.dirty} />
      </dd></div>
    </>
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
                <ListRowTitle>{r.first_name} {r.last_name}</ListRowTitle>
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

  useEffect(() => { eventsApi.getFacilitators(eventId).then(list.load).catch(() => {}); }, [eventId, list.load]);

  const handleAdd = () => {
    if (!staffId) return;
    list.add({ staff_id: staffId, role });
    setStaffId(''); setRole('facilitator');
  };

  return (
    <div>
      <h3 className="ev-section-title">Facilitators<UnsavedTag dirty={list.dirty} /></h3>
      <div className="ev-add-row">
        <input className="ev-input" aria-label="Staff ID" placeholder="Staff ID" value={staffId} onChange={(e) => setStaffId(e.target.value)} />
        <select className="ev-select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="facilitator">Facilitator</option>
          <option value="instructor">Instructor</option>
          <option value="assistant">Assistant</option>
        </select>
        <Button size="sm" onClick={handleAdd}>Add</Button>
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

function ReportsTab({ eventId }: { eventId: string }) {
  const [report, setReport] = useState<any>(null);
  useEffect(() => { eventsApi.getEventReport(eventId).then(setReport).catch(() => {}); }, [eventId]);
  if (!report) return <ListEmpty>Loading...</ListEmpty>;
  const stats: [string, string | number][] = [
    ['Confirmed', report.registrations?.confirmed || 0],
    ['Attendance Rate', `${report.attendanceRate}%`],
    ['Revenue', formatCurrency(report.revenue || 0)],
    ['Capacity Used', `${report.capacityUtilization}%`],
    ['Waitlist', report.waitlistSize],
    ['Cancellation Rate', `${report.cancellationRate}%`],
  ];
  return (
    <div className="evd-stats">
      {stats.map(([label, value]) => (
        <div key={label} className="evd-stat">
          <div className="evd-stat__value">{value}</div>
          <div className="evd-stat__label">{label}</div>
        </div>
      ))}
    </div>
  );
}
