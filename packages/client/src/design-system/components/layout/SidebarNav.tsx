import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Persona } from '@daystream/shared';

interface NavItem {
  /** Key in the nav translation file. */
  labelKey: string;
  path: string;
  icon: string;
}

interface SidebarNavProps {
  persona: Persona;
}

const navByPersona: Record<Persona, NavItem[]> = {
  system: [
    { labelKey: 'sidebar_nav.dashboard', path: '/dashboard', icon: '🏠' },
    { labelKey: 'sidebar_nav.tenants', path: '/admin/tenants', icon: '🏢' },
    { labelKey: 'sidebar_nav.users', path: '/admin/users', icon: '👤' },
    { labelKey: 'sidebar_nav.configuration', path: '/admin/config', icon: '⚙️' },
    { labelKey: 'sidebar_nav.feature_flags', path: '/admin/feature-flags', icon: '🚩' },
    { labelKey: 'sidebar_nav.audit_log', path: '/admin/audit', icon: '🔍' },
  ],
  tenant: [
    { labelKey: 'sidebar_nav.dashboard', path: '/dashboard', icon: '🏠' },
    { labelKey: 'sidebar_nav.businesses', path: '/businesses', icon: '🏪' },
    { labelKey: 'sidebar_nav.users', path: '/admin/tenant-users', icon: '👤' },
    { labelKey: 'sidebar_nav.billing', path: '/billing', icon: '🧾' },
    { labelKey: 'sidebar_nav.reports', path: '/reports', icon: '📈' },
    { labelKey: 'sidebar_nav.settings', path: '/settings', icon: '⚙️' },
  ],
  business: [
    { labelKey: 'sidebar_nav.dashboard', path: '/dashboard', icon: '🏠' },
    { labelKey: 'sidebar_nav.bookings', path: '/bookings', icon: '📅' },
    { labelKey: 'sidebar_nav.people', path: '/customers', icon: '👥' },
    { labelKey: 'sidebar_nav.services', path: '/services', icon: '💼' },
    { labelKey: 'sidebar_nav.staff', path: '/staff', icon: '👔' },
    { labelKey: 'sidebar_nav.reports', path: '/reports', icon: '📈' },
    { labelKey: 'sidebar_nav.settings', path: '/settings', icon: '⚙️' },
  ],
  customer: [
    { labelKey: 'sidebar_nav.dashboard', path: '/dashboard', icon: '🏠' },
    { labelKey: 'sidebar_nav.book', path: '/book', icon: '📅' },
    { labelKey: 'sidebar_nav.my_bookings', path: '/my-bookings', icon: '📋' },
    { labelKey: 'sidebar_nav.account', path: '/profile', icon: '👤' },
  ],
};

export function SidebarNav({ persona }: SidebarNavProps) {
  const location = useLocation();
  const { t } = useTranslation('nav');
  const items = navByPersona[persona] || navByPersona.customer;

  return (
    <nav style={styles.nav} aria-label={t('sidebar_nav.label')}>
      {items.map((item) => {
        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <a
            key={item.path}
            href={item.path}
            style={{ ...styles.link, ...(isActive ? styles.linkActive : {}) }}
            aria-current={isActive ? 'page' : undefined}
          >
            <span style={styles.icon}>{item.icon}</span>
            <span>{t(item.labelKey)}</span>
          </a>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
    padding: 'var(--space-lg) var(--space-sm)',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: 'var(--font-size-sm)',
    transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
  },
  linkActive: {
    background: 'var(--color-surface-hover)',
    color: 'var(--color-primary)',
    fontWeight: 600,
  },
  icon: {
    fontSize: 'var(--font-size-base)',
    width: '20px',
    textAlign: 'center',
  },
};
