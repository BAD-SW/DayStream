import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';
import { formatCurrency } from '../utils/currency';
import './Events.css';
import './EventDetail.css';

type Tab = 'details' | 'tickets' | 'registrations' | 'waitlist' | 'facilitators' | 'communications' | 'reports';

export function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <div className="evd-back">
        <Button variant="ghost" size="sm" onClick={() => navigate('/events')}>← Back</Button>
      </div>
      <PageHeader
        title={event.title}
        subtitle={`${event.event_type_name} · ${new Date(event.start_time).toLocaleDateString()}`}
        actions={<>
          {event.status === 'draft' && <Button onClick={handlePublish}>Publish</Button>}
          {event.status === 'published' && <Button variant="destructive" onClick={handleCancel}>Cancel</Button>}
          <Badge variant={event.status === 'published' ? 'success' : event.status === 'cancelled' ? 'error' : 'neutral'}>{event.status}</Badge>
        </>}
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
              <span>— {formatCurrency(t.price)}</span>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

function RegistrationsTab({ eventId }: { eventId: string }) {
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
              </>}>
                <ListRowTitle>{r.first_name} {r.last_name}</ListRowTitle>
                <ListRowMeta>{r.reference_number}</ListRowMeta>
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
