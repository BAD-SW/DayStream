import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as resourcesApi from '../api/resources';
import type { Resource } from '../api/resources';

type Tab = 'details' | 'schedule' | 'services' | 'maintenance' | 'dependencies' | 'calendar' | 'utilization';

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resource, setResource] = useState<Resource | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    resourcesApi.getResource(id).then(setResource).catch(() => navigate('/resources')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!resource) return <div className="p-6">Resource not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'services', label: 'Services' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'dependencies', label: 'Dependencies' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'utilization', label: 'Utilization' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" onClick={() => navigate('/resources')}>← Back</Button>
          <h1 className="text-2xl font-semibold mt-2">
            {resource.name}
            <span className="text-sm text-gray-500 ml-2">{resource.type_name}</span>
          </h1>
        </div>
        <Badge variant={resource.status === 'active' ? 'success' : 'warning'}>{resource.status}</Badge>
      </div>

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${
                activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'details' && <DetailsTab resource={resource} />}
      {activeTab === 'schedule' && <ScheduleTab resourceId={resource.id} />}
      {activeTab === 'calendar' && <CalendarTab resourceId={resource.id} />}
      {activeTab === 'utilization' && <UtilizationTab resourceId={resource.id} />}
      {activeTab === 'maintenance' && <MaintenanceTab resourceId={resource.id} />}
      {activeTab === 'dependencies' && <DependenciesTab resourceId={resource.id} />}
      {activeTab === 'services' && <ServicesTab resourceId={resource.id} />}
    </div>
  );
}

