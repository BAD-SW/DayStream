import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard } from '../components/unsaved/LeaveGuard';
import * as eventsApi from '../api/events';
import type { Event } from '../api/events';
import './Events.css';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral', published: 'success', cancelled: 'error', completed: 'info',
};

type ViewTab = 'events' | 'recurring' | 'series' | 'types';

// Event types and series names wait for one Save changes (David, 2026-11-01, as in Settings).
export function Events() {
  return (
    <DraftSectionsProvider>
      <EventsPage />
    </DraftSectionsProvider>
  );
}

function EventsPage() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<ViewTab>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  useEffect(() => { setSaveResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);
  const saveChanges = async () => {
    const { failed } = await saveAll();
    setSaveResult(failed.length ? { ok: false, text: `Not saved: ${failed.map((f) => `${f.label} (${f.error})`).join('; ')}` } : { ok: true, text: 'All changes saved.' });
  };

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await eventsApi.getEvents({
        search: search || undefined, status: statusFilter || undefined, page, limit: 20,
        deleted: showDeleted ? 'true' : undefined,
      });
      setEvents(result.data); setTotal(result.meta?.total || 0);
    } catch {} finally { setLoading(false); }
  }, [search, statusFilter, page, showDeleted]);

  const restore = async (id: string) => {
    await eventsApi.restoreEvent(id);
    await fetchEvents();
  };

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
      <LeaveGuard when={dirty} />
      <StickyPageTop>
        <PageHeader title="Events" actions={<>
          {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>You have unsaved changes.</span>
            : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
          {(dirty || activeView === 'series' || activeView === 'types') && <Button onClick={saveChanges} loading={saving} disabled={!dirty}>Save changes</Button>}
          <Button variant={dirty ? 'outline' : 'primary'} onClick={() => navigate('/events/new')}>Create Event</Button>
        </>} />
        <TabBar aria-label="Event sections" tabs={viewTabs.map((t) => ({ ...t, changed: dirtySections.some((d) => d.tab === t.key) }))} active={activeView} onChange={setActiveView} />
      </StickyPageTop>

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
            <label className="ev-check">
              <input type="checkbox" checked={showDeleted} onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }} />
              Show deleted events
            </label>
          </div>
          {loading ? <ListEmpty>Loading...</ListEmpty> : events.length === 0 ? <ListEmpty>{showDeleted ? 'No deleted events' : 'No events found'}</ListEmpty> : (
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
                  {ev.deleted_at && (
                    <div className="ev-card__restore">
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); restore(ev.id); }}>Restore</Button>
                    </div>
                  )}
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
      {/* Kept mounted so their unsaved edits survive switching tabs. */}
      <div hidden={activeView !== 'series'}><DraftTab tab="series"><SeriesSection /></DraftTab></div>
      <div hidden={activeView !== 'types'}><DraftTab tab="types"><TypesSection /></DraftTab></div>
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

type Named = { id?: string; name: string };

/** A list of names edited in place: renames, additions and deletions wait for Save changes. */
function NameRows({ list }: { list: ReturnType<typeof useDraftList<Named>> }) {
  return (
    <ListRows>
      {list.rows.map((r) => r.deleted ? (
        <ListRow key={r.key} actions={<Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button>}>
          <ListRowTitle><s>{r.item.name}</s></ListRowTitle>
          <RowTag>Deleted when you save</RowTag>
        </ListRow>
      ) : (
        <ListRow key={r.key} actions={<Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>Delete</Button>}>
          <input className="ev-input" aria-label="Name" value={r.item.name} style={fieldMark(!!r.isNew || list.changed(r, (x) => x.name))}
            onChange={(e) => list.edit(r.key, { name: e.target.value })} />
          {r.isNew && <RowTag>New</RowTag>}
        </ListRow>
      ))}
    </ListRows>
  );
}

function SeriesSection() {
  const [loading, setLoading] = useState(true);
  const list = useDraftList<Named>('event-series', 'Series', {
    update: (x) => eventsApi.updateSeries(x.id!, { name: x.name.trim() }),
    remove: (x) => eventsApi.deleteSeries(x.id!),
  });

  useEffect(() => { eventsApi.getSeries().then(list.load).catch(() => {}).finally(() => setLoading(false)); }, [list.load]);

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">Event Series<UnsavedTag dirty={list.dirty} /></h3>
      {list.rows.length === 0 ? <ListEmpty>No series defined</ListEmpty> : <NameRows list={list} />}
    </div>
  );
}

function TypesSection() {
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const list = useDraftList<Named>('event-types', 'Types', {
    create: (x) => eventsApi.createEventType({ name: x.name.trim() }),
    update: (x) => eventsApi.updateEventType(x.id!, { name: x.name.trim() }),
    remove: (x) => eventsApi.deleteEventType(x.id!),
  });

  useEffect(() => { eventsApi.getEventTypes().then(list.load).catch(() => {}).finally(() => setLoading(false)); }, [list.load]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    list.add({ name: newName.trim() }); setNewName('');
  };

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">Event Types<UnsavedTag dirty={list.dirty} /></h3>
      <div className="ev-add-row">
        <input className="ev-input" aria-label="New event type name" placeholder="New event type name" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
        <Button size="sm" onClick={handleAdd}>Add Type</Button>
      </div>
      {list.rows.length === 0 ? <ListEmpty>No event types</ListEmpty> : <NameRows list={list} />}
    </div>
  );
}
