import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { icons } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ContextSwitcher } from './ContextSwitcher';
import { ThemeModeToggle } from '../design-system/themes/ThemeModeToggle';
import { Logo } from '../design-system/components/layout/Logo';
import { Icon } from '../design-system/components/icons/Icon';
import { Profile } from '../pages/Profile';
import './AppLayout.css';

export type NavIconName = keyof typeof icons;

export interface ShellNavItem {
  id: string;
  label: string;
  path: string;
  icon: NavIconName;
  /** Shown muted with an "Off" tag (e.g. Schedule when scheduling is disabled). */
  off?: boolean;
}

export interface ShellNavGroup {
  /** Empty string renders the group without a heading. */
  label: string;
  items: ShellNavItem[];
}

interface AppShellProps {
  groups: ShellNavGroup[];
  /** Small tag next to the logo, e.g. "Admin" for the system/tenant area. */
  brandTag?: string;
  children: ReactNode;
}

/**
 * Whether a nav item is active. A path matches when the URL equals it or is a
 * child of it (so detail pages keep their section highlighted). But when two
 * nav paths both match — e.g. '/clock' and '/clock/admin' on '/clock/admin' —
 * only the MOST SPECIFIC (longest) one wins, so a parent item doesn't light up
 * alongside its sibling. `allPaths` is every nav path currently rendered.
 */
function isActivePath(pathname: string, path: string, allPaths: string[]): boolean {
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (!matches(path)) return false;
  // If a longer sibling path also matches, defer to it.
  return !allPaths.some((other) => other !== path && other.length > path.length && matches(other));
}

function initials(first?: string | null, last?: string | null, email?: string): string {
  const fromName = `${first?.[0] ?? ''}${last?.[0] ?? ''}`.trim();
  return (fromName || email?.[0] || '?').toUpperCase();
}

/**
 * The Navy app frame (THE-7, shared with the admin area in THE-11): full-height grouped
 * sidebar on the left, top bar with context switcher / language / theme / user on the right.
 */
export function AppShell({ groups, brandTag, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfile, setShowProfile] = useState(false);

  const fullName = user?.first_name ? `${user.first_name} ${user.last_name}` : user?.email;

  // All rendered nav paths, so active-state can prefer the most specific match.
  const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));

  return (
    <div className={`app-shell${sidebarOpen ? '' : ' app-shell--collapsed'}`}>
      <nav className="app-sidebar" aria-label="Main">
        <Link to="/dashboard" className="app-sidebar__brand" aria-label="DayStream home">
          <Logo size={30} showWordmark={sidebarOpen} />
          {brandTag && sidebarOpen && <span className="app-sidebar__brand-tag">{brandTag}</span>}
        </Link>

        {groups.map((group) => (
          <div className="app-sidebar__group" key={group.label || 'more'}>
            {group.label && sidebarOpen && <h2 className="app-sidebar__group-label">{group.label}</h2>}
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.path, allPaths);
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
