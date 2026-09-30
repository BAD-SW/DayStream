import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';
import './Events.css';

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
    <div>
      <PageHeader title="Events" actions={<Button onClick={() => navigate('/events/new')}>Create Event</Button>} />
      <TabBar aria-label="Event sections" tabs={viewTabs} active={activeView} onChange={setActiveView} />

      {activeView === 'events' && (
        <>
          <div className="ev-filters">
            <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search events..." />
            <select className="ev-select" aria-label="Status" value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {loading ? <ListEmpty>Loading...</ListEmpty> : events.length === 0 ? <ListEmpty>No events found</ListEmpty> : (
            <div className="ev-grid">
              {events.map((ev) => (
                <div key={ev.id} className="ev-card" role="button" tabIndex={0}
                  onClick={() => navigate(`/events/${ev.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/events/${ev.id}`); }}>
                  <div className="ev-card__head">
                    <h3 className="ev-card__title">{ev.title}</h3>
                    <Badge variant={STATUS_VARIANTS[ev.status] || 'neutral'}>{ev.status}</Badge>
                  </div>
                  <p className="ev-card__type">{ev.event_type_name}</p>
                  <div className="ev-card__facts">
                    <div>{new Date(ev.start_time).toLocaleDateString()} — {new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>{ev.registrations_count} / {ev.capacity} registered</div>
                    {ev.location_name && <div>{ev.location_name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {total > 20 && (
            <div className="ev-pager">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="ev-pager__info">Page {page} of {Math.ceil(total / 20)}</span>
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

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="ev-section-title">Recurring Event Templates</h3>
      {templates.length === 0 ? <ListEmpty>No recurring templates</ListEmpty> : (
        <ListRows>
          {templates.map((t: any) => (
            <ListRow key={t.id} actions={<>
              <Button size="sm" onClick={() => handleGenerate(t.id)}>Generate</Button>
              <Button size="sm" variant="ghost" onClick={() => handleCancelRecurring(t.id)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)}>Delete</Button>
            </>}>
              <ListRowTitle>{t.title || t.name || t.id}</ListRowTitle>
              <ListRowMeta>{t.recurrence_pattern || t.frequency}</ListRowMeta>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}

/** A name that can be edited in place (used by Series and Types). */
function EditableNameRow({ name, onSave, onDelete }: { name: string; onSave: (name: string) => Promise<void>; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  if (editing) {
    return (
      <ListRow actions={<>
        <Button size="sm" onClick={async () => { await onSave(value); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </>}>
        <input className="ev-input" aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
      </ListRow>
    );
  }
  return (
    <ListRow actions={<>
      <Button size="sm" variant="ghost" onClick={() => { setValue(name); setEditing(true); }}>Edit</Button>
      <Button size="sm" variant="destructive" onClick={onDelete}>Delete</Button>
    </>}>
      <ListRowTitle>{name}</ListRowTitle>
    </ListRow>
  );
}

function SeriesSection() {
  const [series, setSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { eventsApi.getSeries().then(setSeries).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this series?')) return;
    await eventsApi.deleteSeries(id);
    setSeries(series.filter((s) => s.id !== id));
  };
  const handleSave = async (id: string, name: string) => {
    const updated = await eventsApi.updateSeries(id, { name });
    setSeries(series.map((s) => s.id === id ? { ...s, ...updated } : s));
  };

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="ev-section-title">Event Series</h3>
      {series.length === 0 ? <ListEmpty>No series defined</ListEmpty> : (
        <ListRows>
          {series.map((s: any) => (
            <EditableNameRow key={s.id} name={s.name} onSave={(name) => handleSave(s.id, name)} onDelete={() => handleDelete(s.id)} />
          ))}
        </ListRows>
      )}
    </div>
  );
}

function TypesSection() {
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
  const handleSave = async (id: string, name: string) => {
    const updated = await eventsApi.updateEventType(id, { name });
    setTypes(types.map((t) => t.id === id ? { ...t, ...updated } : t));
  };

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="ev-section-title">Event Types</h3>
      <div className="ev-add-row">
        <input className="ev-input" aria-label="New event type name" placeholder="New event type name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" onClick={handleCreate}>Add Type</Button>
      </div>
      {types.length === 0 ? <ListEmpty>No event types</ListEmpty> : (
        <ListRows>
          {types.map((t: any) => (
            <EditableNameRow key={t.id} name={t.name} onSave={(name) => handleSave(t.id, name)} onDelete={() => handleDelete(t.id)} />
          ))}
        </ListRows>
      )}
    </div>
  );
}
