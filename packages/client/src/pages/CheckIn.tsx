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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kiosk' | 'no-shows' | 'walk-ins'>('dashboard');

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

  const tabs = [
    { key: 'dashboard' as const, label: 'Dashboard' },
    { key: 'kiosk' as const, label: 'Kiosk' },
    { key: 'no-shows' as const, label: 'No-Shows' },
    { key: 'walk-ins' as const, label: 'Walk-In Report' },
  ];

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

      <div className="border-b mb-6">
        <nav className="flex gap-4">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 ${activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'dashboard' && (
        <>
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
        </>
      )}

      {activeTab === 'kiosk' && <KioskSection />}
      {activeTab === 'no-shows' && <NoShowsSection />}
      {activeTab === 'walk-ins' && <WalkInReportSection />}
    </div>
  );
}

function KioskSection() {
  const [kioskName, setKioskName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState<any>(null);

  const handleRegister = async () => {
    if (!kioskName) return;
    try {
      await checkInApi.registerKiosk({ name: kioskName, location_id: locationId || undefined });
      alert('Kiosk registered successfully');
      setKioskName(''); setLocationId('');
      loadStatus();
    } catch { alert('Kiosk registration failed'); }
  };

  const loadStatus = async () => {
    try { const data = await checkInApi.getKioskStatus(); setStatus(data); } catch {}
  };

  useEffect(() => { loadStatus(); }, []);

  return (
    <div>
      <h3 className="font-medium mb-4">Kiosk Management</h3>
      <div className="border rounded p-4 mb-4">
        <h4 className="text-sm font-medium mb-2">Register New Kiosk</h4>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Kiosk name" value={kioskName} onChange={(e) => setKioskName(e.target.value)} />
          <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Location ID (optional)" value={locationId} onChange={(e) => setLocationId(e.target.value)} />
          <Button size="sm" onClick={handleRegister}>Register</Button>
        </div>
      </div>
      {status && (
        <div className="border rounded p-4">
          <h4 className="text-sm font-medium mb-2">Kiosk Status</h4>
          {Array.isArray(status) ? status.map((k: any, i: number) => (
            <div key={i} className="flex justify-between items-center py-1 border-b last:border-b-0">
              <span className="text-sm">{k.name || k.id}</span>
              <Badge variant={k.online ? 'success' : 'error'}>{k.online ? 'Online' : 'Offline'}</Badge>
            </div>
          )) : (
            <div className="flex justify-between items-center">
              <span className="text-sm">{status.name || 'Kiosk'}</span>
              <Badge variant={status.online ? 'success' : 'error'}>{status.online ? 'Online' : 'Offline'}</Badge>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoShowsSection() {
  const [customerId, setCustomerId] = useState('');
  const [noShows, setNoShows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = async () => {
    if (!customerId) return;
    try {
      const data = await checkInApi.getCustomerNoShows(customerId);
      setNoShows(data); setLoaded(true);
    } catch { alert('Could not load no-show history'); }
  };

  return (
    <div>
      <h3 className="font-medium mb-4">Customer No-Show History</h3>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Customer ID" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        <Button size="sm" onClick={handleLoad}>Load History</Button>
      </div>
      {loaded && (
        <div className="space-y-2">
          {noShows.length === 0 ? <p className="text-gray-500">No no-shows for this customer</p> : noShows.map((ns: any, i: number) => (
            <div key={i} className="border rounded p-2 flex justify-between items-center">
              <div>
                <span className="text-sm font-medium">{ns.service_name || 'Booking'}</span>
                <span className="text-xs text-gray-500 ml-2">{new Date(ns.date || ns.created_at).toLocaleDateString()}</span>
              </div>
              <Badge variant={ns.waived ? 'neutral' : 'error'}>{ns.waived ? 'Waived' : 'No-Show'}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WalkInReportSection() {
  const [report, setReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkInApi.getWalkInReport().then(setReport).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <h3 className="font-medium mb-4">Walk-In Report</h3>
      {report.length === 0 ? <p className="text-gray-500">No walk-in data</p> : (
        <div className="space-y-2">
          {report.map((entry: any, i: number) => (
            <div key={i} className="border rounded p-2 flex justify-between items-center">
              <div>
                <span className="text-sm font-medium">{entry.customer_name || 'Walk-in'}</span>
                <span className="text-xs text-gray-500 ml-2">{entry.service_name}</span>
              </div>
              <span className="text-xs text-gray-400">{new Date(entry.checked_in_at || entry.date).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
