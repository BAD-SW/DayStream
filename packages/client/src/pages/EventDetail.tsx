import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';

type Tab = 'details' | 'tickets' | 'registrations' | 'waitlist' | 'communications' | 'reports';

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
  useEffect(() => { eventsApi.getTiers(eventId).then(setTiers); }, [eventId]);
  return (
    <div>
      <h3 className="font-medium mb-4">Ticket Tiers</h3>
      {tiers.length === 0 ? <p className="text-gray-500 text-sm">No tiers configured</p> : (
        <div className="space-y-2">
          {tiers.map((t: any) => (
            <div key={t.id} className="border rounded p-3 flex justify-between items-center">
              <div><span className="font-medium">{t.name}</span> — ${(t.price / 100).toFixed(2)}</div>
              <div className="text-sm text-gray-500">{t.sold_count || 0} / {t.quantity_available || '∞'} sold</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegistrationsTab({ eventId }: { eventId: string }) {
  const [regs, setRegs] = useState<any[]>([]);
  useEffect(() => { eventsApi.getRegistrations(eventId).then((r) => setRegs(r.data)); }, [eventId]);
  return (
    <div>
      <h3 className="font-medium mb-4">Registrations ({regs.length})</h3>
      {regs.length === 0 ? <p className="text-gray-500 text-sm">No registrations yet</p> : (
        <div className="space-y-2">
          {regs.map((r: any) => (
            <div key={r.id} className="border rounded p-2 flex justify-between items-center">
              <div>
                <span className="font-medium">{r.first_name} {r.last_name}</span>
                <span className="text-xs text-gray-500 ml-2">{r.reference_number}</span>
              </div>
              <div className="flex gap-2 items-center">
                {r.checked_in_at && <Badge variant="success">Checked In</Badge>}
                <Badge variant={r.status === 'confirmed' ? 'success' : r.status === 'cancelled' ? 'error' : 'neutral'}>{r.status}</Badge>
              </div>
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
  return (
    <div>
      <h3 className="font-medium mb-4">Waitlist ({waitlist.length})</h3>
      {waitlist.length === 0 ? <p className="text-gray-500 text-sm">No one on waitlist</p> : (
        <div className="space-y-2">
          {waitlist.map((w: any) => (
            <div key={w.id} className="border rounded p-2 flex justify-between">
              <span>#{w.position} — {w.first_name} {w.last_name}</span>
              <Badge variant={w.status === 'waiting' ? 'info' : 'warning'}>{w.status}</Badge>
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
