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

export function Events() {
  const navigate = useNavigate();
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button onClick={() => navigate('/events/new')}>Create Event</Button>
      </div>
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
    </div>
  );
}
