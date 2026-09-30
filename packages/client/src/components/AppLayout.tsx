import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useContextManager, getPermissionsFromRole } from '../context/ContextManager';
import { useBusinessSettings } from '../context/BusinessSettingsContext';
import { getVisibleModules } from '../design-system/components/dashboard/moduleRegistry';
import { AppShell, NavIconName, ShellNavGroup, ShellNavItem } from './AppShell';

interface AppLayoutProps {
  children: ReactNode;
}

/** Sidebar icon per module id (THE-7) — replaces the emoji in moduleRegistry for the nav. */
const NAV_ICONS: Record<string, NavIconName> = {
  dashboard: 'LayoutDashboard',
  customers: 'Users',
  appointments: 'CalendarDays',
  schedule: 'CalendarClock',
  accounting: 'Wallet',
  reports: 'ChartLine',
  marketing: 'Megaphone',
  offerings: 'Tag',
  business: 'Briefcase',
  website: 'Globe',
  'business-settings': 'Settings',
  events: 'PartyPopper',
  community: 'HeartHandshake',
  // Tenant and system levels (THE-11) — same icons as AdminLayout
  'tenant-businesses': 'Store',
  'tenant-prospects': 'Target',
  'tenant-users': 'Users',
  'tenant-billing': 'Receipt',
  'tenant-reports': 'ChartLine',
  'tenant-settings': 'Settings',
  'system-tenants': 'Building2',
  'system-coverage': 'Map',
  'system-prospect-categories': 'Tags',
  'system-users': 'Users',
  'system-config': 'SlidersHorizontal',
  'system-audit': 'ScrollText',
  'system-query-editor': 'Database',
};

type GroupDef = { label: string; ids: string[] };

/** Sidebar groups per context level (THE-7 / THE-11). Unlisted modules fall into a final unlabelled group. */
const NAV_GROUPS: Record<'business' | 'tenant' | 'system', GroupDef[]> = {
  business: [
    { label: 'Daily work', ids: ['dashboard', 'customers', 'appointments', 'schedule', 'events'] },
    { label: 'Business', ids: ['offerings', 'accounting', 'reports', 'marketing', 'community'] },
    { label: 'Admin', ids: ['business', 'website', 'business-settings'] },
  ],
  tenant: [
    { label: 'Overview', ids: ['dashboard'] },
    { label: 'Portfolio', ids: ['tenant-businesses', 'tenant-prospects'] },
    { label: 'Administration', ids: ['tenant-users', 'tenant-billing', 'tenant-reports', 'tenant-settings'] },
  ],
  system: [
    { label: 'Overview', ids: ['dashboard'] },
    { label: 'Platform', ids: ['system-tenants', 'system-coverage', 'system-prospect-categories'] },
    { label: 'Administration', ids: ['system-users', 'system-config', 'system-audit', 'system-query-editor'] },
  ],
};

export function AppLayout({ children }: AppLayoutProps) {
  const { user, featureFlags } = useAuth();
  const { persona, activeContext } = useContextManager();

  // Get modules visible to this user for the sidebar, scoped to the active context level
  // (not just the raw JWT persona) so a system admin who has switched into a business
  // context sees business-level modules rather than system admin modules.
  const permissions = user ? getPermissionsFromRole(user.role) : [];
  const baseModules = getVisibleModules(persona, permissions, featureFlags, activeContext.contextLevel);

  // Get scheduling mode from shared context
  const { settings: businessSettings } = useBusinessSettings();

  const items: ShellNavItem[] = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: NAV_ICONS.dashboard },
    ...baseModules.map((mod) => ({
      id: mod.id,
      label: mod.titleKey,
      path: mod.path,
      icon: NAV_ICONS[mod.id] ?? 'Circle',
      off: mod.id === 'schedule' && businessSettings.schedulingMode !== 'schedule',
    })),
  ];

  // Customers only see a couple of links, so staff-oriented headings ("Daily work") don't fit.
  const groupDefs = persona === 'customer' ? [{ label: '', ids: items.map((i) => i.id) }] : NAV_GROUPS[activeContext.contextLevel];
  const groups: ShellNavGroup[] = groupDefs
    .map((g) => ({ label: g.label, items: g.ids.map((id) => items.find((i) => i.id === id)).filter((i): i is ShellNavItem => !!i) }))
    .filter((g) => g.items.length > 0);
  const groupedIds = new Set(groupDefs.flatMap((g) => g.ids));
  const ungrouped = items.filter((i) => !groupedIds.has(i.id));
  if (ungrouped.length > 0) groups.push({ label: '', items: ungrouped });

  return (
    <AppShell groups={groups} brandTag={activeContext.contextLevel === 'business' ? undefined : 'Admin'}>
      {children}
    </AppShell>
  );
}
