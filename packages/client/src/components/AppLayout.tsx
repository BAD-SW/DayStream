import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { icons } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useContextManager, getPermissionsFromRole } from '../context/ContextManager';
import { useBusinessSettings } from '../context/BusinessSettingsContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ContextSwitcher } from './ContextSwitcher';
import { ThemeModeToggle } from '../design-system/themes/ThemeModeToggle';
import { getVisibleModules } from '../design-system/components/dashboard/moduleRegistry';
import { Logo } from '../design-system/components/layout/Logo';
import { Icon } from '../design-system/components/icons/Icon';
import { Profile } from '../pages/Profile';
import './AppLayout.css';

interface AppLayoutProps {
  children: ReactNode;
}

type IconName = keyof typeof icons;

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: IconName;
  off?: boolean;
}

/** Sidebar icon per module id (THE-7) — replaces the emoji in moduleRegistry for the nav. */
const NAV_ICONS: Record<string, IconName> = {
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
};

/** Sidebar groups (THE-7). Modules not listed here fall into a final unlabelled group. */
const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Daily work', ids: ['dashboard', 'customers', 'appointments', 'schedule', 'events'] },
  { label: 'Business', ids: ['offerings', 'accounting', 'reports', 'marketing', 'community'] },
  { label: 'Admin', ids: ['business', 'website', 'business-settings'] },
];

function isActivePath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function initials(first?: string | null, last?: string | null, email?: string): string {
  const fromName = `${first?.[0] ?? ''}${last?.[0] ?? ''}`.trim();
  return (fromName || email?.[0] || '?').toUpperCase();
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout, featureFlags } = useAuth();
  const { persona, activeContext } = useContextManager();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfile, setShowProfile] = useState(false);

  // Get modules visible to this user for the sidebar, scoped to the active context level
  // (not just the raw JWT persona) so a system admin who has switched into a business
  // context sees business-level modules rather than system admin modules.
  const permissions = user ? getPermissionsFromRole(user.role) : [];
  const baseModules = getVisibleModules(persona, permissions, featureFlags, activeContext.contextLevel);

  // Get scheduling mode from shared context
  const { settings: businessSettings } = useBusinessSettings();

  const items: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: NAV_ICONS.dashboard },
    ...baseModules.map((mod) => ({
      id: mod.id,
      label: mod.titleKey,
      path: mod.path,
      icon: NAV_ICONS[mod.id] ?? 'Circle',
      off: mod.id === 'schedule' && businessSettings.schedulingMode !== 'schedule',
    })),
  ];

  const grouped = NAV_GROUPS
    .map((g) => ({ label: g.label, items: g.ids.map((id) => items.find((i) => i.id === id)).filter((i): i is NavItem => !!i) }))
    .filter((g) => g.items.length > 0);
  const groupedIds = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  const ungrouped = items.filter((i) => !groupedIds.has(i.id));
  if (ungrouped.length > 0) grouped.push({ label: '', items: ungrouped });

  const fullName = user?.first_name ? `${user.first_name} ${user.last_name}` : user?.email;

  return (
    <div className={`app-shell${sidebarOpen ? '' : ' app-shell--collapsed'}`}>
      <nav className="app-sidebar" aria-label="Main">
        <Link to="/dashboard" className="app-sidebar__brand" aria-label="DayStream home">
          <Logo size={30} showWordmark={sidebarOpen} />
        </Link>

        {grouped.map((group) => (
          <div className="app-sidebar__group" key={group.label || 'more'}>
            {group.label && sidebarOpen && <h2 className="app-sidebar__group-label">{group.label}</h2>}
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.path);
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`app-sidebar__link${active ? ' is-active' : ''}${item.off ? ' is-off' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={sidebarOpen ? undefined : `${item.label}${item.off ? ' (off)' : ''}`}
                >
                  <Icon name={item.icon} size="md" />
                  {sidebarOpen && <span className="app-sidebar__label">{item.label}</span>}
                  {sidebarOpen && item.off && <span className="app-sidebar__tag">Off</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-topbar__icon-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen}
          >
            <Icon name={sidebarOpen ? 'PanelLeftClose' : 'PanelLeftOpen'} size="md" />
          </button>
          <ContextSwitcher />

          <div className="app-topbar__right">
            <LanguageSwitcher />
            {user && <ThemeModeToggle />}
            {user && (
              <button type="button" className="app-topbar__user" onClick={() => setShowProfile(true)} title="Profile settings">
                <span className="app-topbar__avatar" aria-hidden="true">{initials(user.first_name, user.last_name, user.email)}</span>
                <span className="app-topbar__name">{fullName}</span>
              </button>
            )}
            <button type="button" className="app-topbar__signout" onClick={logout}>
              <Icon name="LogOut" size="sm" />
              Sign out
            </button>
          </div>
        </header>

        <main className="app-content">
          {children}
        </main>
      </div>

      {/* Profile Modal */}
      {showProfile && (
        <div className="app-profile-overlay">
          <div className="app-profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="app-profile-modal__header">
              <h3 id="profile-title" className="app-profile-modal__title">Profile</h3>
              <button type="button" className="app-profile-modal__close" onClick={() => setShowProfile(false)} aria-label="Close">
                <Icon name="X" size="md" />
              </button>
            </div>
            <Profile />
          </div>
        </div>
      )}
    </div>
  );
}
