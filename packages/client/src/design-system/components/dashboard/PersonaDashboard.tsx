import { useAuth } from '../../../context/AuthContext';
import { DashboardShell } from './DashboardShell';
import { KpiCard } from './KpiCard';
import { SortableTileGrid } from './SortableTileGrid';
import { getVisibleModules } from './moduleRegistry';
import { Persona } from '@daystream/shared';

/**
 * Resolves persona from auth context and renders the appropriate dashboard.
 */
export function PersonaDashboard() {
  const { user, featureFlags } = useAuth();

  if (!user) return null;

  // Resolve persona from user role
  const persona = resolvePersona(user.role);
  const permissions = getPermissionsFromRole(user.role);
  const modules = getVisibleModules(persona, permissions, featureFlags);

  const kpis = getKpisForPersona(persona);
  const tiles = modules;

  return (
    <DashboardShell
      kpis={
        <>
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </>
      }
      tiles={<SortableTileGrid modules={tiles} />}
    />
  );
}

function resolvePersona(role: string): Persona {
  if (role === 'system_admin' || role === 'system_support') return 'system';
  if (role === 'tenant_owner' || role === 'tenant_manager') return 'tenant';
  if (role === 'customer') return 'customer';
  return 'business';
}

function getPermissionsFromRole(role: string): string[] {
  // Simplified — in production this comes from JWT/auth context
  switch (role) {
    case 'system_admin': return ['*:*'];
    case 'system_support': return ['*:*'];
    case 'tenant_owner': return ['*:*'];
    case 'tenant_manager': return ['reports:read', 'settings:*'];
    case 'business_owner': return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
    case 'business_manager': return ['services:read', 'bookings:*', 'staff:read', 'reports:read', 'customers:*'];
    case 'business_staff': return ['bookings:read', 'bookings:update', 'customers:read'];
    case 'customer': return ['bookings:read', 'bookings:create'];
    default: return [];
  }
}

interface KpiData {
  icon: string;
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down' | 'flat'; percentage: number; period: string };
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
        { icon: '🏪', label: 'Businesses', value: '—' },
        { icon: '💰', label: 'Revenue', value: '—' },
        { icon: '👥', label: 'Active Customers', value: '—' },
        { icon: '📈', label: 'New Signups', value: '—' },
      ];
    case 'business':
      return [
        { icon: '📅', label: "Today's Bookings", value: '—' },
        { icon: '💰', label: 'Weekly Revenue', value: '—' },
        { icon: '👥', label: 'New Customers', value: '—' },
        { icon: '👔', label: 'Staff Online', value: '—' },
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
