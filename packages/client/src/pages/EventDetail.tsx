import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';

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

  if (loading) return <div className="p-6">Loading...</div>;
  if (!event) return <div className="p-6">Event not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Details' }, { key: 'tickets', label: 'Tickets' },
    { key: 'registrations', label: 'Registrations' }, { key: 'waitlist', label: 'Waitlist' },
    { key: 'facilitators', label: 'Facilitators' },
    { key: 'communications', label: 'Communications' }, { key: 'reports', label: 'Reports' },
  ];

  const handlePublish = async () => { const e = await eventsApi.publishEvent(event.id); setEvent(e); };
  const handleCancel = async () => { if (confirm('Cancel this event?')) { const e = await eventsApi.cancelEvent(event.id); setEvent(e); } };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" onClick={() => navigate('/events')}>← Back</Button>
          <h1 className="text-2xl font-semibold mt-2">{event.title}</h1>
          <p className="text-sm text-gray-500">{event.event_type_name} · {new Date(event.start_time).toLocaleDateString()}</p>
        </div>
        <div className="flex gap-2 items-center">
          {event.status === 'draft' && <Button onClick={handlePublish}>Publish</Button>}
          {event.status === 'published' && <Button variant="destructive" onClick={handleCancel}>Cancel</Button>}
          <Badge variant={event.status === 'published' ? 'success' : event.status === 'cancelled' ? 'error' : 'neutral'}>{event.status}</Badge>
        </div>
      </div>
      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
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
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <div><span className="text-gray-500 text-sm">Start:</span> {new Date(event.start_time).toLocaleString()}</div>
        <div><span className="text-gray-500 text-sm">End:</span> {new Date(event.end_time).toLocaleString()}</div>
        <div><span className="text-gray-500 text-sm">Location:</span> {event.location_name || '—'}</div>
        <div><span className="text-gray-500 text-sm">Capacity:</span> {event.registrations_count} / {event.capacity}</div>
        {event.tags?.length > 0 && <div><span className="text-gray-500 text-sm">Tags:</span> {event.tags.join(', ')}</div>}
      </div>
      <div><span className="text-gray-500 text-sm">Description:</span><p className="text-sm mt-1">{event.description || 'No description'}</p></div>
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
      <h3 className="font-medium mb-4">Ticket Tiers</h3>
      {tiers.length === 0 ? <p className="text-gray-500 text-sm">No tiers configured</p> : (
        <div className="space-y-2">
          {tiers.map((t: any) => (
            <div key={t.id} className="border rounded p-3 flex justify-between items-center">
              {editing === t.id ? (
                <div className="flex gap-2 items-center flex-1">
                  <input className="border rounded px-2 py-1 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input className="border rounded px-2 py-1 text-sm w-24" type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                  <Button size="sm" onClick={() => handleSave(t.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              ) : (
                <>
                  <div><span className="font-medium">{t.name}</span> — ${(t.price / 100).toFixed(2)}</div>
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-gray-500">{t.sold_count || 0} / {t.quantity_available || '∞'} sold</span>
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(t)}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)}>Delete</Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
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
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-medium">Registrations ({regs.length})</h3>
        <Button size="sm" variant="ghost" onClick={handleExportAttendees}>Export Attendees</Button>
      </div>
      {regs.length === 0 ? <p className="text-gray-500 text-sm">No registrations yet</p> : (
        <div className="space-y-2">
          {regs.map((r: any) => (
            <div key={r.id} className="border rounded p-2">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{r.first_name} {r.last_name}</span>
                  <span className="text-xs text-gray-500 ml-2">{r.reference_number}</span>
                </div>
                <div className="flex gap-2 items-center">
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
                </div>
              </div>
              {transferTarget === r.id && (
                <div className="flex gap-2 mt-2 items-center">
                  <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Recipient email" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} />
                  <Button size="sm" onClick={() => handleTransfer(r.id)}>Confirm Transfer</Button>
                  <Button size="sm" variant="ghost" onClick={() => setTransferTarget(null)}>Cancel</Button>
                </div>
              )}
            </div>
          ))}
        </div>
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
      <h3 className="font-medium mb-4">Waitlist ({waitlist.length})</h3>
      {waitlist.length === 0 ? <p className="text-gray-500 text-sm">No one on waitlist</p> : (
        <div className="space-y-2">
          {waitlist.map((w: any) => (
            <div key={w.id} className="border rounded p-2 flex justify-between items-center">
              <span>#{w.position} — {w.first_name} {w.last_name}</span>
              <div className="flex gap-2 items-center">
                <Badge variant={w.status === 'waiting' ? 'info' : 'warning'}>{w.status}</Badge>
                {w.status === 'waiting' && <Button size="sm" onClick={() => handleConfirm(w.id)}>Confirm</Button>}
              </div>
            </div>
          ))}
        </div>
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
      <h3 className="font-medium mb-4">Facilitators</h3>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Staff ID" value={staffId} onChange={(e) => setStaffId(e.target.value)} />
        <select className="border rounded px-2 py-1 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="facilitator">Facilitator</option>
          <option value="instructor">Instructor</option>
          <option value="assistant">Assistant</option>
        </select>
        <Button size="sm" onClick={handleAdd}>Add</Button>
      </div>
      {facilitators.length === 0 ? <p className="text-gray-500 text-sm">No facilitators assigned</p> : (
        <div className="space-y-2">
          {facilitators.map((f: any) => (
            <div key={f.id} className="border rounded p-2 flex justify-between items-center">
              <div>
                <span className="font-medium">{f.staff_name || f.staff_id}</span>
                <Badge variant="neutral" className="ml-2">{f.role}</Badge>
              </div>
              <Button size="sm" variant="destructive" onClick={() => handleRemove(f.id)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommsTab({ eventId }: { eventId: string }) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => { eventsApi.getCommunications(eventId).then(setHistory); }, [eventId]);
  return (
    <div>
      <h3 className="font-medium mb-4">Communications</h3>
      {history.length === 0 ? <p className="text-gray-500 text-sm">No communications sent</p> : (
        <div className="space-y-2">
          {history.map((c: any) => (
            <div key={c.id} className="border rounded p-2">
              <div className="flex justify-between"><span className="font-medium">{c.subject}</span><span className="text-xs text-gray-500">{new Date(c.sent_at).toLocaleString()}</span></div>
              <div className="text-xs text-gray-500">{c.communication_type} · {c.recipient_count} recipients</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportsTab({ eventId }: { eventId: string }) {
  const [report, setReport] = useState<any>(null);
  useEffect(() => { eventsApi.getEventReport(eventId).then(setReport).catch(() => {}); }, [eventId]);
  if (!report) return <div>Loading...</div>;
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">{report.registrations?.confirmed || 0}</div><div className="text-sm text-gray-500">Confirmed</div></div>
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">{report.attendanceRate}%</div><div className="text-sm text-gray-500">Attendance Rate</div></div>
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">${((report.revenue || 0) / 100).toFixed(0)}</div><div className="text-sm text-gray-500">Revenue</div></div>
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">{report.capacityUtilization}%</div><div className="text-sm text-gray-500">Capacity Used</div></div>
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">{report.waitlistSize}</div><div className="text-sm text-gray-500">Waitlist</div></div>
      <div className="border rounded p-4 text-center"><div className="text-2xl font-bold">{report.cancellationRate}%</div><div className="text-sm text-gray-500">Cancellation Rate</div></div>
    </div>
  );
}
