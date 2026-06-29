import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as reportsApi from '../api/reports';

const REPORT_CONFIG: Record<string, { title: string; fetcher: (params?: any) => Promise<any> }> = {
  revenue: { title: 'Revenue Report', fetcher: reportsApi.getRevenueReport },
  bookings: { title: 'Bookings Report', fetcher: reportsApi.getBookingsReport },
  memberships: { title: 'Memberships Report', fetcher: reportsApi.getMembershipsReport },
  staff: { title: 'Staff Report', fetcher: reportsApi.getStaffReport },
  customers: { title: 'Customers Report', fetcher: reportsApi.getCustomersReport },
  financial: { title: 'Financial Report', fetcher: reportsApi.getFinancialReport },
};

export function ReportView() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const businessId = localStorage.getItem('business_id') || '';

  // Extract report type from URL: /reports/revenue -> "revenue"
  const reportType = location.pathname.split('/reports/')[1] || '';
  const config = REPORT_CONFIG[reportType];

  useEffect(() => {
    if (!config) { setLoading(false); setError('Unknown report type.'); return; }
    setLoading(true);
    setError('');
    config.fetcher({ business_id: businessId })
      .then(setData)
      .catch(() => setError('Failed to load report data.'))
      .finally(() => setLoading(false));
  }, [reportType, businessId]);

  const handleExport = async () => {
    try {
      await reportsApi.exportReport(reportType, { business_id: businessId });
      alert('Export initiated');
    } catch { alert('Export failed'); }
  };

  if (!config) {
    return (
      <div style={styles.page}>
        <p>Unknown report type: {reportType}</p>
        <Button onClick={() => navigate('/reports')}>Back to Reports</Button>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/reports')}>← Back to Reports</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{config.title}</h1>
        <Button onClick={handleExport}>Export</Button>
      </div>

      {loading && <p style={styles.loading}>Loading report data...</p>}
      {error && <p style={styles.error}>{error}</p>}

      {data && !loading && (
        <div style={styles.card}>
          {typeof data === 'object' && !Array.isArray(data) ? (
            Object.entries(data).map(([key, val]) => (
              <div key={key} style={styles.field}>
                <span style={styles.label}>{key.replace(/_/g, ' ')}</span>
                <span style={styles.value}>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
              </div>
            ))
          ) : Array.isArray(data) ? (
            data.length === 0 ? <p style={styles.loading}>No data for this period.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr>
                    {Object.keys(data[0]).map((k) => (
                      <th key={k} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border)', textTransform: 'capitalize', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                        {k.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 50).map((row: any, i: number) => (
                    <tr key={i}>
                      {Object.values(row).map((v: any, j: number) => (
                        <td key={j} style={{ padding: '8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                          {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : <p>{String(data)}</p>}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', overflow: 'auto' },
  field: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--color-border)' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  value: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 500 as any },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  error: { fontSize: 'var(--font-size-sm)', color: 'var(--color-error, #e53e3e)' },
};
