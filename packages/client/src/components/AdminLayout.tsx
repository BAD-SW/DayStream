import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { resolvePersona } from '../context/ContextManager';
import { AppShell, ShellNavGroup } from './AppShell';

interface AdminLayoutProps {
  children: ReactNode;
}

const SYSTEM_GROUPS: ShellNavGroup[] = [
  { label: 'sidebar.group.overview', items: [
    { id: 'dashboard', label: 'sidebar.adminDashboard', path: '/dashboard', icon: 'LayoutDashboard' },
  ] },
  { label: 'sidebar.group.platform', items: [
    { id: 'tenants', label: 'modules.system-tenants.title', path: '/admin/tenants', icon: 'Building2' },
    { id: 'coverage-map', label: 'modules.system-coverage.title', path: '/admin/coverage-map', icon: 'Map' },
    { id: 'prospect-categories', label: 'modules.system-prospect-categories.title', path: '/admin/prospect-categories', icon: 'Tags' },
    { id: 'system-reports', label: 'modules.system-reports.title', path: '/admin/system-reports', icon: 'ChartLine' },
  ] },
  { label: 'sidebar.group.administration', items: [
    { id: 'users', label: 'modules.system-users.title', path: '/admin/users', icon: 'Users' },
    { id: 'config', label: 'modules.system-config.title', path: '/admin/config', icon: 'SlidersHorizontal' },
    { id: 'processes', label: 'modules.system-processes.title', path: '/admin/processes', icon: 'Workflow' },
    { id: 'audit-log', label: 'modules.system-audit.title', path: '/admin/audit-log', icon: 'ScrollText' },
    { id: 'query-editor', label: 'modules.system-query-editor.title', path: '/query-editor', icon: 'Database' },
  ] },
];

const TENANT_GROUPS: ShellNavGroup[] = [
  { label: 'sidebar.group.overview', items: [
    { id: 'dashboard', label: 'sidebar.dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
  ] },
  { label: 'sidebar.group.portfolio', items: [
    { id: 'businesses', label: 'modules.tenant-businesses.title', path: '/admin/businesses', icon: 'Store' },
    { id: 'prospects', label: 'modules.tenant-prospects.title', path: '/admin/prospects', icon: 'Target' },
  ] },
  { label: 'sidebar.group.administration', items: [
    { id: 'tenant-users', label: 'modules.tenant-users.title', path: '/admin/tenant-users', icon: 'Users' },
    { id: 'billing', label: 'modules.tenant-billing.title', path: '/admin/billing', icon: 'Receipt' },
    { id: 'tenant-reports', label: 'modules.tenant-reports.title', path: '/admin/tenant-reports', icon: 'ChartLine' },
    { id: 'tenant-processes', label: 'modules.tenant-processes.title', path: '/admin/tenant-processes', icon: 'Workflow' },
    { id: 'tenant-settings', label: 'modules.tenant-settings.title', path: '/admin/tenant-settings', icon: 'Settings' },
  ] },
];

/** Labels are nav translation keys (Phase 44). System / tenant area — same Navy frame as the business app (THE-11), admin navigation. */
export function AdminLayout({ children }: AdminLayoutProps) {
  const { user } = useAuth();
  const isSystemAdmin = resolvePersona(user?.role || '') === 'system';

  return (
    <AppShell groups={isSystemAdmin ? SYSTEM_GROUPS : TENANT_GROUPS} brandTag="sidebar.brandTag">
      {children}
    </AppShell>
  );
}
