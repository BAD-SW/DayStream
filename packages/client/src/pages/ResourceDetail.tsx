import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as resourcesApi from '../api/resources';
import type { Resource } from '../api/resources';

type Tab = 'details' | 'schedule' | 'services' | 'maintenance' | 'dependencies' | 'calendar' | 'utilization' | 'service-requirements';

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resource, setResource] = useState<Resource | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const businessId = localStorage.getItem('business_id') || '';
    resourcesApi.getResource(id, businessId).then(setResource).catch(() => navigate('/business?tab=resources')).finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!resource) return <div className="p-6">Resource not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'services', label: 'Services' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'dependencies', label: 'Dependencies' },
    { key: 'service-requirements', label: 'Service Requirements' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'utilization', label: 'Utilization' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" onClick={() => navigate('/business?tab=resources')}>← Back</Button>
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
      {activeTab === 'service-requirements' && <ServiceRequirementsTab />}
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
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockForm, setBlockForm] = useState({ block_date: '', start_time: '', end_time: '', reason: '' });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    Promise.all([
      resourcesApi.getSchedules(resourceId),
      resourcesApi.getScheduleBlocks(resourceId),
    ]).then(([s, b]) => { setSchedules(s); setBlocks(b); }).finally(() => setLoading(false));
  }, [resourceId]);

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm('Delete this schedule?')) return;
    await resourcesApi.deleteSchedule(resourceId, scheduleId);
    setSchedules(schedules.filter((s: any) => s.id !== scheduleId));
  };

  const handleCreateBlock = async () => {
    const created = await resourcesApi.createScheduleBlock(resourceId, blockForm);
    setBlocks([...blocks, created]);
    setShowBlockForm(false);
    setBlockForm({ block_date: '', start_time: '', end_time: '', reason: '' });
  };

  const handleDeleteBlock = async (blockId: string) => {
    if (!confirm('Delete this block?')) return;
    await resourcesApi.deleteScheduleBlock(resourceId, blockId);
    setBlocks(blocks.filter((b: any) => b.id !== blockId));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Operating Hours</h3>
      {schedules.length === 0 ? <p className="text-gray-500 text-sm">No schedule defined (uses business hours or 24/7)</p> : (
        schedules.map((s: any) => (
          <div key={s.id} className="border rounded p-4 mb-3">
            <div className="flex justify-between mb-2">
              <span className="font-medium">{s.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{s.effective_from} → {s.effective_to || 'Ongoing'}</span>
                <Button variant="destructive" onClick={() => handleDeleteSchedule(s.id)}>Delete</Button>
              </div>
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

      {/* Schedule Blocks */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-medium">Schedule Blocks</h3>
          <Button onClick={() => setShowBlockForm(true)}>Add Block</Button>
        </div>

        {showBlockForm && (
          <div className="border rounded p-4 mb-4 bg-gray-50">
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Date</label>
                <input type="date" className="border rounded px-3 py-2 text-sm w-full"
                  value={blockForm.block_date}
                  onChange={(e) => setBlockForm({ ...blockForm, block_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Reason</label>
                <input type="text" className="border rounded px-3 py-2 text-sm w-full" placeholder="Optional reason"
                  value={blockForm.reason}
                  onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Time</label>
                <input type="time" className="border rounded px-3 py-2 text-sm w-full"
                  value={blockForm.start_time}
                  onChange={(e) => setBlockForm({ ...blockForm, start_time: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Time</label>
                <input type="time" className="border rounded px-3 py-2 text-sm w-full"
                  value={blockForm.end_time}
                  onChange={(e) => setBlockForm({ ...blockForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateBlock}>Save Block</Button>
              <Button variant="ghost" onClick={() => setShowBlockForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {blocks.length === 0 ? (
          <p className="text-gray-500 text-sm">No schedule blocks</p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b: any) => (
              <div key={b.id} className="border rounded p-3 flex justify-between items-center">
                <div>
                  <span className="font-medium">{b.block_date}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {b.start_time?.slice(0,5)}–{b.end_time?.slice(0,5)}
                  </span>
                  {b.reason && <span className="text-sm text-gray-500 ml-2">({b.reason})</span>}
                </div>
                <Button variant="destructive" onClick={() => handleDeleteBlock(b.id)}>Delete</Button>
              </div>
            ))}
          </div>
        )}
      </div>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ description: '', start_time: '', end_time: '' });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => { resourcesApi.getMaintenance(resourceId).then(setItems).finally(() => setLoading(false)); }, [resourceId]);

  const handleEdit = (m: any) => {
    setEditingId(m.id);
    setEditForm({ description: m.description || '', start_time: m.start_time || '', end_time: m.end_time || '' });
  };

  const handleSaveEdit = async (maintenanceId: string) => {
    const updated = await resourcesApi.updateMaintenance(resourceId, maintenanceId, editForm);
    setItems(items.map((m: any) => m.id === maintenanceId ? { ...m, ...updated } : m));
    setEditingId(null);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Maintenance Windows</h3>
      {items.length === 0 ? <p className="text-gray-500 text-sm">No maintenance scheduled</p> : (
        <div className="space-y-2">
          {items.map((m: any) => (
            <div key={m.id} className="border rounded p-3">
              {editingId === m.id ? (
                <div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Description</label>
                      <input type="text" className="border rounded px-3 py-2 text-sm w-full"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Start Time</label>
                      <input type="time" className="border rounded px-3 py-2 text-sm w-full"
                        value={editForm.start_time}
                        onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">End Time</label>
                      <input type="time" className="border rounded px-3 py-2 text-sm w-full"
                        value={editForm.end_time}
                        onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleSaveEdit(m.id)}>Save</Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="font-medium">{m.description || m.maintenance_type}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.maintenance_type === 'recurring' ? 'info' : 'warning'}>{m.maintenance_type}</Badge>
                      <Button variant="ghost" onClick={() => handleEdit(m)}>Edit</Button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {m.maintenance_type === 'recurring' ? `Every ${dayNames[m.day_of_week]} ${m.start_time?.slice(0,5)}–${m.end_time?.slice(0,5)}` : `${m.specific_date} ${m.start_time?.slice(0,5) || ''}–${m.end_time?.slice(0,5) || ''}`}
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

function DependenciesTab({ resourceId }: { resourceId: string }) {
  const [deps, setDeps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { resourcesApi.getDependencies(resourceId).then(setDeps).finally(() => setLoading(false)); }, [resourceId]);

  const handleDelete = async (depId: string) => {
    if (!confirm('Remove this dependency?')) return;
    await resourcesApi.deleteDependency(resourceId, depId);
    setDeps(deps.filter((d: any) => d.id !== depId));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h3 className="font-medium mb-4">Dependencies</h3>
      {deps.length === 0 ? <p className="text-gray-500 text-sm">No dependencies configured</p> : (
        <div className="space-y-2">
          {deps.map((d: any) => (
            <div key={d.id} className="border rounded p-3 flex justify-between items-center">
              <div>
                <span>{d.depends_on_name} ({d.type_name})</span>
                <span className="text-sm text-gray-500 ml-2">
                  Offset: {d.offset_minutes}min {d.duration_minutes ? `/ Duration: ${d.duration_minutes}min` : ''}
                </span>
              </div>
              <Button variant="destructive" onClick={() => handleDelete(d.id)}>Delete</Button>
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

function ServiceRequirementsTab() {
  const [requirements, setRequirements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ service_id: '', resource_type_id: '', quantity: '1', is_optional: false });

  useEffect(() => {
    resourcesApi.getServiceRequirements().then(setRequirements).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    const created = await resourcesApi.createServiceRequirement({
      service_id: form.service_id,
      resource_type_id: form.resource_type_id,
      quantity: Number(form.quantity),
      is_optional: form.is_optional,
    });
    setRequirements([...requirements, created]);
    setShowForm(false);
    setForm({ service_id: '', resource_type_id: '', quantity: '1', is_optional: false });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const updated = await resourcesApi.updateServiceRequirement(editingId, {
      quantity: Number(form.quantity),
      is_optional: form.is_optional,
    });
    setRequirements(requirements.map((r: any) => r.id === editingId ? { ...r, ...updated } : r));
    setEditingId(null);
    setForm({ service_id: '', resource_type_id: '', quantity: '1', is_optional: false });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this service requirement?')) return;
    await resourcesApi.deleteServiceRequirement(id);
    setRequirements(requirements.filter((r: any) => r.id !== id));
  };

  const startEdit = (req: any) => {
    setEditingId(req.id);
    setForm({ service_id: req.service_id, resource_type_id: req.resource_type_id, quantity: String(req.quantity), is_optional: req.is_optional });
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-medium">Service Requirements</h3>
        <Button onClick={() => { setShowForm(true); setEditingId(null); }}>Add Requirement</Button>
      </div>

      {(showForm || editingId) && (
        <div className="border rounded p-4 mb-4 bg-gray-50">
          <div className="grid grid-cols-2 gap-4 mb-3">
            {!editingId && (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Service ID</label>
                  <input type="text" className="border rounded px-3 py-2 text-sm w-full" placeholder="Service ID"
                    value={form.service_id}
                    onChange={(e) => setForm({ ...form, service_id: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Resource Type ID</label>
                  <input type="text" className="border rounded px-3 py-2 text-sm w-full" placeholder="Resource Type ID"
                    value={form.resource_type_id}
                    onChange={(e) => setForm({ ...form, resource_type_id: e.target.value })} />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Quantity</label>
              <input type="number" className="border rounded px-3 py-2 text-sm w-full" min="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_optional}
                  onChange={(e) => setForm({ ...form, is_optional: e.target.checked })} />
                Optional
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={editingId ? handleUpdate : handleCreate}>{editingId ? 'Update' : 'Create'}</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {requirements.length === 0 ? (
        <p className="text-gray-500 text-sm">No service requirements configured</p>
      ) : (
        <div className="space-y-2">
          {requirements.map((r: any) => (
            <div key={r.id} className="border rounded p-3 flex justify-between items-center">
              <div>
                <span className="font-medium">{r.service_name || r.service_id}</span>
                <span className="text-sm text-gray-500 ml-2">→ {r.resource_type_name || r.resource_type_id}</span>
                <span className="text-sm text-gray-500 ml-2">× {r.quantity}</span>
                {r.is_optional && <Badge variant="neutral">Optional</Badge>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => startEdit(r)}>Edit</Button>
                <Button variant="destructive" onClick={() => handleDelete(r.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
