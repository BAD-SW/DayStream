import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Card } from '../design-system/components/data/Card';
import { ListRow, ListRows, ListRowTitle, ListRowMeta, ListEmpty } from '../design-system/components/data/ListRow';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { TabBar } from '../design-system/components/navigation/TabBar';
import * as checkInApi from '../api/check-in';
import { useNavigate } from 'react-router-dom';
import { getOutstandingForms } from '../api/forms';
import { useCheckInFormsPrompt } from '../components/forms/useCheckInFormsPrompt';
import type { OutstandingForms } from '../api/forms';
import './CheckIn.css';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  upcoming: 'neutral', awaiting: 'warning', checked_in: 'success',
  in_progress: 'info', completed: 'neutral', no_show: 'error',
};

export function CheckIn() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kiosk' | 'no-shows' | 'walk-ins'>('dashboard');

  // Forms each booking's customer still needs: a small badge, never a block on checking in.
  const [outstanding, setOutstanding] = useState<Record<string, OutstandingForms>>({});
  const navigate = useNavigate();

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await checkInApi.getDashboard();
      setDashboard(data);
      const businessId = localStorage.getItem('business_id') || '';
      const ids: string[] = [...data.upcoming, ...data.awaiting, ...data.checked_in, ...data.in_progress].map((b: any) => b.id);
      if (businessId && ids.length > 0) {
        getOutstandingForms(businessId, ids).then(setOutstanding).catch(() => setOutstanding({}));
      } else {
        setOutstanding({});
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 15000); return () => clearInterval(i); }, [fetchDashboard]);

  const businessIdForForms = localStorage.getItem('business_id') || '';
  const { requestCheckIn, prompt: formsPrompt } = useCheckInFormsPrompt(businessIdForForms);

  const doCheckIn = async (bookingId: string) => {
    try {
      await checkInApi.checkInReception(bookingId);
      fetchDashboard();
    } catch (err: any) { alert(err.response?.data?.error || 'Check-in failed'); }
  };
  // Forms the customer still has to complete are shown first; staff can always check in anyway.
  const handleCheckIn = (b: { id: string; customer_id?: string | null }) =>
    requestCheckIn(b, () => doCheckIn(b.id));

  const tabs = [
    { key: 'dashboard' as const, label: 'Dashboard' },
    { key: 'kiosk' as const, label: 'Kiosk' },
    { key: 'no-shows' as const, label: 'No-Shows' },
    { key: 'walk-ins' as const, label: 'Walk-In Report' },
  ];

  if (loading) return <ListEmpty>Loading...</ListEmpty>;

  const allBookings = dashboard ? [
    ...dashboard.upcoming.map((b: any) => ({ ...b, category: 'upcoming' })),
    ...dashboard.awaiting.map((b: any) => ({ ...b, category: 'awaiting' })),
    ...dashboard.checked_in.map((b: any) => ({ ...b, category: 'checked_in' })),
    ...dashboard.in_progress.map((b: any) => ({ ...b, category: 'in_progress' })),
    ...dashboard.completed.map((b: any) => ({ ...b, category: 'completed' })),
    ...dashboard.no_show.map((b: any) => ({ ...b, category: 'no_show' })),
  ] : [];

  const formsNeededCount = Object.values(outstanding).filter((o) => o.count > 0).length;

  const filtered = search
    ? allBookings.filter((b: any) => b.customer_name?.toLowerCase().includes(search.toLowerCase()))
    : allBookings;

  return (
    <div>
      <PageHeader
        title="Check-In"
        actions={
          <div className="ci-counts">
            <Badge variant="success">{`${dashboard?.checked_in.length || 0} checked in`}</Badge>
            <Badge variant="warning">{`${dashboard?.awaiting.length || 0} awaiting`}</Badge>
            <Badge variant="error">{`${dashboard?.no_show.length || 0} no-show`}</Badge>
            {formsNeededCount > 0 && <Badge variant="warning">{`${formsNeededCount} need forms`}</Badge>}
          </div>
        }
      />
      <TabBar aria-label="Check-in sections" tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'dashboard' && (
        <>
          <div className="ci-toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by customer name..." />
          </div>
          <ListRows>
            {filtered.map((b: any, i: number) => (
              <ListRow key={`${b.id}-${i}`} actions={<>
                {(outstanding[b.id]?.count ?? 0) > 0 && (
                  <>
                    <Badge variant="warning">{`Forms needed: ${outstanding[b.id].forms.map((f) => f.name).join(', ')}`}</Badge>
                    {b.customer_id && (
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/customers/${b.customer_id}?tab=forms`)}>Open forms</Button>
                    )}
                  </>
                )}
                <Badge variant={STATUS_VARIANTS[b.category] || 'neutral'}>{b.category.replace('_', ' ')}</Badge>
                {(b.category === 'upcoming' || b.category === 'awaiting') && (
                  <Button size="sm" onClick={() => handleCheckIn(b)}>Check In</Button>
                )}
              </>}>
                <ListRowTitle>{b.customer_name}</ListRowTitle>
                <ListRowMeta>{b.service_name}</ListRowMeta>
                <ListRowMeta>{new Date(b.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</ListRowMeta>
              </ListRow>
            ))}
            {filtered.length === 0 && <ListEmpty>No bookings for today</ListEmpty>}
          </ListRows>
        </>
      )}

      {formsPrompt}
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

  const kiosks: any[] = status ? (Array.isArray(status) ? status : [status]) : [];

  return (
    <div className="ci-stack">
      <h3 className="ci-section-title">Kiosk Management</h3>
      <Card variant="outlined" padding="lg" title="Register New Kiosk">
        <div className="ci-toolbar ci-toolbar--flush">
          <input className="ci-input" aria-label="Kiosk name" placeholder="Kiosk name" value={kioskName} onChange={(e) => setKioskName(e.target.value)} />
          <input className="ci-input" aria-label="Location ID" placeholder="Location ID (optional)" value={locationId} onChange={(e) => setLocationId(e.target.value)} />
          <Button size="sm" onClick={handleRegister}>Register</Button>
        </div>
      </Card>
      {status && (
        <Card variant="outlined" padding="lg" title="Kiosk Status">
          {kiosks.map((k: any, i: number) => (
            <div key={i} className="ci-kiosk">
              <span>{k.name || k.id || 'Kiosk'}</span>
              <Badge variant={k.online ? 'success' : 'error'}>{k.online ? 'Online' : 'Offline'}</Badge>
            </div>
          ))}
        </Card>
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
      <h3 className="ci-section-title">Customer No-Show History</h3>
      <div className="ci-toolbar">
        <input className="ci-input" aria-label="Customer ID" placeholder="Customer ID" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        <Button size="sm" onClick={handleLoad}>Load History</Button>
      </div>
      {loaded && (
        <ListRows>
          {noShows.length === 0 ? <ListEmpty>No no-shows for this customer</ListEmpty> : noShows.map((ns: any, i: number) => (
            <ListRow key={i} actions={<Badge variant={ns.waived ? 'neutral' : 'error'}>{ns.waived ? 'Waived' : 'No-Show'}</Badge>}>
              <ListRowTitle>{ns.service_name || 'Booking'}</ListRowTitle>
              <ListRowMeta>{new Date(ns.date || ns.created_at).toLocaleDateString()}</ListRowMeta>
            </ListRow>
          ))}
        </ListRows>
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

  if (loading) return <ListEmpty>Loading...</ListEmpty>;
  return (
    <div>
      <h3 className="ci-section-title">Walk-In Report</h3>
      {report.length === 0 ? <ListEmpty>No walk-in data</ListEmpty> : (
        <ListRows>
          {report.map((entry: any, i: number) => (
            <ListRow key={i} actions={<ListRowMeta>{new Date(entry.checked_in_at || entry.date).toLocaleString()}</ListRowMeta>}>
              <ListRowTitle>{entry.customer_name || 'Walk-in'}</ListRowTitle>
              <ListRowMeta>{entry.service_name}</ListRowMeta>
            </ListRow>
          ))}
        </ListRows>
      )}
    </div>
  );
}
