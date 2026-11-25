import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { formatDate, formatNumber } from '../../../utils/format';

/** Cents shown as an amount with two decimals, in the shown language's number format. */
const money = (cents: number): string => formatNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DetailModal {
  /** Key in the nav translation file. */
  title: string;
  rows: any[];
  columns: { key: string; /** Key in the nav translation file. */ label: string; render?: (val: any) => string }[];
}

/**
 * Resolves persona from auth context and renders the appropriate dashboard.
 */
export function PersonaDashboard() {
  const { t } = useTranslation('nav');
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
          { icon: '🏪', label: 'dashboard.kpi.active_businesses', value: biz?.active_businesses ?? '—' },
          { icon: '💰', label: 'dashboard.kpi.revenue_ytd', value: rev?.total_revenue_ytd != null ? `${money(rev.total_revenue_ytd)}` : '—' },
          { icon: '💵', label: 'dashboard.kpi.revenue_mtd', value: rev?.month_revenue != null ? `${money(rev.month_revenue)}` : '—' },
          { icon: '📈', label: 'dashboard.kpi.still_expected_mtd', value: rev?.expected_remaining_mtd != null ? `${money(rev.expected_remaining_mtd)}` : '—' },
        ]);
      });
    }
    if (persona === 'system') {
      apiClient.get('/v1/admin/reports/system-kpis').then(r => {
        const d = r.data.data;
        setSystemKpis([
          { icon: '💰', label: 'dashboard.kpi.platform_revenue_ytd', value: d?.platform_revenue_ytd != null ? `${money(d.platform_revenue_ytd)}` : '0.00',
            prior: `${money(d?.platform_revenue_ytd_prior || 0)}`,
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=ytd', 'dashboard.detail.platform_revenue_ytd', [{ key: 'name', label: 'dashboard.detail.tenant' }, { key: 'revenue', label: 'dashboard.kpi.revenue_ytd', render: (v: number) => money(v) }]) },
          { icon: '💵', label: 'dashboard.kpi.platform_revenue_mtd', value: d?.platform_revenue_mtd != null ? `${money(d.platform_revenue_mtd)}` : '0.00',
            prior: `${money(d?.platform_revenue_mtd_prior || 0)}`,
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=mtd', 'dashboard.detail.platform_revenue_mtd', [{ key: 'name', label: 'dashboard.detail.tenant' }, { key: 'revenue', label: 'dashboard.kpi.revenue_mtd', render: (v: number) => money(v) }]) },
          { icon: '📈', label: 'dashboard.kpi.still_expected_mtd', value: d?.expected_remaining_mtd != null ? `${money(d.expected_remaining_mtd)}` : '0.00',
            onClick: () => openDetail('/v1/admin/reports/system-revenue/detail?type=expected_mtd', 'dashboard.detail.still_expected', [{ key: 'name', label: 'dashboard.detail.tenant' }, { key: 'billing_amount', label: 'dashboard.detail.amount_due', render: (v: number) => money(v) }, { key: 'next_billing_date', label: 'dashboard.detail.due_date', render: (v: string) => v ? formatDate(v) : '—' }]) },
          { icon: '🏢', label: 'dashboard.kpi.active_tenants', value: d?.total_tenants ?? '—' },
          { icon: '🏪', label: 'dashboard.kpi.active_businesses', value: d?.total_businesses ?? '—' },
          { icon: '✅', label: 'dashboard.kpi.system_health', value: '', valueKey: 'dashboard.kpi.system_health_ok' },
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
          const ytd = d?.revenue_ytd != null ? money(d.revenue_ytd) : '0.00';
          const mtd = d?.revenue_mtd != null ? money(d.revenue_mtd) : '0.00';
          setBusinessKpis([
            { icon: '💰', label: 'dashboard.kpi.revenue_ytd_mtd', value: `$${ytd} / $${mtd}` },
            { icon: '📅', label: 'dashboard.kpi.bookings_week_today', value: `${d?.week_bookings ?? '0'} / ${d?.todays_bookings ?? '0'}` },
            { icon: '👥', label: 'dashboard.kpi.customers_active_new', value: `${d?.active_customers ?? '0'} / ${d?.new_customers_month ?? '0'}` },
          ]);
        } else {
          setBusinessKpis([
            { icon: '📅', label: 'dashboard.kpi.my_bookings_today', value: d?.my_bookings_today ?? '0' },
            { icon: '📆', label: 'dashboard.kpi.my_bookings_week', value: d?.my_bookings_week ?? '0' },
            { icon: '👥', label: 'dashboard.kpi.my_customers', value: d?.my_customers ?? '0' },
            { icon: '⏰', label: 'dashboard.kpi.next_appointment', value: d?.next_appointment || '—' },
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
      const state = businessSettings.schedulingMode === 'schedule' ? 'enabled' : 'disabled';
      return { ...mod, titleKey: `modules.schedule.title_${state}`, descriptionKey: `modules.schedule.description_${state}` };
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
              <KpiCard key={kpi.label} {...kpi} label={t(kpi.label)} value={kpi.valueKey ? t(kpi.valueKey) : kpi.value} />
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
              <h3 style={modalStyles.title}>{t(detail.title)}</h3>
              <button style={modalStyles.closeBtn} onClick={() => setDetail(null)}>{'\u00d7'}</button>
            </div>
            {detailLoading ? (
              <p style={modalStyles.muted}>{t('common:loading')}</p>
            ) : detail.rows.length === 0 ? (
              <p style={modalStyles.muted}>{t('dashboard.no_records')}</p>
            ) : (
              <div style={modalStyles.table}>
                <div style={modalStyles.tableHeader}>
                  {detail.columns.map((col) => <span key={col.key} style={modalStyles.col}>{t(col.label)}</span>)}
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
    case 'business_staff': case 'staff': case 'reception': case 'technician': case 'therapist': case 'trainer': return ['bookings:read', 'bookings:update', 'customers:read', 'schedule:read'];
    case 'customer': return ['bookings:read', 'bookings:create'];
    default: return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
  }
}

interface KpiData {
  icon: string;
  /** Key in the nav translation file. */
  label: string;
  value: string | number;
  /** A translated value (key in the nav file), shown instead of `value`. */
  valueKey?: string;
  subValue?: string;
  trend?: { direction: 'up' | 'down' | 'flat'; percentage: number; period: string };
  prior?: string;
  onClick?: () => void;
}

function getKpisForPersona(persona: Persona): KpiData[] {
  switch (persona) {
    case 'system':
      return [
        { icon: '🏢', label: 'dashboard.kpi.total_tenants', value: '—' },
        { icon: '🏪', label: 'dashboard.kpi.total_businesses', value: '—' },
        { icon: '💰', label: 'dashboard.kpi.platform_revenue', value: '—' },
        { icon: '✅', label: 'dashboard.kpi.system_health', value: '', valueKey: 'dashboard.kpi.system_health_ok' },
      ];
    case 'tenant':
      return [
        { icon: '🏪', label: 'dashboard.kpi.active_businesses', value: '—' },
        { icon: '💰', label: 'dashboard.kpi.revenue_ytd', value: '—' },
        { icon: '📈', label: 'dashboard.kpi.new_this_month', value: '—' },
        { icon: '📅', label: 'dashboard.kpi.next_billing', value: '—' },
      ];
    case 'business':
      return [
        { icon: '💰', label: 'dashboard.kpi.revenue_mtd', value: '—' },
        { icon: '📅', label: 'dashboard.kpi.todays_bookings', value: '—' },
        { icon: '👥', label: 'dashboard.kpi.active_customers', value: '—' },
        { icon: '🆕', label: 'dashboard.kpi.new_customers', value: '—' },
      ];
    case 'customer':
      return [
        { icon: '📅', label: 'dashboard.kpi.upcoming_bookings', value: '—' },
        { icon: '🏷️', label: 'dashboard.kpi.membership', value: '—' },
        { icon: '⭐', label: 'dashboard.kpi.loyalty_points', value: '—' },
        { icon: '🕐', label: 'dashboard.kpi.last_visit', value: '—' },
      ];
    default:
      return [];
  }
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '700px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  table: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  tableHeader: { display: 'flex', padding: '10px 14px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, gap: '8px' },
  tableRow: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', gap: '8px' },
  col: { flex: 1, minWidth: 0 },
  cell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
