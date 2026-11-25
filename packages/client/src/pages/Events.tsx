import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
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
import { formatDate, formatTime } from '../utils/format';
import './Events.css';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('events');
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
    setSaveResult(failed.length ? { ok: false, text: t('list.notSaved', { details: failed.map((f) => `${f.label} (${f.error})`).join('; ') }) } : { ok: true, text: t('list.allSaved') });
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
    { key: 'events', label: t('list.title') }, { key: 'recurring', label: t('list.tab.recurring') },
    { key: 'series', label: t('list.tab.series') }, { key: 'types', label: t('list.tab.types') },
  ];

  return (
    <div>
      <LeaveGuard when={dirty} />
      <StickyPageTop>
        <PageHeader title={t('list.title')} actions={<>
          {dirty && !(saveResult && !saveResult.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>{t('list.unsaved')}</span>
            : saveResult && <span role={saveResult.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: saveResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{saveResult.text}</span>}
          {(dirty || activeView === 'series' || activeView === 'types') && <Button onClick={saveChanges} loading={saving} disabled={!dirty}>{t('list.saveChanges')}</Button>}
          <Button variant={dirty ? 'outline' : 'primary'} onClick={() => navigate('/events/new')}>{t('list.create')}</Button>
        </>} />
        <TabBar aria-label={t('list.sections')} tabs={viewTabs.map((tab) => ({ ...tab, changed: dirtySections.some((d) => d.tab === tab.key) }))} active={activeView} onChange={setActiveView} />
      </StickyPageTop>

      {activeView === 'events' && (
        <>
          <div className="ev-filters">
            <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('list.search')} />
            <select className="ev-select" aria-label={t('list.status')} value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">{t('list.allStatuses')}</option>
              <option value="draft">{t('list.statusOption.draft')}</option>
              <option value="published">{t('list.statusOption.published')}</option>
              <option value="completed">{t('list.statusOption.completed')}</option>
              <option value="cancelled">{t('list.statusOption.cancelled')}</option>
            </select>
            <label className="ev-check">
              <input type="checkbox" checked={showDeleted} onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }} />
              {t('list.showDeleted')}
            </label>
          </div>
          {loading ? <ListEmpty>{t('common:loading')}</ListEmpty> : events.length === 0 ? <ListEmpty>{showDeleted ? t('list.noDeleted') : t('list.noEvents')}</ListEmpty> : (
            <div className="ev-grid">
              {events.map((ev) => (
                <div key={ev.id} className="ev-card" role="button" tabIndex={0}
                  onClick={() => navigate(`/events/${ev.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/events/${ev.id}`); }}>
                  <div className="ev-card__head">
                    <h3 className="ev-card__title">{ev.title}</h3>
                    <Badge variant={STATUS_VARIANTS[ev.status] || 'neutral'}>{t(`list.status.${ev.status}`, { defaultValue: ev.status })}</Badge>
                  </div>
                  <p className="ev-card__type">{ev.event_type_name}</p>
                  <div className="ev-card__facts">
                    <div>{formatDate(ev.start_time)} — {formatTime(ev.start_time, undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>{t('list.registeredCount', { count: Number(ev.registrations_count), capacity: ev.capacity })}</div>
                    {ev.location_name && <div>{ev.location_name}</div>}
                  </div>
                  {ev.deleted_at && (
                    <div className="ev-card__restore">
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); restore(ev.id); }}>{t('list.restore')}</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {total > 20 && (
            <div className="ev-pager">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('list.previous')}</Button>
              <span className="ev-pager__info">{t('list.pageOf', { page, pages: Math.ceil(total / 20) })}</span>
              <Button variant="ghost" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>{t('list.next')}</Button>
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
  const { t } = useTranslation('events');
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { eventsApi.getRecurringTemplates().then(setTemplates).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleGenerate = async (id: string) => {
    await eventsApi.generateRecurringInstances(id);
    void showMessage({ message: t('list.instancesGenerated'), tone: 'success' });
  };
  const handleCancelRecurring = async (id: string) => {
    if (!(await askConfirm({ message: t('list.cancelRecurringConfirm'), confirmLabel: t('common:action.yes'), destructive: true }))) return;
    const updated = await eventsApi.cancelRecurringEvent(id);
    setTemplates(templates.map((tpl) => tpl.id === id ? { ...tpl, status: updated.status || 'cancelled' } : tpl));
  };
  const handleDelete = async (id: string) => {
    if (!(await askConfirm({ message: t('list.deleteRecurringConfirm'), confirmLabel: t('common:action.delete'), destructive: true }))) return;
    await eventsApi.deleteRecurringEvent(id);
    setTemplates(templates.filter((tpl) => tpl.id !== id));
  };

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  return (
    <div>
      <h3 className="ev-section-title">{t('list.recurringTemplates')}</h3>
      {templates.length === 0 ? <ListEmpty>{t('list.noRecurring')}</ListEmpty> : (
        <ListRows>
          {templates.map((tpl: any) => (
            <ListRow key={tpl.id} actions={<>
              <Button size="sm" onClick={() => handleGenerate(tpl.id)}>{t('list.generate')}</Button>
              <Button size="sm" variant="ghost" onClick={() => handleCancelRecurring(tpl.id)}>{t('common:cancel')}</Button>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(tpl.id)}>{t('common:delete')}</Button>
            </>}>
              <ListRowTitle>{tpl.title || tpl.name || tpl.id}</ListRowTitle>
              <ListRowMeta>{tpl.recurrence_pattern || tpl.frequency}</ListRowMeta>
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
  const { t } = useTranslation('events');
  return (
    <ListRows>
      {list.rows.map((r) => r.deleted ? (
        <ListRow key={r.key} actions={<Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>{t('list.undo')}</Button>}>
          <ListRowTitle><s>{r.item.name}</s></ListRowTitle>
          <RowTag>{t('list.deletedWhenSave')}</RowTag>
        </ListRow>
      ) : (
        <ListRow key={r.key} actions={<Button size="sm" variant="destructive" onClick={() => list.remove(r.key)}>{t('common:delete')}</Button>}>
          <input className="ev-input" aria-label={t('list.name')} value={r.item.name} style={fieldMark(!!r.isNew || list.changed(r, (x) => x.name))}
            onChange={(e) => list.edit(r.key, { name: e.target.value })} />
          {r.isNew && <RowTag>{t('list.new')}</RowTag>}
        </ListRow>
      ))}
    </ListRows>
  );
}

function SeriesSection() {
  const { t } = useTranslation('events');
  const [loading, setLoading] = useState(true);
  const list = useDraftList<Named>('event-series', t('list.tab.series'), {
    update: (x) => eventsApi.updateSeries(x.id!, { name: x.name.trim() }),
    remove: (x) => eventsApi.deleteSeries(x.id!),
  });

  useEffect(() => { eventsApi.getSeries().then(list.load).catch(() => {}).finally(() => setLoading(false)); }, [list.load]);

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">{t('list.eventSeries')}<UnsavedTag dirty={list.dirty} /></h3>
      {list.rows.length === 0 ? <ListEmpty>{t('list.noSeries')}</ListEmpty> : <NameRows list={list} />}
    </div>
  );
}

function TypesSection() {
  const { t } = useTranslation('events');
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const list = useDraftList<Named>('event-types', t('list.tab.types'), {
    create: (x) => eventsApi.createEventType({ name: x.name.trim() }),
    update: (x) => eventsApi.updateEventType(x.id!, { name: x.name.trim() }),
    remove: (x) => eventsApi.deleteEventType(x.id!),
  });

  useEffect(() => { eventsApi.getEventTypes().then(list.load).catch(() => {}).finally(() => setLoading(false)); }, [list.load]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    list.add({ name: newName.trim() }); setNewName('');
  };

  if (loading) return <ListEmpty>{t('common:loading')}</ListEmpty>;
  return (
    <div style={draftBox(list.dirty)}>
      <h3 className="ev-section-title">{t('list.eventTypes')}<UnsavedTag dirty={list.dirty} /></h3>
      <div className="ev-add-row">
        <input className="ev-input" aria-label={t('list.newTypeName')} placeholder={t('list.newTypeName')} value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
        <Button size="sm" onClick={handleAdd}>{t('list.addType')}</Button>
      </div>
      {list.rows.length === 0 ? <ListEmpty>{t('list.noTypes')}</ListEmpty> : <NameRows list={list} />}
    </div>
  );
}
