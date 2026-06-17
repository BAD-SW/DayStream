import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import * as checkInApi from '../api/check-in';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  upcoming: 'neutral', awaiting: 'warning', checked_in: 'success',
  in_progress: 'info', completed: 'neutral', no_show: 'error',
};

export function CheckIn() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await checkInApi.getDashboard();
      setDashboard(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 15000); return () => clearInterval(i); }, [fetchDashboard]);

  const handleCheckIn = async (bookingId: string) => {
    try {
      await checkInApi.checkInReception(bookingId);
      fetchDashboard();
    } catch (err: any) { alert(err.response?.data?.error || 'Check-in failed'); }
  };

  if (loading) return <div className="p-6">Loading...</div>;

  const allBookings = dashboard ? [
    ...dashboard.upcoming.map((b: any) => ({ ...b, category: 'upcoming' })),
    ...dashboard.awaiting.map((b: any) => ({ ...b, category: 'awaiting' })),
    ...dashboard.checked_in.map((b: any) => ({ ...b, category: 'checked_in' })),
    ...dashboard.in_progress.map((b: any) => ({ ...b, category: 'in_progress' })),
    ...dashboard.completed.map((b: any) => ({ ...b, category: 'completed' })),
    ...dashboard.no_show.map((b: any) => ({ ...b, category: 'no_show' })),
  ] : [];

  const filtered = search
    ? allBookings.filter((b: any) => b.customer_name?.toLowerCase().includes(search.toLowerCase()))
    : allBookings;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Check-In</h1>
        <div className="flex gap-2 text-sm">
          <span className="bg-green-100 text-green-700 px-2 py-1 rounded">{dashboard?.checked_in.length || 0} checked in</span>
          <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded">{dashboard?.awaiting.length || 0} awaiting</span>
          <span className="bg-red-100 text-red-700 px-2 py-1 rounded">{dashboard?.no_show.length || 0} no-show</span>
        </div>
      </div>

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by customer name..." />
      </div>

      <div className="space-y-2">
        {filtered.map((b: any) => (
          <div key={b.id} className="border rounded p-3 flex items-center justify-between">
            <div>
              <span className="font-medium">{b.customer_name}</span>
              <span className="text-sm text-gray-500 ml-3">{b.service_name}</span>
              <span className="text-xs text-gray-400 ml-2">{new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANTS[b.category] || 'neutral'}>{b.category.replace('_', ' ')}</Badge>
              {(b.category === 'upcoming' || b.category === 'awaiting') && (
                <Button size="sm" onClick={() => handleCheckIn(b.id)}>Check In</Button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-500 text-center py-4">No bookings for today</p>}
      </div>
    </div>
  );
}
