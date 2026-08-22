import { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useContextManager } from '../../../context/ContextManager';
import { DashboardShell } from './DashboardShell';
import { KpiCard } from './KpiCard';
import { SortableTileGrid } from './SortableTileGrid';
import { GroupedSortableTileGrid } from './GroupedSortableTileGrid';
import { getVisibleModules } from './moduleRegistry';
import { Persona } from '@daystream/shared';
import { apiClient } from '../../../api/client';
import { useBusinessSettings } from '../../../context/BusinessSettingsContext';

interface DetailModal {
  title: string;
  rows: any[];
  columns: { key: string; label: string; render?: (val: any) => string }[];
}

/**
 * Resolves persona from auth context and renders the appropriate dashboard.
 */
export function PersonaDashboard() {
  const { user, featureFlags } = useAuth();
  const { activeContext, persona: rawPersona } = useContextManager();
  const [tenantKpis, setTenantKpis] = useState<KpiData[] | null>(null);
  const [systemKpis, setSystemKpis] = useState<KpiData[] | null>(null);
  const [businessKpis, setBusinessKpis] = useState<KpiData[] | null>(null);
  const [detail, setDetail] = useState<DetailModal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Customers never have an active context to switch (out of scope for the Context Switcher),
  // so they always follow their raw JWT persona. Every other persona follows the active context
  // level instead — e.g. a system admin who has switched into a business context sees the
  // business dashboard here, matching the business-level modules AppLayout's sidebar shows them.
  const persona: Persona | null = user ? (rawPersona === 'customer' ? 'customer' : activeContext.contextLevel) : null;

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

  useEffect(() => {
    if (persona === 'tenant') {
      Promise.all([
        apiClient.get('/v1/admin/reports/tenant-customers').then(r => r.data.data).catch(() => null),
        apiClient.get('/v1/admin/reports/tenant-revenue').then(r => r.data.data).catch(() => null),
        apiClient.get('/v1/admin/my-billing').then(r => r.data.data).catch(() => null),
      ]).then(([biz, rev, billing]) => {
        setTenantKpis([
          { icon: '🏪', label: 'Active Businesses', value: biz?.active_businesses ?? '—' },
          { icon: '💰', label: 'Revenue YTD', value: rev?.total_revenue_ytd != null ? `${(rev.total_revenue_ytd / 100).toFixed(2)}` : '—' },
          { icon: '💵', label: 'Revenue MTD', value: rev?.month_revenue != null ? `${(rev.month_revenue / 100).toFixed(2)}` : '—' },
          { icon: '📈', label: 'Still Expected MTD', value: rev?.expected_remaining_mtd != null ? `${(rev.expected_remaining_mtd / 100).toFixed(2)}` : '—' },
        ]);
      });
    }
    if (persona === 'system') {
      apiClient.get('/v1/admin/reports/system-kpis').then(r => {
        const d = r.data.data;
        setSystemKpis([
          { icon: '💰', label: 'Platform Revenue YTD', value: d?.platform_revenue_ytd != null ? `${(d.platform_revenue_ytd / 100).toFixed(2)}` : '0.00',
            prior: `${((d?.platform_revenue_ytd_prior || 0) / 100).toFixed(2)}`,
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=ytd', 'Platform Revenue YTD by Tenant', [{ key: 'name', label: 'Tenant' }, { key: 'revenue', label: 'Revenue YTD', render: (v: number) => (v / 100).toFixed(2) }]) },
          { icon: '💵', label: 'Platform Revenue MTD', value: d?.platform_revenue_mtd != null ? `${(d.platform_revenue_mtd / 100).toFixed(2)}` : '0.00',
            prior: `${((d?.platform_revenue_mtd_prior || 0) / 100).toFixed(2)}`,
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=mtd', 'Platform Revenue MTD by Tenant', [{ key: 'name', label: 'Tenant' }, { key: 'revenue', label: 'Revenue MTD', render: (v: number) => (v / 100).toFixed(2) }]) },
          { icon: '📈', label: 'Still Expected MTD', value: d?.expected_remaining_mtd != null ? `${(d.expected_remaining_mtd / 100).toFixed(2)}` : '0.00',
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=expected_mtd', 'Still Expected This Month', [{ key: 'name', label: 'Tenant' }, { key: 'billing_amount', label: 'Amount Due', render: (v: number) => (v / 100).toFixed(2) }, { key: 'next_billing_date', label: 'Due Date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' }]) },
          { icon: '🏢', label: 'Active Tenants', value: d?.total_tenants ?? '—' },
          { icon: '🏪', label: 'Active Businesses', value: d?.total_businesses ?? '—' },
          { icon: '✅', label: 'System Health', value: 'OK' },
        ]);
      }).catch(() => {});
    }
    if (persona === 'business') {
      const isOwnerOrManager = ['business_owner', 'Business Owner', 'manager', 'Manager', 'business_manager', 'tenant_owner'].includes(user?.role || '');
      const endpoint = isOwnerOrManager ? '/v1/reports/business-kpis' : '/v1/reports/staff-kpis';
      const bizId = localStorage.getItem('business_id') || '';
      apiClient.get(endpoint, { headers: { 'x-business-id': bizId } }).then(r => {
        const d = r.data.data;
        if (isOwnerOrManager) {
          const ytd = d?.revenue_ytd != null ? (d.revenue_ytd / 100).toFixed(2) : '0.00';
          const mtd = d?.revenue_mtd != null ? (d.revenue_mtd / 100).toFixed(2) : '0.00';
          setBusinessKpis([
            { icon: '💰', label: 'Revenue — YTD / MTD', value: `$${ytd} / $${mtd}` },
            { icon: '📅', label: 'Bookings — Week / Today', value: `${d?.week_bookings ?? '0'} / ${d?.todays_bookings ?? '0'}` },
            { icon: '👥', label: 'Customers — Active / New MTD', value: `${d?.active_customers ?? '0'} / ${d?.new_customers_month ?? '0'}` },
          ]);
        } else {
          setBusinessKpis([
            { icon: '📅', label: 'My Bookings Today', value: d?.my_bookings_today ?? '0' },
            { icon: '📆', label: 'My Bookings This Week', value: d?.my_bookings_week ?? '0' },
            { icon: '👥', label: 'My Customers', value: d?.my_customers ?? '0' },
            { icon: '⏰', label: 'Next Appointment', value: d?.next_appointment || '—' },
          ]);
        }
      }).catch(() => {});
    }
  }, [persona]);

  if (!user) return null;

  const permissions = getPermissionsFromRole(user.role);
  const baseModules = getVisibleModules(persona!, permissions, featureFlags, activeContext.contextLevel);

  const { settings: businessSettings } = useBusinessSettings();
  const modules = baseModules.map((mod) => {
    if (mod.id === 'schedule') {
      const status = businessSettings.schedulingMode === 'schedule' ? 'Enabled' : 'Disabled';
      return { ...mod, titleKey: `Schedule (${status})`, descriptionKey: `Staff scheduling — ${status}` };
    }
    return mod;
  });

  const kpis = (persona === 'system' ? systemKpis : persona === 'tenant' ? tenantKpis : businessKpis) || getKpisForPersona(persona!);
  const tiles = modules;

  return (
    <>
      <DashboardShell
        kpis={
          <>
            {kpis.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </>
        }
        tiles={persona === 'business' ? <GroupedSortableTileGrid modules={tiles} /> : <SortableTileGrid modules={tiles} />}
      />

      {/* Detail Modal */}
      {detail && (
        <div style={modalStyles.overlay}>
          <div style={modalStyles.modal}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>{detail.title}</h3>
              <button style={modalStyles.closeBtn} onClick={() => setDetail(null)}>&times;</button>
            </div>
            {detailLoading ? (
              <p style={modalStyles.muted}>Loading...</p>
            ) : detail.rows.length === 0 ? (
              <p style={modalStyles.muted}>No records found.</p>
            ) : (
              <div style={modalStyles.table}>
                <div style={modalStyles.tableHeader}>
                  {detail.columns.map((col) => <span key={col.key} style={modalStyles.col}>{col.label}</span>)}
                </div>
                {detail.rows.map((row, i) => (
                  <div key={i} style={modalStyles.tableRow}>
                    {detail.columns.map((col) => <span key={col.key} style={modalStyles.cell}>{col.render ? col.render(row[col.key]) : (row[col.key] || '—')}</span>)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function getPermissionsFromRole(role: string): string[] {
  // Simplified — in production this comes from JWT/auth context
  const r = role.toLowerCase().replace(/\s+/g, '_');
  switch (r) {
    case 'system_admin': case 'system_support': case 'super_admin': return ['*:*'];
    case 'tenant_owner': return ['*:*'];
    case 'tenant_manager': return ['reports:read', 'settings:*'];
    case 'business_owner': return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
    case 'business_manager': case 'manager': return ['services:read', 'bookings:*', 'staff:read', 'reports:read', 'customers:*', 'schedule:*'];
    case 'business_staff': case 'staff': case 'reception': case 'therapist': case 'trainer': return ['bookings:read', 'bookings:update', 'customers:read', 'schedule:read'];
    case 'customer': return ['bookings:read', 'bookings:create'];
    default: return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
  }
}

interface KpiData {
  icon: string;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: { direction: 'up' | 'down' | 'flat'; percentage: number; period: string };
  prior?: string;
  onClick?: () => void;
}

function getKpisForPersona(persona: Persona): KpiData[] {
  switch (persona) {
    case 'system':
      return [
        { icon: '🏢', label: 'Total Tenants', value: '—' },
        { icon: '🏪', label: 'Total Businesses', value: '—' },
        { icon: '💰', label: 'Platform Revenue', value: '—' },
        { icon: '✅', label: 'System Health', value: 'OK' },
      ];
    case 'tenant':
      return [
        { icon: '🏪', label: 'Active Businesses', value: '—' },
        { icon: '💰', label: 'Revenue YTD', value: '—' },
        { icon: '📈', label: 'New This Month', value: '—' },
        { icon: '📅', label: 'Next Billing', value: '—' },
      ];
    case 'business':
      return [
        { icon: '💰', label: 'Revenue MTD', value: '—' },
        { icon: '📅', label: "Today's Bookings", value: '—' },
        { icon: '👥', label: 'Active Customers', value: '—' },
        { icon: '🆕', label: 'New Customers', value: '—' },
      ];
    case 'customer':
      return [
        { icon: '📅', label: 'Upcoming Bookings', value: '—' },
        { icon: '🏷️', label: 'Membership', value: '—' },
        { icon: '⭐', label: 'Loyalty Points', value: '—' },
        { icon: '🕐', label: 'Last Visit', value: '—' },
      ];
    default:
      return [];
  }
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '700px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  muted: { color: 'var(--color-text-secondary)', fontSize: '14px' },
  table: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  tableHeader: { display: 'flex', padding: '10px 14px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, gap: '8px' },
  tableRow: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text)', gap: '8px' },
  col: { flex: 1, minWidth: 0 },
  cell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
