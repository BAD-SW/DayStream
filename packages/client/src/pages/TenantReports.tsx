import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';
import { formatDate } from '../utils/format';

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
  const { t } = useTranslation('tenantOps');
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

  if (loading) return <p style={styles.muted}>{t('reports.loading')}</p>;

  const rev = data.revenue || {};
  const cust = data.customers || {};

  // Stored business statuses are shown through a key, never printed raw.
  const statusText = (v: string) => t(`reports.status.${v}`, { defaultValue: v });
  const dateText = (v: string) => formatDate(v);
  const businessCol = { key: 'name', label: t('reports.col.business') };
  const statusCol = { key: 'status', label: t('reports.col.status'), render: statusText };
  const createdCol = { key: 'created_at', label: t('reports.col.created'), render: dateText };

  return (
    <div>
      <h2 style={styles.heading}>{t('reports.title')}</h2>
      <p style={styles.subtext}>{t('reports.subtitle')}</p>

      {/* Revenue Row */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📊 {t('reports.revenue.section')}</h3>
        <div style={styles.statsRow}>
          <StatCard label={t('reports.revenue.ytd')} value={formatCurrency(rev.total_revenue_ytd || 0)} prior={formatCurrency(rev.total_revenue_ytd_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=ytd', t('reports.revenue.ytdDetailTitle'), [businessCol, { key: 'revenue', label: t('reports.revenue.ytd'), render: (v: number) => formatCurrency(v) }])} />
          <StatCard label={t('reports.revenue.mtd')} value={formatCurrency(rev.month_revenue || 0)} prior={formatCurrency(rev.month_revenue_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=month', t('reports.revenue.mtdDetailTitle'), [businessCol, { key: 'revenue', label: t('reports.revenue.mtd'), render: (v: number) => formatCurrency(v) }])} />
          <StatCard label={t('reports.revenue.expected')} value={formatCurrency(rev.expected_remaining_mtd || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=expected_mtd', t('reports.revenue.expectedDetailTitle'), [businessCol, { key: 'billing_amount', label: t('reports.col.amountDue'), render: (v: number) => formatCurrency(v) }, { key: 'next_billing_date', label: t('reports.col.dueDate'), render: (v: string) => v ? dateText(v) : '—' }])} />
          <StatCard label={t('reports.revenue.activeBusinesses')} value={String(rev.active_businesses || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-revenue/detail?type=businesses', t('reports.revenue.activeBusinesses'), [{ key: 'name', label: t('reports.col.name') }, statusCol, createdCol])} />
        </div>
      </div>

      {/* Businesses Row */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>👥 {t('reports.businesses.section')}</h3>
        <div style={styles.statsRow}>
          <StatCard label={t('reports.revenue.activeBusinesses')} value={String(cust.active_businesses || 0)} prior={String(cust.active_businesses_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=active', t('reports.revenue.activeBusinesses'), [businessCol, statusCol, createdCol])} />
          <StatCard label={t('reports.businesses.newThisMonth')} value={String(cust.new_this_month || 0)} prior={String(cust.new_this_month_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=new', t('reports.businesses.newDetailTitle'), [businessCol, statusCol, createdCol])} />
          <StatCard label={t('reports.businesses.churnedThisMonth')} value={String(cust.churned_this_month || 0)} prior={String(cust.churned_this_month_prior || 0)}
            onClick={() => openDetail('/v1/admin/reports/tenant-customers/detail?type=churned', t('reports.businesses.churnedDetailTitle'), [businessCol, statusCol, { key: 'updated_at', label: t('reports.col.churned'), render: dateText }])} />
        </div>
      </div>


      {/* Detail Modal */}
      {detail && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{detail.title}</h3>
              <button style={styles.closeBtn} onClick={() => setDetail(null)} aria-label={t('common:modal.close')}>×</button>
            </div>
            {detailLoading ? (
              <p style={styles.muted}>{t('common:loading')}</p>
            ) : detail.rows.length === 0 ? (
              <p style={styles.muted}>{t('reports.noRecords')}</p>
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
  const { t } = useTranslation('tenantOps');
  return (
    <div style={{ ...styles.statCard, ...(onClick ? { cursor: 'pointer' } : {}) }} onClick={onClick}>
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
      {prior !== undefined && (
        <div style={styles.priorBlock}>
          <span style={styles.priorLabel}>{t('reports.samePeriodLastYear')}</span>
          <span style={styles.priorValue}>{prior}</span>
        </div>
      )}
      {onClick && <span style={styles.statClickHint}>{t('reports.clickForDetails')}</span>}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', marginBottom: '24px' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  section: { marginBottom: '28px' },
  sectionTitle: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 12px 0' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' },
  statCard: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '4px', transition: 'border-color 0.15s' },
  statValue: { fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-text)' },
  statLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.5px', textAlign: 'center' as const },
  statClickHint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', marginTop: '4px' },
  priorBlock: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', width: '100%', textAlign: 'center' as const },
  priorLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '2px', textTransform: 'uppercase' as const, letterSpacing: '0.3px' },
  priorValue: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-secondary)' },
  // Modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '700px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailTable: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  detailHeader: { display: 'flex', padding: '10px 14px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, gap: '8px' },
  detailRow: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', gap: '8px' },
  detailCol: { flex: 1, minWidth: 0 },
  detailCell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