function DetailsTab({ resource }: { resource: Resource }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <div><span className="text-gray-500 text-sm">Type:</span> <span>{resource.type_name} ({resource.category})</span></div>
        <div><span className="text-gray-500 text-sm">Capacity:</span> <span>{resource.capacity} {resource.capacity > 1 ? 'concurrent users' : 'exclusive'}</span></div>
        <div><span className="text-gray-500 text-sm">Buffer:</span> <span>{resource.buffer_minutes} minutes between bookings</span></div>
        <div><span className="text-gray-500 text-sm">Hours:</span> <span>{resource.is_24_7 ? '24/7 (no restrictions)' : 'Per schedule'}</span></div>
        <div><span className="text-gray-500 text-sm">Display Order:</span> <span>{resource.display_order}</span></div>
      </div>
      <div className="space-y-3">
        <div><span className="text-gray-500 text-sm">Description:</span></div>
        <p className="text-sm">{resource.description || 'No description'}</p>
        {Object.keys(resource.custom_attributes || {}).length > 0 && (
          <div>
            <span className="text-gray-500 text-sm">Custom Attributes:</span>
            <pre className="text-xs bg-gray-50 p-2 rounded mt-1">{JSON.stringify(resource.custom_attributes, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleTab({ resourceId }: { resourceId: string }) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => { resourcesApi.getSchedules(resourceId).then(setSchedules).finally(() => setLoading(false)); }, [resourceId]);
  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Operating Hours</h3>
      {schedules.length === 0 ? <p className="text-gray-500 text-sm">No schedule defined (uses business hours or 24/7)</p> : (
        schedules.map((s: any) => (
          <div key={s.id} className="border rounded p-4 mb-3">
            <div className="flex justify-between mb-2">
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-gray-500">{s.effective_from} → {s.effective_to || 'Ongoing'}</span>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {dayNames.map((day, idx) => {
                const slots = (s.slots || []).filter((sl: any) => sl.day_of_week === idx);
                return (
                  <div key={idx} className="text-center">
                    <div className="font-medium">{day}</div>
                    {slots.length === 0 ? <div className="text-gray-300">Closed</div> :
                      slots.map((sl: any, i: number) => <div key={i} className="text-green-600">{sl.start_time.slice(0,5)}-{sl.end_time.slice(0,5)}</div>)}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CalendarTab({ resourceId }: { resourceId: string }) {
  const [calendar, setCalendar] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const end = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    resourcesApi.getResourceCalendar(resourceId, today, end).then(setCalendar).finally(() => setLoading(false));
  }, [resourceId]);

  if (loading) return <div>Loading...</div>;
  if (!calendar) return <div>Failed to load</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">This Week</h3>
      {calendar.bookings.length === 0 ? <p className="text-gray-500 text-sm">No bookings this week</p> : (
        <div className="space-y-2">
          {calendar.bookings.map((b: any) => (
            <div key={b.id} className="border rounded p-2 flex justify-between">
              <span>{b.serviceName || b.type} — {b.customerName || ''}</span>
              <span className="text-sm text-gray-500">{new Date(b.startTime).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      {calendar.blocks.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-sm mb-2">Blocked Dates</h4>
          {calendar.blocks.map((b: any) => (
            <div key={b.id} className="border border-red-200 bg-red-50 rounded p-2 text-sm">
              {b.date}: {b.reason || 'Blocked'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UtilizationTab({ resourceId }: { resourceId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = new Date().toISOString().split('T')[0];
    resourcesApi.getResourceUtilization(resourceId, start, end).then(setData).finally(() => setLoading(false));
  }, [resourceId]);

  if (loading) return <div>Loading...</div>;
  if (!data) return <div>No data</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Last 30 Days</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded p-4 text-center">
          <div className="text-2xl font-bold">{data.utilizationRate}%</div>
          <div className="text-sm text-gray-500">Utilization Rate</div>
        </div>
        <div className="border rounded p-4 text-center">
          <div className="text-2xl font-bold">{data.totalBookings}</div>
          <div className="text-sm text-gray-500">Total Bookings</div>
        </div>
        <div className="border rounded p-4 text-center">
          <div className="text-2xl font-bold">{Math.round(data.bookedMinutes / 60)}h</div>
          <div className="text-sm text-gray-500">Booked Hours</div>
        </div>
      </div>
      {data.peakHours.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-sm mb-2">Peak Hours</h4>
          <div className="flex gap-2">
            {data.peakHours.map((p: any) => (
              <span key={p.hour} className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                {p.hour}:00 ({p.count} bookings)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MaintenanceTab({ resourceId }: { resourceId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => { resourcesApi.getMaintenance(resourceId).then(setItems).finally(() => setLoading(false)); }, [resourceId]);
  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Maintenance Windows</h3>
      {items.length === 0 ? <p className="text-gray-500 text-sm">No maintenance scheduled</p> : (
        <div className="space-y-2">
          {items.map((m: any) => (
            <div key={m.id} className="border rounded p-3">
              <div className="flex justify-between">
                <span className="font-medium">{m.description || m.maintenance_type}</span>
                <Badge variant={m.maintenance_type === 'recurring' ? 'info' : 'warning'}>{m.maintenance_type}</Badge>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {m.maintenance_type === 'recurring' ? `Every ${dayNames[m.day_of_week]} ${m.start_time?.slice(0,5)}–${m.end_time?.slice(0,5)}` : `${m.specific_date} ${m.start_time?.slice(0,5) || ''}–${m.end_time?.slice(0,5) || ''}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DependenciesTab({ resourceId }: { resourceId: string }) {
  const [deps, setDeps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { resourcesApi.getDependencies(resourceId).then(setDeps).finally(() => setLoading(false)); }, [resourceId]);
  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Dependencies</h3>
      {deps.length === 0 ? <p className="text-gray-500 text-sm">No dependencies configured</p> : (
        <div className="space-y-2">
          {deps.map((d: any) => (
            <div key={d.id} className="border rounded p-3 flex justify-between">
              <span>{d.depends_on_name} ({d.type_name})</span>
              <span className="text-sm text-gray-500">
                Offset: {d.offset_minutes}min {d.duration_minutes ? `/ Duration: ${d.duration_minutes}min` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicesTab({ resourceId }: { resourceId: string }) {
  return (
    <div>
      <h3 className="font-medium mb-4">Linked Services</h3>
      <p className="text-gray-500 text-sm">Service-resource links are managed from the service detail page.</p>
    </div>
  );
}
