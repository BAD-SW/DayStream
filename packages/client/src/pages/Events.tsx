import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral', published: 'success', cancelled: 'error', completed: 'info',
};

type ViewTab = 'events' | 'recurring' | 'series' | 'types';

export function Events() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<ViewTab>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await eventsApi.getEvents({
        search: search || undefined, status: statusFilter || undefined, page, limit: 20,
      });
      setEvents(result.data); setTotal(result.meta?.total || 0);
    } catch {} finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const viewTabs: { key: ViewTab; label: string }[] = [
    { key: 'events', label: 'Events' }, { key: 'recurring', label: 'Recurring' },
    { key: 'series', label: 'Series' }, { key: 'types', label: 'Types' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button onClick={() => navigate('/events/new')}>Create Event</Button>
      </div>

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {viewTabs.map((t) => (
            <button key={t.key} onClick={() => setActiveView(t.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${activeView === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeView === 'events' && (
        <>
          <div className="flex gap-4 mb-4">
            <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search events..." />
            <select className="border rounded px-3 py-2 text-sm" value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {loading ? <div>Loading...</div> : events.length === 0 ? <p className="text-gray-500">No events found</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((ev) => (
                <div key={ev.id} className="border rounded-lg p-4 cursor-pointer hover:border-blue-300 transition"
                  onClick={() => navigate(`/events/${ev.id}`)}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium">{ev.title}</h3>
                    <Badge variant={STATUS_VARIANTS[ev.status] || 'neutral'}>{ev.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{ev.event_type_name}</p>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>{new Date(ev.start_time).toLocaleDateString()} — {new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>{ev.registrations_count} / {ev.capacity} registered</div>
                    {ev.location_name && <div>{ev.location_name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {total > 20 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="px-3 py-2 text-sm">Page {page} of {Math.ceil(total / 20)}</span>
              <Button variant="ghost" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {activeView === 'recurring' && <RecurringSection />}
      {activeView === 'series' && <SeriesSection />}
      {activeView === 'types' && <TypesSection />}
    </div>
  );
}

function RecurringSection() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { eventsApi.getRecurringTemplates().then(setTemplates).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleGenerate = async (id: string) => {
    await eventsApi.generateRecurringInstances(id);
    alert('Instances generated');
  };
  const handleCancelRecurring = async (id: string) => {
    if (!confirm('Cancel this recurring event?')) return;
    const updated = await eventsApi.cancelRecurringEvent(id);
    setTemplates(templates.map((t) => t.id === id ? { ...t, status: updated.status || 'cancelled' } : t));
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recurring template?')) return;
    await eventsApi.deleteRecurringEvent(id);
    setTemplates(templates.filter((t) => t.id !== id));
  };

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Recurring Event Templates</h3>
      {templates.length === 0 ? <p className="text-gray-500">No recurring templates</p> : (
        <div className="space-y-2">
          {templates.map((t: any) => (
            <div key={t.id} className="border rounded p-3 flex justify-between items-center">
              <div>
                <span className="font-medium">{t.title || t.name || t.id}</span>
                <span className="text-sm text-gray-500 ml-3">{t.recurrence_pattern || t.frequency}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerate(t.id)}>Generate</Button>
                <Button size="sm" variant="ghost" onClick={() => handleCancelRecurring(t.id)}>Cancel</Button>
                <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesSection() {
  const [series, setSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => { eventsApi.getSeries().then(setSeries).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this series?')) return;
    await eventsApi.deleteSeries(id);
    setSeries(series.filter((s) => s.id !== id));
  };
  const handleSave = async (id: string) => {
    const updated = await eventsApi.updateSeries(id, { name: editName });
    setSeries(series.map((s) => s.id === id ? { ...s, ...updated } : s));
    setEditing(null);
  };

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Event Series</h3>
      {series.length === 0 ? <p className="text-gray-500">No series defined</p> : (
        <div className="space-y-2">
          {series.map((s: any) => (
            <div key={s.id} className="border rounded p-3 flex justify-between items-center">
              {editing === s.id ? (
                <div className="flex gap-2 items-center flex-1">
                  <input className="border rounded px-2 py-1 text-sm flex-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <Button size="sm" onClick={() => handleSave(s.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              ) : (
                <>
                  <span className="font-medium">{s.name}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(s.id); setEditName(s.name); }}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(s.id)}>Delete</Button>
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

function TypesSection() {
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => { eventsApi.getEventTypes().then(setTypes).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleCreate = async () => {
    if (!newName) return;
    const created = await eventsApi.createEventType({ name: newName });
    setTypes([...types, created]); setNewName('');
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this event type?')) return;
    await eventsApi.deleteEventType(id);
    setTypes(types.filter((t) => t.id !== id));
  };
  const handleSave = async (id: string) => {
    const updated = await eventsApi.updateEventType(id, { name: editName });
    setTypes(types.map((t) => t.id === id ? { ...t, ...updated } : t));
    setEditing(null);
  };

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Event Types</h3>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="New event type name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" onClick={handleCreate}>Add Type</Button>
      </div>
      {types.length === 0 ? <p className="text-gray-500">No event types</p> : (
        <div className="space-y-2">
          {types.map((t: any) => (
            <div key={t.id} className="border rounded p-3 flex justify-between items-center">
              {editing === t.id ? (
                <div className="flex gap-2 items-center flex-1">
                  <input className="border rounded px-2 py-1 text-sm flex-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <Button size="sm" onClick={() => handleSave(t.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              ) : (
                <>
                  <span className="font-medium">{t.name}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(t.id); setEditName(t.name); }}>Edit</Button>
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
