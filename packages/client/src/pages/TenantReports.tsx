import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

interface ReportData {
  revenue: any;
  customers: any;
  bookings: any;
  memberships: any;
}

interface DetailModal {
  title: string;
  rows: any[];
  columns: { key: string; label: string; render?: (val: any) => string }[];
}

export function TenantReports() {
  const [data, setData] = useState<ReportData>({ revenue: null, customers: null, bookings: null, memberships: null });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailModal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.get('/v1/admin/reports/tenant-revenue').then(r => r.data.data).catch(() => null),
      apiClient.get('/v1/admin/reports/tenant-customers').then(r => r.data.data).catch(() => null),
    ]).then(([revenue, customers]) => {
      setData({ revenue, customers, bookings: null, memberships: null });
    }).finally(() => setLoading(false));
  }, []);

  async function openDetail(endpoint: string, title: string, columns: DetailModal['columns']) {
    setDetailLoading(true);
    setDetail({ title, rows: [], columns });
    try {
      const res = await apiClient.get(endpoint);
      setDetail({ title, rows: res.data.data || [], columns });
    } catch {
      setDetail({ title, rows: [], columns });
    } finally { setDetailLoading(false); }
  }

  if (loading) return <p style={styles.muted}>Loading reports...</p>;

  const rev = data.revenue || {};
  const cust = data.customers || {};

  return (
    <div>
      <h2 style={styles.heading}>Reports</h2>
      <p style={styles.subtext}>Analytics and insights across your businesses.</p>

      {/* Revenue Row */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📊 Revenue</h3>
        <div style={styles.statsRow}>
          <StatCard label="Revenue YTD" value={formatCurrency(rev.total_revenue_ytd || 0)} prior={formatCurrency(rev.total_revenue_ytd_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=ytd', 'Revenue YTD by Business', [{ key: 'name', label: 'Business' }, { key: 'revenue', label: 'Revenue YTD', render: (v: number) => formatCurrency(v) }])} />
          <StatCard label="Revenue MTD" value={formatCurrency(rev.month_revenue || 0)} prior={formatCurrency(rev.month_revenue_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=month', 'Revenue MTD by Business', [{ key: 'name', label: 'Business' }, { key: 'revenue', label: 'Revenue MTD', render: (v: number) => formatCurrency(v) }])} />
          <StatCard label="Still Expected MTD" value={formatCurrency(rev.expected_remaining_mtd || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=expected_mtd', 'Still Expected This Month', [{ key: 'name', label: 'Business' }, { key: 'billing_amount', label: 'Amount Due', render: (v: number) => formatCurrency(v) }, { key: 'next_billing_date', label: 'Due Date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' }])} />
          <StatCard label="Active Businesses" value={String(rev.active_businesses || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=businesses', 'Active Businesses', [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created', render: (v: string) => new Date(v).toLocaleDateString() }])} />
        </div>
      </div>

      {/* Businesses Row */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>👥 Businesses</h3>
        <div style={styles.statsRow}>
          <StatCard label="Active Businesses" value={String(cust.active_businesses || 0)} prior={String(cust.active_businesses_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=active', 'Active Businesses', [{ key: 'name', label: 'Business' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created', render: (v: string) => new Date(v).toLocaleDateString() }])} />
          <StatCard label="New This Month" value={String(cust.new_this_month || 0)} prior={String(cust.new_this_month_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=new', 'New Businesses This Month', [{ key: 'name', label: 'Business' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created', render: (v: string) => new Date(v).toLocaleDateString() }])} />
          <StatCard label="Churned This Month" value={String(cust.churned_this_month || 0)} prior={String(cust.churned_this_month_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=churned', 'Churned Businesses This Month', [{ key: 'name', label: 'Business' }, { key: 'status', label: 'Status' }, { key: 'updated_at', label: 'Churned', render: (v: string) => new Date(v).toLocaleDateString() }])} />
        </div>
      </div>


      {/* Detail Modal */}
      {detail && (
        <div style={styles.overlay} onClick={() => setDetail(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{detail.title}</h3>
              <button style={styles.closeBtn} onClick={() => setDetail(null)}>&times;</button>
            </div>
            {detailLoading ? (
              <p style={styles.muted}>Loading...</p>
            ) : detail.rows.length === 0 ? (
              <p style={styles.muted}>No records found.</p>
            ) : (
              <div style={styles.detailTable}>
                <div style={styles.detailHeader}>
                  {detail.columns.map((col) => (
                    <span key={col.key} style={styles.detailCol}>{col.label}</span>
                  ))}
                </div>
                {detail.rows.map((row, i) => (
                  <div key={i} style={styles.detailRow}>
                    {detail.columns.map((col) => (
                      <span key={col.key} style={styles.detailCell}>
                        {col.render ? col.render(row[col.key]) : (row[col.key] || '—')}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Stat Card Component
// ============================================================

function StatCard({ label, value, prior, onClick }: { label: string; value: string; prior?: string; onClick?: () => void }) {
  return (
    <div style={{ ...styles.statCard, ...(onClick ? { cursor: 'pointer' } : {}) }} onClick={onClick}>
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
      {prior !== undefined && (
        <div style={styles.priorBlock}>
          <span style={styles.priorLabel}>Same period last year:</span>
          <span style={styles.priorValue}>{prior}</span>
        </div>
      )}
      {onClick && <span style={styles.statClickHint}>Click for details</span>}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  muted: { color: 'var(--color-text-secondary)', fontSize: '14px' },
  section: { marginBottom: '28px' },
  sectionTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 12px 0' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' },
  statCard: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '4px', transition: 'border-color 0.15s' },
  statValue: { fontSize: '24px', fontWeight: 700, color: 'var(--color-text)' },
  statLabel: { fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.5px', textAlign: 'center' as const },
  statClickHint: { fontSize: '10px', color: 'var(--color-primary)', marginTop: '4px' },
  priorBlock: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', width: '100%', textAlign: 'center' as const },
  priorLabel: { fontSize: '10px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '2px', textTransform: 'uppercase' as const, letterSpacing: '0.3px' },
  priorValue: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' },
  // Modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-elevated, var(--color-surface))', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '700px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailTable: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  detailHeader: { display: 'flex', padding: '10px 14px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, gap: '8px' },
  detailRow: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text)', gap: '8px' },
  detailCol: { flex: 1, minWidth: 0 },
  detailCell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
