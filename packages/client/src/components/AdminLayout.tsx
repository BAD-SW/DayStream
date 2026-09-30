import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { resolvePersona } from '../context/ContextManager';
import { AppShell, ShellNavGroup } from './AppShell';

interface AdminLayoutProps {
  children: ReactNode;
}

const SYSTEM_GROUPS: ShellNavGroup[] = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Admin Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
  ] },
  { label: 'Platform', items: [
    { id: 'tenants', label: 'Tenants', path: '/admin/tenants', icon: 'Building2' },
    { id: 'coverage-map', label: 'Coverage Map', path: '/admin/coverage-map', icon: 'Map' },
    { id: 'prospect-categories', label: 'Prospect Categories', path: '/admin/prospect-categories', icon: 'Tags' },
  ] },
  { label: 'Administration', items: [
    { id: 'users', label: 'Users', path: '/admin/users', icon: 'Users' },
    { id: 'config', label: 'Configuration', path: '/admin/config', icon: 'SlidersHorizontal' },
    { id: 'audit-log', label: 'Audit Log', path: '/admin/audit-log', icon: 'ScrollText' },
    { id: 'query-editor', label: 'Query Editor', path: '/query-editor', icon: 'Database' },
  ] },
];

const TENANT_GROUPS: ShellNavGroup[] = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
  ] },
  { label: 'Portfolio', items: [
    { id: 'businesses', label: 'Businesses', path: '/admin/businesses', icon: 'Store' },
    { id: 'prospects', label: 'Prospects', path: '/admin/prospects', icon: 'Target' },
  ] },
  { label: 'Administration', items: [
    { id: 'tenant-users', label: 'Users', path: '/admin/tenant-users', icon: 'Users' },
    { id: 'billing', label: 'Billing', path: '/admin/billing', icon: 'Receipt' },
    { id: 'reports', label: 'Reports', path: '/admin/reports', icon: 'ChartLine' },
    { id: 'tenant-settings', label: 'Settings', path: '/admin/tenant-settings', icon: 'Settings' },
  ] },
];

/** System / tenant area — same Navy frame as the business app (THE-11), admin navigation. */
export function AdminLayout({ children }: AdminLayoutProps) {
  const { user } = useAuth();
  const isSystemAdmin = resolvePersona(user?.role || '') === 'system';

  return (
    <AppShell groups={isSystemAdmin ? SYSTEM_GROUPS : TENANT_GROUPS} brandTag="Admin">
      {children}
    </AppShell>
  );
}
