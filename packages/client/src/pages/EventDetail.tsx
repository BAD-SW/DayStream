import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
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

export function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const handleCancel = async () => { if (confirm('Cancel this event?')) { const e = await eventsApi.cancelEvent(event.id); setEvent(e); } };
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
      <div className="evd-back">
        <Button variant="ghost" size="sm" onClick={() => navigate('/events')}>← Back</Button>
      </div>
      <PageHeader
        title={event.title}
        subtitle={`${event.event_type_name} · ${new Date(event.start_time).toLocaleDateString()}`}
        actions={<>
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
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this event?"
        message="It leaves the event lists and customers no longer see it. You can restore it from Events with Show deleted events."
        confirmLabel="Delete event"
        cancelLabel="Keep it"
      />
      <TabBar aria-label="Event sections" tabs={tabs} active={activeTab} onChange={setActiveTab} />
      {activeTab === 'details' && <DetailsTab event={event} />}
      {activeTab === 'tickets' && <TicketsTab eventId={event.id} />}
      {activeTab === 'registrations' && <RegistrationsTab eventId={event.id} />}
      {activeTab === 'waitlist' && <WaitlistTab eventId={event.id} />}
      {activeTab === 'facilitators' && <FacilitatorsTab eventId={event.id} />}
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
  const [locationId, setLocationId] = useState((event as any).location_id || '');
  const [taxId, setTaxId] = useState((event as any).tax_category_id || '');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    if (!businessId) return;
    getLocations(businessId).then(setLocations).catch(() => {});
    getTaxCategories(businessId).then(setTaxes).catch(() => {});
  }, [businessId]);
  const save = async (changes: Record<string, any>) => {
    setSaved('');
    try { await eventsApi.updateEvent(event.id, changes); setSaved('Saved'); }
    catch (e: any) { setSaved(e?.response?.data?.error || 'Not saved'); }
  };
  return (
    <>
      <div><dt>Hosted at</dt><dd>
        <select className="ev-select" aria-label="Hosted at" value={locationId}
          onChange={(e) => { setLocationId(e.target.value); save({ location_id: e.target.value || null }); }}>
          <option value="">{locationId && !locations.some((l) => l.id === locationId) ? 'A location of another business' : '— None —'}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </dd></div>
      <div><dt>Ticket tax</dt><dd>
        <select className="ev-select" aria-label="Ticket tax" value={taxId}
          onChange={(e) => { setTaxId(e.target.value); save({ tax_category_id: e.target.value }); }}>
          <option value="">Business default tax</option>
          {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.rate / 100).toLocaleString()}%)</option>)}
        </select>
        {saved && <span className="evd-label" style={{ marginLeft: 8 }}>{saved}</span>}
      </dd></div>
    </>
  );
}

function TicketsTab({ eventId }: { eventId: string }) {
  const [tiers, setTiers] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  useEffect(() => { eventsApi.getTiers(eventId).then(setTiers); }, [eventId]);

  const handleDelete = async (tierId: string) => {
    if (!confirm('Delete this ticket tier?')) return;
    await eventsApi.deleteTier(eventId, tierId);
    setTiers(tiers.filter((t) => t.id !== tierId));
  };

  const handleEdit = (t: any) => { setEditing(t.id); setEditName(t.name); setEditPrice(String(t.price / 100)); };

  const handleSave = async (tierId: string) => {
    const updated = await eventsApi.updateTier(eventId, tierId, { name: editName, price: Math.round(parseFloat(editPrice) * 100) });
    setTiers(tiers.map((t) => t.id === tierId ? updated : t));
    setEditing(null);
  };

  // A new ticket type (THE-20): who may buy it is everyone, members only (an active
  // membership at the hosting business) or first-time customers only (no earlier visit or
  // purchase there). "Custom" is not defined, so it is not offered.
  type Who = 'all' | 'members_only' | 'first_time';
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newWho, setNewWho] = useState<Who>('all');
  const [addError, setAddError] = useState('');
  const handleAdd = async () => {
    setAddError('');
    if (!newName.trim()) { setAddError('Give the ticket a name'); return; }
    try {
      const created = await eventsApi.createTier(eventId, {
        name: newName.trim(), price: Math.round((parseFloat(newPrice) || 0) * 100),
        quantity_available: newQty ? Number(newQty) : null, eligibility_type: newWho,
      });
      setTiers([...tiers, { ...created, sold_count: 0 }]);
      setNewName(''); setNewPrice(''); setNewQty(''); setNewWho('all');
    } catch (e: any) { setAddError(e?.response?.data?.error || 'The ticket could not be added'); }
  };

  return (
    <div>
      <h3 className="ev-section-title">Ticket Tiers</h3>
      {tiers.length === 0 ? <ListEmpty>No tiers configured</ListEmpty> : (
        <ListRows>
          {tiers.map((t: any) => editing === t.id ? (
            <ListRow key={t.id} actions={<>
              <Button size="sm" onClick={() => handleSave(t.id)}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </>}>
              <input className="ev-input" aria-label="Tier name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <input className="ev-input evd-price" aria-label="Price" type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
            </ListRow>
          ) : (
            <ListRow key={t.id} actions={<>
              <ListRowMeta>{t.sold_count || 0} / {t.quantity_available || '∞'} sold</ListRowMeta>
              <Button size="sm" variant="ghost" onClick={() => handleEdit(t)}>Edit</Button>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)}>Delete</Button>
            </>}>
              <ListRowTitle>{t.name}</ListRowTitle>
              <span>— {t.price > 0 ? formatCurrency(t.price) : 'Free'}</span>
              {t.eligibility_type === 'members_only' && <Badge variant="info">Members only</Badge>}
              {t.eligibility_type === 'first_time' && <Badge variant="info">First-time customers only</Badge>}
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
  const [facilitators, setFacilitators] = useState<any[]>([]);
  const [staffId, setStaffId] = useState('');
  const [role, setRole] = useState('facilitator');

  useEffect(() => { eventsApi.getFacilitators(eventId).then(setFacilitators).catch(() => {}); }, [eventId]);

  const handleAdd = async () => {
    if (!staffId) return;
    const f = await eventsApi.addFacilitator(eventId, { staff_id: staffId, role });
    setFacilitators([...facilitators, f]);
    setStaffId(''); setRole('facilitator');
  };

  const handleRemove = async (fid: string) => {
    if (!confirm('Remove this facilitator?')) return;
    await eventsApi.removeFacilitator(eventId, fid);
    setFacilitators(facilitators.filter((f) => f.id !== fid));
  };

  return (
    <div>
      <h3 className="ev-section-title">Facilitators</h3>
      <div className="ev-add-row">
        <input className="ev-input" aria-label="Staff ID" placeholder="Staff ID" value={staffId} onChange={(e) => setStaffId(e.target.value)} />
        <select className="ev-select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="facilitator">Facilitator</option>
          <option value="instructor">Instructor</option>
          <option value="assistant">Assistant</option>
        </select>
        <Button size="sm" onClick={handleAdd}>Add</Button>
      </div>
      {facilitators.length === 0 ? <ListEmpty>No facilitators assigned</ListEmpty> : (
        <ListRows>
          {facilitators.map((f: any) => (
            <ListRow key={f.id} actions={<Button size="sm" variant="destructive" onClick={() => handleRemove(f.id)}>Remove</Button>}>
              <ListRowTitle>{f.staff_name || f.staff_id}</ListRowTitle>
              <Badge variant="neutral">{f.role}</Badge>
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
