import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as reportsApi from '../api/reports';

export function Reports() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    reportsApi.getDashboard().then(setDashboard).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const reportPages = [
    { path: '/reports/revenue', label: 'Revenue', icon: '💰' },
    { path: '/reports/bookings', label: 'Bookings', icon: '📅' },
    { path: '/reports/memberships', label: 'Memberships', icon: '🎫' },
    { path: '/reports/staff', label: 'Staff', icon: '👥' },
    { path: '/reports/resources', label: 'Resources', icon: '🏢' },
    { path: '/reports/customers', label: 'Customers', icon: '🧑' },
    { path: '/reports/marketing', label: 'Marketing', icon: '📧' },
    { path: '/reports/financial', label: 'Financial', icon: '📊' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Reports & Analytics</h1>
        <Button variant="ghost" onClick={() => navigate('/reports/scheduled')}>Scheduled Reports</Button>
      </div>

      {/* KPI Cards */}
      {loading ? <div>Loading...</div> : dashboard?.widgets && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {dashboard.widgets.slice(0, 4).map((w: any) => (
            <div key={w.id} className="border rounded-lg p-4">
              <div className="text-sm text-gray-500">{w.title}</div>
              <div className="text-2xl font-bold mt-1">
                {w.data?.length > 0 ? w.data[w.data.length - 1]?.metric_value ?? '—' : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Report Navigation */}
      <h2 className="text-lg font-medium mb-4">Reports</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {reportPages.map((r) => (
          <div key={r.path}
            className="border rounded-lg p-4 cursor-pointer hover:border-blue-300 transition text-center"
            onClick={() => navigate(r.path)}>
            <div className="text-2xl mb-2">{r.icon}</div>
            <div className="font-medium">{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
